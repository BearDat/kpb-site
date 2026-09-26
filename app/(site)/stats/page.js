'use client';

import React from 'react';
import { useLeague, usePageTitle } from '../../../lib/LeagueContext';
import { seasonPlayerTotals, BATTING_BOARDS, PITCHING_BOARDS, BATTING_BOARDS_PLAYOFFS, PITCHING_BOARDS_PLAYOFFS } from '../../../lib/domain/stats';
import { seasonTeam } from '../../../lib/domain/awards';
import { isPostseason } from '../../../lib/domain/playoffs';
import LeaderBoard from '../../../components/site/LeaderBoard';
import { SectionHead, EmptyNote } from '../../../components/site/primitives';

export default function StatsPage() {
  usePageTitle('Stats');
  const { snapshot } = useLeague();
  if (!snapshot) return <EmptyNote>No league data yet.</EmptyNote>;

  const boards = (snapshot.seasons || [])
    .map(season => ({
      season,
      ...seasonPlayerTotals(season),
      playoffs: isPostseason(season) ? seasonPlayerTotals(season, { mode: 'playoffs' }) : null,
    }))
    .filter(entry => entry.players.length > 0 || (entry.playoffs && entry.playoffs.players.length > 0));

  return (
    <div>
      <SectionHead title="Stats">
        <span className="eyebrow text-ink-mute pb-0.5">
          {boards.length} {boards.length === 1 ? 'season' : 'seasons'}
        </span>
      </SectionHead>

      {boards.length === 0 ? (
        <EmptyNote>No player stats have been imported yet.</EmptyNote>
      ) : (
        boards.map(({ season, players, orphaned, playoffs }) => (
          <section key={season.id} className="mb-10">
            <div className="flex items-end justify-between gap-4 border-b-2 border-ink pb-1.5 mb-4">
              <h2 className="headline text-xl">{season.name}</h2>
              <span className="eyebrow text-ink-mute pb-0.5">
                {players.length} {players.length === 1 ? 'player' : 'players'}
              </span>
            </div>
            {players.length > 0 && (
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
            )}
            {orphaned > 0 && (
              <p className="text-tiny text-ink-faint mt-3">
                {orphaned} imported stat {orphaned === 1 ? 'line is' : 'lines are'} filed against a roster entry
                this season no longer has, so {orphaned === 1 ? 'it is' : 'they are'} not counted here.
              </p>
            )}
            {playoffs && playoffs.players.length > 0 && (
              <div className="mt-6">
                <div className="eyebrow text-ink-mute mb-2">Playoffs</div>
                <div className="space-y-5">
                  <LeaderBoard
                    title="Batting"
                    players={playoffs.players}
                    boards={BATTING_BOARDS_PLAYOFFS}
                    teamFor={id => seasonTeam(season, snapshot.teams, id)}
                  />
                  <LeaderBoard
                    title="Pitching"
                    players={playoffs.players}
                    boards={PITCHING_BOARDS_PLAYOFFS}
                    teamFor={id => seasonTeam(season, snapshot.teams, id)}
                  />
                </div>
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}
