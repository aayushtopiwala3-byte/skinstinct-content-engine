create extension if not exists "pgcrypto";

create table if not exists voice_skill (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  telegram_message_id bigint not null,
  chat_id bigint not null,
  raw_text text not null,
  status text not null default 'pending',
  score int,
  reject_reason text,
  news_angle text,
  created_at timestamptz not null default now()
);

create unique index if not exists notes_chat_message_idx
  on notes (chat_id, telegram_message_id);

create table if not exists drafts (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes (id) on delete cascade,
  content text not null,
  telegram_message_id bigint,
  status text not null default 'pending',
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists drafts_telegram_message_idx
  on drafts (telegram_message_id);
