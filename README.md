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
memoises it in-process for the same 60 seconds, so the origin does the work at
most once a minute no matter how many people are watching.

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

News images and highlight clips live in **Vercel Blob**, not Supabase — only
the resulting URL is stored in the league blob. They used to live in a
Supabase Storage bucket (`supabase/storage.sql`, now unused by new uploads),
but Supabase bills egress on every byte served from Storage with no CDN layer
of ours in front of it, so a handful of highlight clips getting watched a few
hundred times was enough to threaten the free plan's 5GB/month egress limit.
Vercel Blob's bandwidth comes out of the project's own Vercel plan instead.

That split (media as a URL, not inline) matters on its own too: media used to
be base64 data URIs inside the league JSON, which meant two news images
accounted for more than half of a 1.58 MB blob, and every unrelated write — a
bot score, an admin save — rewrote all of it under compare-and-swap. Video was
impossible outright.

**Connect a Blob store before uploading anything**: Vercel dashboard -> the
project -> Storage -> Create Database -> Blob. Vercel auto-injects
`BLOB_READ_WRITE_TOKEN` into the project's env vars once it's connected — nothing
to copy by hand in production. For local dev, run `vercel env pull .env.local`
afterward to get it into your `.env.local`.

Uploads go straight from the browser to Blob rather than through a Next.js
route, because serverless request bodies are capped at a few megabytes and a
highlight clip is far larger than that — `/api/blob-upload-token` only hands
out a short-lived upload token (after checking the request carries a valid
Supabase session, the same "any admin account" rule Storage's RLS used to
enforce) and never sees the file itself. Deleting a file does go through a
route (`/api/blob-delete`), since only the server holds the token that can
authorize a delete. Uploads are capped at 50 MB per file and limited to image
and video MIME types (both enforced by the upload-token route, not just the
client).

The 7 files already sitting in the old Supabase `media` bucket from before
this switch were left in place rather than migrated — they're tiny (~64MB
total) and still serve fine from their existing URLs. Only new uploads go to
Blob.

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

## A note on concurrent writes

`/classic` used to write its whole in-memory league blob to Supabase as a blind
upsert whenever the tab was hidden, which silently reverted anything saved
elsewhere since that tab loaded. That flush is gone, and the classic app now
writes with the same compare-and-swap the bot and `/admin` use: a save from a
stale tab is rejected and the header offers **Changed elsewhere — Reload**
instead of overwriting.
