# The test website (iae.cfod.co.uk)

The browser version runs from Cloudflare Pages, built from this repository.

| Setting | Value |
|---|---|
| Project | `iae-v2500` (Cloudflare Workers & Pages) |
| Production branch | `ccr-b314d629-a56f7k-opus` |
| Build command | `node tools/build-web.mjs` |
| Build output | `dist-web` |
| Environment variable | `ELECTRON_SKIP_BINARY_DOWNLOAD` = `1` (Cloudflare installs the packages first; the website does not need Electron) |
| Custom domain | `iae.cfod.co.uk` (only the owner uses it) |

Every push to the production branch builds and deploys automatically.

**File size limit:** Cloudflare Pages refuses any file over 25 MiB, and with it the whole deploy. The
engine model is bigger than that (about 39 MB since the internals were modelled), so the build publishes
the gzipped copy (about 18 MB) and splits anything over 24 MiB into parts (`name.0`, `name.1` ...), which
the page fetches and joins. The manifest records how many (`packedParts`, `fileParts`). The build stops
with an error if any file in `dist-web` is still over the limit, so it fails locally rather than at the
upload. The build includes the
recordings `app/sounds/sounds.json` uses. `functions/_middleware.js` sends the `*.pages.dev` addresses
to `iae.cfod.co.uk`. The site is marked noindex (robots.txt and an X-Robots-Tag header).

**Phones:** touch controls (one finger orbit, pinch zoom, two-finger pan, tap to inspect), a phone
layout below 760 px wide or 560 px tall, Low quality and a 1.5x pixel-ratio cap on touch screens, a Full
screen button, and `manifest.webmanifest` so Add to Home screen opens it full screen in landscape.

**Which version is live:** the Sound menu ends in "build" and the commit (from `build.json`), and the log
(Panel > Monitor) has the same line.

**If a push does not deploy:** the project's Deployments list shows every build. A yellow "This project
is disconnected from your Git account" banner means Cloudflare lost its GitHub link: check the
Cloudflare Workers and Pages app still has access to the repository (GitHub > Settings > Applications),
then reconnect under the project's Settings > Builds. A deploy hook (Settings > Builds > Deploy hooks)
builds the latest commit on demand: `Invoke-WebRequest -Method POST -Uri "<hook URL>"` in PowerShell.
