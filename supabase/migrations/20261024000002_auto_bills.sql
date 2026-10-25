-- Auto Bills: statements arrive by upload (or forwarded email via a server webhook),
-- are parsed by app code, then wait for a person to confirm before any bill exists.

create type statement_source as enum ('upload', 'email');
create type statement_status as enum ('ready', 'needs_review', 'needs_statement', 'duplicate', 'failed', 'published', 'rejected');

create table statements (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces on delete cascade,
  source statement_source not null,
  file_path text,
  file_name text check (char_length(file_name) <= 200),
  sender text check (char_length(sender) <= 200),
  kind text not null default 'statement' check (kind in ('statement', 'notice_only', 'unreadable')),
  provider text,
  amount_cents bigint check (amount_cents >= 0),
  due_date date,
  period_start date,
  period_end date,
  account_last4 text check (account_last4 ~ '^\d{1,4}$'),
  statement_ref text,
  statement_key text,
  reasons text[] not null default '{}',
  parser_version text not null,
  status statement_status not null,
  revision_of uuid references statements,
  bill_id uuid references bills,
  created_by uuid references auth.users,
  received_at timestamptz not null default now(),
  decided_by uuid references auth.users,
  decided_at timestamptz
);
create index statements_space on statements (space_id, received_at desc);
create index statements_key on statements (space_id, statement_key);
alter table bills add constraint bills_statement_fk foreign key (statement_id) references statements;

alter table statements enable row level security;
create policy "members read statements" on statements for select using (was_space_member(space_id));
revoke insert, update, delete on statements from anon, authenticated;

create function _ingest_statement(
  p_space uuid, p_actor uuid, p_source statement_source, p_file_path text, p_file_name text, p_sender text,
  p_kind text, p_provider text, p_amount_cents bigint, p_due_date date, p_period_start date, p_period_end date,
  p_account_last4 text, p_statement_ref text, p_statement_key text, p_reasons text[], p_parser_version text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_prev statements; v_status statement_status; v_reasons text[] := coalesce(p_reasons, '{}'); v_rev uuid; v_id uuid;
begin
  if p_kind = 'unreadable' then
    v_status := 'failed';
  elsif p_kind = 'notice_only' then
    v_status := 'needs_statement';
  else
    if p_statement_key is not null then
      select * into v_prev from statements
       where space_id = p_space and statement_key = p_statement_key and status in ('published', 'ready', 'needs_review')
       order by received_at desc limit 1;
    end if;
    if v_prev.id is not null and v_prev.amount_cents is not distinct from p_amount_cents and v_prev.due_date is not distinct from p_due_date then
      v_status := 'duplicate'; v_rev := v_prev.id;
    elsif v_prev.id is not null then
      v_status := 'needs_review'; v_rev := v_prev.id;
      v_reasons := array_append(v_reasons, 'Revised statement: the amount or due date changed since the last copy');
    elsif array_length(v_reasons, 1) > 0 then
      v_status := 'needs_review';
    else
      v_status := 'ready';
    end if;
  end if;

  insert into statements (space_id, source, file_path, file_name, sender, kind, provider, amount_cents, due_date, period_start, period_end,
                          account_last4, statement_ref, statement_key, reasons, parser_version, status, revision_of, created_by)
  values (p_space, p_source, p_file_path, p_file_name, p_sender, p_kind, p_provider, p_amount_cents, p_due_date, p_period_start, p_period_end,
          p_account_last4, p_statement_ref, p_statement_key, v_reasons, p_parser_version, v_status, v_rev, p_actor)
  returning id into v_id;

  insert into activity (space_id, actor_user_id, entity_type, entity_id, action, metadata)
  values (p_space, p_actor, 'statement', v_id, 'statement_received', jsonb_build_object('provider', p_provider, 'status', v_status, 'source', p_source));
  return v_id;
end $$;
revoke execute on function _ingest_statement from public, anon, authenticated;

-- Called by the app after parsing an uploaded file
create function ingest_uploaded_statement(
  p_space uuid, p_file_path text, p_file_name text, p_kind text, p_provider text, p_amount_cents bigint, p_due_date date,
  p_period_start date, p_period_end date, p_account_last4 text, p_statement_ref text, p_statement_key text, p_reasons text[], p_parser_version text
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not is_space_member(p_space) then raise exception 'forbidden'; end if;
  return _ingest_statement(p_space, auth.uid(), 'upload', p_file_path, p_file_name, null, p_kind, p_provider, p_amount_cents, p_due_date,
    p_period_start, p_period_end, p_account_last4, p_statement_ref, p_statement_key, p_reasons, p_parser_version);
end $$;

-- Called only by the inbound-email webhook with the service role
create function ingest_emailed_statement(
  p_inbound_token text, p_sender text, p_file_path text, p_file_name text, p_kind text, p_provider text, p_amount_cents bigint, p_due_date date,
  p_period_start date, p_period_end date, p_account_last4 text, p_statement_ref text, p_statement_key text, p_reasons text[], p_parser_version text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_space uuid;
begin
  select id into v_space from spaces where inbound_token = p_inbound_token;
  if v_space is null then raise exception 'unknown_address'; end if;
  return _ingest_statement(v_space, null, 'email', p_file_path, p_file_name, p_sender, p_kind, p_provider, p_amount_cents, p_due_date,
    p_period_start, p_period_end, p_account_last4, p_statement_ref, p_statement_key, p_reasons, p_parser_version);
end $$;
revoke execute on function ingest_emailed_statement from public, anon, authenticated;
grant execute on function ingest_emailed_statement to service_role;

-- A person confirms the (possibly edited) details. Creates the bill, or applies a revision to the original bill.
create function publish_statement(
  p_statement uuid, p_title text, p_category text, p_amount_cents bigint, p_payer_member uuid, p_due_date date,
  p_period_start date, p_period_end date, p_split_method split_method, p_shares jsonb, p_client_request_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare st statements; v_bill uuid; v_orig bills;
begin
  select * into st from statements where id = p_statement for update;
  if st.id is null or not is_space_member(st.space_id) then raise exception 'forbidden'; end if;
  if st.status = 'published' then return st.bill_id; end if;
  if st.status not in ('ready', 'needs_review', 'needs_statement') then raise exception 'not_publishable'; end if;
  if p_due_date is null then raise exception 'due_date_required'; end if;

  if st.revision_of is not null then
    select b.* into v_orig from bills b join statements s on s.bill_id = b.id where s.id = st.revision_of and b.status = 'published';
  end if;

  if v_orig.id is not null then
    -- update_bill enforces payer/owner, stale versions and the no-settlements rule for amount changes
    perform update_bill(v_orig.id, v_orig.version, p_title, p_category, p_due_date,
      coalesce(v_orig.note, '') , p_amount_cents, p_split_method, p_shares);
    update bills set statement_id = st.id, period_start = p_period_start, period_end = p_period_end where id = v_orig.id;
    v_bill := v_orig.id;
  else
    v_bill := create_bill(st.space_id, p_title, p_category, p_amount_cents, p_payer_member, current_date, p_due_date, null,
      p_split_method, p_shares, p_client_request_id, p_period_start, p_period_end,
      case st.source when 'email' then 'email'::bill_source else 'upload'::bill_source end, st.id);
  end if;

  update statements set status = 'published', bill_id = v_bill, decided_by = auth.uid(), decided_at = now(),
    amount_cents = p_amount_cents, due_date = p_due_date where id = p_statement;
  perform log_activity(st.space_id, 'statement', st.id, 'statement_published', jsonb_build_object('bill_id', v_bill, 'provider', st.provider));
  return v_bill;
end $$;

create function reject_statement(p_statement uuid) returns void
language plpgsql security definer set search_path = public as $$
declare st statements;
begin
  select * into st from statements where id = p_statement for update;
  if st.id is null or not is_space_member(st.space_id) then raise exception 'forbidden'; end if;
  if st.status = 'published' then raise exception 'already_published'; end if;
  update statements set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = p_statement;
  perform log_activity(st.space_id, 'statement', st.id, 'statement_dismissed', jsonb_build_object('provider', st.provider));
end $$;

revoke execute on function ingest_uploaded_statement, publish_statement, reject_statement from anon;

-- Private storage for original statements: <space_id>/<uuid>.pdf, members only.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('statements', 'statements', false, 10485760, array['application/pdf'])
    on conflict (id) do nothing;
    execute $p$create policy "members read statements files" on storage.objects for select to authenticated
      using (bucket_id = 'statements' and public.was_space_member((storage.foldername(name))[1]::uuid))$p$;
    execute $p$create policy "members upload statements files" on storage.objects for insert to authenticated
      with check (bucket_id = 'statements' and public.is_space_member((storage.foldername(name))[1]::uuid))$p$;
  end if;
end $$;
