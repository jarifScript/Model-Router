create table public.model_test_results (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider_id text not null check (provider_id in (
    'openai',
    'openrouter',
    'groq',
    'huggingface',
    'together',
    'mistral',
    'deepseek',
    'anthropic',
    'gemini'
  )),
  model_id text not null check (length(model_id) between 1 and 512),
  status text not null check (status in (
    'working',
    'rate_limited',
    'auth_failed',
    'no_credits',
    'model_not_found',
    'timeout',
    'server_error',
    'network_error'
  )),
  latency_ms integer not null check (latency_ms >= 0),
  tested_at timestamptz not null,
  primary key (user_id, provider_id, model_id)
);

alter table public.model_test_results enable row level security;

create policy "Users can access their own model test results"
  on public.model_test_results for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.model_test_results to authenticated;
