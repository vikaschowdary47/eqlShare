-- Splitwise import: apply, idempotency, undo rules, placeholders, claim links, RLS.
set client_min_messages = warning;

insert into auth.users (id, email, raw_user_meta_data) values
  ('20000000-0000-0000-0000-00000000000a', 'importer@example.com', '{"display_name":"Vikas"}'),
  ('20000000-0000-0000-0000-00000000000b', 'rahul@example.com', '{"display_name":"Rahul Kumar"}'),
  ('20000000-0000-0000-0000-00000000000c', 'outsider@example.com', '{"display_name":"Olu"}'),
  ('20000000-0000-0000-0000-00000000000d', 'meera@example.com', '{"display_name":"Meera"}');

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false); $$;
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

-- Group "Flat 4B": Rahul owes me 42.50, Asha owes me 10.00, Rahul owes Asha 5.25 (already simplified by the app)
create function pg_temp.plan(space_name text) returns jsonb language sql as $$
  select jsonb_build_object('image_count', 2, 'groups', jsonb_build_array(jsonb_build_object(
    'target', jsonb_build_object('kind', 'new', 'name', space_name, 'type', 'shared_home'),
    'people', jsonb_build_array(
      jsonb_build_object('key', 'me', 'kind', 'me'),
      jsonb_build_object('key', 'rahul', 'kind', 'placeholder', 'display_name', 'Rahul Kumar'),
      jsonb_build_object('key', 'asha', 'kind', 'placeholder', 'display_name', 'Asha')),
    'debts', jsonb_build_array(
      jsonb_build_object('from_key', 'rahul', 'to_key', 'me', 'amount_cents', 4250, 'source_image_index', 0),
      jsonb_build_object('from_key', 'asha', 'to_key', 'me', 'amount_cents', 1000, 'source_image_index', 1),
      jsonb_build_object('from_key', 'rahul', 'to_key', 'asha', 'amount_cents', 525, 'source_image_index', 1)))))
$$;
grant execute on function pg_temp.plan to authenticated;

set role authenticated;
select pg_temp.as_user('20000000-0000-0000-0000-00000000000a');

-- validation
select pg_temp.expect_error($$select apply_splitwise_import(jsonb_set(pg_temp.plan('X'), '{groups,0,people,0,kind}', '"placeholder"'), gen_random_uuid())$$, 'me_required');
select pg_temp.expect_error($$select apply_splitwise_import(jsonb_set(pg_temp.plan('X'), '{groups,0,debts,0,amount_cents}', '-5'), gen_random_uuid())$$, 'bad_amount');
select pg_temp.expect_error($$select apply_splitwise_import(jsonb_set(pg_temp.plan('X'), '{groups,0,debts,0,to_key}', '"rahul"'), gen_random_uuid())$$, 'self_debt');
select pg_temp.expect_error($$select apply_splitwise_import(jsonb_set(pg_temp.plan('X'), '{groups,0,debts,0,to_key}', '"ghost"'), gen_random_uuid())$$, 'unknown_person');
do $$ begin assert (select count(*) from import_batches) = 0, 'failed imports roll back completely'; assert (select count(*) from spaces) = 0; end $$;

-- direct inserts of opening balances are impossible
select pg_temp.expect_error($$insert into bills (space_id, title, amount_cents, payer_member_id, bill_date, split_method, source, created_by) values (gen_random_uuid(), 'x', 1, gen_random_uuid(), current_date, 'exact', 'import', auth.uid())$$, 'permission denied');

-- apply
select pg_temp.put('req', gen_random_uuid()::text);
select pg_temp.put('res', apply_splitwise_import(pg_temp.plan('Flat 4B'), pg_temp.get('req')::uuid)::text);
select pg_temp.put('batch', (pg_temp.get('res')::jsonb->>'batch_id'));
select pg_temp.put('s', (pg_temp.get('res')::jsonb->'space_ids'->>0));
do $$ begin
  assert (select count(*) from bills where import_batch_id = pg_temp.get('batch')::uuid) = 3, 'three opening balances';
  assert (select bool_and(source::text = 'import' and due_date is null and title = 'Opening balance') from bills), 'labelled, no due date';
  assert (select count(*) from space_members where space_id = pg_temp.get('s')::uuid and user_id is null) = 2, 'two placeholders';
  -- idempotent retry returns same batch and creates nothing new
  assert (apply_splitwise_import(pg_temp.plan('Flat 4B'), pg_temp.get('req')::uuid)->>'batch_id') = pg_temp.get('batch'), 'idempotent';
  assert (select count(*) from spaces) = 1 and (select count(*) from bills) = 3, 'no double count';
end $$;

select pg_temp.put('mMe', my_member_id(pg_temp.get('s')::uuid)::text);
select pg_temp.put('mRahul', (select id::text from space_members where display_name = 'Rahul Kumar'));
select pg_temp.put('mAsha', (select id::text from space_members where display_name = 'Asha'));
reset role;
do $$ begin
  assert member_imported_net(pg_temp.get('mRahul')::uuid) = -4775, 'rahul net -47.75';
  assert member_imported_net(pg_temp.get('mAsha')::uuid) = -475, 'asha net -4.75';
  assert member_imported_net(pg_temp.get('mMe')::uuid) = 5250, 'me net +52.50';
end $$;
set role authenticated;

-- reminders: never for opening balances or placeholders
select pg_temp.put('splitRahulMe', (select sp.id::text from bill_splits sp join bills b on b.id = sp.bill_id where sp.member_id = pg_temp.get('mRahul')::uuid and b.payer_member_id = pg_temp.get('mMe')::uuid));
select pg_temp.expect_error($$select send_reminder(pg_temp.get('splitRahulMe')::uuid)$$, 'no_reminders_for_opening_balance');

-- placeholders can be participants in new bills, but get no reminders
select pg_temp.put('wifi', create_bill(pg_temp.get('s')::uuid, 'Wi-Fi', 'internet', 6000, pg_temp.get('mMe')::uuid, current_date, null, null, 'equal',
  jsonb_build_array(jsonb_build_object('member_id', pg_temp.get('mMe'), 'amount_cents', 3000), jsonb_build_object('member_id', pg_temp.get('mRahul'), 'amount_cents', 3000)), gen_random_uuid())::text);
select pg_temp.expect_error($$select send_reminder((select id from bill_splits where bill_id = pg_temp.get('wifi')::uuid and member_id = pg_temp.get('mRahul')::uuid))$$, 'placeholder_not_joined');
select pg_temp.expect_error($$select undo_import(pg_temp.get('batch')::uuid)$$, 'new_bill_added');
select void_bill(pg_temp.get('wifi')::uuid);
-- a voided bill still references the placeholder, so undo stays blocked (history is never rewritten)
select pg_temp.expect_error($$select undo_import(pg_temp.get('batch')::uuid)$$, 'new_bill_added');

-- second import to test undo cleanly
select pg_temp.put('res2', apply_splitwise_import(pg_temp.plan('Trip 2025'), gen_random_uuid())::text);
select pg_temp.put('batch2', (pg_temp.get('res2')::jsonb->>'batch_id'));
select pg_temp.put('s2', (pg_temp.get('res2')::jsonb->'space_ids'->>0));
-- outsider can't undo or see it
select pg_temp.as_user('20000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($$select undo_import(pg_temp.get('batch2')::uuid)$$, 'forbidden');
do $$ begin
  assert (select count(*) from import_batches) = 0, 'outsider sees no batches';
  assert (select count(*) from space_members) = 0, 'outsider sees no placeholders';
  assert (select count(*) from member_claims) = 0, 'outsider sees no claims';
  assert (select count(*) from bills) = 0, 'outsider sees no opening balances';
end $$;
select pg_temp.as_user('20000000-0000-0000-0000-00000000000a');
select undo_import(pg_temp.get('batch2')::uuid);
select undo_import(pg_temp.get('batch2')::uuid); -- idempotent
do $$ begin
  assert (select count(*) from spaces where id = pg_temp.get('s2')::uuid) = 0, 'created space removed';
  assert (select status from import_batches where id = pg_temp.get('batch2')::uuid) = 'undone';
  assert (select count(*) from bills where import_batch_id = pg_temp.get('batch2')::uuid) = 0;
end $$;

-- third import: undo blocked after a settlement
select pg_temp.put('res3', apply_splitwise_import(pg_temp.plan('Flat 9'), gen_random_uuid())::text);
select pg_temp.put('batch3', (pg_temp.get('res3')::jsonb->>'batch_id'));
select pg_temp.put('s3', (pg_temp.get('res3')::jsonb->'space_ids'->>0));
select pg_temp.put('m3Rahul', (select id::text from space_members where space_id = pg_temp.get('s3')::uuid and display_name = 'Rahul Kumar'));

-- ---------- claims ----------
select pg_temp.put('tok', create_member_claim(pg_temp.get('m3Rahul')::uuid));
do $$ begin assert pg_temp.get('tok') ~ '^[0-9a-f]{64}$', 'claim token is URL-safe hex'; end $$;
select pg_temp.expect_error($$select create_member_claim(pg_temp.get('mMe')::uuid)$$, 'not_a_placeholder');

-- non-owners can't mint claims
select pg_temp.as_user('20000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($$select create_member_claim(pg_temp.get('m3Rahul')::uuid)$$, 'forbidden');

-- preview is service-role only; it shows only space name + that placeholder's balance
select pg_temp.expect_error($$select * from preview_member_claim(pg_temp.get('tok'), 'k')$$, 'permission denied');
reset role;
do $$ declare r record; begin
  select * into r from preview_member_claim(pg_temp.get('tok'), 'client-1');
  assert r.valid and r.space_name = 'Flat 9' and r.member_name = 'Rahul Kumar' and r.net_cents = -4775, 'preview ok';
  select * into r from preview_member_claim('deadbeef', 'client-1');
  assert not r.valid and r.space_name is null and r.net_cents is null, 'bad token reveals nothing';
end $$;
-- preview rate limit: 20 per 10 minutes per client key
do $$ declare r record; i int; begin
  for i in 1..25 loop select * into r from preview_member_claim('nope', 'client-2'); end loop;
  assert r.rate_limited, 'preview rate limited';
end $$;
set role authenticated;

-- wrong Space: a token is bound to one placeholder; it never grants anything else
select pg_temp.as_user('20000000-0000-0000-0000-00000000000b');
do $$ begin assert claim_member(pg_temp.get('tok')) = pg_temp.get('s3')::uuid, 'claim returns its own space'; end $$;
do $$ begin
  assert (select user_id from space_members where id = pg_temp.get('m3Rahul')::uuid) = '20000000-0000-0000-0000-00000000000b'::uuid, 'bound to exactly that placeholder';
  assert (select count(*) from spaces) = 1, 'rahul sees only Flat 9, not Flat 4B';
end $$;
-- reused
select pg_temp.as_user('20000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select claim_member(pg_temp.get('tok'))$$, 'claim_invalid');

-- already a member can't claim a second placeholder in the same Space
select pg_temp.as_user('20000000-0000-0000-0000-00000000000a');
select pg_temp.put('m3Asha', (select id::text from space_members where space_id = pg_temp.get('s3')::uuid and display_name = 'Asha'));
select pg_temp.put('tokAsha', create_member_claim(pg_temp.get('m3Asha')::uuid));
select pg_temp.as_user('20000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select claim_member(pg_temp.get('tokAsha'))$$, 'already_member');

-- revoked
select pg_temp.as_user('20000000-0000-0000-0000-00000000000a');
select revoke_member_claims(pg_temp.get('m3Asha')::uuid);
select pg_temp.as_user('20000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select claim_member(pg_temp.get('tokAsha'))$$, 'claim_invalid');

-- expired
select pg_temp.as_user('20000000-0000-0000-0000-00000000000a');
select pg_temp.put('tokAsha2', create_member_claim(pg_temp.get('m3Asha')::uuid));
reset role;
update member_claims set expires_at = now() - interval '1 minute' where token_hash = encode(extensions.digest(pg_temp.get('tokAsha2'), 'sha256'), 'hex');
set role authenticated;
select pg_temp.as_user('20000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select claim_member(pg_temp.get('tokAsha2'))$$, 'claim_invalid');
do $$ begin assert (select count(*) from spaces) = 0, 'failed claims grant no access'; end $$;

-- placeholders can't confirm: Asha (still a placeholder) is payer of rahul->asha; nobody can confirm it yet
-- claimed Rahul can report and dispute his imported balance
select pg_temp.as_user('20000000-0000-0000-0000-00000000000b');
select pg_temp.put('rSplit', (select sp.id::text from bill_splits sp join bills b on b.id = sp.bill_id
  where b.space_id = pg_temp.get('s3')::uuid and sp.member_id = pg_temp.get('m3Rahul')::uuid and b.amount_cents = 525));
select pg_temp.put('set', report_settlement(pg_temp.get('rSplit')::uuid, 525, 'Venmo', null, gen_random_uuid())::text);
select pg_temp.as_user('20000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$select confirm_settlement(pg_temp.get('set')::uuid)$$, 'forbidden');
select pg_temp.as_user('20000000-0000-0000-0000-00000000000b');
select dispute_split((select sp.id from bill_splits sp join bills b on b.id = sp.bill_id
  where b.space_id = pg_temp.get('s3')::uuid and sp.member_id = pg_temp.get('m3Rahul')::uuid and b.amount_cents = 4250), 'I paid this in Sept');

-- undo now blocked
select pg_temp.as_user('20000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$select undo_import(pg_temp.get('batch3')::uuid)$$, 'settlement_recorded');

-- members can't remove placeholders; owners can
select pg_temp.as_user('20000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select deactivate_member(pg_temp.get('m3Asha')::uuid)$$, 'forbidden');

-- extraction rate limit: 10 per hour
select pg_temp.as_user('20000000-0000-0000-0000-00000000000c');
do $$ declare i int; begin for i in 1..10 loop perform begin_extraction(2); end loop; end $$;
select pg_temp.expect_error($$select begin_extraction(1)$$, 'rate_limited');
select pg_temp.expect_error($$select begin_extraction(21)$$, 'bad_image_count');

reset role;
\echo 'splitwise import tests: ok'
