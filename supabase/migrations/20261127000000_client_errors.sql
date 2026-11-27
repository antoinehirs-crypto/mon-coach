-- Journal des erreurs de l'appli : chaque utilisateur écrit les siennes, seul l'admin les lit et les efface.
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  at timestamptz not null default now(),
  lieu text not null default '',
  message text not null default '',
  stack text default '',
  version text default '',
  appareil text default ''
);
create index if not exists client_errors_at on public.client_errors (at desc);
alter table public.client_errors enable row level security;
create policy "erreurs: écrire les siennes" on public.client_errors for insert with check (user_id = auth.uid());
create policy "erreurs: admin lit" on public.client_errors for select using (public.is_admin());
create policy "erreurs: admin efface" on public.client_errors for delete using (public.is_admin());
