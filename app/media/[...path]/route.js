import { getCloudflareContext } from '@opennextjs/cloudflare';

export const runtime = 'nodejs';

// Every key is folder/postId/stamp-rand-name — already effectively
// immutable (a re-upload gets a fresh stamp+rand), so this can be cached
// hard and forever; Cloudflare's own edge absorbs repeat views for free
// instead of this Worker (and R2) serving the bytes every time.
export async function GET(request, { params }) {
  const { path } = await params;
  const key = (path || []).join('/');
  if (!key) return new Response('Not found', { status: 404 });

  const { env } = await getCloudflareContext({ async: true });
  const object = await env.MEDIA_BUCKET.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const etag = object.httpEtag;
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': (object.httpMetadata && object.httpMetadata.contentType) || 'application/octet-stream',
      'Content-Length': String(object.size),
      ETag: etag,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
