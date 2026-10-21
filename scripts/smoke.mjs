// Starts the built executable and checks that it answers /ping.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const expectedVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const exe = join(root, 'build', process.platform === 'win32' ? 'mctwain.exe' : 'mctwain');
const port = 7799;
const child = spawn(exe, [], { env: { ...process.env, MCTWAIN_PORT: String(port) }, stdio: 'inherit' });

child.on('error', (err) => console.error('failed to start:', err.message));
child.on('exit', (code, signal) => console.error(`mctwain exited early: code=${code} signal=${signal}`));

let ok = false;
for (let i = 0; i < 40 && !ok; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try {
    const body = await (await fetch(`http://127.0.0.1:${port}/ping`)).json();
    ok = body.ok === true && body.name === 'mctwain' && body.version === expectedVersion;
  } catch {
    // not up yet
  }
}
child.removeAllListeners('exit');
child.kill();
console.log(ok ? 'smoke test passed' : 'smoke test FAILED');
process.exit(ok ? 0 : 1);
