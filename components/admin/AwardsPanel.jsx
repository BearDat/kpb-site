'use client';

import React, { useMemo, useState } from 'react';
import { useAdminLeague } from '../../lib/AdminLeagueContext';
import { useLeague } from '../../lib/LeagueContext';
import {
  addAwardDef, removeAwardDef, addAwardWinner, removeAwardWinnerAt,
  addHallOfFameEntry, updateHallOfFameEntry, removeHallOfFameEntry,
} from '../../lib/domain/mutations';
import { teamDisplayName } from '../../lib/domain/core';
import { EmptyNote } from '../site/primitives';

function winnerList(season, awardId) {
  const raw = (season.awardWinners || {})[awardId];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function WinnerPicker({ season, teams, onPick, onCancel }) {
  const [manual, setManual] = useState('');
  const players = useMemo(() => {
    const out = [];
    (season.members || []).forEach(m => (m.roster || []).forEach(p => out.push({
      id: p.id, name: p.name, teamId: m.teamId, teamName: teamDisplayName(m.teamId, season, teams),
    })));
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [season, teams]);
  const [query, setQuery] = useState('');
  const shown = query.trim()
    ? players.filter(p => p.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 40)
    : players.slice(0, 40);

  return (
    <div className="border-t border-rule px-3 py-2.5 space-y-2">
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search this season's rosters"
        className="w-full bg-paper-well border border-rule px-2 py-1.5 text-sm"
      />
      <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
        {shown.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick({ type: 'player', playerId: p.id, teamId: p.teamId })}
            className="text-tiny border border-rule bg-paper px-2 py-1 hover:border-brick"
          >
            {p.name} <span className="text-ink-faint">{p.teamName}</span>
          </button>
        ))}
        {shown.length === 0 && <span className="text-tiny text-ink-faint">No roster player matches.</span>}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={manual}
          onChange={e => setManual(e.target.value)}
          placeholder="Or a name not on a roster"
          className="flex-1 bg-paper-well border border-rule px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          disabled={!manual.trim()}
          onClick={() => onPick({ type: 'player', playerId: null, name: manual.trim(), teamId: null })}
          className="eyebrow bg-navy text-white px-2.5 py-1.5 disabled:opacity-40"
        >
          Add
        </button>
        <button type="button" onClick={onCancel} className="eyebrow text-ink-mute hover:text-brick">Cancel</button>
      </div>
    </div>
  );
}

function InducteeRow({ entry, saving, mutate }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: entry.name || '', year: entry.year || '', playerName: entry.playerName || '', note: entry.note || '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {entry.name}{entry.year ? <span className="text-ink-mute"> · Class {entry.year}</span> : null}
          </p>
          {entry.note && <p className="text-tiny text-ink-mute whitespace-pre-line mt-0.5">{entry.note}</p>}
        </div>
        <button type="button" onClick={() => setEditing(v => !v)} className="eyebrow text-ink-mute hover:text-brick">
          {editing ? 'Close' : 'Edit'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => { if (confirm(`Remove ${entry.name} from the Hall of Fame?`)) mutate(removeHallOfFameEntry(entry.id)); }}
          className="eyebrow text-loss hover:underline disabled:opacity-40"
        >
          Remove
        </button>
      </div>
      {editing && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Name"
              className="bg-paper-well border border-rule px-2 py-1.5 text-sm" />
            <input value={form.year} onChange={e => set('year', e.target.value)} placeholder="Class (e.g. #3)"
              className="bg-paper-well border border-rule px-2 py-1.5 text-sm" />
            <input value={form.playerName} onChange={e => set('playerName', e.target.value)} placeholder="Player page name"
              className="bg-paper-well border border-rule px-2 py-1.5 text-sm" />
          </div>
          <textarea value={form.note} onChange={e => set('note', e.target.value)} rows={3} placeholder="Citation"
            className="w-full bg-paper-well border border-rule px-2 py-1.5 text-sm resize-y" />
          <button
            type="button"
            disabled={saving || !form.name.trim()}
            onClick={async () => { const r = await mutate(updateHallOfFameEntry(entry.id, form)); if (r.ok) setEditing(false); }}
            className="eyebrow bg-navy text-white px-3 py-2 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

function HallOfFame() {
  const { league, mutate, saving } = useAdminLeague();
  const [form, setForm] = useState({ name: '', year: '', playerName: '', note: '' });
  const entries = [...((league && league.hallOfFame) || [])].sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <section className="card mt-6">
      <h2 className="headline text-lg px-3 py-2.5 border-b border-rule-strong">Hall of Fame</h2>
      <div className="px-3 py-3 space-y-2 border-b border-rule">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Name"
            className="bg-paper-well border border-rule px-2 py-1.5 text-sm" />
          <input value={form.year} onChange={e => set('year', e.target.value)} placeholder="Class (e.g. #3)"
            className="bg-paper-well border border-rule px-2 py-1.5 text-sm" />
          <input value={form.playerName} onChange={e => set('playerName', e.target.value)} placeholder="Player page name"
            className="bg-paper-well border border-rule px-2 py-1.5 text-sm" />
        </div>
        <textarea value={form.note} onChange={e => set('note', e.target.value)} rows={3} placeholder="Citation"
          className="w-full bg-paper-well border border-rule px-2 py-1.5 text-sm resize-y" />
        <button
          type="button"
          disabled={saving || !form.name.trim()}
          onClick={async () => {
            const r = await mutate(addHallOfFameEntry(form));
            if (r.ok) setForm({ name: '', year: '', playerName: '', note: '' });
          }}
          className="eyebrow bg-navy text-white px-3 py-2 disabled:opacity-40"
        >
          Induct
        </button>
      </div>
      {entries.length === 0 ? (
        <EmptyNote>Nobody inducted yet.</EmptyNote>
      ) : (
        <div className="row-rule">
          {entries.map(e => <InducteeRow key={e.id} entry={e} saving={saving} mutate={mutate} />)}
        </div>
      )}
    </section>
  );
}

export default function AwardsPanel() {
  const { league, mutate, saving } = useAdminLeague();
  const { snapshot } = useLeague();
  const teams = (snapshot && snapshot.teams) || {};
  const [seasonId, setSeasonId] = useState(null);
  const [picking, setPicking] = useState(null);
  const [newAward, setNewAward] = useState('');

  if (!league) return <EmptyNote>No league is loaded.</EmptyNote>;
  const seasons = league.seasons || [];
  const season = seasons.find(s => s.id === (seasonId || league.activeSeasonId)) || seasons[0];
  if (!season) return <EmptyNote>This league has no seasons.</EmptyNote>;
  const defs = league.awardDefs || [];

  return (
    <div>
      <section className="card">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-rule-strong flex-wrap">
          <h2 className="headline text-lg">Awards</h2>
          <select
            value={season.id}
            onChange={e => setSeasonId(e.target.value)}
            className="bg-paper-well border border-rule px-2 py-1.5 text-sm"
          >
            {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-rule">
          <input
            value={newAward}
            onChange={e => setNewAward(e.target.value)}
            placeholder="New award name"
            className="flex-1 bg-paper-well border border-rule px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={saving || !newAward.trim()}
            onClick={async () => {
              const r = await mutate(addAwardDef(newAward, ''));
              if (r.ok) setNewAward('');
            }}
            className="eyebrow bg-navy text-white px-3 py-2 disabled:opacity-40"
          >
            Create
          </button>
        </div>

        {defs.length === 0 ? (
          <EmptyNote>No awards defined yet.</EmptyNote>
        ) : (
          <div className="row-rule">
            {defs.map(def => {
              const winners = winnerList(season, def.id);
              return (
                <div key={def.id}>
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{def.name}</p>
                      {def.description && <p className="text-tiny text-ink-mute">{def.description}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setPicking(picking === def.id ? null : def.id)}
                        className="eyebrow border border-rule px-2.5 py-1.5"
                      >
                        {winners.length > 0 ? 'Add winner' : 'Set winner'}
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => { if (confirm(`Delete the ${def.name} award? Winners recorded for it in every season are removed too.`)) mutate(removeAwardDef(def.id)); }}
                        className="eyebrow text-loss hover:underline disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {winners.length > 0 && (
                    <ul className="px-3 pb-2 flex flex-wrap gap-1.5">
                      {winners.map((w, i) => {
                        const roster = w.playerId
                          ? (season.members || []).flatMap(m => (m.roster || []).map(p => ({ ...p, teamId: m.teamId }))).find(p => p.id === w.playerId)
                          : null;
                        const label = roster ? roster.name : (w.name || 'Unknown');
                        const teamId = roster ? roster.teamId : w.teamId;
                        return (
                          <li key={i} className="flex items-center gap-1.5 border border-rule bg-brand-soft px-2 py-1 text-tiny">
                            <span className="font-medium">{label}</span>
                            {teamId && <span className="text-ink-faint">{teamDisplayName(teamId, season, teams)}</span>}
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => mutate(removeAwardWinnerAt(season.id, def.id, i))}
                              className="text-loss hover:underline disabled:opacity-40"
                            >
                              ×
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {picking === def.id && (
                    <WinnerPicker
                      season={season}
                      teams={teams}
                      onCancel={() => setPicking(null)}
                      onPick={async (winner) => {
                        const r = await mutate(addAwardWinner(season.id, def.id, winner));
                        if (r.ok) setPicking(null);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <HallOfFame />
    </div>
  );
}
