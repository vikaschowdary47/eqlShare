-- Import from Splitwise: placeholder members, import batches, opening balances,
-- per-placeholder claim links, and extraction rate limiting.
-- Opening balances are ordinary bills (source 'import') so they settle through the
-- existing report -> confirm flow. Splitwise itself is never contacted.

-- ---------- placeholder members ----------
alter table space_members alter column user_id drop not null;
alter table space_members add column display_name text check (char_length(trim(display_name)) between 1 and 80);
alter table space_members add column import_batch_id uuid;
alter table space_members add column claimed_at timestamptz;
alter table space_members add constraint placeholder_has_name check (user_id is not null or display_name is not null);

-- ---------- import batches ----------
create type import_status as enum ('applied', 'undone');

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users,
  status import_status not null default 'applied',
  image_count int not null default 0 check (image_count between 0 and 20),
  client_request_id uuid not null unique,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);

alter table space_members add constraint space_members_import_fk foreign key (import_batch_id) references import_batches;
alter table spaces add column import_batch_id uuid references import_batches;

alter type bill_source add value if not exists 'import';
alter table bills add column import_batch_id uuid references import_batches;
alter table bills add column source_image_index int check (source_image_index between 0 and 19);
create index bills_import_batch on bills (import_batch_id) where import_batch_id is not null;

-- ---------- claim links ----------
create table member_claims (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces on delete cascade,
  member_id uuid not null references space_members on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  used_at timestamptz,
  used_by uuid references auth.users,
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now()
);
create index member_claims_member on member_claims (member_id);

-- ---------- rate limiting & cost tracking (counts only, never content) ----------
create table extraction_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  image_count int not null check (image_count between 1 and 20),
  latency_ms int,
  input_tokens int,
  output_tokens int,
  succeeded boolean,
  created_at timestamptz not null default now()
);
create index extraction_requests_user on extraction_requests (user_id, created_at desc);

-- Anonymous claim previews, keyed by a server-side hash of the client IP
create table claim_preview_attempts (
  id bigint generated always as identity primary key,
  client_key text not null,
  created_at timestamptz not null default now()
);
create index claim_preview_attempts_key on claim_preview_attempts (client_key, created_at desc);

alter table import_batches enable row level security;
alter table member_claims enable row level security;
alter table extraction_requests enable row level security;
alter table claim_preview_attempts enable row level security;

create policy "own batches" on import_batches for select using (created_by = auth.uid());
create policy "owners read claims" on member_claims for select using (is_space_owner(space_id));
create policy "own extraction requests" on extraction_requests for select using (user_id = auth.uid());
-- claim_preview_attempts: no policies; only SECURITY DEFINER functions touch it

revoke insert, update, delete on import_batches, member_claims, extraction_requests, claim_preview_attempts from anon, authenticated;
revoke select on claim_preview_attempts from anon, authenticated;

-- ---------- NULL-safe replacements now that user_id can be null ----------
create or replace function deactivate_member(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m space_members;
begin
  select * into m from space_members where id = p_member;
  if m.id is null or m.status <> 'active' then raise exception 'not_found'; end if;
  -- a placeholder (user_id null) can only be removed by an owner
  if m.user_id is distinct from auth.uid() and not is_space_owner(m.space_id) then raise exception 'forbidden'; end if;
  if m.role = 'owner' and (select count(*) from space_members where space_id = m.space_id and role = 'owner' and status = 'active') = 1
     and (select count(*) from space_members where space_id = m.space_id and status = 'active') > 1 then
    raise exception 'last_owner';
  end if;
  update space_members set status = 'inactive', left_at = now() where id = p_member;
  update member_claims set revoked_at = now() where member_id = p_member and used_at is null and revoked_at is null;
  perform log_activity(m.space_id, 'member', p_member, case when m.user_id is not distinct from auth.uid() then 'member_left' else 'member_removed' end);
end $$;

-- Placeholders can't receive reminders; opening balances never send reminders.
create or replace function send_reminder(p_split uuid) returns void
language plpgsql security definer set search_path = public as $$
declare sp bill_splits; b bills; v_user uuid;
begin
  select * into sp from bill_splits where id = p_split;
  select * into b from bills where id = sp.bill_id;
  if sp.id is null or member_user(b.payer_member_id) is distinct from auth.uid() then raise exception 'forbidden'; end if;
  if b.source::text = 'import' then raise exception 'no_reminders_for_opening_balance'; end if;
  select user_id into v_user from space_members where id = sp.member_id;
  if v_user is null then raise exception 'placeholder_not_joined'; end if;
  if exists (select 1 from notification_prefs where user_id = v_user and space_id = b.space_id and reminders_opt_out) then raise exception 'opted_out'; end if;
  if exists (select 1 from reminders where bill_split_id = p_split and sent_at > now() - interval '24 hours') then raise exception 'rate_limited'; end if;
  insert into reminders (bill_split_id, sent_by) values (p_split, auth.uid());
  perform log_activity(b.space_id, 'bill', b.id, 'reminder_sent', jsonb_build_object('title', b.title));
end $$;

-- Opening balances only come from apply_splitwise_import.
create or replace function block_manual_import_source() returns trigger language plpgsql as $$
begin
  if new.source::text = 'import' and new.import_batch_id is null then raise exception 'import_source_reserved'; end if;
  return new;
end $$;
create trigger bills_import_source before insert or update on bills for each row execute function block_manual_import_source();

-- ---------- apply import ----------
-- p_plan: { image_count, groups: [ {
--   target: {kind:"new", name, type} | {kind:"existing", space_id},
--   people: [ {key, kind:"me"|"placeholder"|"existing", display_name?, member_id?} ],
--   debts:  [ {from_key, to_key, amount_cents, source_image_index?} ] } ] }
-- Debts are already simplified by the app; the database re-validates every reference and amount.
create function apply_splitwise_import(p_plan jsonb, p_client_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid; g jsonb; p jsonb; d jsonb; v_space uuid; v_me uuid; v_keys jsonb; v_member uuid;
  v_from uuid; v_to uuid; v_bill uuid; v_amount bigint; v_spaces uuid[] := '{}'; v_name text; v_type space_type;
  v_debts int := 0; v_existing_batch import_batches;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_existing_batch from import_batches where client_request_id = p_client_request_id;
  if v_existing_batch.id is not null then
    -- idempotent retry
    return jsonb_build_object('batch_id', v_existing_batch.id,
      'space_ids', coalesce((select jsonb_agg(distinct space_id) from bills where import_batch_id = v_existing_batch.id), '[]'::jsonb));
  end if;
  if jsonb_typeof(p_plan->'groups') <> 'array' or jsonb_array_length(p_plan->'groups') = 0 then raise exception 'no_groups'; end if;
  if jsonb_array_length(p_plan->'groups') > 20 then raise exception 'too_many_groups'; end if;

  insert into import_batches (created_by, image_count, client_request_id)
  values (auth.uid(), least(greatest(coalesce((p_plan->>'image_count')::int, 0), 0), 20), p_client_request_id)
  returning id into v_batch;

  for g in select * from jsonb_array_elements(p_plan->'groups') loop
    if (select count(*) from jsonb_array_elements(g->'people') x where x->>'kind' = 'me') <> 1 then raise exception 'me_required'; end if;
    if jsonb_array_length(g->'people') > 50 or jsonb_array_length(g->'debts') > 100 then raise exception 'group_too_large'; end if;

    -- target Space
    if g->'target'->>'kind' = 'new' then
      v_name := trim(g->'target'->>'name');
      v_type := coalesce(nullif(g->'target'->>'type', ''), 'shared_home')::space_type;
      if v_name is null or char_length(v_name) not between 1 and 60 then raise exception 'bad_space_name'; end if;
      insert into spaces (name, type, created_by, default_split, import_batch_id)
      values (v_name, v_type, auth.uid(), case when v_type = 'family' then 'exact'::split_method else 'equal'::split_method end, v_batch)
      returning id into v_space;
      insert into space_members (space_id, user_id, role) values (v_space, auth.uid(), 'owner') returning id into v_me;
      insert into notification_prefs (user_id, space_id) values (auth.uid(), v_space);
      perform log_activity(v_space, 'space', v_space, 'space_created', jsonb_build_object('type', v_type, 'imported', true));
    elsif g->'target'->>'kind' = 'existing' then
      v_space := (g->'target'->>'space_id')::uuid;
      if not is_space_owner(v_space) then raise exception 'forbidden'; end if;
      v_me := my_member_id(v_space);
    else
      raise exception 'bad_target';
    end if;
    v_spaces := v_spaces || v_space;

    -- people -> member ids
    v_keys := '{}'::jsonb;
    for p in select * from jsonb_array_elements(g->'people') loop
      if coalesce(p->>'key', '') = '' or v_keys ? (p->>'key') then raise exception 'bad_person_key'; end if;
      if p->>'kind' = 'me' then
        v_member := v_me;
      elsif p->>'kind' = 'existing' then
        v_member := (p->>'member_id')::uuid;
        if not exists (select 1 from space_members where id = v_member and space_id = v_space and status = 'active') then raise exception 'participant_not_member'; end if;
      elsif p->>'kind' = 'placeholder' then
        v_name := trim(p->>'display_name');
        if v_name is null or char_length(v_name) not between 1 and 80 then raise exception 'bad_person_name'; end if;
        insert into space_members (space_id, user_id, display_name, role, import_batch_id)
        values (v_space, null, v_name, 'member', v_batch) returning id into v_member;
      else
        raise exception 'bad_person_kind';
      end if;
      v_keys := v_keys || jsonb_build_object(p->>'key', v_member);
    end loop;

    -- opening balances: one bill per pairwise debt; the person owed is the payer
    for d in select * from jsonb_array_elements(coalesce(g->'debts', '[]'::jsonb)) loop
      v_amount := (d->>'amount_cents')::bigint;
      if v_amount is null or v_amount <= 0 or v_amount > 100000000 then raise exception 'bad_amount'; end if;
      if not (v_keys ? (d->>'from_key')) or not (v_keys ? (d->>'to_key')) then raise exception 'unknown_person'; end if;
      v_from := (v_keys->>(d->>'from_key'))::uuid;
      v_to := (v_keys->>(d->>'to_key'))::uuid;
      if v_from = v_to then raise exception 'self_debt'; end if;
      insert into bills (space_id, title, category, amount_cents, payer_member_id, bill_date, due_date, split_method, source,
                         utility_status, created_by, import_batch_id, source_image_index, note)
      values (v_space, 'Opening balance', 'other', v_amount, v_to, current_date, null, 'exact', 'import',
              'not_applicable', auth.uid(), v_batch, (d->>'source_image_index')::int, 'Imported from Splitwise')
      returning id into v_bill;
      insert into bill_splits (bill_id, member_id, amount_cents) values (v_bill, v_from, v_amount);
      v_debts := v_debts + 1;
    end loop;

    insert into activity (space_id, actor_user_id, entity_type, entity_id, action, metadata)
    values (v_space, auth.uid(), 'import', v_batch, 'opening_balances_imported',
            jsonb_build_object('count', jsonb_array_length(coalesce(g->'debts', '[]'::jsonb))));
  end loop;

  return jsonb_build_object('batch_id', v_batch, 'space_ids', to_jsonb(v_spaces), 'debt_count', v_debts);
end $$;

-- Undo is allowed only while nothing has been built on top of the import.
create function import_undo_blockers(p_batch uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select array_remove(array[
    case when exists (select 1 from settlements s join bill_splits sp on sp.id = s.bill_split_id join bills b on b.id = sp.bill_id
                      where b.import_batch_id = p_batch) then 'settlement_recorded' end,
    case when exists (select 1 from bills b where b.import_batch_id is distinct from p_batch and (
                        b.payer_member_id in (select id from space_members where import_batch_id = p_batch)
                        or exists (select 1 from bill_splits sp where sp.bill_id = b.id and sp.member_id in (select id from space_members where import_batch_id = p_batch))
                        or b.space_id in (select id from spaces where import_batch_id = p_batch)))
         then 'new_bill_added' end,
    case when exists (select 1 from space_members where import_batch_id = p_batch and user_id is not null) then 'placeholder_claimed' end,
    case when exists (select 1 from bills b join bill_splits sp on sp.bill_id = b.id where b.import_batch_id = p_batch and sp.disputed_at is not null) then 'balance_disputed' end,
    case when exists (select 1 from space_members m join spaces s on s.id = m.space_id
                      where s.import_batch_id = p_batch and m.import_batch_id is distinct from p_batch and m.user_id is distinct from s.created_by) then 'member_joined' end
  ], null)
$$;
revoke execute on function import_undo_blockers from public, anon, authenticated;

create function undo_import(p_batch uuid) returns void
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
  delete from member_claims where member_id in (select id from space_members where import_batch_id = p_batch);
  delete from bills where import_batch_id = p_batch;
  delete from space_members where import_batch_id = p_batch;
  delete from spaces where import_batch_id = p_batch;  -- cascades owner membership, prefs, activity
  update import_batches set status = 'undone', undone_at = now() where id = p_batch;
end $$;

create function import_status_for(p_batch uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v import_batches;
begin
  select * into v from import_batches where id = p_batch and created_by = auth.uid();
  if v.id is null then return null; end if;
  return jsonb_build_object('status', v.status, 'blockers', to_jsonb(import_undo_blockers(p_batch)));
end $$;

-- ---------- claim links ----------
create function create_member_claim(p_member uuid) returns text
language plpgsql security definer set search_path = public as $$
declare m space_members; v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  select * into m from space_members where id = p_member;
  if m.id is null or not is_space_owner(m.space_id) then raise exception 'forbidden'; end if;
  if m.user_id is not null or m.status <> 'active' then raise exception 'not_a_placeholder'; end if;
  -- one live link per placeholder
  update member_claims set revoked_at = now() where member_id = p_member and used_at is null and revoked_at is null;
  insert into member_claims (space_id, member_id, token_hash, expires_at, created_by)
  values (m.space_id, p_member, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '14 days', auth.uid());
  perform log_activity(m.space_id, 'member', p_member, 'claim_link_created');
  return v_token;
end $$;

create function revoke_member_claims(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m space_members;
begin
  select * into m from space_members where id = p_member;
  if m.id is null or not is_space_owner(m.space_id) then raise exception 'forbidden'; end if;
  update member_claims set revoked_at = now() where member_id = p_member and used_at is null and revoked_at is null;
end $$;

-- Net imported balance for one member: positive = others owe them.
create function member_imported_net(p_member uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(sp.amount_cents) from bills b join bill_splits sp on sp.bill_id = b.id
                   where b.source::text = 'import' and b.status = 'published' and b.payer_member_id = p_member and sp.member_id <> p_member), 0)
       - coalesce((select sum(sp.amount_cents) from bills b join bill_splits sp on sp.bill_id = b.id
                   where b.source::text = 'import' and b.status = 'published' and sp.member_id = p_member and b.payer_member_id <> p_member), 0)
$$;
revoke execute on function member_imported_net from public, anon, authenticated;

-- Pre-login preview. Called by the server (service role) with a hashed client key for rate limiting.
-- Returns only the Space name, the placeholder's display name and that placeholder's balance.
create function preview_member_claim(p_token text, p_client_key text) returns table (valid boolean, space_name text, member_name text, net_cents bigint, rate_limited boolean)
language plpgsql security definer set search_path = public as $$
declare c member_claims; m space_members;
begin
  if (select count(*) from claim_preview_attempts where client_key = p_client_key and created_at > now() - interval '10 minutes') >= 20 then
    return query select false, null::text, null::text, null::bigint, true; return;
  end if;
  insert into claim_preview_attempts (client_key) values (p_client_key);
  select * into c from member_claims where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if c.id is null or c.revoked_at is not null or c.used_at is not null or c.expires_at < now() then
    return query select false, null::text, null::text, null::bigint, false; return;
  end if;
  select * into m from space_members where id = c.member_id;
  if m.user_id is not null or m.status <> 'active' then
    return query select false, null::text, null::text, null::bigint, false; return;
  end if;
  return query select true, s.name, m.display_name, member_imported_net(m.id), false from spaces s where s.id = c.space_id;
end $$;
revoke execute on function preview_member_claim from public, anon, authenticated;
grant execute on function preview_member_claim to service_role;

create function claim_member(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c member_claims; m space_members;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into c from member_claims where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if c.id is null or c.revoked_at is not null or c.used_at is not null or c.expires_at < now() then raise exception 'claim_invalid'; end if;
  select * into m from space_members where id = c.member_id for update;
  if m.user_id is not null or m.status <> 'active' then raise exception 'claim_invalid'; end if;
  if exists (select 1 from space_members where space_id = c.space_id and user_id = auth.uid() and status = 'active') then raise exception 'already_member'; end if;
  update space_members set user_id = auth.uid(), claimed_at = now() where id = m.id;
  update member_claims set used_at = now(), used_by = auth.uid() where id = c.id;
  update member_claims set revoked_at = now() where member_id = m.id and id <> c.id and used_at is null and revoked_at is null;
  insert into notification_prefs (user_id, space_id) values (auth.uid(), c.space_id) on conflict do nothing;
  perform log_activity(c.space_id, 'member', m.id, 'placeholder_claimed', jsonb_build_object('name', m.display_name));
  return c.space_id;
end $$;

-- ---------- extraction rate limit ----------
create function begin_extraction(p_image_count int) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_image_count not between 1 and 20 then raise exception 'bad_image_count'; end if;
  if (select count(*) from extraction_requests where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited';
  end if;
  insert into extraction_requests (user_id, image_count) values (auth.uid(), p_image_count) returning id into v_id;
  return v_id;
end $$;

create function finish_extraction(p_id uuid, p_latency_ms int, p_input_tokens int, p_output_tokens int, p_succeeded boolean) returns void
language sql security definer set search_path = public as $$
  update extraction_requests set latency_ms = p_latency_ms, input_tokens = p_input_tokens, output_tokens = p_output_tokens, succeeded = p_succeeded
  where id = p_id and user_id = auth.uid()
$$;

revoke execute on function apply_splitwise_import, undo_import, import_status_for, create_member_claim, revoke_member_claims, claim_member, begin_extraction, finish_extraction from anon;
