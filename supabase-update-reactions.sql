-- Запусти ОДИН раз в Supabase → SQL Editor, если основной supabase.sql уже выполнен раньше

-- Реакции гостей между раундами
create table if not exists reactions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  kind text not null check (char_length(kind) between 1 and 12),
  created_at timestamptz not null default now()
);
alter table reactions enable row level security;
drop policy if exists party_reactions on reactions;
create policy party_reactions on reactions for all using (true) with check (true);
grant select, insert, update, delete on table reactions to anon, authenticated;
alter publication supabase_realtime add table reactions;
