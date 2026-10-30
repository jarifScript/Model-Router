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
      case when logs.status = 'success' then 1 else 0 end::bigint as successes,
      case when logs.status = 'error' then 1 else 0 end::bigint as errors,
      case when logs.status = 'aborted' then 1 else 0 end::bigint as aborted,
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
