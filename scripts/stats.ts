#!/usr/bin/env node --experimental-strip-types
/**
 * Codebase size and health snapshot for tossa.
 *
 *   node --experimental-strip-types scripts/stats.ts
 *   node --experimental-strip-types scripts/stats.ts --json
 *   node --experimental-strip-types scripts/stats.ts --save stats
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const JSON_OUTPUT = process.argv.includes('--json');
const SAVE_IDX = process.argv.indexOf('--save');
const SAVE_DIR = SAVE_IDX >= 0 ? (process.argv[SAVE_IDX + 1] ?? null) : null;

const EXCLUDES = [
  /\/node_modules\//,
  /\/\.git\//,
  /\/\.wrangler\//,
  /\/dist\//,
  /\/coverage\//,
  /\/test-results\//,
  /\/playwright-report\//,
  /\/web\/src\/paraglide\//,
  /\/web\/dist\//,
  /\/stats\//,
];

const CODE_EXTS = new Set(['.ts', '.js', '.svelte', '.sql']);
const TEST_FN_RE =
  /^\s*(test|it)\s*(?:\.(?:only|skip|todo|concurrent|each)[^\s(]*)?\s*\(/gm;
const LARGE_FILE_WARN = 500;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (EXCLUDES.some((re) => re.test(`${full}/`))) continue;
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

async function lineCount(file: string): Promise<number> {
  try {
    return (await readFile(file, 'utf-8')).split('\n').length;
  } catch {
    return 0;
  }
}

function isCode(path: string): boolean {
  return CODE_EXTS.has(extname(path));
}

async function countTestFns(files: string[]): Promise<number> {
  let total = 0;
  for (const f of files) {
    if (!/\.(test|spec)\.(ts|js)$/.test(f) && !f.includes('/e2e/')) continue;
    try {
      total += ((await readFile(f, 'utf-8')).match(TEST_FN_RE) ?? []).length;
    } catch {
      /* ignore */
    }
  }
  return total;
}

interface Bucket {
  name: string;
  path: string;
  files: number;
  lines: number;
  testFns: number;
}

async function bucket(rel: string, name: string): Promise<Bucket> {
  const files = (await walk(join(ROOT, rel))).filter(isCode);
  let lines = 0;
  for (const f of files) lines += await lineCount(f);
  return {
    name,
    path: rel,
    files: files.length,
    lines,
    testFns: await countTestFns(files),
  };
}

function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

async function depCount(): Promise<number> {
  try {
    const lock = JSON.parse(
      await readFile(join(ROOT, 'package-lock.json'), 'utf-8')
    ) as { packages?: Record<string, unknown> };
    return Object.keys(lock.packages ?? {}).filter((k) => k !== '').length;
  } catch {
    return 0;
  }
}

interface CoverageSummary {
  available: boolean;
  linePct: number;
  branchPct: number;
  funcPct: number;
  lines: number;
  coveredLines: number;
}

async function gatherCoverage(): Promise<CoverageSummary> {
  const empty: CoverageSummary = {
    available: false,
    linePct: 0,
    branchPct: 0,
    funcPct: 0,
    lines: 0,
    coveredLines: 0,
  };
  try {
    const raw = await readFile(
      join(ROOT, 'coverage', 'coverage-summary.json'),
      'utf-8'
    );
    const json = JSON.parse(raw) as {
      total?: {
        lines?: { pct?: number; total?: number; covered?: number };
        branches?: { pct?: number };
        functions?: { pct?: number };
      };
    };
    const t = json.total;
    if (!t?.lines) return empty;
    return {
      available: true,
      linePct: Math.round(t.lines.pct ?? 0),
      branchPct: Math.round(t.branches?.pct ?? 0),
      funcPct: Math.round(t.functions?.pct ?? 0),
      lines: t.lines.total ?? 0,
      coveredLines: t.lines.covered ?? 0,
    };
  } catch {
    /* fall through to lcov */
  }

  let lcov: string;
  try {
    lcov = await readFile(join(ROOT, 'coverage', 'lcov.info'), 'utf-8');
  } catch {
    return empty;
  }

  let lf = 0;
  let lh = 0;
  let brf = 0;
  let brh = 0;
  let fnf = 0;
  let fnh = 0;
  for (const line of lcov.split('\n')) {
    if (line.startsWith('LF:')) lf += parseInt(line.slice(3), 10) || 0;
    else if (line.startsWith('LH:')) lh += parseInt(line.slice(3), 10) || 0;
    else if (line.startsWith('BRF:')) brf += parseInt(line.slice(4), 10) || 0;
    else if (line.startsWith('BRH:')) brh += parseInt(line.slice(4), 10) || 0;
    else if (line.startsWith('FNF:')) fnf += parseInt(line.slice(4), 10) || 0;
    else if (line.startsWith('FNH:')) fnh += parseInt(line.slice(4), 10) || 0;
  }
  return {
    available: lf > 0,
    linePct: lf > 0 ? Math.round((lh / lf) * 100) : 0,
    branchPct: brf > 0 ? Math.round((brh / brf) * 100) : 0,
    funcPct: fnf > 0 ? Math.round((fnh / fnf) * 100) : 0,
    lines: lf,
    coveredLines: lh,
  };
}

async function largeFiles(
  dirs: string[]
): Promise<{ path: string; lines: number }[]> {
  const found: { path: string; lines: number }[] = [];
  for (const dir of dirs) {
    for (const f of (await walk(join(ROOT, dir))).filter(isCode)) {
      const lines = await lineCount(f);
      if (lines >= LARGE_FILE_WARN) {
        found.push({ path: relative(ROOT, f), lines });
      }
    }
  }
  found.sort((a, b) => b.lines - a.lines);
  return found;
}

const src = await bucket('src', 'src (Worker)');
const web = await bucket('web/src', 'web/src (UI)');
const tests = await bucket('test', 'test (unit)');
const e2e = await bucket('e2e', 'e2e');
const coverage = await gatherCoverage();
const implLines = src.lines + web.lines;
const testLines = tests.lines + e2e.lines;
const testRatio =
  implLines + testLines > 0 ? testLines / (implLines + testLines) : 0;

const snapshot = {
  generatedAt: new Date().toISOString(),
  git: { commit: gitCommit() },
  src,
  web,
  tests,
  e2e,
  health: {
    implLines,
    testLines,
    testRatio,
    depCount: await depCount(),
    largeFiles: await largeFiles(['src', 'web/src']),
  },
  coverage,
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function markdown(): string {
  const cov = coverage.available
    ? `${coverage.linePct}% lines / ${coverage.branchPct}% branches / ${coverage.funcPct}% funcs`
    : 'not collected (run `npm run test:coverage`)';
  const large =
    snapshot.health.largeFiles.length === 0
      ? '_none over 500 lines_'
      : snapshot.health.largeFiles
          .map((f) => `- \`${f.path}\` — ${f.lines.toLocaleString()} lines`)
          .join('\n');
  return [
    `# tossa codebase snapshot`,
    '',
    `Commit \`${snapshot.git.commit}\` · ${snapshot.generatedAt.slice(0, 10)}`,
    '',
    '| Area | Files | Lines | Tests |',
    '| --- | ---: | ---: | ---: |',
    `| Worker \`src/\` | ${src.files} | ${src.lines.toLocaleString()} | ${src.testFns} |`,
    `| UI \`web/src/\` | ${web.files} | ${web.lines.toLocaleString()} | ${web.testFns} |`,
    `| Unit \`test/\` | ${tests.files} | ${tests.lines.toLocaleString()} | ${tests.testFns} |`,
    `| E2E \`e2e/\` | ${e2e.files} | ${e2e.lines.toLocaleString()} | ${e2e.testFns} |`,
    `| **Impl total** | ${src.files + web.files} | **${implLines.toLocaleString()}** | |`,
    `| **Test total** | ${tests.files + e2e.files} | **${testLines.toLocaleString()}** | **${tests.testFns + e2e.testFns}** |`,
    '',
    `- Test / (impl + test) line ratio: **${pct(testRatio)}**`,
    `- npm packages (lockfile): **${snapshot.health.depCount}**`,
    `- Unit coverage (\`src/\`): **${cov}**`,
    '',
    '## Large files (≥ 500 lines)',
    '',
    large,
    '',
  ].join('\n');
}

if (SAVE_DIR) {
  const dir = join(ROOT, SAVE_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'stats.json'),
    `${JSON.stringify(snapshot, null, 2)}\n`
  );
  await writeFile(join(dir, 'stats.md'), markdown());
}

if (JSON_OUTPUT) {
  process.stdout.write(`${JSON.stringify(snapshot)}\n`);
} else if (!SAVE_DIR) {
  process.stdout.write(markdown());
}
