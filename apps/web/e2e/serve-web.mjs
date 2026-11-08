// Builds the web for production and serves it with workerd (the Cloudflare runtime) for E2E tests.
// Runtime variables go to dist/server/.dev.vars, pointing the BFF at the E2E API (port 4100).
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

execFileSync('pnpm', ['exec', 'astro', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, E2E: '1' },
});

const base = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
const vars = base
  .split('\n')
  .filter((line) => line.trim() && !line.startsWith('#') && !line.startsWith('API_INTERNAL_URL='))
  .concat('API_INTERNAL_URL=http://localhost:4100')
  .join('\n');
writeFileSync('dist/server/.dev.vars', `${vars}\n`);

const server = spawn('pnpm', ['exec', 'astro', 'preview', '--port', '4400', '--ignore-lock'], {
  stdio: 'inherit',
});
const stop = () => server.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.on('exit', (code) => process.exit(code ?? 0));
