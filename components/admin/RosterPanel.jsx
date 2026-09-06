'use client';

import React, { useMemo, useState } from 'react';
import { useAdminLeague } from '../../lib/AdminLeagueContext';
import { useLeague } from '../../lib/LeagueContext';
import {
  addPlayer, updatePlayer, releasePlayer, signFreeAgent, deleteFreeAgent,
  tradePlayers, setPlayerDiscipline, setRebrand, setMemberActive, removeMember,
  setMemberDivision,
} from '../../lib/domain/rosterMutations';
import { teamDisplayName } from '../../lib/domain/core';
import { EmptyNote } from '../site/primitives';

const TABS = [
  { key: 'rosters', label: 'Rosters' },
  { key: 'trade', label: 'Trade' },
  { key: 'free', label: 'Free agents' },
  { key: 'teams', label: 'Teams' },
];

function PlayerRow({ player, seasonId, teamId, saving, mutate }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(player.name);
  const [stars, setStars] = useState(player.starLevel == null ? '' : String(player.starLevel));
  const [reason, setReason] = useState('');
  const [games, setGames] = useState('');

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-sm flex-1 min-w-0 truncate">{player.name}</span>
        <span className="stat text-tiny text-ink-faint w-8 text-right">
          {player.starLevel == null ? 'R' : player.starLevel}
        </span>
        {player.suspended && <span className="eyebrow text-brick">SUSP</span>}
        {player.banned && <span className="eyebrow text-loss">BAN</span>}
        <button type="button" onClick={() => setOpen(v => !v)} className="eyebrow text-ink-mute hover:text-brick">
          {open ? 'Close' : 'Manage'}
        </button>
      </div>

      {open && (
        <div className="mt-2 pl-2 border-l-2 border-rule space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Name"
              className="bg-paper-well border border-rule px-2 py-1 text-sm w-44" />
            <input value={stars} onChange={e => setStars(e.target.value)} placeholder="stars" inputMode="decimal"
              className="bg-paper-well border border-rule px-2 py-1 text-sm w-20 stat text-right" />
            <button
              type="button"
              disabled={saving}
              onClick={() => mutate(updatePlayer(seasonId, player.id, {
                name: name.trim(),
                starLevel: stars === '' ? null : Number(stars),
              }))}
              className="eyebrow bg-navy text-white px-2.5 py-1.5 disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => { if (confirm(`Release ${player.name} to free agency?`)) mutate(releasePlayer(seasonId, player.id)); }}
              className="eyebrow border border-rule px-2.5 py-1.5 disabled:opacity-40"
            >
              Release
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason"
              className="bg-paper-well border border-rule px-2 py-1 text-sm flex-1 min-w-[10rem]" />
            <input value={games} onChange={e => setGames(e.target.value)} placeholder="games" inputMode="numeric"
              className="bg-paper-well border border-rule px-2 py-1 text-sm w-20 stat text-right" />
            <button
              type="button"
              disabled={saving}
              onClick={() => mutate(setPlayerDiscipline(seasonId, player.id, {
                suspended: !player.suspended,
                reason,
                games: games === '' ? null : Number(games),
              }))}
              className="eyebrow border border-rule px-2.5 py-1.5 disabled:opacity-40"
            >
              {player.suspended ? 'Reinstate' : 'Suspend'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => mutate(setPlayerDiscipline(seasonId, player.id, { banned: !player.banned, reason }))}
              className="eyebrow border border-loss text-loss px-2.5 py-1.5 disabled:opacity-40"
            >
              {player.banned ? 'Unban' : 'Ban'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Rosters({ season, teams, mutate, saving }) {
  const [openTeam, setOpenTeam] = useState(null);
  const [name, setName] = useState('');
  const [stars, setStars] = useState('');

  return (
    <div className="space-y-4">
      {(season.members || []).map(member => {
        const label = teamDisplayName(member.teamId, season, teams);
        const roster = [...(member.roster || [])].sort((a, b) => (b.starLevel || 0) - (a.starLevel || 0));
        const open = openTeam === member.teamId;
        return (
          <section key={member.teamId} className="card">
            <button
              type="button"
              onClick={() => setOpenTeam(open ? null : member.teamId)}
              className="w-full flex items-center justify-between px-3 py-2.5 border-b border-rule-strong"
            >
              <span className="headline text-base">{label}</span>
              <span className="eyebrow text-ink-mute">{roster.length} players {open ? '▾' : '▸'}</span>
            </button>
            {open && (
              <>
                <div className="row-rule">
                  {roster.length === 0
                    ? <EmptyNote>No players.</EmptyNote>
                    : roster.map(p => (
                      <PlayerRow key={p.id} player={p} seasonId={season.id} teamId={member.teamId}
                        saving={saving} mutate={mutate} />
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-t border-rule">
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="New player name"
                    className="bg-paper-well border border-rule px-2 py-1.5 text-sm flex-1 min-w-[10rem]" />
                  <input value={stars} onChange={e => setStars(e.target.value)} placeholder="stars" inputMode="decimal"
                    className="bg-paper-well border border-rule px-2 py-1.5 text-sm w-20 stat text-right" />
                  <button
                    type="button"
                    disabled={saving || !name.trim()}
                    onClick={async () => {
                      const r = await mutate(addPlayer(season.id, member.teamId, name, stars));
                      if (r.ok) { setName(''); setStars(''); }
                    }}
                    className="eyebrow bg-navy text-white px-3 py-2 disabled:opacity-40"
                  >
                    Add player
                  </button>
                </div>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

function TradeTab({ season, teams, mutate, saving }) {
  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');
  const [picked, setPicked] = useState({});

  const rosterOf = (teamId) => {
    const m = (season.members || []).find(x => x.teamId === teamId);
    return m ? (m.roster || []) : [];
  };
  const toggle = (playerId, toTeamId) => setPicked(p => (
    p[playerId] ? { ...p, [playerId]: undefined } : { ...p, [playerId]: toTeamId }
  ));
  const moves = Object.entries(picked).filter(([, to]) => to).map(([playerId, toTeamId]) => ({ playerId, toTeamId }));

  const Side = ({ teamId, otherId }) => (
    <div className="card">
      <div className="px-3 py-2 border-b border-rule-strong eyebrow text-ink-mute">
        {teamId ? teamDisplayName(teamId, season, teams) : 'Pick a team'}
      </div>
      <div className="max-h-64 overflow-y-auto row-rule">
        {rosterOf(teamId).map(p => (
          <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-paper-well">
            <input type="checkbox" checked={!!picked[p.id]} onChange={() => toggle(p.id, otherId)} disabled={!otherId} />
            <span className="flex-1 min-w-0 truncate">{p.name}</span>
            <span className="stat text-tiny text-ink-faint">{p.starLevel == null ? 'R' : p.starLevel}</span>
          </label>
        ))}
      </div>
    </div>
  );

  const options = (season.members || []).map(m => ({ id: m.teamId, name: teamDisplayName(m.teamId, season, teams) }));

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <select value={teamA} onChange={e => { setTeamA(e.target.value); setPicked({}); }}
          className="bg-paper-well border border-rule px-2 py-1.5 text-sm">
          <option value="">Team A…</option>
          {options.filter(o => o.id !== teamB).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select value={teamB} onChange={e => { setTeamB(e.target.value); setPicked({}); }}
          className="bg-paper-well border border-rule px-2 py-1.5 text-sm">
          <option value="">Team B…</option>
          {options.filter(o => o.id !== teamA).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <Side teamId={teamA} otherId={teamB} />
        <Side teamId={teamB} otherId={teamA} />
      </div>

      <div className="flex items-center gap-3 mt-3">
        <button
          type="button"
          disabled={saving || moves.length === 0}
          onClick={async () => {
            const r = await mutate(tradePlayers(season.id, moves));
            if (r.ok) setPicked({});
          }}
          className="eyebrow bg-navy text-white px-3 py-2 disabled:opacity-40"
        >
          Execute trade
        </button>
        <span className="text-tiny text-ink-mute">
          {moves.length === 0 ? 'Tick the players moving from each side.' : `${moves.length} player${moves.length === 1 ? '' : 's'} moving`}
        </span>
      </div>
    </div>
  );
}

function FreeAgents({ season, teams, mutate, saving }) {
  const [target, setTarget] = useState('');
  const list = [...(season.freeAgents || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-rule-strong">
        <h2 className="headline text-lg">Free agents</h2>
        <select value={target} onChange={e => setTarget(e.target.value)}
          className="bg-paper-well border border-rule px-2 py-1.5 text-sm">
          <option value="">Sign to…</option>
          {(season.members || []).map(m => (
            <option key={m.teamId} value={m.teamId}>{teamDisplayName(m.teamId, season, teams)}</option>
          ))}
        </select>
      </div>
      {list.length === 0 ? <EmptyNote>No free agents.</EmptyNote> : (
        <div className="row-rule">
          {list.map(p => (
            <div key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="flex-1 min-w-0 truncate">{p.name}</span>
              <span className="stat text-tiny text-ink-faint">{p.starLevel == null ? 'R' : p.starLevel}</span>
              <button
                type="button"
                disabled={saving || !target}
                onClick={() => mutate(signFreeAgent(season.id, target, p.id))}
                className="eyebrow bg-navy text-white px-2.5 py-1.5 disabled:opacity-40"
              >
                Sign
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => { if (confirm(`Delete ${p.name} entirely?`)) mutate(deleteFreeAgent(season.id, p.id)); }}
                className="eyebrow text-loss hover:underline disabled:opacity-40"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TeamsTab({ season, teams, mutate, saving }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', abbr: '', color: '' });

  return (
    <div className="space-y-3">
      {(season.members || []).map(member => {
        const label = teamDisplayName(member.teamId, season, teams);
        const rb = member.rebrand || {};
        const open = editing === member.teamId;
        return (
          <section key={member.teamId} className="card">
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{label}</p>
                <p className="text-tiny text-ink-mute">
                  {member.active === false ? 'Inactive' : 'Active'}
                  {member.rebrand ? ' · rebranded this season' : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditing(open ? null : member.teamId);
                  setForm({ name: rb.name || '', abbr: rb.abbr || '', color: rb.color || '' });
                }}
                className="eyebrow text-ink-mute hover:text-brick"
              >
                {open ? 'Close' : 'Rebrand'}
              </button>
              {(season.divisions || []).length > 0 && (
                <select
                  value={member.divisionId || ''}
                  disabled={saving}
                  onChange={e => mutate(setMemberDivision(season.id, member.teamId, e.target.value || null))}
                  className="bg-paper-well border border-rule px-2 py-1 text-tiny"
                >
                  <option value="">No division</option>
                  {season.divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
              <button
                type="button"
                disabled={saving}
                onClick={() => mutate(setMemberActive(season.id, member.teamId, member.active === false))}
                className="eyebrow border border-rule px-2 py-1 disabled:opacity-40"
              >
                {member.active === false ? 'Activate' : 'Deactivate'}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => { if (confirm(`Remove ${label} from ${season.name}? Its games stay on the schedule.`)) mutate(removeMember(season.id, member.teamId)); }}
                className="eyebrow text-loss hover:underline disabled:opacity-40"
              >
                Remove
              </button>
            </div>
            {open && (
              <div className="border-t border-rule px-3 py-2.5 flex flex-wrap items-center gap-2">
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Season name" className="bg-paper-well border border-rule px-2 py-1.5 text-sm flex-1 min-w-[10rem]" />
                <input value={form.abbr} onChange={e => setForm(f => ({ ...f, abbr: e.target.value }))}
                  placeholder="ABBR" className="bg-paper-well border border-rule px-2 py-1.5 text-sm w-24" />
                <input type="color" value={form.color || '#0C2340'} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  className="h-9 w-14 bg-paper-well border border-rule" />
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => mutate(setRebrand(season.id, member.teamId, form.name.trim()
                    ? { ...(member.rebrand || {}), name: form.name.trim(), abbr: form.abbr.trim() || null, color: form.color || null }
                    : null))}
                  className="eyebrow bg-navy text-white px-3 py-2 disabled:opacity-40"
                >
                  Save
                </button>
                {member.rebrand && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => mutate(setRebrand(season.id, member.teamId, null))}
                    className="eyebrow border border-rule px-2.5 py-1.5 disabled:opacity-40"
                  >
                    Clear rebrand
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default function RosterPanel() {
  const { league, season, mutate, saving } = useAdminLeague();
  const { snapshot } = useLeague();
  const teams = (snapshot && snapshot.teams) || {};
  const [tab, setTab] = useState('rosters');

  const body = useMemo(() => {
    if (!season) return null;
    if (tab === 'trade') return <TradeTab season={season} teams={teams} mutate={mutate} saving={saving} />;
    if (tab === 'free') return <FreeAgents season={season} teams={teams} mutate={mutate} saving={saving} />;
    if (tab === 'teams') return <TeamsTab season={season} teams={teams} mutate={mutate} saving={saving} />;
    return <Rosters season={season} teams={teams} mutate={mutate} saving={saving} />;
  }, [tab, season, teams, mutate, saving]);

  if (!league || !season) return <EmptyNote>No season is loaded.</EmptyNote>;

  return (
    <div>
      <div className="flex items-stretch gap-px bg-rule border border-rule mb-4 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`eyebrow px-3 py-2 whitespace-nowrap ${
              tab === t.key ? 'bg-navy text-white' : 'bg-paper text-ink-mute hover:text-brick'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {body}
    </div>
  );
}
