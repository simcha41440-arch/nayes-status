-- עדכון 2: משתמשים (התחברות עם Google), כניסות, פעמון הודעות, והודעות ממשתמשים.
-- הרצה: Supabase > SQL Editor > New query > להדביק > Run. אפשר להריץ שוב בלי בעיה.

create table if not exists users (
  id            uuid primary key,              -- המזהה של המשתמש ב-Supabase Auth
  email         text unique not null,
  name          text,
  created_at    timestamptz not null default now(),
  last_seen     timestamptz,
  visits        integer not null default 0,
  last_read_at  timestamptz not null default now(),  -- עד מתי קרא את ההודעות בפעמון
  blocked       boolean not null default false
);
alter table users enable row level security;

create table if not exists visits (
  id          bigserial primary key,
  user_id     uuid references users(id) on delete set null,
  path        text,
  device      text,
  created_at  timestamptz not null default now()
);
create index if not exists visits_created_idx on visits (created_at desc);
alter table visits enable row level security;

-- הודעות בפעמון: user_id ריק = לכולם
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete cascade,
  title       text not null,
  body        text,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_created_idx on notifications (created_at desc);
alter table notifications enable row level security;

-- הודעות ממשתמשים מחוברים (לצד טופס יצירת הקשר)
alter table messages add column if not exists user_id uuid references users(id) on delete set null;

create or replace function touch_user(uid uuid)
returns void language sql security definer as $$
  update users set last_seen = now(), visits = visits + 1 where id = uid;
$$;
