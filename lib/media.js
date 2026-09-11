export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const ACCEPTED_UPLOAD = 'image/png,image/jpeg,image/gif,image/webp,image/avif,video/mp4,video/webm,video/quicktime';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

const YOUTUBE = [
  /^https?:\/\/(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{6,})/i,
  /^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{6,})/i,
  /^https?:\/\/(?:www\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/i,
];
const STREAMABLE = /^https?:\/\/(?:www\.)?streamable\.com\/(?:e\/)?([A-Za-z0-9]+)/i;
// Medal's clip pages send an enforced frame-ancestors policy on the actual
// iframe request (curl doesn't see it — it's only applied to Sec-Fetch-Dest:
// iframe requests), so they can't be embedded the YouTube/Streamable way.
// What they DO publish is an og:video meta tag pointing at a direct, CORS-
// open .mp4 on their CDN (the same mechanism Discord uses to play Medal
// clips inline) — resolveLinkMedia fetches that server-side and hands back
// a plain 'video' item so it renders exactly like an uploaded clip.
const MEDAL = /^https?:\/\/(?:www\.)?medal\.tv\/(?:games\/[^/?#]+\/)?clips?\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?/i;

export function classifyLink(raw) {
  const url = String(raw || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;

  for (const re of YOUTUBE) {
    const m = url.match(re);
    if (m) return { kind: 'embed', provider: 'youtube', url, embedUrl: `https://www.youtube.com/embed/${m[1]}` };
  }
  const s = url.match(STREAMABLE);
  if (s) return { kind: 'embed', provider: 'streamable', url, embedUrl: `https://streamable.com/e/${s[1]}` };
  const med = url.match(MEDAL);
  if (med) return { kind: 'medal', provider: 'medal', url: med[0] };

  if (VIDEO_EXT.test(url)) return { kind: 'video', provider: 'link', url };
  if (IMAGE_EXT.test(url)) return { kind: 'image', provider: 'link', url };
  return { kind: 'link', provider: 'link', url };
}

// classifyLink() is a pure sync regex match, but a Medal link needs a
// server round-trip to turn into something playable — this is the one
// entry point admin UIs should call when attaching a pasted link, since it
// does that resolution and returns an item shape that's always ready to
// store/render as-is (never the intermediate 'medal' marker kind).
export async function resolveLinkMedia(raw) {
  const parsed = classifyLink(raw);
  if (!parsed) return null;
  if (parsed.kind !== 'medal') return parsed;
  const res = await fetch(`/api/resolve-medal-clip?url=${encodeURIComponent(parsed.url)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.videoUrl) throw new Error(data.error || 'Could not load that Medal clip.');
  return { kind: 'video', provider: 'medal', url: data.videoUrl };
}

// Server-side only (called from the resolve-medal-clip API route) — pulls
// the direct CDN video URL Medal itself publishes for link-unfurling.
export function extractMedalVideoUrl(html) {
  const m = html.match(/<meta[^>]+property=["']og:video:secure_url["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i);
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

export function mediaKindOf(contentType) {
  if (!contentType) return 'link';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  return 'link';
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function isRenderableEmbed(item) {
  return item && item.kind === 'embed' && !!item.embedUrl
    && (item.provider === 'youtube' || item.provider === 'streamable');
}
