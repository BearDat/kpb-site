import { extractMedalVideoUrl } from '../../../lib/media';

export const runtime = 'nodejs';

const MEDAL_HOST = /^https?:\/\/(?:www\.)?medal\.tv\//i;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  if (!url || !MEDAL_HOST.test(url)) {
    return Response.json({ error: 'Not a medal.tv URL' }, { status: 400 });
  }
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return Response.json({ error: 'Could not load that clip' }, { status: 502 });
    const html = await res.text();
    const videoUrl = extractMedalVideoUrl(html);
    if (!videoUrl) return Response.json({ error: 'No video found on that page' }, { status: 404 });
    return Response.json({ videoUrl });
  } catch (e) {
    return Response.json({ error: 'Could not reach medal.tv' }, { status: 502 });
  }
}
