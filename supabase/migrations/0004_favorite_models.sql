create table public.favorite_models (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider_id text not null,
  model_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, provider_id, model_id)
);

alter table public.favorite_models enable row level security;

create policy "Users can access their own favorite models"
  on public.favorite_models for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, delete on public.favorite_models to authenticated;
