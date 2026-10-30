alter table public.auto_backup_plans
  add column first_token_timeout_ms integer not null default 15000
    constraint auto_backup_plans_first_token_timeout_check
    check (first_token_timeout_ms between 1000 and 120000);

alter table public.request_logs
  drop constraint if exists request_logs_source_check;

alter table public.request_logs
  add constraint request_logs_source_check
    check (source in ('single', 'auto', 'route', 'gateway')) not valid;

alter table public.request_logs
  validate constraint request_logs_source_check;

alter table public.daily_stats
  add column gateway_requests integer not null default 0
    constraint daily_stats_gateway_requests_check check (gateway_requests >= 0);

alter table public.provider_keys
  add constraint provider_keys_id_user_id_unique unique (id, user_id);

create table public.gateway_provider_keys (
  id uuid primary key default gen_random_uuid(),
  provider_key_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in (
    'openai', 'openrouter', 'groq', 'huggingface', 'together',
    'mistral', 'deepseek', 'anthropic', 'gemini'
  )),
  label text not null,
  ciphertext text not null,
  iv text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gateway_provider_keys_user_source_unique unique (provider_key_id, user_id),
  constraint gateway_provider_keys_source_owner_fk
    foreign key (provider_key_id, user_id)
    references public.provider_keys (id, user_id)
    on delete cascade
);

alter table public.gateway_provider_keys enable row level security;
revoke all on public.gateway_provider_keys from anon, authenticated;
grant all on public.gateway_provider_keys to service_role;

create table public.gateway_router_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),
  requests_per_minute integer not null default 30
    check (requests_per_minute between 1 and 60),
  requests_per_day integer not null default 1000
    check (requests_per_day between 1 and 10000),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index gateway_router_keys_user_created_idx
  on public.gateway_router_keys (user_id, created_at desc);

alter table public.gateway_router_keys enable row level security;
create policy "Users can read their own gateway router keys"
  on public.gateway_router_keys for select
  using (auth.uid() = user_id);
revoke insert, update, delete on public.gateway_router_keys from anon, authenticated;
grant select on public.gateway_router_keys to authenticated;

create table public.gateway_router_key_hashes (
  router_key_id uuid primary key
    references public.gateway_router_keys (id) on delete cascade,
  key_hash text not null unique
    check (key_hash ~ '^[0-9a-f]{64}$')
);

alter table public.gateway_router_key_hashes enable row level security;
revoke all on public.gateway_router_key_hashes from anon, authenticated;
grant all on public.gateway_router_key_hashes to service_role;

create table public.gateway_key_usage (
  router_key_id uuid not null
    references public.gateway_router_keys (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  period text not null check (period in ('minute', 'day')),
  period_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (router_key_id, period, period_start)
);

create index gateway_key_usage_user_period_idx
  on public.gateway_key_usage (user_id, period, period_start desc);

alter table public.gateway_key_usage enable row level security;
create policy "Users can read their own gateway key usage"
  on public.gateway_key_usage for select
  using (auth.uid() = user_id);
revoke insert, update, delete on public.gateway_key_usage from anon, authenticated;
grant select on public.gateway_key_usage to authenticated;
grant all on public.gateway_key_usage to service_role;

create or replace function public.create_my_gateway_router_key(
  p_key_hash text,
  p_label text,
  p_requests_per_minute integer default 30,
  p_requests_per_day integer default 1000
)
returns table (id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
  new_key_id uuid;
  new_created_at timestamptz;
begin
  if caller_id is null then
    raise exception 'Sign in to create a gateway key.';
  end if;
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'The gateway key is invalid.';
  end if;
  if p_label is null or char_length(trim(p_label)) not between 1 and 60 then
    raise exception 'Choose a name between 1 and 60 characters.';
  end if;
  if p_requests_per_minute is null or p_requests_per_minute not between 1 and 60
    or p_requests_per_day is null or p_requests_per_day not between 1 and 10000 then
    raise exception 'The gateway key limits are invalid.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller_id::text, 0));
  if (
    select count(*)
    from public.gateway_router_keys
    where user_id = caller_id and revoked_at is null
  ) >= 10 then
    raise exception 'You can have up to 10 active gateway keys.';
  end if;

  insert into public.gateway_router_keys (
    user_id, label, requests_per_minute, requests_per_day
  )
  values (
    caller_id, trim(p_label), p_requests_per_minute, p_requests_per_day
  )
  returning gateway_router_keys.id, gateway_router_keys.created_at
    into new_key_id, new_created_at;

  insert into public.gateway_router_key_hashes (router_key_id, key_hash)
  values (new_key_id, p_key_hash);

  return query select new_key_id, new_created_at;
end;
$$;

revoke all on function public.create_my_gateway_router_key(text, text, integer, integer)
  from public, anon;
grant execute on function public.create_my_gateway_router_key(text, text, integer, integer)
  to authenticated;

create or replace function public.revoke_my_gateway_router_key(p_key_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Sign in to revoke a gateway key.';
  end if;
  update public.gateway_router_keys
  set revoked_at = coalesce(revoked_at, now())
  where id = p_key_id and user_id = caller_id;
  if not found then
    raise exception 'The gateway key could not be found.';
  end if;
  delete from public.gateway_router_key_hashes where router_key_id = p_key_id;
end;
$$;

revoke all on function public.revoke_my_gateway_router_key(uuid) from public, anon;
grant execute on function public.revoke_my_gateway_router_key(uuid) to authenticated;

create or replace function public.list_my_gateway_shared_keys()
returns table (
  provider_key_id uuid,
  provider text,
  label text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Sign in to view shared gateway keys.';
  end if;
  return query
    select shared.provider_key_id, shared.provider, shared.label,
      shared.created_at, shared.updated_at
    from public.gateway_provider_keys as shared
    where shared.user_id = caller_id
    order by shared.created_at;
end;
$$;

revoke all on function public.list_my_gateway_shared_keys() from public, anon;
grant execute on function public.list_my_gateway_shared_keys() to authenticated;

create or replace function public.unshare_my_gateway_key(p_provider_key_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Sign in to stop sharing a gateway key.';
  end if;
  delete from public.gateway_provider_keys
  where provider_key_id = p_provider_key_id and user_id = caller_id;
  if not found then
    raise exception 'The shared gateway key could not be found.';
  end if;
end;
$$;

revoke all on function public.unshare_my_gateway_key(uuid) from public, anon;
grant execute on function public.unshare_my_gateway_key(uuid) to authenticated;

create or replace function public.consume_gateway_router_key(p_key_hash text)
returns table (
  router_key_id uuid,
  user_id uuid,
  minute_count integer,
  day_count integer,
  minute_limit integer,
  day_limit integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  matched_key public.gateway_router_keys%rowtype;
  current_minute timestamptz := date_trunc('minute', clock_timestamp());
  current_day timestamptz := date_trunc(
    'day', clock_timestamp() at time zone 'UTC'
  ) at time zone 'UTC';
  new_minute_count integer;
  new_day_count integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  select keys.*
  into matched_key
  from public.gateway_router_key_hashes as hashes
  join public.gateway_router_keys as keys on keys.id = hashes.router_key_id
  where hashes.key_hash = p_key_hash and keys.revoked_at is null;

  if not found then
    return;
  end if;

  insert into public.gateway_key_usage (
    router_key_id, user_id, period, period_start, request_count
  )
  values (
    matched_key.id, matched_key.user_id, 'minute', current_minute, 1
  )
  on conflict (router_key_id, period, period_start) do update
    set request_count = gateway_key_usage.request_count + 1
  returning request_count into new_minute_count;

  insert into public.gateway_key_usage (
    router_key_id, user_id, period, period_start, request_count
  )
  values (
    matched_key.id, matched_key.user_id, 'day', current_day, 1
  )
  on conflict (router_key_id, period, period_start) do update
    set request_count = gateway_key_usage.request_count + 1
  returning request_count into new_day_count;

  update public.gateway_router_keys
  set last_used_at = clock_timestamp()
  where id = matched_key.id;

  delete from public.gateway_key_usage
  where user_id = matched_key.user_id
    and period_start < current_day - interval '2 days';

  return query select
    matched_key.id,
    matched_key.user_id,
    new_minute_count,
    new_day_count,
    matched_key.requests_per_minute,
    matched_key.requests_per_day;
end;
$$;

revoke all on function public.consume_gateway_router_key(text)
  from public, anon, authenticated;
grant execute on function public.consume_gateway_router_key(text) to service_role;

create or replace function public.rollup_user_activity(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_user_id is null then
    raise exception 'A user is required for activity rollup.';
  end if;

  insert into public.daily_stats as current_stats (
    user_id, day, requests, successes, errors, fallbacks,
    avg_latency_ms, input_tokens, output_tokens, cost_usd,
    baseline_cost_usd, total_cost_usd, total_saved_usd, gateway_requests
  )
  select
    logs.user_id,
    (logs.created_at at time zone 'UTC')::date,
    count(*)::integer,
    count(*) filter (where logs.status = 'success')::integer,
    count(*) filter (where logs.status = 'error')::integer,
    coalesce(sum(logs.fallback_count), 0)::integer,
    avg(logs.latency_ms)::numeric,
    sum(logs.input_tokens)::bigint,
    sum(logs.output_tokens)::bigint,
    sum(logs.est_cost_usd)::numeric(12, 6),
    sum(logs.est_baseline_cost_usd)::numeric(12, 6),
    coalesce(sum(logs.est_cost_usd), 0)::numeric(12, 6),
    coalesce(sum(logs.est_saved_usd), 0)::numeric(12, 6),
    count(*) filter (where logs.source = 'gateway')::integer
  from public.request_logs as logs
  where logs.user_id = p_user_id
    and logs.created_at < now() - interval '30 days'
  group by logs.user_id, (logs.created_at at time zone 'UTC')::date
  on conflict (user_id, day) do update set
    requests = current_stats.requests + excluded.requests,
    successes = current_stats.successes + excluded.successes,
    errors = current_stats.errors + excluded.errors,
    fallbacks = current_stats.fallbacks + excluded.fallbacks,
    avg_latency_ms = (
      coalesce(current_stats.avg_latency_ms, 0) * current_stats.requests
      + coalesce(excluded.avg_latency_ms, 0) * excluded.requests
    ) / nullif(current_stats.requests + excluded.requests, 0),
    input_tokens = case
      when current_stats.input_tokens is null and excluded.input_tokens is null then null
      else coalesce(current_stats.input_tokens, 0) + coalesce(excluded.input_tokens, 0)
    end,
    output_tokens = case
      when current_stats.output_tokens is null and excluded.output_tokens is null then null
      else coalesce(current_stats.output_tokens, 0) + coalesce(excluded.output_tokens, 0)
    end,
    cost_usd = case
      when current_stats.cost_usd is null and excluded.cost_usd is null then null
      else coalesce(current_stats.cost_usd, 0) + coalesce(excluded.cost_usd, 0)
    end,
    baseline_cost_usd = case
      when current_stats.baseline_cost_usd is null and excluded.baseline_cost_usd is null then null
      else coalesce(current_stats.baseline_cost_usd, 0) + coalesce(excluded.baseline_cost_usd, 0)
    end,
    total_cost_usd = current_stats.total_cost_usd + excluded.total_cost_usd,
    total_saved_usd = current_stats.total_saved_usd + excluded.total_saved_usd,
    gateway_requests = current_stats.gateway_requests + excluded.gateway_requests;

  delete from public.request_logs
  where user_id = p_user_id
    and created_at < now() - interval '30 days';
end;
$$;

revoke all on function public.rollup_user_activity(uuid)
  from public, anon, authenticated;

create or replace function public.get_gateway_activity_summary(p_days integer default 7)
returns bigint
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
  start_day date;
  total_gateway_requests bigint;
begin
  if caller_id is null then
    raise exception 'Sign in to view gateway activity.';
  end if;
  if p_days is null or p_days not in (7, 30) then
    raise exception 'Choose a 7-day or 30-day activity range.';
  end if;

  start_day := (now() at time zone 'UTC')::date - (p_days - 1);
  select
    coalesce((
      select sum(stats.gateway_requests)::bigint
      from public.daily_stats as stats
      where stats.user_id = caller_id and stats.day >= start_day
    ), 0)
    + coalesce((
      select count(*)::bigint
      from public.request_logs as logs
      where logs.user_id = caller_id
        and logs.source = 'gateway'
        and logs.created_at >= (start_day::timestamp at time zone 'UTC')
    ), 0)
  into total_gateway_requests;

  return total_gateway_requests;
end;
$$;

revoke all on function public.get_gateway_activity_summary(integer) from public, anon;
grant execute on function public.get_gateway_activity_summary(integer) to authenticated;

create or replace function public.delete_my_data()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Sign in to delete your data.';
  end if;

  delete from public.request_logs where user_id = caller_id;
  delete from public.daily_stats where user_id = caller_id;
  delete from public.gateway_router_keys where user_id = caller_id;
  delete from public.gateway_provider_keys where user_id = caller_id;
  delete from public.provider_keys where user_id = caller_id;
  delete from public.vault_meta where user_id = caller_id;
  delete from public.routes where user_id = caller_id;
  delete from public.auto_backup_plans where user_id = caller_id;
  delete from public.favorite_models where user_id = caller_id;
  delete from public.model_test_results where user_id = caller_id;
  delete from public.user_settings where user_id = caller_id;
  delete from public.route_rate_limits where user_id = caller_id;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'show_advanced_features'
  where id = caller_id;
end;
$$;

revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
