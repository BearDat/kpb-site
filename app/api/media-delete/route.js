import { getCloudflareContext } from '@opennextjs/cloudflare';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function POST(request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error: authError } = await supabase.auth.getUser(token);
  if (authError || !data.user) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const path = String(body.path || '');
  if (!/^(highlights|news)\//.test(path)) {
    return Response.json({ error: 'Invalid path.' }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  await env.MEDIA_BUCKET.delete(path);
  return Response.json({ ok: true });
}
