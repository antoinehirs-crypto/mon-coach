-- Compteur de dépense IA partagé (tous les utilisateurs) : un plafond mensuel par fournisseur.
-- Lu et écrit uniquement par la fonction coach-ai (clé service) ; invisible depuis l'appli.
create table if not exists public.ai_usage (
  month text not null,          -- 'AAAA-MM'
  provider text not null,       -- 'claude' | 'gemini-pro' | 'gemini'
  calls integer not null default 0,
  cost_usd numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (month, provider)
);
alter table public.ai_usage enable row level security;
