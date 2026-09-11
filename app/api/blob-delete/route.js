import { del } from '@vercel/blob';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Vercel Blob URLs are already unguessable (random store id + pathname),
// but this is still a public endpoint that deletes whatever URL it's
// handed, so it's gated the same way every other write in this app is:
// a valid Supabase session (any admin account).
export async function POST(request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error: authError } = await supabase.auth.getUser(token);
  if (authError || !data.user) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const url = String(body.url || '');
  if (!/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(url)) {
    return Response.json({ error: 'Not a Blob storage URL.' }, { status: 400 });
  }
  try {
    await del(url);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
