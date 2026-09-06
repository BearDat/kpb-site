'use client';

import React from 'react';
import { useSeason, usePageTitle } from '../../../lib/LeagueContext';
import { computeStandings, computeDivisionGroups } from '../../../lib/domain/standings';
import { teamSlug } from '../../../lib/domain/core';
import StandingsTable from '../../../components/site/StandingsTable';
import { SectionHead, EmptyNote } from '../../../components/site/primitives';

export default function StandingsPage() {
  usePageTitle('Standings');
  const ctx = useSeason();
  if (!ctx) return <EmptyNote>No season is published yet.</EmptyNote>;
  const { season, teamsById } = ctx;
  const rows = computeStandings(season, teamsById).active.map(t => ({ ...t, slug: teamSlug(t.displayName) }));
  const playoffSpots = (season.settings && season.settings.playoffSpots) || null;
  const divisions = season.divisions || [];
  const { groups, unassigned } = divisions.length > 0 ? computeDivisionGroups(rows, divisions) : { groups: [], unassigned: [] };

  return (
    <div>
      <SectionHead title="Standings">
        <span className="eyebrow text-ink-mute pb-0.5">{season.name}</span>
      </SectionHead>
      {divisions.length > 0 ? (
        <div className="space-y-6">
          {groups.map(({ division, teams }) => (
            <section key={division.id}>
              <h3 className="eyebrow text-ink pb-1.5 mb-2 border-b border-rule-strong">{division.name}</h3>
              <div className="card">
                <StandingsTable
                  rows={teams.map(t => ({ ...t, rank: t.divRank, gb: t.divGb }))}
                  playoffSpots={playoffSpots}
                />
              </div>
            </section>
          ))}
          {unassigned.length > 0 && (
            <section>
              <h3 className="eyebrow text-ink pb-1.5 mb-2 border-b border-rule-strong">Unassigned</h3>
              <div className="card">
                <StandingsTable rows={unassigned} playoffSpots={playoffSpots} />
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="card">
          <StandingsTable rows={rows} playoffSpots={playoffSpots} />
        </div>
      )}
      <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-tiny text-ink-mute">
        <div><dt className="inline eyebrow">PCT</dt> <dd className="inline">winning percentage</dd></div>
        <div><dt className="inline eyebrow">GB</dt> <dd className="inline">games behind the leader{divisions.length > 0 ? ' (within division)' : ''}</dd></div>
        <div><dt className="inline eyebrow">DIFF</dt> <dd className="inline">run differential</dd></div>
        <div><dt className="inline eyebrow">STRK</dt> <dd className="inline">current streak</dd></div>
      </dl>
    </div>
  );
}
