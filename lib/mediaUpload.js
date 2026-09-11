'use client';

import { upload } from '@vercel/blob/client';
import { supabase } from './supabaseClient';
import { MAX_UPLOAD_BYTES, mediaKindOf, formatBytes } from './media';

function safeName(name) {
  return String(name || 'file')
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-80) || 'file';
}

function storagePath(folder, postId, file) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${folder}/${postId}/${stamp}-${rand}-${safeName(file.name)}`;
}

async function uploadMedia(folder, postId, file) {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
  }
  const { data: { session } } = await supabase.auth.getSession();
  const path = storagePath(folder, postId, file);
  let blob;
  try {
    blob = await upload(path, file, {
      access: 'public',
      handleUploadUrl: '/api/blob-upload-token',
      headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
    });
  } catch (error) {
    if (/logged in/i.test(error.message)) throw new Error('You need to be logged in to upload.');
    throw error;
  }
  return {
    id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind: mediaKindOf(file.type),
    provider: 'upload',
    url: blob.url,
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
  if (!item || item.provider !== 'upload' || !item.url) return;
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/blob-delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ url: item.url }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not delete that file.');
  }
}
