'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLeague, usePageTitle } from '../../../../lib/LeagueContext';
import { buildPlayer } from '../../../../lib/domain/player';
import { outsToIpDisplay } from '../../../../lib/domain/stats';
import { TeamMark, SectionHead, EmptyNote, TeamLink, cleanDiscordText, pct } from '../../../../components/site/primitives';
import { MediaItem } from '../../../../components/site/MediaGallery';

function Stat({ label, value }) {
  return (
    <div className="bg-paper px-3 py-2.5">
      <div className="eyebrow text-ink-mute">{label}</div>
      <div className="stat font-display font-bold text-2xl leading-tight mt-0.5">{value}</div>
    </div>
  );
}

function BattingRow({ label, totals, batting }) {
  return (
    <tr className="border-b border-rule last:border-b-0">
      <td className="px-2 py-2 text-sm font-medium">{label}</td>
      <td className="px-2 py-2 stat text-sm text-right text-ink-soft">{totals.g}</td>
      <td className="px-2 py-2 stat text-sm text-right text-ink-soft">{totals.ab}</td>
      <td className="px-2 py-2 stat text-sm text-right text-ink-soft">{totals.h}</td>
      <td className="px-2 py-2 stat text-sm text-right text-ink-soft">{totals.hr}</td>
      <td className="px-2 py-2 stat text-sm text-right text-ink-soft">{totals.rbi}</td>
      <td className="px-2 py-2 stat text-sm text-right text-ink-soft">{totals.r}</td>
      <td className="px-2 py-2 stat text-sm text-right">{pct(batting.avg)}</td>
      <td className="px-2 py-2 stat text-sm text-right">{batting.ops.toFixed(3)}</td>
    </tr>
  );
}

function PitchingRow({ label, totals, pitching }) {
  return (
    <tr className="border-b border-rule last:border-b-0">
      <td className="px-2 py-2 text-sm font-medium">{label}</td>
      <td className="px-2 py-2 stat text-sm text-right text-ink-soft">{outsToIpDisplay(totals.outs)}</td>
      <td className="px-2 py-2 stat text-sm text-right text-ink-soft">{totals.ha}</td>
      <td className="px-2 py-2 stat text-sm text-right text-ink-soft">{totals.er}</td>
      <td className="px-2 py-2 stat text-sm text-right text-ink-soft">{totals.k}</td>
      <td className="px-2 py-2 stat text-sm text-right">{pitching.era.toFixed(2)}</td>
      <td className="px-2 py-2 stat text-sm text-right">{pitching.whip.toFixed(2)}</td>
    </tr>
  );
}

const BATTING_HEAD = ['G', 'AB', 'H', 'HR', 'RBI', 'R', 'AVG', 'OPS'];
const PITCHING_HEAD = ['IP', 'H', 'ER', 'K', 'ERA', 'WHIP'];

function Head({ first, cols }) {
  return (
    <tr className="border-b border-rule-strong">
      <th scope="col" className="eyebrow text-ink-mute text-left px-2 py-2">{first}</th>
      {cols.map(c => (
        <th key={c} scope="col" className="eyebrow text-ink-mute text-right px-2 py-2">{c}</th>
      ))}
    </tr>
  );
}

export default function PlayerPage() {
  const { slug } = useParams();
  const { snapshot } = useLeague();
  const player = buildPlayer(snapshot, slug);
  usePageTitle(player ? player.name : 'Player');

  if (!snapshot) return <EmptyNote>No league data yet.</EmptyNote>;
  if (!player) return <EmptyNote>No player by that name has been on a roster in this league.</EmptyNote>;

  const { current, career, seasons, awards, hallOfFame } = player;
  const batted = seasons.filter(s => s.totals.ab > 0);
  const pitched = seasons.filter(s => s.totals.outs > 0);
  const highlights = [...(snapshot.highlights || [])]
    .filter(h => h.playerSlug === slug)
    .sort((a, b) => (b.at || 0) - (a.at || 0));

  return (
    <div>
      <header className="card mb-6 overflow-hidden">
        <div className="h-1.5" style={{ background: (current.team && current.team.color) || '#0C2340' }} />
        <div className="flex items-center gap-4 p-4">
          <TeamMark team={current.team} size={56} />
          <div className="min-w-0">
            <h1 className="headline text-3xl sm:text-4xl truncate">{player.name}</h1>
            <p className="eyebrow text-ink-mute mt-1">
              {current.team ? <TeamLink team={current.team}>{current.team.name}</TeamLink> : 'Free agent'}
              {' · '}
              {current.name}
              {typeof current.player.starLevel === 'number' && ` · ${current.player.starLevel} star`}
            </p>
          </div>
        </div>
        {player.hasStats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-rule border-t border-rule">
            <Stat label="Games" value={career.totals.g} />
            <Stat label="Average" value={pct(career.batting.avg)} />
            <Stat label="Home runs" value={career.totals.hr} />
            <Stat label="ERA" value={career.totals.outs > 0 ? career.pitching.era.toFixed(2) : '—'} />
          </div>
        )}
      </header>

      {hallOfFame && (
        <section className="card mb-6 overflow-hidden animate-fade-up">
          <div className="brand-rule" />
          <div className="px-4 py-3 bg-brand-soft">
            <p className="eyebrow text-ink-mute">
              Hall of Fame{hallOfFame.year ? ` · Class ${hallOfFame.year}` : ''}
            </p>
            {hallOfFame.note && (
              <p className="text-sm text-ink-soft whitespace-pre-line mt-1.5">{cleanDiscordText(hallOfFame.note)}</p>
            )}
          </div>
        </section>
      )}

      {awards.length > 0 && (
        <section className="mb-8">
          <SectionHead title="Honors">
            <span className="eyebrow text-ink-mute pb-0.5">{awards.length}</span>
          </SectionHead>
          <div className="flex flex-wrap gap-2">
            {awards.map((a, i) => (
              <Link
                key={`${a.awardId}-${a.seasonId}-${i}`}
                href={`/history/${a.seasonId}`}
                className={`text-sm px-2.5 py-1.5 border hover:border-brick ${
                  a.isChampionship ? 'border-brand bg-brand-soft' : 'border-rule bg-paper'
                }`}
              >
                <span className="font-medium">{a.award}</span>
                <span className="text-ink-mute"> · {a.seasonName}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {batted.length > 0 && (
        <section className="mb-8">
          <SectionHead title="Batting" />
          <div className="card overflow-x-auto">
            <table>
              <thead><Head first="Season" cols={BATTING_HEAD} /></thead>
              <tbody>
                {batted.map(s => <BattingRow key={s.id} label={s.name} totals={s.totals} batting={s.batting} />)}
                {batted.length > 1 && <BattingRow label="Career" totals={career.totals} batting={career.batting} />}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {pitched.length > 0 && (
        <section className="mb-8">
          <SectionHead title="Pitching" />
          <div className="card overflow-x-auto">
            <table>
              <thead><Head first="Season" cols={PITCHING_HEAD} /></thead>
              <tbody>
                {pitched.map(s => <PitchingRow key={s.id} label={s.name} totals={s.totals} pitching={s.pitching} />)}
                {pitched.length > 1 && <PitchingRow label="Career" totals={career.totals} pitching={career.pitching} />}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {highlights.length > 0 && (
        <section className="mb-8">
          <SectionHead title="Highlights">
            <span className="eyebrow text-ink-mute pb-0.5">{highlights.length}</span>
          </SectionHead>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {highlights.map(h => (
              <div key={h.id}>
                <MediaItem item={h.media} />
                <p className="text-sm font-medium mt-1.5">{h.title}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHead title="Seasons">
          <span className="eyebrow text-ink-mute pb-0.5">{seasons.length}</span>
        </SectionHead>
        <div className="card row-rule">
          {seasons.map(s => (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2.5">
              <TeamMark team={s.team} size={24} />
              <Link href={`/history/${s.id}`} className="text-sm font-medium hover:text-brick">{s.name}</Link>
              <span className="flex-1 min-w-0 truncate text-sm text-ink-mute">
                {s.team ? s.team.name : 'Free agent'}
              </span>
              {!s.hasStats && <span className="eyebrow text-ink-faint">No stats</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
