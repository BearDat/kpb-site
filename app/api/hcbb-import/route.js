// Server-side proxy for hcbb.info's leaderboard API (it doesn't send CORS
// headers, so the browser can't call it directly). Scoped to the KPB league
// only (league code BE1E0C) — this route isn't a general hcbb.info proxy.
const KPB_LEAGUE = 'BE1E0C';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const season = (searchParams.get('season') || '').trim();
  // hcbb.info controls which season numbers actually have data — this just
  // sanity-checks it's a positive integer, optionally with a trailing "P"
  // (hcbb.info's own convention for that season's playoffs — a separate
  // dataset under the same "season" param, e.g. "3P" for Season 3
  // playoffs, not a query flag) — and lets hcbb.info's own response (it
  // 403s with "This season is not authorized" for one it hasn't published
  // yet) be the real source of truth, rather than us guessing a fixed
  // cutoff that goes stale every time a new season starts.
  if (!/^[1-9][0-9]*P?$/.test(season)) {
    return Response.json({ error: 'season must be a positive whole number, optionally followed by "P" for that season’s playoffs' }, { status: 400 });
  }
  try {
    const res = await fetch(`https://hcbb.info/api/leaderboard/?league=${KPB_LEAGUE}&season=${season}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return Response.json({ error: `hcbb.info returned ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    // Pass the unfiltered per-player totals straight through — the app's
    // own "Qualify" concept (min games/at-bats/IP) is applied client-side
    // when displaying leaders, never by dropping rows here, so this always
    // returns every player hcbb has a line for that season.
    return Response.json(data, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (e) {
    return Response.json({ error: 'hcbb.info lookup failed' }, { status: 502 });
  }
}
