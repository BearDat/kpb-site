'use client';

import React, { useRef, useState } from 'react';
import { useAdminLeague } from '../../lib/AdminLeagueContext';
import { useLeague } from '../../lib/LeagueContext';
import {
  addHighlight, removeHighlight, updateHighlight, newHighlightId,
} from '../../lib/domain/mutations';
import { playerSlug, playerSlugIndex } from '../../lib/domain/awards';
import { uploadHighlightMedia, deleteStoredMedia } from '../../lib/mediaUpload';
import { classifyLink, formatBytes, ACCEPTED_UPLOAD, MAX_UPLOAD_BYTES } from '../../lib/media';
import { MediaItem } from '../site/MediaGallery';
import { EmptyNote } from '../site/primitives';

function when(at) {
  if (!at) return 'Undated';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(at));
}

function PlayerPicker({ value, onChange, knownSlugs }) {
  const [open, setOpen] = useState(false);
  const matches = value.trim()
    ? [...knownSlugs].filter(s => s.includes(playerSlug(value))).slice(0, 8)
    : [];
  return (
    <div className="relative">
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Link to a player (optional)"
        className="w-full bg-paper-well border border-rule px-2 py-1.5 text-sm"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-0.5 bg-paper border border-rule shadow-lg max-h-48 overflow-y-auto">
          {matches.map(slug => (
            <button
              key={slug}
              type="button"
              onMouseDown={() => { onChange(slug.replace(/-/g, ' ')); setOpen(false); }}
              className="block w-full text-left px-2 py-1.5 text-sm hover:bg-paper-well"
            >
              {slug.replace(/-/g, ' ')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NewHighlightForm({ knownSlugs }) {
  const { mutate, saving } = useAdminLeague();
  const [title, setTitle] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const resolvedSlug = playerName.trim() ? playerSlug(playerName) : null;
  const linkedKnown = resolvedSlug ? knownSlugs.has(resolvedSlug) : true;

  const publish = async (media) => {
    const id = newHighlightId();
    const result = await mutate(addHighlight({
      id,
      title: title.trim() || (media.name || 'Highlight'),
      playerName: playerName.trim() || null,
      playerSlug: resolvedSlug,
      media,
    }));
    if (result.ok) {
      setTitle(''); setPlayerName(''); setLink('');
      if (fileRef.current) fileRef.current.value = '';
    } else if (!result.conflict) {
      setError(result.error || 'Could not save that highlight.');
    }
    return result;
  };

  const onFile = async (file) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const id = newHighlightId();
      const item = await uploadHighlightMedia(id, file);
      const result = await mutate(addHighlight({
        id,
        title: title.trim() || file.name,
        playerName: playerName.trim() || null,
        playerSlug: resolvedSlug,
        media: item,
      }));
      if (result.ok) {
        setTitle(''); setPlayerName('');
        if (fileRef.current) fileRef.current.value = '';
      } else {
        await deleteStoredMedia(item).catch(() => {});
        if (!result.conflict) setError(result.error || 'Could not save that highlight.');
      }
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const onLink = async () => {
    setError(null);
    const parsed = classifyLink(link);
    if (!parsed) {
      setError('That does not look like a link. Paste a full https:// URL.');
      return;
    }
    setBusy(true);
    const item = {
      id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      kind: parsed.kind,
      provider: parsed.provider,
      url: parsed.url,
      embedUrl: parsed.embedUrl || null,
      name: title.trim() || (parsed.provider === 'link' ? parsed.url : `${parsed.provider} clip`),
      at: Date.now(),
    };
    await publish(item);
    setBusy(false);
  };

  return (
    <section className="card">
      <h2 className="headline text-lg px-3 py-2.5 border-b border-rule-strong">Add a highlight</h2>
      <div className="px-3 py-3 space-y-2">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full bg-paper-well border border-rule px-2 py-1.5 text-sm"
        />
        <PlayerPicker value={playerName} onChange={setPlayerName} knownSlugs={knownSlugs} />
        {playerName.trim() && !linkedKnown && (
          <p className="text-tiny text-brick">
            No player named "{playerName.trim()}" was found on a roster — the highlight will still save, but won't link to a player page.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_UPLOAD}
            disabled={busy || saving}
            onChange={e => onFile(e.target.files[0])}
            className="text-tiny max-w-[16rem]"
          />
          <span className="text-tiny text-ink-faint">up to {formatBytes(MAX_UPLOAD_BYTES)}</span>
        </div>
        <div className="flex items-center gap-2">
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
            className="eyebrow bg-navy text-white px-3 py-2 disabled:opacity-40"
          >
            Add clip
          </button>
        </div>
        {busy && <p className="text-tiny text-brick">Saving…</p>}
        {error && <p className="text-sm text-loss">{error}</p>}
      </div>
    </section>
  );
}

function HighlightRow({ highlight, saving, onRemove, onRelink, knownSlugs }) {
  const [editing, setEditing] = useState(false);
  const [playerName, setPlayerName] = useState(highlight.playerName || '');

  return (
    <div>
      <div className="flex items-start gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{highlight.title || 'Untitled'}</p>
          <p className="text-tiny text-ink-mute">
            {highlight.playerName ? `${highlight.playerName} · ` : 'No player linked · '}{when(highlight.at)}
          </p>
        </div>
        <button type="button" onClick={() => setEditing(v => !v)} className="eyebrow text-ink-mute hover:text-brick">
          {editing ? 'Done' : 'Edit'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => onRemove(highlight)}
          className="eyebrow text-loss hover:underline disabled:opacity-40"
        >
          Delete
        </button>
      </div>
      {editing && (
        <div className="px-3 pb-3 space-y-2">
          <PlayerPicker value={playerName} onChange={setPlayerName} knownSlugs={knownSlugs} />
          <button
            type="button"
            disabled={saving}
            onClick={() => onRelink(highlight.id, playerName)}
            className="eyebrow border border-rule px-2.5 py-1.5 disabled:opacity-40"
          >
            Save player link
          </button>
          <div className="pt-1 max-w-sm">
            <MediaItem item={highlight.media} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function HighlightsPanel() {
  const { league, mutate, saving } = useAdminLeague();
  const { snapshot } = useLeague();
  const knownSlugs = playerSlugIndex(snapshot);

  if (!league) return <EmptyNote>No league is loaded.</EmptyNote>;
  const highlights = [...(league.highlights || [])].sort((a, b) => (b.at || 0) - (a.at || 0));

  const remove = async (highlight) => {
    if (!confirm(`Delete "${highlight.title || 'Untitled'}"? This cannot be undone.`)) return;
    const result = await mutate(removeHighlight(highlight.id));
    if (result.ok && highlight.media && highlight.media.provider === 'upload') {
      await deleteStoredMedia(highlight.media).catch(() => {});
    }
  };

  const relink = (id, name) => mutate(updateHighlight(id, {
    playerName: name.trim() || null,
    playerSlug: name.trim() ? playerSlug(name) : null,
  }));

  return (
    <div>
      <NewHighlightForm knownSlugs={knownSlugs} />

      <section className="card mt-6">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-rule-strong">
          <h2 className="headline text-lg">Highlights</h2>
          <span className="eyebrow text-ink-mute">{highlights.length}</span>
        </div>
        {highlights.length === 0 ? (
          <EmptyNote>Nothing added yet.</EmptyNote>
        ) : (
          <div className="row-rule">
            {highlights.map(h => (
              <HighlightRow
                key={h.id}
                highlight={h}
                saving={saving}
                onRemove={remove}
                onRelink={relink}
                knownSlugs={knownSlugs}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
