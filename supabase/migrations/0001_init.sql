create table public.vault_meta (
  user_id uuid primary key references auth.users (id) on delete cascade,
  kdf_salt text not null,
  canary_ciphertext text not null,
  canary_iv text not null
);

create table public.provider_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  label text not null,
  ciphertext text not null,
  iv text not null,
  salt text not null,
  created_at timestamptz not null default now()
);

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  alias text not null,
  strategy text not null,
  targets jsonb not null default '[]'::jsonb,
  timeout_ms integer not null,
  max_attempts integer not null,
  created_at timestamptz not null default now()
);

create table public.request_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  route_alias text not null,
  provider text not null,
  model text not null,
  latency_ms integer not null,
  input_tokens integer,
  output_tokens integer,
  status text not null,
  error_class text,
  fallback_count integer not null default 0,
  est_cost_usd numeric(12, 6),
  est_saved_usd numeric(12, 6)
);

create table public.daily_stats (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  requests integer not null default 0,
  successes integer not null default 0,
  avg_latency_ms numeric,
  total_cost_usd numeric(12, 6) not null default 0,
  total_saved_usd numeric(12, 6) not null default 0,
  primary key (user_id, day)
);

create index provider_keys_user_id_idx on public.provider_keys (user_id);
create index routes_user_id_idx on public.routes (user_id);
create index request_logs_user_created_at_idx on public.request_logs (user_id, created_at desc);

alter table public.vault_meta enable row level security;
alter table public.provider_keys enable row level security;
alter table public.routes enable row level security;
alter table public.request_logs enable row level security;
alter table public.daily_stats enable row level security;

create policy "Users can access their own vault metadata"
  on public.vault_meta for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can access their own provider keys"
  on public.provider_keys for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can access their own routes"
  on public.routes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can access their own request logs"
  on public.request_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can access their own daily stats"
  on public.daily_stats for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
