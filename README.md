# mctwain

A small local helper that lets a web page scan documents from a scanner on your network.

Browsers can't talk to scanners directly: scanners don't send CORS headers, plain-HTTP scanners are blocked from
HTTPS pages, and there is no web API for scanning. mctwain runs on your computer, listens on `127.0.0.1`, and relays
requests from an allowed web page to the scanner.

```
web page  ──fetch──►  mctwain (127.0.0.1:7788)  ──eSCL/HTTP──►  scanner
```

## Status

- **Supported:** network scanners that speak **eSCL** (AirScan / Mopria), found automatically over mDNS, both plain
  HTTP (`_uscan`) and HTTPS (`_uscans`). Flatbed and document feeder (ADF).
- **Not yet:** USB-only scanners, and real TWAIN / WIA / SANE drivers. The name is a goal, not a feature yet.
- **macOS on Intel is not supported yet:** the single-executable build crashes at startup there. Apple Silicon works.
- Tested on a Brother MFC-L2710DN (flatbed and ADF). Windows and Linux packages are built by CI but have had little
  manual testing, so please open an issue if something is off.

## Install

### Homebrew (macOS and Linux)

```
brew install mormitech/tap/mctwain
brew services start mctwain    # runs it now and at every login
```

This needs no security prompts and works on Intel Macs too. To stop it: `brew services stop mctwain`.

If you `brew uninstall mctwain` while it runs, the helper notices that its files are gone and shuts itself down within
about 30 seconds. (Version 0.1.0 doesn't: stop it first with `brew services stop mctwain`.)

### Installers

Download the file for your system from the [latest release](../../releases/latest).

| OS | File | Install |
|---|---|---|
| macOS (Apple Silicon) | `mctwain-<version>-macos-arm64.dmg` | Open the DMG, double-click **Install mctwain** |
| Windows (x64) | `mctwain-<version>-windows-x64.zip` | Unzip, double-click **Install mctwain.cmd** |
| Linux (x64 / arm64) | `mctwain-<version>-linux-<arch>.tar.gz` | Extract, run `./install.sh` |

The installer puts the helper in your user folder (no admin rights) and starts it at login. To remove it, use
**Uninstall mctwain** (macOS), **Uninstall mctwain.cmd** (Windows) or `./uninstall.sh` (Linux).

### Security prompts

The releases are not code-signed yet, so the operating system warns on first launch:

- **macOS:** double-click the installer, then open **System Settings → Privacy & Security** and click **Open Anyway**
  next to the blocked "Install mctwain" message. Or run `xattr -d com.apple.quarantine <file>.dmg` before opening it.
- **Windows:** SmartScreen shows "Windows protected your PC". Click **More info → Run anyway**.
- **Linux:** none.

## API

All endpoints answer only requests from allowed origins and bind to `127.0.0.1`.

| Request | Description |
|---|---|
| `GET /ping` | `{ "ok": true, "name": "mctwain", "version": "…" }`. Cheap liveness check; clients can poll it. |
| `GET /devices` | Searches the network for ~5 s and returns every scanner that answered: `{ "devices": [{ "guid", "name", "model", "host", "ip", "port", "scheme" }] }`. |
| `GET /devices/{guid}` | One scanner with its **capabilities** and live **status**. |
| `POST /scan?device={guid}&source=&dpi=&color=&duplex=&paper=` | Scans and returns `{ "pages": ["<base64 jpeg>", …] }`. |

**GUIDs.** A scanner's GUID is the UUID it announces over mDNS (almost all eSCL scanners do). If it announces none,
mctwain derives a stable one from the scanner's host name and model, with no timestamp, so the same scanner always gets
the same GUID. Found scanners are cached; one that misses two searches in a row is dropped.

**Capabilities** (`GET /devices/{guid}`):

```jsonc
{
  "guid": "e3248000-…", "name": "…", "model": "…", "host": "…", "ip": "…", "port": 80, "scheme": "http",
  "status": { "state": "Idle", "adfState": "ScannerAdfLoaded" },   // adfState: is paper in the feeder?
  "capabilities": {
    "make": "…", "model": "…", "uuid": "…", "escl": "2.63",
    "sources": {
      "platen": { "colorModes": ["BlackAndWhite1","Grayscale8","RGB24"], "formats": ["image/jpeg", …],
                  "resolutions": { "values": [100,200,300,600], "range": null },
                  "size": { "unit": "1/300 inch", "minWidth": 64, "maxWidth": 2550, "minHeight": 64, "maxHeight": 3507 },
                  "intents": ["Document", …] },
      "feeder": { "capacity": 20, "simplex": { …same as platen… }, "duplex": null }   // null: not supported
    }
  }
}
```

`sources.platen` is `null` for a scanner without a flatbed and `sources.feeder` is `null` without a feeder.

**Scan options** (all optional; unsupported values are rejected with a `400` that says what is supported):

| Parameter | Values | Default |
|---|---|---|
| `source` | `platen` (flatbed), `feeder` | `feeder` if the scanner has one, else `platen` |
| `dpi` | a resolution the scanner supports | 300, or the closest supported |
| `color` | `color`, `gray`, `bw` | `color` |
| `duplex` | `true` (both sides, feeder only), `false` | `false` |
| `paper` | `a4`, `letter`, `legal`, `max` (everything the scanner can scan); never larger than the scanner | `a4` |

```js
const base = 'http://127.0.0.1:7788';
const { devices } = await (await fetch(`${base}/devices`)).json();
const { guid } = devices[0];
const { capabilities } = await (await fetch(`${base}/devices/${guid}`)).json();
const res = await fetch(`${base}/scan?device=${guid}&source=feeder&dpi=300&color=gray`, { method: 'POST' });
const { pages } = await res.json(); // base64 JPEGs, one per sheet
```

Errors are `{ "error": "…", "details": … }` with status `400` (bad options), `404` (unknown GUID: call `/devices`
first) or `502` (the scanner failed or is not reachable).

Each `/devices` call searches for 5 seconds, so clients should poll it (the sample page asks again 10 s after each
answer) to see scanners that are switched on or off. Scanner addresses come only from the search, never from the
client, and mctwain only contacts private-network addresses.

HTTPS scanners use self-signed certificates, so their certificates are not verified. Traffic stays on the local
network, but it is not protected against someone impersonating the scanner there. A scanner that offers both HTTP and
HTTPS is used over HTTP, since some HTTPS implementations use TLS versions Node refuses.

> **0.2.0 breaking change:** `/scan` takes `device={guid}` instead of a URL, and `/devices` no longer returns `url`,
> `id`, `sources` or `duplex`; read those from `/devices/{guid}`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MCTWAIN_PORT` | `7788` | Port on `127.0.0.1` |
| `MCTWAIN_DISCOVERY_MS` | `5000` | How long each `/devices` request listens for scanners |
| `MCTWAIN_ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:5174,http://localhost:4173` | Comma-separated web origins allowed to use the helper |

Release builds only allow the local development origins above. To allow your own site, build with
`MCTWAIN_ORIGINS=https://your-site.example npm run build`, or set `MCTWAIN_ALLOWED_ORIGINS` when running the helper.

## Build from source

```
npm install
npm run dev        # run with auto-reload
npm run build      # installer package for the current OS and CPU, in dist/
npm test           # unit tests (node --test)
npm run smoke      # start the built executable and check /ping
```

`npm run build` bundles the server with esbuild and turns it into a single executable using Node's
[single executable applications](https://nodejs.org/api/single-executable-applications.html), so users don't need
Node. It downloads the official Node binary (checksum-verified), because distro builds such as Homebrew's can't be
used for this. Push a tag like `v0.1.0` to publish a release with all platforms via GitHub Actions.

## Releasing

`package.json` is the single source of truth for the version (the helper reports it on `/ping`, and the build names its
files after it).

```
npm version patch -m "Release %s"   # bumps package.json and package-lock.json, commits, tags vX.Y.Z
git push --follow-tags              # CI builds every platform and publishes the GitHub release
```

Then update `url` and `sha256` in the Homebrew tap formula.

## Notes on scanners

- Brother scanners ignore the whole scan request unless it is sent as `Content-Type: application/xml`. With
  `text/xml` they silently scan the glass at default settings.
- The MFC-L2710DN only feeds from the ADF when the request includes `<scan:Duplex>false</scan:Duplex>`.

## License

MIT
