-- Eqlshare core schema: Spaces, members, invitations, bills, splits, settlements, activity.
-- Security model: every table has RLS. Members may READ their Space's rows.
-- All WRITES go through SECURITY DEFINER functions that check auth.uid() and roles,
-- so there are no insert/update/delete policies for authenticated users.

create extension if not exists pgcrypto;

create type space_type as enum ('shared_home', 'couple', 'family', 'group');
create type member_role as enum ('owner', 'member');
create type member_status as enum ('active', 'inactive');
create type split_method as enum ('equal', 'exact', 'percent');
create type bill_status as enum ('published', 'void');
create type bill_source as enum ('manual', 'upload', 'email');
create type utility_status as enum ('not_applicable', 'unpaid', 'payment_reported', 'provider_verified');
create type settlement_status as enum ('reported', 'confirmed', 'disputed', 'reversed');

-- ---------- profiles ----------
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now()
);

create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ---------- spaces ----------
create table spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  type space_type not null default 'shared_home',
  currency text not null default 'USD' check (currency = 'USD'),
  default_split split_method not null default 'equal',
  -- opaque token used in the forwarding address; not a secret that grants read access
  inbound_token text not null unique default encode(extensions.gen_random_bytes(9), 'hex'),
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table space_members (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces on delete cascade,
  user_id uuid not null references auth.users,
  role member_role not null default 'member',
  status member_status not null default 'active',
  joined_at timestamptz not null default now(),
  left_at timestamptz
);
create unique index space_members_one_active on space_members (space_id, user_id) where status = 'active';
create index space_members_user on space_members (user_id);

create table space_invitations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  max_uses int not null default 10 check (max_uses between 1 and 50),
  use_count int not null default 0,
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now()
);

-- ---------- bills ----------
create table bills (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 80),
  category text not null default 'other' check (category in ('electricity','gas','water','internet','rent','phone','groceries','travel','dining','other')),
  amount_cents bigint not null check (amount_cents > 0),
  payer_member_id uuid not null references space_members,
  bill_date date not null,
  due_date date,
  period_start date,
  period_end date,
  split_method split_method not null,
  source bill_source not null default 'manual',
  statement_id uuid,
  utility_status utility_status not null default 'not_applicable',
  status bill_status not null default 'published',
  note text check (char_length(note) <= 500),
  client_request_id uuid unique,
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1
);
create index bills_space on bills (space_id, due_date);

create table bill_splits (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills on delete cascade,
  member_id uuid not null references space_members,
  amount_cents bigint not null check (amount_cents >= 0),
  disputed_at timestamptz,
  dispute_note text check (char_length(dispute_note) <= 500),
  created_at timestamptz not null default now(),
  unique (bill_id, member_id)
);

create table settlements (
  id uuid primary key default gen_random_uuid(),
  bill_split_id uuid not null references bill_splits on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  method text check (char_length(method) <= 40),
  note text check (char_length(note) <= 500),
  status settlement_status not null default 'reported',
  reported_by uuid not null references auth.users,
  reported_at timestamptz not null default now(),
  confirmed_by uuid references auth.users,
  confirmed_at timestamptz,
  client_request_id uuid unique
);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  bill_split_id uuid not null references bill_splits on delete cascade,
  channel text not null default 'link' check (channel in ('link', 'email')),
  sent_by uuid not null references auth.users,
  sent_at timestamptz not null default now()
);

create table notification_prefs (
  user_id uuid not null references auth.users on delete cascade,
  space_id uuid not null references spaces on delete cascade,
  bill_arrival boolean not null default true,
  reminder_days int[] not null default '{5,2,1}',
  reminders_opt_out boolean not null default false,
  primary key (user_id, space_id)
);

create table activity (
  id bigint generated always as identity primary key,
  space_id uuid not null references spaces on delete cascade,
  actor_user_id uuid references auth.users,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_space on activity (space_id, created_at desc);

-- ---------- helpers ----------
create function is_space_member(p_space uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from space_members where space_id = p_space and user_id = auth.uid() and status = 'active')
$$;

create function was_space_member(p_space uuid) returns boolean language sql stable security definer set search_path = public as $$
  -- former members keep read access to history (spec: outstanding balances remain visible to authorized participants)
  select exists (select 1 from space_members where space_id = p_space and user_id = auth.uid())
$$;

create function my_member_id(p_space uuid) returns uuid language sql stable security definer set search_path = public as $$
  select id from space_members where space_id = p_space and user_id = auth.uid() and status = 'active'
$$;

create function member_user(p_member uuid) returns uuid language sql stable security definer set search_path = public as $$
  select user_id from space_members where id = p_member
$$;

create function is_space_owner(p_space uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from space_members where space_id = p_space and user_id = auth.uid() and status = 'active' and role = 'owner')
$$;

create function log_activity(p_space uuid, p_type text, p_id uuid, p_action text, p_meta jsonb default '{}') returns void
language sql security definer set search_path = public as $$
  insert into activity (space_id, actor_user_id, entity_type, entity_id, action, metadata) values (p_space, auth.uid(), p_type, p_id, p_action, p_meta)
$$;
revoke execute on function log_activity from public, anon, authenticated;

-- ---------- RLS ----------
alter table profiles enable row level security;
alter table spaces enable row level security;
alter table space_members enable row level security;
alter table space_invitations enable row level security;
alter table bills enable row level security;
alter table bill_splits enable row level security;
alter table settlements enable row level security;
alter table reminders enable row level security;
alter table notification_prefs enable row level security;
alter table activity enable row level security;

create policy "own profile or co-member" on profiles for select using (
  id = auth.uid() or exists (
    select 1 from space_members a join space_members b on a.space_id = b.space_id
    where a.user_id = auth.uid() and b.user_id = profiles.id));
create policy "update own profile" on profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "members read space" on spaces for select using (was_space_member(id));
create policy "members read members" on space_members for select using (was_space_member(space_id));
create policy "owners read invitations" on space_invitations for select using (is_space_owner(space_id));
create policy "members read bills" on bills for select using (was_space_member(space_id));
create policy "members read splits" on bill_splits for select using (exists (select 1 from bills b where b.id = bill_id and was_space_member(b.space_id)));
create policy "members read settlements" on settlements for select using (exists (
  select 1 from bill_splits s join bills b on b.id = s.bill_id where s.id = bill_split_id and was_space_member(b.space_id)));
create policy "members read reminders" on reminders for select using (exists (
  select 1 from bill_splits s join bills b on b.id = s.bill_id where s.id = bill_split_id and was_space_member(b.space_id)));
create policy "own prefs" on notification_prefs for select using (user_id = auth.uid());
create policy "members read activity" on activity for select using (was_space_member(space_id));

-- ---------- spaces & membership ----------
create function create_space(p_name text, p_type space_type) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_space uuid; v_member uuid; v_split split_method;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_split := case when p_type = 'family' then 'exact'::split_method else 'equal'::split_method end;
  insert into spaces (name, type, created_by, default_split) values (trim(p_name), p_type, auth.uid(), v_split) returning id into v_space;
  insert into space_members (space_id, user_id, role) values (v_space, auth.uid(), 'owner') returning id into v_member;
  insert into notification_prefs (user_id, space_id) values (auth.uid(), v_space);
  perform log_activity(v_space, 'space', v_space, 'space_created', jsonb_build_object('type', p_type));
  return v_space;
end $$;

-- Changing type adjusts presets only. Historical bills, splits and settlements are untouched.
create function update_space(p_space uuid, p_name text, p_type space_type, p_default_split split_method) returns void
language plpgsql security definer set search_path = public as $$
declare v_old spaces;
begin
  if not is_space_owner(p_space) then raise exception 'forbidden'; end if;
  select * into v_old from spaces where id = p_space;
  update spaces set name = trim(p_name), type = p_type, default_split = p_default_split, updated_at = now() where id = p_space;
  perform log_activity(p_space, 'space', p_space, 'space_updated',
    jsonb_build_object('name_changed', v_old.name <> trim(p_name), 'type_from', v_old.type, 'type_to', p_type));
end $$;

create function create_invitation(p_space uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not is_space_owner(p_space) then raise exception 'forbidden'; end if;
  v_token := translate(v_token, '+/=', '-_');
  insert into space_invitations (space_id, token_hash, expires_at, created_by)
  values (p_space, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '7 days', auth.uid());
  perform log_activity(p_space, 'invitation', null, 'invite_created');
  return v_token;
end $$;

create function revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_space uuid;
begin
  select space_id into v_space from space_invitations where id = p_invitation;
  if v_space is null or not is_space_owner(v_space) then raise exception 'forbidden'; end if;
  update space_invitations set revoked_at = now() where id = p_invitation and revoked_at is null;
  perform log_activity(v_space, 'invitation', p_invitation, 'invite_revoked');
end $$;

-- Returns only the Space name and inviter for a valid token; same generic shape for every failure.
create function preview_invitation(p_token text) returns table (space_name text, space_type space_type, inviter text, valid boolean, already_member boolean)
language plpgsql stable security definer set search_path = public as $$
declare v space_invitations;
begin
  select * into v from space_invitations where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if v.id is null or v.revoked_at is not null or v.expires_at < now() or v.use_count >= v.max_uses then
    return query select null::text, null::space_type, null::text, false, false; return;
  end if;
  return query select s.name, s.type, p.display_name, true,
    exists (select 1 from space_members m where m.space_id = s.id and m.user_id = auth.uid() and m.status = 'active')
  from spaces s join profiles p on p.id = v.created_by where s.id = v.space_id;
end $$;

create function accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v space_invitations;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v from space_invitations where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if v.id is null or v.revoked_at is not null or v.expires_at < now() or v.use_count >= v.max_uses then
    raise exception 'invite_invalid';
  end if;
  if exists (select 1 from space_members where space_id = v.space_id and user_id = auth.uid() and status = 'active') then
    return v.space_id;
  end if;
  insert into space_members (space_id, user_id, role) values (v.space_id, auth.uid(), 'member');
  insert into notification_prefs (user_id, space_id) values (auth.uid(), v.space_id) on conflict do nothing;
  update space_invitations set use_count = use_count + 1 where id = v.id;
  perform log_activity(v.space_id, 'member', null, 'member_joined');
  return v.space_id;
end $$;

-- Owner deactivates someone, or a member leaves. History and debts are never deleted.
create function deactivate_member(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m space_members;
begin
  select * into m from space_members where id = p_member;
  if m.id is null or m.status <> 'active' then raise exception 'not_found'; end if;
  if m.user_id <> auth.uid() and not is_space_owner(m.space_id) then raise exception 'forbidden'; end if;
  if m.role = 'owner' and (select count(*) from space_members where space_id = m.space_id and role = 'owner' and status = 'active') = 1
     and (select count(*) from space_members where space_id = m.space_id and status = 'active') > 1 then
    raise exception 'last_owner';
  end if;
  update space_members set status = 'inactive', left_at = now() where id = p_member;
  perform log_activity(m.space_id, 'member', p_member, case when m.user_id = auth.uid() then 'member_left' else 'member_removed' end);
end $$;

create function set_member_role(p_member uuid, p_role member_role) returns void
language plpgsql security definer set search_path = public as $$
declare m space_members;
begin
  select * into m from space_members where id = p_member and status = 'active';
  if m.id is null or not is_space_owner(m.space_id) then raise exception 'forbidden'; end if;
  if m.user_id = auth.uid() and p_role = 'member' then raise exception 'cannot_demote_self'; end if;
  update space_members set role = p_role where id = p_member;
  perform log_activity(m.space_id, 'member', p_member, 'role_changed', jsonb_build_object('role', p_role));
end $$;

-- ---------- bills ----------
-- p_shares: [{"member_id": uuid, "amount_cents": int}] already computed by the shared domain code;
-- the database re-validates every invariant so a bad client cannot store unbalanced splits.
create function create_bill(
  p_space uuid, p_title text, p_category text, p_amount_cents bigint, p_payer_member uuid,
  p_bill_date date, p_due_date date, p_note text, p_split_method split_method, p_shares jsonb,
  p_client_request_id uuid, p_period_start date default null, p_period_end date default null,
  p_source bill_source default 'manual', p_statement uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_bill uuid; v_sum bigint; v_count int; v_me uuid := my_member_id(p_space); v_type space_type;
begin
  if v_me is null then raise exception 'forbidden'; end if;
  select id into v_bill from bills where client_request_id = p_client_request_id;
  if v_bill is not null then return v_bill; end if; -- idempotent retry / double click

  -- members can add bills they paid; owners can add bills for anyone
  if p_payer_member <> v_me and not is_space_owner(p_space) then raise exception 'only_owner_or_payer'; end if;
  if not exists (select 1 from space_members where id = p_payer_member and space_id = p_space and status = 'active') then
    raise exception 'payer_not_member';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'amount_positive'; end if;
  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then raise exception 'no_participants'; end if;

  select coalesce(sum((x->>'amount_cents')::bigint), 0), count(*) into v_sum, v_count from jsonb_array_elements(p_shares) x;
  if v_sum <> p_amount_cents then raise exception 'splits_must_equal_total'; end if;
  if exists (select 1 from jsonb_array_elements(p_shares) x where (x->>'amount_cents')::bigint < 0) then raise exception 'negative_share'; end if;
  if (select count(distinct x->>'member_id') from jsonb_array_elements(p_shares) x) <> v_count then raise exception 'duplicate_participant'; end if;
  if exists (select 1 from jsonb_array_elements(p_shares) x where not exists (
      select 1 from space_members m where m.id = (x->>'member_id')::uuid and m.space_id = p_space and m.status = 'active')) then
    raise exception 'participant_not_member';
  end if;

  select type into v_type from spaces where id = p_space;
  insert into bills (space_id, title, category, amount_cents, payer_member_id, bill_date, due_date, period_start, period_end,
                     split_method, source, statement_id, note, client_request_id, created_by, utility_status)
  values (p_space, trim(p_title), p_category, p_amount_cents, p_payer_member, p_bill_date, p_due_date, p_period_start, p_period_end,
          p_split_method, p_source, p_statement, nullif(trim(p_note), ''), p_client_request_id, auth.uid(),
          case when p_category in ('electricity','gas','water','internet','phone','rent') then 'unpaid'::utility_status else 'not_applicable' end)
  returning id into v_bill;

  insert into bill_splits (bill_id, member_id, amount_cents)
  select v_bill, (x->>'member_id')::uuid, (x->>'amount_cents')::bigint from jsonb_array_elements(p_shares) x;

  perform log_activity(p_space, 'bill', v_bill, 'bill_created', jsonb_build_object('title', trim(p_title), 'source', p_source));
  return v_bill;
end $$;

-- Safe edits: descriptive fields always; amount/splits only while no settlement has been recorded.
create function update_bill(
  p_bill uuid, p_version int, p_title text, p_category text, p_due_date date, p_note text,
  p_amount_cents bigint default null, p_split_method split_method default null, p_shares jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare b bills; v_sum bigint; v_me uuid;
begin
  select * into b from bills where id = p_bill for update;
  if b.id is null then raise exception 'not_found'; end if;
  v_me := my_member_id(b.space_id);
  if v_me is null or (b.payer_member_id is distinct from v_me and not is_space_owner(b.space_id)) then raise exception 'forbidden'; end if;
  if b.version <> p_version then raise exception 'stale_edit'; end if;
  if b.status = 'void' then raise exception 'bill_void'; end if;

  if p_amount_cents is not null then
    if exists (select 1 from settlements s join bill_splits sp on sp.id = s.bill_split_id where sp.bill_id = p_bill and s.status in ('reported','confirmed')) then
      raise exception 'has_settlements';
    end if;
    if p_amount_cents <= 0 then raise exception 'amount_positive'; end if;
    select coalesce(sum((x->>'amount_cents')::bigint), 0) into v_sum from jsonb_array_elements(p_shares) x;
    if v_sum <> p_amount_cents then raise exception 'splits_must_equal_total'; end if;
    if exists (select 1 from jsonb_array_elements(p_shares) x where (x->>'amount_cents')::bigint < 0 or not exists (
        select 1 from space_members m where m.id = (x->>'member_id')::uuid and m.space_id = b.space_id)) then
      raise exception 'participant_not_member';
    end if;
    delete from bill_splits where bill_id = p_bill;
    insert into bill_splits (bill_id, member_id, amount_cents)
    select p_bill, (x->>'member_id')::uuid, (x->>'amount_cents')::bigint from jsonb_array_elements(p_shares) x;
    update bills set amount_cents = p_amount_cents, split_method = p_split_method where id = p_bill;
  end if;

  update bills set title = trim(p_title), category = p_category, due_date = p_due_date, note = nullif(trim(p_note), ''),
    updated_at = now(), version = version + 1 where id = p_bill;
  perform log_activity(b.space_id, 'bill', p_bill, 'bill_edited', jsonb_build_object(
    'amount_from', b.amount_cents, 'amount_to', coalesce(p_amount_cents, b.amount_cents),
    'due_from', b.due_date, 'due_to', p_due_date));
end $$;

create function void_bill(p_bill uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b bills; v_me uuid;
begin
  select * into b from bills where id = p_bill for update;
  if b.id is null then raise exception 'not_found'; end if;
  v_me := my_member_id(b.space_id);
  if v_me is null or (b.payer_member_id is distinct from v_me and not is_space_owner(b.space_id)) then raise exception 'forbidden'; end if;
  if exists (select 1 from settlements s join bill_splits sp on sp.id = s.bill_split_id where sp.bill_id = p_bill and s.status = 'confirmed') then
    raise exception 'has_confirmed_settlements';
  end if;
  update bills set status = 'void', updated_at = now(), version = version + 1 where id = p_bill;
  update settlements set status = 'reversed' where bill_split_id in (select id from bill_splits where bill_id = p_bill) and status = 'reported';
  perform log_activity(b.space_id, 'bill', p_bill, 'bill_voided', jsonb_build_object('title', b.title));
end $$;

-- Utility account holder reports they paid the provider. Never "provider_verified" from user input.
create function report_utility_paid(p_bill uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b bills;
begin
  select * into b from bills where id = p_bill;
  if b.id is null or member_user(b.payer_member_id) is distinct from auth.uid() then raise exception 'forbidden'; end if;
  if b.utility_status = 'not_applicable' then raise exception 'not_utility'; end if;
  update bills set utility_status = 'payment_reported', updated_at = now() where id = p_bill;
  perform log_activity(b.space_id, 'bill', p_bill, 'utility_payment_reported', jsonb_build_object('title', b.title));
end $$;

create function dispute_split(p_split uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare sp bill_splits; b bills;
begin
  select * into sp from bill_splits where id = p_split;
  select * into b from bills where id = sp.bill_id;
  if sp.id is null or member_user(sp.member_id) is distinct from auth.uid() then raise exception 'forbidden'; end if;
  update bill_splits set disputed_at = now(), dispute_note = nullif(trim(p_note), '') where id = p_split;
  perform log_activity(b.space_id, 'bill', b.id, 'split_disputed', jsonb_build_object('title', b.title));
end $$;

create function resolve_split_dispute(p_split uuid) returns void
language plpgsql security definer set search_path = public as $$
declare sp bill_splits; b bills; v_me uuid;
begin
  select * into sp from bill_splits where id = p_split;
  select * into b from bills where id = sp.bill_id;
  v_me := my_member_id(b.space_id);
  if sp.id is null or v_me is null or (v_me not in (sp.member_id, b.payer_member_id) and not is_space_owner(b.space_id)) then raise exception 'forbidden'; end if;
  update bill_splits set disputed_at = null where id = p_split;
  perform log_activity(b.space_id, 'bill', b.id, 'split_dispute_resolved', jsonb_build_object('title', b.title));
end $$;

-- ---------- settlements ----------
create function report_settlement(p_split uuid, p_amount_cents bigint, p_method text, p_note text, p_client_request_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare sp bill_splits; b bills; v_id uuid; v_confirmed bigint; v_pending bigint;
begin
  select id into v_id from settlements where client_request_id = p_client_request_id;
  if v_id is not null then return v_id; end if;
  select * into sp from bill_splits where id = p_split for update;
  select * into b from bills where id = sp.bill_id;
  -- former members may still settle their own historical shares
  if sp.id is null or member_user(sp.member_id) is distinct from auth.uid() then raise exception 'forbidden'; end if;
  if b.status = 'void' then raise exception 'bill_void'; end if;
  if sp.member_id = b.payer_member_id then raise exception 'payer_own_share'; end if;
  select coalesce(sum(amount_cents) filter (where status = 'confirmed'), 0), coalesce(sum(amount_cents) filter (where status = 'reported'), 0)
    into v_confirmed, v_pending from settlements where bill_split_id = p_split;
  if p_amount_cents <= 0 or p_amount_cents > sp.amount_cents - v_confirmed - v_pending then raise exception 'amount_exceeds_outstanding'; end if;
  insert into settlements (bill_split_id, amount_cents, method, note, reported_by, client_request_id)
  values (p_split, p_amount_cents, nullif(trim(p_method), ''), nullif(trim(p_note), ''), auth.uid(), p_client_request_id) returning id into v_id;
  perform log_activity(b.space_id, 'settlement', v_id, 'payment_reported', jsonb_build_object('bill_id', b.id, 'title', b.title, 'amount_cents', p_amount_cents));
  return v_id;
end $$;

-- Only the person owed (the bill payer) confirms. Idempotent.
create function confirm_settlement(p_settlement uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s settlements; b bills;
begin
  select * into s from settlements where id = p_settlement for update;
  select b2.* into b from bills b2 join bill_splits sp on sp.bill_id = b2.id where sp.id = s.bill_split_id;
  if s.id is null or member_user(b.payer_member_id) is distinct from auth.uid() then raise exception 'forbidden'; end if;
  if s.status = 'confirmed' then return; end if;
  if s.status <> 'reported' then raise exception 'not_reported'; end if;
  update settlements set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now() where id = p_settlement;
  perform log_activity(b.space_id, 'settlement', p_settlement, 'payment_confirmed', jsonb_build_object('bill_id', b.id, 'title', b.title, 'amount_cents', s.amount_cents));
end $$;

create function dispute_settlement(p_settlement uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s settlements; b bills;
begin
  select * into s from settlements where id = p_settlement for update;
  select b2.* into b from bills b2 join bill_splits sp on sp.bill_id = b2.id where sp.id = s.bill_split_id;
  if s.id is null or member_user(b.payer_member_id) is distinct from auth.uid() then raise exception 'forbidden'; end if;
  if s.status <> 'reported' then raise exception 'not_reported'; end if;
  update settlements set status = 'disputed', note = coalesce(nullif(trim(p_note), ''), note) where id = p_settlement;
  perform log_activity(b.space_id, 'settlement', p_settlement, 'payment_disputed', jsonb_build_object('bill_id', b.id, 'title', b.title));
end $$;

-- A shareable nudge, limited to one per share per 24 hours. Respects the recipient's opt-out.
create function send_reminder(p_split uuid) returns void
language plpgsql security definer set search_path = public as $$
declare sp bill_splits; b bills; v_user uuid;
begin
  select * into sp from bill_splits where id = p_split;
  select * into b from bills where id = sp.bill_id;
  if sp.id is null or member_user(b.payer_member_id) is distinct from auth.uid() then raise exception 'forbidden'; end if;
  select user_id into v_user from space_members where id = sp.member_id;
  if exists (select 1 from notification_prefs where user_id = v_user and space_id = b.space_id and reminders_opt_out) then raise exception 'opted_out'; end if;
  if exists (select 1 from reminders where bill_split_id = p_split and sent_at > now() - interval '24 hours') then raise exception 'rate_limited'; end if;
  insert into reminders (bill_split_id, sent_by) values (p_split, auth.uid());
  perform log_activity(b.space_id, 'bill', b.id, 'reminder_sent', jsonb_build_object('title', b.title));
end $$;

create function update_notification_prefs(p_space uuid, p_bill_arrival boolean, p_days int[], p_opt_out boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_space_member(p_space) then raise exception 'forbidden'; end if;
  if exists (select 1 from unnest(p_days) d where d < 0 or d > 14) then raise exception 'bad_days'; end if;
  insert into notification_prefs (user_id, space_id, bill_arrival, reminder_days, reminders_opt_out)
  values (auth.uid(), p_space, p_bill_arrival, p_days, p_opt_out)
  on conflict (user_id, space_id) do update set bill_arrival = excluded.bill_arrival, reminder_days = excluded.reminder_days, reminders_opt_out = excluded.reminders_opt_out;
end $$;

create function update_display_name(p_name text) returns void
language sql security definer set search_path = public as $$
  update profiles set display_name = trim(p_name) where id = auth.uid()
$$;

-- No direct table writes for clients.
revoke insert, update, delete on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon;
