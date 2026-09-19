'use client';

import { supabase } from './supabaseClient';
import { MAX_UPLOAD_BYTES, mediaKindOf, formatBytes } from './media';

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

async function uploadMedia(folder, postId, file) {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
  }
  const form = new FormData();
  form.append('file', file);
  form.append('folder', folder);
  form.append('postId', postId);

  const res = await fetch('/api/media-upload', {
    method: 'POST',
    headers: await authHeader(),
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not upload that file.');

  return {
    id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind: mediaKindOf(file.type),
    provider: 'upload',
    url: data.url,
    path: data.path,
    name: file.name,
    contentType: file.type || null,
    size: file.size,
    at: Date.now(),
  };
}

export function uploadNewsMedia(postId, file) {
  return uploadMedia('news', postId, file);
}

export function uploadHighlightMedia(highlightId, file) {
  return uploadMedia('highlights', highlightId, file);
}

export async function deleteStoredMedia(item) {
  if (!item || item.provider !== 'upload' || !item.path) return;
  const res = await fetch('/api/media-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ path: item.path }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not delete that file.');
  }
}
