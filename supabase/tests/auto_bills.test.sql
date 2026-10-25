-- Auto Bills: dedupe, revisions, notice-only emails, publish/reject permissions.
set client_min_messages = warning;

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-00000000000a', 'owner@example.com', '{"display_name":"Ana"}'),
  ('10000000-0000-0000-0000-00000000000e', 'eve@example.com', '{"display_name":"Eve"}');

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false); $$;
create function pg_temp.expect_error(p_sql text, p_frag text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED ERROR "%" BUT SUCCEEDED: %', p_frag, p_sql;
exception when others then
  if sqlerrm like 'EXPECTED ERROR%' then raise; end if;
  if position(p_frag in sqlerrm) = 0 then raise exception 'expected "%" got "%"', p_frag, sqlerrm; end if;
end $$;
create table pg_temp.ctx (k text primary key, v text);
grant all on pg_temp.ctx to authenticated;
create function pg_temp.get(k text) returns text language sql as $$ select v from pg_temp.ctx where ctx.k = get.k $$;
create function pg_temp.put(k text, v text) returns void language sql as $$ insert into pg_temp.ctx values (k, v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ingest(amount bigint, due date) returns uuid language sql as $$
  select ingest_uploaded_statement(pg_temp.get('s')::uuid, null, 'comed.pdf', 'statement', 'ComEd', amount, due,
    '2026-09-18', '2026-10-17', '7890', 'ST-1', 'ComEd|7890|2026-09-18|2026-10-17', '{}', 'rules-1') $$;
grant execute on all functions in schema pg_temp to authenticated;

set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-00000000000a');
select pg_temp.put('s', create_space('Elm St', 'shared_home')::text);
select pg_temp.put('m', my_member_id(pg_temp.get('s')::uuid)::text);

-- clean statement is "ready", not published
select pg_temp.put('st1', pg_temp.ingest(18440, '2026-10-29')::text);
do $$ begin
  assert (select status from statements where id = pg_temp.get('st1')::uuid) = 'ready';
  assert (select count(*) from bills) = 0, 'nothing published without confirmation';
end $$;

-- same statement again while pending: duplicate
select pg_temp.put('dup', pg_temp.ingest(18440, '2026-10-29')::text);
do $$ begin assert (select status from statements where id = pg_temp.get('dup')::uuid) = 'duplicate'; end $$;

-- publish requires a due date
select pg_temp.expect_error($$select publish_statement(pg_temp.get('st1')::uuid, 'Electricity · ComEd', 'electricity', 18440, pg_temp.get('m')::uuid, null,
  '2026-09-18', '2026-10-17', 'equal', jsonb_build_array(jsonb_build_object('member_id', pg_temp.get('m'), 'amount_cents', 18440)), gen_random_uuid())$$, 'due_date_required');
select pg_temp.put('bill', publish_statement(pg_temp.get('st1')::uuid, 'Electricity · ComEd', 'electricity', 18440, pg_temp.get('m')::uuid, '2026-10-29',
  '2026-09-18', '2026-10-17', 'equal', jsonb_build_array(jsonb_build_object('member_id', pg_temp.get('m'), 'amount_cents', 18440)), gen_random_uuid())::text);
do $$ begin
  assert (select source from bills where id = pg_temp.get('bill')::uuid) = 'upload';
  assert (select status from statements where id = pg_temp.get('st1')::uuid) = 'published';
end $$;

-- same statement after publishing: duplicate, never a second charge
select pg_temp.put('dup2', pg_temp.ingest(18440, '2026-10-29')::text);
do $$ begin assert (select status from statements where id = pg_temp.get('dup2')::uuid) = 'duplicate'; end $$;
select pg_temp.expect_error($$select publish_statement(pg_temp.get('dup2')::uuid, 'x', 'electricity', 18440, pg_temp.get('m')::uuid, '2026-10-29', null, null, 'equal', '[]', gen_random_uuid())$$, 'not_publishable');

-- revised amount: review, then publishing updates the original bill instead of adding one
select pg_temp.put('rev', pg_temp.ingest(19010, '2026-10-31')::text);
do $$ begin
  assert (select status from statements where id = pg_temp.get('rev')::uuid) = 'needs_review';
  assert (select revision_of from statements where id = pg_temp.get('rev')::uuid) = pg_temp.get('st1')::uuid;
end $$;
select publish_statement(pg_temp.get('rev')::uuid, 'Electricity · ComEd', 'electricity', 19010, pg_temp.get('m')::uuid, '2026-10-31',
  '2026-09-18', '2026-10-17', 'equal', jsonb_build_array(jsonb_build_object('member_id', pg_temp.get('m'), 'amount_cents', 19010)), gen_random_uuid());
do $$ begin
  assert (select count(*) from bills) = 1, 'still one bill';
  assert (select amount_cents from bills) = 19010, 'revised amount applied';
  assert (select sum(amount_cents) from bill_splits) = 19010, 'splits reconcile';
end $$;

-- "your bill is ready" email: needs statement, no amount
select pg_temp.put('notice', ingest_uploaded_statement(pg_temp.get('s')::uuid, null, 'email.txt', 'notice_only', 'ComEd', null, null,
  null, null, null, null, null, '{"Amount due not found"}', 'rules-1')::text);
do $$ begin assert (select status from statements where id = pg_temp.get('notice')::uuid) = 'needs_statement'; end $$;

-- outsiders can neither ingest nor see nor publish
select pg_temp.as_user('10000000-0000-0000-0000-00000000000e');
select pg_temp.expect_error($$select pg_temp.ingest(100, '2026-10-29')$$, 'forbidden');
select pg_temp.expect_error($$select reject_statement(pg_temp.get('notice')::uuid)$$, 'forbidden');
do $$ begin assert (select count(*) from statements) = 0; end $$;
-- the email webhook entry point is not callable by users
select pg_temp.expect_error($$select ingest_emailed_statement('x', null, null, null, 'statement', null, null, null, null, null, null, null, null, '{}', 'r')$$, 'permission denied');

select pg_temp.as_user('10000000-0000-0000-0000-00000000000a');
select reject_statement(pg_temp.get('notice')::uuid);

reset role;
\echo 'auto bills tests: ok'
