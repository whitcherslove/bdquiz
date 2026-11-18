-- Supabase → SQL Editor → New query → вставить всё → Run
-- Скрипт можно запускать повторно: он пересоздаёт таблицы (старые игры удалятся)

drop table if exists answers cascade;
drop table if exists players cascade;
drop table if exists games cascade;

create table games (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  phase text not null default 'lobby',   -- lobby | intro | question | reveal | board | roundsum | podium | table | awards
  q_index int not null default 0,
  q_started_at timestamptz,
  created_at timestamptz not null default now()
);

create table players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 20),
  score int not null default 0,
  created_at timestamptz not null default now()
);

create table answers (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  q_index int not null,
  value text not null,                  -- номер варианта, число или текст
  ms int,
  points int not null default 0,
  ok boolean not null default false,
  created_at timestamptz not null default now(),
  unique (player_id, q_index)
);

-- Домашний праздник: открытый доступ по публичному ключу
alter table games   enable row level security;
alter table players enable row level security;
alter table answers enable row level security;
create policy party_games   on games   for all using (true) with check (true);
create policy party_players on players for all using (true) with check (true);
create policy party_answers on answers for all using (true) with check (true);

alter publication supabase_realtime add table games, players, answers;

-- Старт вопроса: время ставит сервер
create or replace function start_question(p_game uuid, p_idx int)
returns timestamptz language sql as $$
  update games set q_index = p_idx, phase = 'question', q_started_at = now()
   where id = p_game
  returning q_started_at;
$$;

-- Экран ТВ присылает посчитанные очки: записываем, пересчитываем итог, открываем ответ
create or replace function apply_results(p_game uuid, p_results jsonb)
returns void language plpgsql as $$
begin
  update answers a
     set ms = (r->>'ms')::int, points = (r->>'points')::int, ok = (r->>'ok')::boolean
    from jsonb_array_elements(p_results) r
   where a.id = (r->>'id')::uuid and a.game_id = p_game;
  update players p
     set score = coalesce((select sum(points) from answers where player_id = p.id), 0)
   where p.game_id = p_game;
  update games set phase = 'reveal' where id = p_game;
end $$;

-- Кнопка «Назад»: стереть ответы на вопрос и всё после него
create or replace function clear_from(p_game uuid, p_idx int)
returns void language plpgsql as $$
begin
  delete from answers where game_id = p_game and q_index >= p_idx;
  update players p
     set score = coalesce((select sum(points) from answers where player_id = p.id), 0)
   where p.game_id = p_game;
end $$;
