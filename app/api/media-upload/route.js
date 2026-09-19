import { getCloudflareContext } from '@opennextjs/cloudflare';
import { createClient } from '@supabase/supabase-js';
import { ACCEPTED_UPLOAD, MAX_UPLOAD_BYTES } from '../../../lib/media';

export const runtime = 'nodejs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ACCEPTED = ACCEPTED_UPLOAD.split(',');
const FOLDERS = ['highlights', 'news'];

function safeName(name) {
  return String(name || 'file')
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-80) || 'file';
}

// Workers can take a request body far larger than a Vercel serverless
// function's few-MB cap, so uploads go straight through this route (a
// server-side proxy into the R2 binding) instead of needing a client-side
// direct-to-storage token dance the way Vercel Blob required.
export async function POST(request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error: authError } = await supabase.auth.getUser(token);
  if (authError || !data.user) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form && form.get('file');
  const folder = form && String(form.get('folder') || '');
  const postId = form && String(form.get('postId') || '');
  if (!file || typeof file === 'string' || !FOLDERS.includes(folder) || !postId) {
    return Response.json({ error: 'Missing file, folder, or postId.' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: `That file is too large. The limit is ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.` }, { status: 400 });
  }
  if (!ACCEPTED.includes(file.type)) {
    return Response.json({ error: `Unsupported file type: ${file.type || 'unknown'}.` }, { status: 400 });
  }

  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `${folder}/${postId}/${stamp}-${rand}-${safeName(file.name)}`;

  const { env } = await getCloudflareContext({ async: true });
  await env.MEDIA_BUCKET.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  return Response.json({
    path: key,
    url: `/media/${key}`,
    contentType: file.type,
    size: file.size,
    name: file.name,
  });
}
