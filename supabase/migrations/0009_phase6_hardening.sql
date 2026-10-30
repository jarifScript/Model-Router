create table public.route_rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  minute_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (user_id, minute_start)
);

alter table public.route_rate_limits enable row level security;

create policy "Users can read their own route rate limits"
  on public.route_rate_limits for select
  using (auth.uid() = user_id);

revoke all on public.route_rate_limits from anon, authenticated;
grant select on public.route_rate_limits to authenticated;

create or replace function public.consume_route_rate_limit()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
  current_minute timestamptz := date_trunc('minute', clock_timestamp());
  current_count integer;
begin
  if caller_id is null then
    raise exception 'Sign in before making a request.';
  end if;

  insert into public.route_rate_limits as current_limit (user_id, minute_start, request_count)
  values (caller_id, current_minute, 1)
  on conflict (user_id, minute_start) do update
    set request_count = current_limit.request_count + 1
  returning request_count into current_count;

  delete from public.route_rate_limits
  where user_id = caller_id
    and minute_start < current_minute - interval '2 minutes';

  return current_count <= 60;
end;
$$;

revoke all on function public.consume_route_rate_limit() from public, anon;
grant execute on function public.consume_route_rate_limit() to authenticated;

create or replace function public.change_my_vault(
  p_canary jsonb,
  p_provider_keys jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
  submitted_count integer;
  existing_count integer;
  updated_count integer;
begin
  if caller_id is null then
    raise exception 'Sign in to change your secret password.';
  end if;
  if jsonb_typeof(p_canary) is distinct from 'object'
    or jsonb_typeof(p_provider_keys) is distinct from 'array'
    or jsonb_typeof(p_canary -> 'kdf_salt') is distinct from 'string'
    or jsonb_typeof(p_canary -> 'canary_ciphertext') is distinct from 'string'
    or jsonb_typeof(p_canary -> 'canary_iv') is distinct from 'string' then
    raise exception 'The replacement vault data is invalid.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_provider_keys) as supplied(value)
    where jsonb_typeof(value) is distinct from 'object'
      or jsonb_typeof(value -> 'id') is distinct from 'string'
      or jsonb_typeof(value -> 'ciphertext') is distinct from 'string'
      or jsonb_typeof(value -> 'iv') is distinct from 'string'
      or jsonb_typeof(value -> 'salt') is distinct from 'string'
  ) then
    raise exception 'The replacement key data is invalid.';
  end if;

  select count(*) into submitted_count
  from jsonb_to_recordset(p_provider_keys) as supplied(id uuid);
  select count(*) into existing_count
  from public.provider_keys
  where user_id = caller_id;

  if submitted_count <> existing_count then
    raise exception 'The saved keys changed. Reload and try again.';
  end if;
  if exists (
    select supplied.id
    from jsonb_to_recordset(p_provider_keys) as supplied(id uuid)
    group by supplied.id
    having count(*) > 1
  ) then
    raise exception 'The replacement key list contains duplicates.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_provider_keys) as supplied(id uuid)
    left join public.provider_keys as saved
      on saved.id = supplied.id and saved.user_id = caller_id
    where saved.id is null
  ) then
    raise exception 'The replacement key list does not match your saved keys.';
  end if;

  update public.provider_keys as saved
  set ciphertext = supplied.ciphertext,
      iv = supplied.iv,
      salt = supplied.salt
  from jsonb_to_recordset(p_provider_keys) as supplied(
    id uuid,
    ciphertext text,
    iv text,
    salt text
  )
  where saved.id = supplied.id
    and saved.user_id = caller_id;
  get diagnostics updated_count = row_count;
  if updated_count <> existing_count then
    raise exception 'Not all saved keys could be updated.';
  end if;

  update public.vault_meta
  set kdf_salt = p_canary ->> 'kdf_salt',
      canary_ciphertext = p_canary ->> 'canary_ciphertext',
      canary_iv = p_canary ->> 'canary_iv'
  where user_id = caller_id;
  if not found then
    raise exception 'The saved vault could not be found.';
  end if;
end;
$$;

revoke all on function public.change_my_vault(jsonb, jsonb) from public, anon;
grant execute on function public.change_my_vault(jsonb, jsonb) to authenticated;

create or replace function public.reset_my_vault()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Sign in to reset your vault.';
  end if;

  delete from public.provider_keys where user_id = caller_id;
  delete from public.vault_meta where user_id = caller_id;
end;
$$;

revoke all on function public.reset_my_vault() from public, anon;
grant execute on function public.reset_my_vault() to authenticated;

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

create or replace function public.keep_alive()
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select true;
$$;

revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;
