import { spawnSync } from 'node:child_process';

const shouldInstall = (process.env.INSTALL_PLAYWRIGHT ?? 'true').toLowerCase() !== 'false';

if (!shouldInstall) {
  console.log('Skipping Playwright browser install (INSTALL_PLAYWRIGHT=false)');
  process.exit(0);
}

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

if (process.platform === 'linux') {
  run('playwright', ['install-deps', 'chromium']);
}

run('playwright', ['install', 'chromium']);