insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'report-attachments',
  'report-attachments',
  false,
  52428800,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.report_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  reporter_user_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '2 hours')
);

create table if not exists public.report_attachments (
  id uuid primary key,
  report_id uuid not null references public.reports(id) on delete cascade,
  upload_session_id uuid not null references public.report_upload_sessions(id) on delete cascade,
  object_path text not null unique check (object_path ~ '^reports/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  original_file_name text not null check (
    char_length(original_file_name) between 1 and 255
    and original_file_name !~ '[[:cntrl:]/\\]'
  ),
  content_type text not null check (content_type in (
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  )),
  size_bytes bigint not null check (
    (content_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
      and size_bytes between 1 and 10485760)
    or
    (content_type in ('video/mp4', 'video/webm', 'video/quicktime')
      and size_bytes between 1 and 52428800)
  ),
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  check ((status = 'ready') = (uploaded_at is not null))
);

create index if not exists report_upload_sessions_reporter_idx
on public.report_upload_sessions (reporter_user_id, expires_at desc);

create index if not exists report_attachments_report_idx
on public.report_attachments (report_id, created_at);

alter table public.report_upload_sessions enable row level security;
alter table public.report_attachments enable row level security;

revoke all on table public.report_upload_sessions from public, anon, authenticated;
revoke all on table public.report_attachments from public, anon, authenticated;
grant all on table public.report_upload_sessions to service_role;
grant all on table public.report_attachments to service_role;

create or replace function public.create_report_upload_session(
  p_report_public_number bigint,
  p_reporter_user_id uuid,
  p_token_hash_hex text,
  p_expires_at timestamptz
)
returns table (report_public_id text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_report public.reports%rowtype;
  created_session public.report_upload_sessions%rowtype;
begin
  if p_token_hash_hex is null or p_token_hash_hex !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid upload token hash';
  end if;
  if p_reporter_user_id is null or not (
    p_expires_at > clock_timestamp()
    and p_expires_at <= clock_timestamp() + interval '2 hours'
  ) then
    raise exception 'invalid upload session';
  end if;

  select report.*
  into matched_report
  from public.reports as report
  where report.public_number = p_report_public_number
    and report.reporter_user_id = p_reporter_user_id;

  if not found then
    raise exception 'report is unavailable';
  end if;

  insert into public.report_upload_sessions (
    report_id,
    reporter_user_id,
    token_hash,
    expires_at
  ) values (
    matched_report.id,
    p_reporter_user_id,
    decode(p_token_hash_hex, 'hex'),
    p_expires_at
  )
  returning * into created_session;

  report_public_id := 'PB-' || matched_report.public_number::text;
  expires_at := created_session.expires_at;
  return next;
end;
$$;

create or replace function public.prepare_report_attachment(
  p_token_hash_hex text,
  p_file_name text,
  p_content_type text,
  p_size_bytes bigint
)
returns table (
  attachment_id uuid,
  report_public_id text,
  object_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload_session public.report_upload_sessions%rowtype;
  public_number bigint;
  new_attachment_id uuid := gen_random_uuid();
  new_object_path text;
begin
  if p_token_hash_hex is null or p_token_hash_hex !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid upload token hash';
  end if;
  if nullif(btrim(p_file_name), '') is null
    or char_length(p_file_name) > 255
    or p_file_name ~ '[[:cntrl:]/\\]'
    or not (
      (p_content_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
        and p_size_bytes between 1 and 10485760)
      or
      (p_content_type in ('video/mp4', 'video/webm', 'video/quicktime')
        and p_size_bytes between 1 and 52428800)
    )
  then
    raise exception 'invalid attachment metadata';
  end if;

  select session.*
  into upload_session
  from public.report_upload_sessions as session
  where session.token_hash = decode(p_token_hash_hex, 'hex')
  for update;

  if not found
    or upload_session.revoked_at is not null
    or upload_session.expires_at <= clock_timestamp()
  then
    raise exception 'upload session is unavailable';
  end if;

  select report.public_number
  into public_number
  from public.reports as report
  where report.id = upload_session.report_id
  for update;

  if not found then
    raise exception 'report is unavailable';
  end if;

  if not (
    (select count(*)
     from public.report_attachments as attachment
     join public.report_upload_sessions as counted_session
       on counted_session.id = attachment.upload_session_id
     where attachment.report_id = upload_session.report_id
       and (
         attachment.status = 'ready'
         or (
           attachment.status = 'pending'
           and counted_session.revoked_at is null
           and counted_session.expires_at > clock_timestamp()
         )
       )) < 5
  ) then
    raise exception 'attachment limit reached';
  end if;

  new_object_path := 'reports/' || upload_session.report_id::text || '/' || new_attachment_id::text;
  insert into public.report_attachments (
    id,
    report_id,
    upload_session_id,
    object_path,
    original_file_name,
    content_type,
    size_bytes
  ) values (
    new_attachment_id,
    upload_session.report_id,
    upload_session.id,
    new_object_path,
    btrim(p_file_name),
    p_content_type,
    p_size_bytes
  );

  attachment_id := new_attachment_id;
  report_public_id := 'PB-' || public_number::text;
  object_path := new_object_path;
  return next;
end;
$$;

create or replace function public.get_pending_report_attachment(
  p_token_hash_hex text,
  p_attachment_id uuid
)
returns table (object_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token_hash_hex is null or p_token_hash_hex !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid upload token hash';
  end if;

  return query
  select attachment.object_path
  from public.report_attachments as attachment
  join public.report_upload_sessions as session
    on session.id = attachment.upload_session_id
  where attachment.id = p_attachment_id
    and attachment.status = 'pending'
    and session.token_hash = decode(p_token_hash_hex, 'hex')
    and session.revoked_at is null
    and session.expires_at > clock_timestamp();
end;
$$;

create or replace function public.complete_report_attachment(
  p_token_hash_hex text,
  p_attachment_id uuid,
  p_size_bytes bigint,
  p_content_type text
)
returns table (report_public_id text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_attachment public.report_attachments%rowtype;
  upload_session public.report_upload_sessions%rowtype;
  public_number bigint;
begin
  if p_token_hash_hex is null or p_token_hash_hex !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid upload token hash';
  end if;

  select attachment.*
  into matched_attachment
  from public.report_attachments as attachment
  where attachment.id = p_attachment_id
  for update;

  if not found then
    raise exception 'attachment is unavailable';
  end if;

  select session.*
  into upload_session
  from public.report_upload_sessions as session
  where session.id = matched_attachment.upload_session_id
    and session.token_hash = decode(p_token_hash_hex, 'hex')
    and session.revoked_at is null
    and session.expires_at > clock_timestamp()
  for update;

  if not found or matched_attachment.status <> 'pending' then
    raise exception 'attachment is unavailable';
  end if;

  select report.public_number
  into public_number
  from public.reports as report
  where report.id = matched_attachment.report_id;

  if matched_attachment.size_bytes = p_size_bytes
    and matched_attachment.content_type = p_content_type
  then
    update public.report_attachments
    set status = 'ready', uploaded_at = clock_timestamp()
    where id = matched_attachment.id;
    status := 'ready';
  else
    update public.report_attachments
    set status = 'failed'
    where id = matched_attachment.id;
    status := 'failed';
  end if;

  report_public_id := 'PB-' || public_number::text;
  return next;
end;
$$;

create or replace function public.fail_report_attachment(
  p_token_hash_hex text,
  p_attachment_id uuid
)
returns table (status text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token_hash_hex is null or p_token_hash_hex !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid upload token hash';
  end if;

  update public.report_attachments as attachment
  set status = 'failed'
  from public.report_upload_sessions as session
  where attachment.id = p_attachment_id
    and attachment.status = 'pending'
    and session.id = attachment.upload_session_id
    and session.token_hash = decode(p_token_hash_hex, 'hex')
    and session.revoked_at is null
    and session.expires_at > clock_timestamp();

  if not found then
    raise exception 'attachment is unavailable';
  end if;

  status := 'failed';
  return next;
end;
$$;

revoke all on function public.create_report_upload_session(bigint, uuid, text, timestamptz)
from public, anon, authenticated;
revoke all on function public.prepare_report_attachment(text, text, text, bigint)
from public, anon, authenticated;
revoke all on function public.get_pending_report_attachment(text, uuid)
from public, anon, authenticated;
revoke all on function public.complete_report_attachment(text, uuid, bigint, text)
from public, anon, authenticated;
revoke all on function public.fail_report_attachment(text, uuid)
from public, anon, authenticated;

grant execute on function public.create_report_upload_session(bigint, uuid, text, timestamptz)
to service_role;
grant execute on function public.prepare_report_attachment(text, text, text, bigint)
to service_role;
grant execute on function public.get_pending_report_attachment(text, uuid)
to service_role;
grant execute on function public.complete_report_attachment(text, uuid, bigint, text)
to service_role;
grant execute on function public.fail_report_attachment(text, uuid)
to service_role;
