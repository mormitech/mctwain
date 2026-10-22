// Writes the three winget manifest files for a release.
//   node scripts/make-winget-manifest.mjs [version] [outDir]
// The files go in microsoft/winget-pkgs under manifests/m/mormitech/mctwain/<version>/ (submitted as a pull request).
// winget recognises the Inno Setup installer and runs it silently (/VERYSILENT /SUPPRESSMSGBOXES /NORESTART).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const version = process.argv[2] ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const outDir = resolve(process.argv[3] ?? join(root, 'build', 'winget', version));
const repo = 'mormitech/mctwain';
const id = 'mormitech.mctwain';
const schema = '1.6.0';

const url = `https://github.com/${repo}/releases/download/v${version}/mctwain-setup-${version}-windows-x64.exe`;
const res = await fetch(url);
if (!res.ok) throw new Error(`${url}: HTTP ${res.status} (is the release published?)`);
const sha = createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex').toUpperCase();

const files = {
  [`${id}.yaml`]: `PackageIdentifier: ${id}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: ${schema}
`,
  [`${id}.installer.yaml`]: `PackageIdentifier: ${id}
PackageVersion: ${version}
InstallerLocale: en-US
InstallerType: inno
Scope: user
InstallModes:
- interactive
- silent
- silentWithProgress
UpgradeBehavior: install
ReleaseDate: ${new Date().toISOString().slice(0, 10)}
Installers:
- Architecture: x64
  InstallerUrl: ${url}
  InstallerSha256: ${sha}
ManifestType: installer
ManifestVersion: ${schema}
`,
  [`${id}.locale.en-US.yaml`]: `PackageIdentifier: ${id}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: mormitech
PublisherUrl: https://github.com/mormitech
PublisherSupportUrl: https://github.com/${repo}/issues
PackageName: mctwain
PackageUrl: https://github.com/${repo}
License: MIT
LicenseUrl: https://github.com/${repo}/blob/main/LICENSE
ShortDescription: Local helper that lets web pages scan documents from network scanners.
Description: mctwain runs on your computer and lets web pages such as mcPrint scan from scanners on your network (eSCL/AirScan). It starts at login and shows a tray icon with the scanners it found.
Moniker: mctwain
Tags:
- airscan
- escl
- scanner
- scanning
ReleaseNotesUrl: https://github.com/${repo}/releases/tag/v${version}
ManifestType: defaultLocale
ManifestVersion: ${schema}
`,
};

mkdirSync(outDir, { recursive: true });
for (const [name, content] of Object.entries(files)) writeFileSync(join(outDir, name), content);
console.log(`Wrote ${Object.keys(files).length} manifest files to ${outDir}`);
