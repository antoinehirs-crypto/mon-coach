import { defineConfig } from 'vite';
// base relative : fonctionne sur GitHub Pages (/mon-coach/) comme en local
export default defineConfig({ base: './', build: { outDir: 'dist', target: 'es2020' } });
