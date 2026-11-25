// Génère capacitor.config.json pour l'appli Android : elle affiche le site en ligne
// (mises à jour automatiques) et ajoute l'accès natif à Health Connect.
import { writeFileSync } from 'node:fs';
const url = process.env.APP_URL;
if (!url) throw new Error('APP_URL manquant');
writeFileSync('capacitor.config.json', JSON.stringify({
  appId: 'fr.moncoach.app',
  appName: 'Mon Coach',
  webDir: 'dist',
  server: { url, cleartext: false, allowNavigation: ['www.strava.com', 'strava.com', '*.supabase.co'] },
  android: { allowMixedContent: false },
}, null, 2));
console.log('capacitor.config.json ->', url);
