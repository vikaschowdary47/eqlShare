-- Splitwise import v2: pairwise balances, people across Spaces, per-person claim links,
-- notifications, undo rules and RLS.
set client_min_messages = warning;

insert into auth.users (id, email, raw_user_meta_data) values
  ('20000000-0000-0000-0000-00000000000a', 'vikas@example.com', '{"display_name":"Vikas"}'),
  ('20000000-0000-0000-0000-00000000000b', 'ravi@example.com', '{"display_name":"Ravi Kumar"}'),
  ('20000000-0000-0000-0000-00000000000c', 'outsider@example.com', '{"display_name":"Olu"}'),
  ('20000000-0000-0000-0000-00000000000d', 'arjun@example.com', '{"display_name":"Arjun"}');

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

-- The uploader's own balances (positive = they owe you). Overall: you owe $428.26.
create function pg_temp.plan() returns jsonb language sql as $$
  select jsonb_build_object('image_count', 2,
    'people', jsonb_build_array(
      jsonb_build_object('key', 'ravi', 'display_name', 'Ravi Kumar'),
      jsonb_build_object('key', 'divya', 'display_name', 'Divya Home'),
      jsonb_build_object('key', 'meena', 'display_name', 'Meena'),
      jsonb_build_object('key', 'asha', 'display_name', 'Asha'),
      jsonb_build_object('key', 'kiran', 'display_name', 'Kiran'),
      jsonb_build_object('key', 'arjun', 'display_name', 'Arjun')),
    'spaces', jsonb_build_array(
      jsonb_build_object('target', jsonb_build_object('kind', 'new', 'name', '12 elm street', 'type', 'shared_home'), 'balances', jsonb_build_array(
        jsonb_build_object('person_key', 'divya', 'cents', -3000), jsonb_build_object('person_key', 'meena', 'cents', 149))),
      jsonb_build_object('target', jsonb_build_object('kind', 'new', 'name', 'Flat(301)', 'type', 'shared_home'), 'balances', jsonb_build_array(
        jsonb_build_object('person_key', 'ravi', 'cents', -39000))),
      jsonb_build_object('target', jsonb_build_object('kind', 'new', 'name', 'Lakeview', 'type', 'shared_home'), 'balances', jsonb_build_array(
        jsonb_build_object('person_key', 'asha', 'cents', -1540), jsonb_build_object('person_key', 'kiran', 'cents', 425))),
      jsonb_build_object('target', jsonb_build_object('kind', 'new', 'name', 'You & Arjun', 'type', 'group'), 'balances', jsonb_build_array(
        jsonb_build_object('person_key', 'arjun', 'cents', 1200))),
      jsonb_build_object('target', jsonb_build_object('kind', 'new', 'name', 'You & Ravi', 'type', 'group'), 'balances', jsonb_build_array(
        jsonb_build_object('person_key', 'ravi', 'cents', -1060)))))
$$;
grant execute on function pg_temp.plan to authenticated;

set role authenticated;
select pg_temp.as_user('20000000-0000-0000-0000-00000000000a');

-- validation
select pg_temp.expect_error($$select apply_splitwise_import(jsonb_set(pg_temp.plan(), '{spaces,0,balances,0,cents}', '0'), gen_random_uuid())$$, 'bad_amount');
select pg_temp.expect_error($$select apply_splitwise_import(jsonb_set(pg_temp.plan(), '{spaces,0,balances,0,person_key}', '"ghost"'), gen_random_uuid())$$, 'unknown_person');
select pg_temp.expect_error($$select apply_splitwise_import(jsonb_set(pg_temp.plan(), '{spaces,0,balances,1,person_key}', '"divya"'), gen_random_uuid())$$, 'duplicate_balance');
select pg_temp.expect_error($$select apply_splitwise_import(jsonb_set(pg_temp.plan(), '{spaces,0,balances}', '[]'), gen_random_uuid())$$, 'empty_space');
select pg_temp.expect_error($$select apply_splitwise_import(jsonb_set(pg_temp.plan(), '{spaces,0,target,kind}', '"weird"'), gen_random_uuid())$$, 'bad_target');
select pg_temp.expect_error($$select apply_splitwise_import(jsonb_set(pg_temp.plan(), '{spaces,0,balances,0,member_id}', to_jsonb(gen_random_uuid()::text)), gen_random_uuid())$$, 'bad_member');
do $$ begin
  assert (select count(*) from import_batches) = 0, 'failed imports roll back completely';
  assert (select count(*) from spaces) = 0;
  assert (select count(*) from import_people) = 0;
end $$;

-- apply
select pg_temp.put('req', gen_random_uuid()::text);
select pg_temp.put('res', apply_splitwise_import(pg_temp.plan(), pg_temp.get('req')::uuid)::text);
select pg_temp.put('batch', (pg_temp.get('res')::jsonb->>'batch_id'));
select pg_temp.put('sElm', (pg_temp.get('res')::jsonb->'space_ids'->>0));
select pg_temp.put('sFlat', (pg_temp.get('res')::jsonb->'space_ids'->>1));
select pg_temp.put('sLakeview', (pg_temp.get('res')::jsonb->'space_ids'->>2));
select pg_temp.put('sRavi', (pg_temp.get('res')::jsonb->'space_ids'->>4));
do $$ begin
  assert (select count(*) from spaces) = 5, 'five Spaces';
  assert (select array_agg(name order by name) from spaces) = array['12 elm street', 'Flat(301)', 'Lakeview', 'You & Arjun', 'You & Ravi'], 'Space names';
  assert (select type::text from spaces where name = 'You & Arjun') = 'group', 'pair Spaces are type Group';
  assert (select count(*) from import_people) = 6, 'six people, Ravi once';
  assert (select count(*) from space_members where user_id is null) = 7, 'Ravi has a placeholder in two Spaces';
  assert (select count(distinct person_id) from space_members where display_name = 'Ravi Kumar') = 1, 'both Ravi placeholders are one person';
  assert (select count(*) from bills where import_batch_id = pg_temp.get('batch')::uuid) = 7, 'one opening balance per line';
  assert (select bool_and(source::text = 'import' and due_date is null and title = 'Opening balance') from bills), 'labelled, no due date';
  -- only my own balances: every bill involves me
  assert (select bool_and(b.payer_member_id = my_member_id(b.space_id) or sp.member_id = my_member_id(b.space_id))
          from bills b join bill_splits sp on sp.bill_id = b.id), 'no balances between other people';
  -- idempotent retry
  assert (apply_splitwise_import(pg_temp.plan(), pg_temp.get('req')::uuid)->>'batch_id') = pg_temp.get('batch'), 'idempotent';
  assert (select count(*) from spaces) = 5 and (select count(*) from bills) = 7, 'no double count on retry';
end $$;

reset role;
do $$ begin
  -- directions and the overall total: you owe $428.26
  assert (select sum(member_net(id)) from space_members where user_id = '20000000-0000-0000-0000-00000000000a') = -42826, 'overall you owe 428.26';
  assert member_net((select id from space_members where space_id = pg_temp.get('sFlat')::uuid and display_name = 'Ravi Kumar')) = 39000, 'ravi is owed 390.00 in LM';
  assert member_net((select id from space_members where space_id = pg_temp.get('sElm')::uuid and display_name = 'Meena')) = -149, 'meena owes 1.49';
end $$;
set role authenticated;

-- reminders: never for opening balances
select pg_temp.expect_error($$select send_reminder((select sp.id from bill_splits sp join bills b on b.id = sp.bill_id
  where b.space_id = pg_temp.get('sElm')::uuid and b.payer_member_id = my_member_id(b.space_id)))$$, 'no_reminders_for_opening_balance');

-- ---------- outsider sees nothing ----------
select pg_temp.put('pRavi', (select person_id::text from space_members where space_id = pg_temp.get('sFlat')::uuid and display_name = 'Ravi Kumar'));
select pg_temp.put('pArjun', (select person_id::text from space_members where display_name = 'Arjun'));
select pg_temp.as_user('20000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($$select undo_import(pg_temp.get('batch')::uuid)$$, 'forbidden');
select pg_temp.expect_error($$select create_person_claim(pg_temp.get('pRavi')::uuid)$$, 'forbidden');
select pg_temp.expect_error($$select revoke_person_claims(pg_temp.get('pRavi')::uuid)$$, 'forbidden');
do $$ begin
  assert (select count(*) from import_batches) = 0, 'outsider sees no batches';
  assert (select count(*) from import_people) = 0, 'outsider sees no people';
  assert (select count(*) from space_members) = 0, 'outsider sees no placeholders';
  assert (select count(*) from bills) = 0, 'outsider sees no balances';
end $$;

-- ---------- one link per person, covering all their Spaces ----------
select pg_temp.as_user('20000000-0000-0000-0000-00000000000a');
select pg_temp.put('tokRavi', create_person_claim(pg_temp.get('pRavi')::uuid));
do $$ begin
  assert pg_temp.get('tokRavi') ~ '^[0-9a-f]{64}$', 'token is URL-safe hex';
  assert (select count(*) from person_claims where person_id = pg_temp.get('pRavi')::uuid) = 1, 'owner can read own claims';
end $$;

-- preview is service-role only; shows inviter, this person, and only their balances
select pg_temp.expect_error($$select * from preview_person_claim(pg_temp.get('tokRavi'), 'k')$$, 'permission denied');
reset role;
do $$ declare r record; begin
  select * into r from preview_person_claim(pg_temp.get('tokRavi'), 'client-1');
  assert r.valid and r.inviter_name = 'Vikas' and r.person_name = 'Ravi Kumar', 'preview names';
  assert r.spaces = '[{"name": "Flat(301)", "net_cents": 39000}, {"name": "You & Ravi", "net_cents": 1060}]'::jsonb, 'only Ravi''s own Spaces and balances: ' || r.spaces::text;
  select * into r from preview_person_claim('deadbeef', 'client-1');
  assert not r.valid and r.person_name is null and r.spaces is null, 'bad token reveals nothing';
end $$;
do $$ declare r record; i int; begin
  for i in 1..25 loop select * into r from preview_person_claim('nope', 'client-2'); end loop;
  assert r.rate_limited, 'preview rate limited';
end $$;
set role authenticated;

-- the inviter can't claim their own invite
select pg_temp.expect_error($$select claim_person(pg_temp.get('tokRavi'))$$, 'claim_own_invite');

-- Ravi claims: joins both Spaces at once; the inviter is notified
select pg_temp.as_user('20000000-0000-0000-0000-00000000000b');
select pg_temp.put('claimed', claim_person(pg_temp.get('tokRavi'))::text);
do $$ begin
  assert jsonb_array_length(pg_temp.get('claimed')::jsonb->'space_ids') = 2, 'joined two Spaces';
  assert (select count(*) from spaces) = 2, 'Ravi sees only Flat(301) and You & Ravi';
  assert (select count(*) from space_members where user_id = '20000000-0000-0000-0000-00000000000b' and claimed_at is not null) = 2;
  assert (select count(*) from user_notifications) = 0, 'Ravi sees no one else''s notifications';
end $$;
select pg_temp.as_user('20000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select claim_person(pg_temp.get('tokRavi'))$$, 'claim_invalid');  -- single use
reset role;
do $$ declare r record; begin
  select * into r from preview_person_claim(pg_temp.get('tokRavi'), 'client-3');
  assert not r.valid, 'used link no longer previews';
end $$;
set role authenticated;

select pg_temp.as_user('20000000-0000-0000-0000-00000000000a');
do $$ declare n user_notifications; begin
  select * into n from user_notifications;
  assert n.kind = 'person_claimed' and n.payload->>'name' = 'Ravi Kumar' and (n.payload->>'space_count')::int = 2 and n.read_at is null, 'inviter notified: ' || n.payload::text;
  perform pg_temp.put('note', n.id::text);
end $$;
select pg_temp.expect_error($$select create_person_claim(pg_temp.get('pRavi')::uuid)$$, 'not_a_placeholder');  -- already claimed
select pg_temp.as_user('20000000-0000-0000-0000-00000000000b');
select mark_notifications_read(array[pg_temp.get('note')::bigint]);  -- not theirs: no effect
select pg_temp.as_user('20000000-0000-0000-0000-00000000000a');
do $$ begin assert (select read_at from user_notifications where id = pg_temp.get('note')::bigint) is null, 'others can''t mark my notifications'; end $$;
select mark_notifications_read(array[pg_temp.get('note')::bigint]);
do $$ begin assert (select read_at from user_notifications where id = pg_temp.get('note')::bigint) is not null, 'marked read'; end $$;

-- revoked and expired links
select pg_temp.put('tokArjun', create_person_claim(pg_temp.get('pArjun')::uuid));
select revoke_person_claims(pg_temp.get('pArjun')::uuid);
select pg_temp.as_user('20000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select claim_person(pg_temp.get('tokArjun'))$$, 'claim_invalid');
select pg_temp.as_user('20000000-0000-0000-0000-00000000000a');
select pg_temp.put('tokArjun2', create_person_claim(pg_temp.get('pArjun')::uuid));
select pg_temp.put('tokArjun3', create_person_claim(pg_temp.get('pArjun')::uuid));  -- replaces the previous link
select pg_temp.as_user('20000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select claim_person(pg_temp.get('tokArjun2'))$$, 'claim_invalid');
reset role;
update person_claims set expires_at = now() - interval '1 minute' where token_hash = encode(extensions.digest(pg_temp.get('tokArjun3'), 'sha256'), 'hex');
set role authenticated;
select pg_temp.expect_error($$select claim_person(pg_temp.get('tokArjun3'))$$, 'claim_invalid');
do $$ begin assert (select count(*) from spaces) = 0, 'failed claims grant no access'; end $$;

-- ---------- double counting guard: a Space the claimer is already in is skipped ----------
select pg_temp.as_user('20000000-0000-0000-0000-00000000000a');
select pg_temp.put('res2', apply_splitwise_import(jsonb_build_object('image_count', 1,
  'people', jsonb_build_array(jsonb_build_object('key', 't', 'display_name', 'T. Prakash')),
  'spaces', jsonb_build_array(jsonb_build_object('target', jsonb_build_object('kind', 'existing', 'space_id', pg_temp.get('sFlat')),
    'balances', jsonb_build_array(jsonb_build_object('person_key', 't', 'cents', -500))))), gen_random_uuid())::text);
select pg_temp.put('pT2', (select person_id::text from space_members where display_name = 'T. Prakash'));
select pg_temp.put('tokT2', create_person_claim(pg_temp.get('pT2')::uuid));
select pg_temp.as_user('20000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select claim_person(pg_temp.get('tokT2'))$$, 'already_member');

-- attach to an existing member instead of creating a placeholder
select pg_temp.as_user('20000000-0000-0000-0000-00000000000a');
select pg_temp.put('mKiran', (select id::text from space_members where display_name = 'Kiran'));
select pg_temp.expect_error(format($$select apply_splitwise_import(jsonb_build_object('image_count', 1,
  'people', jsonb_build_array(jsonb_build_object('key', 'c', 'display_name', 'Kiran')),
  'spaces', jsonb_build_array(jsonb_build_object('target', jsonb_build_object('kind', 'existing', 'space_id', %L),
    'balances', jsonb_build_array(jsonb_build_object('person_key', 'c', 'cents', 100, 'member_id', %L))))), gen_random_uuid())$$,
  pg_temp.get('sLakeview'), my_member_id(pg_temp.get('sLakeview')::uuid)), 'participant_not_member');
select apply_splitwise_import(jsonb_build_object('image_count', 1,
  'people', jsonb_build_array(jsonb_build_object('key', 'c', 'display_name', 'Kiran')),
  'spaces', jsonb_build_array(jsonb_build_object('target', jsonb_build_object('kind', 'existing', 'space_id', pg_temp.get('sLakeview')),
    'balances', jsonb_build_array(jsonb_build_object('person_key', 'c', 'cents', 100, 'member_id', pg_temp.get('mKiran')))))), gen_random_uuid());
do $$ begin
  assert (select count(*) from space_members where display_name = 'Kiran') = 1, 'attached to existing member, no new placeholder';
  assert (select count(*) from import_people where display_name = 'Kiran') = 1, 'no new person';
end $$;

-- ---------- adding someone by name ----------
select pg_temp.put('added', add_placeholder_member(pg_temp.get('sLakeview')::uuid, '  Ravi  ')::text);
do $$ begin
  assert (select display_name from space_members where id = (pg_temp.get('added')::jsonb->>'member_id')::uuid) = 'Ravi', 'trimmed name';
  assert (select count(*) from import_people where id = (pg_temp.get('added')::jsonb->>'person_id')::uuid) = 1;
end $$;
select pg_temp.expect_error($$select add_placeholder_member(pg_temp.get('sLakeview')::uuid, '   ')$$, 'bad_person_name');
select pg_temp.put('tokRavi', create_person_claim((pg_temp.get('added')::jsonb->>'person_id')::uuid));
-- removing their last placeholder revokes the live link
select deactivate_member((pg_temp.get('added')::jsonb->>'member_id')::uuid);
do $$ begin
  assert (select count(*) from person_claims where person_id = (pg_temp.get('added')::jsonb->>'person_id')::uuid and revoked_at is null and used_at is null) = 0, 'link revoked';
end $$;
select pg_temp.as_user('20000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select add_placeholder_member(pg_temp.get('sFlat')::uuid, 'Someone')$$, 'forbidden');  -- members can't

-- ---------- undo ----------
select pg_temp.as_user('20000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$select undo_import(pg_temp.get('batch')::uuid)$$, 'placeholder_claimed');
select pg_temp.put('res3', apply_splitwise_import(jsonb_build_object('image_count', 1,
  'people', jsonb_build_array(jsonb_build_object('key', 'x', 'display_name', 'Xavier')),
  'spaces', jsonb_build_array(jsonb_build_object('target', jsonb_build_object('kind', 'new', 'name', 'Trip', 'type', 'group'),
    'balances', jsonb_build_array(jsonb_build_object('person_key', 'x', 'cents', 2500))))), gen_random_uuid())::text);
select create_person_claim((select person_id from space_members where display_name = 'Xavier'));
select undo_import((pg_temp.get('res3')::jsonb->>'batch_id')::uuid);
select undo_import((pg_temp.get('res3')::jsonb->>'batch_id')::uuid);  -- idempotent
do $$ begin
  assert (select count(*) from spaces where name = 'Trip') = 0, 'Space removed';
  assert (select count(*) from import_people where display_name = 'Xavier') = 0, 'person removed';
  assert (select count(*) from person_claims where person_id not in (select id from import_people)) = 0, 'claims removed';
end $$;

-- extraction rate limit: 10 per hour
select pg_temp.as_user('20000000-0000-0000-0000-00000000000c');
do $$ declare i int; begin for i in 1..10 loop perform begin_extraction(2); end loop; end $$;
select pg_temp.expect_error($$select begin_extraction(1)$$, 'rate_limited');

reset role;
\echo 'splitwise import tests: ok'
