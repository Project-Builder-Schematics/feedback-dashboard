alter table public.beta_profiles alter column invitation_id drop not null;

create table public.beta_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  provider_id text not null unique,
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.beta_applications enable row level security;
revoke all on table public.beta_applications from public, anon, authenticated;
grant all on table public.beta_applications to service_role;

create or replace function public.submit_beta_application(p_user_id uuid, p_provider_id text, p_email text)
returns public.beta_applications language plpgsql security definer set search_path = '' as $$
declare application public.beta_applications;
begin
  insert into public.beta_applications (user_id, provider_id, email)
  values (p_user_id, btrim(p_provider_id), lower(btrim(p_email)))
  on conflict (user_id) do update set email = excluded.email
  returning * into application;
  return application;
end;
$$;

create or replace function public.approve_beta_application(p_application_id uuid, p_actor_id uuid)
returns table (id uuid, email text, notification_required boolean) language plpgsql security definer set search_path = '' as $$
declare application public.beta_applications;
begin
  select * into application from public.beta_applications where beta_applications.id = p_application_id for update;
  if not found then raise exception 'application not found'; end if;
  if application.status = 'pending' then
    update public.beta_applications set status = 'approved', reviewed_by = p_actor_id, reviewed_at = clock_timestamp() where beta_applications.id = p_application_id;
    insert into public.beta_profiles (user_id, provider, provider_id, status)
    values (application.user_id, 'github', application.provider_id, 'active')
    on conflict (user_id) do update set status = 'active', updated_at = clock_timestamp();
  end if;
  id := application.id; email := application.email; notification_required := application.notified_at is null; return next;
end;
$$;

revoke all on function public.submit_beta_application(uuid, text, text) from public, anon, authenticated;
revoke all on function public.approve_beta_application(uuid, uuid) from public, anon, authenticated;
grant execute on function public.submit_beta_application(uuid, text, text) to service_role;
grant execute on function public.approve_beta_application(uuid, uuid) to service_role;
