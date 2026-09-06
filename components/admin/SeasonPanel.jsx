'use client';

import React, { useState } from 'react';
import { useAdminLeague } from '../../lib/AdminLeagueContext';
import { useLeague } from '../../lib/LeagueContext';
import {
  setSeasonSettings, setActiveSeason, setChampion, addSeason, clearPlayoffs,
  addGame, removeGame, swapHomeAway, generateRoundRobin,
  addDivision, renameDivision, removeDivision,
} from '../../lib/domain/rosterMutations';
import { teamDisplayName } from '../../lib/domain/core';
import { EmptyNote } from '../site/primitives';

const NUMBER_SETTINGS = [
  ['playoffSpots', 'Playoff spots'],
  ['standardInnings', 'Standard innings'],
  ['playInTeams', 'Play-in teams'],
  ['homeFieldBoost', 'Home field boost'],
];

function Settings({ season, mutate, saving }) {
  const s = season.settings || {};
  const [form, setForm] = useState({
    playoffSpots: s.playoffSpots ?? '',
    standardInnings: s.standardInnings ?? '',
    playInTeams: s.playInTeams ?? '',
    homeFieldBoost: s.homeFieldBoost ?? '',
    seriesLengths: (s.seriesLengths || []).join(', '),
    reseedPlayoffs: !!s.reseedPlayoffs,
    scheduleMode: s.scheduleMode || 'date',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <section className="card">
      <h2 className="headline text-lg px-3 py-2.5 border-b border-rule-strong">{season.name} settings</h2>
      <div className="px-3 py-3 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {NUMBER_SETTINGS.map(([key, label]) => (
            <label key={key} className="block">
              <span className="eyebrow text-ink-mute">{label}</span>
              <input
                value={form[key]}
                onChange={e => set(key, e.target.value)}
                inputMode="numeric"
                className="mt-0.5 w-full bg-paper-well border border-rule px-2 py-1.5 text-sm stat text-right"
              />
            </label>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="block sm:col-span-2">
            <span className="eyebrow text-ink-mute">Series lengths per round</span>
            <input
              value={form.seriesLengths}
              onChange={e => set('seriesLengths', e.target.value)}
              placeholder="3, 5, 7"
              className="mt-0.5 w-full bg-paper-well border border-rule px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="eyebrow text-ink-mute">Schedule mode</span>
            <select
              value={form.scheduleMode}
              onChange={e => set('scheduleMode', e.target.value)}
              className="mt-0.5 w-full bg-paper-well border border-rule px-2 py-1.5 text-sm"
            >
              <option value="date">Dates</option>
              <option value="round">Rounds</option>
            </select>
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.reseedPlayoffs} onChange={e => set('reseedPlayoffs', e.target.checked)} />
          Reseed each playoff round by standing
        </label>

        <button
          type="button"
          disabled={saving}
          onClick={() => mutate(setSeasonSettings(season.id, {
            playoffSpots: form.playoffSpots === '' ? undefined : Number(form.playoffSpots),
            standardInnings: form.standardInnings === '' ? undefined : Number(form.standardInnings),
            playInTeams: form.playInTeams === '' ? undefined : Number(form.playInTeams),
            homeFieldBoost: form.homeFieldBoost === '' ? undefined : Number(form.homeFieldBoost),
            seriesLengths: form.seriesLengths.trim()
              ? form.seriesLengths.split(/\s*,\s*/).map(Number).filter(n => !Number.isNaN(n))
              : undefined,
            reseedPlayoffs: form.reseedPlayoffs,
            scheduleMode: form.scheduleMode,
          }))}
          className="eyebrow bg-navy text-white px-3 py-2 disabled:opacity-40"
        >
          Save settings
        </button>
      </div>
    </section>
  );
}

function Divisions({ season, mutate, saving }) {
  const [name, setName] = useState('');
  const divisions = season.divisions || [];

  return (
    <section className="card mt-6">
      <h2 className="headline text-lg px-3 py-2.5 border-b border-rule-strong">Divisions</h2>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-rule">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Division name (e.g. East)"
          className="flex-1 bg-paper-well border border-rule px-2 py-1.5 text-sm" />
        <button
          type="button"
          disabled={saving || !name.trim()}
          onClick={async () => { const r = await mutate(addDivision(season.id, name)); if (r.ok) setName(''); }}
          className="eyebrow bg-navy text-white px-3 py-2 disabled:opacity-40"
        >
          Add division
        </button>
      </div>
      {divisions.length === 0 ? (
        <EmptyNote>No divisions yet — assign teams to a division from the Roster tab's Teams list once one exists.</EmptyNote>
      ) : (
        <div className="row-rule">
          {divisions.map(d => (
            <div key={d.id} className="flex items-center gap-2 px-3 py-2.5">
              <input
                defaultValue={d.name}
                onBlur={e => { if (e.target.value.trim() && e.target.value.trim() !== d.name) mutate(renameDivision(season.id, d.id, e.target.value)); }}
                className="flex-1 bg-paper-well border border-rule px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                disabled={saving}
                onClick={() => { if (confirm(`Remove "${d.name}"? Teams in it become unassigned.`)) mutate(removeDivision(season.id, d.id)); }}
                className="eyebrow text-loss hover:underline disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Seasons({ league, season, teams, mutate, saving }) {
  const [name, setName] = useState('');
  return (
    <section className="card mt-6">
      <h2 className="headline text-lg px-3 py-2.5 border-b border-rule-strong">Seasons</h2>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-rule">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New season name"
          className="flex-1 bg-paper-well border border-rule px-2 py-1.5 text-sm" />
        <button
          type="button"
          disabled={saving || !name.trim()}
          onClick={async () => { const r = await mutate(addSeason(name)); if (r.ok) setName(''); }}
          className="eyebrow bg-navy text-white px-3 py-2 disabled:opacity-40"
        >
          Create
        </button>
      </div>
      <div className="row-rule">
        {(league.seasons || []).map(s => {
          const active = s.id === league.activeSeasonId;
          const champ = s.championTeamId ? teamDisplayName(s.championTeamId, s, teams) : null;
          return (
            <div key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              <span className="text-sm font-medium flex-1 min-w-[8rem] truncate">
                {s.name}{active && <span className="eyebrow text-win ml-2">Active</span>}
              </span>
              <span className="text-tiny text-ink-mute">
                {(s.members || []).length} clubs · {(s.games || []).length} games{champ ? ` · ${champ}` : ''}
              </span>
              <select
                value={s.championTeamId || ''}
                onChange={e => mutate(setChampion(s.id, e.target.value || null))}
                className="bg-paper-well border border-rule px-2 py-1 text-tiny"
              >
                <option value="">No champion</option>
                {(s.members || []).map(m => (
                  <option key={m.teamId} value={m.teamId}>{teamDisplayName(m.teamId, s, teams)}</option>
                ))}
              </select>
              {!active && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => { if (confirm(`Make ${s.name} the active season? The public site will switch to it.`)) mutate(setActiveSeason(s.id)); }}
                  className="eyebrow border border-rule px-2 py-1 disabled:opacity-40"
                >
                  Make active
                </button>
              )}
              <button
                type="button"
                disabled={saving}
                onClick={() => { if (confirm(`Clear every playoff game in ${s.name} and unset its champion?`)) mutate(clearPlayoffs(s.id)); }}
                className="eyebrow text-loss hover:underline disabled:opacity-40"
              >
                Clear playoffs
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Schedule({ season, teams, mutate, saving }) {
  const [form, setForm] = useState({ awayTeamId: '', homeTeamId: '', date: '' });
  const [rounds, setRounds] = useState('1');
  const options = (season.members || []).filter(m => m.active !== false);
  const unplayed = (season.games || []).filter(g => !g.isBye).slice(-25).reverse();

  return (
    <section className="card mt-6">
      <h2 className="headline text-lg px-3 py-2.5 border-b border-rule-strong">Schedule</h2>

      <div className="flex flex-wrap items-end gap-2 px-3 py-2.5 border-b border-rule">
        <select value={form.awayTeamId} onChange={e => setForm(f => ({ ...f, awayTeamId: e.target.value }))}
          className="bg-paper-well border border-rule px-2 py-1.5 text-sm">
          <option value="">Away…</option>
          {options.map(m => <option key={m.teamId} value={m.teamId}>{teamDisplayName(m.teamId, season, teams)}</option>)}
        </select>
        <span className="text-ink-faint pb-2">@</span>
        <select value={form.homeTeamId} onChange={e => setForm(f => ({ ...f, homeTeamId: e.target.value }))}
          className="bg-paper-well border border-rule px-2 py-1.5 text-sm">
          <option value="">Home…</option>
          {options.map(m => <option key={m.teamId} value={m.teamId}>{teamDisplayName(m.teamId, season, teams)}</option>)}
        </select>
        <input value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
          placeholder="Date or round label" className="bg-paper-well border border-rule px-2 py-1.5 text-sm w-44" />
        <button
          type="button"
          disabled={saving || !form.awayTeamId || !form.homeTeamId || form.awayTeamId === form.homeTeamId}
          onClick={async () => {
            const r = await mutate(addGame(season.id, { ...form, date: form.date.trim() || null }));
            if (r.ok) setForm({ awayTeamId: '', homeTeamId: '', date: '' });
          }}
          className="eyebrow bg-navy text-white px-3 py-2 disabled:opacity-40"
        >
          Add game
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-rule">
        <span className="eyebrow text-ink-mute">Round robin</span>
        <input value={rounds} onChange={e => setRounds(e.target.value)} inputMode="numeric"
          className="bg-paper-well border border-rule px-2 py-1.5 text-sm w-16 stat text-right" />
        <span className="text-tiny text-ink-mute">time{rounds === '1' ? '' : 's'} through</span>
        <button
          type="button"
          disabled={saving || !Number(rounds)}
          onClick={() => {
            const n = Number(rounds);
            const teamsCount = options.length;
            const games = (teamsCount * (teamsCount - 1) / 2) * n;
            if (confirm(`Generate ${games} games and append them to ${season.name}?`)) {
              mutate(generateRoundRobin(season.id, n));
            }
          }}
          className="eyebrow border border-rule px-2.5 py-1.5 disabled:opacity-40"
        >
          Generate
        </button>
      </div>

      <div className="row-rule max-h-96 overflow-y-auto">
        {unplayed.length === 0 ? <EmptyNote>No games yet.</EmptyNote> : unplayed.map(g => (
          <div key={g.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="eyebrow text-ink-faint w-24 truncate">{g.isPlayoff ? `R${g.playoffRound}` : (g.date || '—')}</span>
            <span className="flex-1 min-w-0 truncate">
              {teamDisplayName(g.awayTeamId, season, teams)} @ {teamDisplayName(g.homeTeamId, season, teams)}
            </span>
            {g.played && <span className="stat text-tiny">{g.awayScore}-{g.homeScore}</span>}
            <button type="button" disabled={saving} onClick={() => mutate(swapHomeAway(season.id, g.id))}
              className="eyebrow border border-rule px-2 py-1 disabled:opacity-40">Swap</button>
            <button
              type="button"
              disabled={saving}
              onClick={() => { if (confirm('Delete this game?')) mutate(removeGame(season.id, g.id)); }}
              className="eyebrow text-loss hover:underline disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function SeasonPanel() {
  const { league, season, mutate, saving } = useAdminLeague();
  const { snapshot } = useLeague();
  const teams = (snapshot && snapshot.teams) || {};
  if (!league || !season) return <EmptyNote>No season is loaded.</EmptyNote>;
  return (
    <div>
      <Settings season={season} mutate={mutate} saving={saving} />
      <Divisions season={season} mutate={mutate} saving={saving} />
      <Schedule season={season} teams={teams} mutate={mutate} saving={saving} />
      <Seasons league={league} season={season} teams={teams} mutate={mutate} saving={saving} />
    </div>
  );
}
