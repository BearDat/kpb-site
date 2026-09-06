'use client';

import React from 'react';
import Link from 'next/link';
import { useSeason, usePageTitle } from '../../../lib/LeagueContext';
import { computeStandings } from '../../../lib/domain/standings';
import { teamSlug } from '../../../lib/domain/core';
import { TeamMark, SectionHead, EmptyNote, pct } from '../../../components/site/primitives';

function TeamCard({ t, total }) {
  return (
    <Link
      href={`/teams/${t.slug}`}
      className="bg-paper hover:bg-paper-well flex items-center gap-3 p-3 group"
    >
      <span className="w-1 self-stretch flex-shrink-0" style={{ background: t.color || '#0C2340' }} />
      <TeamMark team={{ ...t, name: t.displayName }} size={40} />
      <div className="min-w-0 flex-1">
        <div className="font-display font-bold text-base leading-tight truncate group-hover:text-brick">
          {t.displayName}
        </div>
        <div className="stat text-tiny text-ink-mute mt-0.5">
          {t.w}-{t.l} · {pct(t.pct)} · {t.rank} of {total}
        </div>
      </div>
    </Link>
  );
}

export default function TeamsPage() {
  usePageTitle('Teams');
  const ctx = useSeason();
  if (!ctx) return <EmptyNote>No season is published yet.</EmptyNote>;
  const { season, teamsById } = ctx;
  const ranked = computeStandings(season, teamsById).active.map(t => ({ ...t, slug: teamSlug(t.displayName) }));
  const divisions = season.divisions || [];

  return (
    <div>
      <SectionHead title="Teams">
        <span className="eyebrow text-ink-mute pb-0.5">{ranked.length} clubs</span>
      </SectionHead>
      {divisions.length > 0 ? (
        <div className="space-y-6">
          {divisions.map(d => {
            const rows = ranked.filter(t => t.divisionId === d.id).sort((a, b) => a.displayName.localeCompare(b.displayName));
            if (rows.length === 0) return null;
            return (
              <section key={d.id}>
                <h3 className="eyebrow text-ink pb-1.5 mb-2 border-b border-rule-strong">{d.name}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-rule border border-rule">
                  {rows.map(t => <TeamCard key={t.id} t={t} total={ranked.length} />)}
                </div>
              </section>
            );
          })}
          {ranked.some(t => !t.divisionId) && (
            <section>
              <h3 className="eyebrow text-ink pb-1.5 mb-2 border-b border-rule-strong">Unassigned</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-rule border border-rule">
                {ranked.filter(t => !t.divisionId).sort((a, b) => a.displayName.localeCompare(b.displayName))
                  .map(t => <TeamCard key={t.id} t={t} total={ranked.length} />)}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-rule border border-rule">
          {ranked.slice().sort((a, b) => a.displayName.localeCompare(b.displayName))
            .map(t => <TeamCard key={t.id} t={t} total={ranked.length} />)}
        </div>
      )}
    </div>
  );
}
