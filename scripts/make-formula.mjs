// Generates the Homebrew formula for a release.
//
//   node scripts/make-formula.mjs [version] > Formula/mctwain.rb          # release assets on GitHub
//   node scripts/make-formula.mjs --local dist > Formula/mctwain.rb      # local test: file:// archives in dist/
//
// Apple Silicon and Linux download finished executables (the helper embeds its own Node), so the formula has
// no Homebrew dependencies. Intel Macs, where the standalone helper does not work yet, fall back to installing
// the source with Homebrew's Node.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const localAt = args.indexOf('--local');
const localDir = localAt >= 0 ? resolve(args[localAt + 1]) : null;
const version = args.find((a, i) => !a.startsWith('--') && i !== localAt + 1) ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const repo = 'mormitech/mctwain';
const release = `https://github.com/${repo}/releases/download/v${version}`;

async function sha256(location) {
  let buf;
  if (location.startsWith('file:')) {
    buf = readFileSync(new URL(location));
  } else {
    const res = await fetch(location);
    if (!res.ok) throw new Error(`${location}: HTTP ${res.status} (is the release published?)`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  return createHash('sha256').update(buf).digest('hex');
}

// Where a platform's archive lives: the local dist/ folder (if it has the file) or the GitHub release.
function archive(label, arch) {
  const name = `mctwain-bin-${version}-${label}-${arch}.tar.gz`;
  if (localDir) return existsSync(join(localDir, name)) ? pathToFileURL(join(localDir, name)).href : null;
  return `${release}/${name}`;
}

const block = async (url, indent) => {
  const pad = ' '.repeat(indent);
  return `${pad}url "${url}"\n${pad}sha256 "${await sha256(url)}"\n`;
};

const macArm = archive('macos', 'arm64');
const linuxArm = archive('linux', 'arm64');
const linuxX64 = archive('linux', 'x64');
const source = `https://github.com/${repo}/archive/refs/tags/v${version}.tar.gz`;

let out = `class Mctwain < Formula
  desc "Local helper that lets web pages scan documents from network scanners"
  homepage "https://github.com/${repo}"
  version "${version}"
  license "MIT"

`;
if (macArm || !localDir) {
  out += `  on_macos do\n`;
  if (macArm) out += `    on_arm do\n${await block(macArm, 6)}    end\n`;
  if (!localDir) {
    // Intel: no standalone helper yet, so build from source on Homebrew's Node.
    out += `    on_intel do\n${await block(source, 6)}      depends_on "node"\n    end\n`;
  }
  out += `  end\n\n`;
}
if (linuxArm || linuxX64) {
  out += `  on_linux do\n`;
  if (linuxArm) out += `    on_arm do\n${await block(linuxArm, 6)}    end\n`;
  if (linuxX64) out += `    on_intel do\n${await block(linuxX64, 6)}    end\n`;
  out += `  end\n\n`;
}

out += `  def install
    if OS.mac? && Hardware::CPU.intel?
      system "npm", "install", *std_npm_args
      bin.install_symlink Dir["#{libexec}/bin/*"]
    else
      bin.install "mctwain"
      if File.exist?("mctwain-tray")
        bin.install "mctwain-tray"
        # One launchd job for both: the menu bar tray in the background, then the helper itself.
        # launchd stops them together, so \`brew services stop mctwain\` also removes the icon.
        (bin/"mctwain-run").write <<~SH
          #!/bin/sh
          "#{opt_bin}/mctwain-tray" &
          exec "#{opt_bin}/mctwain"
        SH
        chmod 0755, bin/"mctwain-run"
      end
    end
  end

  service do
    run [opt_bin/((OS.mac? && !Hardware::CPU.intel?) ? "mctwain-run" : "mctwain")]
    keep_alive successful_exit: false
    log_path var/"log/mctwain.log"
    error_log_path var/"log/mctwain.log"
  end

  test do
    port = free_port
    pid = fork do
      ENV["MCTWAIN_PORT"] = port.to_s
      exec bin/"mctwain"
    end
    sleep 3
    assert_match "\\"name\\":\\"mctwain\\"", shell_output("curl -s http://127.0.0.1:#{port}/ping")
  ensure
    Process.kill("TERM", pid)
    Process.wait(pid)
  end
end
`;
process.stdout.write(out);
