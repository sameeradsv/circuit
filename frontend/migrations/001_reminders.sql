create table if not exists push_subscriptions (
  id serial primary key,
  user_id integer not null references users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  device_name varchar(120),
  platform varchar(80),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

create index if not exists ix_push_subscriptions_user_enabled
  on push_subscriptions(user_id, enabled);

create table if not exists reminders (
  id serial primary key,
  user_id integer not null references users(id) on delete cascade,
  task_id integer not null references circuit_tasks(id) on delete cascade,
  remind_at timestamptz not null,
  status varchar(20) not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  occurrence_at_ms bigint,
  locked_at timestamptz,
  unique(user_id, task_id, remind_at)
);

create index if not exists ix_reminders_due
  on reminders(status, remind_at, attempts);

create index if not exists ix_reminders_task
  on reminders(task_id);

create index if not exists ix_reminders_user
  on reminders(user_id);
