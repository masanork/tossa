import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/paraglide',
      emitTsDeclarations: true,
    }),
    tailwindcss(),
    svelte(),
    {
      name: 'offline-asset-manifest',
      enforce: 'post',
      generateBundle(_options, bundle) {
        const assets = Object.keys(bundle)
          .filter((name) => /\.(js|css|woff2?)$/.test(name))
          .sort()
          .map((name) => `/${name}`);
        this.emitFile({
          type: 'asset',
          fileName: 'offline-assets.json',
          source: JSON.stringify(assets),
        });
      },
      writeBundle(options, bundle) {
        // Change sw.js whenever any deployed shell bytes change, even when
        // the worker template itself is unchanged. Isolate each shell's cache.
        const hash = createHash('sha256');
        for (const name of Object.keys(bundle).sort()) {
          const entry = bundle[name];
          hash.update(name);
          hash.update(entry.type === 'chunk' ? entry.code : entry.source);
        }
        for (const name of ['manifest.webmanifest', 'favicon.svg', 'sw.js'])
          hash.update(readFileSync(resolve('public', name)));
        const worker = readFileSync(resolve('public/sw.js'), 'utf8').replace(
          'tossa-shell-v2',
          `tossa-shell-${hash.digest('hex').slice(0, 20)}`
        );
        writeFileSync(resolve(options.dir || 'dist', 'sw.js'), worker);
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
