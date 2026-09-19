#!/usr/bin/env node --experimental-strip-types
/**
 * Append today's stats and regenerate README dashboard SVGs.
 *
 *   node --experimental-strip-types scripts/plot-growth.ts --update --stats-file stats/stats.json
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DATA_PATH = join(ROOT, 'stats/growth-data.json');
const SIZE_SVG = join(ROOT, 'stats/codebase-growth.svg');
const COV_SVG = join(ROOT, 'stats/coverage-trend.svg');

const UPDATE = process.argv.includes('--update');
const STATS_FILE_IDX = process.argv.indexOf('--stats-file');
const STATS_FILE =
  STATS_FILE_IDX >= 0 ? (process.argv[STATS_FILE_IDX + 1] ?? null) : null;

interface GrowthEntry {
  date: string;
  commit: string;
  src: number;
  web: number;
  tests: number;
  coverage: number | null;
}

interface GrowthData {
  entries: GrowthEntry[];
}

interface StatsJson {
  git: { commit: string };
  src: { lines: number };
  web: { lines: number };
  tests: { lines: number };
  e2e: { lines: number };
  coverage: { available: boolean; linePct: number };
}

async function loadData(): Promise<GrowthData> {
  try {
    return JSON.parse(await readFile(DATA_PATH, 'utf-8')) as GrowthData;
  } catch {
    return { entries: [] };
  }
}

async function loadStats(): Promise<StatsJson | null> {
  if (!UPDATE) return null;
  const path = STATS_FILE
    ? join(ROOT, STATS_FILE)
    : join(ROOT, 'stats/stats.json');
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as StatsJson;
  } catch {
    if (process.env['STATS_JSON']) {
      return JSON.parse(process.env['STATS_JSON']) as StatsJson;
    }
    return null;
  }
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function updateData(
  data: GrowthData,
  stats: StatsJson
): Promise<GrowthData> {
  const today = todayISO();
  const entry: GrowthEntry = {
    date: today,
    commit: stats.git.commit.slice(0, 7),
    src: stats.src.lines,
    web: stats.web.lines,
    tests: stats.tests.lines + stats.e2e.lines,
    coverage: stats.coverage.available ? stats.coverage.linePct : null,
  };

  const existing = data.entries.find((e) => e.date === today);
  if (existing) {
    Object.assign(existing, entry);
  } else {
    data.entries.push(entry);
  }
  data.entries.sort((a, b) => a.date.localeCompare(b.date));
  await mkdir(join(ROOT, 'stats'), { recursive: true });
  await writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  return data;
}

const C = {
  src: '#2563eb',
  web: '#7c3aed',
  tests: '#059669',
  cov: '#d97706',
} as const;
const CA = {
  src: 'rgba(37,99,235,0.18)',
  web: 'rgba(124,58,237,0.16)',
  tests: 'rgba(5,150,105,0.16)',
} as const;
const TXT = {
  primary: '#0f172a',
  secondary: '#475569',
  muted: '#94a3b8',
  grid: '#e2e8f0',
  axis: '#cbd5e1',
  bg: '#f8fafc',
} as const;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function text(
  x: number,
  y: number,
  s: string,
  opts: {
    anchor?: string;
    base?: string;
    fill?: string;
    sz?: number;
    w?: number;
  } = {}
): string {
  const {
    anchor = 'start',
    base = 'auto',
    fill = TXT.muted,
    sz = 10.5,
    w = 400,
  } = opts;
  const wt = w !== 400 ? ` font-weight="${w}"` : '';
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="${base}" fill="${fill}" font-size="${sz}"${wt}>${esc(s)}</text>`;
}

function ln(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke = TXT.axis,
  sw = 1
): string {
  return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

function buildSizeSvg(entries: GrowthEntry[]): string {
  if (entries.length === 0) return '<svg xmlns="http://www.w3.org/2000/svg"/>';

  const W = 640;
  const H = 280;
  const ML = 52;
  const MR = 108;
  const MT = 32;
  const MB = 48;
  const PW = W - ML - MR;
  const PH = H - MT - MB;

  const maxStack = Math.max(...entries.map((e) => e.src + e.web + e.tests), 1);
  const yStep = maxStack > 20000 ? 5000 : maxStack > 8000 ? 2000 : 1000;
  const Y_MAX = Math.max(yStep, Math.ceil((maxStack * 1.15) / yStep) * yStep);
  const yTicks: number[] = [];
  for (let v = 0; v <= Y_MAX; v += yStep) yTicks.push(v);

  const start = new Date(entries[0].date).getTime();
  const end = new Date(entries[entries.length - 1].date).getTime();
  const span = Math.max(1, (end - start) / 86400000);
  const xp = (ds: string) =>
    ML + ((new Date(ds).getTime() - start) / 86400000 / span) * PW;
  const yp = (v: number) => MT + PH - (v / Y_MAX) * PH;

  const zeros = entries.map(() => 0);
  const srcTops = entries.map((e) => e.src);
  const webTops = entries.map((e) => e.src + e.web);
  const testTops = entries.map((e) => e.src + e.web + e.tests);

  function area(bot: number[], top: number[], fill: string): string {
    const fwd = entries
      .map(
        (e, i) =>
          `${i === 0 ? 'M' : 'L'}${xp(e.date).toFixed(1)},${yp(top[i]).toFixed(1)}`
      )
      .join(' ');
    const bwd = [...entries]
      .reverse()
      .map(
        (e, i) =>
          `L${xp(e.date).toFixed(1)},${yp(bot[entries.length - 1 - i]).toFixed(1)}`
      )
      .join(' ');
    return `<path d="${fwd} ${bwd} Z" fill="${fill}"/>`;
  }
  function pline(vals: number[], col: string): string {
    const d = entries
      .map(
        (e, i) =>
          `${i === 0 ? 'M' : 'L'}${xp(e.date).toFixed(1)},${yp(vals[i]).toFixed(1)}`
      )
      .join(' ');
    return `<path d="${d}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/>`;
  }

  const last = entries[entries.length - 1];
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif, system-ui, sans-serif" aria-label="Codebase size">`,
    `<rect width="${W}" height="${H}" fill="${TXT.bg}"/>`,
    text(ML, MT - 12, 'コード規模（行数）', {
      fill: TXT.primary,
      sz: 12,
      w: 600,
    }),
  ];

  for (const tick of yTicks) {
    const y = yp(tick);
    out.push(ln(ML, y, ML + PW, y, TXT.grid));
    out.push(
      text(
        ML - 6,
        y,
        tick === 0 ? '0' : tick >= 1000 ? `${tick / 1000}k` : String(tick),
        {
          anchor: 'end',
          base: 'middle',
        }
      )
    );
  }

  out.push(area(zeros, srcTops, CA.src));
  out.push(area(srcTops, webTops, CA.web));
  out.push(area(webTops, testTops, CA.tests));
  out.push(pline(srcTops, C.src));
  out.push(pline(webTops, C.web));
  out.push(pline(testTops, C.tests));
  out.push(ln(ML, MT, ML, MT + PH));
  out.push(ln(ML, MT + PH, ML + PW, MT + PH));

  const shown = new Set<string>();
  for (const e of [entries[0], entries[Math.floor(entries.length / 2)], last]) {
    if (shown.has(e.date)) continue;
    shown.add(e.date);
    const tx = xp(e.date);
    out.push(ln(tx, MT + PH, tx, MT + PH + 4));
    const d = new Date(e.date);
    out.push(
      text(tx, MT + PH + 16, `${d.getMonth() + 1}/${d.getDate()}`, {
        anchor: 'middle',
      })
    );
  }

  const lx = ML + PW + 8;
  out.push(
    text(lx, yp(last.src), `${last.src.toLocaleString()} src`, {
      fill: C.src,
      sz: 10,
      w: 600,
      base: 'middle',
    })
  );
  out.push(
    text(lx, yp(last.src + last.web), `${last.web.toLocaleString()} web`, {
      fill: C.web,
      sz: 10,
      w: 600,
      base: 'middle',
    })
  );
  out.push(
    text(
      lx,
      yp(last.src + last.web + last.tests),
      `${last.tests.toLocaleString()} tests`,
      {
        fill: C.tests,
        sz: 10,
        w: 600,
        base: 'middle',
      }
    )
  );

  let legX = ML;
  const legY = H - 14;
  for (const [label, col] of [
    ['Worker src/', C.src],
    ['UI web/src/', C.web],
    ['test + e2e', C.tests],
  ] as const) {
    out.push(
      `<rect x="${legX}" y="${legY - 8}" width="11" height="8" rx="1.5" fill="${col}" opacity="0.8"/>`
    );
    out.push(text(legX + 15, legY, label, { fill: TXT.secondary, sz: 10 }));
    legX += 16 + label.length * 6.4;
  }

  out.push('</svg>');
  return out.join('\n');
}

function buildCoverageSvg(entries: GrowthEntry[]): string {
  const points = entries.filter((e) => e.coverage !== null);
  const W = 640;
  const H = 220;
  const ML = 52;
  const MR = 72;
  const MT = 32;
  const MB = 40;
  const PW = W - ML - MR;
  const PH = H - MT - MB;
  const Y_MAX = 100;

  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif, system-ui, sans-serif" aria-label="Unit test coverage">`,
    `<rect width="${W}" height="${H}" fill="${TXT.bg}"/>`,
    text(ML, MT - 12, 'ユニットカバレッジ（src/ 行）', {
      fill: TXT.primary,
      sz: 12,
      w: 600,
    }),
  ];

  const yp = (v: number) => MT + PH - (v / Y_MAX) * PH;
  for (const tick of [0, 25, 50, 75, 100]) {
    const y = yp(tick);
    out.push(ln(ML, y, ML + PW, y, TXT.grid));
    out.push(text(ML - 6, y, `${tick}%`, { anchor: 'end', base: 'middle' }));
  }
  out.push(ln(ML, MT, ML, MT + PH));
  out.push(ln(ML, MT + PH, ML + PW, MT + PH));

  if (points.length === 0) {
    out.push(
      text(ML + PW / 2, MT + PH / 2, 'カバレッジ未計測', {
        anchor: 'middle',
        base: 'middle',
        fill: TXT.muted,
        sz: 12,
      })
    );
    out.push('</svg>');
    return out.join('\n');
  }

  const start = new Date(points[0].date).getTime();
  const end = new Date(points[points.length - 1].date).getTime();
  const span = Math.max(1, (end - start) / 86400000);
  const xp = (ds: string) =>
    ML + ((new Date(ds).getTime() - start) / 86400000 / span) * PW;

  const d = points
    .map(
      (e, i) =>
        `${i === 0 ? 'M' : 'L'}${xp(e.date).toFixed(1)},${yp(e.coverage ?? 0).toFixed(1)}`
    )
    .join(' ');
  const area = `${d} L${xp(points[points.length - 1].date).toFixed(1)},${yp(0).toFixed(1)} L${xp(points[0].date).toFixed(1)},${yp(0).toFixed(1)} Z`;
  out.push(`<path d="${area}" fill="rgba(217,119,6,0.14)"/>`);
  out.push(
    `<path d="${d}" fill="none" stroke="${C.cov}" stroke-width="1.8" stroke-linejoin="round"/>`
  );

  const last = points[points.length - 1];
  out.push(
    `<circle cx="${xp(last.date).toFixed(1)}" cy="${yp(last.coverage ?? 0).toFixed(1)}" r="3.2" fill="${C.cov}"/>`
  );
  out.push(
    text(ML + PW + 8, yp(last.coverage ?? 0), `${last.coverage}%`, {
      fill: C.cov,
      sz: 11,
      w: 600,
      base: 'middle',
    })
  );

  const shown = new Set<string>();
  for (const e of [points[0], points[Math.floor(points.length / 2)], last]) {
    if (shown.has(e.date)) continue;
    shown.add(e.date);
    const tx = xp(e.date);
    out.push(ln(tx, MT + PH, tx, MT + PH + 4));
    const dt = new Date(e.date);
    out.push(
      text(tx, MT + PH + 16, `${dt.getMonth() + 1}/${dt.getDate()}`, {
        anchor: 'middle',
      })
    );
  }

  out.push('</svg>');
  return out.join('\n');
}

const data = await loadData();
const stats = await loadStats();
const latest = UPDATE && stats ? await updateData(data, stats) : data;

await mkdir(join(ROOT, 'stats'), { recursive: true });
await writeFile(SIZE_SVG, `${buildSizeSvg(latest.entries)}\n`);
await writeFile(COV_SVG, `${buildCoverageSvg(latest.entries)}\n`);
console.log(`Wrote ${SIZE_SVG}`);
console.log(`Wrote ${COV_SVG}`);
