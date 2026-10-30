create table public.auto_backup_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  targets jsonb not null default '[]'::jsonb,
  max_attempts smallint not null default 6 check (max_attempts between 2 and 12),
  updated_at timestamptz not null default now()
);

alter table public.auto_backup_plans enable row level security;

create policy "Users can access their own auto backup plan"
  on public.auto_backup_plans for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.auto_backup_plans to authenticated;
