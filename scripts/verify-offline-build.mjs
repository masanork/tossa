import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve('web/dist');
const worker = readFileSync(resolve(dist, 'sw.js'), 'utf8');
const manifestPath = worker.match(
  /['"](\/offline-assets-[a-f0-9]{20}\.json)['"]/
)?.[1];
if (!manifestPath || !/tossa-shell-[a-f0-9]{20}/.test(worker))
  throw new Error('Offline worker is missing its versioned build references');
const raw = readFileSync(resolve(dist, manifestPath.slice(1)), 'utf8');
const expectedName = `/offline-assets-${createHash('sha256').update(raw).digest('hex').slice(0, 20)}.json`;
if (manifestPath !== expectedName)
  throw new Error('Offline manifest filename does not match its contents');
const assets = JSON.parse(raw);
if (
  !Array.isArray(assets) ||
  assets.length === 0 ||
  new Set(assets).size !== assets.length ||
  assets.some(
    (path) =>
      typeof path !== 'string' ||
      !/^\/assets\/[A-Za-z0-9_.-]+\.(js|css|woff2?)$/.test(path)
  )
)
  throw new Error('Offline manifest contains invalid or duplicate asset paths');
const files = readdirSync(resolve(dist, 'assets'))
  .filter((file) => /\.(js|css|woff2?)$/.test(file))
  .map((file) => `/assets/${file}`)
  .sort();
if (JSON.stringify([...assets].sort()) !== JSON.stringify(files))
  throw new Error('Offline manifest and built assets differ');
const scriptPath = readFileSync(resolve(dist, 'index.html'), 'utf8').match(
  /<script[^>]+src="(\/assets\/[^" ]+\.js)"/
)?.[1];
if (!scriptPath || !assets.includes(scriptPath))
  throw new Error('Offline manifest is missing the current frontend entry');
if (readFileSync(resolve(dist, 'offline-assets.json'), 'utf8') !== raw)
  throw new Error('Legacy offline manifest differs from its versioned alias');
console.log(`Offline build verified: ${manifestPath}, ${assets.length} assets`);
