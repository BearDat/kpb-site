export const MEDIA_BUCKET = 'media';
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
// Medal's own share links (medal.tv/clip/<id>, /clips/<id>, or
// /games/<game>/clip(s)/<id>[/<shareKey>]) are already embeddable as-is —
// unlike YouTube/Streamable there's no separate embed-path to rewrite to,
// so the match itself (with any tracking query string like ?invite= cut
// off) becomes the iframe src.
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
  if (med) return { kind: 'embed', provider: 'medal', url, embedUrl: med[0] };

  if (VIDEO_EXT.test(url)) return { kind: 'video', provider: 'link', url };
  if (IMAGE_EXT.test(url)) return { kind: 'image', provider: 'link', url };
  return { kind: 'link', provider: 'link', url };
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
    && (item.provider === 'youtube' || item.provider === 'streamable' || item.provider === 'medal');
}
