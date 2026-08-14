create table if not exists public.rate_limit_buckets (
  bucket_hash text primary key check (bucket_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null
);

alter table public.rate_limit_buckets enable row level security;

revoke all on table public.rate_limit_buckets from public, anon, authenticated;
grant all on table public.rate_limit_buckets to service_role;

create or replace function public.consume_rate_limit(
  p_bucket_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  bucket public.rate_limit_buckets%rowtype;
  consumed_at timestamptz := clock_timestamp();
begin
  if p_bucket_hash is null or p_bucket_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid bucket hash';
  end if;
  if p_limit not between 1 and 10000 then
    raise exception 'invalid rate limit';
  end if;
  if p_window_seconds not between 1 and 86400 then
    raise exception 'invalid rate-limit window';
  end if;

  insert into public.rate_limit_buckets as buckets (
    bucket_hash,
    window_started_at,
    request_count,
    updated_at
  ) values (
    p_bucket_hash,
    consumed_at,
    1,
    consumed_at
  )
  on conflict (bucket_hash) do update
  set window_started_at = case
        when buckets.window_started_at
          + make_interval(secs => p_window_seconds) <= consumed_at
          then consumed_at
        else buckets.window_started_at
      end,
      request_count = case
        when buckets.window_started_at
          + make_interval(secs => p_window_seconds) <= consumed_at
          then 1
        else least(buckets.request_count + 1, p_limit + 1)
      end,
      updated_at = consumed_at
  returning * into bucket;

  allowed := bucket.request_count <= p_limit;
  retry_after_seconds := case
    when allowed then 0
    else greatest(
      1,
      ceil(extract(epoch from (
        bucket.window_started_at + make_interval(secs => p_window_seconds) - consumed_at
      )))::integer
    )
  end;
  return next;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer)
from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer)
to service_role;
