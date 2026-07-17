create table if not exists public.stashwear_snapshots (
  id bigserial primary key,
  device_id text,
  user_id uuid references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.stashwear_snapshots
add column if not exists id bigserial;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stashwear_snapshots'::regclass
      and conname = 'stashwear_snapshots_pkey'
  ) then
    alter table public.stashwear_snapshots drop constraint stashwear_snapshots_pkey;
  end if;
end $$;

do $$
begin
  alter table public.stashwear_snapshots
  add constraint stashwear_snapshots_pkey primary key (id);
exception
  when duplicate_object then null;
end $$;

alter table public.stashwear_snapshots
add column if not exists user_id uuid references auth.users(id) on delete cascade;

delete from public.stashwear_snapshots a
using public.stashwear_snapshots b
where a.user_id is not null
  and a.user_id = b.user_id
  and (
    a.updated_at < b.updated_at
    or (a.updated_at = b.updated_at and a.id < b.id)
  );

create unique index if not exists stashwear_snapshots_user_id_key
on public.stashwear_snapshots(user_id);

alter table public.stashwear_snapshots enable row level security;

drop policy if exists "stashwear_snapshots_anon_select" on public.stashwear_snapshots;
drop policy if exists "stashwear_snapshots_anon_insert" on public.stashwear_snapshots;
drop policy if exists "stashwear_snapshots_anon_update" on public.stashwear_snapshots;
drop policy if exists "stashwear_snapshots_user_select" on public.stashwear_snapshots;
drop policy if exists "stashwear_snapshots_user_insert" on public.stashwear_snapshots;
drop policy if exists "stashwear_snapshots_user_update" on public.stashwear_snapshots;

do $$
begin
  create policy "stashwear_snapshots_user_select"
  on public.stashwear_snapshots
  for select
  to authenticated
  using (user_id = auth.uid());
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create policy "stashwear_snapshots_user_insert"
  on public.stashwear_snapshots
  for insert
  to authenticated
  with check (user_id = auth.uid());
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create policy "stashwear_snapshots_user_update"
  on public.stashwear_snapshots
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
exception
  when duplicate_object then null;
end $$;
