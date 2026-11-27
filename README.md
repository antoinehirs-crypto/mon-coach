# Mon Coach

Appli d'entraînement multisport, mobile d'abord. Elle croise ta **semaine type** (natation, club…) avec tes **cours** (présentiel ou visio), tes activités **Strava** et ton **sommeil** (Health Connect / Apple Santé) pour générer un plan polarisé réaliste.

- **Web** : Vite + JS, PWA, hébergée sur GitHub Pages.
- **Serveur** : Supabase (auth, Postgres avec RLS, Edge Functions). Offre gratuite.
- **Android** : Capacitor (affiche le site, et lit Health Connect via `@capgo/capacitor-health`). APK compilé par GitHub Actions.

👉 Mise en ligne pas à pas : [docs/GUIDE.md](docs/GUIDE.md)

## Structure
| Chemin | Rôle |
|---|---|
| `src/main.js` | Interface : inscription → sources → semaine type, aujourd'hui, plan, agenda, coach, profil, admin |
| `src/planner.js` | Planificateur intégré : 80/20, +10 %/semaine max, semaine allégée, rien de dur autour des examens |
| `src/ics.js` | Lecture iCal (récurrences, exceptions), détection présentiel ou visio |
| `src/health.js` | Lecture Health Connect (appli Android) |
| `supabase/migrations` | Schéma, droits (RLS), premier inscrit = admin |
| `supabase/functions` | `strava-connect`, `strava-sync`, `calendar-fetch`, `health-ingest` (Raccourci iPhone), `coach-ai` (coach IA gratuit : Gemini Pro → Gemini Flash → Groq, facultatif) |
| `.github/workflows` | Déploiement automatique (Supabase + Pages) et APK Android |

## Développement local
```bash
npm install
VITE_SUPABASE_URL=https://<ref>.supabase.co VITE_SUPABASE_ANON_KEY=<clé> npm run dev
```
