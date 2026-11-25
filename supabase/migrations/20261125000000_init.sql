-- Mon Coach : schéma initial (comptes, données privées, Strava, sommeil, admin)

create extension if not exists pgcrypto;

-- ---------- profils ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  prenom text default '',
  sports text[] default '{}',
  role text not null default 'member' check (role in ('member','admin')),
  status text not null default 'actif' check (status in ('actif','suspendu')),
  motif text default '',
  note text default '',
  summary jsonb not null default '{}'::jsonb,
  ingest_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Le premier inscrit devient admin (c'est toi : inscris-toi en premier).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, prenom, role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'prenom', ''),
    case when exists (select 1 from public.profiles where role = 'admin') then 'member' else 'admin' end
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Un membre ne peut pas changer son rôle, son statut ni le message de l'admin.
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.role := old.role; new.status := old.status; new.motif := old.motif; new.note := old.note;
    new.ingest_token := old.ingest_token; new.email := old.email;
  end if;
  return new;
end $$;

create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile();

alter table public.profiles enable row level security;
create policy "profil: lire le sien ou admin" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profil: modifier le sien ou admin" on public.profiles for update using (id = auth.uid() or public.is_admin());

-- Nouveau jeton d'envoi santé (raccourci iPhone)
create or replace function public.rotate_ingest_token() returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid := gen_random_uuid();
begin
  update public.profiles set ingest_token = t where id = auth.uid();
  return t;
end $$;

-- ---------- données privées de l'appli (clé / valeur) ----------
create table public.kv (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.kv enable row level security;
create policy "kv: les siennes" on public.kv for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Strava ----------
-- Jetons : aucune politique RLS = lisible uniquement par les fonctions serveur.
create table public.strava_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  athlete_id bigint,
  athlete jsonb,
  access_token text not null,
  refresh_token text not null,
  expires_at bigint not null,
  last_sync timestamptz
);
alter table public.strava_tokens enable row level security;

create table public.activities (
  id bigint primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  start_local text,
  start_date timestamptz,
  sport_type text,
  name text,
  distance real,
  moving_time integer,
  elevation real,
  avg_speed real,
  avg_hr real,
  max_hr real,
  avg_watts real,
  suffer_score real,
  pr_count integer default 0
);
create index activities_user_date on public.activities (user_id, start_date desc);
alter table public.activities enable row level security;
create policy "activités: les siennes" on public.activities for select using (user_id = auth.uid());

-- ---------- sommeil / VFC / FC repos ----------
create table public.health_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  sleep_min integer,
  deep_min integer,
  rem_min integer,
  hrv_ms real,
  resting_hr real,
  source text,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);
alter table public.health_daily enable row level security;
create policy "santé: les siennes" on public.health_daily for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- droits d'accès API (RLS ci-dessus filtre les lignes) ----------
grant usage on schema public to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.kv to authenticated;
grant select on public.activities to authenticated;
grant select, insert, update, delete on public.health_daily to authenticated;
revoke all on public.strava_tokens from anon, authenticated;
grant execute on function public.is_admin(), public.rotate_ingest_token() to authenticated;
