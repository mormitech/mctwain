# mctwain

A small local helper that lets a web page scan documents from a scanner on your network.

Browsers can't talk to scanners directly: scanners don't send CORS headers, plain-HTTP scanners are blocked from
HTTPS pages, and there is no web API for scanning. mctwain runs on your computer, listens on `127.0.0.1`, and relays
requests from an allowed web page to the scanner.

```
web page  ──fetch──►  mctwain (127.0.0.1:7788)  ──eSCL/HTTP──►  scanner
```

## Status

- **Supported:** network scanners that speak **eSCL** (AirScan / Mopria), found automatically over mDNS. Flatbed and
  document feeder (ADF).
- **Not yet:** USB-only scanners, and real TWAIN / WIA / SANE drivers. The name is a goal, not a feature yet.
- Tested on a Brother MFC-L2710DN (flatbed and ADF). Windows and Linux packages are built by CI but have had little
  manual testing, so please open an issue if something is off.

## Install

Download the file for your system from the [latest release](../../releases/latest).

| OS | File | Install |
|---|---|---|
| macOS (Apple Silicon / Intel) | `mctwain-<version>-macos-<arch>.dmg` | Open the DMG, double-click **Install mctwain** |
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
| `GET /ping` | `{ "ok": true, "name": "mctwain", "version": "…" }` |
| `GET /devices` | `{ "devices": [{ "id", "name", "url", "duplex", "sources" }] }` found via mDNS |
| `POST /scan?device=<url>&source=platen\|feeder&dpi=300&color=true` | `{ "pages": ["<base64 jpeg>", …] }` |

```js
const { devices } = await (await fetch('http://127.0.0.1:7788/devices')).json();
const res = await fetch(`http://127.0.0.1:7788/scan?device=${encodeURIComponent(devices[0].url)}&source=feeder`, {
  method: 'POST',
});
const { pages } = await res.json(); // base64 JPEGs, one per sheet
```

`device` must be a LAN address (private ranges or `*.local`); anything else is rejected.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MCTWAIN_PORT` | `7788` | Port on `127.0.0.1` |
| `MCTWAIN_ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:5174,http://localhost:4173` | Comma-separated web origins allowed to use the helper |

Release builds only allow the local development origins above. To allow your own site, build with
`MCTWAIN_ORIGINS=https://your-site.example npm run build`, or set `MCTWAIN_ALLOWED_ORIGINS` when running the helper.

## Build from source

```
npm install
npm run dev        # run with auto-reload
npm run build      # installer package for the current OS and CPU, in dist/
npm run smoke      # start the built executable and check /ping
```

`npm run build` bundles the server with esbuild and turns it into a single executable using Node's
[single executable applications](https://nodejs.org/api/single-executable-applications.html), so users don't need
Node. It downloads the official Node binary (checksum-verified), because distro builds such as Homebrew's can't be
used for this. Push a tag like `v0.1.0` to publish a release with all platforms via GitHub Actions.

## Notes on scanners

- Brother scanners ignore the whole scan request unless it is sent as `Content-Type: application/xml`. With
  `text/xml` they silently scan the glass at default settings.
- The MFC-L2710DN only feeds from the ADF when the request includes `<scan:Duplex>false</scan:Duplex>`.

## License

MIT
