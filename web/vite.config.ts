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
        const source = JSON.stringify(assets);
        const manifestHash = createHash('sha256')
          .update(source)
          .digest('hex')
          .slice(0, 20);
        const versionedManifest = `offline-assets-${manifestHash}.json`;
        if (bundle[versionedManifest] || bundle['offline-assets.json'])
          this.error('Offline asset manifest output already exists');
        this.emitFile({
          type: 'asset',
          fileName: versionedManifest,
          source,
        });
        // Keep the fixed alias for older service workers still installing.
        this.emitFile({
          type: 'asset',
          fileName: 'offline-assets.json',
          source,
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
        const workerTemplate = readFileSync(resolve('public/sw.js'), 'utf8');
        const manifestFiles = Object.keys(bundle).filter((name) =>
          /^offline-assets-[a-f0-9]{20}\.json$/.test(name)
        );
        if (manifestFiles.length !== 1)
          throw new Error(
            `Expected one versioned offline asset manifest, found ${manifestFiles.length}`
          );
        const replaceExactlyOnce = (
          input: string,
          needle: string,
          replacement: string,
          label: string
        ) => {
          const first = input.indexOf(needle);
          if (first < 0 || input.indexOf(needle, first + needle.length) >= 0)
            throw new Error(
              `Expected exactly one ${label} placeholder in sw.js`
            );
          return `${input.slice(0, first)}${replacement}${input.slice(first + needle.length)}`;
        };
        const shellHash = hash.digest('hex').slice(0, 20);
        const worker = replaceExactlyOnce(
          replaceExactlyOnce(
            workerTemplate,
            '__OFFLINE_ASSET_MANIFEST__',
            `/${manifestFiles[0]}`,
            'offline asset manifest'
          ),
          'tossa-shell-v2',
          `tossa-shell-${shellHash}`,
          'shell cache name'
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
