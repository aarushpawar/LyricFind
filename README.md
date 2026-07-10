# LyricFind

LyricFind is a responsive, privacy-conscious karaoke companion for the music playing around you. It captures a rolling ten-second microphone window in the browser, generates a Shazam-compatible fingerprint locally with WebAssembly, and sends only that fingerprint to a small Cloudflare Worker. Lyrics come directly from LRCLIB and are highlighted against a monotonic playback clock.

Production URL: `https://aarushpawar.github.io/LyricFind/`

## How it works

1. An `AudioWorklet` mixes the chosen microphone to mono and retains at most ten seconds of PCM.
2. A module Web Worker runs `shazamio-core` WebAssembly. The transferred PCM is zeroed after fingerprinting and its WASM allocation is freed.
3. The fingerprint, anonymous client UUID, and sample duration go to `POST /recognize` on the Cloudflare Worker. Raw audio never leaves the browser.
4. The Worker validates and rate-limits the request, relays it to Shazam’s unofficial endpoint, and returns only normalized track/timing fields.
5. The browser selects synchronized or plain lyrics from LRCLIB and re-anchors the lyric clock on every successful scan.

Automatic scans are at least 12 seconds apart, never overlap, pause in hidden tabs, and resume immediately on return. A manual scan always uses the newest complete sample. One no-match keeps the current song; a second consecutive miss clears it. Network failures retain the current lyrics.

## Local development

Requirements: a current Node.js release and an HTTPS origin for microphone testing (localhost is treated as secure by browsers).

```powershell
npm.cmd install
Copy-Item .env.example .env.local
npm.cmd run dev
```

Set `VITE_RECOGNITION_URL` in `.env.local` to a deployed Worker or a local `wrangler dev` URL. In another terminal:

```powershell
Set-Location worker
npm.cmd install
npm.cmd run dev
```

Useful checks:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:browser
Set-Location worker
npm.cmd test
npm.cmd run typecheck
```

## Deployment

The repository contains independent GitHub Actions workflows:

- `pages.yml` tests, builds with Vite’s `/LyricFind/` base path, and deploys `dist/` to GitHub Pages.
- `worker.yml` tests and deploys the Worker on changes under `worker/`.

Configure these repository settings before the first deployment:

- Actions secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- Actions variable: `VITE_RECOGNITION_URL` (the public Worker origin, without `/recognize`)
- Settings → Pages → Source: **GitHub Actions**

The Worker permits `https://aarushpawar.github.io` plus local Vite development origins and rejects originless recognition calls. Two native bindings enforce ten recognition requests per minute for both the persistent client UUID and Cloudflare’s server-supplied connecting IP, so rotating UUIDs cannot bypass the public limit. Visitors sharing one public IP also share that IP allowance. If rate-limit namespace `1001` or `1002` is already used by another binding in the Cloudflare account, choose new positive integers in `worker/wrangler.jsonc`.

## Verification checklist

Automated coverage includes LRC parsing, lyrics selection, drift calculations, scheduling, state transitions, Worker validation/normalization/CORS/rate limiting, and browser flows with mocked microphone and services. Before a public release, play real speaker audio and verify Chrome, Edge, Firefox, Safari, and one mobile browser. Include a song change, manual rescan correction, permission denial/recovery, background/foreground resume, plain lyrics, and offline recovery.

## Prototype constraints

Recognition uses a reverse-engineered Shazam endpoint and may change without notice. LRCLIB is community-maintained, so lyric availability and timestamps vary. Lyrics are fetched on demand and are not stored by LyricFind. This repository is intended as a public, noncommercial prototype.
