-- Authorization and financial-integrity tests. Each failed assertion raises and stops the run.
\set QUIET on
set client_min_messages = warning;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'priya@example.com', '{"display_name":"Priya Raman"}'),
  ('00000000-0000-0000-0000-00000000000b', 'marcus@example.com', '{"display_name":"Marcus Okonkwo-Bell"}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@example.com', '{}'),
  ('00000000-0000-0000-0000-00000000000d', 'dave@example.com', '{}');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false); $$;

-- expects(sql, error fragment): the statement must fail with that error
create function pg_temp.expect_error(p_sql text, p_frag text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED ERROR "%" BUT SUCCEEDED: %', p_frag, p_sql;
exception when others then
  if sqlerrm like 'EXPECTED ERROR%' then raise; end if;
  if position(p_frag in sqlerrm) = 0 then raise exception 'expected "%" got "%" for %', p_frag, sqlerrm, p_sql; end if;
end $$;

create table pg_temp.ctx (k text primary key, v text);
grant all on pg_temp.ctx to authenticated;
create function pg_temp.get(k text) returns text language sql as $$ select v from pg_temp.ctx where ctx.k = get.k $$;
create function pg_temp.put(k text, v text) returns void language sql as $$ insert into pg_temp.ctx values (k, v) on conflict (k) do update set v = excluded.v $$;
grant execute on all functions in schema pg_temp to authenticated;

set role authenticated;

-- Profiles are created by trigger
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select display_name from profiles where id = auth.uid()) = 'Priya Raman', 'profile created'; end $$;

-- Priya creates a Shared Home and an invite
select pg_temp.put('s1', create_space('Maple Apartment', 'shared_home')::text);
select pg_temp.put('tok', create_invitation(pg_temp.get('s1')::uuid));
do $$ begin assert (select type from spaces where id = pg_temp.get('s1')::uuid) = 'shared_home'; end $$;
do $$ begin assert pg_temp.get('tok') ~ '^[0-9a-f]{48}$', 'invite token is URL-safe hex'; end $$;

-- Direct writes are blocked; only functions may write
select pg_temp.expect_error($$insert into spaces (name, created_by) values ('x', auth.uid())$$, 'permission denied');
select pg_temp.expect_error($$update bills set amount_cents = 1$$, 'permission denied');

-- Marcus previews and accepts
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select valid and space_name = 'Maple Apartment' from preview_invitation(pg_temp.get('tok'))), 'preview ok'; end $$;
do $$ begin assert (select not valid and space_name is null from preview_invitation('bogus-token')), 'bogus preview leaks nothing'; end $$;
select accept_invitation(pg_temp.get('tok'));
select accept_invitation(pg_temp.get('tok')); -- idempotent for an existing member
do $$ begin assert (select count(*) from space_members where space_id = pg_temp.get('s1')::uuid) = 2, 'two members'; end $$;
select pg_temp.expect_error($$select create_invitation(pg_temp.get('s1')::uuid)$$, 'forbidden');

-- Carol owns a different Space and cannot see Space 1
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.put('s2', create_space('Weekend Trip', 'group')::text);
do $$ begin
  assert (select count(*) from spaces) = 1, 'carol sees only her space';
  assert (select count(*) from space_members where space_id = pg_temp.get('s1')::uuid) = 0, 'no cross-space members';
end $$;

-- Member ids
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.put('mA', my_member_id(pg_temp.get('s1')::uuid)::text);
select pg_temp.put('mB', (select id::text from space_members where space_id = pg_temp.get('s1')::uuid and role = 'member'));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.put('mC', my_member_id(pg_temp.get('s2')::uuid)::text);

-- Bills: validation
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
create function pg_temp.shares(a int, b int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('member_id', pg_temp.get('mA'), 'amount_cents', a), jsonb_build_object('member_id', pg_temp.get('mB'), 'amount_cents', b)) $$;
grant execute on function pg_temp.shares to authenticated;

select pg_temp.expect_error($$select create_bill(pg_temp.get('s1')::uuid, 'Electricity', 'electricity', 13701, pg_temp.get('mA')::uuid, '2026-10-01', '2026-10-29', null, 'exact', pg_temp.shares(6850, 6850), gen_random_uuid())$$, 'splits_must_equal_total');
select pg_temp.expect_error($$select create_bill(pg_temp.get('s1')::uuid, 'Zero', 'other', 0, pg_temp.get('mA')::uuid, '2026-10-01', null, null, 'equal', pg_temp.shares(0, 0), gen_random_uuid())$$, 'amount_positive');
select pg_temp.expect_error($$select create_bill(pg_temp.get('s1')::uuid, 'X', 'other', 100, pg_temp.get('mA')::uuid, '2026-10-01', null, null, 'exact',
  jsonb_build_array(jsonb_build_object('member_id', pg_temp.get('mC'), 'amount_cents', 100)), gen_random_uuid())$$, 'participant_not_member');
select pg_temp.expect_error($$select create_bill(pg_temp.get('s1')::uuid, 'X', 'other', 100, pg_temp.get('mA')::uuid, '2026-10-01', null, null, 'exact',
  jsonb_build_array(jsonb_build_object('member_id', pg_temp.get('mA'), 'amount_cents', 50), jsonb_build_object('member_id', pg_temp.get('mA'), 'amount_cents', 50)), gen_random_uuid())$$, 'duplicate_participant');

select pg_temp.put('req', gen_random_uuid()::text);
select pg_temp.put('bill', create_bill(pg_temp.get('s1')::uuid, 'Electricity', 'electricity', 20000, pg_temp.get('mA')::uuid, '2026-10-01', '2026-10-29', null, 'equal', pg_temp.shares(10000, 10000), pg_temp.get('req')::uuid)::text);
-- double submit returns the same bill
do $$ begin
  assert create_bill(pg_temp.get('s1')::uuid, 'Electricity', 'electricity', 20000, pg_temp.get('mA')::uuid, '2026-10-01', '2026-10-29', null, 'equal', pg_temp.shares(10000, 10000), pg_temp.get('req')::uuid)::text = pg_temp.get('bill'), 'idempotent create';
  assert (select count(*) from bills) = 1, 'one bill';
  assert (select utility_status from bills where id = pg_temp.get('bill')::uuid) = 'unpaid', 'utility tracked';
end $$;

-- Marcus may not create a bill paid by Priya
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select create_bill(pg_temp.get('s1')::uuid, 'Gas', 'gas', 100, pg_temp.get('mA')::uuid, '2026-10-01', null, null, 'equal', pg_temp.shares(50, 50), gen_random_uuid())$$, 'only_owner_or_payer');
-- Marcus cannot claim the utility was paid
select pg_temp.expect_error($$select report_utility_paid(pg_temp.get('bill')::uuid)$$, 'forbidden');

-- Carol cannot read or touch Space 1 bills
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin
  assert (select count(*) from bills) = 0, 'carol sees no bills';
  assert (select count(*) from bill_splits) = 0, 'carol sees no splits';
  assert (select count(*) from activity where space_id = pg_temp.get('s1')::uuid) = 0, 'carol sees no activity';
end $$;
select pg_temp.expect_error($$select create_bill(pg_temp.get('s1')::uuid, 'X', 'other', 100, pg_temp.get('mC')::uuid, '2026-10-01', null, null, 'equal', '[]', gen_random_uuid())$$, 'forbidden');

-- Settlements
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.put('splitB', (select id::text from bill_splits where bill_id = pg_temp.get('bill')::uuid and member_id = pg_temp.get('mB')::uuid));
select pg_temp.put('splitA', (select id::text from bill_splits where bill_id = pg_temp.get('bill')::uuid and member_id = pg_temp.get('mA')::uuid));
select pg_temp.expect_error($$select report_settlement(pg_temp.get('splitA')::uuid, 100, null, null, gen_random_uuid())$$, 'forbidden');
select pg_temp.expect_error($$select report_settlement(pg_temp.get('splitB')::uuid, 10001, null, null, gen_random_uuid())$$, 'amount_exceeds_outstanding');
select pg_temp.put('set1', report_settlement(pg_temp.get('splitB')::uuid, 4000, 'Venmo', null, gen_random_uuid())::text);
select pg_temp.expect_error($$select report_settlement(pg_temp.get('splitB')::uuid, 6001, null, null, gen_random_uuid())$$, 'amount_exceeds_outstanding');
select pg_temp.expect_error($$select confirm_settlement(pg_temp.get('set1')::uuid)$$, 'forbidden');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$select report_settlement(pg_temp.get('splitA')::uuid, 100, null, null, gen_random_uuid())$$, 'payer_own_share');
-- amount edits are locked once a payment is reported
select pg_temp.expect_error($$select update_bill(pg_temp.get('bill')::uuid, 1, 'Electricity', 'electricity', '2026-10-29', null, 30000, 'equal', pg_temp.shares(15000, 15000))$$, 'has_settlements');
select confirm_settlement(pg_temp.get('set1')::uuid);
select confirm_settlement(pg_temp.get('set1')::uuid); -- idempotent
do $$ begin
  assert (select status from settlements where id = pg_temp.get('set1')::uuid) = 'confirmed', 'confirmed';
  assert (select count(*) from activity where action = 'payment_confirmed') = 1, 'confirmation logged once';
end $$;
select pg_temp.expect_error($$select void_bill(pg_temp.get('bill')::uuid)$$, 'has_confirmed_settlements');

-- Descriptive edits still work, with optimistic locking
select update_bill(pg_temp.get('bill')::uuid, 1, 'Electricity · ComEd', 'electricity', '2026-10-30', 'Sept usage', null, null, null);
select pg_temp.expect_error($$select update_bill(pg_temp.get('bill')::uuid, 1, 'Again', 'electricity', null, null, null, null, null)$$, 'stale_edit');

-- Reminders are rate limited
select send_reminder(pg_temp.get('splitB')::uuid);
select pg_temp.expect_error($$select send_reminder(pg_temp.get('splitB')::uuid)$$, 'rate_limited');

-- Changing Space type leaves money untouched
select update_space(pg_temp.get('s1')::uuid, 'Maple Apt', 'family', 'exact');
do $$ begin
  assert (select amount_cents from bills where id = pg_temp.get('bill')::uuid) = 20000, 'bill unchanged';
  assert (select sum(amount_cents) from bill_splits where bill_id = pg_temp.get('bill')::uuid) = 20000, 'splits unchanged';
end $$;

-- Invites: revoked and expired fail safely
select pg_temp.put('tok2', create_invitation(pg_temp.get('s1')::uuid));
select revoke_invitation((select id from space_invitations where revoked_at is null order by created_at desc limit 1));
reset role;
update space_invitations set expires_at = now() - interval '1 minute' where token_hash = encode(extensions.digest(pg_temp.get('tok'), 'sha256'), 'hex');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select accept_invitation(pg_temp.get('tok2'))$$, 'invite_invalid');
select pg_temp.expect_error($$select accept_invitation(pg_temp.get('tok'))$$, 'invite_invalid');
do $$ begin assert (select count(*) from spaces) = 0, 'dave has no access'; end $$;

-- Removing a member keeps history; they cannot get new splits
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select deactivate_member(pg_temp.get('mB')::uuid);
select pg_temp.expect_error($$select create_bill(pg_temp.get('s1')::uuid, 'Wi-Fi', 'internet', 8000, pg_temp.get('mA')::uuid, '2026-11-01', null, null, 'equal', pg_temp.shares(4000, 4000), gen_random_uuid())$$, 'participant_not_member');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select count(*) from bill_splits where member_id = pg_temp.get('mB')::uuid) = 1, 'former member still sees their history';
  assert my_member_id(pg_temp.get('s1')::uuid) is null, 'no active membership';
end $$;
-- ...but can still settle their own historical share
select report_settlement(pg_temp.get('splitB')::uuid, 100, null, null, gen_random_uuid());
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select report_settlement(pg_temp.get('splitB')::uuid, 100, null, null, gen_random_uuid())$$, 'forbidden');

-- Last owner cannot leave while others remain; an only member can leave
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select deactivate_member(pg_temp.get('mC')::uuid);

reset role;
\echo 'authz tests: ok'
