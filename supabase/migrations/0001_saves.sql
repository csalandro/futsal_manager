-- Partidas guardadas: una fila por usuario y ranura. El estado completo va en jsonb.
create table if not exists public.saves (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  slot        smallint not null check (slot between 1 and 3),
  version     integer not null,
  season      integer not null,
  team_name   text,
  state       jsonb not null,
  updated_at  timestamptz not null default now(),
  unique (user_id, slot)
);

alter table public.saves enable row level security;

create policy "saves: leer las propias" on public.saves
  for select using (auth.uid() = user_id);
create policy "saves: crear las propias" on public.saves
  for insert with check (auth.uid() = user_id);
create policy "saves: actualizar las propias" on public.saves
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "saves: borrar las propias" on public.saves
  for delete using (auth.uid() = user_id);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

create trigger saves_touch before update on public.saves
  for each row execute function public.touch_updated_at();
