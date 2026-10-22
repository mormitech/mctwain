// Generates the Scoop manifest for a release (prints JSON).
//   node scripts/make-scoop-manifest.mjs [version] > ../scoop-bucket/bucket/mctwain.json
// Scoop downloads the plain zip (mctwain.exe + mctwain-tray.exe). post_install registers startup the same way the
// installer .exe does (HKCU Run entry + start.vbs in %LOCALAPPDATA%\mctwain) and starts both programs.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const version = process.argv[2] ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const repo = 'mormitech/mctwain';
const url = `https://github.com/${repo}/releases/download/v${version}/mctwain-bin-${version}-windows-x64.zip`;
const res = await fetch(url);
if (!res.ok) throw new Error(`${url}: HTTP ${res.status} (is the release published?)`);
const hash = createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex');

const RUN_KEY = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

const manifest = {
  version,
  description: 'Local helper that lets web pages scan documents from network scanners (eSCL/AirScan), with a tray icon',
  homepage: `https://github.com/${repo}`,
  license: 'MIT',
  architecture: { '64bit': { url, hash } },
  bin: 'mctwain.exe',
  post_install: [
    '# Scoop keeps the current version in ...\\apps\\mctwain\\current',
    "$current = Join-Path (Split-Path $dir -Parent) 'current'",
    "$target = Join-Path $env:LOCALAPPDATA 'mctwain'",
    'New-Item -ItemType Directory -Force -Path $target | Out-Null',
    '$vbs = @"',
    'Set sh = CreateObject("WScript.Shell")',
    'sh.Run """$current\\mctwain.exe""", 0, False',
    'sh.Run """$current\\mctwain-tray.exe""", 0, False',
    '"@',
    "Set-Content -Path (Join-Path $target 'start.vbs') -Value $vbs -Encoding ASCII",
    `if (-not (Test-Path '${RUN_KEY}')) { New-Item -Path '${RUN_KEY}' | Out-Null }`,
    `Set-ItemProperty -Path '${RUN_KEY}' -Name 'mctwain' -Value ('wscript.exe "' + (Join-Path $target 'start.vbs') + '"')`,
    "Start-Process wscript.exe -ArgumentList ('\"' + (Join-Path $target 'start.vbs') + '\"')",
  ],
  pre_uninstall: [
    'Get-Process -Name mctwain, mctwain-tray -ErrorAction SilentlyContinue | Stop-Process -Force',
    `Remove-ItemProperty -Path '${RUN_KEY}' -Name 'mctwain' -ErrorAction SilentlyContinue`,
    "Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA 'mctwain') -ErrorAction SilentlyContinue",
  ],
  checkver: 'github',
  autoupdate: {
    architecture: {
      '64bit': { url: `https://github.com/${repo}/releases/download/v$version/mctwain-bin-$version-windows-x64.zip` },
    },
  },
};
process.stdout.write(JSON.stringify(manifest, null, 4) + '\n');
