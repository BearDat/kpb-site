super awesome thing idk

## How the site loads data

The whole league is one ~1.6 MB JSON blob in `kv_store`, and each `team:` row
carries its logo as a base64 data URI, so the pages used to spend 0.5–1.2s on
Supabase reads *per navigation*. Every tab click paid that again.

Now there is one slim snapshot instead. `lib/snapshot.js` reads the league and
every team it references in two queries, drops what no page needs (odds caches,
audit log, pending trades) and swaps every embedded image for a URL pointing at
the `/api/team-logo/[teamId]` proxy, which already served logos with an ETag.
That takes 1.6 MB down to ~240 KB, about 37 KB over the wire.

`app/api/league-snapshot` serves it with `s-maxage=60`, and `getSnapshot()`
caches it for the same 60 seconds so the origin does the work at most once a
minute no matter how many people are watching. That cache has two layers: an
in-process variable (fast, but scoped to a single Worker isolate) and a
Cloudflare KV namespace (`SNAPSHOT_CACHE`, shared across every isolate/colo).
The KV layer is the one that actually matters on Workers — without it, a
route marked `force-dynamic` with a client that polls on `cache: 'no-store'`
gets re-executed independently in every colo handling traffic, and the
in-memory cache alone barely dedupes anything.

`lib/LeagueContext.jsx` is the client half. The site layout renders the snapshot
into `<LeagueProvider initial={…}>` so the first paint has real data with no
loading state, then the provider polls `/api/league-snapshot` every 60 seconds,
skipping the poll while the tab is hidden and catching up on focus. It also
keeps a copy in `sessionStorage` as a fallback for a reload that cannot reach
the server.

Every page under `app/(site)` is therefore a client component that reads
`useSeason()` or `useLeague()` and does no data fetching of its own. That is
what makes moving between tabs instant: the pages are static, Next prefetches
them, and the data they need is already in memory. The footer's Live dot shows
when a refresh is in flight and turns red if one fails; clicking it forces a
refresh.

The one thing to keep in mind when adding a page: put derived logic in
`lib/domain/*`, which is plain functions over the snapshot shape and runs on
either side of the wire. Anything that needs the raw league blob — admin
writes, anything with images — belongs in `/classic`, which still talks to
Supabase directly.

## Deploying (Cloudflare Workers)

This app runs on Cloudflare Workers via the [OpenNext adapter](https://opennext.js.org/cloudflare)
(`@opennextjs/cloudflare`), not Vercel. Two things moved off Vercel/Supabase
for the same reason: both bill for bandwidth once you're past a free tier,
and this is a media-serving site. Cloudflare's Workers bandwidth and R2's
egress are both free at any volume, so there's no metered-bandwidth line
item left that a popular clip or a traffic spike can run up.

Cloudflare currently recommends a newer tool called `vinext` over OpenNext
for *new* Next.js-on-Workers projects, but it's beta, requires Next.js 16 and
React 19.2.6+, and reimplements the Next.js API surface on Vite rather than
adapting the standard `next build` output. That's a much bigger, riskier
change than this project needed — OpenNext stays fully supported for an app
already on Next 15/React 18, so that's what this uses. Worth revisiting if
this app's Next.js version gets upgraded separately later.

**One-time Cloudflare setup** (dashboard, not code):
1. Enable R2 on the account (Dashboard → R2 → it'll prompt you once; no cost
   to enable, you only pay if you exceed the free tier — see the pricing note
   below).
2. Create an R2 bucket named `kpb-media` (or update the `bucket_name` in
   `wrangler.jsonc` to match whatever you name it).
3. Create a KV namespace for the page cache (Workers & Pages → KV) and put
   its ID into the `NEXT_INC_CACHE_KV` entry in `wrangler.jsonc`.
4. Create a second KV namespace for the league snapshot cache and put its ID
   into the `SNAPSHOT_CACHE` entry in `wrangler.jsonc`.

**wrangler.jsonc** wires those up as bindings (`MEDIA_BUCKET` for R2,
`NEXT_INC_CACHE_KV` for KV — that name is required exactly as-is, it's what
`@opennextjs/cloudflare`'s KV cache implementation looks for). The
`NEXT_INC_CACHE_KV` namespace is what makes `revalidate = 60` on the public
pages actually mean something on Workers — without it every cold isolate
starts with an empty cache and Supabase gets hit far more often than once a
minute.

`SNAPSHOT_CACHE` (an app-defined binding, any name works) backs the same
idea for `/api/league-snapshot`, which is `force-dynamic` and can't use the
page cache at all: `lib/snapshot.js` reads/writes the built snapshot there
with a 60-second TTL so every Worker isolate/colo shares one cache instead of
each hitting Supabase independently on every client poll.

**Environment variables** work differently than on Vercel because Next.js
still needs `NEXT_PUBLIC_*` values baked into the client bundle at *build*
time, not just available at request time:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_LEAGUE_ID`
  must be present as real env vars (a `.env.local` file, same as today)
  wherever `npm run cf:build` actually runs.
- Server-only values (`DISCORD_*` webhooks/tokens, `MAINTENANCE_MODE`,
  `MAINTENANCE_BYPASS_SECRET`) are only ever read at request time, so they
  go in via `wrangler secret put <NAME>` (or the dashboard's Variables tab)
  after the Worker exists, same as Vercel's env var settings today.

**Commands:**
- `npm run cf:build` — builds Next.js, then adapts the output for Workers
  into `.open-next/`.
- `npm run cf:preview` — builds, then serves it locally with `wrangler dev`
  against local-emulated bindings (a throwaway local R2/KV, not the real
  ones) — good for a final check before deploying.
- `npm run cf:deploy` — builds, then pushes it live with `wrangler deploy`.
  Needs `wrangler login` run once first (or `CLOUDFLARE_API_TOKEN` set, for
  CI).

**Auto-deploy on push** (`.github/workflows/deploy.yml`): every push to `main`
builds and deploys to Cloudflare automatically, the same way Vercel used to.
Add these as repo secrets (Settings → Secrets and variables → Actions →
New repository secret) before the workflow will actually work:
- `CLOUDFLARE_API_TOKEN` — a token scoped with the **Edit Cloudflare
  Workers** template (dashboard → My Profile → API Tokens → Create Token).
  Use a token dedicated to CI rather than reusing one you also run locally,
  so revoking one doesn't break the other.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `NEXT_PUBLIC_LEAGUE_ID` — same values as your local `.env.local`. These
  have to be GitHub secrets (not just Cloudflare secrets set later) because
  they're baked into the client bundle at build time, and the build runs on
  GitHub's runner, not on Cloudflare.

Nothing else (Discord tokens, `MAINTENANCE_MODE`, etc.) needs to be a GitHub
secret — those are read at request time by the deployed Worker, so they only
ever need setting once via `wrangler secret put` or the dashboard, not on
every deploy.

**Local dev** (`npm run dev`) still works exactly as before — the
`initOpenNextCloudflareForDev()` call in `next.config.js` gives `next dev`
access to local-emulated R2/KV bindings too, so admin uploads work without
needing the full Workers build.

**Cloudflare R2 pricing, so "why isn't this going to cost money" isn't just
asserted:** free tier is 10 GB storage, 1,000,000 write ops/month, 10,000,000
read ops/month — and egress (bandwidth to viewers) is **free, unmetered, on
every plan, forever**, which is the one line item that actually mattered
here. This project's media footprint is under 100 MB total, so storage and
operations aren't in reach of the free tier either.

**Domain cutover** (do this last, once a deploy is verified working on its
own `*.workers.dev` URL): the custom domain's DNS has to point at Cloudflare
instead of Vercel. If the domain's nameservers are already Vercel's
(`ns1/ns2.vercel-dns.com`), that means Vercel is the DNS host for the whole
zone, not just one record — check whether the domain is registered through
Vercel or elsewhere with nameservers pointed at Vercel (Vercel account →
Domains tells you which), then either edit nameservers there or at the
original registrar to Cloudflare's, after adding the domain as a site in
Cloudflare first (which auto-imports the existing DNS records so nothing
else on the domain — email, other subdomains — breaks in the switch).
Flip on [maintenance mode](#maintenance-mode) immediately before doing this,
since there's a window where DNS is propagating.

## Admin

`/admin` is the staff surface on the new site: the bot review queue and emoji
mappings, score and schedule editing, awards and Hall of Fame, hand-entered stat
lines, and news. Tabs appear according to the role on the account, using the
same permission names `lib/AuthContext.jsx` already defines.

Two things make it different from the rest of the site. It loads the **raw**
league blob rather than the snapshot, because the snapshot deliberately drops
fields no public page reads (odds caches, audit log, embedded images) and
writing back from it would destroy them. And every save goes through
`lib/leagueWrite.js`, which is compare-and-swap: read the row with its
`updated_at`, write only if it has not moved, retry a few times, and surface a
conflict rather than clobbering. That is the same contract the Discord bot uses.
After a successful write the public snapshot is rebuilt immediately via
`/api/league-snapshot?fresh=1` instead of waiting out the 60 second cache.

Mutations live in `lib/domain/mutations.js` and `lib/domain/applyPending.js` as
plain `(league) => league` functions, so the retry loop can re-apply them
against fresh data. `lib/domain/advance.js` holds the playoff-advancement code
extracted from the classic app, so both admin surfaces advance a bracket
identically.

The classic app at `/classic` still exists and still works, but nothing links to
it any more. Reach it by typing the URL when you need something the new panels
do not cover yet: season settings, divisions, imports, roster moves, badges,
banners, and admin management.


## News media

News images and highlight clips live in a **Cloudflare R2** bucket (`kpb-media`),
not Supabase — only the resulting URL is stored in the league blob. They've
lived in three places over this project's life: originally base64 data URIs
inside the league JSON itself (two news images accounted for more than half
of a 1.58 MB blob, and every unrelated write — a bot score, an admin save —
rewrote all of it under compare-and-swap; video was impossible outright),
then a Supabase Storage bucket, then briefly Vercel Blob. Both of the latter
two bill for egress bandwidth once you're past their free tier, and a
site-hosted video getting watched a few hundred times is enough to hit
those. R2 charges nothing for egress, ever, at any usage level — see
"Why Cloudflare" below.

Uploads go through a Next.js route (`/api/media-upload`) rather than
straight from the browser to storage: Workers requests can carry a far
larger body than a Vercel serverless function's few-MB cap, so there's no
need for Vercel Blob's client-side-direct-upload-token dance. The route
checks the request carries a valid Supabase session (the same "any admin
account" rule Storage's RLS used to enforce) before writing to the
`MEDIA_BUCKET` R2 binding, and enforces the 50 MB/file, image-or-video-only
limits itself rather than trusting the client. Serving is its own route too
(`/media/[...path]`), reading straight off the same binding with a
year-long immutable `Cache-Control` (every key already has a random suffix,
so a re-upload never collides with an old cached copy). Deleting goes
through `/api/media-delete`, same auth check, since only the server holds
the binding that can authorize one.

The files already sitting in the old Supabase `media` bucket and in Vercel
Blob from before these switches were left in place rather than migrated —
small enough not to matter, and it avoids rewriting existing highlight/news
URLs. Only new uploads go to R2.

Each post keeps a hero `imageUrl` — what the home page and news cards show —
plus a `media` array of everything attached. Uploaded files and pasted links
share that array; YouTube and Streamable links are converted to embeds, and any
other link renders as a plain link rather than an iframe from an arbitrary host.


## Article bodies

A news post's body is an ordered list of blocks in `post.blocks`, not HTML:
paragraph, heading, subheading, large text, quote, bullet list, numbered list,
and media. A media block just points at an entry in `post.media`, which is what
lets a clip or photo sit between two paragraphs rather than being listed at the
bottom.

No HTML is ever stored, so nothing on a public page is rendered from markup a
browser produced. Inline emphasis is a small marker syntax the toolbar writes
for you (`**bold**`, `*italic*`, `__underline__`, `[label](url)`), parsed in
`lib/domain/richtext.js` into React elements. Links are restricted to http and
https, and only YouTube and Streamable are ever put in an iframe.

Posts written before blocks existed still render: `normalizeBlocks` splits a
legacy `body` string on blank lines into paragraphs, so nothing needs migrating.

## Maintenance mode

Set `MAINTENANCE_MODE=true` (any deploy env var, not the database) to show a
full-page "down for maintenance" screen to every visitor instead of the real
site. It's an env var and not an admin-panel toggle on purpose: it needs to
keep working even when the thing that's actually down is Supabase itself (or
whatever host/database migration prompted turning it on in the first place),
so it can't depend on a successful read from either.

`middleware.js` checks the flag on every request and rewrites to
`app/maintenance/page.js` — a standalone page outside the `(site)` route
group, so it renders without calling `getSnapshot()` or touching Supabase at
all. `/api/*` is excluded from the rewrite, so webhooks (Discord interactions,
feedback, admin-notify) and anything else hitting the API keep working while
the public pages show maintenance.

To keep working on the real site while it's flipped on for everyone else, set
`MAINTENANCE_BYPASS_SECRET` to some random string and visit any page once
with `?bypass=<that secret>` — that sets a 12-hour cookie so you don't need
the query param on every link after that. Leave it blank to disable the
bypass entirely.

Turn it back off the same way: set `MAINTENANCE_MODE=false` (or unset it) and
redeploy.

## A note on concurrent writes

`/classic` used to write its whole in-memory league blob to Supabase as a blind
upsert whenever the tab was hidden, which silently reverted anything saved
elsewhere since that tab loaded. That flush is gone, and the classic app now
writes with the same compare-and-swap the bot and `/admin` use: a save from a
stale tab is rejected and the header offers **Changed elsewhere — Reload**
instead of overwriting.
