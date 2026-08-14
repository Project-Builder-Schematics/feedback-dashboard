create table if not exists public.beta_invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_by uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '7 days'),
  check (consumed_at is null or consumed_by is not null),
  check (revoked_at is null or revoked_by is not null)
);

create table if not exists public.beta_profiles (
  user_id uuid not null,
  provider text not null check (provider = 'github'),
  provider_id text not null check (btrim(provider_id) <> ''),
  invitation_id uuid not null unique references public.beta_invitations(id),
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id),
  unique (provider, provider_id)
);

create table if not exists public.beta_membership_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'invitation_created',
    'invitation_redeemed',
    'invitation_rejected',
    'invitation_revoked',
    'profile_suspended',
    'profile_reactivated',
    'profile_revoked'
  )),
  invitation_id uuid references public.beta_invitations(id),
  actor_user_id uuid not null,
  subject_user_id uuid,
  provider text,
  provider_id text,
  request_id uuid not null unique,
  created_at timestamptz not null default now()
);

alter table public.beta_invitations enable row level security;
alter table public.beta_profiles enable row level security;
alter table public.beta_membership_events enable row level security;

revoke all on table public.beta_invitations from public, anon, authenticated;
revoke all on table public.beta_profiles from public, anon, authenticated;
revoke all on table public.beta_membership_events from public, anon, authenticated;
grant all on table public.beta_invitations to service_role;
grant all on table public.beta_profiles to service_role;
grant select, insert on table public.beta_membership_events to service_role;

create or replace function public.reject_beta_membership_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'beta membership events are immutable';
end;
$$;

drop trigger if exists prevent_beta_membership_event_changes on public.beta_membership_events;
create trigger prevent_beta_membership_event_changes
before update or delete on public.beta_membership_events
for each row execute function public.reject_beta_membership_event_change();

create or replace function public.create_beta_invitation(
  p_token_hash_hex text,
  p_created_by uuid,
  p_expires_at timestamptz,
  p_request_id uuid
)
returns table (invitation_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_invitation public.beta_invitations%rowtype;
begin
  if p_token_hash_hex is null or p_token_hash_hex !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid invitation hash';
  end if;
  if not (
    p_expires_at > clock_timestamp()
    and p_expires_at <= clock_timestamp() + interval '7 days'
  ) then
    raise exception 'invalid invitation expiry';
  end if;

  insert into public.beta_invitations (token_hash, created_by, expires_at)
  values (decode(p_token_hash_hex, 'hex'), p_created_by, p_expires_at)
  returning * into created_invitation;

  insert into public.beta_membership_events (
    event_type,
    invitation_id,
    actor_user_id,
    request_id
  ) values (
    'invitation_created',
    created_invitation.id,
    p_created_by,
    p_request_id
  );

  invitation_id := created_invitation.id;
  expires_at := created_invitation.expires_at;
  return next;
end;
$$;

create or replace function public.redeem_beta_invitation(
  p_token_hash_hex text,
  p_user_id uuid,
  p_provider text,
  p_provider_id text,
  p_request_id uuid
)
returns table (redeemed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.beta_invitations%rowtype;
  profile public.beta_profiles%rowtype;
  invitation_found boolean := false;
begin
  if p_token_hash_hex is null or p_token_hash_hex !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid invitation hash';
  end if;
  if p_provider <> 'github' or nullif(btrim(p_provider_id), '') is null then
    raise exception 'invalid provider identity';
  end if;

  select *
  into invitation
  from public.beta_invitations
  where token_hash = decode(p_token_hash_hex, 'hex')
  for update;
  invitation_found := found;

  if invitation_found and invitation.consumed_at is not null then
    select *
    into profile
    from public.beta_profiles
    where user_id = p_user_id
      and provider = p_provider
      and provider_id = btrim(p_provider_id)
      and invitation_id = invitation.id
      and status = 'active';
    if found then
      redeemed := true;
      return next;
      return;
    end if;
  elsif invitation_found
    and invitation.revoked_at is null
    and invitation.expires_at > clock_timestamp()
  then
    insert into public.beta_profiles (
      user_id,
      provider,
      provider_id,
      invitation_id,
      status
    ) values (
      p_user_id,
      p_provider,
      btrim(p_provider_id),
      invitation.id,
      'active'
    )
    on conflict do nothing
    returning * into profile;

    if found then
      update public.beta_invitations
      set consumed_at = clock_timestamp(),
          consumed_by = p_user_id
      where id = invitation.id;

      insert into public.beta_membership_events (
        event_type,
        invitation_id,
        actor_user_id,
        subject_user_id,
        provider,
        provider_id,
        request_id
      ) values (
        'invitation_redeemed',
        invitation.id,
        p_user_id,
        p_user_id,
        p_provider,
        btrim(p_provider_id),
        p_request_id
      );

      redeemed := true;
      return next;
      return;
    end if;
  end if;

  insert into public.beta_membership_events (
    event_type,
    invitation_id,
    actor_user_id,
    subject_user_id,
    provider,
    provider_id,
    request_id
  ) values (
    'invitation_rejected',
    case when invitation_found then invitation.id else null end,
    p_user_id,
    p_user_id,
    p_provider,
    btrim(p_provider_id),
    p_request_id
  );

  redeemed := false;
  return next;
end;
$$;

revoke all on function public.create_beta_invitation(text, uuid, timestamptz, uuid)
from public, anon, authenticated;
grant execute on function public.create_beta_invitation(text, uuid, timestamptz, uuid)
to service_role;

revoke all on function public.redeem_beta_invitation(text, uuid, text, text, uuid)
from public, anon, authenticated;
grant execute on function public.redeem_beta_invitation(text, uuid, text, text, uuid)
to service_role;
