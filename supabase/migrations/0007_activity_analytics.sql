alter table public.request_logs
  alter column route_alias drop not null,
  add column source text not null default 'single',
  add column key_id uuid references public.provider_keys (id) on delete set null,
  add column ttfb_ms integer,
  add column tokens_estimated boolean not null default true,
  add column http_status integer,
  add column est_baseline_cost_usd numeric(12, 6);

update public.request_logs
set status = 'success'
where status = 'succeeded';

update public.request_logs
set status = 'error'
where status not in ('success', 'error', 'aborted');

update public.request_logs
set est_saved_usd = greatest(est_saved_usd, 0)
where est_saved_usd < 0;

update public.request_logs
set est_cost_usd = null
where est_cost_usd < 0;

alter table public.request_logs
  add constraint request_logs_source_check
    check (source in ('single', 'auto', 'route')) not valid,
  add constraint request_logs_status_check
    check (status in ('success', 'error', 'aborted')) not valid,
  add constraint request_logs_http_status_check
    check (http_status is null or http_status between 100 and 599) not valid,
  add constraint request_logs_ttfb_check
    check (ttfb_ms is null or ttfb_ms >= 0) not valid,
  add constraint request_logs_latency_check
    check (latency_ms >= 0) not valid,
  add constraint request_logs_fallback_count_check
    check (fallback_count >= 0) not valid,
  add constraint request_logs_input_tokens_check
    check (input_tokens is null or input_tokens >= 0) not valid,
  add constraint request_logs_output_tokens_check
    check (output_tokens is null or output_tokens >= 0) not valid,
  add constraint request_logs_error_class_check
    check (error_class is null or error_class in (
      'rate_limit',
      'server',
      'timeout',
      'auth',
      'quota',
      'model_not_found',
      'bad_request',
      'content_filter',
      'network',
      'stream_interrupted'
    )) not valid,
  add constraint request_logs_cost_nonnegative_check
    check ((est_cost_usd is null or est_cost_usd >= 0)
      and (est_baseline_cost_usd is null or est_baseline_cost_usd >= 0)
      and (est_saved_usd is null or est_saved_usd >= 0)) not valid;

alter table public.daily_stats
  add column errors integer not null default 0,
  add column fallbacks integer not null default 0,
  add column input_tokens bigint,
  add column output_tokens bigint,
  add column cost_usd numeric(12, 6),
  add column baseline_cost_usd numeric(12, 6);

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  baseline_provider text,
  baseline_model text,
  price_overrides jsonb not null default '{}'::jsonb,
  last_activity_rollup_day date,
  constraint user_settings_baseline_pair_check check (
    (baseline_provider is null and baseline_model is null)
    or (baseline_provider is not null and baseline_model is not null)
  ),
  constraint user_settings_price_overrides_object_check
    check (jsonb_typeof(price_overrides) = 'object')
);

alter table public.user_settings enable row level security;

create policy "Users can access their own activity settings"
  on public.user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.user_settings to authenticated;

drop policy if exists "Users can access their own request logs" on public.request_logs;
create policy "Users can read their own request logs"
  on public.request_logs for select
  using (auth.uid() = user_id);
create policy "Users can add their own request logs"
  on public.request_logs for insert
  with check (auth.uid() = user_id);

revoke insert, update, delete on public.request_logs from anon, authenticated;
grant select, insert on public.request_logs to authenticated;

drop policy if exists "Users can access their own daily stats" on public.daily_stats;
create policy "Users can read their own daily stats"
  on public.daily_stats for select
  using (auth.uid() = user_id);

revoke insert, update, delete on public.daily_stats from anon, authenticated;
grant select on public.daily_stats to authenticated;

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
    user_id,
    day,
    requests,
    successes,
    errors,
    fallbacks,
    avg_latency_ms,
    input_tokens,
    output_tokens,
    cost_usd,
    baseline_cost_usd,
    total_cost_usd,
    total_saved_usd
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
    coalesce(sum(logs.est_saved_usd), 0)::numeric(12, 6)
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
    total_saved_usd = current_stats.total_saved_usd + excluded.total_saved_usd;

  delete from public.request_logs
  where user_id = p_user_id
    and created_at < now() - interval '30 days';
end;
$$;

create or replace function public.rollup_and_prune()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
  changed_rows integer;
begin
  if caller_id is null then
    raise exception 'Sign in to roll up activity.';
  end if;

  insert into public.user_settings as settings (user_id, last_activity_rollup_day)
  values (caller_id, (now() at time zone 'UTC')::date)
  on conflict (user_id) do update
    set last_activity_rollup_day = excluded.last_activity_rollup_day
    where settings.last_activity_rollup_day is distinct from excluded.last_activity_rollup_day;

  get diagnostics changed_rows = row_count;
  if changed_rows = 1 then
    perform public.rollup_user_activity(caller_id);
  end if;
end;
$$;

revoke all on function public.rollup_user_activity(uuid) from public, anon, authenticated;
revoke all on function public.rollup_and_prune() from public, anon;
grant execute on function public.rollup_and_prune() to authenticated;

create or replace function public.delete_my_activity()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Sign in to delete activity.';
  end if;

  delete from public.request_logs where user_id = caller_id;
  delete from public.daily_stats where user_id = caller_id;
end;
$$;

revoke all on function public.delete_my_activity() from public, anon;
grant execute on function public.delete_my_activity() to authenticated;

create or replace function public.get_activity_summary(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
  start_day date;
  summary jsonb;
begin
  if caller_id is null then
    raise exception 'Sign in to view activity.';
  end if;
  if p_days not in (7, 30) then
    raise exception 'Choose a 7-day or 30-day activity range.';
  end if;

  start_day := (now() at time zone 'UTC')::date - (p_days - 1);

  with raw_activity as (
    select
      (logs.created_at at time zone 'UTC')::date as activity_day,
      logs.provider,
      1::bigint as requests,
      (logs.status = 'success')::bigint as successes,
      (logs.status = 'error')::bigint as errors,
      (logs.status = 'aborted')::bigint as aborted,
      logs.fallback_count::bigint as fallbacks,
      logs.latency_ms::numeric as latency_ms,
      logs.input_tokens::bigint as input_tokens,
      logs.output_tokens::bigint as output_tokens,
      logs.est_cost_usd as cost_usd,
      logs.est_baseline_cost_usd as baseline_cost_usd,
      case
        when logs.est_cost_usd is not null and logs.est_baseline_cost_usd is not null
        then greatest(logs.est_baseline_cost_usd - logs.est_cost_usd, 0)
        else null
      end as saved_usd
    from public.request_logs as logs
    where logs.user_id = caller_id
      and logs.created_at >= (start_day::timestamp at time zone 'UTC')
  ),
  archived_activity as (
    select
      stats.day as activity_day,
      null::text as provider,
      stats.requests::bigint as requests,
      stats.successes::bigint as successes,
      stats.errors::bigint as errors,
      greatest(stats.requests - stats.successes - stats.errors, 0)::bigint as aborted,
      stats.fallbacks::bigint as fallbacks,
      stats.avg_latency_ms::numeric as latency_ms,
      stats.input_tokens,
      stats.output_tokens,
      stats.cost_usd,
      stats.baseline_cost_usd,
      case
        when stats.cost_usd is not null and stats.baseline_cost_usd is not null
        then greatest(stats.total_saved_usd, 0)
        else null
      end as saved_usd
    from public.daily_stats as stats
    where stats.user_id = caller_id and stats.day >= start_day
  ),
  activity as (
    select * from raw_activity
    union all
    select * from archived_activity
  ),
  totals as (
    select
      coalesce(sum(requests), 0)::bigint as requests,
      coalesce(sum(successes), 0)::bigint as successes,
      coalesce(sum(errors), 0)::bigint as errors,
      coalesce(sum(aborted), 0)::bigint as aborted,
      coalesce(sum(fallbacks), 0)::bigint as fallbacks,
      sum(latency_ms * requests) / nullif(sum(requests), 0) as avg_latency_ms,
      sum(input_tokens)::bigint as input_tokens,
      sum(output_tokens)::bigint as output_tokens,
      sum(cost_usd)::numeric(12, 6) as cost_usd,
      sum(baseline_cost_usd)::numeric(12, 6) as baseline_cost_usd,
      sum(saved_usd)::numeric(12, 6) as estimated_saved_usd
    from activity
  ),
  daily_totals as (
    select
      activity_day,
      sum(requests)::bigint as requests,
      sum(successes)::bigint as successes,
      sum(errors)::bigint as errors,
      sum(fallbacks)::bigint as fallbacks
    from activity
    group by activity_day
  ),
  by_service as (
    select
      provider,
      count(*)::bigint as requests,
      count(*) filter (where provider_status.status = 'success')::bigint as successes,
      coalesce(sum(provider_status.fallback_count), 0)::bigint as fallbacks
    from (
      select logs.provider, logs.status, logs.fallback_count
      from public.request_logs as logs
      where logs.user_id = caller_id
        and logs.created_at >= (start_day::timestamp at time zone 'UTC')
    ) as provider_status
    group by provider
  ),
  date_series as (
    select generate_series(start_day, (now() at time zone 'UTC')::date, interval '1 day')::date as activity_day
  )
  select jsonb_build_object(
    'requests', totals.requests,
    'successes', totals.successes,
    'errors', totals.errors,
    'aborted', totals.aborted,
    'fallbacks', totals.fallbacks,
    'avg_latency_ms', totals.avg_latency_ms,
    'input_tokens', totals.input_tokens,
    'output_tokens', totals.output_tokens,
    'cost_usd', totals.cost_usd,
    'baseline_cost_usd', totals.baseline_cost_usd,
    'estimated_saved_usd', totals.estimated_saved_usd,
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', dates.activity_day,
        'requests', coalesce(daily_totals.requests, 0),
        'successes', coalesce(daily_totals.successes, 0),
        'errors', coalesce(daily_totals.errors, 0),
        'fallbacks', coalesce(daily_totals.fallbacks, 0)
      ) order by dates.activity_day), '[]'::jsonb)
      from date_series as dates
      left join daily_totals using (activity_day)
    ),
    'by_service', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'provider', by_service.provider,
        'requests', by_service.requests,
        'successes', by_service.successes,
        'fallbacks', by_service.fallbacks
      ) order by by_service.requests desc, by_service.provider), '[]'::jsonb)
      from by_service
    )
  )
  into summary
  from totals;

  return summary;
end;
$$;

revoke all on function public.get_activity_summary(integer) from public, anon;
grant execute on function public.get_activity_summary(integer) to authenticated;
