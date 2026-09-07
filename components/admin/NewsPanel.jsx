'use client';

import React, { useRef, useState } from 'react';
import { useAdminLeague } from '../../lib/AdminLeagueContext';
import {
  addNewsPost, updateNewsPost, removeNewsPost, newNewsPostId,
  attachNewsMedia, detachNewsMedia, setNewsHero, setNewsBlocks,
} from '../../lib/domain/mutations';
import BlockEditor from './BlockEditor';
import { uploadNewsMedia, deleteStoredMedia } from '../../lib/mediaUpload';
import { resolveLinkMedia, formatBytes, ACCEPTED_UPLOAD, MAX_UPLOAD_BYTES } from '../../lib/media';
import { MediaItem } from '../site/MediaGallery';
import { EmptyNote } from '../site/primitives';

function when(at) {
  if (!at) return 'Undated';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(at));
}

function MediaManager({ post }) {
  const { mutate, saving } = useAdminLeague();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [link, setLink] = useState('');
  const fileRef = useRef(null);
  const media = post.media || [];

  const onFiles = async (files) => {
    setError(null);
    setBusy(true);
    try {
      for (const file of files) {
        const item = await uploadNewsMedia(post.id, file);
        const result = await mutate(attachNewsMedia(post.id, item));
        if (!result.ok) {
          await deleteStoredMedia(item).catch(() => {});
          if (!result.conflict) setError(result.error || 'Could not attach that file.');
          break;
        }
      }
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const onLink = async () => {
    setError(null);
    setBusy(true);
    try {
      const parsed = await resolveLinkMedia(link);
      if (!parsed) {
        setError('That does not look like a link. Paste a full https:// URL.');
        setBusy(false);
        return;
      }
      const item = {
        id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        kind: parsed.kind,
        provider: parsed.provider,
        url: parsed.url,
        embedUrl: parsed.embedUrl || null,
        name: parsed.provider === 'link' ? parsed.url : `${parsed.provider} clip`,
        at: Date.now(),
      };
      const result = await mutate(attachNewsMedia(post.id, item));
      if (result.ok) setLink('');
      else if (!result.conflict) setError(result.error || 'Could not attach that link.');
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const onRemove = async (item) => {
    if (!confirm(`Remove ${item.name || 'this media'} from the post?`)) return;
    setBusy(true);
    setError(null);
    const result = await mutate(detachNewsMedia(post.id, item.id));
    if (result.ok) {
      try {
        await deleteStoredMedia(item);
      } catch (e) {
        setError(`Removed from the post, but the stored file could not be deleted: ${e.message}`);
      }
    } else if (!result.conflict) {
      setError(result.error || 'Could not remove that.');
    }
    setBusy(false);
  };

  return (
    <div className="border-t border-rule px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_UPLOAD}
          multiple
          disabled={busy || saving}
          onChange={e => onFiles([...e.target.files])}
          className="text-tiny max-w-[16rem]"
        />
        <span className="text-tiny text-ink-faint">images and clips up to {formatBytes(MAX_UPLOAD_BYTES)}</span>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <input
          value={link}
          onChange={e => setLink(e.target.value)}
          placeholder="or paste a YouTube / Streamable / Medal link"
          className="flex-1 bg-paper-well border border-rule px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          disabled={busy || saving || !link.trim()}
          onClick={onLink}
          className="eyebrow border border-rule px-2.5 py-1.5 disabled:opacity-40"
        >
          Attach
        </button>
      </div>

      {busy && <p className="text-tiny text-brick mt-2">Uploading…</p>}
      {error && <p className="text-sm text-loss mt-2">{error}</p>}

      {media.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          {media.map(item => (
            <div key={item.id} className="min-w-0">
              <MediaItem item={item} />
              <div className="flex items-center gap-2 mt-1">
                <span className="eyebrow text-ink-faint flex-1 min-w-0 truncate">
                  {item.kind}{item.size ? ` · ${formatBytes(item.size)}` : ''}
                </span>
                {item.kind === 'image' && item.url !== post.imageUrl && (
                  <button
                    type="button"
                    disabled={busy || saving}
                    onClick={() => mutate(setNewsHero(post.id, item.url))}
                    className="eyebrow text-ink-mute hover:text-brick disabled:opacity-40"
                  >
                    Make hero
                  </button>
                )}
                {item.url === post.imageUrl && <span className="eyebrow text-win">Hero</span>}
                <button
                  type="button"
                  disabled={busy || saving}
                  onClick={() => onRemove(item)}
                  className="eyebrow text-loss hover:underline disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EditRow({ post, saving, onSave, onRemove, onBlocks }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(post.title || '');
  const [summary, setSummary] = useState(post.summary || '');
  const [author, setAuthor] = useState(post.author || '');
  const count = (post.media || []).length;

  return (
    <div>
      <div className="flex items-start gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{post.title || 'Untitled'}</p>
          <p className="text-tiny text-ink-mute">
            {post.author ? `${post.author} · ` : ''}{when(post.at)}
            {post.imageUrl ? ' · hero image' : ''}
            {count > 0 ? ` · ${count} attached` : ''}
          </p>
        </div>
        <button type="button" onClick={() => setEditing(v => !v)} className="eyebrow text-ink-mute hover:text-brick">
          {editing ? 'Done' : 'Edit'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => onRemove(post)}
          className="eyebrow text-loss hover:underline disabled:opacity-40"
        >
          Delete
        </button>
      </div>

      {editing && (
        <div className="px-3 pb-3 space-y-2">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title"
            className="w-full bg-paper-well border border-rule px-2 py-1.5 text-sm" />
          <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="Author"
            className="w-full bg-paper-well border border-rule px-2 py-1.5 text-sm" />
          <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={2}
            placeholder="Short description shown on cards and the home page (optional)"
            className="w-full bg-paper-well border border-rule px-2 py-1.5 text-sm resize-y" />
          <button
            type="button"
            disabled={saving || !title.trim()}
            onClick={() => onSave(post.id, { title: title.trim(), author: author.trim(), summary: summary.trim() })}
            className="eyebrow bg-navy text-white px-3 py-2 disabled:opacity-40"
          >
            Save details
          </button>
        </div>
      )}

      {editing && <BlockEditor post={post} saving={saving} onSave={blocks => onBlocks(post.id, blocks)} />}
      {editing && <MediaManager post={post} />}
    </div>
  );
}

export default function NewsPanel() {
  const { league, mutate, saving } = useAdminLeague();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [author, setAuthor] = useState('');

  if (!league) return <EmptyNote>No league is loaded.</EmptyNote>;
  const posts = [...(league.news || [])].sort((a, b) => (b.at || 0) - (a.at || 0));

  const publish = async () => {
    const id = newNewsPostId();
    const result = await mutate(addNewsPost({ id, title, summary: body, author }));
    if (result.ok) { setTitle(''); setBody(''); setAuthor(''); }
  };

  const remove = async (post) => {
    if (!confirm(`Delete "${post.title || 'Untitled'}"? This cannot be undone.`)) return;
    const stored = (post.media || []).filter(m => m.provider === 'upload');
    const result = await mutate(removeNewsPost(post.id));
    if (result.ok) {
      for (const item of stored) await deleteStoredMedia(item).catch(() => {});
    }
  };

  return (
    <div>
      <section className="card">
        <h2 className="headline text-lg px-3 py-2.5 border-b border-rule-strong">Write a post</h2>
        <div className="px-3 py-3 space-y-2">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title"
            className="w-full bg-paper-well border border-rule px-2 py-1.5 text-sm" />
          <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="Author (optional)"
            className="w-full bg-paper-well border border-rule px-2 py-1.5 text-sm" />
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={3}
            placeholder="Short description shown on cards (optional)"
            className="w-full bg-paper-well border border-rule px-2 py-1.5 text-sm resize-y" />
          <button
            type="button"
            disabled={saving || !title.trim()}
            onClick={publish}
            className="eyebrow bg-navy text-white px-3 py-2 disabled:opacity-40"
          >
            Publish
          </button>
          <p className="text-tiny text-ink-faint">
            Publish first, then open Edit to write the article body and attach images and clips.
          </p>
        </div>
      </section>

      <section className="card mt-6">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-rule-strong">
          <h2 className="headline text-lg">Posts</h2>
          <span className="eyebrow text-ink-mute">{posts.length}</span>
        </div>
        {posts.length === 0 ? (
          <EmptyNote>Nothing published yet.</EmptyNote>
        ) : (
          <div className="row-rule">
            {posts.map(post => (
              <EditRow
                key={post.id}
                post={post}
                saving={saving}
                onSave={(id, patch) => mutate(updateNewsPost(id, patch))}
                onBlocks={(id, blocks) => mutate(setNewsBlocks(id, blocks))}
                onRemove={remove}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
