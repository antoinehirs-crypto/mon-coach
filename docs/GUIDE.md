# Mettre Mon Coach en ligne (gratuit)

Tout est gratuit : **GitHub Pages** héberge le site, et **Supabase** fournit les comptes, la base de données et les fonctions serveur. L'appli Android est compilée par GitHub.
Compte environ 20 minutes. Les clés se collent à **un seul endroit** : les réglages du dépôt GitHub. Ne les envoie jamais dans une discussion.

---

## 1. GitHub : le dépôt
Le code est déjà dans `antoinehirs-crypto/mon-coach`. Il reste deux réglages à faire :
1. **Settings → General**, tout en bas (« Danger Zone ») : **Change repository visibility → Public**. GitHub Pages n'est gratuit que pour un dépôt public. Le code ne contient aucune clé : elles restent dans les Secrets.
2. **Settings → Pages**, puis, sous « Build and deployment » : **Source : GitHub Actions**.

L'adresse de l'appli sera : `https://antoinehirs-crypto.github.io/mon-coach/`

## 2. Supabase : comptes et base de données
1. Inscris-toi sur https://supabase.com (offre Free), puis clique sur **New project** :
   - Nom : `mon-coach`, région : **West EU (Paris)**.
   - **Database password** : génère-le et garde-le (→ `SUPABASE_DB_PASSWORD`).
2. Dans **Project Settings → General**, copie le **Project ID**, par exemple `abcdxyz…` (→ `SUPABASE_PROJECT_REF`).
3. Dans **Project Settings → API Keys**, copie la clé **publishable** (`sb_publishable_…`) ou, à défaut, la clé `anon` (→ `SUPABASE_ANON_KEY`). Cette clé est publique, ce n'est pas grave.
4. Clique sur ton avatar (en haut à droite), puis **Account → Access Tokens → Generate new token**, avec le nom « github » (→ `SUPABASE_ACCESS_TOKEN`).

> Les réglages d'authentification (adresse du site, inscription sans e-mail de confirmation) sont appliqués automatiquement au déploiement. Sans eux, tes amis ne pourraient pas s'inscrire, car l'envoi d'e-mails gratuit de Supabase ne marche que pour toi.
> Un projet Free est mis en pause après 7 jours **sans aucune visite**. Il suffit de le relancer depuis le tableau de bord.

## 3. Strava : l'appli API
1. Va sur https://www.strava.com/settings/api et crée une application :
   - Nom : `Mon Coach`, catégorie : Training.
   - Site web : `https://antoinehirs-crypto.github.io/mon-coach/`
   - **Authorization Callback Domain** : `antoinehirs-crypto.github.io`
2. Copie le **Client ID** (→ `STRAVA_CLIENT_ID`) et le **Client Secret** (→ `STRAVA_CLIENT_SECRET`).
3. ⚠️ Une nouvelle appli Strava n'accepte qu'**un seul athlète** (toi). Pour tes amis, demande l'augmentation de capacité à Strava : le lien se trouve sur la même page, ou passe par https://developers.strava.com/ (« Developer Program »). C'est gratuit, mais la réponse prend quelques jours.

## 4. (Facultatif) Coach IA gratuit
Sans IA, l'onglet Coach fonctionne déjà avec les règles intégrées (3 niveaux, demande libre, modifications). Avec une IA, les séances sont rédigées par un « coach expert » qui lit ta charge, tes courses et tes examens. Tout est gratuit, dans cet ordre de repli :
1. **Gemini 2.5 Pro**, puis **Gemini 2.5 Flash** : crée une clé sur https://aistudio.google.com/apikey (→ `GEMINI_API_KEY`). Choisis un projet Google **sans facturation activée** : tu restes ainsi sur l'offre gratuite et rien ne peut être facturé.
2. **Groq** (Llama 3.3 70B) : crée un compte sur https://console.groq.com puis une clé dans *API Keys* (→ `GROQ_API_KEY`).
3. Si aucune IA ne répond (quota du jour atteint), l'appli reprend ses règles intégrées.

Chaque utilisateur est limité à 25 demandes IA par jour (variable `AI_DAILY_LIMIT` pour changer).
Option payante, désactivée par défaut : `ANTHROPIC_API_KEY` (API Claude, facturée à part de l'abonnement Claude) passerait en premier, plafonnée à `CLAUDE_MONTHLY_USD` dollars par mois (5 par défaut).

## 5. Coller les clés dans GitHub
Dans le dépôt, va dans **Settings → Secrets and variables → Actions**.

Onglet **Variables** → *New repository variable* :
| Nom | Valeur |
|---|---|
| `SUPABASE_PROJECT_REF` | l'ID du projet (étape 2.2) |
| `SUPABASE_ANON_KEY` | la clé publishable (étape 2.3) |

Onglet **Secrets** → *New repository secret* :
| Nom | Valeur |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | étape 2.4 |
| `SUPABASE_DB_PASSWORD` | étape 2.1 |
| `STRAVA_CLIENT_ID` | étape 3.2 |
| `STRAVA_CLIENT_SECRET` | étape 3.2 |
| `GEMINI_API_KEY` | facultatif, étape 4 |
| `GROQ_API_KEY` | facultatif, étape 4 |

## 6. Lancer le déploiement
1. Onglet **Actions → « Déployer Mon Coach » → Run workflow**. Compte 2 à 3 minutes : deux coches vertes = c'est en ligne.
2. Onglet **Actions → « Appli Android » → Run workflow**. Compte environ 6 minutes. L'APK apparaît ensuite dans **Releases**.

Ensuite, chaque modification poussée sur `main` redéploie le site toute seule.

## 7. Premier lancement
1. Ouvre `https://antoinehirs-crypto.github.io/mon-coach/` et **crée ton compte en premier** : le premier inscrit devient automatiquement **admin** (onglet Admin).
2. Dans Sources :
   - **Agenda** : colle le lien iCal de my.devinci (« Télécharger au format iCal »), ou l'« adresse secrète au format iCal » de Google Agenda (Paramètres → ton agenda → Intégrer l'agenda).
   - **Strava** : Connecter, puis autoriser.
3. Remplis ta semaine type (natation à Viroflay, etc.) avec les temps de trajet depuis l'école et depuis chez toi.

## 8. Sommeil, VFC, FC repos
**Android (toi)**
1. Garmin Connect : *Plus → Paramètres → Applications connectées → Health Connect* → active le sommeil, la VFC et la FC au repos.
   Samsung Health : *Paramètres → Health Connect* → autorise. COROS : *Profil → Paramètres → Health Connect* (si l'option apparaît dans ta version).
2. Sur ton téléphone, ouvre `https://github.com/antoinehirs-crypto/mon-coach/releases/latest/download/mon-coach.apk`, puis installe-le (autorise « sources inconnues » si Android le demande).
3. Ouvre Mon Coach, connecte-toi, puis va dans *Profil → Sources → Sommeil → Connecter* et autorise la lecture.
Ensuite, à chaque ouverture, l'appli lit tes 14 dernières nuits.

**iPhone (tes amis)**
Dans l'appli web : *Profil → Sources → Sommeil → Configurer → iPhone*. Les étapes du Raccourci y sont décrites, avec le jeton personnel déjà rempli. Le Raccourci envoie chaque matin la nuit enregistrée dans Apple Santé (où Garmin, COROS et Samsung peuvent écrire).

---

### Ce qui reste en saisie manuelle
- Les ressentis (fatigue, courbatures, motivation) se notent dans le check-in du matin, en 30 secondes.
- Sans téléphone compatible, le sommeil se note aussi dans le check-in.
