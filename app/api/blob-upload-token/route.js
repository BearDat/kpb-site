import { handleUpload } from '@vercel/blob/client';
import { createClient } from '@supabase/supabase-js';
import { ACCEPTED_UPLOAD, MAX_UPLOAD_BYTES } from '../../../lib/media';

export const runtime = 'nodejs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function POST(request) {
  const body = await request.json();
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      // Mints a client upload token, but only for someone with a valid
      // Supabase session (sent as a normal Authorization header, read off
      // the outer `request` by closure) — mirrors the "any authenticated
      // admin account" rule storage.sql used to enforce via Postgres RLS.
      onBeforeGenerateToken: async () => {
        const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data.user) throw new Error('You need to be logged in to upload.');
        return {
          allowedContentTypes: ACCEPTED_UPLOAD.split(','),
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: false,
        };
      },
    });
    return Response.json(jsonResponse);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}
