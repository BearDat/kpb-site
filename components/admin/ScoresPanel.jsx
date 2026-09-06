'use client';

import React, { useMemo, useState } from 'react';
import { useAdminLeague } from '../../lib/AdminLeagueContext';
import { useLeague } from '../../lib/LeagueContext';
import { saveScore, clearScore, declareForfeit, setGameTime, setGameStreamUrl } from '../../lib/domain/mutations';
import { teamDisplayName } from '../../lib/domain/core';
import { EmptyNote } from '../site/primitives';

const FILTERS = [
  { key: 'unplayed', label: 'Not played' },
  { key: 'played', label: 'Played' },
  { key: 'all', label: 'All' },
];

function localInputValue(ms) {
  if (ms == null) return '';
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function GameRow({ game, season, teams, saving, onSave, onClear, onForfeit, onTime, onStreamUrl }) {
  const [away, setAway] = useState(game.awayScore == null ? '' : String(game.awayScore));
  const [home, setHome] = useState(game.homeScore == null ? '' : String(game.homeScore));
  const [innings, setInnings] = useState(game.innings == null ? '' : String(game.innings));
  const [when, setWhen] = useState(localInputValue(game.gameTimeUTC));
  const [stream, setStream] = useState(game.streamUrl || '');
  const [open, setOpen] = useState(false);

  const awayName = teamDisplayName(game.awayTeamId, season, teams);
  const homeName = teamDisplayName(game.homeTeamId, season, teams);
  const dirty = away !== (game.awayScore == null ? '' : String(game.awayScore))
    || home !== (game.homeScore == null ? '' : String(game.homeScore))
    || innings !== (game.innings == null ? '' : String(game.innings));
  const valid = away !== '' && home !== '' && !Number.isNaN(Number(away)) && !Number.isNaN(Number(home));

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="eyebrow text-ink-faint w-28 flex-shrink-0 truncate">
          {game.isPlayoff ? `Playoffs R${game.playoffRound}${game.seriesGame ? ` G${game.seriesGame}` : ''}` : (game.date || '—')}
        </span>
        <span className="text-sm flex-1 min-w-[12rem] truncate">
          {awayName} <span className="text-ink-faint">@</span> {homeName}
        </span>
        <input
          value={away}
          onChange={e => setAway(e.target.value)}
          inputMode="numeric"
          aria-label={`${awayName} runs`}
          className="w-12 bg-paper-well border border-rule px-2 py-1 text-sm stat text-right"
        />
        <span className="text-ink-faint">–</span>
        <input
          value={home}
          onChange={e => setHome(e.target.value)}
          inputMode="numeric"
          aria-label={`${homeName} runs`}
          className="w-12 bg-paper-well border border-rule px-2 py-1 text-sm stat text-right"
        />
        <input
          value={innings}
          onChange={e => setInnings(e.target.value)}
          inputMode="numeric"
          placeholder="inn"
          aria-label="Innings"
          className="w-14 bg-paper-well border border-rule px-2 py-1 text-sm stat text-right"
        />
        <button
          type="button"
          disabled={saving || !valid || (!dirty && game.played)}
          onClick={() => onSave(game.id, {
            awayScore: Number(away),
            homeScore: Number(home),
            innings: innings === '' ? null : Number(innings),
          })}
          className="eyebrow bg-navy text-white px-2.5 py-1.5 disabled:opacity-40"
        >
          Save
        </button>
        <button type="button" onClick={() => setOpen(v => !v)} className="eyebrow text-ink-mute hover:text-brick">
          {open ? 'Less' : 'More'}
        </button>
        {game.played && <span className="eyebrow text-win">Final</span>}
        {game.isForfeit && <span className="eyebrow text-brick">FFT</span>}
        {game.streamUrl && <span className="eyebrow text-brick">Stream</span>}
      </div>

      {open && (
        <div className="flex items-center gap-2 flex-wrap mt-2 pl-2 border-l-2 border-rule">
          <input
            type="datetime-local"
            value={when}
            onChange={e => setWhen(e.target.value)}
            className="bg-paper-well border border-rule px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={saving}
            onClick={() => onTime(game.id, when ? new Date(when).getTime() : null)}
            className="eyebrow border border-rule px-2.5 py-1.5 disabled:opacity-40"
          >
            Set time
          </button>
          <input
            value={stream}
            onChange={e => setStream(e.target.value)}
            placeholder="Stream link (Twitch/YouTube)"
            aria-label="Stream link"
            className="bg-paper-well border border-rule px-2 py-1 text-sm w-56"
          />
          <button
            type="button"
            disabled={saving || stream.trim() === (game.streamUrl || '')}
            onClick={() => onStreamUrl(game.id, stream)}
            className="eyebrow border border-rule px-2.5 py-1.5 disabled:opacity-40"
          >
            Save link
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onForfeit(game.id, 'away')}
            className="eyebrow border border-rule px-2.5 py-1.5 disabled:opacity-40"
          >
            {awayName} forfeits
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onForfeit(game.id, 'home')}
            className="eyebrow border border-rule px-2.5 py-1.5 disabled:opacity-40"
          >
            {homeName} forfeits
          </button>
          {game.played && (
            <button
              type="button"
              disabled={saving}
              onClick={() => { if (confirm(`Clear the result for ${awayName} @ ${homeName}?`)) onClear(game.id); }}
              className="eyebrow border border-loss text-loss px-2.5 py-1.5 disabled:opacity-40"
            >
              Clear result
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ScoresPanel() {
  const { league, season, seedById, mutate, saving } = useAdminLeague();
  const { snapshot } = useLeague();
  const teams = (snapshot && snapshot.teams) || {};
  const [filter, setFilter] = useState('unplayed');
  const [query, setQuery] = useState('');

  const games = useMemo(() => {
    if (!season) return [];
    const all = (season.games || []).filter(g => !g.isBye);
    const byFilter = filter === 'all' ? all : all.filter(g => (filter === 'played' ? g.played : !g.played));
    const q = query.trim().toLowerCase();
    const matched = q
      ? byFilter.filter(g => `${teamDisplayName(g.awayTeamId, season, teams)} ${teamDisplayName(g.homeTeamId, season, teams)}`.toLowerCase().includes(q))
      : byFilter;
    return matched.slice().sort((a, b) => {
      if (a.gameTimeUTC != null && b.gameTimeUTC != null) return a.gameTimeUTC - b.gameTimeUTC;
      if (a.gameTimeUTC != null) return -1;
      if (b.gameTimeUTC != null) return 1;
      return 0;
    });
  }, [season, filter, query, teams]);

  if (!league || !season) return <EmptyNote>No season is loaded.</EmptyNote>;

  return (
    <section className="card">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-rule-strong flex-wrap">
        <h2 className="headline text-lg">Scores · {season.name}</h2>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter by team"
            className="bg-paper-well border border-rule px-2 py-1 text-sm w-40"
          />
          <div className="flex items-stretch gap-px bg-rule border border-rule">
            {FILTERS.map(f => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`eyebrow px-2.5 py-1.5 ${filter === f.key ? 'bg-navy text-white' : 'bg-paper text-ink-mute hover:text-brick'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {games.length === 0 ? (
        <EmptyNote>No games match.</EmptyNote>
      ) : (
        <div className="row-rule">
          {games.map(g => (
            <GameRow
              key={g.id}
              game={g}
              season={season}
              teams={teams}
              saving={saving}
              onSave={(id, scores) => mutate(saveScore(season.id, id, scores, seedById))}
              onClear={id => mutate(clearScore(season.id, id, seedById))}
              onForfeit={(id, side) => mutate(declareForfeit(season.id, id, side, seedById))}
              onTime={(id, ms) => mutate(setGameTime(season.id, id, ms))}
              onStreamUrl={(id, url) => mutate(setGameStreamUrl(season.id, id, url))}
            />
          ))}
        </div>
      )}
    </section>
  );
}
