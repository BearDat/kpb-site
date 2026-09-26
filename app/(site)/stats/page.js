'use client';

import React, { useState } from 'react';
import { useLeague, usePageTitle } from '../../../lib/LeagueContext';
import { seasonPlayerTotals, BATTING_BOARDS, PITCHING_BOARDS, OVERALL_BOARDS, BATTING_BOARDS_PLAYOFFS, PITCHING_BOARDS_PLAYOFFS, OVERALL_BOARDS_PLAYOFFS } from '../../../lib/domain/stats';
import { seasonTeam } from '../../../lib/domain/awards';
import LeaderBoard from '../../../components/site/LeaderBoard';
import { SectionHead, EmptyNote } from '../../../components/site/primitives';

export default function StatsPage() {
  usePageTitle('Stats');
  const { snapshot } = useLeague();
  const [mode, setMode] = useState('regular');
  if (!snapshot) return <EmptyNote>No league data yet.</EmptyNote>;

  const battingBoards = mode === 'playoffs' ? BATTING_BOARDS_PLAYOFFS : BATTING_BOARDS;
  const pitchingBoards = mode === 'playoffs' ? PITCHING_BOARDS_PLAYOFFS : PITCHING_BOARDS;
  const overallBoards = mode === 'playoffs' ? OVERALL_BOARDS_PLAYOFFS : OVERALL_BOARDS;

  // Some seasons (mostly older ones, imported wholesale from hcbb.info) have
  // no game records at all — just aggregate stat lines — so playoff stats
  // can exist for a season with zero games ever flagged as playoff games.
  // Whether a season has anything to show for a mode is decided purely by
  // whether seasonPlayerTotals actually finds qualifying rows for it, never
  // by whether the schedule happens to record playoff games.
  const boards = (snapshot.seasons || [])
    .map(season => ({ season, ...seasonPlayerTotals(season, { mode }) }))
    .filter(entry => entry.players.length > 0);

  return (
    <div>
      <SectionHead title="Stats">
        <div className="flex items-center gap-3">
          <div className="flex border border-rule-strong">
            <button
              onClick={() => setMode('regular')}
              className={`eyebrow px-3 py-1.5 ${mode === 'regular' ? 'bg-ink text-paper' : 'text-ink-mute hover:text-ink'}`}
            >
              Regular season
            </button>
            <button
              onClick={() => setMode('playoffs')}
              className={`eyebrow px-3 py-1.5 border-l border-rule-strong ${mode === 'playoffs' ? 'bg-ink text-paper' : 'text-ink-mute hover:text-ink'}`}
            >
              Playoffs
            </button>
          </div>
          <span className="eyebrow text-ink-mute pb-0.5">
            {boards.length} {boards.length === 1 ? 'season' : 'seasons'}
          </span>
        </div>
      </SectionHead>

      {boards.length === 0 ? (
        <EmptyNote>{mode === 'playoffs' ? 'No playoff stats have been imported yet.' : 'No player stats have been imported yet.'}</EmptyNote>
      ) : (
        boards.map(({ season, players, orphaned }) => (
          <section key={season.id} className="mb-10">
            <div className="flex items-end justify-between gap-4 border-b-2 border-ink pb-1.5 mb-4">
              <h2 className="headline text-xl">{season.name}</h2>
              <span className="eyebrow text-ink-mute pb-0.5">
                {players.length} {players.length === 1 ? 'player' : 'players'}
              </span>
            </div>
            <div className="space-y-5">
              <LeaderBoard
                title="Batting"
                players={players}
                boards={battingBoards}
                teamFor={id => seasonTeam(season, snapshot.teams, id)}
              />
              <LeaderBoard
                title="Pitching"
                players={players}
                boards={pitchingBoards}
                teamFor={id => seasonTeam(season, snapshot.teams, id)}
              />
              <LeaderBoard
                title="Overall"
                players={players}
                boards={overallBoards}
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
        ))
      )}
    </div>
  );
}
