'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLeague, usePageTitle, deriveSeason } from '../../../../lib/LeagueContext';
import { seasonTeam, seasonAwards } from '../../../../lib/domain/awards';
import { seasonPlayerTotals, BATTING_BOARDS, PITCHING_BOARDS, BATTING_BOARDS_PLAYOFFS, PITCHING_BOARDS_PLAYOFFS } from '../../../../lib/domain/stats';
import { computeStandings } from '../../../../lib/domain/standings';
import { isPostseason } from '../../../../lib/domain/playoffs';
import AwardList from '../../../../components/site/AwardList';
import LeaderBoard from '../../../../components/site/LeaderBoard';
import StandingsTable from '../../../../components/site/StandingsTable';
import { TeamMark, SectionHead, EmptyNote, PlayerLink } from '../../../../components/site/primitives';
import { teamSlug } from '../../../../lib/domain/core';

export default function SeasonHistoryPage() {
  const params = useParams();
  const { snapshot } = useLeague();
  const season = snapshot ? (snapshot.seasons || []).find(s => s.id === params.season) : null;
  usePageTitle(season ? season.name : 'Season');

  if (!snapshot) return <EmptyNote>No league data yet.</EmptyNote>;
  if (!season) return <EmptyNote>That season is not in this league.</EmptyNote>;

  const ctx = deriveSeason(snapshot, season);
  const champion = seasonTeam(season, snapshot.teams, season.championTeamId);
  const awards = seasonAwards(snapshot, season);
  const { players, orphaned } = seasonPlayerTotals(season);
  const playoffTotals = isPostseason(season) ? seasonPlayerTotals(season, { mode: 'playoffs' }) : null;
  const played = (season.games || []).filter(g => g.played && !g.isBye).length;
  const standings = played > 0 || season.members.some(m => m.baselineW || m.baselineL)
    ? computeStandings(season, snapshot.teams).active.map(t => ({ ...t, slug: teamSlug(t.displayName) }))
    : [];
  const clubs = ctx.allTeams.slice().sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <div>
      <header className="card mb-6 overflow-hidden">
        <div className="h-1.5" style={{ background: champion ? (champion.color || '#0C2340') : 'var(--rule)' }} />
        <div className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <Link href="/history" className="eyebrow text-ink-mute hover:text-brick">All seasons</Link>
            <h1 className="headline text-3xl sm:text-4xl mt-1">{season.name}</h1>
          </div>
          {champion && (
            <div className="flex items-center gap-3 bg-brand-soft px-3 py-2">
              <TeamMark team={champion} size={40} />
              <div className="min-w-0">
                <p className="eyebrow text-ink-mute leading-none">Champion</p>
                <p className="font-display font-bold text-lg truncate leading-tight mt-0.5">{champion.name}</p>
              </div>
            </div>
          )}
        </div>
      </header>

      <section className="mb-8">
        <SectionHead title="Awards" />
        <AwardList awards={awards} emptyNote={`No awards have been recorded for ${season.name}.`} />
      </section>

      {standings.length > 0 && (
        <section className="mb-8">
          <SectionHead title="Final standings" />
          <div className="card">
            <StandingsTable rows={standings} playoffSpots={(season.settings && season.settings.playoffSpots) || null} />
          </div>
        </section>
      )}

      {players.length > 0 && (
        <section className="mb-8">
          <SectionHead title="Stat leaders" />
          <div className="space-y-5">
            <LeaderBoard
              title="Batting"
              players={players}
              boards={BATTING_BOARDS}
              teamFor={id => seasonTeam(season, snapshot.teams, id)}
            />
            <LeaderBoard
              title="Pitching"
              players={players}
              boards={PITCHING_BOARDS}
              teamFor={id => seasonTeam(season, snapshot.teams, id)}
            />
          </div>
          {orphaned > 0 && (
            <p className="text-tiny text-ink-faint mt-3">
              {orphaned} imported stat {orphaned === 1 ? 'line is' : 'lines are'} filed against a roster entry
              this season no longer has, so {orphaned === 1 ? 'it is' : 'they are'} not counted here.
            </p>
          )}
        </section>
      )}

      {playoffTotals && playoffTotals.players.length > 0 && (
        <section className="mb-8">
          <SectionHead title="Playoff stat leaders" />
          <div className="space-y-5">
            <LeaderBoard
              title="Batting"
              players={playoffTotals.players}
              boards={BATTING_BOARDS_PLAYOFFS}
              teamFor={id => seasonTeam(season, snapshot.teams, id)}
            />
            <LeaderBoard
              title="Pitching"
              players={playoffTotals.players}
              boards={PITCHING_BOARDS_PLAYOFFS}
              teamFor={id => seasonTeam(season, snapshot.teams, id)}
            />
          </div>
        </section>
      )}

      <section>
        <SectionHead title="Clubs">
          <span className="eyebrow text-ink-mute pb-0.5">{clubs.length}</span>
        </SectionHead>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {clubs.map(team => (
            <section key={team.id} className="card overflow-hidden">
              <div className="h-1" style={{ background: team.color || '#0C2340' }} />
              <div className="flex items-center gap-3 px-3 py-2.5 border-b border-rule-strong">
                <TeamMark team={{ ...team, name: team.displayName }} size={32} />
                <h3 className="font-display font-bold text-base truncate flex-1 min-w-0">{team.displayName}</h3>
                <span className="eyebrow text-ink-faint">{(team.roster || []).length}</span>
              </div>
              {(team.roster || []).length === 0 ? (
                <p className="text-tiny text-ink-faint px-3 py-3">No roster recorded.</p>
              ) : (
                <ul className="px-3 py-2 flex flex-wrap gap-x-3 gap-y-1">
                  {team.roster.map(p => (
                    <li key={p.id} className="text-sm text-ink-soft">
                      <PlayerLink name={p.name} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
