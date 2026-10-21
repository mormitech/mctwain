// Builds mctwain for the OS and CPU this runs on: bundle -> single executable -> installer package in dist/.
//   macOS:   .dmg with installer/uninstaller apps
//   Linux:   .tar.gz with install.sh / uninstall.sh (systemd user service)
//   Windows: .zip with install/uninstall scripts (starts at login)
// Usage: npm run build
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const NODE_VERSION = process.env.NODE_VERSION ?? 'v25.9.0';
const ORIGINS = process.env.MCTWAIN_ORIGINS ?? 'http://localhost:5173,http://localhost:5174,http://localhost:4173';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const out = join(root, 'build');
const dist = join(root, 'dist');
const stage = join(out, 'stage');

const PLATFORMS = {
  darwin: { node: 'darwin', archive: 'tar.gz', label: 'macos', exe: 'mctwain' },
  linux: { node: 'linux', archive: 'tar.xz', label: 'linux', exe: 'mctwain' },
  win32: { node: 'win', archive: 'zip', label: 'windows', exe: 'mctwain.exe' },
};
const target = PLATFORMS[process.platform];
if (!target || !['x64', 'arm64'].includes(process.arch)) {
  throw new Error(`Unsupported platform ${process.platform}/${process.arch}`);
}
const arch = process.arch;
const baseName = `mctwain-${pkg.version}-${target.label}-${arch}`;

const run = (cmd, args, opts) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
// Windows ships bsdtar in System32; Git's GNU tar can shadow it and cannot write zips.
const tar = process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
const template = (...path) => readFileSync(join(root, 'packaging', ...path), 'utf8').replaceAll('__ALLOWED_ORIGINS__', ORIGINS);

// 1. Official Node binary. Distro builds (e.g. Homebrew) can't be turned into a standalone executable.
async function officialNode() {
  const name = `node-${NODE_VERSION}-${target.node}-${arch}`;
  const cache = join(out, 'node-cache');
  const bin = process.platform === 'win32' ? join(cache, name, 'node.exe') : join(cache, name, 'bin', 'node');
  if (existsSync(bin)) return bin;
  mkdirSync(cache, { recursive: true });
  const base = `https://nodejs.org/dist/${NODE_VERSION}`;
  const file = `${name}.${target.archive}`;
  const buf = Buffer.from(await (await fetch(`${base}/${file}`)).arrayBuffer());
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const expected = sums.split('\n').find((l) => l.endsWith(`  ${file}`))?.split(' ')[0];
  if (!expected || expected !== createHash('sha256').update(buf).digest('hex')) {
    throw new Error(`Node checksum mismatch for ${file}`);
  }
  writeFileSync(join(cache, file), buf);
  run(tar, ['-xf', join(cache, file), '-C', cache]);
  return bin;
}

// 2. Bundle the server and its dependencies into one file.
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(root, 'src', 'server.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: join(out, 'server.cjs'),
  logLevel: 'warning',
});

// 3. Single executable from the bundle (code-signed ad hoc on macOS, required on Apple Silicon).
const node = await officialNode();
writeFileSync(
  join(out, 'sea-config.json'),
  JSON.stringify({ main: 'server.cjs', output: target.exe, disableExperimentalSEAWarning: true }),
);
rmSync(join(out, target.exe), { force: true });
run(node, ['--build-sea', 'sea-config.json'], { cwd: out });
if (process.platform === 'darwin') run('codesign', ['--sign', '-', '--force', join(out, target.exe)]);

// 4. Installer package.
rmSync(stage, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

if (process.platform === 'darwin') {
  const infoPlist = (name, id) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${name}</string>
  <key>CFBundleIdentifier</key><string>${id}</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>${pkg.version}</string>
  <key>CFBundleShortVersionString</key><string>${pkg.version}</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`;
  const makeApp = (name, id, launcherFile, withBinary) => {
    const app = join(stage, 'dmg', `${name}.app`);
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
    mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true });
    writeFileSync(join(app, 'Contents', 'Info.plist'), infoPlist(name, id));
    const launcher = join(app, 'Contents', 'MacOS', 'launcher');
    writeFileSync(launcher, template('macos', launcherFile));
    chmodSync(launcher, 0o755);
    if (withBinary) {
      cpSync(join(out, target.exe), join(app, 'Contents', 'Resources', 'mctwain'));
      chmodSync(join(app, 'Contents', 'Resources', 'mctwain'), 0o755);
    }
    run('codesign', ['--sign', '-', '--force', '--deep', app]);
  };
  makeApp('Install mctwain', 'com.mctwain.installer', 'install-launcher.sh', true);
  makeApp('Uninstall mctwain', 'com.mctwain.uninstaller', 'uninstall-launcher.sh', false);
  const dmg = join(dist, `${baseName}.dmg`);
  rmSync(dmg, { force: true });
  // Size the image explicitly: hdiutil's automatic size can come out too small ("No space left on device")
  // for a ~130 MB executable. The final UDZO image is compressed, so this only sizes the temporary one.
  const sizeMb = Math.ceil((statSync(join(out, target.exe)).size / 1e6) * 1.5 + 30);
  // hdiutil also fails intermittently on CI runners, so retry a few times.
  for (let attempt = 1; ; attempt++) {
    try {
      run(
        'hdiutil',
        ['create', '-volname', 'mctwain', '-srcfolder', join(stage, 'dmg'), '-fs', 'HFS+', '-size', `${sizeMb}m`, '-format', 'UDZO', '-ov', dmg],
        { stdio: ['ignore', 'ignore', 'inherit'] },
      );
      break;
    } catch (err) {
      if (attempt === 5) throw err;
      console.warn(`hdiutil failed (attempt ${attempt}/5), retrying...`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
    }
  }
  console.log(`Built ${dmg}`);
} else {
  const dir = join(stage, baseName);
  mkdirSync(dir, { recursive: true });
  cpSync(join(out, target.exe), join(dir, target.exe));
  const files =
    process.platform === 'linux'
      ? ['install.sh', 'uninstall.sh']
      : ['install.ps1', 'uninstall.ps1', 'Install mctwain.cmd', 'Uninstall mctwain.cmd'];
  for (const f of files) writeFileSync(join(dir, f), template(target.label, f));
  chmodSync(join(dir, target.exe), 0o755);
  for (const f of files.filter((f) => f.endsWith('.sh'))) chmodSync(join(dir, f), 0o755);

  if (process.platform === 'linux') {
    const archive = join(dist, `${baseName}.tar.gz`);
    run(tar, ['-czf', archive, '-C', stage, baseName]);
    console.log(`Built ${archive}`);
  } else {
    const archive = join(dist, `${baseName}.zip`);
    rmSync(archive, { force: true });
    run(tar, ['-a', '-cf', archive, '-C', stage, baseName]);
    console.log(`Built ${archive}`);
  }
}
