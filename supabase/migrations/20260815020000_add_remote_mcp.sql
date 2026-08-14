alter table public.reports
  alter column reporter_email drop not null,
  add column if not exists reporter_user_id uuid,
  add column if not exists reporter_provider text,
  add column if not exists reporter_provider_id text;

alter table public.reports
  add constraint reports_reporter_provenance_check
  check (
    (
      reporter_user_id is null
      and reporter_provider is null
      and reporter_provider_id is null
    )
    or
    (
      reporter_user_id is not null
      and reporter_provider = 'github'
      and nullif(btrim(reporter_provider_id), '') is not null
    )
  );

create index if not exists reports_reporter_user_id_idx
on public.reports (reporter_user_id)
where reporter_user_id is not null;

create or replace function public.project_builder_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb := event->'claims';
begin
  if nullif(claims->>'client_id', '') is not null then
    claims := jsonb_set(
      claims,
      '{aud}',
      to_jsonb('https://bbivrybsyxpmkstomccd.supabase.co/functions/v1/project-builder-mcp'::text)
    );
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

revoke all on function public.project_builder_access_token_hook(jsonb)
from public, anon, authenticated;
grant execute on function public.project_builder_access_token_hook(jsonb)
to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
