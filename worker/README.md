# LyricFind recognition Worker

The Worker accepts browser-generated Shazam fingerprints. Raw microphone audio
must never be sent to this service.

## API

- `GET /health` returns `{ "status": "ok" }`.
- `POST /recognize` accepts `{ clientId, signatureUri, sampleMs }` and returns a
  normalized `match` or `no_match` result.
- `OPTIONS` handles CORS preflight for the production GitHub Pages origin and
  the local Vite origins configured in `ALLOWED_ORIGINS`.

Valid recognition requests are rate-limited to 10 per minute per client UUID by
Cloudflare's rate-limit binding. The binding is per Cloudflare location, as
documented by Cloudflare, and intentionally runs only after payload validation.

## Local commands

```sh
npm install
npm test
npm run typecheck
npm run dev
```

`wrangler dev` supplies a local implementation of the configured binding. Set
`VITE_RECOGNITION_URL` in the frontend to the deployed Worker URL; no Shazam key
or recognition secret is required.

Before deployment, change `namespace_id` only if `1001` is already used by a
different rate-limit binding in the same Cloudflare account. Namespace IDs are
account-local positive integer strings.
