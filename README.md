# Brisk

**Drop a folder, get a site.**

Brisk is an open-source internal hosting platform inspired by Shopify's
[Quick](https://shopify.engineering/quick). Anyone on your team can upload a
folder of HTML and get a live URL in seconds, plus a zero-config browser API
for the things every little site eventually wants:

```html
<script src="/brisk.js"></script>
<script>
  const posts = brisk.db.collection('posts');          // a database
  await posts.create({ title: 'Hello' });
  posts.subscribe({ onCreate: render });               // realtime updates

  const user = await brisk.me();                       // identity, no login flow
  const res  = await brisk.ai.chat('Summarize: …');    // AI, no API keys
  const file = await brisk.fs.upload(input.files);     // file storage
  brisk.channel('lobby').send({ hi: 1 });              // multiplayer websockets
</script>
```

No frameworks, no deploy pipelines, no config files, no permissions. It runs
entirely on Cloudflare (one Worker + R2 + D1 + Durable Objects) and costs
approximately nothing.

**What you get:**

- **Instant hosting** — `brisk deploy` any folder; it's live at
  `https://<name>.<your-host>/` in about a second. Deploys are atomic, names
  are first come, and anyone can overwrite anything.
- **Six backend primitives**, callable from any page with zero setup:
  database, identity, AI, file storage, realtime channels, and the static
  hosting itself.
- **A dashboard** at the apex domain listing every site on the instance —
  a living changelog of what your team is making — plus a one-page SDK
  reference at `/docs`.
- **A CLI** with watch-mode deploys (`brisk dev`) and the ability to download
  any site's source (`brisk pull`) to remix it.
- **One login for everything** (optional): Google OAuth on the apex domain
  with a session cookie that covers every site subdomain.

> **The trust model is the feature.** Brisk is for _internal_ use, behind a
> login. Every site is visible and writable by every teammate. That's what
> deletes all the complexity: no site owners, no API keys, no spam. Read
> [Philosophy](#philosophy) before deploying it anywhere public.

## Running locally

Everything runs on your machine via `wrangler dev` (Cloudflare's local
runtime) — no Cloudflare account needed. Prerequisites: Node ≥ 22, pnpm.

```sh
git clone <this repo> && cd brisk
pnpm install && pnpm build

# terminal 1 — the platform
cd worker
npx wrangler d1 migrations apply brisk --local   # creates the local database
npx wrangler dev                                 # http://localhost:8787

# terminal 2 — ship a site
node cli/dist/cli.js init my-site
node cli/dist/cli.js deploy my-site    # → http://localhost:8787/s/my-site/
```

Open http://localhost:8787 for the dashboard. `*.localhost` subdomains work
too: http://my-site.localhost:8787. Local state (R2 objects, the D1 database,
Durable Objects) lives under `worker/.wrangler/` and survives restarts.

Optional local extras go in `worker/.dev.vars` (see
[`.dev.vars.example`](worker/.dev.vars.example)) — e.g. an `ANTHROPIC_API_KEY`
to exercise `brisk.ai` locally.

## Deploying to Cloudflare

You need a Cloudflare account and, for subdomain URLs, a domain on it.

```sh
cd worker

# 1. Create the resources
npx wrangler d1 create brisk          # paste the id into wrangler.jsonc
npx wrangler r2 bucket create brisk

# 2. Apply the schema
npx wrangler d1 migrations apply brisk --remote

# 3. Ship it
pnpm --filter @brisk/sdk build        # bundles the SDK into worker assets
npx wrangler deploy
```

That gives you path-mode URLs (`https://brisk.<account>.workers.dev/s/foo/`)
with no auth, suitable for a private network. For the full experience:

### Wildcard subdomains

Add routes in `wrangler.jsonc` (see the comment there) so `foo.brisk.example.com`
serves site `foo`:

```jsonc
"routes": [
  { "pattern": "brisk.example.com", "custom_domain": true },
  { "pattern": "*.brisk.example.com/*", "zone_name": "example.com" }
],
"vars": { "BASE_HOST": "brisk.example.com", ... }
```

You'll also need a wildcard DNS record (`*.brisk` → CNAME to the apex) and a
[Total TLS or advanced certificate](https://developers.cloudflare.com/ssl/edge-certificates/)
covering `*.brisk.example.com`.

### Google login (one login for every site)

Brisk's answer to "identity-aware proxy": optional Google OAuth on the apex
domain, with the session cookie scoped to `.brisk.example.com` so a single
login covers every site subdomain.

1. Create an OAuth client (web application) in Google Cloud Console with
   redirect URI `https://brisk.example.com/auth/callback`.
2. Configure the worker:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET     # any long random string
npx wrangler secret put DEPLOY_TOKEN       # token the CLI will use
```

3. In `wrangler.jsonc` set `"AUTH": "google"` and, to restrict who gets in,
   `"ALLOWED_EMAIL_DOMAINS": "yourco.com"`.

Browsers get redirected to Google. The CLI logs in as a real person:

```sh
brisk login brisk.example.com    # opens the browser, stores a personal token
```

Deploys are then attributed to your email on the dashboard. The
`DEPLOY_TOKEN` secret is for CI (`BRISK_TOKEN=<DEPLOY_TOKEN>`, shows up as
`ci@brisk`). With `AUTH: "none"` (the default) everyone is a trusted dev
user — only do that on a network you trust.

### AI

```sh
npx wrangler secret put ANTHROPIC_API_KEY   # and/or OPENAI_API_KEY
```

Keys stay on the server; sites call `brisk.ai.chat(...)` with no setup.

## The CLI

```sh
npm install -g @brisk/cli       # or run from this repo: node cli/dist/cli.js

brisk init [name]               # scaffold a folder (brisk.json, index.html, AGENTS.md)
brisk deploy [dir]              # upload, get a URL
brisk dev [dir]                 # redeploy on every save
brisk list                      # everything on the instance
brisk open [site]               # open in the browser
brisk pull <site> [dir]         # download any site's source to remix it

brisk login [server]            # log in to an instance, creates a profile
brisk whoami                    # who you are, where
brisk profiles                  # list profiles; `brisk profile use <name>` switches
```

Profiles work like AWS profiles: one per Brisk instance you use, stored in
`~/.config/brisk/config.json`. `brisk login brisk.example.com` opens the
browser, finishes the instance's Google login, and stores a personal token —
deploys are then attributed to _you_. Every command takes `--profile <name>`
(or `BRISK_PROFILE`); a repo can pin its instance with `server` in
`brisk.json` and the CLI picks the matching profile automatically. For CI,
skip profiles entirely: `BRISK_SERVER` + `BRISK_TOKEN`.

`brisk init` also drops an `AGENTS.md` so coding agents immediately know the
SDK — "make me a lunch-voting site" works out of the box.

## The SDK

Full reference lives on your instance at `/docs`. The shape of it:

| Namespace                      | What you get                                                              |
| ------------------------------ | ------------------------------------------------------------------------- |
| `brisk.db.collection(name)`    | Schemaless JSON docs: `create / list / get / update / delete / subscribe` |
| `brisk.me()`                   | `{ email, name, picture }` of whoever is looking at the page              |
| `brisk.ai.chat(prompt, opts?)` | LLM calls proxied through the server's keys                               |
| `brisk.fs.upload(files)`       | Permanent URLs for user uploads                                           |
| `brisk.channel(name)`          | Realtime messaging + presence per site                                    |

Everything is namespaced per site. Docs and channels of one site are invisible
to another, purely as a convenience (it's all one happy trust bubble).

## Architecture

The whole platform is one Worker and four Cloudflare primitives:

```
foo.brisk.example.com ─┐
bar.brisk.example.com ─┤→ Worker ──→ /s/… static files ──→ R2  (versioned deploys)
brisk.example.com ─────┘    │
  (Google OAuth here,       ├→ /api/db, /api/sites ──────→ D1  (docs + deploy pointers)
   cookie covers *.domain)  ├→ /api/ws ──────────────────→ Durable Object per site
                            ├→ /api/ai ──────────────────→ Anthropic / OpenAI (server keys)
                            └→ /api/fs, /files ──────────→ R2  (uploads)
```

- **Deploys are atomic**: files upload under a fresh version prefix in R2, then
  the site's pointer row in D1 swaps. A site is never served half-updated, and
  the previous version is cleaned up after the swap.
- **Realtime is one Durable Object per site** (websocket hibernation, so idle
  rooms cost nothing). It fans out db change events, channel messages, and
  presence.
- **Identity is platform-level**: Google OAuth on the apex, JWT session cookie
  scoped to the parent domain, every request arrives pre-authenticated — the
  same trick as putting a VM behind an identity-aware proxy.

### Request flow

1. A request arrives; the Worker derives the **site** from the subdomain, the
   `/s/<site>/` path prefix, or the SDK's `x-brisk-site` header. The bare host
   is just a site named `home` (the built-in dashboard, until someone deploys
   over it).
2. The **auth middleware** resolves a user: dev identity (`AUTH=none`),
   session cookie, or CLI bearer token. Unauthenticated browsers bounce to
   Google; APIs get a 401.
3. Static requests look up the site's live deploy pointer (cached ~5s per
   isolate) and stream the file from R2, resolving `/about` → `about.html`
   and directory indexes. API requests hit D1/R2 directly; `/api/ws` upgrades
   are handed to the site's Durable Object with the user attached.

### Storage layout

| Where                             | What                                                           |
| --------------------------------- | -------------------------------------------------------------- |
| R2 `deploys/<site>/<version>/…`   | site files; one immutable prefix per deploy                    |
| R2 `uploads/<site>/<id>/<name>`   | `brisk.fs` uploads, immutable URLs                             |
| D1 `sites`                        | one row per site: live-deploy pointer, size, who deployed last |
| D1 `docs`                         | the document store: `(site, collection, id) → JSON`            |
| Durable Object `SiteRoom(<site>)` | websocket fan-out: db events, channel messages, presence       |

Nothing else persists. Deleting a site removes its row, docs, deploys, and
uploads.

## Philosophy

Stolen proudly from Quick:

- **Keep it simple.** Six primitives, no more. Feature requests are usually
  demos waiting to happen with the existing pieces.
- **No permissions.** No site owners. Want to update a site? Overwrite it.
  Want a subdomain? Take it. Internal trust makes "should we add a
  leaderboard?" a _hell yes_ instead of a security review.
- **The constraints are the point.** No custom backends, no cron jobs, no
  build steps. A folder of files, a URL, and six APIs.

## Development

```sh
pnpm install
pnpm build          # sdk → worker assets, cli → dist
pnpm test           # worker integration tests (vitest + workers pool)
pnpm typecheck
pnpm format
```

The repo is a pnpm workspace: [`worker/`](worker) (the platform),
[`sdk/`](sdk) (browser client served at `/brisk.js`), [`cli/`](cli), and
[`examples/`](examples).

## License

[MIT](LICENSE)
