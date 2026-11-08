import { execFileSync } from 'node:child_process';

export default function globalSetup() {
  execFileSync('pnpm', ['--filter', '@sol-y-luna/api', 'e2e:prepare'], { stdio: 'inherit' });
}
