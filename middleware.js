import { NextResponse } from 'next/server';

// A flat env var flag rather than a database toggle on purpose: this needs
// to keep working even when Supabase (or whatever's being migrated) is the
// thing that's down, so it can't depend on a successful DB read to decide
// whether to show the maintenance page.
const BYPASS_COOKIE = 'kpb_maintenance_bypass';

export function middleware(request) {
  if (process.env.MAINTENANCE_MODE !== 'true') return NextResponse.next();

  const secret = process.env.MAINTENANCE_BYPASS_SECRET;
  const { searchParams } = request.nextUrl;

  // Visiting once with ?bypass=<secret> sets a cookie so whoever's doing
  // the maintenance can keep browsing the real site while everyone else
  // sees the maintenance page, without needing the query param on every link.
  if (secret && searchParams.get('bypass') === secret) {
    const res = NextResponse.next();
    res.cookies.set(BYPASS_COOKIE, secret, { maxAge: 60 * 60 * 12, httpOnly: true, sameSite: 'lax' });
    return res;
  }
  if (secret && request.cookies.get(BYPASS_COOKIE)?.value === secret) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = '/maintenance';
  url.search = '';
  return NextResponse.rewrite(url);
}

export const config = {
  // Excludes the maintenance page itself (or this would rewrite-loop),
  // Next internals, the API (so webhooks/health checks keep working), and
  // the favicon/app icon so browser tabs don't break while it's up.
  matcher: ['/((?!_next|api|maintenance|favicon.ico|icon.png).*)'],
};
