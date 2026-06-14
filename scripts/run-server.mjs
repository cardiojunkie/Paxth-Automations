#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';

const REQUIRED_MAJOR = 22;
const REQUIRED_MINOR = 12;
const serverArgs = ['--no-warnings', '--import', 'tsx', 'server.ts'];

function hasRequiredNode(version) {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > REQUIRED_MAJOR || (major === REQUIRED_MAJOR && minor >= REQUIRED_MINOR);
}

const useCurrentNode = hasRequiredNode(process.versions.node);
const command = useCurrentNode ? process.execPath : 'npx';
const args = useCurrentNode ? serverArgs : ['--yes', '-p', 'node@22', 'node', ...serverArgs];
const useShell = process.platform === 'win32' && !useCurrentNode;

if (!useCurrentNode) {
  console.warn(
    `[launcher] Node ${process.versions.node} detected; using npx node@22 because this app requires Node >=22.12.0.`
  );
}

const child = spawn(command, args, {
  stdio: 'inherit',
  env: process.env,
  shell: useShell,
});

child.on('error', (err) => {
  console.error(`[launcher] Failed to start server: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
