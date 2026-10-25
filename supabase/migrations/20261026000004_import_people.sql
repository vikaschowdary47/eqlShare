-- Import v2: people who haven't joined yet are tracked once across all their Spaces.
-- One claim link per person covers every Space they're in. Imports carry only the
-- uploader's own pairwise balances. The inviter is notified when someone claims.

-- ---------- people ----------
create table import_people (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users,          -- the person who added them (the inviter)
  display_name text not null check (char_length(trim(display_name)) between 1 and 80),
  import_batch_id uuid references import_batches,
  claimed_by uuid references auth.users,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index import_people_owner on import_people (owner_id);
create index import_people_batch on import_people (import_batch_id) where import_batch_id is not null;

alter table space_members add column person_id uuid references import_people on delete set null;
create index space_members_person on space_members (person_id) where person_id is not null;
-- one placeholder per person per Space
create unique index space_members_person_space on space_members (space_id, person_id) where person_id is not null;

-- Existing placeholders become one person each (owned by the Space's creator)
do $$
declare m record; v_person uuid;
begin
  for m in select sm.id, sm.display_name, sm.import_batch_id, s.created_by
           from space_members sm join spaces s on s.id = sm.space_id
           where sm.user_id is null and sm.person_id is null loop
    insert into import_people (owner_id, display_name, import_batch_id) values (m.created_by, m.display_name, m.import_batch_id) returning id into v_person;
    update space_members set person_id = v_person where id = m.id;
  end loop;
end $$;

-- ---------- one claim link per person ----------
create table person_claims (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references import_people on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  used_at timestamptz,
  used_by uuid references auth.users,
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now()
);
create index person_claims_person on person_claims (person_id);

-- ---------- notifications for one user, across Spaces ----------
create table user_notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index user_notifications_unread on user_notifications (user_id, created_at desc) where read_at is null;

alter table import_people enable row level security;
alter table person_claims enable row level security;
alter table user_notifications enable row level security;
create policy "own people" on import_people for select using (owner_id = auth.uid());
create policy "own people claims" on person_claims for select using (exists (select 1 from import_people p where p.id = person_id and p.owner_id = auth.uid()));
create policy "own notifications" on user_notifications for select using (user_id = auth.uid());
revoke insert, update, delete on import_people, person_claims, user_notifications from anon, authenticated;

-- ---------- retire per-member claim links ----------
drop function if exists create_member_claim(uuid);
drop function if exists revoke_member_claims(uuid);
drop function if exists preview_member_claim(text, text);
drop function if exists claim_member(text);
drop table if exists member_claims;

-- A person's live links are revoked once they have no active placeholder left.
create or replace function deactivate_member(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m space_members;
begin
  select * into m from space_members where id = p_member;
  if m.id is null or m.status <> 'active' then raise exception 'not_found'; end if;
  if m.user_id is distinct from auth.uid() and not is_space_owner(m.space_id) then raise exception 'forbidden'; end if;
  if m.role = 'owner' and (select count(*) from space_members where space_id = m.space_id and role = 'owner' and status = 'active') = 1
     and (select count(*) from space_members where space_id = m.space_id and status = 'active') > 1 then
    raise exception 'last_owner';
  end if;
  update space_members set status = 'inactive', left_at = now() where id = p_member;
  if m.person_id is not null and not exists (select 1 from space_members where person_id = m.person_id and status = 'active' and user_id is null) then
    update person_claims set revoked_at = now() where person_id = m.person_id and used_at is null and revoked_at is null;
  end if;
  perform log_activity(m.space_id, 'member', p_member, case when m.user_id is not distinct from auth.uid() then 'member_left' else 'member_removed' end);
end $$;

-- ---------- apply import (v2) ----------
-- p_plan: { image_count,
--   people: [ {key, display_name} ],
--   spaces: [ { target: {kind:"new", name, type} | {kind:"existing", space_id},
--               balances: [ {person_key, cents, member_id?} ] } ] }
-- cents is from the uploader's point of view: positive = they owe you, negative = you owe them.
-- Only the uploader's own balances are imported; nothing between other people.
-- member_id (existing Spaces only) attaches the balance to a member already in that Space.
create or replace function apply_splitwise_import(p_plan jsonb, p_client_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid; sp jsonb; p jsonb; b jsonb; v_space uuid; v_me uuid; v_member uuid; v_person uuid; v_bill uuid;
  v_people jsonb := '{}'::jsonb; v_seen jsonb; v_spaces uuid[] := '{}'; v_name text; v_type space_type;
  v_cents bigint; v_count int; v_debts int := 0; v_existing import_batches;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_existing from import_batches where client_request_id = p_client_request_id;
  if v_existing.id is not null then
    if v_existing.created_by <> auth.uid() then raise exception 'forbidden'; end if;
    return jsonb_build_object('batch_id', v_existing.id,
      'space_ids', coalesce((select jsonb_agg(distinct space_id) from bills where import_batch_id = v_existing.id), '[]'::jsonb));
  end if;
  if jsonb_typeof(p_plan->'spaces') <> 'array' or jsonb_array_length(p_plan->'spaces') = 0 then raise exception 'no_groups'; end if;
  if jsonb_array_length(p_plan->'spaces') > 40 then raise exception 'too_many_groups'; end if;
  if jsonb_typeof(p_plan->'people') <> 'array' or jsonb_array_length(p_plan->'people') > 100 then raise exception 'bad_people'; end if;

  insert into import_batches (created_by, image_count, client_request_id)
  values (auth.uid(), least(greatest(coalesce((p_plan->>'image_count')::int, 0), 0), 20), p_client_request_id)
  returning id into v_batch;

  -- people (created lazily so people without balances never exist)
  for p in select * from jsonb_array_elements(p_plan->'people') loop
    v_name := trim(p->>'display_name');
    if coalesce(p->>'key', '') = '' or v_people ? (p->>'key') then raise exception 'bad_person_key'; end if;
    if v_name is null or char_length(v_name) not between 1 and 80 then raise exception 'bad_person_name'; end if;
    v_people := v_people || jsonb_build_object(p->>'key', jsonb_build_object('name', v_name, 'id', null));
  end loop;

  for sp in select * from jsonb_array_elements(p_plan->'spaces') loop
    if jsonb_typeof(sp->'balances') <> 'array' or jsonb_array_length(sp->'balances') = 0 then raise exception 'empty_space'; end if;
    if jsonb_array_length(sp->'balances') > 100 then raise exception 'group_too_large'; end if;

    if sp->'target'->>'kind' = 'new' then
      v_name := trim(sp->'target'->>'name');
      v_type := coalesce(nullif(sp->'target'->>'type', ''), 'shared_home')::space_type;
      if v_name is null or char_length(v_name) not between 1 and 60 then raise exception 'bad_space_name'; end if;
      insert into spaces (name, type, created_by, default_split, import_batch_id)
      values (v_name, v_type, auth.uid(), case when v_type = 'family' then 'exact'::split_method else 'equal'::split_method end, v_batch)
      returning id into v_space;
      insert into space_members (space_id, user_id, role) values (v_space, auth.uid(), 'owner') returning id into v_me;
      insert into notification_prefs (user_id, space_id) values (auth.uid(), v_space);
      perform log_activity(v_space, 'space', v_space, 'space_created', jsonb_build_object('type', v_type, 'imported', true));
    elsif sp->'target'->>'kind' = 'existing' then
      v_space := (sp->'target'->>'space_id')::uuid;
      if not is_space_owner(v_space) then raise exception 'forbidden'; end if;
      v_me := my_member_id(v_space);
    else
      raise exception 'bad_target';
    end if;
    v_spaces := v_spaces || v_space;

    v_seen := '{}'::jsonb;
    v_count := 0;
    for b in select * from jsonb_array_elements(sp->'balances') loop
      v_cents := (b->>'cents')::bigint;
      if v_cents is null or v_cents = 0 or abs(v_cents) > 100000000 then raise exception 'bad_amount'; end if;
      if not (v_people ? (b->>'person_key')) then raise exception 'unknown_person'; end if;
      if v_seen ? (b->>'person_key') then raise exception 'duplicate_balance'; end if;
      v_seen := v_seen || jsonb_build_object(b->>'person_key', true);

      if b ? 'member_id' and b->>'member_id' is not null then
        if sp->'target'->>'kind' <> 'existing' then raise exception 'bad_member'; end if;
        v_member := (b->>'member_id')::uuid;
        if v_member = v_me or not exists (select 1 from space_members where id = v_member and space_id = v_space and status = 'active') then
          raise exception 'participant_not_member';
        end if;
      else
        v_person := (v_people->(b->>'person_key')->>'id')::uuid;
        if v_person is null then
          insert into import_people (owner_id, display_name, import_batch_id)
          values (auth.uid(), v_people->(b->>'person_key')->>'name', v_batch) returning id into v_person;
          v_people := jsonb_set(v_people, array[b->>'person_key', 'id'], to_jsonb(v_person));
        end if;
        insert into space_members (space_id, user_id, display_name, role, import_batch_id, person_id)
        values (v_space, null, v_people->(b->>'person_key')->>'name', 'member', v_batch, v_person) returning id into v_member;
      end if;

      -- the person owed is the payer; the person who owes holds the split
      insert into bills (space_id, title, category, amount_cents, payer_member_id, bill_date, due_date, split_method, source,
                         utility_status, created_by, import_batch_id, note)
      values (v_space, 'Opening balance', 'other', abs(v_cents), case when v_cents > 0 then v_me else v_member end, current_date, null, 'exact', 'import',
              'not_applicable', auth.uid(), v_batch, 'Imported from Splitwise')
      returning id into v_bill;
      insert into bill_splits (bill_id, member_id, amount_cents) values (v_bill, case when v_cents > 0 then v_member else v_me end, abs(v_cents));
      v_count := v_count + 1;
      v_debts := v_debts + 1;
    end loop;

    insert into activity (space_id, actor_user_id, entity_type, entity_id, action, metadata)
    values (v_space, auth.uid(), 'import', v_batch, 'opening_balances_imported', jsonb_build_object('count', v_count));
  end loop;

  return jsonb_build_object('batch_id', v_batch, 'space_ids', to_jsonb(v_spaces), 'debt_count', v_debts);
end $$;

create or replace function undo_import(p_batch uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v import_batches; v_blockers text[]; v_space uuid;
begin
  select * into v from import_batches where id = p_batch for update;
  if v.id is null or v.created_by <> auth.uid() then raise exception 'forbidden'; end if;
  if v.status = 'undone' then return; end if;
  v_blockers := import_undo_blockers(p_batch);
  if array_length(v_blockers, 1) > 0 then raise exception 'undo_blocked:%', array_to_string(v_blockers, ','); end if;

  for v_space in select distinct space_id from bills where import_batch_id = p_batch
                 union select distinct space_id from space_members where import_batch_id = p_batch loop
    if not exists (select 1 from spaces where id = v_space and import_batch_id = p_batch) then
      insert into activity (space_id, actor_user_id, entity_type, entity_id, action) values (v_space, auth.uid(), 'import', p_batch, 'import_undone');
    end if;
  end loop;
  delete from bills where import_batch_id = p_batch;
  delete from space_members where import_batch_id = p_batch;
  delete from spaces where import_batch_id = p_batch;
  delete from import_people where import_batch_id = p_batch;  -- cascades their claim links
  update import_batches set status = 'undone', undone_at = now() where id = p_batch;
end $$;

-- ---------- adding someone by name ----------
create function add_placeholder_member(p_space uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_name text := trim(p_name); v_person uuid; v_member uuid;
begin
  if not is_space_owner(p_space) then raise exception 'forbidden'; end if;
  if v_name is null or char_length(v_name) not between 1 and 80 then raise exception 'bad_person_name'; end if;
  if (select count(*) from space_members where space_id = p_space and status = 'active') >= 50 then raise exception 'group_too_large'; end if;
  insert into import_people (owner_id, display_name) values (auth.uid(), v_name) returning id into v_person;
  insert into space_members (space_id, user_id, display_name, role, person_id) values (p_space, null, v_name, 'member', v_person) returning id into v_member;
  perform log_activity(p_space, 'member', v_member, 'placeholder_added', jsonb_build_object('name', v_name));
  return jsonb_build_object('person_id', v_person, 'member_id', v_member);
end $$;

-- ---------- claim links (per person, all their Spaces) ----------
create function create_person_claim(p_person uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v import_people; v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  select * into v from import_people where id = p_person;
  if v.id is null or v.owner_id <> auth.uid() then raise exception 'forbidden'; end if;
  if v.claimed_at is not null or not exists (select 1 from space_members where person_id = p_person and user_id is null and status = 'active') then
    raise exception 'not_a_placeholder';
  end if;
  -- one live link per person
  update person_claims set revoked_at = now() where person_id = p_person and used_at is null and revoked_at is null;
  insert into person_claims (person_id, token_hash, expires_at, created_by)
  values (p_person, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '14 days', auth.uid());
  return v_token;
end $$;

create function revoke_person_claims(p_person uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from import_people where id = p_person and owner_id = auth.uid()) then raise exception 'forbidden'; end if;
  update person_claims set revoked_at = now() where person_id = p_person and used_at is null and revoked_at is null;
end $$;

-- Net balance for one member across published bills: positive = others owe them.
create function member_net(p_member uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(sp.amount_cents) from bills b join bill_splits sp on sp.bill_id = b.id
                   where b.status = 'published' and b.payer_member_id = p_member and sp.member_id <> p_member), 0)
       - coalesce((select sum(sp.amount_cents) from bills b join bill_splits sp on sp.bill_id = b.id
                   where b.status = 'published' and sp.member_id = p_member and b.payer_member_id <> p_member), 0)
$$;
revoke execute on function member_net from public, anon, authenticated;

-- Pre-login preview, called by the server with a hashed client key for rate limiting.
-- Shows only the inviter's name, this person's name, and this person's balance in each of their Spaces.
create function preview_person_claim(p_token text, p_client_key text)
returns table (valid boolean, inviter_name text, person_name text, spaces jsonb, rate_limited boolean)
language plpgsql security definer set search_path = public as $$
declare c person_claims; v import_people;
begin
  if (select count(*) from claim_preview_attempts where client_key = p_client_key and created_at > now() - interval '10 minutes') >= 20 then
    return query select false, null::text, null::text, null::jsonb, true; return;
  end if;
  insert into claim_preview_attempts (client_key) values (p_client_key);
  select * into c from person_claims where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if c.id is null or c.revoked_at is not null or c.used_at is not null or c.expires_at < now() then
    return query select false, null::text, null::text, null::jsonb, false; return;
  end if;
  select * into v from import_people where id = c.person_id;
  if v.claimed_at is not null then return query select false, null::text, null::text, null::jsonb, false; return; end if;
  return query
    select true, (select display_name from profiles where id = v.owner_id), v.display_name,
           coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'net_cents', member_net(m.id)) order by s.name)
                     from space_members m join spaces s on s.id = m.space_id
                     where m.person_id = v.id and m.user_id is null and m.status = 'active'), '[]'::jsonb),
           false;
end $$;
revoke execute on function preview_person_claim from public, anon, authenticated;
grant execute on function preview_person_claim to service_role;

-- Binds every Space this person is in to the caller. Spaces the caller is already in are skipped
-- (their imported balances stay with the placeholder so nothing is double counted).
create function claim_person(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c person_claims; v import_people; m space_members; v_joined uuid[] := '{}'; v_skipped int := 0;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into c from person_claims where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if c.id is null or c.revoked_at is not null or c.used_at is not null or c.expires_at < now() then raise exception 'claim_invalid'; end if;
  select * into v from import_people where id = c.person_id for update;
  if v.claimed_at is not null then raise exception 'claim_invalid'; end if;
  if v.owner_id = auth.uid() then raise exception 'claim_own_invite'; end if;

  for m in select * from space_members where person_id = v.id and user_id is null and status = 'active' order by joined_at for update loop
    if exists (select 1 from space_members where space_id = m.space_id and user_id = auth.uid() and status = 'active') then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    update space_members set user_id = auth.uid(), claimed_at = now() where id = m.id;
    insert into notification_prefs (user_id, space_id) values (auth.uid(), m.space_id) on conflict do nothing;
    perform log_activity(m.space_id, 'member', m.id, 'placeholder_claimed', jsonb_build_object('name', m.display_name));
    v_joined := v_joined || m.space_id;
  end loop;
  if array_length(v_joined, 1) is null then raise exception 'already_member'; end if;

  update import_people set claimed_by = auth.uid(), claimed_at = now() where id = v.id;
  update person_claims set used_at = now(), used_by = auth.uid() where id = c.id;
  update person_claims set revoked_at = now() where person_id = v.id and id <> c.id and used_at is null and revoked_at is null;
  insert into user_notifications (user_id, kind, payload)
  values (v.owner_id, 'person_claimed', jsonb_build_object(
    'name', coalesce((select display_name from profiles where id = auth.uid()), v.display_name),
    'imported_as', v.display_name,
    'space_count', array_length(v_joined, 1),
    'space_ids', to_jsonb(v_joined)));
  return jsonb_build_object('space_ids', to_jsonb(v_joined), 'skipped', v_skipped);
end $$;

create function mark_notifications_read(p_ids bigint[]) returns void
language sql security definer set search_path = public as $$
  update user_notifications set read_at = now() where id = any(p_ids) and user_id = auth.uid() and read_at is null
$$;

revoke execute on function add_placeholder_member, create_person_claim, revoke_person_claims, claim_person, mark_notifications_read from anon;
