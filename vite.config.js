import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// Emits dist/sw.js with the list of hashed build files baked in,
// so the whole app is precached and works offline after the first visit.
function serviceWorker() {
  return {
    name: 'typewriter-sw',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => f !== 'sw.js' && !f.endsWith('.map'));
      const publicFiles = ['manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
      const source = readFileSync(new URL('./sw.template.js', import.meta.url), 'utf8')
        .replace('__VERSION__', Date.now().toString(36))
        .replace('__PRECACHE__', JSON.stringify(['./', ...files, ...publicFiles]));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: '/typewriter/',
  server: { port: 5180 },
  preview: { port: 5181 },
  plugins: [serviceWorker()],
});
