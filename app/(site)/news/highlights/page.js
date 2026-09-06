'use client';

import React from 'react';
import { useLeague, usePageTitle } from '../../../../lib/LeagueContext';
import { SectionHead, EmptyNote, PlayerLink } from '../../../../components/site/primitives';
import { MediaItem } from '../../../../components/site/MediaGallery';
import NewsTabs from '../../../../components/site/NewsTabs';

function postDate(at) {
  if (!at) return 'Undated';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date(at));
}

function HighlightCard({ highlight }) {
  return (
    <article className="card overflow-hidden animate-fade-up">
      <MediaItem item={highlight.media} />
      <div className="p-4">
        <h3 className="headline text-lg leading-tight">{highlight.title}</h3>
        <p className="eyebrow text-ink-mute mt-1.5">
          {highlight.playerName ? (
            <>
              <PlayerLink name={highlight.playerName} slug={highlight.playerSlug} /> · {postDate(highlight.at)}
            </>
          ) : postDate(highlight.at)}
        </p>
      </div>
    </article>
  );
}

export default function HighlightsPage() {
  usePageTitle('Highlights');
  const { snapshot } = useLeague();
  if (!snapshot) return <EmptyNote>No league data yet.</EmptyNote>;
  const highlights = [...(snapshot.highlights || [])].sort((a, b) => (b.at || 0) - (a.at || 0));

  return (
    <div>
      <NewsTabs />
      <SectionHead title="Highlights">
        <span className="eyebrow text-ink-mute pb-0.5">
          {highlights.length} {highlights.length === 1 ? 'clip' : 'clips'}
        </span>
      </SectionHead>

      {highlights.length === 0 ? (
        <EmptyNote>No highlights have been posted yet.</EmptyNote>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 stagger">
          {highlights.map(h => <HighlightCard key={h.id} highlight={h} />)}
        </div>
      )}
    </div>
  );
}
