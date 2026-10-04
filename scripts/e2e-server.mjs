import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const state = mkdtempSync(join(tmpdir(), 'tossa-e2e-'));
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
execFileSync('npm', ['run', 'build:web'], { stdio: 'inherit', env });
const fixtures = join(state, 'actors.sql');
writeFileSync(
  fixtures,
  `INSERT INTO users (id,username,display_name,role) VALUES
('e2e-admin','e2e-admin','E2E Admin','admin'),
('e2e-moderator','e2e-moderator','E2E Moderator','moderator');`
);
for (const file of ['schema.sql', 'seed.sql', fixtures]) {
  execFileSync(
    process.execPath,
    [
      wrangler,
      'd1',
      'execute',
      'tossa-db',
      '--local',
      '--persist-to',
      state,
      '--file',
      file,
    ],
    { stdio: 'inherit', env }
  );
}
const child = spawn(
  process.execPath,
  [
    wrangler,
    'dev',
    '--local',
    '--port',
    '8787',
    '--persist-to',
    state,
    '--var',
    'DISABLE_WRITE_BUFFER:true',
    '--var',
    'RP_ID:localhost',
    '--var',
    'EXPECTED_ORIGIN:http://localhost:8787',
    '--var',
    'JWT_SECRET:tossa-e2e-only-not-a-production-secret',
  ],
  { stdio: 'inherit', env }
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    child.kill(signal);
  });
child.on('exit', (code) => {
  process.exitCode = code || 0;
});
