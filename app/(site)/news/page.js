'use client';

import React from 'react';
import Link from 'next/link';
import { useLeague, usePageTitle } from '../../../lib/LeagueContext';
import { summaryOf } from '../../../lib/domain/newsBlocks';
import { SectionHead, EmptyNote } from '../../../components/site/primitives';
import NewsTabs from '../../../components/site/NewsTabs';

function postDate(at) {
  if (!at) return 'Undated';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date(at));
}

function Card({ post, lead }) {
  const summary = summaryOf(post);
  return (
    <article className={`card overflow-hidden animate-fade-up ${lead ? '' : 'flex flex-col'}`}>
      {post.imageUrl && (
        <Link href={`/news/${post.id}`} className="block">
          <img
            src={post.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className={`w-full object-cover border-b border-rule ${lead ? 'max-h-96' : 'max-h-52'}`}
          />
        </Link>
      )}
      <div className="p-4 flex-1">
        <Link
          href={`/news/${post.id}`}
          className={`headline leading-tight hover:text-brick ${lead ? 'text-3xl sm:text-4xl' : 'text-xl'}`}
        >
          {post.title}
        </Link>
        <p className="eyebrow text-ink-mute mt-1.5">
          {post.author ? `${post.author} · ` : ''}{postDate(post.at)}
        </p>
        {summary && <p className="text-sm text-ink-soft mt-2.5">{summary}</p>}
        <Link href={`/news/${post.id}`} className="eyebrow text-brick hover:underline inline-block mt-3">
          Read more
        </Link>
      </div>
    </article>
  );
}

export default function NewsPage() {
  usePageTitle('News');
  const { snapshot } = useLeague();
  if (!snapshot) return <EmptyNote>No league data yet.</EmptyNote>;
  const posts = [...(snapshot.news || [])].sort((a, b) => (b.at || 0) - (a.at || 0));
  const [lead, ...rest] = posts;

  return (
    <div>
      <NewsTabs />
      <SectionHead title="News">
        <span className="eyebrow text-ink-mute pb-0.5">
          {posts.length} {posts.length === 1 ? 'post' : 'posts'}
        </span>
      </SectionHead>

      {posts.length === 0 ? (
        <EmptyNote>Nothing has been posted yet.</EmptyNote>
      ) : (
        <div className="stagger">
          <Card post={lead} lead />
          {rest.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
              {rest.map(post => <Card key={post.id} post={post} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
