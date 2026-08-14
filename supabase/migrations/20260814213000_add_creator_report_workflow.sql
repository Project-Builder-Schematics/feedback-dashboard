alter table public.reports
  add column if not exists discard_reason text;

create or replace function public.set_report_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists maintain_reports_updated_at on public.reports;
create trigger maintain_reports_updated_at
before update on public.reports
for each row execute function public.set_report_updated_at();

create table if not exists public.report_status_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  report_id uuid not null references public.reports(id),
  old_status text not null,
  new_status text not null,
  reason text,
  request_id uuid not null unique,
  created_at timestamptz not null default now()
);

alter table public.report_status_events enable row level security;

revoke all on table public.report_status_events from public, anon, authenticated;
grant select, insert on table public.report_status_events to service_role;

create or replace function public.reject_report_status_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'report status events are immutable';
end;
$$;

drop trigger if exists prevent_report_status_event_changes on public.report_status_events;
create trigger prevent_report_status_event_changes
before update or delete on public.report_status_events
for each row execute function public.reject_report_status_event_change();

create or replace function public.update_report_status(
  p_report_id uuid,
  p_new_status text,
  p_discard_reason text,
  p_actor_id uuid,
  p_request_id uuid
)
returns setof public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_report public.reports%rowtype;
  normalized_reason text;
  previous_status text;
begin
  if p_new_status not in ('Pending', 'Validating', 'In construction', 'Resolved', 'Discarded') then
    raise exception 'invalid report status';
  end if;

  normalized_reason := case
    when p_new_status = 'Discarded' then nullif(btrim(p_discard_reason), '')
    else null
  end;

  if p_new_status = 'Discarded' and normalized_reason is null then
    raise exception 'discard reason is required';
  end if;

  select *
  into current_report
  from public.reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'report not found' using errcode = 'P0002';
  end if;

  previous_status := current_report.status;

  update public.reports
  set status = p_new_status,
      discard_reason = normalized_reason
  where id = p_report_id
  returning * into current_report;

  insert into public.report_status_events (
    actor_id,
    report_id,
    old_status,
    new_status,
    reason,
    request_id
  ) values (
    p_actor_id,
    p_report_id,
    previous_status,
    p_new_status,
    normalized_reason,
    p_request_id
  );

  return next current_report;
end;
$$;

revoke all on function public.update_report_status(uuid, text, text, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.update_report_status(uuid, text, text, uuid, uuid)
to service_role;
