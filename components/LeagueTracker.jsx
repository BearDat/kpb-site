'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, BarChart, Bar, Cell, ScatterChart, Scatter, ReferenceLine, ZAxis,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, PieChart, Pie
} from 'recharts';
import {
  Trophy, Calendar, Users, BarChart3, Percent, Plus, Trash2, Upload,
  ChevronRight, ChevronLeft, ChevronUp, ChevronDown, Pencil, Check, X, Folder, Save, RefreshCw, ArrowLeft,
  Activity, AlertTriangle, Image as ImageIcon, Layers, Crown, History, Sparkles, Home as HomeIcon, Settings as SettingsIcon,
  Award as AwardIcon, Eye, EyeOff, Sun, Moon, Video, ClipboardList, Newspaper, Info as InfoIcon, TrendingUp, Star, Ban,
  Bell, Search, Pause, MessageSquare
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { AuthProvider, useAuth, ROLE_LABELS, ROLE_PERMISSIONS, ALL_PERMS, PERM_LABELS, PERM_DESCRIPTIONS } from '../lib/AuthContext';
import { advancePlayIn, advancePlayoffs } from '../lib/domain/advance';
import LoginControl from './LoginControl';
import BotReviewPanel, { BotEmojiPanel } from './BotReviewPanel';

// Single league this site serves. Set once you've created your league (see
// README) — skips the original app's multi-league picker screen entirely.
const FIXED_LEAGUE_ID = process.env.NEXT_PUBLIC_LEAGUE_ID || null;

/* ==================================================================== */
/* Theme                                                                 */
/* ==================================================================== */
// Default hex values, kept as constants for pickers/fallbacks. The colors
// actually used in styles below reference CSS custom properties instead,
// so the Appearance settings can change them live without prop-drilling
// through every component.
const DEFAULT_THEME = { chalk: '#F5F5F5', chalkDim: '#A0A0A0', primary: '#2DD4BF', ink: '#0A0A0A', panel: '#161616', panel2: '#202020', line: '#3A3A3A' };
const INK = 'var(--lt-ink, #0A0A0A)';
const PANEL = 'var(--lt-panel, #161616)';
const PANEL2 = 'var(--lt-panel2, #202020)';
const FIELD_BG = '#242424';
const LINE = 'var(--lt-line, #3A3A3A)';
const CHALK = 'var(--lt-chalk, #F5F5F5)';
const CHALK_DIM = 'var(--lt-chalk-dim, #A0A0A0)';
const PRIMARY = 'var(--lt-primary, #2DD4BF)';
const NEGATIVE = '#FB7166';
const GOLD = '#F5C64B';
// WIN is a dedicated "good/positive" green, deliberately separate from PRIMARY
// (the UI's teal accent color). PRIMARY is for chrome — buttons, active tabs,
// section titles — never for "this number is good" semantics; WIN is for that.
const WIN = '#4ADE80';
// Full theme presets, applied all at once via the "Preset" buttons in
// Appearance settings — a light mode wouldn't work by only swapping text
// colors, since the panel/background colors need to flip too.
const THEME_PRESETS = {
  dark: { chalk: '#F5F5F5', chalkDim: '#A0A0A0', primary: '#2DD4BF', ink: '#0A0A0A', panel: '#161616', panel2: '#202020', line: '#3A3A3A' },
  light: { chalk: '#111111', chalkDim: '#6E6E6E', primary: '#0D9488', ink: '#F5F5F5', panel: '#FFFFFF', panel2: '#EDEDED', line: '#DDDDDD' },
};

const TEAM_PALETTE = ['#2DD4BF', '#F5C64B', '#FB7166', '#7C9CF2', '#B98CE0', '#6FCF97', '#F2946B', '#5FD3E8', '#E88AC0', '#C7D15C'];

const DEFAULT_SETTINGS = { playoffSpots: 4, simRuns: 2000, standardInnings: 7, oddsDecimals: 1, scheduleMode: 'date', seriesLength: 1, oddsFormat: 'percent', homeFieldBoost: 4, playoffFormat: 'overall', playInTeams: 0, groupAdvanceCount: 2 };
// Sport selected at league creation. Drives terminology (innings vs quarters
// vs periods, runs vs points vs goals) and the default regulation length —
// the underlying game mechanics (two scores, win/loss, best-of-N playoff
// series) stay the same across sports; this is a terminology layer, not a
// full separate rules engine per sport.
const SPORT_PRESETS = {
  baseball: { label: 'Baseball / Softball', period: 'inning', periodPlural: 'innings', periodAbbr: 'inn', score: 'run', scorePlural: 'runs', scoreAbbr: 'R', regulation: 7 },
  basketball: { label: 'Basketball', period: 'quarter', periodPlural: 'quarters', periodAbbr: 'qtr', score: 'point', scorePlural: 'points', scoreAbbr: 'PTS', regulation: 4 },
  hockey: { label: 'Hockey', period: 'period', periodPlural: 'periods', periodAbbr: 'per', score: 'goal', scorePlural: 'goals', scoreAbbr: 'G', regulation: 3 },
  football: { label: 'Football', period: 'quarter', periodPlural: 'quarters', periodAbbr: 'qtr', score: 'point', scorePlural: 'points', scoreAbbr: 'PTS', regulation: 4 },
  soccer: { label: 'Soccer', period: 'half', periodPlural: 'halves', periodAbbr: 'half', score: 'goal', scorePlural: 'goals', scoreAbbr: 'G', regulation: 2 },
};
function sportOf(league) { return SPORT_PRESETS[league && league.sport] || SPORT_PRESETS.baseball; }
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
// Baseball/softball is the only preset with a top/bottom split; everything
// else (quarters, periods, halves) is just a plain period number.
function formatLivePeriod(sport, period, half) {
  if (!period) return null;
  if (sport.period === 'inning' && half) return `${half === 'top' ? 'Top' : 'Bot'} ${ordinal(period)}`;
  return `${ordinal(period)} ${sport.period}`;
}

/* ==================================================================== */
/* Core utilities                                                        */
/* ==================================================================== */
function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
// A lightweight admin audit trail, separate from the public Transactions
// log — who changed a structural setting and when, not roster moves. Capped
// so it doesn't grow forever; nobody needs more than the last ~100 entries.
// Every call site immediately persists the returned object, so this is the
// one choke point every audit-worthy action passes through — firing the
// Discord admin-channel notification here (rather than duplicating a call
// at all ~15 call sites) guarantees nothing gets logged without also being
// posted. Fire-and-forget: a slow/unreachable Discord webhook should never
// block or fail the actual save.
function appendAuditEntry(lg, action, detail) {
  const entry = { id: uid('audit'), action, detail: detail || '', at: Date.now() };
  if (typeof fetch === 'function') {
    fetch('/api/admin-notify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, detail: detail || '' }),
    }).catch(() => {});
  }
  return { ...lg, auditLog: [...(lg.auditLog || []).slice(-99), entry] };
}
// awardWinners[awardId] used to store a single winner object; it's now a list
// so an award can have co-winners. Normalize old single-object saves to a
// one-item list so both shapes render and edit the same way.
function normalizeAwardWinners(raw) {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}
function hashColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TEAM_PALETTE[h % TEAM_PALETTE.length];
}
function teamColor(t) { return (t && t.color) || hashColor(t ? t.id : uid()); }
// Falls back to an auto-generated abbreviation (first 3 letters of the name)
// for teams that haven't set one explicitly.
function teamAbbr(t) {
  if (t && t.abbr) return t.abbr;
  const name = (t && (t.displayName || t.name)) || '';
  return name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '???';
}
function fmtPct(x, decimals) {
  if (x == null || Number.isNaN(x)) return '—';
  return `${x.toFixed(decimals)}%`;
}
// American ("moneyline") odds — e.g. +125 or -150 — computed from a win probability.
function toAmericanOdds(pctChance) {
  if (pctChance == null || Number.isNaN(pctChance)) return '—';
  // Standard American odds formula, uncapped (real sportsbooks do show
  // extreme lines like -3000+ for lopsided matchups) — just guarded against
  // literal 0%/100% to avoid a divide-by-zero.
  const p = Math.min(99, Math.max(1, pctChance)) / 100;
  if (p >= 0.5) {
    const val = Math.round(-100 * p / (1 - p));
    return `${val}`;
  }
  const val = Math.round(100 * (1 - p) / p);
  return `+${val}`;
}
function fmtOdds(pctChance, format, decimals) {
  if (format === 'american') return toAmericanOdds(pctChance);
  return fmtPct(pctChance, decimals);
}
function regularizedPct(w, l) { const gp = w + l; return (w + 1) / (gp + 2); }

function pythPct(rf, ra) {
  const rf2 = (rf || 0) * (rf || 0), ra2 = (ra || 0) * (ra || 0);
  return (rf2 + ra2) > 0 ? rf2 / (rf2 + ra2) : 0.5;
}
function last10Pct(results) {
  if (!results || results.length === 0) return null;
  return results.filter(r => r === 'W').length / results.length;
}
// Blends five signals into a single win probability for teamA hosting/facing
// teamB: (1) overall win% (log5), (2) Pythagorean expectation from RS/RA — this
// smooths out win/loss noise, especially in small samples, using actual scoring,
// (3) recent form (last 10 games), (4) roster star-rating strength (an
// admittedly fuzzy but fun signal — real talent isn't fully captured by a
// partial-season record), and (5) head-to-head history including its own run
// differential. Each add-on factor is capped so it nudges rather than swamps
// the underlying record.
function winProb(teamA, teamB, h2h) {
  const pA = regularizedPct(teamA.w, teamA.l);
  const pB = regularizedPct(teamB.w, teamB.l);
  const denom = pA + pB - 2 * pA * pB;
  let base = denom <= 0 ? 0.5 : (pA - pA * pB) / denom;

  const pythA = pythPct(teamA.rf, teamA.ra), pythB = pythPct(teamB.rf, teamB.ra);
  const pythDenom = pythA + pythB - 2 * pythA * pythB;
  const pythBase = pythDenom > 0 ? (pythA - pythA * pythB) / pythDenom : 0.5;
  base = base * 0.7 + pythBase * 0.3;

  const formA = last10Pct(teamA.last10), formB = last10Pct(teamB.last10);
  if (formA != null && formB != null) base += Math.max(-0.08, Math.min(0.08, (formA - formB) * 0.16));

  const rsA = rosterStrength(teamA.roster), rsB = rosterStrength(teamB.roster);
  if (rsA != null && rsB != null) base += Math.max(-0.06, Math.min(0.06, (rsA - rsB) * 0.03));

  base = Math.min(0.97, Math.max(0.03, base));
  if (h2h) {
    const n = h2h.aWins + h2h.aLosses;
    if (n > 0) {
      const h2hP = (h2h.aWins + 0.5) / (n + 1);
      const weight = Math.min(0.5, n * 0.15);
      base = weight * h2hP + (1 - weight) * base;
      // Nudge further using head-to-head run differential (average runs/game
      // margin in their own matchups), capped to a small effect so it can't
      // swing the odds on its own — win/loss record still dominates.
      if (h2h.aDiff != null) {
        const avgDiff = h2h.aDiff / n;
        const nudge = Math.max(-0.06, Math.min(0.06, avgDiff * 0.01));
        base = base + nudge;
      }
      base = Math.min(0.97, Math.max(0.03, base));
    }
  }
  return base;
}

function buildH2H(games) {
  const m = {};
  (games || []).forEach(g => {
    if (!g.played || g.isPlayoff || !g.homeTeamId || !g.awayTeamId) return;
    const hs = Number(g.homeScore), as = Number(g.awayScore);
    if (Number.isNaN(hs) || Number.isNaN(as)) return;
    const home = g.homeTeamId, away = g.awayTeamId;
    if (!m[home]) m[home] = {};
    if (!m[home][away]) m[home][away] = { w: 0, l: 0, rf: 0, ra: 0 };
    if (!m[away]) m[away] = {};
    if (!m[away][home]) m[away][home] = { w: 0, l: 0, rf: 0, ra: 0 };
    m[home][away].rf += hs; m[home][away].ra += as;
    m[away][home].rf += as; m[away][home].ra += hs;
    const winner = gameWinner(g);
    if (winner === 'home') { m[home][away].w += 1; m[away][home].l += 1; }
    else if (winner === 'away') { m[away][home].w += 1; m[home][away].l += 1; }
  });
  return m;
}
function h2hRecord(matrix, aId, bId) {
  const a = matrix[aId] && matrix[aId][bId];
  return a ? { aWins: a.w, aLosses: a.l, aDiff: a.rf - a.ra } : { aWins: 0, aLosses: 0, aDiff: 0 };
}
// Deterministic "coin flip" for a pair of teams — stable across renders (won't
// flicker every recompute) but effectively arbitrary/unpredictable per pair.
function pairCoinFlip(idA, idB) {
  const [x, y] = [idA, idB].sort();
  let h = 0;
  const s = x + '|' + y;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const firstWins = h % 2 === 0; // true = the alphabetically-first id wins the flip
  return idA < idB ? firstWins : !firstWins;
}

// Normalizes a round/date label for display, fixing any double "Round Round #"
// that can happen if the raw label already contains a "Round"/"Rd" prefix
// (e.g. from data entered before a season switched to round-labeled mode).
function formatRoundLabel(label) {
  if (!label) return '';
  const s = String(label);
  if (/^playoffs?\b/i.test(s)) return s; // playoff round labels ("Playoffs R1") are used as-is
  const stripped = s.replace(/^(round|rd|r)\.?\s*#?\s*/i, '').trim();
  return `Round ${stripped || s}`;
}
function gameWinner(g) {
  if (g.winnerOverride === 'home' || g.winnerOverride === 'away') return g.winnerOverride;
  const hs = Number(g.homeScore), as = Number(g.awayScore);
  if (Number.isNaN(hs) || Number.isNaN(as)) return null;
  if (hs > as) return 'home';
  if (as > hs) return 'away';
  return null;
}

function computeStreak(results) {
  if (!results.length) return { type: null, count: 0, label: '—' };
  const last = results[results.length - 1];
  let count = 0;
  for (let i = results.length - 1; i >= 0; i--) { if (results[i] === last) count++; else break; }
  return { type: last, count, label: `${last}${count}` };
}
function longestStreaks(results) {
  let bestW = 0, bestL = 0, curType = null, curCount = 0;
  results.forEach(r => {
    if (r === curType) curCount++; else { curType = r; curCount = 1; }
    if (r === 'W') bestW = Math.max(bestW, curCount); else bestL = Math.max(bestL, curCount);
  });
  return { bestW, bestL };
}
// Active (still-ongoing, as of the most recently played game) hit streaks
// and pitcher scoreless-appearance streaks — separate from team win/loss
// streaks (computeStreak above already covers those, this just adds the
// player-level layer that didn't exist yet). "Active" resets to 0 the
// moment a player goes hitless (or allows an earned run), so this always
// reads as "right now," not an all-time best.
function computeActiveStreaks(season) {
  const scheduleMode = (season.settings && season.settings.scheduleMode) || 'date';
  const played = sortGamesChronologically((season.games || []).filter(g => g.played && !g.isBye && !g.isSpringTraining), scheduleMode);
  const meta = new Map();
  (season.members || []).forEach(m => (m.roster || []).forEach(p => meta.set(p.id, { name: p.name, teamId: m.teamId })));
  (season.freeAgents || []).forEach(p => meta.set(p.id, { name: p.name, teamId: null }));

  const byPlayer = new Map();
  played.forEach(g => {
    ['home', 'away'].forEach(side => {
      ((g.playerStats && g.playerStats[side]) || []).forEach(row => {
        if (!meta.has(row.playerId)) return;
        const entry = byPlayer.get(row.playerId) || { hitStreak: 0, scorelessStreak: 0, hasPitched: false };
        const ab = row.ab || 0, h = row.h || 0, outs = ipDisplayToOuts(row.ip || '0.0'), er = row.er || 0;
        if (ab > 0) entry.hitStreak = h > 0 ? entry.hitStreak + 1 : 0;
        if (outs > 0) { entry.hasPitched = true; entry.scorelessStreak = er === 0 ? entry.scorelessStreak + 1 : 0; }
        byPlayer.set(row.playerId, entry);
      });
    });
  });

  const hitStreaks = [], scorelessStreaks = [];
  byPlayer.forEach((entry, playerId) => {
    const info = meta.get(playerId);
    if (entry.hitStreak >= 3) hitStreaks.push({ playerId, name: info.name, teamId: info.teamId, count: entry.hitStreak });
    if (entry.hasPitched && entry.scorelessStreak >= 2) scorelessStreaks.push({ playerId, name: info.name, teamId: info.teamId, count: entry.scorelessStreak });
  });
  hitStreaks.sort((a, b) => b.count - a.count);
  scorelessStreaks.sort((a, b) => b.count - a.count);
  return { hitStreaks: hitStreaks.slice(0, 5), scorelessStreaks: scorelessStreaks.slice(0, 5) };
}

function nextPow2(n) { let p = 1; while (p < n) p *= 2; return Math.max(p, 1); }
function seedOrder(size) {
  if (size <= 1) return [1];
  const prev = seedOrder(size / 2);
  const result = [];
  prev.forEach(s => { result.push(s); result.push(size + 1 - s); });
  return result;
}

/* ---- playoff bracket generation (real, scheduled games) ---- */
function seriesWinsNeeded(seriesLength) { return Math.ceil((seriesLength || 1) / 2); }
// Resolves the series length for a specific playoff round: uses settings.seriesLengths[round-1]
// if that's been configured, otherwise carries forward the LAST explicitly-configured round's
// length (not the unrelated scalar default) — so if playoffSpots grows and adds a new round
// after per-round lengths were already set, the new round doesn't silently fall back to a
// possibly-stale, unrelated value. Falls back to the plain scalar only if no array exists at all.
function getSeriesLength(settings, round) {
  if (settings && Array.isArray(settings.seriesLengths) && settings.seriesLengths.length > 0) {
    if (settings.seriesLengths[round - 1]) return settings.seriesLengths[round - 1];
    return settings.seriesLengths[settings.seriesLengths.length - 1] || (settings.seriesLength || 1);
  }
  return (settings && settings.seriesLength) || 1;
}
// Admin-customizable playoff round names (e.g. "Wild Card", "Semifinals"),
// keyed by round number as a string since settings is a plain JSON object.
// Falls back to "Round N" / "Final" for the last round when unset.
function getPlayoffRoundName(settings, round, roundsCount) {
  const custom = settings && settings.playoffRoundNames && settings.playoffRoundNames[String(round)];
  if (custom && custom.trim()) return custom.trim();
  if (roundsCount && round === roundsCount) return 'Final';
  return `Round ${round}`;
}

// Player stat import (OCR from an in-game stat screenshot). Column order is
// fixed by the game's own stat screen: player name, then 13 numeric columns.
// Batting home runs aren't on that screen at all, so they're always a manual
// admin entry — never OCR'd.
const STAT_COLUMNS = [
  { key: 'ab', label: 'AB' },
  { key: 'r', label: 'R' },
  { key: 'h', label: 'H' },
  { key: 'rbi', label: 'RBI' },
  { key: 'bb', label: 'BB' },
  { key: 'so', label: 'SO' },
  { key: 'ip', label: 'IP' },
  { key: 'ha', label: 'HA' },
  { key: 'er', label: 'ER' },
  { key: 'bbAllowed', label: 'BB' },
  { key: 'k', label: "K'S" },
  { key: 'hrAllowed', label: 'HR' },
  { key: 'e', label: 'E' },
];

// Parses Tesseract's TSV recognition output into text rows, grouped by the
// engine's own line detection and ordered top-to-bottom, left-to-right —
// robust to column x-position without needing to calibrate pixel ranges.
function parseOcrTsvToLines(tsv) {
  const rows = (tsv || '').split('\n').map(l => l.split('\t')).filter(c => c.length >= 12);
  const lineMap = new Map();
  rows.forEach(cols => {
    const level = Number(cols[0]);
    if (level !== 5) return; // word-level rows only
    const text = (cols[11] || '').trim();
    if (!text) return;
    const key = `${cols[2]}-${cols[3]}-${cols[4]}`;
    const left = Number(cols[6]), top = Number(cols[7]);
    if (!lineMap.has(key)) lineMap.set(key, { top, words: [] });
    lineMap.get(key).words.push({ text, left });
  });
  return [...lineMap.values()]
    .sort((a, b) => a.top - b.top)
    .map(line => line.words.sort((a, b) => a.left - b.left).map(w => w.text));
}

// Turns each OCR'd line's tokens into a guessed player-name + stat-values row.
// The trailing run of number-looking tokens is the stat block; whatever
// comes before it, however many tokens OCR split it into, is the player
// name. The full stat block is 13 columns (batting then pitching), but a
// row only requiring 14 clean tokens end-to-end used to get dropped
// entirely on any single missed/merged token — and a batting-only or
// pitching-only player (routine on a real roster) never has all 13 filled
// in to begin with. This maps whatever numeric run actually got recognized
// onto the closest matching column set instead of demanding all-or-nothing.
const OCR_ALL_KEYS = STAT_COLUMNS.map(c => c.key);
const OCR_BATTING_KEYS = OCR_ALL_KEYS.slice(0, 6); // ab, r, h, rbi, bb, so
const OCR_PITCHING_KEYS = OCR_ALL_KEYS.slice(6); // ip, ha, er, bbAllowed, k, hrAllowed, e
function ocrLinesToStatRows(lines) {
  return lines
    .map(tokens => {
      let numCount = 0;
      for (let i = tokens.length - 1; i >= 0; i--) {
        const cleaned = (tokens[i] || '').replace(/[^0-9.]/g, '');
        if (cleaned === '' || Number.isNaN(parseFloat(cleaned))) break;
        numCount++;
      }
      if (numCount === 0) return null;
      const nameTokens = tokens.slice(0, tokens.length - numCount);
      if (nameTokens.length === 0) return null;
      const statTokens = tokens.slice(tokens.length - numCount);
      let cols, colTokens;
      if (numCount === OCR_BATTING_KEYS.length) { cols = OCR_BATTING_KEYS; colTokens = statTokens; }
      else if (numCount === OCR_PITCHING_KEYS.length) { cols = OCR_PITCHING_KEYS; colTokens = statTokens; }
      else if (numCount >= OCR_ALL_KEYS.length) { cols = OCR_ALL_KEYS; colTokens = statTokens.slice(statTokens.length - OCR_ALL_KEYS.length); }
      else { cols = OCR_ALL_KEYS.slice(OCR_ALL_KEYS.length - numCount); colTokens = statTokens; }
      const values = Object.fromEntries(OCR_ALL_KEYS.map(k => [k, 0]));
      let numericHits = 0;
      cols.forEach((key, i) => {
        const n = parseFloat((colTokens[i] || '').replace(/[^0-9.]/g, ''));
        if (!Number.isNaN(n)) { numericHits++; values[key] = n; }
      });
      return { name: nameTokens.join(' '), values, confident: numericHits >= Math.max(1, cols.length - 2) };
    })
    .filter(row => row && row.name && /[a-z]/i.test(row.name));
}

// Play-in tournament: a single-elimination mini-bracket among bubble teams
// (seeded just below the automatic playoff cutoff) that determines who takes
// the final playoff spot — the last seed is "up for grabs" rather than locked
// in by regular-season record alone. Always single games (no best-of-N —
// play-ins are meant to be a compressed, high-stakes single elimination).
function generatePlayInRound1(standings, playoffSpots, playInTeams) {
  const bubble = standings.slice(Math.max(0, playoffSpots - 1), Math.max(0, playoffSpots - 1) + playInTeams);
  if (bubble.length < 2) return [];
  const bracketSize = nextPow2(bubble.length);
  const order = seedOrder(bracketSize);
  const games = [];
  for (let i = 0; i < order.length; i += 2) {
    const s1 = order[i], s2 = order[i + 1];
    const t1 = s1 <= bubble.length ? bubble[s1 - 1] : null;
    const t2 = s2 <= bubble.length ? bubble[s2 - 1] : null;
    const slot = i / 2;
    if (t1 && t2) {
      games.push({ id: uid('g'), date: 'Play-In R1', isPlayIn: true, playInRound: 1, bracketSlot: slot, homeTeamId: t1.id, awayTeamId: t2.id, awayScheduleName: t2.displayName, homeScheduleName: t1.displayName, awayScore: null, homeScore: null, innings: null, played: false });
    } else if (t1 || t2) {
      const t = t1 || t2;
      games.push({ id: uid('g'), date: 'Play-In R1', isPlayIn: true, playInRound: 1, bracketSlot: slot, homeTeamId: t.id, awayTeamId: null, awayScheduleName: 'BYE', homeScheduleName: t.displayName, awayScore: 0, homeScore: 1, innings: 0, played: true, isBye: true });
    }
  }
  return games;
}
function getPlayInWinner(games) {
  const playInGames = (games || []).filter(g => g.isPlayIn);
  if (playInGames.length === 0) return null;
  const maxRound = Math.max(...playInGames.map(g => g.playInRound));
  const roundGames = playInGames.filter(g => g.playInRound === maxRound);
  if (roundGames.length !== 1 || !roundGames[0].played) return null;
  const w = gameWinner(roundGames[0]);
  return w === 'home' ? roundGames[0].homeTeamId : roundGames[0].awayTeamId;
}

function generatePlayoffRound1(standings, playoffSpots, seriesLength) {
  const n = Math.min(playoffSpots, standings.length);
  if (n < 2) return [];
  const bracketSize = nextPow2(n);
  const order = seedOrder(bracketSize);
  const games = [];
  for (let i = 0; i < order.length; i += 2) {
    const s1 = order[i], s2 = order[i + 1];
    const t1 = s1 <= n ? standings[s1 - 1] : null;
    const t2 = s2 <= n ? standings[s2 - 1] : null;
    const slot = i / 2;
    if (t1 && t2) {
      // Higher seed hosts game 1 (and gets home-field advantage through the series).
      games.push({ id: uid('g'), date: 'Playoffs R1', isPlayoff: true, playoffRound: 1, bracketSlot: slot, seriesGame: 1, higherSeedId: t1.id, awayTeamId: t2.id, homeTeamId: t1.id, awayScheduleName: t2.displayName, homeScheduleName: t1.displayName, awayScore: null, homeScore: null, innings: null, played: false });
    } else if (t1 || t2) {
      const t = t1 || t2;
      games.push({ id: uid('g'), date: 'Playoffs R1', isPlayoff: true, playoffRound: 1, bracketSlot: slot, seriesGame: 1, higherSeedId: t.id, awayTeamId: null, homeTeamId: t.id, awayScheduleName: 'BYE', homeScheduleName: t.displayName, awayScore: 0, homeScore: 1, innings: 0, played: true, isBye: true });
    }
  }
  return games;
}


/* ---- team merging (global team branding + per-season membership) ---- */
// A rebrand (member.rebrand) swaps a team's name/color/logo for the rest of
// THIS season only — the global team record (and every other season) keeps
// the original identity, since rebrands are scoped to a single season.
function mergeTeam(globalTeam, member) {
  const rb = member.rebrand;
  return {
    id: member.teamId,
    scheduleName: member.scheduleName || (globalTeam ? globalTeam.name : 'Unknown team'),
    displayName: (rb && rb.name) || (globalTeam ? globalTeam.name : (member.scheduleName || 'Unknown team')),
    abbr: (rb && rb.abbr) || (globalTeam ? globalTeam.abbr : null),
    color: (rb && rb.color) || (globalTeam ? globalTeam.color : null),
    logoUrl: (rb && rb.logoUrl) || (globalTeam ? globalTeam.logoUrl : null),
    wordmarkUrl: (rb && rb.wordmarkUrl) || (globalTeam ? globalTeam.wordmarkUrl : null),
    rebrand: rb || null,
    originalName: globalTeam ? globalTeam.name : (member.scheduleName || 'Unknown team'),
    active: member.active !== false,
    baselineW: Number(member.baselineW) || 0, baselineL: Number(member.baselineL) || 0,
    baselineRF: Number(member.baselineRF) || 0, baselineRA: Number(member.baselineRA) || 0,
    roster: member.roster || [],
    divisionId: member.divisionId || null,
  };
}

/* ---- players & rosters ---- */
// starLevel is a plain number (supports 0.5 increments, and can exceed 5 — real
// sheets go up to ~5.5+) or null, meaning "R" (unrated/reserve).
function newPlayer(name, starLevel) {
  return { id: uid('p'), name, starLevel: starLevel === undefined ? null : starLevel, role: '' };
}
function formatStarLevel(v) { return (v == null || v === 'R') ? 'R' : `${v}★`; }
// Average roster star level for a team, used as a small strength signal in odds
// (an "imagination" factor — real talent isn't fully captured by record alone,
// especially early in a season with few games played). Unrated ("R") players
// are excluded rather than assumed average, since we genuinely don't know.
function rosterStrength(roster) {
  if (!roster || roster.length === 0) return null;
  const rated = roster.filter(p => typeof p.starLevel === 'number');
  if (rated.length === 0) return null;
  return rated.reduce((s, p) => s + p.starLevel, 0) / rated.length;
}
function parseStarValue(raw) {
  const s = String(raw || '').trim();
  if (!s || /^r$/i.test(s)) return null;
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function parseRosterText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines.map(line => {
    const parts = line.split(',').map(p => p.trim());
    const name = parts[0] || '';
    const starLevel = parseStarValue(parts[1]);
    return { name, starLevel, matched: !!name };
  });
}
// Normalizes a team name for matching purposes: case-insensitive, collapses
// repeated/odd whitespace, strips typographic vs. straight apostrophes and
// trailing punctuation so a roster sheet's header ("Anaheim Stars ") still
// matches the team's stored name ("Anaheim Stars") despite minor formatting
// differences between however the sheet and the app each got typed up.
function normalizeTeamName(name) {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[.,!?]+$/g, '')
    .replace(/\s+/g, ' ');
}
// Parses a whole roster spreadsheet exported as CSV: many teams laid out as
// repeating 3-column blocks (Role/Slot, Username, Stars), possibly with
// several such rows of team-blocks stacked one below another (each with its
// own "Team | <name> | Stars" header row). Finds every header wherever it
// appears and reads that block's players until a "Star Total" row, a blank
// role+username pair, or the next header at the same columns.
// Splits one line of pasted sheet data into cells. A line copied straight
// out of Google Sheets/Excel is tab-separated (that's the clipboard format
// spreadsheets use for a cell range) rather than comma-separated, so a tab
// wins whenever the line has one; otherwise it's treated as CSV (comma
// with quote-escaping) for text exported that way instead.
function splitSheetLine(line) {
  if (line.includes('\t')) return line.split('\t').map(c => c.trim());
  const cells = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { cells.push(cur); cur = ''; }
      else cur += c;
    }
  }
  cells.push(cur);
  return cells.map(c => c.trim());
}
function parseRosterSheetCsv(text) {
  const rows = text.split(/\r?\n/).filter(l => l.length > 0).map(splitSheetLine);
  const blocks = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const isHeader = /^team$/i.test(row[c] || '') && /^stars?$/i.test(row[c + 2] || '');
      if (!isHeader) continue;
      const teamName = (row[c + 1] || '').trim();
      if (!teamName) continue;
      const players = [];
      for (let rr = r + 1; rr < rows.length; rr++) {
        const drow = rows[rr];
        const role = (drow[c] || '').trim();
        const uname = (drow[c + 1] || '').trim();
        const starsRaw = (drow[c + 2] || '').trim();
        if (/star total/i.test(role) || /star total/i.test(uname)) break;
        if (/^team$/i.test(role)) break; // next stacked section's header reusing these columns
        if (!role && !uname && !starsRaw) break;
        if (!uname) continue; // empty roster slot, keep scanning
        players.push({ role, name: uname, starLevel: parseStarValue(starsRaw) });
      }
      blocks.push({ teamName, players });
    }
  }
  if (blocks.length > 0) return blocks;
  // Didn't find any explicit "Team | Name | Stars" headers — try the plainer
  // layout instead: one column per team, no header labels at all, just the
  // team's name in the first row of each section and a bare username per
  // row underneath it. Falls back here rather than always running so a
  // sheet that does have Team/Stars headers never gets double-parsed.
  return parseColumnRosterSheet(rows);
}
// Parses the plain "one team per column" layout: a row of team names,
// followed by rows of bare usernames (one per column, blank cells are just
// unfilled roster slots), until a fully blank row. Several such sections
// can be stacked in the same sheet (a blank row in between, then a new row
// of team names reusing the same or different columns) — a blank row is
// what tells this apart from the "Team | Name | Stars" format above, which
// needs no separator since each block declares its own header inline.
function parseColumnRosterSheet(rows) {
  const blocks = [];
  let columns = null;
  let expectHeader = true;
  for (const row of rows) {
    if (row.every(cell => !cell)) { expectHeader = true; continue; }
    if (expectHeader) {
      columns = row.map(name => (name ? { teamName: name, players: [] } : null));
      blocks.push(...columns.filter(Boolean));
      expectHeader = false;
      continue;
    }
    if (!columns) continue; // stray data before any header row — nothing to attach it to
    row.forEach((cell, c) => {
      if (cell && columns[c]) columns[c].players.push({ role: '', name: cell, starLevel: null });
    });
  }
  return blocks;
}

// Parses a draft board: a "ROUND N" header (its own row, possibly a merged
// cell so only the first column has anything in it) followed by pick rows
// shaped like "R1 P1 | Team | Player | #1". The round/pick-in-round is read
// straight off the "R#P#" label rather than the header line, since that's
// right there on every row and doesn't depend on the header having survived
// the paste intact. The label is looked for in every column of the row,
// not assumed to be in the first one — a real sheet export often has
// leading spacer/indent columns (e.g. ",,R1 P1,Team,Player,#1,...") before
// the actual data starts. Rows that don't look like a pick (blank, a stray
// header) are skipped rather than aborting the whole parse.
function parseDraftBoardSheet(text) {
  const rows = text.split(/\r?\n/).filter(l => l.trim().length > 0).map(splitSheetLine);
  const picks = [];
  rows.forEach(row => {
    const labelIdx = row.findIndex(cell => /^R\s*(\d+)\s*P\s*(\d+)$/i.test((cell || '').trim()));
    if (labelIdx === -1) return; // "ROUND N" header row, blank row, or a stray label — skip
    const m = /^R\s*(\d+)\s*P\s*(\d+)$/i.exec(row[labelIdx].trim());
    const teamName = (row[labelIdx + 1] || '').trim();
    const playerName = (row[labelIdx + 2] || '').trim();
    if (!teamName || !playerName) return;
    // The overall-pick cell ("#1") isn't always immediately after the
    // player (some sheets have extra columns in between), so scan the rest
    // of the row for it instead of assuming a fixed offset.
    const overallCell = row.slice(labelIdx + 3).find(c => /#\s*\d+/.test(c || ''));
    const overallMatch = overallCell ? /#\s*(\d+)/.exec(overallCell) : null;
    picks.push({
      round: Number(m[1]), pickInRound: Number(m[2]),
      overall: overallMatch ? Number(overallMatch[1]) : null,
      teamName, playerName,
    });
  });
  return picks;
}

// Parses a flat star-rating sheet: one row per player, "Team | Player |
// Stars" — unlike the block-grouped roster sheet above, the team repeats
// (or is blank for a free agent/unrostered player) on every row instead of
// appearing once as a section header. Treated as applying ratings to
// players, not as a full roster declaration — a ratings sheet routinely
// only lists the top tier of players, not literally everyone on a roster.
function parseStarsSheet(text) {
  const rows = text.split(/\r?\n/).filter(l => l.trim().length > 0).map(splitSheetLine);
  const out = [];
  rows.forEach(row => {
    const teamName = (row[0] || '').trim();
    const playerName = (row[1] || '').trim();
    if (/^team$/i.test(teamName) && /^player$/i.test(playerName)) return; // header row
    if (!playerName) return;
    out.push({ teamName, playerName, starLevel: parseStarValue(row[2]) });
  });
  return out;
}

/* ---- awards ---- */
function newAwardDef(name, description) { return { id: uid('award'), name, description: description || '' }; }

/* ---- standings ---- */
function computeStandings(season, teamsById) {
  const standardInnings = (season.settings && season.settings.standardInnings) || 7;
  const map = {};
  (season.members || []).forEach(m => {
    const base = mergeTeam(teamsById[m.teamId] || null, m);
    map[m.teamId] = {
      ...base,
      w: base.baselineW, l: base.baselineL, rf: base.baselineRF, ra: base.baselineRA,
      results: [], oneRunW: 0, oneRunL: 0, xInnW: 0, xInnL: 0, defInnings: 0, forfeitW: 0, forfeitL: 0,
      homeW: 0, homeL: 0, homeRF: 0, homeRA: 0, awayW: 0, awayL: 0, awayRF: 0, awayRA: 0,
    };
  });
  (season.games || []).forEach(g => {
    if (!g.played || g.isPlayoff || g.isSpringTraining) return;
    const home = map[g.homeTeamId], away = map[g.awayTeamId];
    if (!home || !away) return;
    const hs = Number(g.homeScore), as = Number(g.awayScore);
    if (Number.isNaN(hs) || Number.isNaN(as)) return;
    home.rf += hs; home.ra += as; away.rf += as; away.ra += hs;
    home.homeRF += hs; home.homeRA += as; away.awayRF += as; away.awayRA += hs;
    const innings = g.isForfeit ? 0 : (Number(g.innings) || standardInnings);
    home.defInnings += innings; away.defInnings += innings;
    const margin = Math.abs(hs - as);
    const isXI = !g.isForfeit && innings > standardInnings;
    const winner = gameWinner(g);
    if (winner === 'home') {
      home.w += 1; away.l += 1; home.homeW += 1; away.awayL += 1;
      home.results.push('W'); away.results.push('L');
      if (g.isForfeit) { home.forfeitW += 1; away.forfeitL += 1; }
      if (!g.isForfeit && margin === 1) { home.oneRunW += 1; away.oneRunL += 1; }
      if (isXI) { home.xInnW += 1; away.xInnL += 1; }
    } else if (winner === 'away') {
      away.w += 1; home.l += 1; away.awayW += 1; home.homeL += 1;
      away.results.push('W'); home.results.push('L');
      if (g.isForfeit) { away.forfeitW += 1; home.forfeitL += 1; }
      if (!g.isForfeit && margin === 1) { away.oneRunW += 1; home.oneRunL += 1; }
      if (isXI) { away.xInnW += 1; home.xInnL += 1; }
    }
  });

  let fullArr = Object.values(map).map(t => {
    const gp = t.w + t.l;
    const homeGp = t.homeW + t.homeL, awayGp = t.awayW + t.awayL;
    const streaks = longestStreaks(t.results);
    return {
      ...t, gp, pct: gp > 0 ? t.w / gp : 0, diff: t.rf - t.ra,
      rsPerG: gp > 0 ? t.rf / gp : 0, raPerG: gp > 0 ? t.ra / gp : 0,
      homeGp, awayGp,
      homeRsPerG: homeGp > 0 ? t.homeRF / homeGp : 0, homeRaPerG: homeGp > 0 ? t.homeRA / homeGp : 0,
      awayRsPerG: awayGp > 0 ? t.awayRF / awayGp : 0, awayRaPerG: awayGp > 0 ? t.awayRA / awayGp : 0,
      streak: computeStreak(t.results), longestWinStreak: streaks.bestW, longestLossStreak: streaks.bestL,
      last10: t.results.slice(-10),
    };
  });

  const pctById = {};
  fullArr.forEach(t => { pctById[t.id] = t.pct; });
  const oppAgg = {};
  const sovAgg = {};
  (season.games || []).forEach(g => {
    if (g.isPlayoff) return;
    if (!g.homeTeamId || !g.awayTeamId) return;
    if (!(g.homeTeamId in pctById) || !(g.awayTeamId in pctById)) return;
    if (!oppAgg[g.homeTeamId]) oppAgg[g.homeTeamId] = { sum: 0, count: 0 };
    if (!oppAgg[g.awayTeamId]) oppAgg[g.awayTeamId] = { sum: 0, count: 0 };
    oppAgg[g.homeTeamId].sum += pctById[g.awayTeamId]; oppAgg[g.homeTeamId].count += 1;
    oppAgg[g.awayTeamId].sum += pctById[g.homeTeamId]; oppAgg[g.awayTeamId].count += 1;
    if (!g.played) return;
    // Strength of victory: same idea as strength of schedule, but only
    // averaging the quality of opponents actually BEATEN — distinct from SOS
    // (which averages every opponent played, win or lose).
    const w = gameWinner(g);
    if (!w) return;
    const winnerId = w === 'home' ? g.homeTeamId : g.awayTeamId, loserId = w === 'home' ? g.awayTeamId : g.homeTeamId;
    if (!sovAgg[winnerId]) sovAgg[winnerId] = { sum: 0, count: 0 };
    sovAgg[winnerId].sum += pctById[loserId]; sovAgg[winnerId].count += 1;
  });
  fullArr = fullArr.map(t => {
    const oc = oppAgg[t.id];
    const sc = sovAgg[t.id];
    return { ...t, sos: oc && oc.count > 0 ? oc.sum / oc.count : null, sov: sc && sc.count > 0 ? sc.sum / sc.count : null };
  });

  const h2hMatrix = buildH2H(season.games || []);
  const activeArr = fullArr.filter(t => t.active)
    .sort((a, b) => {
      if (b.pct !== a.pct) return b.pct - a.pct;
      // 1. Run differential (season-wide)
      if (b.diff !== a.diff) return b.diff - a.diff;
      // 2. Head-to-head record
      const rec = h2hMatrix[a.id] && h2hMatrix[a.id][b.id];
      if (rec && (rec.w + rec.l) > 0 && rec.w !== rec.l) return rec.w > rec.l ? -1 : 1;
      // 3. Head-to-head run differential
      if (rec) {
        const hDiff = rec.rf - rec.ra;
        if (hDiff !== 0) return hDiff > 0 ? -1 : 1;
      }
      // 4. Coin flip (stable per pair, so standings don't flicker between renders)
      return pairCoinFlip(a.id, b.id) ? -1 : 1;
    });
  const leader = activeArr[0];
  activeArr.forEach((t, i) => {
    t.rank = i + 1;
    t.gb = leader ? ((leader.w - t.w) + (t.l - leader.l)) / 2 : 0;
  });
  return { all: fullArr, active: activeArr };
}

function computeRemaining(season) {
  const rem = {};
  (season.games || []).forEach(g => {
    if (g.played || g.isPlayoff) return;
    if (g.homeTeamId) rem[g.homeTeamId] = (rem[g.homeTeamId] || 0) + 1;
    if (g.awayTeamId) rem[g.awayTeamId] = (rem[g.awayTeamId] || 0) + 1;
  });
  return rem;
}

// The highest position a team could mathematically still finish in — win
// every remaining game, and see how many teams are still unreachable. A team
// is "locked ahead" if its CURRENT win total alone already exceeds our win
// ceiling — that's guaranteed true regardless of anything else that happens
// the rest of the season, so it's a sound bound (not the common but shakier
// "assume everyone else loses out" shortcut, which isn't always a jointly
// achievable scenario since two teams playing each other can't both lose).
function computeBestPossibleFinish(standings, teamId, remainingByTeam) {
  const t = standings.find(x => x.id === teamId);
  if (!t) return null;
  const remaining = remainingByTeam[t.id] || 0;
  const maxWins = t.w + remaining;
  const others = standings.filter(x => x.id !== t.id);
  const lockedAhead = others.filter(o => o.w > maxWins);
  const catchable = others.filter(o => o.w <= maxWins).sort((a, b) => b.w - a.w);
  const bestRank = 1 + lockedAhead.length;
  return { maxWins, remaining, bestRank, currentRank: t.rank, lockedAhead, catchable };
}

// Reorders standings for playoff purposes when using divisional format: each
// division's best team ("division winner") gets a guaranteed top seed
// (ranked among winners by record), and the remaining playoff spots are
// filled by the next-best teams overall regardless of division ("wild
// cards") — the standard convention in leagues like MLB/NHL/NFL. Returns
// ALL teams reordered so `.slice(0, playoffSpots)` downstream still gives
// the correct seeding; falls back to plain overall order otherwise.
function computePlayoffSeeding(standings, settings) {
  if (settings.playoffFormat === 'wbc' && standings.some(t => t.divisionId)) return computeWbcSeeding(standings, settings);
  const useDivisional = settings.playoffFormat === 'divisional' && standings.some(t => t.divisionId);
  if (!useDivisional) return standings;
  const divisionIds = [...new Set(standings.map(t => t.divisionId).filter(Boolean))];
  const winnerIds = new Set();
  const winners = [];
  divisionIds.forEach(dId => {
    const best = standings.find(t => t.divisionId === dId);
    if (best) { winners.push(best); winnerIds.add(best.id); }
  });
  winners.sort((a, b) => standings.indexOf(a) - standings.indexOf(b));
  const rest = standings.filter(t => !winnerIds.has(t.id));
  return [...winners, ...rest];
}

// WBC-style: divisions double as pool-play groups, and the top
// groupAdvanceCount finishers from EVERY group advance to the knockout
// stage — prioritizing breadth over depth (every group's winner outranks
// every group's runner-up, and so on) rather than "Divisional" above,
// which only guarantees one seed per division and fills the rest purely
// by overall record regardless of group. Each round of picks is re-sorted
// by the finishers' original overall standing so stronger group winners
// still seed above weaker ones.
function computeWbcSeeding(standings, settings) {
  const advanceCount = Math.max(1, settings.groupAdvanceCount || 2);
  const byDivision = {};
  standings.forEach(t => { const key = t.divisionId || '__none'; (byDivision[key] = byDivision[key] || []).push(t); });
  const indexOf = new Map(standings.map((t, i) => [t.id, i]));
  const advanced = [];
  for (let i = 0; i < advanceCount; i++) {
    const roundPicks = Object.values(byDivision).map(group => group[i]).filter(Boolean);
    roundPicks.sort((a, b) => indexOf.get(a.id) - indexOf.get(b.id));
    advanced.push(...roundPicks);
  }
  const advancedIds = new Set(advanced.map(t => t.id));
  const rest = standings.filter(t => !advancedIds.has(t.id));
  return [...advanced, ...rest];
}

// Combines divisional/wildcard seeding with a play-in result: the first
// playoffSpots-1 seeds are locked in by regular-season record (and division
// winner status, if applicable), and the final spot goes to whoever won the
// play-in tournament, once it's decided. Falls back to plain seeding if
// play-in is off or hasn't produced a winner yet.
function buildMainBracketSeeds(standings, settings, playInWinnerId) {
  const seeded = computePlayoffSeeding(standings, settings);
  if (!settings.playInTeams || settings.playInTeams < 2 || !playInWinnerId) return seeded;
  const locked = seeded.slice(0, Math.max(0, settings.playoffSpots - 1));
  const winnerTeam = seeded.find(t => t.id === playInWinnerId) || standings.find(t => t.id === playInWinnerId);
  return winnerTeam ? [...locked, winnerTeam] : seeded;
}

// Generalized clinch/elimination math for ANY rank threshold — not just the
// playoff cutoff. Used for the playoff spot itself, but also for "clinch a
// bye" (threshold = number of teams with a bye), "clinch the #1 seed"
// (threshold = 1), or a division title (threshold = 1, scoped to that
// division's own teams).
function computeThresholdClinch(active, threshold, remainingByTeam) {
  const n = active.length;
  const results = {};
  if (threshold >= n || threshold < 1) {
    active.forEach(t => { results[t.id] = { status: 'alive', number: null }; });
    return results;
  }
  const inside = active.slice(0, threshold);
  const outside = active.slice(threshold);
  const bubbleInWins = Math.min(...inside.map(t => t.w));
  const bubbleOutMax = outside.length ? Math.max(...outside.map(t => t.w + (remainingByTeam[t.id] || 0))) : -Infinity;
  inside.forEach(t => {
    const m = Math.max(0, bubbleOutMax - t.w + 1);
    results[t.id] = { status: m <= 0 && outside.length ? 'clinched' : 'alive', number: outside.length ? m : null, remaining: remainingByTeam[t.id] || 0 };
  });
  outside.forEach(t => {
    const rem = remainingByTeam[t.id] || 0;
    const tMax = t.w + rem;
    const e = tMax - bubbleInWins + 1;
    results[t.id] = { status: e <= 0 ? 'eliminated' : 'alive', number: Math.max(0, e), remaining: rem, gap: Math.max(0, bubbleInWins - t.w) };
  });
  return results;
}
function computeClinchElim(active, playoffSpots, remainingByTeam) {
  return computeThresholdClinch(active, playoffSpots, remainingByTeam);
}

// x = clinched a playoff spot, y = clinched the #1 overall seed (no one can even tie
// them), z = mathematically eliminated. A team can carry more than one letter.
// Groups already-sorted overall standings by division, computing each team's
// rank and games-behind relative to its own division leader (not the league
// leader). Filtering an already-sorted array preserves relative order, so
// the first team found per division is genuinely that division's leader.
function computeDivisionGroups(standings, divisions) {
  const groups = (divisions || []).map(d => {
    const teams = standings.filter(t => t.divisionId === d.id);
    const leader = teams[0];
    const withGb = teams.map((t, i) => ({ ...t, divRank: i + 1, divGb: leader ? ((leader.w - t.w) + (t.l - leader.l)) / 2 : 0 }));
    return { division: d, teams: withGb };
  });
  const unassigned = standings.filter(t => !t.divisionId);
  return { groups, unassigned };
}
function computeClinchSymbols(active, playoffSpots, remainingByTeam) {
  const clinchElim = computeClinchElim(active, playoffSpots, remainingByTeam);
  const symbols = {};
  active.forEach(t => { symbols[t.id] = []; });
  if (active.length >= 1) {
    const leader = active[0];
    const othersMax = active.length > 1 ? Math.max(...active.slice(1).map(t => t.w + (remainingByTeam[t.id] || 0))) : -Infinity;
    if (othersMax < leader.w) symbols[leader.id].push('y');
  }
  active.forEach(t => {
    const ce = clinchElim[t.id];
    if (!ce) return;
    if (ce.status === 'clinched') symbols[t.id].push('x');
    if (ce.status === 'eliminated') symbols[t.id].push('z');
  });
  active.forEach(t => { symbols[t.id].sort(); });
  return symbols;
}

function nextGameFor(season, teamId) {
  const g = (season.games || []).find(g => !g.played && !g.isPlayoff && (g.homeTeamId === teamId || g.awayTeamId === teamId));
  if (!g) return null;
  const isHome = g.homeTeamId === teamId;
  return { game: g, opponentId: isHome ? g.awayTeamId : g.homeTeamId };
}

// Generalized version of the clinch scenario sentence, parametrized by a
// human-readable label for whatever's being contested ("a playoff spot",
// "a 1st-round bye", "the #1 seed", "the East division") so the same magic-
// number logic can describe any kind of seed threshold, not just making the
// playoffs at all.
function describeSeedScenario(t, ce, rank, threshold, season, teamsById, bubbleTeam, label) {
  if (!ce) return { text: `${t.displayName} — status unavailable.`, color: CHALK_DIM };
  if (ce.status === 'clinched') return { text: `${t.displayName} has clinched ${label}.`, color: WIN };
  if (ce.status === 'eliminated') return { text: `${t.displayName} can no longer secure ${label}.`, color: NEGATIVE };

  const myNext = season && teamsById ? nextGameFor(season, t.id) : null;
  const bubbleNext = bubbleTeam && season && teamsById ? nextGameFor(season, bubbleTeam.id) : null;
  const myOppName = myNext ? (teamsById[myNext.opponentId]?.name || 'their next opponent') : null;
  const bubbleOppName = bubbleNext ? (teamsById[bubbleNext.opponentId]?.name || 'their next opponent') : null;

  if (rank <= threshold) {
    if (ce.number === 1 && bubbleTeam && myNext && bubbleNext) {
      return { text: `${t.displayName} clinches ${label} with a win over ${myOppName}, or a loss by ${bubbleTeam.displayName} to ${bubbleOppName}.`, color: CHALK };
    }
    return ce.number != null
      ? { text: `${t.displayName}'s magic number for ${label} is ${ce.number}${myNext ? ` — next up: ${myOppName}` : ''}.`, color: CHALK }
      : { text: `${t.displayName} is currently positioned for ${label}.`, color: CHALK };
  }
  if (ce.number === 1 && bubbleTeam && myNext && bubbleNext) {
    return { text: `${t.displayName} loses out on ${label} with a loss to ${myOppName}, or a win by ${bubbleTeam.displayName} over ${bubbleOppName}.`, color: CHALK_DIM };
  }
  return {
    text: `${t.displayName} trails the cutoff for ${label} by ${ce.gap} win${ce.gap === 1 ? '' : 's'} with ${ce.remaining} game${ce.remaining === 1 ? '' : 's'} left.`,
    color: CHALK_DIM,
  };
}
function describeClinchElim(t, ce, rank, playoffSpots, season, teamsById, bubbleTeam) {
  return describeSeedScenario(t, ce, rank, playoffSpots, season, teamsById, bubbleTeam, 'a playoff spot');
}

// Builds the "what needs to happen for X" scenario list beyond just making
// the playoffs at all — the #1 overall seed, a 1st-round bye (however many
// teams the current bracket size actually gives one to), and each division
// title if divisions are set up. Reuses the same magic-number math as the
// basic clinch/elimination watch, just aimed at different rank thresholds.
function computeSeedScenarios(standings, settings, season, teamsById, remainingByTeam) {
  const scenarios = [];
  const n = Math.min(settings.playoffSpots, standings.length);
  if (n < 2) return scenarios;

  // #1 overall seed
  const oneSeedClinch = computeThresholdClinch(standings, 1, remainingByTeam);
  const leader = standings[0], second = standings[1];
  if (leader) {
    if (oneSeedClinch[leader.id] && oneSeedClinch[leader.id].status === 'clinched') {
      scenarios.push({ key: '1seed', group: 'The #1 seed', text: `${leader.displayName} has clinched the #1 seed.`, color: WIN });
    } else if (second) {
      const d = describeSeedScenario(leader, oneSeedClinch[leader.id], 1, 1, season, teamsById, second, 'the #1 seed');
      scenarios.push({ key: '1seed', group: 'The #1 seed', ...d });
    }
  }

  // 1st-round bye(s) — however many the bracket actually hands out given the
  // current playoff-spot count (0 if playoffSpots is already a power of 2).
  const bracketSize = nextPow2(n);
  const byeCount = bracketSize - n;
  if (byeCount > 0 && byeCount < n) {
    const byeClinch = computeThresholdClinch(standings, byeCount, remainingByTeam);
    const bubbleIn = standings[byeCount - 1], bubbleOut = standings[byeCount];
    const label = `a 1st-round bye`;
    if (bubbleIn) {
      if (byeClinch[bubbleIn.id] && byeClinch[bubbleIn.id].status === 'clinched') {
        scenarios.push({ key: 'bye-in', group: '1st-round bye', text: `${bubbleIn.displayName} has clinched ${label}.`, color: WIN });
      } else {
        scenarios.push({ key: 'bye-in', group: '1st-round bye', ...describeSeedScenario(bubbleIn, byeClinch[bubbleIn.id], bubbleIn.rank, byeCount, season, teamsById, bubbleOut, label) });
      }
    }
    if (bubbleOut && byeClinch[bubbleOut.id] && byeClinch[bubbleOut.id].status !== 'eliminated') {
      scenarios.push({ key: 'bye-out', group: '1st-round bye', ...describeSeedScenario(bubbleOut, byeClinch[bubbleOut.id], bubbleOut.rank, byeCount, season, teamsById, bubbleIn, label) });
    }
  }

  // Division titles
  if (season.divisions && season.divisions.length > 0) {
    const { groups } = computeDivisionGroups(standings, season.divisions);
    groups.forEach(g => {
      if (g.teams.length < 2) return;
      const divClinch = computeThresholdClinch(g.teams, 1, remainingByTeam);
      const divLeader = g.teams[0], divSecond = g.teams[1];
      const label = `the ${g.division.name} division`;
      if (divClinch[divLeader.id] && divClinch[divLeader.id].status === 'clinched') {
        scenarios.push({ key: `div-${g.division.id}`, group: g.division.name, text: `${divLeader.displayName} has clinched ${label}.`, color: WIN });
      } else {
        scenarios.push({ key: `div-${g.division.id}`, group: g.division.name, ...describeSeedScenario(divLeader, divClinch[divLeader.id], 1, 1, season, teamsById, divSecond, label) });
      }
    });
  }

  return scenarios;
}

/* ---- rounds ---- */
// Normalizes a round/date label for GROUPING purposes only (so "1", "Round 1",
// "round 1", " R1 " etc. are all treated as the same round instead of splitting
// into separate groups just because they were typed differently).
function roundGroupKey(dateStr, scheduleMode) {
  const s = String(dateStr || '').trim();
  if (!s) return '(unlabeled)';
  if (scheduleMode !== 'round') return s;
  const stripped = s.replace(/^(round|rd|r|week|wk)\.?\s*#?\s*/i, '').trim();
  return (stripped || s).toLowerCase();
}
// Shared comparator so any place that lists a team's games in order (not just
// the round-grouped views) sorts by actual round/date number rather than
// insertion order — a manually-added earlier-round game shouldn't appear
// after later rounds just because it was typed in more recently.
function compareGameDates(aLabel, bLabel, scheduleMode) {
  if (scheduleMode === 'round') {
    const na = parseFloat(String(aLabel).replace(/[^\d.]/g, ''));
    const nb = parseFloat(String(bLabel).replace(/[^\d.]/g, ''));
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
  } else {
    const ta = Date.parse(aLabel), tb = Date.parse(bLabel);
    if (!isNaN(ta) && !isNaN(tb)) return ta - tb;
  }
  return String(aLabel || '').localeCompare(String(bLabel || ''), undefined, { numeric: true });
}
// Game start times are entered by the admin in Eastern Time (the league's
// home timezone) but stored as an absolute UTC instant, so every visitor's
// browser can render it back out in their own local timezone with nothing
// more than Date/Intl — no separate "convert for this viewer" step needed.
// Eastern (not fixed EST/EDT) is used deliberately so the stored instant
// stays correct across the DST changeover without the admin having to think
// about which one applies to a given game's date.
const GAME_TIME_ZONE = 'America/New_York';
// The offset (ms) between UTC and `timeZone`'s wall clock at the instant
// `utcMs` represents — the standard Intl-based trick for getting a named
// zone's offset for an arbitrary date without a timezone database library.
function tzOffsetMs(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs)).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  return asUTC - utcMs;
}
// Interprets a "YYYY-MM-DDTHH:MM" wall-clock string (straight out of a
// <input type="datetime-local">) as Eastern Time and returns the equivalent
// UTC instant in ms.
function easternDatetimeLocalToUtcMs(value) {
  if (!value) return null;
  const [datePart, timePart] = value.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [hh, mm] = (timePart || '00:00').split(':').map(Number);
  const naiveUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
  return naiveUtc - tzOffsetMs(naiveUtc, GAME_TIME_ZONE);
}
// Inverse of the above — given a stored UTC instant, returns the
// "YYYY-MM-DDTHH:MM" string as it reads on an Eastern-Time wall clock, to
// pre-fill the datetime-local input when reopening the editor.
function utcMsToEasternDatetimeLocal(utcMs) {
  if (utcMs == null) return '';
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: GAME_TIME_ZONE, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs)).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
// Renders a stored game-time instant in whoever's looking at it own local
// timezone — no `timeZone` override passed to toLocaleString, so the
// browser fills in the viewer's own.
function formatGameTimeLocal(utcMs) {
  if (utcMs == null) return null;
  return new Date(utcMs).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}
function formatGameTimeOfDayLocal(utcMs) {
  if (utcMs == null) return null;
  return new Date(utcMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}
function sortGamesChronologically(games, scheduleMode) {
  const regular = games.filter(g => !g.isPlayoff && !g.isPlayIn);
  const playIn = games.filter(g => g.isPlayIn);
  const playoff = games.filter(g => g.isPlayoff);
  const sorted = [...regular].sort((a, b) => compareGameDates(a.date, b.date, scheduleMode));
  return [...sorted, ...playIn, ...playoff];
}
function getOrderedRounds(season) {
  const scheduleMode = (season.settings && season.settings.scheduleMode) || 'date';
  const rounds = [];
  const seen = {};
  (season.games || []).forEach(g => {
    const key = roundGroupKey(g.date, scheduleMode);
    if (!(key in seen)) { seen[key] = { label: g.date || '(unlabeled)', games: [], isPlayoff: !!g.isPlayoff, isPlayIn: !!g.isPlayIn }; rounds.push(seen[key]); }
    seen[key].games.push(g);
  });
  // Sort into real chronological/numeric order instead of "whichever round's
  // first game happened to be entered first" — a manually-added game for an
  // earlier round shouldn't land at the end of the list just because it was
  // typed in later than games from a later round.
  const regular = rounds.filter(r => !r.isPlayoff && !r.isPlayIn);
  const playIn = rounds.filter(r => r.isPlayIn);
  const playoff = rounds.filter(r => r.isPlayoff);
  const sortKey = (r) => {
    if (scheduleMode === 'round') {
      const n = parseFloat(String(r.label).replace(/[^\d.]/g, ''));
      return isNaN(n) ? null : n;
    }
    const t = Date.parse(r.label);
    return isNaN(t) ? null : t;
  };
  regular.sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b);
    if (ka != null && kb != null) return ka - kb;
    return String(a.label).localeCompare(String(b.label), undefined, { numeric: true });
  });
  return [...regular, ...playIn, ...playoff];
}
// "Current round" = the earliest round that doesn't have every game played
// yet (i.e. the round still in progress or coming up next). If every round
// is fully complete, falls back to the last round.
function currentRoundIndex(rounds) {
  for (let i = 0; i < rounds.length; i++) {
    if (!rounds[i].games.every(g => g.played)) return i;
  }
  return Math.max(0, rounds.length - 1);
}
// The last round with any played game — used for "movement vs. previous round"
// comparisons, which is a different concept from "the round coming up next".
function lastPlayedRoundIndex(rounds) {
  let idx = 0;
  for (let i = 0; i < rounds.length; i++) if (rounds[i].games.some(g => g.played)) idx = i;
  return idx;
}
function computeStandingsThroughRound(season, teamsById, rounds, roundIdx) {
  const gamesUpTo = [];
  for (let i = 0; i <= roundIdx && i < rounds.length; i++) gamesUpTo.push(...rounds[i].games);
  return computeStandings({ ...season, games: gamesUpTo }, teamsById);
}
function computeRoundHistory(season, teamsById, rounds) {
  const snapshots = [];
  const cum = [];
  rounds.forEach(r => {
    cum.push(...r.games);
    const standings = computeStandings({ ...season, games: cum }, teamsById);
    snapshots.push({ label: r.label, standings: standings.active });
  });
  return snapshots;
}
function computeScoringTrend(rounds) {
  return rounds.map(r => {
    const played = r.games.filter(g => g.played);
    const avg = played.length ? played.reduce((s, g) => s + Number(g.homeScore) + Number(g.awayScore), 0) / played.length : null;
    return { label: r.label, avgRuns: avg };
  }).filter(r => r.avgRuns != null);
}

/* ---- extras ---- */

/* ---- extras ---- */
// Scans every season in the league for all-time bests — a "records book" that
// nothing else in the app aggregates across seasons like this.
function computeLeagueRecords(league, teamsById) {
  if (!league || !league.seasons || league.seasons.length === 0) return null;
  let bestRecord = null, bestRunDiff = null, longestStreak = null, highestScore = null;
  league.seasons.forEach(s => {
    const st = computeStandings(s, teamsById).active;
    st.forEach(t => {
      if (t.gp > 0 && (!bestRecord || t.pct > bestRecord.pct)) bestRecord = { teamName: t.displayName, seasonName: s.name, w: t.w, l: t.l, pct: t.pct };
      if (!bestRunDiff || t.diff > bestRunDiff.diff) bestRunDiff = { teamName: t.displayName, seasonName: s.name, diff: t.diff };
      if (!longestStreak || t.longestWinStreak > longestStreak.count) longestStreak = { teamName: t.displayName, seasonName: s.name, count: t.longestWinStreak };
    });
    (s.games || []).filter(g => g.played && !g.isForfeit && g.homeTeamId && g.awayTeamId).forEach(g => {
      const homeHigher = Number(g.homeScore) >= Number(g.awayScore);
      const top = homeHigher ? Number(g.homeScore) : Number(g.awayScore);
      const teamId = homeHigher ? g.homeTeamId : g.awayTeamId;
      if (!highestScore || top > highestScore.score) highestScore = { score: top, teamName: (teamsById[teamId] && teamsById[teamId].name) || 'Unknown', seasonName: s.name };
    });
  });
  if (!bestRecord && !bestRunDiff && !longestStreak && !highestScore) return null;
  return { bestRecord, bestRunDiff, longestStreak, highestScore };
}

function computeExtras(season, teamsById) {
  const played = (season.games || []).filter(g => g.played && g.homeTeamId && g.awayTeamId);
  if (played.length === 0) return null;
  const nameFor = (id, fallback) => (teamsById[id] ? teamsById[id].name : fallback);
  const withMeta = played.map(g => ({
    ...g,
    total: Number(g.homeScore) + Number(g.awayScore),
    margin: Math.abs(Number(g.homeScore) - Number(g.awayScore)),
    awayName: nameFor(g.awayTeamId, g.awayScheduleName),
    homeName: nameFor(g.homeTeamId, g.homeScheduleName),
  }));
  const std = (season.settings && season.settings.standardInnings) || 7;
  const notable = withMeta.filter(g => !g.isForfeit); // forfeits shouldn't count as "notable" blowouts/records
  const byTotalDesc = [...notable].sort((a, b) => b.total - a.total);
  const byTotalAsc = [...notable].sort((a, b) => a.total - b.total);
  const byInningsDesc = [...notable].sort((a, b) => (b.innings || std) - (a.innings || std));
  const byInningsAsc = [...notable].sort((a, b) => (a.innings || std) - (b.innings || std));
  const byMarginDesc = [...notable].sort((a, b) => b.margin - a.margin);
  const closest = notable.filter(g => g.margin <= 1).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const bestSingleTeamGames = notable.map(g => {
    const homeHigher = Number(g.homeScore) >= Number(g.awayScore);
    return { ...g, topScore: Math.max(Number(g.homeScore), Number(g.awayScore)), topTeamName: homeHigher ? g.homeName : g.awayName };
  }).sort((a, b) => b.topScore - a.topScore);
  const highestSingleTeamScore = bestSingleTeamGames[0] || null;
  // Season sweeps: one team went a perfect X-0 against another this season.
  // Uses every decided game (including forfeits) — a forfeit win still counts
  // toward the sweep, unlike "notable" blowout/record stats above.
  const h2hCounts = {};
  withMeta.forEach(g => {
    const w = gameWinner(g);
    if (!w) return;
    const winnerId = w === 'home' ? g.homeTeamId : g.awayTeamId, loserId = w === 'home' ? g.awayTeamId : g.homeTeamId;
    const key = [winnerId, loserId].sort().join('|');
    if (!h2hCounts[key]) h2hCounts[key] = {};
    h2hCounts[key][winnerId] = (h2hCounts[key][winnerId] || 0) + 1;
  });
  const sweeps = [];
  Object.entries(h2hCounts).forEach(([key, wins]) => {
    const ids = Object.keys(wins);
    if (ids.length === 1 && wins[ids[0]] >= 2) {
      const [aId, bId] = key.split('|');
      const winnerId = ids[0], loserId = winnerId === aId ? bId : aId;
      sweeps.push({ winnerName: nameFor(winnerId, 'Unknown'), loserName: nameFor(loserId, 'Unknown'), count: wins[winnerId] });
    }
  });
  // Upset alerts: a team ranked significantly worse (by final standings) beat
  // a much better-ranked opponent. Uses final rank as a stand-in for "how
  // good was this team" — not a perfect historical snapshot, but a fun signal.
  const rankById = {};
  computeStandings(season, teamsById).active.forEach(t => { rankById[t.id] = t.rank; });
  const upsets = notable.map(g => {
    const w = gameWinner(g);
    if (!w) return null;
    const winnerId = w === 'home' ? g.homeTeamId : g.awayTeamId, loserId = w === 'home' ? g.awayTeamId : g.homeTeamId;
    const winnerRank = rankById[winnerId], loserRank = rankById[loserId];
    if (winnerRank == null || loserRank == null) return null;
    const gap = winnerRank - loserRank;
    if (gap < 3) return null;
    return { ...g, gap, winnerName: nameFor(winnerId, 'Unknown'), loserName: nameFor(loserId, 'Unknown'), winnerRank, loserRank };
  }).filter(Boolean).sort((a, b) => b.gap - a.gap);
  return {
    highest: byTotalDesc[0] || null, lowest: byTotalAsc[0] || null,
    longest: byInningsDesc[0] || null, shortest: byInningsAsc[0] || null,
    biggestBlowout: byMarginDesc[0] || null,
    highestSingleTeamScore,
    sweeps: sweeps.sort((a, b) => b.count - a.count).slice(0, 8),
    upsets: upsets.slice(0, 8),
    oneRunCount: notable.filter(g => g.margin === 1).length,
    xInnCount: notable.filter(g => (g.innings || std) > std).length,
    forfeitCount: withMeta.filter(g => g.isForfeit).length,
    totalGames: played.length,
    closest: closest.slice(0, 12),
    blowoutWinLeaders: computeBlowoutWinLeaders(notable, nameFor),
  };
}
// Which teams rack up the most lopsided wins — a fixed 6-run margin (not
// tied to standardInnings/sport) counts as a "blowout" here. Final-score-only
// data can't tell a wire-to-wire rout from a big comeback, so this only ever
// tracks how often a team wins big, not whether it overcame a deficit to do it.
const BLOWOUT_MARGIN = 6;
function computeBlowoutWinLeaders(notable, nameFor) {
  const counts = {};
  notable.forEach(g => {
    if (g.margin < BLOWOUT_MARGIN) return;
    const w = gameWinner(g);
    if (!w) return;
    const winnerId = w === 'home' ? g.homeTeamId : g.awayTeamId;
    if (!counts[winnerId]) counts[winnerId] = { teamId: winnerId, teamName: nameFor(winnerId, 'Unknown'), count: 0 };
    counts[winnerId].count += 1;
  });
  return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 8);
}

// A team's run-differential-per-game standard deviation this season — a
// blowout-heavy team and a nail-biter-heavy team can post the same overall
// record, this is what actually tells them apart. Needs at least 3 games
// played to mean anything.
function computeTeamConsistency(season, teamsById) {
  const byTeam = new Map();
  (season.games || []).filter(g => g.played && !g.isBye && !g.isForfeit && g.homeTeamId && g.awayTeamId).forEach(g => {
    const hs = Number(g.homeScore), as = Number(g.awayScore);
    if (Number.isNaN(hs) || Number.isNaN(as)) return;
    (byTeam.get(g.homeTeamId) || byTeam.set(g.homeTeamId, []).get(g.homeTeamId)).push(hs - as);
    (byTeam.get(g.awayTeamId) || byTeam.set(g.awayTeamId, []).get(g.awayTeamId)).push(as - hs);
  });
  const rows = [];
  byTeam.forEach((diffs, teamId) => {
    if (diffs.length < 3) return;
    const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
    const variance = diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / diffs.length;
    const stdev = Math.sqrt(variance);
    const t = teamsById[teamId];
    rows.push({ teamId, teamName: t ? t.name : 'Unknown', gp: diffs.length, stdev, avgMargin: mean });
  });
  return rows.sort((a, b) => a.stdev - b.stdev);
}

// Cumulative innings/appearances per pitcher this season — a workload
// tracker, not a rate-stat leaderboard (ERA/K-9 already cover that).
function computePitcherWorkload(season, teamsById) {
  const byPlayer = new Map();
  (season.members || []).forEach(m => (m.roster || []).forEach(p => { if (!p.banned) byPlayer.set(p.id, { playerId: p.id, name: p.name, teamId: m.teamId, outs: 0, appearances: 0 }); }));
  (season.games || []).forEach(g => {
    if (g.isBye || g.isSpringTraining) return;
    ['home', 'away'].forEach(side => {
      ((g.playerStats && g.playerStats[side]) || []).forEach(row => {
        const outs = ipDisplayToOuts(row.ip || '0.0');
        if (outs <= 0) return;
        const entry = byPlayer.get(row.playerId);
        if (entry) { entry.outs += outs; entry.appearances += 1; }
      });
    });
  });
  return [...byPlayer.values()].filter(e => e.outs > 0)
    .map(e => ({ ...e, ip: e.outs / 3, teamName: (teamsById[e.teamId] && teamsById[e.teamId].name) || 'Free Agent' }))
    .sort((a, b) => b.outs - a.outs);
}

// Letter-graded draft classes: every drafted player's WAR this season,
// summed per team and curved against the other teams' draft classes.
// Standard-ish curve — top third A, middle third B/C, bottom third D/F —
// simple enough to explain, not pretending to be more precise than the
// underlying WAR figure already is.
function gradeFromPercentile(pct) {
  if (pct >= 0.85) return 'A';
  if (pct >= 0.65) return 'B';
  if (pct >= 0.4) return 'C';
  if (pct >= 0.2) return 'D';
  return 'F';
}
function computeDraftClassGrades(season, teamsById) {
  const leaders = computeSeasonPlayerLeaders(season, teamsById, 'regular');
  const warByPlayerId = new Map(leaders.map(p => [p.playerId, p.war]));
  const byTeam = new Map();
  (season.members || []).forEach(m => {
    (m.roster || []).forEach(p => {
      if (!p.draftPick) return;
      const entry = byTeam.get(m.teamId) || { teamId: m.teamId, picks: [] };
      entry.picks.push({ name: p.name, playerId: p.id, overall: p.draftPick.overall || null, war: warByPlayerId.get(p.id) || 0 });
      byTeam.set(m.teamId, entry);
    });
  });
  const rows = [...byTeam.values()].map(e => ({ ...e, teamName: (teamsById[e.teamId] && teamsById[e.teamId].name) || 'Unknown', totalWar: e.picks.reduce((s, p) => s + p.war, 0) }));
  if (rows.length === 0) return [];
  const sorted = [...rows].sort((a, b) => a.totalWar - b.totalWar);
  rows.forEach(r => { r.grade = gradeFromPercentile(sorted.indexOf(sorted.find(s => s.teamId === r.teamId)) / Math.max(1, sorted.length - 1)); });
  return rows.sort((a, b) => b.totalWar - a.totalWar);
}

// Draft "steals" — the biggest gap between where a player was actually
// picked and what they went on to produce. valueScore rewards high WAR from
// a late pick far more than the same WAR from an early one.
function computeDraftValueBoard(season, teamsById) {
  const leaders = computeSeasonPlayerLeaders(season, teamsById, 'regular');
  const warByPlayerId = new Map(leaders.map(p => [p.playerId, p.war]));
  const rows = [];
  (season.members || []).forEach(m => (m.roster || []).forEach(p => {
    if (!p.draftPick || !p.draftPick.overall) return;
    const war = warByPlayerId.get(p.id) || 0;
    rows.push({ playerId: p.id, name: p.name, teamId: m.teamId, teamName: (teamsById[m.teamId] && teamsById[m.teamId].name) || 'Unknown', overall: p.draftPick.overall, war, valueScore: war * p.draftPick.overall });
  }));
  return rows.sort((a, b) => b.valueScore - a.valueScore);
}

/* ---- simulation ---- */
function runSimulation(season, teamsById, simRuns, playoffSpots, h2hMatrix) {
  const base = computeStandings(season, teamsById).active;
  const remaining = (season.games || []).filter(g => !g.played && !g.isPlayoff && g.homeTeamId && g.awayTeamId
    && base.some(t => t.id === g.homeTeamId) && base.some(t => t.id === g.awayTeamId));
  const n = base.length;
  const results = {};
  base.forEach(t => { results[t.id] = { playoff: 0, seeds: new Array(n).fill(0) }; });
  for (let i = 0; i < simRuns; i++) {
    const sim = {};
    base.forEach(t => { sim[t.id] = { ...t }; });
    for (let gi = 0; gi < remaining.length; gi++) {
      const g = remaining[gi];
      const home = sim[g.homeTeamId], away = sim[g.awayTeamId];
      if (!home || !away) continue;
      const h2h = h2hRecord(h2hMatrix, home.id, away.id);
      const pHome = winProb(home, away, h2h);
      if (Math.random() < pHome) { home.w += 1; away.l += 1; } else { away.w += 1; home.l += 1; }
    }
    const order = Object.values(sim).sort((a, b) => {
      const pa = (a.w + a.l) > 0 ? a.w / (a.w + a.l) : 0;
      const pb = (b.w + b.l) > 0 ? b.w / (b.w + b.l) : 0;
      if (pb !== pa) return pb - pa;
      // 1. Run differential
      const da = a.rf - a.ra, db = b.rf - b.ra;
      if (db !== da) return db - da;
      // 2. Head-to-head record (games actually played so far)
      const rec = h2hMatrix[a.id] && h2hMatrix[a.id][b.id];
      if (rec && (rec.w + rec.l) > 0 && rec.w !== rec.l) return rec.w > rec.l ? -1 : 1;
      // 3. Head-to-head run differential
      if (rec) { const hDiff = rec.rf - rec.ra; if (hDiff !== 0) return hDiff > 0 ? -1 : 1; }
      // 4. Coin flip — genuinely random each trial, which is the statistically correct
      // choice for a Monte Carlo simulation (unlike the real standings, this shouldn't
      // be stable/deterministic, or it would bias thousands of trials toward one team).
      return Math.random() - 0.5;
    });
    order.forEach((t, idx) => {
      results[t.id].seeds[idx] += 1;
      if (idx < playoffSpots) results[t.id].playoff += 1;
    });
  }
  Object.keys(results).forEach(id => {
    results[id].playoffPct = (results[id].playoff / simRuns) * 100;
    results[id].seedPct = results[id].seeds.map(c => (c / simRuns) * 100);
  });
  return results;
}

/* ---- playoff series & bracket simulation (reach round / win championship) ---- */
// Simulates the rest of a single series game-by-game, starting from any partial
// progress already recorded (real games played so far), so it stays accurate if
// the series is already underway. Home-field advantage is a flat win-probability
// nudge applied to whichever team is hosting that specific game.
function simulateSeriesWinner(teamAId, teamBId, teamById, h2hMatrix, seriesLength, homeFieldBoost, startWinsA, startWinsB, higherSeedId) {
  const winsNeeded = seriesWinsNeeded(seriesLength);
  let winsA = startWinsA || 0, winsB = startWinsB || 0;
  let gameNum = winsA + winsB + 1;
  const teamA = teamById[teamAId], teamB = teamById[teamBId];
  if (!teamA || !teamB) return teamAId;
  while (winsA < winsNeeded && winsB < winsNeeded) {
    const aIsHost = (gameNum % 2 === 1) ? (higherSeedId === teamAId) : (higherSeedId !== teamAId);
    const h2h = h2hRecord(h2hMatrix, teamAId, teamBId);
    let pA = winProb(teamA, teamB, h2h);
    const boost = (homeFieldBoost || 0) / 100;
    pA = aIsHost ? Math.min(0.97, Math.max(0.03, pA + boost)) : Math.min(0.97, Math.max(0.03, pA - boost));
    if (Math.random() < pA) winsA++; else winsB++;
    gameNum++;
  }
  return winsA >= winsNeeded ? teamAId : teamBId;
}

// Monte Carlo odds for ONE specific series (not the whole bracket) — used to
// show a live "chance to win this series" percentage on an in-progress
// matchup, properly simulating out the actual number of remaining games in
// that series (best-of-1/3/5/7, whatever the round is configured for) rather
// than just a single-game win probability.
function simulateSeriesOdds(teamAId, teamBId, teamById, h2hMatrix, seriesLength, homeFieldBoost, startWinsA, startWinsB, higherSeedId, trials) {
  let aWins = 0;
  const n = trials || 400;
  for (let i = 0; i < n; i++) {
    if (simulateSeriesWinner(teamAId, teamBId, teamById, h2hMatrix, seriesLength, homeFieldBoost, startWinsA, startWinsB, higherSeedId) === teamAId) aWins++;
  }
  return (aWins / n) * 100;
}

// Reads the real playoff games (if any) into per-slot progress so simulated
// brackets resume from the actual current state instead of always starting fresh.
function buildExistingSeriesBySlot(existingPlayoffGames) {
  const map = {};
  (existingPlayoffGames || []).forEach(g => {
    const key = `${g.playoffRound}-${g.bracketSlot}`;
    if (!map[key]) map[key] = [];
    map[key].push(g);
  });
  const result = {};
  Object.keys(map).forEach(key => {
    const games = map[key];
    const teamIds = new Set();
    games.forEach(g => { if (g.homeTeamId) teamIds.add(g.homeTeamId); if (g.awayTeamId) teamIds.add(g.awayTeamId); });
    const wins = {};
    [...teamIds].forEach(id => { wins[id] = 0; });
    games.forEach(g => {
      if (!g.played) return;
      const w = gameWinner(g);
      const wid = w === 'home' ? g.homeTeamId : w === 'away' ? g.awayTeamId : null;
      if (wid != null) wins[wid] = (wins[wid] || 0) + 1;
    });
    result[key] = { teamIds: [...teamIds], wins, higherSeedId: games[0].higherSeedId || games[0].homeTeamId };
  });
  return result;
}
// Same idea as buildExistingSeriesBySlot, but keyed by (round, team pair)
// instead of (round, bracket slot) — needed for round 2+ once reseeding is on,
// since which "slot" a matchup lands in can shift from what the real bracket
// recorded it as, but the pair of teams involved is always a reliable key.
function buildExistingSeriesByTeamPair(existingPlayoffGames) {
  const byRoundPair = {};
  (existingPlayoffGames || []).forEach(g => {
    const teamIds = [g.homeTeamId, g.awayTeamId].filter(Boolean).sort();
    if (teamIds.length < 2) return;
    const key = `${g.playoffRound}-${teamIds.join('|')}`;
    if (!byRoundPair[key]) byRoundPair[key] = [];
    byRoundPair[key].push(g);
  });
  const result = {};
  Object.keys(byRoundPair).forEach(key => {
    const games = byRoundPair[key];
    const teamIds = new Set();
    games.forEach(g => { if (g.homeTeamId) teamIds.add(g.homeTeamId); if (g.awayTeamId) teamIds.add(g.awayTeamId); });
    const wins = {};
    [...teamIds].forEach(id => { wins[id] = 0; });
    games.forEach(g => {
      if (!g.played) return;
      const w = gameWinner(g);
      const wid = w === 'home' ? g.homeTeamId : w === 'away' ? g.awayTeamId : null;
      if (wid != null) wins[wid] = (wins[wid] || 0) + 1;
    });
    result[key] = { teamIds: [...teamIds], wins, higherSeedId: games[0].higherSeedId || games[0].homeTeamId };
  });
  return result;
}

// A team is out of the bracket once some real (played) playoff series has a
// side that already reached the wins needed for that round's series length
// — used to drop already-eliminated teams from the playoff series odds
// table instead of leaving them showing a flat 0% row for every round.
function computeEliminatedTeamIds(existingPlayoffGames, settings) {
  const byPair = buildExistingSeriesByTeamPair(existingPlayoffGames);
  const eliminated = new Set();
  Object.keys(byPair).forEach(key => {
    const round = Number(key.split('-')[0]);
    const rec = byPair[key];
    if (rec.teamIds.length < 2) return;
    const needed = seriesWinsNeeded(getSeriesLength(settings, round));
    const winnerId = rec.teamIds.find(id => (rec.wins[id] || 0) >= needed);
    if (winnerId) rec.teamIds.forEach(id => { if (id !== winnerId) eliminated.add(id); });
  });
  return eliminated;
}

// Simulates the whole playoff bracket many times (resuming from real results where
// the actual playoffs have already started) and tallies, per team, the percent
// chance of reaching each round and of winning the championship.
function simulatePlayoffs(standings, playoffSpots, settings, h2hMatrix, simRuns, homeFieldBoost, existingPlayoffGames) {
  const n = Math.min(playoffSpots, standings.length);
  if (n < 2) return null;
  const bracketSize = nextPow2(n);
  const order = seedOrder(bracketSize);
  const roundsCount = Math.log2(bracketSize);
  const teamById = {};
  standings.forEach(t => { teamById[t.id] = t; });
  const seedById = {};
  standings.forEach((t, i) => { seedById[t.id] = i + 1; });
  const existingBySlot = buildExistingSeriesBySlot(existingPlayoffGames);
  const existingByPair = buildExistingSeriesByTeamPair(existingPlayoffGames);
  const results = {};
  standings.slice(0, n).forEach(t => { results[t.id] = { reach: new Array(roundsCount + 1).fill(0), champion: 0 }; });

  for (let trial = 0; trial < simRuns; trial++) {
    let survivors = [];
    for (let i = 0; i < order.length; i += 2) {
      const s1 = order[i], s2 = order[i + 1];
      const t1 = s1 <= n ? standings[s1 - 1].id : null;
      const t2 = s2 <= n ? standings[s2 - 1].id : null;
      if (t1 && t2) {
        const key = `1-${i / 2}`;
        const existing = existingBySlot[key];
        let startA = 0, startB = 0, higherSeedId = t1;
        if (existing && existing.teamIds.includes(t1) && existing.teamIds.includes(t2)) {
          startA = existing.wins[t1] || 0; startB = existing.wins[t2] || 0; higherSeedId = existing.higherSeedId;
        }
        const winner = simulateSeriesWinner(t1, t2, teamById, h2hMatrix, getSeriesLength(settings, 1), homeFieldBoost, startA, startB, higherSeedId);
        survivors.push(winner);
        [t1, t2].forEach(id => { if (results[id]) results[id].reach[1] += 1; });
      } else {
        const only = t1 || t2;
        survivors.push(only);
        if (only && results[only]) results[only].reach[1] += 1;
      }
    }
    let round = 2;
    while (survivors.length > 1) {
      if (settings.reseedPlayoffs) {
        survivors = [...survivors].sort((a, b) => (seedById[a] ?? 999) - (seedById[b] ?? 999));
        const paired = [];
        for (let i = 0, j = survivors.length - 1; i < j; i++, j--) paired.push(survivors[i], survivors[j]);
        survivors = paired;
      }
      const next = [];
      for (let i = 0; i < survivors.length; i += 2) {
        const a = survivors[i], b = survivors[i + 1];
        [a, b].forEach(id => { if (results[id]) results[id].reach[round] += 1; });
        // Team-pair lookup (not slot-based) since reseeding can change which
        // "slot" a matchup lands in from what the real bracket recorded.
        const pairKey = `${round}-${[a, b].sort().join('|')}`;
        const existing = existingByPair[pairKey];
        let startA = 0, startB = 0, higherSeedId = a;
        if (existing && existing.teamIds.includes(a) && existing.teamIds.includes(b)) {
          startA = existing.wins[a] || 0; startB = existing.wins[b] || 0; higherSeedId = existing.higherSeedId;
        }
        const winner = simulateSeriesWinner(a, b, teamById, h2hMatrix, getSeriesLength(settings, round), homeFieldBoost, startA, startB, higherSeedId);
        next.push(winner);
      }
      survivors = next;
      round++;
    }
    if (survivors[0] && results[survivors[0]]) results[survivors[0]].champion += 1;
  }
  Object.keys(results).forEach(id => {
    results[id].reachPct = results[id].reach.map(c => (c / simRuns) * 100);
    results[id].championPct = (results[id].champion / simRuns) * 100;
  });
  return { results, roundsCount };
}

// Runs both simulations once and packages the result to be cached on the
// season (season.oddsCache) rather than re-run live every time someone
// opens the Odds tab. Called from the score-entry mutators right after a
// game result changes, so the odds shown are always "as of the last score
// entered" — a deliberate snapshot, not a per-viewer live recompute.
function computeOddsCache(season, teamsById, h2hMatrix) {
  const settings = season.settings;
  const standings = computeStandings(season, teamsById).active;
  const playInGames = (season.games || []).filter(g => g.isPlayIn);
  const playoffGames = (season.games || []).filter(g => g.isPlayoff);
  const playInWinnerId = getPlayInWinner(playInGames);
  const seededStandings = buildMainBracketSeeds(standings, settings, playInWinnerId);
  const sim = runSimulation(season, teamsById, settings.simRuns, settings.playoffSpots, h2hMatrix);
  const playoffSim = standings.length >= 2 ? simulatePlayoffs(seededStandings, settings.playoffSpots, settings, h2hMatrix, settings.simRuns, settings.homeFieldBoost || 0, playoffGames) : null;
  return { sim, playoffSim, computedAt: Date.now() };
}

/* ---- season "futures" props (dynamic, odds-driven pick'ems) ---- */
// Cheap deterministic PRNG + shuffle so the same round always shows the same
// selection until the round actually advances, but different rounds get a
// genuinely different set — no external random-seed library needed.
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed || 1;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Builds every candidate future question the current state supports, each
// with a STABLE id (so a pick sticks even if the same question resurfaces in
// a later round) and a freshly computed probability. Filters out anything
// already essentially decided (>98% or <2%) since those aren't real bets.
// Odds range every future must fall within to even be considered — keeps
// things feeling like genuine toss-ups rather than "will the obvious thing
// happen" (a near-100% or near-0% question isn't a real bet).
const FUTURES_MIN_PCT = 15, FUTURES_MAX_PCT = 85;
function inFuturesRange(pct) { return pct >= FUTURES_MIN_PCT && pct <= FUTURES_MAX_PCT; }

function computeFuturesPool(season, standings, settings, seasonSim, playoffSim, h2hMatrix) {
  const n = standings.length;
  const pool = [];
  if (!seasonSim || n < 2) return pool;
  const halfN = Math.ceil(n / 2);
  const thresholds = [...new Set([1, 2, 3, halfN, settings.playoffSpots, settings.playoffSpots + 1])].filter(v => v >= 1 && v < n);
  const byId = {}; standings.forEach(t => { byId[t.id] = t; });
  const remaining = (season.games || []).filter(g => !g.played && !g.isPlayoff && !g.isPlayIn && g.homeTeamId && g.awayTeamId);
  const nextGameFor = (teamId) => remaining.find(g => g.homeTeamId === teamId || g.awayTeamId === teamId);

  standings.forEach(t => {
    const sim = seasonSim[t.id];
    if (!sim) return;
    thresholds.forEach(N => {
      const pct = sim.seedPct.slice(0, N).reduce((s, v) => s + v, 0);
      if (inFuturesRange(pct)) {
        const label = N === 1 ? 'finish in 1st place' : `finish in the top ${N}`;
        pool.push({ id: `top${N}-${t.id}`, text: `Will ${t.displayName} ${label}?`, pct, category: 'finish' });
      }
    });
    if (inFuturesRange(sim.playoffPct)) {
      pool.push({ id: `playoff-${t.id}`, text: `Will ${t.displayName} make the playoffs?`, pct: sim.playoffPct, category: 'playoffs' });
    }

    // Next-game / streak-driven props — genuinely different in character from
    // the season-long projections above, and often the most "alive" ones
    // since they hinge on the very next game rather than the whole rest of
    // the season.
    const ng = nextGameFor(t.id);
    if (ng) {
      const isHome = ng.homeTeamId === t.id;
      const oppId = isHome ? ng.awayTeamId : ng.homeTeamId;
      const opp = byId[oppId];
      if (opp) {
        const h2h = h2hRecord(h2hMatrix, isHome ? t.id : opp.id, isHome ? opp.id : t.id);
        const pHomeSide = winProb(isHome ? t : opp, isHome ? opp : t, h2h);
        const myWinPct = (isHome ? pHomeSide : 1 - pHomeSide) * 100;
        if (inFuturesRange(myWinPct)) {
          pool.push({ id: `nextwin-${t.id}`, text: `Will ${t.displayName} win their next game?`, pct: myWinPct, category: 'nextgame' });
        }
        if (t.streak.type === 'L' && t.streak.count >= 3 && inFuturesRange(myWinPct)) {
          pool.push({ id: `snapstreak-${t.id}`, text: `Will ${t.displayName} snap their ${t.streak.count}-game losing streak in their next game?`, pct: myWinPct, category: 'streak' });
        }
        if (t.streak.type === 'W' && t.streak.count >= 3 && inFuturesRange(myWinPct)) {
          pool.push({ id: `extendstreak-${t.id}`, text: `Will ${t.displayName} extend their ${t.streak.count}-game winning streak?`, pct: myWinPct, category: 'streak' });
        }
      }
    }
  });

  // Season-series sweep props: a team currently undefeated (or unbeaten) in
  // an ongoing series with at least one game left against that opponent.
  for (let i = 0; i < standings.length; i++) {
    for (let j = 0; j < standings.length; j++) {
      if (i === j) continue;
      const a = standings[i], b = standings[j];
      const h2h = h2hRecord(h2hMatrix, a.id, b.id);
      if (h2h.aWins < 1 || h2h.aLosses > 0) continue;
      const gamesLeft = remaining.filter(g => (g.homeTeamId === a.id && g.awayTeamId === b.id) || (g.homeTeamId === b.id && g.awayTeamId === a.id));
      if (gamesLeft.length === 0) continue;
      let pSweepRest = 1;
      gamesLeft.forEach(g => {
        const isHome = g.homeTeamId === a.id;
        const h2hNow = h2hRecord(h2hMatrix, isHome ? a.id : b.id, isHome ? b.id : a.id);
        const pHomeSide = winProb(isHome ? a : b, isHome ? b : a, h2hNow);
        pSweepRest *= (isHome ? pHomeSide : 1 - pHomeSide);
      });
      const pct = pSweepRest * 100;
      if (inFuturesRange(pct)) {
        pool.push({ id: `sweep-${a.id}-${b.id}`, text: `Will ${a.displayName} finish a season sweep of ${b.displayName}?`, pct, category: 'sweep' });
      }
    }
  }

  if (playoffSim) {
    standings.slice(0, settings.playoffSpots).forEach(t => {
      const r = playoffSim.results[t.id];
      if (r && inFuturesRange(r.championPct)) {
        pool.push({ id: `champ-${t.id}`, text: `Will ${t.displayName} win the championship?`, pct: r.championPct, category: 'champion' });
      }
    });
    const top2Ids = new Set(standings.slice(0, 2).map(t => t.id));
    const topHalfPlayoffIds = new Set(standings.slice(0, Math.max(1, Math.ceil(settings.playoffSpots / 2))).map(t => t.id));
    let top2ChampPct = 0, topHalfChampPct = 0;
    Object.entries(playoffSim.results).forEach(([id, r]) => {
      if (top2Ids.has(id)) top2ChampPct += r.championPct;
      if (topHalfPlayoffIds.has(id)) topHalfChampPct += r.championPct;
    });
    if (inFuturesRange(top2ChampPct)) pool.push({ id: 'champTop2Seed', text: 'Will the champion be one of the top 2 teams?', pct: top2ChampPct, category: 'champion' });
    if (inFuturesRange(topHalfChampPct)) pool.push({ id: 'champTopHalfSeed', text: 'Will the champion be a top-half playoff seed?', pct: topHalfChampPct, category: 'champion' });
    const underdogPct = 100 - topHalfChampPct;
    if (inFuturesRange(underdogPct)) pool.push({ id: 'champUnderdog', text: 'Will a bottom-half seed pull off the title?', pct: underdogPct, category: 'champion' });
    if (season.divisions && season.divisions.length > 1) {
      season.divisions.forEach(d => {
        let divChampPct = 0;
        standings.forEach(t => { if (t.divisionId === d.id && playoffSim.results[t.id]) divChampPct += playoffSim.results[t.id].championPct; });
        if (inFuturesRange(divChampPct)) pool.push({ id: `champDiv-${d.id}`, text: `Will the champion come from the ${d.name} division?`, pct: divChampPct, category: 'champion' });
      });
    }
  }

  // Team-vs-team "who finishes ahead" props for standings-adjacent pairs,
  // approximated from each team's independent seed distribution.
  for (let i = 0; i < standings.length - 1; i++) {
    const a = standings[i], b = standings[i + 1];
    const simA = seasonSim[a.id], simB = seasonSim[b.id];
    if (!simA || !simB) continue;
    let pAheadOfB = 0;
    for (let si = 0; si < simA.seedPct.length; si++) {
      for (let sj = si + 1; sj < simB.seedPct.length; sj++) pAheadOfB += (simA.seedPct[si] / 100) * (simB.seedPct[sj] / 100);
    }
    const normA = simA.seedPct.reduce((s, v) => s + v, 0) / 100, normB = simB.seedPct.reduce((s, v) => s + v, 0) / 100;
    const norm = normA * normB;
    const pct = norm > 0 ? Math.min(99, Math.max(1, (pAheadOfB / norm) * 100)) : 50;
    if (inFuturesRange(pct)) {
      const ids = [a.id, b.id].sort();
      pool.push({ id: `ahead-${ids[0]}-${ids[1]}`, text: `Will ${a.displayName} finish ahead of ${b.displayName}?`, pct, category: 'headtohead' });
    }
  }
  return pool;
}
// Picks a stable-per-round subset from the pool, capping how many "finish in
// the top N" questions can appear together (they're the easiest category to
// generate in bulk, so left unchecked they'd crowd out everything else).
function selectRoundFutures(pool, seasonId, roundLabel, count, nonce, maxPerCategory) {
  const seed = hashStr(`${seasonId}-${roundLabel}-${nonce || 0}`);
  const shuffled = seededShuffle(pool, seed);
  const picked = [];
  const categoryCounts = {};
  // Cap EVERY category, not just "finish" — otherwise a pool that happens to
  // be full of "next game" questions (common, since there's roughly one per
  // team with an upcoming game) can fill the whole set on its own.
  const cap = maxPerCategory != null ? maxPerCategory : 2;
  for (const f of shuffled) {
    if (picked.length >= count) break;
    const cur = categoryCounts[f.category] || 0;
    if (cur >= cap) continue;
    picked.push(f);
    categoryCounts[f.category] = cur + 1;
  }
  // Backfill if category caps left us short (e.g. a tiny pool with very few categories represented)
  if (picked.length < count) {
    for (const f of shuffled) {
      if (picked.length >= count) break;
      if (!picked.includes(f)) picked.push(f);
    }
  }
  return picked;
}

/* ---- schedule text parsing (supports round/date block headers) ---- */
// Round-robin schedule generator: given a list of teams, produces a full
// schedule where every team plays every other team `rounds` times, using the
// standard "circle method" (fix one team, rotate the rest) so byes/matchups
// are balanced across weeks. Alternates home/away each time two teams meet
// again on a repeat round.
// Blackout-aware date assignment for a generated schedule: one calendar day
// per round, skipping any weekday the league doesn't play on (e.g. no games
// Mondays or Thursdays), instead of admins typing a date into every game.
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function nextEligibleDate(date, blackoutWeekdays) {
  const d = new Date(date);
  let guard = 0;
  while ((blackoutWeekdays || []).includes(d.getDay()) && guard < 14) { d.setDate(d.getDate() + 1); guard++; }
  return d;
}
function formatDateYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function assignRoundDates(roundsCount, startDateStr, blackoutWeekdays) {
  const dates = [];
  let cur = nextEligibleDate(new Date(`${startDateStr}T00:00:00`), blackoutWeekdays);
  for (let i = 0; i < roundsCount; i++) {
    dates.push(formatDateYMD(cur));
    const next = new Date(cur); next.setDate(next.getDate() + 1);
    cur = nextEligibleDate(next, blackoutWeekdays);
  }
  return dates;
}

function generateRoundRobinSchedule(teamIds, roundsOfPlay) {
  const ids = [...teamIds];
  const hasBye = ids.length % 2 === 1;
  if (hasBye) ids.push(null); // null = bye slot
  const n = ids.length;
  const half = n / 2;
  const weeks = [];
  let arr = [...ids];
  for (let w = 0; w < n - 1; w++) {
    const pairs = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a != null && b != null) pairs.push([a, b]);
    }
    weeks.push(pairs);
    // rotate all but the first element
    arr = [arr[0], ...arr.slice(-1), ...arr.slice(1, -1)];
  }
  const schedule = [];
  let roundNum = 1;
  for (let rep = 0; rep < Math.max(1, roundsOfPlay); rep++) {
    weeks.forEach(pairs => {
      pairs.forEach(([a, b]) => {
        const flip = rep % 2 === 1; // alternate home/away on repeat rounds
        schedule.push({ round: roundNum, homeTeamId: flip ? b : a, awayTeamId: flip ? a : b });
      });
      roundNum++;
    });
  }
  return schedule;
}

function parseScheduleText(text, mode = 'date') {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const rows = [];
  let currentLabel = '';
  const sepRegexes = [/\s+@\s+/, /\s+at\s+/i, /\s+vs\.?\s+/i, /\s+v\.?\s+/i];
  const tryMatchup = (str) => {
    for (const re of sepRegexes) {
      if (re.test(str)) {
        const parts = str.split(re);
        if (parts.length === 2 && parts[0].trim() && parts[1].trim()) return { away: parts[0].trim(), home: parts[1].trim() };
      }
    }
    return null;
  };
  lines.forEach((line, idx) => {
    let label = currentLabel, away = '', home = '', matched = false, isHeader = false;
    let awayScore = null, homeScore = null, innings = null;

    if (line.includes(',')) {
      const parts = line.split(',').map(p => p.trim()).filter(p => p.length > 0);
      if (parts.length >= 3) {
        label = parts[0]; away = parts[1]; home = parts[2];
        if (parts[3] !== undefined && parts[3] !== '' && !Number.isNaN(Number(parts[3]))) awayScore = Number(parts[3]);
        if (parts[4] !== undefined && parts[4] !== '' && !Number.isNaN(Number(parts[4]))) homeScore = Number(parts[4]);
        if (parts[5] !== undefined && parts[5] !== '' && !Number.isNaN(Number(parts[5]))) innings = Number(parts[5]);
        matched = true;
      }
    }
    if (!matched) {
      // try a matchup directly on this line
      let direct = tryMatchup(line);
      if (direct) { away = direct.away; home = direct.home; label = currentLabel; matched = true; }
      if (!matched) {
        // try stripping a leading date/round prefix on the same line
        let rest = line, prefixLabel = null;
        if (mode === 'round') {
          const rm = rest.match(/^(?:round|rd|r|week|wk)?\.?\s*#?\s*(\d+)\s*[:.\-,]?\s*(.*)$/i);
          if (rm && rm[2]) { prefixLabel = rm[1]; rest = rm[2]; }
        } else {
          const dm = rest.match(/^([A-Za-z]{3,9}\.?\s+\d{1,2}(?:,?\s*\d{2,4})?|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)[\s:,-]+(.*)$/);
          if (dm) { prefixLabel = dm[1]; rest = dm[2]; }
        }
        if (prefixLabel != null) {
          const m2 = tryMatchup(rest);
          if (m2) { away = m2.away; home = m2.home; label = prefixLabel; matched = true; }
        }
      }
      if (!matched) {
        // this line is a standalone header (e.g. "Round 1", "April 5") — applies to following lines
        let headerText = line;
        if (mode === 'round') {
          const hm = headerText.match(/^(?:round|rd|r|week|wk)?\.?\s*#?\s*(\d+)\s*:?\s*$/i);
          headerText = hm ? hm[1] : headerText.replace(/^(round|rd|r|week|wk)\.?\s*/i, '').trim();
        }
        currentLabel = headerText;
        rows.push({ rowId: idx, raw: line, isHeader: true, date: headerText, away: '', home: '', awayScore: null, homeScore: null, innings: null, matched: false });
        return;
      }
    }
    rows.push({ rowId: idx, raw: line, isHeader: false, date: label, away, home, awayScore, homeScore, innings, matched: matched && !!away && !!home });
  });
  return rows;
}

function resizeImageFile(file, maxDim = 160) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error('image load failed'));
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) { const scale = maxDim / Math.max(w, h); w = Math.round(w * scale); h = Math.round(h * scale); }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

/* ---- season / league helpers ---- */
function newSeason(name) {
  return { id: uid('season'), name, createdAt: Date.now(), championTeamId: null, settings: { ...DEFAULT_SETTINGS }, members: [], games: [], divisions: [] };
}
function newDivision(name, conference) { return { id: uid('div'), name, conference: conference || '' }; }
function migrateShape(lg) {
  if (lg.seasons) return lg;
  const season = {
    id: uid('season'), name: 'Season 1', createdAt: lg.createdAt || Date.now(), championTeamId: null,
    settings: { ...DEFAULT_SETTINGS, ...(lg.settings || {}) },
    members: (lg.teams || []).map(t => ({ teamId: t.id, scheduleName: t.scheduleName, baselineW: t.baselineW || 0, baselineL: t.baselineL || 0, baselineRF: t.baselineRF || 0, baselineRA: t.baselineRA || 0, active: true })),
    games: lg.games || [],
  };
  return { id: lg.id, name: lg.name, createdAt: lg.createdAt || Date.now(), seasons: [season], activeSeasonId: season.id, _legacyTeams: lg.teams || [] };
}

/* ==================================================================== */
/* Storage helpers                                                       */
/* ==================================================================== */
let leagueStamp = null;

async function saveLeagueChecked(key, value) {
  const stamp = new Date().toISOString();
  let query = supabase.from('kv_store').update({ value, updated_at: stamp }).eq('key', key);
  query = leagueStamp === null || leagueStamp === undefined
    ? query.is('updated_at', null)
    : query.eq('updated_at', leagueStamp);
  const { data, error } = await query.select('key');
  if (error) throw error;
  if (!data || data.length === 0) return false;
  leagueStamp = stamp;
  return true;
}

async function storGet(key, attempt = 0) {
  try {
    const { data, error } = await supabase.from('kv_store').select('value, updated_at').eq('key', key).maybeSingle();
    if (error) throw error;
    if (data && key.startsWith('league:')) leagueStamp = data.updated_at;
    return data ? data.value : null;
  } catch (e) {
    if (attempt < 1) return storGet(key, attempt + 1);
    console.error('storage.get failed', key, e);
    return null;
  }
}
async function storSet(key, value, attempt = 0) {
  try {
    const { error } = await supabase.from('kv_store').upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('storage.set failed', key, e);
    if (attempt < 2) { await new Promise(r => setTimeout(r, 250 * (attempt + 1))); return storSet(key, value, attempt + 1); }
    return false;
  }
}
async function storDelete(key) {
  try { const { error } = await supabase.from('kv_store').delete().eq('key', key); if (error) throw error; return true; }
  catch (e) { console.error('storage.delete failed', key, e); return false; }
}

async function loadList(key) { const raw = await storGet(key); if (!raw) return []; try { return JSON.parse(raw); } catch (e) { return []; } }
async function saveList(key, list) { await storSet(key, JSON.stringify(list)); }
async function loadObj(key) { const raw = await storGet(key); if (!raw) return null; try { return JSON.parse(raw); } catch (e) { return null; } }
async function saveObj(key, obj) {
  if (key.startsWith('league:')) {
    const ok = await saveLeagueChecked(key, JSON.stringify(obj));
    if (!ok) throw new LeagueRowConflict();
    return true;
  }
  return storSet(key, JSON.stringify(obj));
}

class LeagueRowConflict extends Error {
  constructor() {
    super('The league was changed somewhere else while this tab was open.');
    this.name = 'LeagueRowConflict';
  }
}

/* ==================================================================== */
/* Small UI atoms                                                        */
/* ==================================================================== */
function TabBtn({ active, onClick, label }) {
  return (
    <button onClick={onClick}
      className="font-head relative flex items-center gap-1.5 px-3 py-3 text-[12px] font-semibold uppercase tracking-wide transition-colors flex-shrink-0 whitespace-nowrap"
      style={{ color: active ? PRIMARY : CHALK_DIM }}>
      {label}
      <span className="absolute left-2 right-2 bottom-0 rounded-t" style={{ height: 2, background: active ? PRIMARY : 'transparent' }} />
    </button>
  );
}
function Panel({ children, className = '', style = {}, accent }) {
  return (
    <div className={`rounded-lg border overflow-hidden ${className}`} style={{ background: PANEL, borderColor: LINE, boxShadow: '0 1px 3px rgba(0,0,0,0.3)', ...style }}>
      {accent && <div style={{ height: 3, background: accent }} />}
      {children}
    </div>
  );
}
function SectionTitle({ children, right, accent = PRIMARY }) {
  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-2 gap-2">
      <h3 className="font-head flex items-center gap-2 text-sm font-semibold tracking-[0.1em] uppercase" style={{ color: accent }}>
        <span className="inline-block flex-shrink-0" style={{ width: 3, height: 13, background: accent, borderRadius: 1 }} />
        {children}
      </h3>
      {right}
    </div>
  );
}
function NumInput({ value, onChange, w = 'w-14', min, max, step = 1, allowDecimal = false, disabled = false }) {
  const [draft, setDraft] = useState(String(value ?? ''));
  useEffect(() => { setDraft(String(value ?? '')); }, [value]);
  const commit = () => {
    let n = allowDecimal ? parseFloat(draft) : parseInt(draft, 10);
    if (Number.isNaN(n)) n = Number(value) || 0;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setDraft(String(n));
    onChange(n);
  };
  return (
    <input type="number" inputMode={allowDecimal ? 'decimal' : 'numeric'} step={step} value={draft} disabled={disabled}
      onChange={e => setDraft(e.target.value)} onFocus={e => e.target.select()} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
      className={`${w} bg-[#242424] border rounded px-1.5 py-1 text-center text-sm font-mono disabled:opacity-50`}
      style={{ borderColor: LINE, color: CHALK }} />
  );
}
function activityIcon(type) {
  switch (type) {
    case 'suspend': return <AlertTriangle size={13} style={{ color: NEGATIVE, flexShrink: 0 }} />;
    case 'unsuspend': return <Check size={13} style={{ color: WIN, flexShrink: 0 }} />;
    case 'ban': return <Ban size={13} style={{ color: NEGATIVE, flexShrink: 0 }} />;
    case 'unban': return <Check size={13} style={{ color: WIN, flexShrink: 0 }} />;
    case 'add': return <Plus size={13} style={{ color: WIN, flexShrink: 0 }} />;
    case 'remove': return <Trash2 size={13} style={{ color: NEGATIVE, flexShrink: 0 }} />;
    case 'trade': return <RefreshCw size={13} style={{ color: PRIMARY, flexShrink: 0 }} />;
    case 'rebrand': return <Sparkles size={13} style={{ color: GOLD, flexShrink: 0 }} />;
    default: return null;
  }
}
function ActivityRow({ a, teamsById, onRemove }) {
  const team = a.teamId ? teamsById[a.teamId] : null;
  const toTeam = a.toTeamId ? teamsById[a.toTeamId] : null;
  return (
    <div className="flex items-center gap-2 px-2 py-2 text-sm" style={{ borderTop: `1px solid ${LINE}`, color: CHALK }}>
      {activityIcon(a.type)}
      {team && <TeamMark team={team} size={16} />}
      {toTeam && <><span style={{ color: CHALK_DIM }}>→</span><TeamMark team={toTeam} size={16} /></>}
      <span className="flex-1 min-w-0">{a.text}</span>
      <span className="text-[10px] flex-shrink-0" style={{ color: CHALK_DIM }}>{a.at ? new Date(a.at).toLocaleDateString() : ''}</span>
      {onRemove && (
        <button onClick={() => { if (confirm('Remove this activity entry?')) onRemove(a.id); }} className="p-1 rounded flex-shrink-0" style={{ color: CHALK_DIM }}><Trash2 size={13} /></button>
      )}
    </div>
  );
}
function TeamMark({ team, size = 22 }) {
  const color = teamColor(team);
  if (team.logoUrl) return <img src={team.logoUrl} alt="" style={{ width: size, height: size, objectFit: 'contain', borderRadius: 6, flexShrink: 0, boxShadow: `0 0 0 2px ${color}` }} />;
  return <span className="inline-block rounded-full flex-shrink-0" style={{ width: Math.round(size * 0.6), height: Math.round(size * 0.6), background: color, boxShadow: `0 0 0 2px ${color}55` }} />;
}
// Same fallback pattern as TeamMark: a custom-uploaded image when a badge
// def has one, otherwise the emoji/text icon it was created with.
function BadgeIcon({ badge, size = 16 }) {
  if (badge && badge.imageUrl) return <img src={badge.imageUrl} alt="" className="rounded-full object-cover flex-shrink-0" style={{ width: size, height: size }} />;
  return <span className="flex-shrink-0" style={{ fontSize: size }}>{badge && badge.icon}</span>;
}
function TeamAccentCell({ team, children, className = '' }) {
  return <td className={className} style={{ borderLeft: `3px solid ${teamColor(team)}` }}>{children}</td>;
}
function StatBox({ label, value, color = CHALK }) {
  return (
    <div className="p-3" style={{ background: PANEL }}>
      <div className="text-[9px] font-bold uppercase tracking-wide" style={{ color: CHALK_DIM }}>{label}</div>
      <div className="text-xl font-mono font-black tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}
function MoveIndicator({ delta }) {
  if (delta == null || delta === 0) return <span style={{ color: CHALK_DIM }}>–</span>;
  if (delta > 0) return <span style={{ color: WIN }}>▲{delta}</span>;
  return <span style={{ color: NEGATIVE }}>▼{Math.abs(delta)}</span>;
}
function ClinchBadge({ symbol }) {
  const color = symbol === 'z' ? NEGATIVE : symbol === 'y' ? GOLD : WIN;
  return <sup className="font-mono font-bold" style={{ color, fontSize: '10px' }}>{symbol}</sup>;
}

/* ==================================================================== */
/* Bracket ("if the playoffs started today")                             */
/* ==================================================================== */
function MatchRow({ seed, team, bye, placeholder, score, isWinner, isDecided, odds }) {
  const color = team ? teamColor(team) : null;
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-xs" style={{ background: isWinner ? 'rgba(45,212,191,0.12)' : PANEL2, borderBottom: `1px solid ${LINE}`, borderLeft: color ? `3px solid ${color}` : undefined }}>
      {placeholder ? <span style={{ color: CHALK_DIM }}>TBD</span> : (
        <>
          {seed != null && <span className="font-mono w-4 flex-shrink-0" style={{ color: CHALK_DIM }}>{seed}</span>}
          {team && !bye ? <TeamMark team={team} size={14} /> : null}
          <span className="flex-1 truncate" style={{ color: bye ? CHALK_DIM : (isWinner ? WIN : CHALK) }}>{bye ? 'BYE' : (team ? (team.displayName || team.name || 'TBD') : 'TBD')}</span>
          {odds != null && !bye && <span className="font-mono flex-shrink-0 text-[10px]" style={{ color: odds >= 50 ? WIN : CHALK_DIM }}>{odds.toFixed(0)}%</span>}
          {score != null && !bye && <span className="font-mono flex-shrink-0" style={{ color: isWinner ? WIN : CHALK_DIM }}>{score}</span>}
        </>
      )}
    </div>
  );
}

function SeriesMatchCard({ slotGames, teamsById, winsNeeded, seriesLength, standingsById, h2hMatrix, homeFieldBoost, onOpenCompare }) {
  if (!slotGames || slotGames.length === 0) return <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${LINE}`, opacity: 0.5 }}><MatchRow placeholder /><MatchRow placeholder /></div>;
  if (slotGames.length === 1 && slotGames[0].isBye) {
    const home = teamsById[slotGames[0].homeTeamId];
    return <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${LINE}` }}><MatchRow team={home} isWinner /><MatchRow bye /></div>;
  }
  const higherSeedId = slotGames[0].higherSeedId || slotGames[0].homeTeamId;
  const teamIds = new Set();
  slotGames.forEach(g => { if (g.homeTeamId) teamIds.add(g.homeTeamId); if (g.awayTeamId) teamIds.add(g.awayTeamId); });
  const lowerSeedId = [...teamIds].find(id => id !== higherSeedId);
  const wins = {};
  teamIds.forEach(id => { wins[id] = 0; });
  slotGames.forEach(g => {
    if (!g.played) return;
    const w = gameWinner(g);
    const wid = w === 'home' ? g.homeTeamId : w === 'away' ? g.awayTeamId : null;
    if (wid != null) wins[wid] = (wins[wid] || 0) + 1;
  });
  const decided = [...teamIds].find(id => wins[id] >= winsNeeded);
  const higherTeam = teamsById[higherSeedId], lowerTeam = teamsById[lowerSeedId];
  const showSeriesScore = winsNeeded > 1;
  // Live series odds: simulate out the remaining games of THIS series
  // specifically (respecting its actual configured length and current
  // progress), rather than a flat single-game probability.
  let higherOdds = null, lowerOdds = null;
  if (!decided && standingsById && standingsById[higherSeedId] && standingsById[lowerSeedId]) {
    higherOdds = simulateSeriesOdds(higherSeedId, lowerSeedId, standingsById, h2hMatrix, seriesLength, homeFieldBoost, wins[higherSeedId] || 0, wins[lowerSeedId] || 0, higherSeedId, 400);
    lowerOdds = 100 - higherOdds;
  }
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
      <MatchRow team={higherTeam} score={showSeriesScore ? (wins[higherSeedId] || 0) : null} isWinner={decided === higherSeedId} odds={higherOdds} />
      <MatchRow team={lowerTeam} score={showSeriesScore ? (wins[lowerSeedId] || 0) : null} isWinner={decided === lowerSeedId} odds={lowerOdds} />
      {onOpenCompare && higherTeam && lowerTeam && (
        <button onClick={() => onOpenCompare(higherSeedId, lowerSeedId)} className="w-full flex items-center justify-center gap-1 py-1 text-[10px] font-semibold" style={{ background: PANEL, color: PRIMARY, borderTop: `1px solid ${LINE}` }}>
          <BarChart3 size={11} /> Compare
        </button>
      )}
    </div>
  );
}

function PlayInBracket({ standings, settings, playInGames, teamsById, onStart, onClear, onOpenTeam, onOpenCompare }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageSeasons');
  const playInTeams = settings.playInTeams || 0;
  if (playInTeams < 2) return null;
  const hasPlayIn = playInGames.length > 0;
  const bubble = standings.slice(Math.max(0, settings.playoffSpots - 1), Math.max(0, settings.playoffSpots - 1) + playInTeams);
  const bracketSize = nextPow2(bubble.length);
  const roundsCount = bubble.length >= 2 ? Math.log2(bracketSize) : 0;
  const maxRound = hasPlayIn ? Math.max(...playInGames.map(g => g.playInRound)) : 0;
  const winnerId = getPlayInWinner(playInGames);
  const winner = winnerId ? teamsById[winnerId] : null;

  if (bubble.length < 2 && !hasPlayIn) {
    return <Panel><SectionTitle>Play-in tournament</SectionTitle><p className="px-4 pb-3 text-sm" style={{ color: CHALK_DIM }}>Not enough bubble teams yet for a play-in bracket.</p></Panel>;
  }

  return (
    <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
      <SectionTitle accent={GOLD} right={
        !hasPlayIn ? (
          isLoggedIn && <button onClick={onStart} disabled={bubble.length < 2} className="text-[11px] font-bold flex items-center gap-1 disabled:opacity-40" style={{ color: PRIMARY }}><Crown size={12} /> Generate play-in</button>
        ) : (
          isLoggedIn && <button onClick={() => { if (confirm('Clear the play-in bracket? Scores already entered will be lost.')) onClear(); }} className="text-[11px] font-semibold" style={{ color: NEGATIVE }}>Clear play-in</button>
        )
      }>Play-in tournament</SectionTitle>
      {winner && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-bold" style={{ background: 'rgba(245,198,75,0.12)', color: GOLD }}>
          <Crown size={15} /> {winner.name || winner.displayName} won the play-in and takes the final playoff spot!
        </div>
      )}
      <div className="px-4 pb-2 overflow-x-auto">
        <div className="flex gap-6" style={{ minWidth: roundsCount * 170 }}>
          {Array.from({ length: roundsCount }).map((_, ri) => {
            const round = ri + 1;
            const roundGames = hasPlayIn ? playInGames.filter(g => g.playInRound === round) : [];
            const slotsInRound = bracketSize / Math.pow(2, round);
            return (
              <div key={ri} className="flex flex-col justify-around gap-3 flex-shrink-0" style={{ minWidth: 150 }}>
                <div className="text-[10px] uppercase font-bold mb-1" style={{ color: PRIMARY }}>{round === 1 ? 'Round 1' : `Round ${round}`}</div>
                {round === 1 && !hasPlayIn ? Array.from({ length: slotsInRound }).map((_, idx) => {
                  const s1 = idx * 2 + 1, s2 = idx * 2 + 2;
                  const t1 = s1 <= bubble.length ? bubble[s1 - 1] : null, t2 = s2 <= bubble.length ? bubble[s2 - 1] : null;
                  return (
                    <div key={idx} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
                      <MatchRow seed={settings.playoffSpots + s1 - 1} team={t1} bye={!t1} />
                      <MatchRow seed={t2 ? settings.playoffSpots + s2 - 1 : null} team={t2} bye={!t2} />
                    </div>
                  );
                }) : round <= maxRound ? Array.from({ length: slotsInRound }).map((_, idx) => {
                  const g = roundGames.find(gg => gg.bracketSlot === idx);
                  if (!g) return <div key={idx} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${LINE}`, opacity: 0.5 }}><MatchRow placeholder /><MatchRow placeholder /></div>;
                  const home = g.homeTeamId ? teamsById[g.homeTeamId] : null, away = g.awayTeamId ? teamsById[g.awayTeamId] : null;
                  const homeWin = g.played && gameWinner(g) === 'home', awayWin = g.played && gameWinner(g) === 'away';
                  return (
                    <div key={idx} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
                      <MatchRow team={home} score={g.played ? g.homeScore : null} isWinner={homeWin} />
                      <MatchRow team={away} bye={g.isBye} score={g.played && !g.isBye ? g.awayScore : null} isWinner={awayWin} />
                      {onOpenCompare && home && away && !g.isBye && (
                        <button onClick={() => onOpenCompare(g.homeTeamId, g.awayTeamId)} className="w-full flex items-center justify-center gap-1 py-1 text-[10px] font-semibold" style={{ background: PANEL, color: PRIMARY, borderTop: `1px solid ${LINE}` }}>
                          <BarChart3 size={11} /> Compare
                        </button>
                      )}
                    </div>
                  );
                }) : Array.from({ length: slotsInRound }).map((_, idx) => (
                  <div key={idx} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${LINE}`, opacity: 0.5 }}><MatchRow placeholder /><MatchRow placeholder /></div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>
        {hasPlayIn ? 'Score play-in games from the Schedule tab.' : `Seeded from teams ranked #${settings.playoffSpots} through #${settings.playoffSpots + playInTeams - 1} in the standings.`}
      </p>
    </Panel>
  );
}

function BracketView({ standings, settings, playoffGames, teamsById, onStart, onClear, onOpenTeam, h2hMatrix, onOpenCompare }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageSeasons');
  const playoffSpots = settings.playoffSpots;
  const n = Math.min(playoffSpots, standings.length);
  const hasPlayoffs = playoffGames.length > 0;
  const roundsCount = n >= 2 ? Math.log2(nextPow2(n)) : 0;
  const standingsById = useMemo(() => { const m = {}; standings.forEach(t => { m[t.id] = t; }); return m; }, [standings]);

  if (n < 2 && !hasPlayoffs) {
    return <Panel><SectionTitle>Playoffs</SectionTitle>
      <p className="px-4 pb-3 text-sm" style={{ color: CHALK_DIM }}>Need at least 2 teams and 2 playoff spots to build a bracket.</p></Panel>;
  }

  let previewRound1 = [];
  if (!hasPlayoffs) {
    const seeds = standings.slice(0, n);
    const bracketSize = nextPow2(n);
    const order = seedOrder(bracketSize);
    for (let i = 0; i < order.length; i += 2) {
      const s1 = order[i], s2 = order[i + 1];
      previewRound1.push({ s1, t1: s1 <= n ? seeds[s1 - 1] : null, s2, t2: s2 <= n ? seeds[s2 - 1] : null });
    }
  }

  const maxGeneratedRound = hasPlayoffs ? Math.max(...playoffGames.map(g => g.playoffRound)) : 0;
  let champion = null;
  if (hasPlayoffs && maxGeneratedRound === roundsCount) {
    const finalWinsNeeded = seriesWinsNeeded(getSeriesLength(settings, roundsCount));
    const finalGames = playoffGames.filter(g => g.playoffRound === roundsCount);
    const teamIds = new Set();
    finalGames.forEach(g => { if (g.homeTeamId) teamIds.add(g.homeTeamId); if (g.awayTeamId) teamIds.add(g.awayTeamId); });
    const wins = {};
    teamIds.forEach(id => { wins[id] = 0; });
    finalGames.forEach(g => {
      if (!g.played) return;
      const w = gameWinner(g);
      const wid = w === 'home' ? g.homeTeamId : w === 'away' ? g.awayTeamId : null;
      if (wid != null) wins[wid] = (wins[wid] || 0) + 1;
    });
    const decidedId = [...teamIds].find(id => wins[id] >= finalWinsNeeded) || (finalGames.length === 1 && finalGames[0].isBye ? finalGames[0].homeTeamId : null);
    if (decidedId) champion = teamsById[decidedId];
  }

  return (
    <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
      <SectionTitle accent={GOLD} right={
        !hasPlayoffs ? (
          isLoggedIn && <button onClick={onStart} disabled={n < 2} className="text-[11px] font-bold flex items-center gap-1 disabled:opacity-40" style={{ color: PRIMARY }}><Crown size={12} /> Generate bracket</button>
        ) : (
          isLoggedIn && <button onClick={() => { if (confirm('Clear the generated playoff bracket? Scores already entered will be lost.')) onClear(); }} className="text-[11px] font-semibold" style={{ color: NEGATIVE }}>Clear bracket</button>
        )
      }>
        {hasPlayoffs ? 'Playoff bracket' : 'If the playoffs started today'}
      </SectionTitle>
      {champion && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-bold" style={{ background: 'rgba(245,198,75,0.12)', color: GOLD }}>
          <Crown size={15} /> {champion.name} won the playoffs!
        </div>
      )}
      <div className="px-4 pb-2 overflow-x-auto">
        <div className="flex gap-6" style={{ minWidth: roundsCount * 170 }}>
          {Array.from({ length: roundsCount }).map((_, ri) => {
            const round = ri + 1;
            const roundGames = hasPlayoffs ? playoffGames.filter(g => g.playoffRound === round) : [];
            const slotsInRound = nextPow2(n) / Math.pow(2, round);
            return (
              <div key={ri} className="flex flex-col justify-around gap-3 flex-shrink-0" style={{ minWidth: 150 }}>
                <div className="text-[10px] uppercase font-bold mb-1" style={{ color: PRIMARY }}>{getPlayoffRoundName(settings, round, roundsCount)} <span style={{ color: CHALK_DIM, textTransform: 'none' }}>(Bo{getSeriesLength(settings, round)})</span></div>
                {round === 1 && !hasPlayoffs ? previewRound1.map((m, idx) => (
                  <div key={idx} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
                    <MatchRow seed={m.s1} team={m.t1} bye={!m.t1} />
                    <MatchRow seed={m.s2} team={m.t2} bye={!m.t2} />
                  </div>
                )) : round <= maxGeneratedRound
                  ? Array.from({ length: slotsInRound }).map((_, idx) => (
                    <SeriesMatchCard key={idx} slotGames={roundGames.filter(gg => gg.bracketSlot === idx)} teamsById={teamsById} winsNeeded={seriesWinsNeeded(getSeriesLength(settings, round))} seriesLength={getSeriesLength(settings, round)} standingsById={standingsById} h2hMatrix={h2hMatrix} homeFieldBoost={settings.homeFieldBoost || 0} onOpenCompare={onOpenCompare} />
                  ))
                  : Array.from({ length: slotsInRound }).map((_, idx) => (
                    <div key={idx} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${LINE}`, opacity: 0.5 }}><MatchRow placeholder /><MatchRow placeholder /></div>
                  ))}
              </div>
            );
          })}
        </div>
      </div>
      <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>
        {hasPlayoffs
          ? 'Score playoff games from the Schedule tab — later rounds fill in automatically as each round finishes.'
          : `Seeded by current standings (${n} of ${playoffSpots} spot${playoffSpots === 1 ? '' : 's'} filled). Generating locks in the bracket and adds real games to your schedule.`}
      </p>
    </Panel>
  );
}

/* ==================================================================== */
/* Leagues screen                                                        */
/* ==================================================================== */
function LeaguesView({ index, onOpen, onCreate, onDelete, onRename, onRefresh, loadError, onOpenRegistry, onOpenAppearance }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageAdmins');
  const [newName, setNewName] = useState('');
  const [newSport, setNewSport] = useState('baseball');
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  return (
    <div className="p-3 space-y-3">
      {loadError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm" style={{ background: 'rgba(251,113,102,0.12)', color: NEGATIVE, border: `1px solid ${NEGATIVE}` }}>
          <AlertTriangle size={15} /> {loadError}
        </div>
      )}
      <button onClick={onOpenRegistry} className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold" style={{ background: PANEL, border: `1px solid ${LINE}`, color: CHALK }}>
        <span className="flex items-center gap-2"><Users size={16} style={{ color: PRIMARY }} /> Manage all teams</span>
        <ChevronRight size={16} style={{ color: CHALK_DIM }} />
      </button>
      <button onClick={onOpenAppearance} className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold" style={{ background: PANEL, border: `1px solid ${LINE}`, color: CHALK }}>
        <span className="flex items-center gap-2"><SettingsIcon size={16} style={{ color: PRIMARY }} /> Settings &amp; appearance</span>
        <ChevronRight size={16} style={{ color: CHALK_DIM }} />
      </button>
      <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
        <SectionTitle accent={PRIMARY}>Start a new league</SectionTitle>
        <div className="px-4 pb-3 space-y-2">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Riverside Rec League"
            className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
          <select value={newSport} onChange={e => setNewSport(e.target.value)} className="w-full bg-[#242424] border rounded px-2 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }}>
            {Object.entries(SPORT_PRESETS).map(([key, s]) => <option style={{ background: PANEL2, color: CHALK }} key={key} value={key}>{s.label}</option>)}
          </select>
          <button onClick={() => { if (newName.trim()) { onCreate(newName.trim(), newSport); setNewName(''); } }} disabled={!isLoggedIn}
            className="w-full px-3 py-2 rounded font-bold text-sm flex items-center justify-center gap-1 disabled:opacity-50" style={{ background: PRIMARY, color: INK }}>
            <Plus size={16} /> Create
          </button>
        </div>
      </Panel>
      <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
        <SectionTitle accent={PRIMARY} right={<button onClick={onRefresh} className="text-[11px] font-semibold flex items-center gap-1" style={{ color: CHALK_DIM }}><RefreshCw size={12} /> Refresh</button>}>
          Your leagues
        </SectionTitle>
        <div className="px-2 pb-3">
          {index.length === 0 && <p className="px-2 py-4 text-sm" style={{ color: CHALK_DIM }}>No leagues yet. Create one above to get started.</p>}
          {index.map(l => (
            <div key={l.id} className="flex items-center gap-2 px-2 py-2 rounded-lg" style={{ borderBottom: `1px solid ${LINE}` }}>
              {renamingId === l.id ? (
                <>
                  <input value={renameVal} onChange={e => setRenameVal(e.target.value)} className="flex-1 bg-[#242424] border rounded px-2 py-1 text-sm" style={{ borderColor: LINE, color: CHALK }} />
                  <button onClick={() => { onRename(l.id, renameVal.trim() || l.name); setRenamingId(null); }} disabled={!isLoggedIn} className="p-1.5 rounded disabled:opacity-50" style={{ color: PRIMARY }}><Check size={16} /></button>
                  <button onClick={() => setRenamingId(null)} className="p-1.5 rounded" style={{ color: CHALK_DIM }}><X size={16} /></button>
                </>
              ) : (
                <>
                  <button onClick={() => onOpen(l.id)} className="flex-1 text-left text-sm font-semibold flex items-center gap-2" style={{ color: CHALK }}>
                    <Folder size={15} style={{ color: PRIMARY }} /> {l.name}
                  </button>
                  {isLoggedIn && <button onClick={() => { setRenamingId(l.id); setRenameVal(l.name); }} className="p-1.5 rounded" style={{ color: CHALK_DIM }}><Pencil size={14} /></button>}
                  {isLoggedIn && <button onClick={() => { if (confirm(`Delete "${l.name}"? This cannot be undone.`)) onDelete(l.id); }} className="p-1.5 rounded" style={{ color: NEGATIVE }}><Trash2 size={14} /></button>}
                  <button onClick={() => onOpen(l.id)} className="p-1.5 rounded" style={{ color: PRIMARY }}><ChevronRight size={16} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ==================================================================== */
/* Global team registry + cross-league history                          */
/* ==================================================================== */
function BrandEditor({ gt, updateGlobalTeamField }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageRosters');
  const [busy, setBusy] = useState(null);
  const handleImage = async (field, file) => {
    if (!file) return;
    setBusy(field);
    try {
      const dataUrl = await resizeImageFile(file, field === 'wordmarkUrl' ? 260 : 160);
      if (dataUrl.length > 1_500_000) alert('That image is too large even after resizing — try a smaller file.');
      else updateGlobalTeamField(gt.id, field, dataUrl);
    } catch (e) { alert('Could not read that image file.'); }
    setBusy(null);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4 flex-wrap">
        <input type="color" value={gt.color || hashColor(gt.id)} disabled={!isLoggedIn} onChange={e => updateGlobalTeamField(gt.id, 'color', e.target.value)} className="w-8 h-8 rounded cursor-pointer bg-transparent flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed" style={{ border: `1px solid ${LINE}` }} />
        <input value={gt.abbr || ''} disabled={!isLoggedIn} onChange={e => updateGlobalTeamField(gt.id, 'abbr', e.target.value.toUpperCase().slice(0, 4))} placeholder={teamAbbr(gt)} maxLength={4} className="w-16 bg-[#242424] border rounded px-2 py-1.5 text-xs font-mono text-center uppercase disabled:opacity-50" style={{ borderColor: LINE, color: CHALK }} title="Abbreviation" />
        <div className="flex items-center gap-2">
          {gt.logoUrl ? <img src={gt.logoUrl} alt="" className="w-8 h-8 object-contain rounded" style={{ background: PANEL }} /> : <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: PANEL }}><ImageIcon size={14} style={{ color: CHALK_DIM }} /></div>}
          {isLoggedIn && (
            <label className="text-[11px] px-2 py-1 rounded cursor-pointer font-semibold" style={{ background: PANEL, color: PRIMARY, border: `1px solid ${LINE}` }}>
              {busy === 'logoUrl' ? 'Uploading…' : 'Logo'}
              <input type="file" accept="image/*" className="hidden" onChange={e => handleImage('logoUrl', e.target.files[0])} />
            </label>
          )}
          {isLoggedIn && gt.logoUrl && <button onClick={() => updateGlobalTeamField(gt.id, 'logoUrl', null)} className="text-[10px]" style={{ color: CHALK_DIM }}>remove</button>}
        </div>
        <div className="flex items-center gap-2">
          {gt.wordmarkUrl ? <img src={gt.wordmarkUrl} alt="" className="h-8 max-w-[100px] object-contain rounded" style={{ background: PANEL }} /> : <div className="w-14 h-8 rounded flex items-center justify-center" style={{ background: PANEL }}><ImageIcon size={14} style={{ color: CHALK_DIM }} /></div>}
          {isLoggedIn && (
            <label className="text-[11px] px-2 py-1 rounded cursor-pointer font-semibold" style={{ background: PANEL, color: PRIMARY, border: `1px solid ${LINE}` }}>
              {busy === 'wordmarkUrl' ? 'Uploading…' : 'Wordmark'}
              <input type="file" accept="image/*" className="hidden" onChange={e => handleImage('wordmarkUrl', e.target.files[0])} />
            </label>
          )}
          {isLoggedIn && gt.wordmarkUrl && <button onClick={() => updateGlobalTeamField(gt.id, 'wordmarkUrl', null)} className="text-[10px]" style={{ color: CHALK_DIM }}>remove</button>}
        </div>
      </div>
    </div>
  );
}

function TeamRegistryView({ teamsIndex, teamsById, onBack, onCreate, onOpenHistory, updateGlobalTeamField, onSyncTeams }) {
  const { hasPermission, role } = useAuth();
  const isLoggedIn = hasPermission('manageRosters');
  // Creating a brand-new global team (as opposed to editing/branding an
  // existing one, which any roster-managing admin can already do below) is
  // restricted to the Site Owner — the registry is shared across every
  // league on the site, so who's allowed to add new entries to it is kept
  // tighter than who can manage a single season's rosters.
  const canCreate = role === 'site_owner';
  const [name, setName] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const runSync = async () => {
    setSyncing(true);
    try { setSyncResult(await onSyncTeams()); } finally { setSyncing(false); }
  };
  return (
    <div className="p-3 space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm" style={{ color: CHALK_DIM }}><ArrowLeft size={14} /> Back</button>
      {canCreate && (
      <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
        <SectionTitle accent={PRIMARY}>Create a team</SectionTitle>
        <div className="flex gap-2 px-4 pb-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Team name" className="flex-1 bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
          <button onClick={() => { if (name.trim()) { onCreate(name.trim()); setName(''); } }} className="px-3 py-2 rounded font-bold text-sm flex items-center gap-1" style={{ background: PRIMARY, color: INK }}>
            <Plus size={16} /> Add
          </button>
        </div>
        <p className="px-4 pb-3 text-xs" style={{ color: CHALK_DIM }}>Site Owner only. Teams created here can be added to any season of any league, keep their colors and logos everywhere they're used, and keep one history across all of them.</p>
      </Panel>
      )}
      {canCreate && (
      <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
        <SectionTitle accent={GOLD}>Sync teams from seasons</SectionTitle>
        <div className="px-4 pb-3 space-y-2">
          <p className="text-xs" style={{ color: CHALK_DIM }}>Makes sure every team that's ever played a current or past season is in this registry, and merges any duplicates (e.g. two entries for the same team created by an import) into one — the merged team's seasons, games, awards and credits all move to the survivor, so its History shows everything it actually played.</p>
          <button onClick={runSync} disabled={syncing} className="px-3 py-2 rounded font-bold text-sm disabled:opacity-50" style={{ background: GOLD, color: INK }}>{syncing ? 'Syncing…' : 'Sync now'}</button>
          {syncResult && (
            <div className="text-xs space-y-1 pt-1" style={{ color: CHALK }}>
              <p>Added {syncResult.added} team{syncResult.added === 1 ? '' : 's'} to the registry.</p>
              {syncResult.merged.length > 0 && <p>Merged duplicates for: {syncResult.merged.join(', ')}.</p>}
              {syncResult.skipped.length > 0 && <p style={{ color: GOLD }}>Left alone (two teams share this name within the same season, so they weren't merged): {syncResult.skipped.join(', ')}.</p>}
              {syncResult.added === 0 && syncResult.merged.length === 0 && syncResult.skipped.length === 0 && <p style={{ color: CHALK_DIM }}>Nothing to do — the registry is already in sync.</p>}
            </div>
          )}
        </div>
      </Panel>
      )}
      <TeamRegistryFolders teamsIndex={teamsIndex} teamsById={teamsById} isLoggedIn={isLoggedIn} onOpenHistory={onOpenHistory} updateGlobalTeamField={updateGlobalTeamField} />
    </div>
  );
}

function TeamRegistryCard({ gt, isLoggedIn, onOpenHistory, updateGlobalTeamField, folderNames }) {
  return (
    <div className="rounded-lg p-3" style={{ background: PANEL2, border: `1px solid ${LINE}`, borderLeft: `4px solid ${teamColor(gt)}` }}>
      <div className="flex items-center gap-2 mb-2">
        <input value={gt.name} onChange={e => updateGlobalTeamField(gt.id, 'name', e.target.value)} disabled={!isLoggedIn} className="flex-1 min-w-0 bg-[#242424] border rounded px-2 py-1 text-sm font-semibold disabled:opacity-50" style={{ borderColor: LINE, color: CHALK }} />
        <button onClick={() => onOpenHistory(gt.id)} className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded flex-shrink-0" style={{ background: PANEL, color: PRIMARY, border: `1px solid ${LINE}` }}>
          <History size={13} /> History
        </button>
      </div>
      <BrandEditor gt={gt} updateGlobalTeamField={updateGlobalTeamField} />
      {isLoggedIn && (
        <div className="mt-2 flex items-center gap-1.5">
          <Folder size={12} style={{ color: CHALK_DIM, flexShrink: 0 }} />
          <input value={gt.folder || ''} onChange={e => updateGlobalTeamField(gt.id, 'folder', e.target.value || null)} list="team-folder-names" placeholder="No folder" className="flex-1 min-w-0 bg-[#242424] border rounded px-2 py-1 text-xs" style={{ borderColor: LINE, color: CHALK_DIM }} />
          {gt.folder && <button onClick={() => updateGlobalTeamField(gt.id, 'folder', null)} className="text-[11px] flex-shrink-0" style={{ color: CHALK_DIM }}>Clear</button>}
        </div>
      )}
    </div>
  );
}

// Teams can be sorted into free-form folders (e.g. by league, region, tier)
// so the registry doesn't stay one giant flat list as it grows — purely
// organizational, doesn't affect anything outside this page. Grouping only
// kicks in once at least one team actually has a folder set; until then this
// renders exactly like the old flat list.
function TeamRegistryFolders({ teamsIndex, teamsById, isLoggedIn, onOpenHistory, updateGlobalTeamField }) {
  const teams = teamsIndex.map(t => teamsById[t.id] || { id: t.id, name: t.name, color: null, logoUrl: null, wordmarkUrl: null });
  const folderNames = [...new Set(teams.map(t => t.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const cardProps = { isLoggedIn, onOpenHistory, updateGlobalTeamField, folderNames };

  if (folderNames.length === 0) {
    return (
      <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
        <SectionTitle accent={PRIMARY}>All teams ({teams.length})</SectionTitle>
        <div className="px-3 pb-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          {teams.length === 0 && <p className="px-1 py-4 text-sm" style={{ color: CHALK_DIM }}>No teams yet.</p>}
          {teams.map(gt => <TeamRegistryCard key={gt.id} gt={gt} {...cardProps} />)}
        </div>
        <datalist id="team-folder-names" />
      </Panel>
    );
  }

  const unfiled = teams.filter(t => !t.folder);
  return (
    <div className="space-y-3">
      <datalist id="team-folder-names">{folderNames.map(f => <option key={f} value={f} />)}</datalist>
      {folderNames.map(folder => {
        const inFolder = teams.filter(t => t.folder === folder);
        return (
          <Panel key={folder} className="overflow-hidden" style={{ borderColor: PRIMARY }}>
            <SectionTitle accent={PRIMARY}><span className="flex items-center gap-1.5"><Folder size={14} /> {folder} ({inFolder.length})</span></SectionTitle>
            <div className="px-3 pb-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              {inFolder.map(gt => <TeamRegistryCard key={gt.id} gt={gt} {...cardProps} />)}
            </div>
          </Panel>
        );
      })}
      <Panel className="overflow-hidden" style={{ borderColor: LINE }}>
        <SectionTitle>Unfiled ({unfiled.length})</SectionTitle>
        <div className="px-3 pb-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          {unfiled.length === 0 && <p className="px-1 py-4 text-sm" style={{ color: CHALK_DIM }}>Every team is in a folder.</p>}
          {unfiled.map(gt => <TeamRegistryCard key={gt.id} gt={gt} {...cardProps} />)}
        </div>
      </Panel>
    </div>
  );
}

function TeamHistoryPage({ team, history, onBack, loading }) {
  const totalW = history.reduce((s, h) => s + (h.w || 0), 0);
  const totalL = history.reduce((s, h) => s + (h.l || 0), 0);
  const totalGp = totalW + totalL;
  const championships = history.filter(h => h.champion).length;
  return (
    <div className="p-3 space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm" style={{ color: CHALK_DIM }}><ArrowLeft size={14} /> Back</button>
      <Panel>
        <div className="p-4 flex items-center gap-4" style={{ borderBottom: `1px solid ${LINE}` }}>
          {team?.logoUrl ? <img src={team.logoUrl} alt="" className="w-14 h-14 object-contain flex-shrink-0" /> : <div className="w-14 h-14 rounded-xl flex-shrink-0" style={{ background: team ? teamColor(team) : LINE }} />}
          <h2 className="text-xl font-black truncate" style={{ color: CHALK }}>{team ? team.name : '...'}</h2>
        </div>
        {!loading && history.length > 0 && (
          <div className="grid grid-cols-3 gap-px" style={{ background: LINE }}>
            <StatBox label="All-Time Record" value={`${totalW}-${totalL}`} />
            <StatBox label="Win %" value={totalGp > 0 ? (totalW / totalGp).toFixed(3).replace(/^0/, '') : '—'} />
            <StatBox label="Championships" value={championships} color={championships > 0 ? GOLD : CHALK} />
          </div>
        )}
        <div className="px-2 pb-3">
          {loading && <p className="px-2 py-4 text-sm" style={{ color: CHALK_DIM }}>Loading history…</p>}
          {!loading && history.length === 0 && <p className="px-2 py-4 text-sm" style={{ color: CHALK_DIM }}>This team hasn't played in any season yet.</p>}
          {!loading && history.map((h, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-2.5 text-sm" style={{ borderBottom: `1px solid ${LINE}` }}>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate" style={{ color: CHALK }}>{h.leagueName} — {h.seasonName}</div>
                <div className="text-xs font-mono" style={{ color: CHALK_DIM }}>{h.record} {h.rank ? `· #${h.rank} finish` : ''}</div>
                {h.managerName && <div className="text-[11px]" style={{ color: CHALK_DIM }}>Managed by {h.managerName}</div>}
              </div>
              {h.champion && <span className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded flex-shrink-0" style={{ background: 'rgba(245,198,75,0.15)', color: GOLD }}><Crown size={12} /> Champion</span>}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ==================================================================== */
/* Seasons management                                                    */
/* ==================================================================== */
function SeasonsView({ league, viewingSeasonId, onBack, onSwitch, onSetDefault, onCreate, onRename, onDelete, onSetChampion, onSetPublic, teamsById, onSetLogo }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageSeasons');
  const [newName, setNewName] = useState('');
  const [copyRoster, setCopyRoster] = useState(true);
  const [tournamentMode, setTournamentMode] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const [champPickerId, setChampPickerId] = useState(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const handleLogoFile = async (file) => {
    if (!file) return;
    setLogoBusy(true);
    try {
      const dataUrl = await resizeImageFile(file, 320);
      if (dataUrl.length > 1_500_000) alert('That image is too large even after resizing — try a smaller file.');
      else onSetLogo(dataUrl);
    } catch (e) { alert('Could not read that image file.'); }
    setLogoBusy(false);
  };

  return (
    <div className="p-3 space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm" style={{ color: CHALK_DIM }}><ArrowLeft size={14} /> Back</button>
      <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
        <SectionTitle accent={PRIMARY}>League logo</SectionTitle>
        <div className="px-4 pb-3 flex items-center gap-3">
          {league.logoUrl ? <img src={league.logoUrl} alt="" className="w-14 h-14 object-contain rounded-lg" style={{ background: PANEL2, border: `1px solid ${LINE}` }} /> : <div className="w-14 h-14 rounded-lg flex items-center justify-center" style={{ background: PANEL2, border: `1px solid ${LINE}` }}><Trophy size={22} style={{ color: CHALK_DIM }} /></div>}
          {isLoggedIn && (
            <div className="flex items-center gap-2">
              <label className="text-[11px] px-3 py-2 rounded cursor-pointer font-semibold" style={{ background: PANEL2, color: PRIMARY, border: `1px solid ${LINE}` }}>
                {logoBusy ? 'Uploading…' : league.logoUrl ? 'Change logo' : 'Upload logo'}
                <input type="file" accept="image/*" className="hidden" onChange={e => handleLogoFile(e.target.files[0])} />
              </label>
              {league.logoUrl && <button onClick={() => onSetLogo(null)} className="text-[11px]" style={{ color: CHALK_DIM }}>Remove</button>}
            </div>
          )}
        </div>
      </Panel>
      {isLoggedIn && (
        <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
          <SectionTitle accent={PRIMARY}>Start a new season</SectionTitle>
          <div className="px-4 pb-3 space-y-2">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. 2026 Fall Season" className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
            <label className="flex items-center gap-2 text-xs" style={{ color: CHALK_DIM }}>
              <input type="checkbox" checked={copyRoster} onChange={e => setCopyRoster(e.target.checked)} style={{ accentColor: PRIMARY }} /> Bring over teams from the current season (stats reset to 0)
            </label>
            <label className="flex items-center gap-2 text-xs" style={{ color: CHALK_DIM }}>
              <input type="checkbox" checked={tournamentMode} onChange={e => setTournamentMode(e.target.checked)} style={{ accentColor: PRIMARY }} /> WBC-style tournament (divisions as pool-play groups feeding a knockout stage — set up divisions after creating, in the Teams tab. Also marks this as a tournament season, so its stats show on player pages without folding into career totals — toggle later in Settings if needed)
            </label>
            <button onClick={() => { if (newName.trim()) { onCreate(newName.trim(), copyRoster, tournamentMode); setNewName(''); setTournamentMode(false); } }} className="px-3 py-2 rounded font-bold text-sm flex items-center gap-1" style={{ background: PRIMARY, color: INK }}>
              <Plus size={16} /> Create season
            </button>
          </div>
        </Panel>
      )}
      <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
        <SectionTitle accent={PRIMARY}>Seasons &amp; champions</SectionTitle>
        <div className="px-2 pb-3">
          {league.seasons.map(s => {
            const champ = s.championTeamId ? teamsById[s.championTeamId] : null;
            const isActive = s.id === league.activeSeasonId;
            const isViewing = s.id === (viewingSeasonId || league.activeSeasonId);
            const isPublic = s.public !== false;
            return (
              <div key={s.id} className="px-2 py-2.5" style={{ borderBottom: `1px solid ${LINE}` }}>
                {renamingId === s.id ? (
                  <div className="flex items-center gap-2">
                    <input value={renameVal} onChange={e => setRenameVal(e.target.value)} className="flex-1 bg-[#242424] border rounded px-2 py-1 text-sm" style={{ borderColor: LINE, color: CHALK }} />
                    <button onClick={() => { onRename(s.id, renameVal.trim() || s.name); setRenamingId(null); }} disabled={!isLoggedIn} className="p-1.5 rounded disabled:opacity-50" style={{ color: PRIMARY }}><Check size={16} /></button>
                    <button onClick={() => setRenamingId(null)} className="p-1.5 rounded" style={{ color: CHALK_DIM }}><X size={16} /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold flex items-center gap-2" style={{ color: isViewing ? PRIMARY : CHALK }}>
                        {s.name} {isActive && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded" style={{ background: PRIMARY, color: INK }}>Current</span>}
                        {isViewing && !isActive && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded" style={{ background: PANEL2, color: PRIMARY, border: `1px solid ${PRIMARY}` }}>Viewing</span>}
                        {!isPublic && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: PANEL2, color: CHALK_DIM, border: `1px solid ${LINE}` }}><EyeOff size={10} /> Private</span>}
                      </div>
                      {champ && <div className="text-xs flex items-center gap-1 mt-0.5" style={{ color: GOLD }}><Crown size={11} /> {champ.name}</div>}
                    </div>
                    {!isViewing && <button onClick={() => onSwitch(s.id)} className="text-[11px] font-bold px-2 py-1 rounded" style={{ background: PANEL2, color: PRIMARY, border: `1px solid ${LINE}` }}>Switch</button>}
                    {isLoggedIn && !isActive && <button onClick={() => onSetDefault(s.id)} title="Make this the default season everyone sees" className="text-[11px] font-bold px-2 py-1 rounded" style={{ background: PANEL2, color: GOLD, border: `1px solid ${LINE}` }}>Make current</button>}
                    {isLoggedIn && <button onClick={() => onSetPublic(s.id, !isPublic)} title={isPublic ? 'Make private' : 'Make public'} className="p-1.5 rounded" style={{ color: isPublic ? CHALK_DIM : GOLD }}>{isPublic ? <Eye size={14} /> : <EyeOff size={14} />}</button>}
                    {isLoggedIn && <button onClick={() => setChampPickerId(champPickerId === s.id ? null : s.id)} className="p-1.5 rounded" style={{ color: GOLD }}><Crown size={14} /></button>}
                    {isLoggedIn && <button onClick={() => { setRenamingId(s.id); setRenameVal(s.name); }} className="p-1.5 rounded" style={{ color: CHALK_DIM }}><Pencil size={14} /></button>}
                    {isLoggedIn && <button onClick={() => { if (confirm(`Delete season "${s.name}"? This cannot be undone.`)) onDelete(s.id); }} className="p-1.5 rounded" style={{ color: NEGATIVE }}><Trash2 size={14} /></button>}
                  </div>
                )}
                {champPickerId === s.id && isLoggedIn && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {s.members.map(m => {
                      const t = teamsById[m.teamId];
                      return <button key={m.teamId} onClick={() => { onSetChampion(s.id, m.teamId); setChampPickerId(null); }} className="text-xs px-2 py-1 rounded" style={{ background: PANEL2, color: CHALK, border: `1px solid ${LINE}` }}>{t ? t.name : m.scheduleName}</button>;
                    })}
                    <button onClick={() => { onSetChampion(s.id, null); setChampPickerId(null); }} className="text-xs px-2 py-1 rounded" style={{ color: CHALK_DIM }}>Clear</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

/* ==================================================================== */
/* Home / round view                                                     */
/* ==================================================================== */
function ChampionBanner({ team }) {
  if (!team) return null;
  const emojis = ['🎉', '🏆', '🎊', '⭐', '🎉', '🏆', '🎊'];
  return (
    <div className="relative overflow-hidden rounded-xl p-5 text-center" style={{ background: `linear-gradient(135deg, ${GOLD}33, ${PANEL})`, border: `2px solid ${GOLD}` }}>
      <style>{`@keyframes lt-confetti-fall { 0% { transform: translateY(-14px) rotate(0deg); opacity: 1; } 100% { transform: translateY(70px) rotate(360deg); opacity: 0; } }`}</style>
      {emojis.map((e, i) => (
        <span key={i} style={{ position: 'absolute', left: `${8 + i * 13}%`, top: 0, fontSize: 18, animation: `lt-confetti-fall 2.4s ease-in ${i * 0.18}s infinite` }}>{e}</span>
      ))}
      <Crown size={30} style={{ color: GOLD, margin: '0 auto 6px' }} />
      <div className="font-head text-xl font-bold uppercase tracking-tight" style={{ color: GOLD }}>{team.name || team.displayName} won the championship!</div>
    </div>
  );
}

// A compact "what needs attention right now" summary — shown to Board of
// Directors and Site Owner on Home (with a link into the full Admin
// Dashboard tab), and reused unlinked at the top of that tab itself.
// Reuses the notifications the header bell already computes (pending
// trades, suspensions served, open appeals) instead of re-deriving them.
function AdminDashboard({ notifications, staleFreeAgentCount, settings, season, onViewGM, onViewTransactions, onViewAdmin }) {
  const { hasPermission, role } = useAuth();
  if (!hasPermission('manageRosterMoves')) return null;
  const isSiteOwner = role === 'site_owner';
  const tradeCount = notifications.filter(n => n.type === 'trade').length;
  const suspensionCount = notifications.filter(n => n.type === 'suspension').length;
  const appealCount = notifications.filter(n => n.type === 'appeal').length;
  const rosterLimit = settings.rosterLimit || 0;
  const overLimitTeams = rosterLimit > 0 ? (season.members || []).filter(m => (m.roster || []).length > rosterLimit) : [];
  const hasAnyFlag = tradeCount + suspensionCount + appealCount + overLimitTeams.length + staleFreeAgentCount > 0;
  const Tile = ({ label, value, color, onClick }) => (
    <button onClick={onClick} disabled={!onClick} className="text-left w-full rounded disabled:cursor-default">
      <StatBox label={label} value={value} color={color} />
    </button>
  );
  return (
    <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
      <SectionTitle accent={GOLD}>{isSiteOwner ? 'Site owner dashboard' : 'Board dashboard'}</SectionTitle>
      <div className="px-4 pb-3 space-y-3">
        {!hasAnyFlag && <p className="text-sm" style={{ color: CHALK_DIM }}>Nothing needs your attention right now.</p>}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {tradeCount > 0 && <Tile label="Pending trades" value={tradeCount} color={GOLD} onClick={onViewGM} />}
          {suspensionCount > 0 && <Tile label="Suspensions to lift" value={suspensionCount} color={NEGATIVE} onClick={onViewGM} />}
          {appealCount > 0 && <Tile label="Open appeals" value={appealCount} color={NEGATIVE} onClick={onViewTransactions} />}
          {staleFreeAgentCount > 0 && <Tile label="Free agents in old seasons" value={staleFreeAgentCount} color={CHALK_DIM} onClick={onViewGM} />}
        </div>
        {overLimitTeams.length > 0 && (
          <p className="text-xs" style={{ color: NEGATIVE }}>Over the {rosterLimit}-player roster limit: {overLimitTeams.map(m => m.scheduleName).join(', ')}</p>
        )}
        {onViewAdmin && (
          <div className="pt-2" style={{ borderTop: `1px solid ${LINE}` }}>
            <button onClick={onViewAdmin} className="text-xs font-bold" style={{ color: PRIMARY }}>Open admin dashboard →</button>
          </div>
        )}
      </div>
    </Panel>
  );
}

// The full admin tools page — everything that used to be scattered across
// Home (the summary tiles) and the bottom of Settings (badges, the homepage
// banner, admin role management, the audit log) lives here instead, one
// destination for "stuff only an admin needs." Settings keeps league
// configuration (rules, imports, appearance); this tab keeps day-to-day
// admin operations and trust-sensitive tools.
// A GitHub-style density calendar of admin activity — 90 daily cells built
// from the (already capped-to-~100-entries) audit log, so this only ever
// shows however much history the log still has, not a guaranteed 90 days.
function AdminActivityHeatmap({ auditLog }) {
  const DAYS = 90;
  const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
  const counts = {};
  (auditLog || []).forEach(a => { const k = dayKey(a.at); counts[k] = (counts[k] || 0) + 1; });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cells = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const k = d.toISOString().slice(0, 10);
    cells.push({ key: k, date: d, count: counts[k] || 0 });
  }
  const max = Math.max(1, ...cells.map(c => c.count));
  const shade = (n) => n === 0 ? '#242424' : PRIMARY.startsWith('var') ? `rgba(45,212,191,${0.15 + 0.85 * (n / max)})` : PRIMARY;
  const totalInWindow = cells.reduce((s, c) => s + c.count, 0);
  return (
    <Panel className="overflow-hidden">
      <SectionTitle>Admin activity</SectionTitle>
      <div className="px-4 pb-3">
        <p className="text-xs mb-2" style={{ color: CHALK_DIM }}>{totalInWindow} logged action{totalInWindow === 1 ? '' : 's'} in the last {DAYS} days.</p>
        <div className="flex flex-wrap gap-[3px]">
          {cells.map(c => (
            <div key={c.key} title={`${c.date.toLocaleDateString()}: ${c.count} action${c.count === 1 ? '' : 's'}`} className="w-2.5 h-2.5 rounded-sm" style={{ background: shade(c.count) }} />
          ))}
        </div>
      </div>
    </Panel>
  );
}

// Pick a role, see exactly which of the 9 permissions it does and doesn't
// carry — reads straight from the same ROLE_PERMISSIONS map that actually
// gates the UI, so this can never drift out of sync with reality.
function RolePermissionSimulator() {
  const roleKeys = Object.keys(ROLE_LABELS);
  const [roleKey, setRoleKey] = useState(roleKeys[0]);
  const granted = ROLE_PERMISSIONS[roleKey] || [];
  return (
    <Panel className="overflow-hidden">
      <SectionTitle>Role permission simulator</SectionTitle>
      <div className="px-4 pb-3 space-y-2">
        <select value={roleKey} onChange={e => setRoleKey(e.target.value)} className="bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }}>
          {roleKeys.map(k => <option key={k} value={k}>{ROLE_LABELS[k]}</option>)}
        </select>
        <div className="space-y-1.5 pt-1">
          {ALL_PERMS.map(p => {
            const has = granted.includes(p);
            return (
              <div key={p} className="flex items-start gap-2 text-xs py-1" style={{ borderTop: `1px solid ${LINE}` }}>
                {has ? <Check size={14} className="flex-shrink-0 mt-0.5" style={{ color: WIN }} /> : <X size={14} className="flex-shrink-0 mt-0.5" style={{ color: NEGATIVE }} />}
                <div>
                  <span className="font-semibold" style={{ color: has ? CHALK : CHALK_DIM }}>{PERM_LABELS[p]}</span>
                  <p style={{ color: CHALK_DIM }}>{PERM_DESCRIPTIONS[p]}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

// "Active now" reads a snapshot written once per Admin-tab visit (see App's
// heartbeat effect) rather than anything live — good enough to see who else
// is currently poking around without a recurring write racing concurrent edits.
function ActivePresencePanel({ presence }) {
  const now = Date.now();
  const WINDOW = 5 * 60 * 1000;
  const active = Object.entries(presence || {})
    .map(([username, p]) => ({ username, role: p.role, at: p.at }))
    .filter(p => now - p.at < WINDOW)
    .sort((a, b) => b.at - a.at);
  if (active.length === 0) return null;
  return (
    <Panel>
      <SectionTitle>Active now</SectionTitle>
      <div className="px-4 pb-3 flex flex-wrap gap-2">
        {active.map(p => (
          <div key={p.username} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: '#242424', color: CHALK }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: WIN }} />
            {p.username}{p.role ? ` · ${p.role}` : ''}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ChangelogPanel({ league, onAddChangelogEntry, onRemoveChangelogEntry }) {
  const [text, setText] = useState('');
  const entries = ((league && league.changelog) || []).slice().sort((a, b) => b.at - a.at);
  const add = () => { if (!text.trim()) return; onAddChangelogEntry(text.trim()); setText(''); };
  return (
    <Panel className="overflow-hidden">
      <SectionTitle>Changelog</SectionTitle>
      <div className="px-4 pb-3 space-y-2">
        <p className="text-xs" style={{ color: CHALK_DIM }}>Entries show newest-first in the public "What's new" popover.</p>
        <div className="flex gap-2">
          <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="e.g. Added a rivalry meter to team pages" className="flex-1 bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
          <button onClick={add} className="px-3 py-2 rounded font-bold text-xs flex-shrink-0" style={{ background: PRIMARY, color: INK }}>Add</button>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {entries.map(e => (
            <div key={e.id} className="flex items-start gap-2 py-2 text-xs" style={{ borderTop: `1px solid ${LINE}` }}>
              <div className="flex-1">
                <p style={{ color: CHALK }}>{e.text}</p>
                <p className="mt-0.5" style={{ color: CHALK_DIM }}>{new Date(e.at).toLocaleDateString()}</p>
              </div>
              <button onClick={() => onRemoveChangelogEntry(e.id)} style={{ color: CHALK_DIM }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// Mirrors the team registry's "sync teams" dedupe tool, but for players —
// the identity closure elsewhere (robloxUserId/usernameHistory overlap)
// can't catch two records with no shared signal at all, so this is a
// manual "these are the same person" fix instead of an automatic one.
function MergePlayersPanel({ league, onMergePlayers }) {
  const allNames = useMemo(() => getAllPlayerNames(league), [league]);
  const [keepName, setKeepName] = useState('');
  const [mergeName, setMergeName] = useState('');
  const [done, setDone] = useState(null);
  const merge = () => {
    if (!keepName || !mergeName || keepName === mergeName) return;
    onMergePlayers(keepName, mergeName);
    setDone(`${mergeName} merged into ${keepName}.`);
    setMergeName('');
  };
  return (
    <Panel className="overflow-hidden">
      <SectionTitle>Merge duplicate players</SectionTitle>
      <div className="px-4 pb-3 space-y-2">
        <p className="text-xs" style={{ color: CHALK_DIM }}>For two entries that are really the same person but never got linked automatically (no shared Roblox id, unrelated names). The name you keep absorbs the other as a past username — every stat, award, and page for the merged name now resolves to the kept identity. Non-destructive: no records are deleted.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={keepName} onChange={e => { setKeepName(e.target.value); setDone(null); }} className="flex-1 min-w-[140px] bg-[#242424] border rounded px-2 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }}>
            <option value="">Keep this name…</option>
            {allNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="text-xs font-bold" style={{ color: CHALK_DIM }}>←</span>
          <select value={mergeName} onChange={e => { setMergeName(e.target.value); setDone(null); }} className="flex-1 min-w-[140px] bg-[#242424] border rounded px-2 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }}>
            <option value="">Merge from this name…</option>
            {allNames.filter(n => n !== keepName).map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button onClick={merge} disabled={!keepName || !mergeName} className="px-3 py-2 rounded font-bold text-xs disabled:opacity-50" style={{ background: PRIMARY, color: INK }}>Merge</button>
        {done && <p className="text-xs" style={{ color: WIN }}>{done}</p>}
      </div>
    </Panel>
  );
}

function AdminDashboardView({ league, season, teamsById, notifications, staleFreeAgentCount, settings, onViewGM, onViewTransactions, onAddBadgeDef, onRemoveBadgeDef, onSetMaintenanceBanner, onSetEmergencyBanner, onAddChangelogEntry, onRemoveChangelogEntry, onMergePlayers, onLogAudit, onOpenRegistry, applyPending }) {
  const { hasPermission, role } = useAuth();
  if (!hasPermission('manageRosterMoves')) {
    return <div className="p-4"><Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>You don't have access to this page.</p></Panel></div>;
  }
  const isSiteOwner = role === 'site_owner';
  const canManageSettings = hasPermission('manageSettings');
  return (
    <div className="p-3 space-y-3">
      <AdminDashboard notifications={notifications} staleFreeAgentCount={staleFreeAgentCount} settings={settings} season={season} onViewGM={onViewGM} onViewTransactions={onViewTransactions} />
      <ActivePresencePanel presence={league && league.presence} />
      <BotReviewPanel applyPending={applyPending} onLogAudit={onLogAudit} />
      {isSiteOwner && (
        <Panel>
          <SectionTitle>Team registry</SectionTitle>
          <div className="px-4 pb-3 space-y-2">
            <p className="text-xs" style={{ color: CHALK_DIM }}>Create brand-new teams for the site-wide registry, or edit any existing team's colors/logo from one place. Site Owner only.</p>
            <button onClick={onOpenRegistry} className="px-3 py-2 rounded font-bold text-sm" style={{ background: PRIMARY, color: INK }}>Open team registry</button>
          </div>
        </Panel>
      )}
      {canManageSettings && <HomepageBannerPanel league={league} onSetMaintenanceBanner={onSetMaintenanceBanner} />}
      {canManageSettings && <EmergencyBannerPanel league={league} onSetEmergencyBanner={onSetEmergencyBanner} />}
      {canManageSettings && <ChangelogPanel league={league} onAddChangelogEntry={onAddChangelogEntry} onRemoveChangelogEntry={onRemoveChangelogEntry} />}
      <BotEmojiPanel teamsById={teamsById} season={season} />
      {isSiteOwner && <RolePermissionSimulator />}
      {isSiteOwner && <MergePlayersPanel league={league} onMergePlayers={onMergePlayers} />}
      <BadgeManagerPanel league={league} onAddBadgeDef={onAddBadgeDef} onRemoveBadgeDef={onRemoveBadgeDef} />
      <ManageAdminsPanel onLogAudit={onLogAudit} />
      {isSiteOwner && league && league.auditLog && league.auditLog.length > 0 && <AdminActivityHeatmap auditLog={league.auditLog} />}
      {isSiteOwner && league && league.auditLog && league.auditLog.length > 0 && (
        <Panel className="overflow-hidden">
          <SectionTitle>Audit log</SectionTitle>
          <div className="px-2 pb-2 max-h-96 overflow-y-auto">
            {league.auditLog.slice().reverse().slice(0, 100).map(a => (
              <div key={a.id} className="px-2 py-2 text-xs" style={{ borderTop: `1px solid ${LINE}`, color: CHALK }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{a.action}</span>
                  <span style={{ color: CHALK_DIM }}>{new Date(a.at).toLocaleString()}</span>
                </div>
                {a.detail && <div style={{ color: CHALK_DIM }}>{a.detail}</div>}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function HomeView({ season, teamsById, settings, onOpenTeam, h2hMatrix, sport, onStartPlayoffs, onClearPlayoffs, onStartPlayIn, onClearPlayIn, onOpenCompare, news, onViewNews, onOpenPlayer, onViewLeaders, onViewTransactions, notifications, staleFreeAgentCount, onViewGM, onViewAdmin }) {
  const dashboard = <AdminDashboard notifications={notifications} staleFreeAgentCount={staleFreeAgentCount} settings={settings} season={season} onViewGM={onViewGM} onViewTransactions={onViewTransactions} onViewAdmin={onViewAdmin} />;
  if ((season.games || []).length === 0) {
    return <div className="p-3 space-y-3">{dashboard}<Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>Import a schedule to see standings and scores here.</p></Panel></div>;
  }
  const liveStandings = computeStandings(season, teamsById).active;
  const remaining = computeRemaining(season);
  const clinchElim = computeClinchElim(liveStandings, settings.playoffSpots, remaining);
  const seedScenarios = computeSeedScenarios(liveStandings, settings, season, teamsById, remaining);
  const clinched = liveStandings.filter(t => clinchElim[t.id]?.status === 'clinched');
  const eliminated = liveStandings.filter(t => clinchElim[t.id]?.status === 'eliminated');
  const stillAlive = liveStandings.filter(t => clinchElim[t.id]?.status === 'alive');
  const bubbleInTeam = liveStandings[settings.playoffSpots - 1] || null;
  const bubbleOutTeam = liveStandings[settings.playoffSpots] || null;
  const clinchSymbols = computeClinchSymbols(liveStandings, settings.playoffSpots, remaining);
  const playoffGames = (season.games || []).filter(g => g.isPlayoff);
  const playInGames = (season.games || []).filter(g => g.isPlayIn);
  const playInWinnerId = getPlayInWinner(playInGames);
  const seededStandings = buildMainBracketSeeds(liveStandings, settings, playInWinnerId);
  const allGamesChrono = sortGamesChronologically((season.games || []).filter(g => !g.isBye), settings.scheduleMode || 'date');

  const newsPanel = (
    <Panel accent={PRIMARY} className="overflow-hidden">
      <SectionTitle accent={PRIMARY} right={<button onClick={onViewNews} className="text-[11px] font-bold" style={{ color: PRIMARY }}>View all</button>}>Latest news</SectionTitle>
      <div className="px-2 pb-3">
        {(news || []).length === 0 ? (
          <p className="px-2 py-3 text-sm" style={{ color: CHALK_DIM }}>No news posted yet.</p>
        ) : news.slice(0, 3).map(n => (
          <button key={n.id} onClick={onViewNews} className="w-full flex items-center gap-2 text-left px-2 py-2 rounded" style={{ borderBottom: `1px solid ${LINE}` }}>
            {n.imageUrl && <img src={n.imageUrl} alt="" className="w-10 h-10 object-cover rounded flex-shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="font-head text-sm font-semibold truncate" style={{ color: CHALK }}>{n.title}</div>
              <div className="text-[11px] truncate" style={{ color: CHALK_DIM }}>{new Date(n.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{n.author ? ` · By ${n.author}` : ''}{n.body ? ` · ${n.body.slice(0, 60)}${n.body.length > 60 ? '…' : ''}` : ''}</div>
            </div>
          </button>
        ))}
      </div>
    </Panel>
  );

  const leaders = computeSeasonPlayerLeaders(season, teamsById);
  const leaderPreviewCats = [
    { title: 'Batting Avg', accent: GOLD, players: leaders.filter(p => p.totals.ab >= 3), valueFn: p => p.batting.avg, formatFn: (v) => v.toFixed(3).replace(/^0/, '') },
    { title: 'Home Runs', players: leaders, valueFn: p => p.totals.hr, formatFn: (v) => String(Math.round(v)) },
    { title: 'ERA', accent: NEGATIVE, players: leaders.filter(p => p.totals.outs >= 3), valueFn: p => p.pitching.era, formatFn: (v) => v.toFixed(2), sortDesc: false },
  ];
  const leadersPanel = (
    <Panel accent={GOLD} className="overflow-hidden">
      <SectionTitle accent={GOLD} right={<button onClick={onViewLeaders} className="text-[11px] font-bold" style={{ color: GOLD }}>View all</button>}>League leaders</SectionTitle>
      <div className="px-2 pb-3">
        {leaders.length === 0 ? (
          <p className="px-2 py-3 text-sm" style={{ color: CHALK_DIM }}>No stats imported yet this season.</p>
        ) : leaderPreviewCats.map(cat => {
          const top = [...cat.players].sort((a, b) => cat.sortDesc === false ? cat.valueFn(a) - cat.valueFn(b) : cat.valueFn(b) - cat.valueFn(a))[0];
          if (!top) return null;
          const t = teamsById[top.teamId];
          return (
            <button key={cat.title} onClick={() => onOpenPlayer(top.name)} className="w-full flex items-center gap-2 px-2 py-2 text-left" style={{ borderTop: `1px solid ${LINE}` }}>
              <span className="text-[10px] uppercase font-bold w-20 flex-shrink-0" style={{ color: CHALK_DIM }}>{cat.title}</span>
              {t && <TeamMark team={t} size={14} />}
              <span className="flex-1 text-sm font-semibold truncate" style={{ color: CHALK }}>{top.name}</span>
              <span className="text-sm font-mono font-bold flex-shrink-0" style={{ color: cat.accent || PRIMARY }}>{cat.formatFn(cat.valueFn(top))}</span>
            </button>
          );
        })}
      </div>
    </Panel>
  );

  const transactionsPanel = (
    <Panel accent={PRIMARY} className="overflow-hidden">
      <SectionTitle accent={PRIMARY} right={<button onClick={onViewTransactions} className="text-[11px] font-bold" style={{ color: PRIMARY }}>View all</button>}>Recent transactions</SectionTitle>
      <div className="px-2 pb-2">
        {(season.activityLog || []).length === 0 ? (
          <p className="px-2 py-3 text-sm" style={{ color: CHALK_DIM }}>No transactions yet.</p>
        ) : season.activityLog.slice().reverse().slice(0, 5).map(a => <ActivityRow key={a.id} a={a} teamsById={teamsById} />)}
      </div>
    </Panel>
  );

  return (
    <div className="p-3 space-y-3">
      <style>{`@keyframes lt-live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
      {dashboard}
      {season.championTeamId && <ChampionBanner team={teamsById[season.championTeamId]} />}
      {playInGames.length > 0 && (
        <PlayInBracket standings={liveStandings} settings={settings} playInGames={playInGames} teamsById={teamsById} onStart={onStartPlayIn} onClear={onClearPlayIn} onOpenTeam={onOpenTeam} onOpenCompare={onOpenCompare} />
      )}
      {playoffGames.length > 0 && (
        <BracketView standings={seededStandings} settings={settings} playoffGames={playoffGames} teamsById={teamsById} onStart={onStartPlayoffs} onClear={onClearPlayoffs} onOpenTeam={onOpenTeam} h2hMatrix={h2hMatrix} onOpenCompare={onOpenCompare} />
      )}
      {(() => {
        // Scores: live games first (with a pulsing badge and running score),
        // then the last played game, then the next few upcoming — and
        // (during playoffs) which series is currently on. Live games used to
        // live in their own separate red callout above this ticker; folding
        // them in here means there's one score strip instead of two.
        const allGames = allGamesChrono;
        const liveGames = (season.games || []).filter(g => g.isOngoing && !g.played);
        const playedGames = allGames.filter(g => g.played);
        const upcomingGames = allGames.filter(g => !g.played && !g.isOngoing);
        const previousGame = playedGames[playedGames.length - 1] || null;
        const nextUpcoming = upcomingGames.slice(0, 4);
        let scoresTitle = 'Scores';
        if (playoffGames.length > 0) {
          const curRound = Math.max(...playoffGames.map(g => g.playoffRound));
          const roundsCount = Math.max(1, Math.log2(nextPow2(Math.max(1, Math.min(settings.playoffSpots, liveStandings.length)))));
          scoresTitle = getPlayoffRoundName(settings, curRound, roundsCount);
        } else if (playInGames.length > 0) {
          scoresTitle = 'Play-In Tournament';
        }
        const GameChip = ({ g }) => {
          const home = teamsById[g.homeTeamId], away = teamsById[g.awayTeamId];
          const inProgress = g.isOngoing && !g.played;
          const delayed = inProgress && !!g.isDelayed;
          const isLive = inProgress && !delayed;
          const periodLabel = inProgress ? formatLivePeriod(sport, g.livePeriod, g.liveHalf) : null;
          const awayScore = inProgress ? g.liveAwayScore : g.awayScore;
          const homeScore = inProgress ? g.liveHomeScore : g.homeScore;
          const showScore = g.played || (inProgress && awayScore != null && homeScore != null);
          return (
            <div className="flex-shrink-0 snap-start rounded-lg p-3" style={{ width: 168, background: PANEL2, border: `1px solid ${isLive ? NEGATIVE : delayed ? GOLD : LINE}` }}>
              <div className="text-[9px] uppercase font-bold mb-2 flex items-center justify-between" style={{ color: isLive ? NEGATIVE : delayed ? GOLD : g.played ? CHALK_DIM : PRIMARY }}>
                <span className="flex items-center gap-1">
                  {isLive && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: NEGATIVE, animation: 'lt-live-pulse 1.4s ease-in-out infinite' }} />}
                  {isLive ? (periodLabel || 'Live') : delayed ? 'Delayed' : g.played ? 'Final' : (g.date ? (settings.scheduleMode === 'round' ? formatRoundLabel(g.date) : g.date) : 'Upcoming')}
                </span>
                {g.streamUrl && !g.played && <Video size={11} style={{ color: PRIMARY }} />}
              </div>
              <div className="flex items-center justify-between gap-1.5 mb-1">
                <span className="flex items-center gap-1 min-w-0 text-xs font-semibold truncate" style={{ color: CHALK }}>{away && <TeamMark team={away} size={13} />} {away ? away.name : g.awayScheduleName}</span>
                {showScore && <span className="font-head text-sm font-bold flex-shrink-0" style={{ color: CHALK }}>{awayScore}</span>}
              </div>
              <div className="flex items-center justify-between gap-1.5">
                <span className="flex items-center gap-1 min-w-0 text-xs font-semibold truncate" style={{ color: CHALK }}>{home && <TeamMark team={home} size={13} />} {home ? home.name : g.homeScheduleName}</span>
                {showScore && <span className="font-head text-sm font-bold flex-shrink-0" style={{ color: CHALK }}>{homeScore}</span>}
              </div>
              {!g.played && g.gameTimeUTC != null && (
                <div className="text-[10px] font-semibold mt-1.5 pt-1.5 text-center" style={{ color: CHALK_DIM, borderTop: `1px solid ${LINE}` }}>{formatGameTimeOfDayLocal(g.gameTimeUTC)}</div>
              )}
            </div>
          );
        };
        const chipGames = [...liveGames, ...(previousGame ? [previousGame] : []), ...nextUpcoming];
        return (
          <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
            <SectionTitle accent={PRIMARY}>{scoresTitle}</SectionTitle>
            <div className="px-3 pb-3 flex gap-2.5 overflow-x-auto snap-x">
              {chipGames.length === 0 && <p className="px-1 py-3 text-sm" style={{ color: CHALK_DIM }}>No games yet.</p>}
              {chipGames.map(g => <GameChip key={g.id} g={g} />)}
            </div>
          </Panel>
        );
      })()}

      {(() => {
        const hotTeams = [...liveStandings].filter(t => t.streak.type === 'W' && t.streak.count >= 2).sort((a, b) => b.streak.count - a.streak.count).slice(0, 3);
        const coldTeams = [...liveStandings].filter(t => t.streak.type === 'L' && t.streak.count >= 2).sort((a, b) => b.streak.count - a.streak.count).slice(0, 3);
        const { hitStreaks, scorelessStreaks } = computeActiveStreaks(season);
        if (hotTeams.length === 0 && coldTeams.length === 0 && hitStreaks.length === 0 && scorelessStreaks.length === 0) return null;
        const StreakCol = ({ title, color, rows, renderRow }) => rows.length === 0 ? null : (
          <div>
            <div className="text-[10px] uppercase font-bold mb-1.5" style={{ color }}>{title}</div>
            {rows.map(renderRow)}
          </div>
        );
        return (
          <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
            <SectionTitle accent={GOLD}>Hot &amp; cold</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-3 pb-3">
              <StreakCol title="Win streaks" color={WIN} rows={hotTeams} renderRow={t => (
                <button key={t.id} onClick={() => onOpenTeam(t.id)} className="w-full flex items-center justify-between px-2 py-1 text-xs">
                  <span className="flex items-center gap-1.5 truncate" style={{ color: CHALK }}><TeamMark team={t} size={13} /> {t.displayName}</span>
                  <span className="font-mono font-bold flex-shrink-0" style={{ color: WIN }}>{t.streak.label}</span>
                </button>
              )} />
              <StreakCol title="Losing streaks" color={NEGATIVE} rows={coldTeams} renderRow={t => (
                <button key={t.id} onClick={() => onOpenTeam(t.id)} className="w-full flex items-center justify-between px-2 py-1 text-xs">
                  <span className="flex items-center gap-1.5 truncate" style={{ color: CHALK }}><TeamMark team={t} size={13} /> {t.displayName}</span>
                  <span className="font-mono font-bold flex-shrink-0" style={{ color: NEGATIVE }}>{t.streak.label}</span>
                </button>
              )} />
              <StreakCol title="Hit streaks" color={PRIMARY} rows={hitStreaks} renderRow={p => (
                <button key={p.playerId} onClick={() => onOpenPlayer(p.name)} className="w-full flex items-center justify-between px-2 py-1 text-xs">
                  <span className="truncate" style={{ color: CHALK }}>{p.name}</span>
                  <span className="font-mono font-bold flex-shrink-0" style={{ color: PRIMARY }}>{p.count}G</span>
                </button>
              )} />
              <StreakCol title="Scoreless streaks" color={PRIMARY} rows={scorelessStreaks} renderRow={p => (
                <button key={p.playerId} onClick={() => onOpenPlayer(p.name)} className="w-full flex items-center justify-between px-2 py-1 text-xs">
                  <span className="truncate" style={{ color: CHALK }}>{p.name}</span>
                  <span className="font-mono font-bold flex-shrink-0" style={{ color: PRIMARY }}>{p.count}G</span>
                </button>
              )} />
            </div>
          </Panel>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
      <div className="lg:col-span-2 space-y-3">
      <Panel>
        <SectionTitle>Around the league</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 px-3 pb-3">
          {liveStandings.map(t => {
            const teamGames = allGamesChrono.filter(g => g.homeTeamId === t.id || g.awayTeamId === t.id);
            const played = teamGames.filter(g => g.played);
            const lastGame = played[played.length - 1] || null;
            const nextGame = teamGames.find(g => !g.played && !g.isOngoing) || null;
            let lastResultText = 'No games played yet';
            let lastResultColor = CHALK_DIM;
            if (lastGame) {
              const isHome = lastGame.homeTeamId === t.id;
              const oppId = isHome ? lastGame.awayTeamId : lastGame.homeTeamId;
              const opp = teamsById[oppId];
              const oppName = opp ? opp.name : (isHome ? lastGame.awayScheduleName : lastGame.homeScheduleName) || 'TBD';
              const us = isHome ? lastGame.homeScore : lastGame.awayScore;
              const them = isHome ? lastGame.awayScore : lastGame.homeScore;
              const won = us > them;
              lastResultText = `${won ? 'W' : 'L'} ${us}-${them} ${isHome ? 'vs' : '@'} ${oppName}`;
              lastResultColor = won ? WIN : NEGATIVE;
            }
            let nextGameText = 'Season complete';
            if (nextGame) {
              const isHome = nextGame.homeTeamId === t.id;
              const oppId = isHome ? nextGame.awayTeamId : nextGame.homeTeamId;
              const opp = teamsById[oppId];
              const oppName = opp ? opp.name : (isHome ? nextGame.awayScheduleName : nextGame.homeScheduleName) || 'TBD';
              const nextDateLabel = nextGame.date ? (settings.scheduleMode === 'round' ? formatRoundLabel(nextGame.date) : nextGame.date) : '';
              nextGameText = `Next: ${isHome ? 'vs' : '@'} ${oppName}${nextDateLabel ? ` · ${nextDateLabel}` : ''}`;
            }
            return (
              <button key={t.id} onClick={() => onOpenTeam(t.id)} className="text-left px-3 py-2 rounded-lg" style={{ background: PANEL2, borderLeft: `3px solid ${teamColor(t)}` }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-bold text-sm truncate" style={{ color: CHALK }}><TeamMark team={t} size={16} /> {t.displayName}</span>
                  <span className="text-xs font-mono flex-shrink-0" style={{ color: CHALK_DIM }}>{t.w}-{t.l}</span>
                </div>
                <div className="text-[11px] mt-1" style={{ color: lastResultColor }}>{lastResultText}</div>
                <div className="text-[11px]" style={{ color: CHALK_DIM }}>{nextGameText}</div>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Standings</SectionTitle>
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full text-sm" style={{ color: CHALK }}>
            <thead><tr className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>
              <th className="text-left px-2 py-1">#</th><th className="text-left px-2 py-1">Team</th><th className="px-2 py-1">W-L</th><th className="px-2 py-1">PCT</th><th className="px-2 py-1">GB</th>
            </tr></thead>
            <tbody>
              {liveStandings.map(t => (
                <tr key={t.id} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td className="px-2 py-1.5 font-mono" style={{ borderLeft: `3px solid ${teamColor(t)}` }}>{t.rank}</td>
                  <td className="px-2 py-1.5 font-semibold">
                    <button onClick={() => onOpenTeam(t.id)} className="flex items-center gap-2 text-left" style={{ color: CHALK }}>
                      <TeamMark team={t} size={16} /> <span className="truncate max-w-[130px]">{t.displayName}</span>
                      {(clinchSymbols[t.id] || []).map(s => <ClinchBadge key={s} symbol={s} />)}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-center font-mono">{t.w}-{t.l}</td>
                  <td className="px-2 py-1.5 text-center font-mono">{t.pct.toFixed(3).replace(/^0/, '')}</td>
                  <td className="px-2 py-1.5 text-center font-mono">{t.gb === 0 ? '-' : t.gb.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(liveStandings.some(t => (clinchSymbols[t.id] || []).length > 0)) && (
          <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>
            <span style={{ color: WIN }}>x</span>-clinched playoff spot &nbsp; <span style={{ color: GOLD }}>y</span>-clinched #1 seed &nbsp; <span style={{ color: NEGATIVE }}>z</span>-eliminated
          </p>
        )}
      </Panel>

      {/* Once the playoff bracket has actual games, the regular-season race
          these two panels track is decided — showing them alongside a live
          bracket is just noise, so they only render pre-playoffs. */}
      {playoffGames.length === 0 && (
        <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
          <SectionTitle accent={GOLD}>Clinch &amp; elimination watch</SectionTitle>
          <div className="px-4 pb-3 space-y-3">
            {clinched.length > 0 && (
              <div className="space-y-1">
                {clinched.map(t => { const d = describeClinchElim(t, clinchElim[t.id], t.rank, settings.playoffSpots, season, teamsById, bubbleOutTeam); return <p key={t.id} className="text-sm" style={{ color: d.color }}>{d.text}</p>; })}
              </div>
            )}
            {eliminated.length > 0 && (
              <div className="space-y-1">
                {eliminated.map(t => { const d = describeClinchElim(t, clinchElim[t.id], t.rank, settings.playoffSpots, season, teamsById, bubbleInTeam); return <p key={t.id} className="text-sm" style={{ color: d.color }}>{d.text}</p>; })}
              </div>
            )}
            {stillAlive.length > 0 && (
              <div className="space-y-1 pt-1" style={{ borderTop: (clinched.length || eliminated.length) ? `1px solid ${LINE}` : 'none' }}>
                {stillAlive.map(t => { const bubble = t.rank <= settings.playoffSpots ? bubbleOutTeam : bubbleInTeam; const d = describeClinchElim(t, clinchElim[t.id], t.rank, settings.playoffSpots, season, teamsById, bubble); return <p key={t.id} className="text-sm" style={{ color: d.color }}>{d.text}</p>; })}
              </div>
            )}
            {clinched.length === 0 && eliminated.length === 0 && stillAlive.length === 0 && <p className="text-sm" style={{ color: CHALK_DIM }}>Not enough data yet.</p>}
          </div>
        </Panel>
      )}

      {playoffGames.length === 0 && seedScenarios.length > 0 && (
        <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
          <SectionTitle accent={GOLD}>Seed scenarios</SectionTitle>
          <div className="px-4 pb-3 space-y-3">
            {Object.entries(seedScenarios.reduce((acc, s) => { (acc[s.group] = acc[s.group] || []).push(s); return acc; }, {})).map(([group, list]) => (
              <div key={group} className="space-y-1">
                <div className="text-[10px] uppercase font-bold" style={{ color: PRIMARY }}>{group}</div>
                {list.map(s => <p key={s.key} className="text-sm" style={{ color: s.color }}>{s.text}</p>)}
              </div>
            ))}
          </div>
          <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>"What needs to happen" for the #1 seed, a 1st-round bye (if the bracket has one), and each division title.</p>
        </Panel>
      )}
      </div>
      <div className="space-y-3">
        {newsPanel}
        {leadersPanel}
        {transactionsPanel}
      </div>
      </div>
    </div>
  );
}

/* ==================================================================== */
/* Standings view                                                        */
/* ==================================================================== */
function StandingsView({ standings, updateMemberField, season, settings, movementById, onOpenTeam }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageSeasons');
  const [editBaseline, setEditBaseline] = useState(false);
  const [view, setView] = useState('overall');
  const [copied, setCopied] = useState(false);
  const remainingByTeam = computeRemaining(season);
  const clinchSymbols = computeClinchSymbols(standings, settings.playoffSpots, remainingByTeam);
  const hasDivisions = (season.divisions || []).length > 0;
  const { groups: divisionGroups, unassigned } = hasDivisions ? computeDivisionGroups(standings, season.divisions) : { groups: [], unassigned: [] };
  const copyStandings = () => {
    const lines = [`${season.name} — Standings`, ''];
    standings.forEach((t, i) => {
      lines.push(`${i + 1}. ${t.displayName}  ${t.w}-${t.l}  (${t.pct.toFixed(3).replace(/^0/, '')})${t.gb > 0 ? `  ${t.gb.toFixed(1)} GB` : ''}`);
    });
    const text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => { prompt('Copy this text:', text); });
    } else {
      prompt('Copy this text:', text);
    }
  };
  const downloadCsv = () => {
    const headers = ['Rank', 'Team', 'W', 'L', 'PCT', 'GB', 'RF', 'RA', 'Diff', 'RS/G', 'RA/G', 'SOS', 'SOV', 'Streak', 'Home', 'Away', '1-Run', 'X-Inn'];
    const rows = standings.map((t, i) => [
      i + 1, t.displayName, t.w, t.l, t.pct.toFixed(3), t.gb.toFixed(1), t.rf, t.ra, t.diff,
      t.rsPerG.toFixed(2), t.raPerG.toFixed(2), t.sos != null ? t.sos.toFixed(3) : '', t.sov != null ? t.sov.toFixed(3) : '',
      t.streak.label, `${t.homeW}-${t.homeL}`, `${t.awayW}-${t.awayL}`, `${t.oneRunW}-${t.oneRunL}`, `${t.xInnW}-${t.xInnL}`,
    ]);
    const esc = (v) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${season.name.replace(/[^a-z0-9]+/gi, '-')}-stats.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  return (
    <div className="p-3 space-y-3">
      <div className="flex justify-end">
        <button onClick={downloadCsv} className="text-[11px] font-semibold flex items-center gap-1" style={{ color: PRIMARY }}><Save size={12} /> Export full stats CSV</button>
      </div>
      {hasDivisions && (
        <div className="flex rounded-lg overflow-hidden border w-fit" style={{ borderColor: LINE }}>
          {[['overall', 'Overall'], ['division', 'By Division']].map(([m, label]) => (
            <button key={m} onClick={() => setView(m)} className="px-3 py-1.5 text-xs font-bold" style={{ background: view === m ? PRIMARY : 'transparent', color: view === m ? INK : CHALK_DIM }}>{label}</button>
          ))}
        </div>
      )}
      {view === 'division' && hasDivisions ? (
        <>
          {divisionGroups.map(g => (
            <Panel key={g.division.id}>
              <SectionTitle>{g.division.conference ? `${g.division.conference} — ${g.division.name}` : g.division.name}</SectionTitle>
              <div className="overflow-x-auto px-2 pb-3">
                <table className="w-full text-sm border-separate" style={{ color: CHALK, borderSpacing: 0 }}>
                  <thead><tr className="text-[10px] font-bold uppercase tracking-wide" style={{ color: CHALK_DIM, borderBottom: `2px solid ${PRIMARY}` }}>
                    <th className="text-left px-2 py-2">Team</th><th className="px-2 py-2">W</th><th className="px-2 py-2">L</th><th className="px-2 py-2">PCT</th><th className="px-2 py-2">GB</th><th className="px-2 py-2">Strk</th>
                  </tr></thead>
                  <tbody>
                    {g.teams.map((t, i) => {
                      const symbols = clinchSymbols[t.id] || [];
                      return (
                        <tr key={t.id} style={{ background: i % 2 === 1 ? PANEL2 : 'transparent' }}>
                          <td className="px-2 py-2 font-semibold" style={{ borderLeft: `4px solid ${teamColor(t)}` }}>
                            <button onClick={() => onOpenTeam(t.id)} className="flex items-center gap-2 text-left pl-1.5" style={{ color: CHALK }}>
                              <TeamMark team={t} size={18} /> <span className="font-head truncate max-w-[120px] font-semibold">{t.displayName}</span>
                              <span className="text-[10px] font-mono font-bold" style={{ color: CHALK_DIM }}>{teamAbbr(t)}</span>
                              {symbols.map(s => <ClinchBadge key={s} symbol={s} />)}
                            </button>
                          </td>
                          <td className="px-2 py-2 text-center font-mono font-bold">{t.w}</td>
                          <td className="px-2 py-2 text-center font-mono font-bold">{t.l}</td>
                          <td className="px-2 py-2 text-center font-mono font-bold">{t.pct.toFixed(3).replace(/^0/, '')}</td>
                          <td className="px-2 py-2 text-center font-mono">{t.divGb === 0 ? '-' : t.divGb.toFixed(1)}</td>
                          <td className="px-2 py-2 text-center font-mono" style={{ color: t.streak.type === 'W' ? WIN : t.streak.type === 'L' ? NEGATIVE : CHALK_DIM }}>{t.streak.label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          ))}
          {unassigned.length > 0 && (
            <Panel>
              <SectionTitle>Unassigned</SectionTitle>
              <div className="px-2 pb-3">
                {unassigned.map(t => (
                  <div key={t.id} className="flex items-center gap-2 px-2 py-2 text-sm" style={{ borderTop: `1px solid ${LINE}` }}>
                    <button onClick={() => onOpenTeam(t.id)} className="flex items-center gap-2" style={{ color: CHALK }}><TeamMark team={t} size={16} /> {t.displayName}</button>
                    <span className="font-mono text-xs" style={{ color: CHALK_DIM }}>{t.w}-{t.l}</span>
                  </div>
                ))}
              </div>
              <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>Assign these to a division from the Teams tab.</p>
            </Panel>
          )}
        </>
      ) : (
      <Panel>
        <SectionTitle right={
          <div className="flex items-center gap-2">
            <button onClick={copyStandings} className="text-[11px] font-semibold flex items-center gap-1" style={{ color: copied ? WIN : PRIMARY }}><Save size={12} /> {copied ? 'Copied!' : 'Copy'}</button>
            {isLoggedIn && <button onClick={() => setEditBaseline(v => !v)} className="text-[11px] font-semibold flex items-center gap-1" style={{ color: PRIMARY }}><Pencil size={12} /> {editBaseline ? 'Done' : 'Edit starting record'}</button>}
          </div>
        }>
          Standings
        </SectionTitle>
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full text-sm border-separate" style={{ color: CHALK, borderSpacing: 0 }}>
            <thead><tr className="text-[10px] font-bold uppercase tracking-wide" style={{ color: CHALK_DIM, borderBottom: `2px solid ${PRIMARY}` }}>
              <th className="text-center px-1.5 py-2 w-6">#</th><th className="text-left px-2 py-2"></th><th className="text-left px-2 py-2">Team</th><th className="px-2 py-2">GP</th><th className="px-2 py-2">W</th><th className="px-2 py-2">L</th>
              <th className="px-2 py-2">PCT</th><th className="px-2 py-2">GB</th><th className="px-2 py-2">Strk</th><th className="px-2 py-2">L10</th><th className="px-2 py-2">RF</th><th className="px-2 py-2">RA</th><th className="px-2 py-2">DIFF</th>
            </tr></thead>
            <tbody>
              {standings.map((t, i) => {
                const member = season.members.find(x => x.teamId === t.id);
                const delta = movementById ? movementById[t.id] : null;
                const l10W = t.last10.filter(r => r === 'W').length, l10L = t.last10.filter(r => r === 'L').length;
                const symbols = clinchSymbols[t.id] || [];
                return (
                  <tr key={t.id} style={{ background: i % 2 === 1 ? PANEL2 : 'transparent' }}>
                    <td className="text-center py-2 text-xs font-mono font-bold" style={{ color: CHALK_DIM }}>{i + 1}</td>
                    <td className="pl-1 py-2 text-xs font-mono" style={{ borderLeft: `4px solid ${teamColor(t)}` }}><MoveIndicator delta={delta} /></td>
                    <td className="px-2 py-2 font-semibold">
                      <button onClick={() => onOpenTeam(t.id)} className="flex items-center gap-2 text-left" style={{ color: CHALK }}>
                        <TeamMark team={t} size={20} /> <span className="font-head truncate max-w-[110px] font-semibold">{t.displayName}</span>
                        <span className="text-[10px] font-mono font-bold" style={{ color: CHALK_DIM }}>{teamAbbr(t)}</span>
                        {symbols.map(s => <ClinchBadge key={s} symbol={s} />)}
                        {t.gp >= 3 && t.l === 0 && <span title="Undefeated" style={{ fontSize: 12 }}>🔥</span>}
                        {t.gp >= 3 && t.w === 0 && <span title="Winless" style={{ fontSize: 12 }}>🥶</span>}
                      </button>
                    </td>
                    <td className="px-2 py-2 text-center font-mono">{t.gp}</td>
                    <td className="px-2 py-2 text-center font-mono font-bold">{editBaseline ? <NumInput value={member?.baselineW ?? 0} onChange={v => updateMemberField(t.id, 'baselineW', v)} /> : t.w}</td>
                    <td className="px-2 py-2 text-center font-mono font-bold">{editBaseline ? <NumInput value={member?.baselineL ?? 0} onChange={v => updateMemberField(t.id, 'baselineL', v)} /> : t.l}</td>
                    <td className="px-2 py-2 text-center font-mono font-bold">{t.pct.toFixed(3).replace(/^0/, '')}</td>
                    <td className="px-2 py-2 text-center font-mono">{t.gb === 0 ? '-' : t.gb.toFixed(1)}</td>
                    <td className="px-2 py-2 text-center font-mono" style={{ color: t.streak.type === 'W' ? WIN : t.streak.type === 'L' ? NEGATIVE : CHALK_DIM }}>{t.streak.label}</td>
                    <td className="px-2 py-2 text-center font-mono">{l10W}-{l10L}</td>
                    <td className="px-2 py-2 text-center font-mono">{editBaseline ? <NumInput value={member?.baselineRF ?? 0} onChange={v => updateMemberField(t.id, 'baselineRF', v)} /> : t.rf}</td>
                    <td className="px-2 py-2 text-center font-mono">{editBaseline ? <NumInput value={member?.baselineRA ?? 0} onChange={v => updateMemberField(t.id, 'baselineRA', v)} /> : t.ra}</td>
                    <td className="px-2 py-2 text-center font-mono font-bold" style={{ color: t.diff > 0 ? WIN : t.diff < 0 ? NEGATIVE : CHALK_DIM }}>{t.diff > 0 ? `+${t.diff}` : t.diff}</td>
                  </tr>
                );
              })}
              {standings.length === 0 && <tr><td colSpan={13} className="text-center py-6 text-sm" style={{ color: CHALK_DIM }}>Add teams in the Teams tab, or import a schedule, to see standings.</td></tr>}
            </tbody>
          </table>
        </div>
        {editBaseline && <p className="px-4 pb-3 text-xs" style={{ color: CHALK_DIM }}>Starting record is added on top of results from played schedule games.</p>}
        {(standings.some(t => (clinchSymbols[t.id] || []).length > 0)) && (
          <p className="px-4 pb-2 text-[11px]" style={{ color: CHALK_DIM }}>
            <span style={{ color: WIN }}>x</span>-clinched playoff spot &nbsp; <span style={{ color: GOLD }}>y</span>-clinched #1 seed &nbsp; <span style={{ color: NEGATIVE }}>z</span>-eliminated
          </p>
        )}
        <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>Movement compares to standings after the previous round.</p>
      </Panel>
      )}
    </div>
  );
}

/* ==================================================================== */
/* Settings view                                                         */
/* ==================================================================== */
function AppearanceSettings({ theme, saveTheme }) {
  const { hasPermission } = useAuth();
  // The league-wide default theme is admin-only — every visitor (logged in
  // or not) already has their own light/dark override via the header
  // toggle, so there's nothing here for anyone without manageSettings.
  if (!hasPermission('manageSettings')) return null;
  return (
    <Panel>
      <SectionTitle>Appearance</SectionTitle>
      <div className="px-4 pb-3 space-y-3 text-sm">
        <p className="text-xs" style={{ color: CHALK_DIM }}>Sets the default theme for visitors who haven't picked their own with the header toggle. Changes apply everywhere in the app immediately, and stick across leagues and seasons.</p>
        <div className="flex gap-2">
          {[['dark', 'Dark mode'], ['light', 'Light mode']].map(([key, label]) => (
            <button key={key} onClick={() => saveTheme({ ...THEME_PRESETS[key] })} className="flex-1 px-3 py-2 rounded font-bold text-xs" style={{ background: PANEL2, color: PRIMARY, border: `1px solid ${LINE}` }}>{label}</button>
          ))}
        </div>
        {[
          ['chalk', 'Main text color', DEFAULT_THEME.chalk],
          ['chalkDim', 'Secondary text color', DEFAULT_THEME.chalkDim],
          ['primary', 'Accent color', DEFAULT_THEME.primary],
          ['ink', 'Page background', DEFAULT_THEME.ink],
          ['panel', 'Card background', DEFAULT_THEME.panel],
          ['panel2', 'Inset background', DEFAULT_THEME.panel2],
          ['line', 'Border color', DEFAULT_THEME.line],
        ].map(([key, label, fallback]) => (
          <label key={key} className="flex items-center justify-between gap-2" style={{ color: CHALK }}>
            <span>{label}</span>
            <div className="flex items-center gap-2">
              <input type="color" value={theme[key] || fallback} onChange={e => saveTheme({ ...theme, [key]: e.target.value })} className="w-9 h-8 rounded cursor-pointer bg-transparent" style={{ border: `1px solid ${LINE}` }} />
              <button onClick={() => saveTheme({ ...theme, [key]: fallback })} className="text-[11px]" style={{ color: CHALK_DIM }}>Reset</button>
            </div>
          </label>
        ))}
      </div>
    </Panel>
  );
}
// Site-Owner-only screen for granting/changing/revoking admin roles. Reads
// and writes the admin_roles table directly (its own RLS, separate from the
// kv_store queue everything else in this app goes through) since role
// assignment is the one thing that stays database-enforced rather than
// UI-only — see supabase/schema.sql.
function ManageAdminsPanel({ onLogAudit }) {
  const { hasPermission, user } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newUserId, setNewUserId] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newRole, setNewRole] = useState('board');

  const load = useCallback(() => {
    supabase.from('admin_roles').select('user_id, username, role, updated_at').order('username')
      .then(({ data, error: err }) => { if (err) setError(err.message); else { setRows(data || []); setError(null); } });
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!hasPermission('manageAdmins')) return null;

  const addAdmin = async (e) => {
    e.preventDefault();
    if (!newUserId.trim() || !newUsername.trim()) return;
    setBusy(true);
    const { error: err } = await supabase.from('admin_roles').upsert({ user_id: newUserId.trim(), username: newUsername.trim(), role: newRole });
    setBusy(false);
    if (err) { setError(err.message); return; }
    if (onLogAudit) onLogAudit('Role granted', `${newUsername.trim()} → ${ROLE_LABELS[newRole] || newRole}`);
    setNewUserId(''); setNewUsername(''); setNewRole('board');
    load();
  };
  const changeRole = async (userId, role) => {
    setBusy(true);
    const target = (rows || []).find(r => r.user_id === userId);
    const { error: err } = await supabase.from('admin_roles').update({ role }).eq('user_id', userId);
    setBusy(false);
    if (err) { setError(err.message); return; }
    if (onLogAudit) onLogAudit('Role changed', `${target ? target.username : userId} → ${ROLE_LABELS[role] || role}`);
    load();
  };
  const removeAdmin = async (userId, username) => {
    if (!confirm(`Remove admin access for "${username}"? They'll still be able to log in but won't be able to do anything until re-added.`)) return;
    setBusy(true);
    const { error: err } = await supabase.from('admin_roles').delete().eq('user_id', userId);
    setBusy(false);
    if (err) { setError(err.message); return; }
    if (onLogAudit) onLogAudit('Role revoked', username);
    load();
  };

  return (
    <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
      <SectionTitle accent={GOLD}>Manage admins</SectionTitle>
      <div className="px-4 pb-3 space-y-3">
        <p className="text-xs" style={{ color: CHALK_DIM }}>
          Create the account itself in the Supabase dashboard (Authentication → Users → Add user, email <code>username@admin.local</code>), copy its User UID, then grant it a role here.
        </p>
        {error && <p className="text-xs" style={{ color: NEGATIVE }}>{error}</p>}
        {rows === null ? (
          <p className="text-sm" style={{ color: CHALK_DIM }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm" style={{ color: CHALK_DIM }}>No admins granted a role yet.</p>
        ) : (
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.user_id} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: PANEL2 }}>
                <span className="flex-1 text-sm font-semibold truncate" style={{ color: CHALK }}>{r.username}{r.user_id === user?.id ? ' (you)' : ''}</span>
                <select value={r.role} disabled={busy} onChange={e => changeRole(r.user_id, e.target.value)} className="bg-[#242424] border rounded px-2 py-1 text-xs disabled:opacity-50" style={{ borderColor: LINE, color: CHALK }}>
                  {Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <button onClick={() => removeAdmin(r.user_id, r.username)} disabled={busy} className="p-1 rounded disabled:opacity-50" style={{ color: NEGATIVE }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={addAdmin} className="pt-2 space-y-2" style={{ borderTop: `1px solid ${LINE}` }}>
          <div className="text-[10px] uppercase font-bold" style={{ color: PRIMARY }}>Grant a role</div>
          <input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="Username" className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
          <input value={newUserId} onChange={e => setNewUserId(e.target.value)} placeholder="User UID (from Authentication → Users)" className="w-full bg-[#242424] border rounded px-3 py-2 text-sm font-mono" style={{ borderColor: LINE, color: CHALK }} />
          <select value={newRole} onChange={e => setNewRole(e.target.value)} className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }}>
            {Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <button type="submit" disabled={busy || !newUserId.trim() || !newUsername.trim()} className="px-3 py-2 rounded font-bold text-sm flex items-center gap-1 disabled:opacity-50" style={{ background: GOLD, color: INK }}>
            <Plus size={16} /> Grant role
          </button>
        </form>
      </div>
    </Panel>
  );
}

// Bulk-imports KPB (hcbb.info) season totals for players already tracked in
// this league, matched by Roblox account rather than name so a stale local
// name or a Roblox username change doesn't cause a miss. One mapping row per
// hcbb season picks which local season that data lands in — skip any that
// don't apply to this league. Starts at S1-S3 (what's been available since
// this was built) with an "Add another season" control rather than a fixed
// cutoff, since hcbb.info opens up a new season number each time one
// finishes and there's no way to know that ahead of time from here — trying
// a season hcbb.info hasn't published yet just reports back that it isn't
// available (nothing saves), so there's no harm in adding one early.
function KpbImportPanel({ league, onRunImport }) {
  const [seasonNumbers, setSeasonNumbers] = useState(['1', '2', '3']);
  const [mapping, setMapping] = useState({ '1': '', '2': '', '3': '' });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const seasons = (league && league.seasons) || [];
  const anyMapped = Object.values(mapping).some(Boolean);
  const addSeasonNumber = () => {
    const next = String(Math.max(0, ...seasonNumbers.map(Number)) + 1);
    setSeasonNumbers(ns => [...ns, next]);
    setMapping(m => ({ ...m, [next]: '' }));
  };
  const run = async () => {
    setRunning(true); setResult(null);
    const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));
    const res = await onRunImport(clean);
    setResult(res);
    setRunning(false);
  };
  return (
    <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
      <SectionTitle accent={PRIMARY}>Import KPB stats (hcbb.info)</SectionTitle>
      <div className="px-4 pb-3 space-y-3 text-sm">
        <p className="text-xs" style={{ color: CHALK_DIM }}>Pulls full-season batting and pitching totals for the KPB league from hcbb.info and matches players by their Roblox account — checking every player already tracked here, on a roster or in free agency, in any season — rather than just their current on-site name. Unfiltered totals (Qualify: any games, no minimum AB/IP). Unmatched hcbb players are skipped; matched players not yet in the target season are added there as free agents so the stats have somewhere to attach. Re-running with the same mapping replaces the previous import instead of duplicating it.</p>
        {seasonNumbers.map(s => (
          <div key={s} className="flex items-center justify-between gap-2">
            <span style={{ color: CHALK }}>KPB Season {s}</span>
            <select value={mapping[s] || ''} onChange={e => setMapping(m => ({ ...m, [s]: e.target.value }))} className="bg-[#242424] border rounded px-2 py-1.5 text-xs" style={{ borderColor: LINE, color: CHALK }}>
              <option value="" style={{ background: PANEL2, color: CHALK }}>Skip</option>
              {seasons.map(se => <option key={se.id} value={se.id} style={{ background: PANEL2, color: CHALK }}>{se.name}</option>)}
            </select>
          </div>
        ))}
        <button onClick={addSeasonNumber} className="text-xs font-semibold" style={{ color: PRIMARY }}>+ Add another hcbb season</button>
        <button onClick={run} disabled={running || !anyMapped} className="px-3 py-2 rounded font-bold text-sm disabled:opacity-40" style={{ background: PRIMARY, color: INK }}>
          {running ? 'Importing…' : 'Run import'}
        </button>
        {result && result.error && <p className="text-xs" style={{ color: NEGATIVE }}>{result.error}</p>}
        {result && result.seasons && (
          <div className="space-y-1 pt-2" style={{ borderTop: `1px solid ${LINE}` }}>
            {Object.entries(result.seasons).map(([s, r]) => (
              <p key={s} className="text-xs" style={{ color: r.error ? NEGATIVE : CHALK_DIM }}>
                S{s}: {r.error || `matched ${r.matched}/${r.total} into "${r.targetSeasonName}"${r.created ? ` (${r.created} added as free agents)` : ''} — ${r.unmatched} unmatched`}
              </p>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

// A player who's currently a free agent in some past season, under a since-
// changed Roblox username, only gets linked into the rest of their career
// when that specific season's page happens to get visited (that's what
// triggers the normal per-page-view rename sync). This runs that same
// linking proactively for everyone at once: pulls each known Roblox
// account's full username history and backfills the account id onto any
// other roster/free-agent entry, anywhere in the league, whose name matches
// one of those past usernames.
function PlayerIdentitySyncPanel({ onRunSync }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const run = async () => {
    setRunning(true); setResult(null);
    const res = await onRunSync();
    setResult(res);
    setRunning(false);
  };
  return (
    <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
      <SectionTitle accent={GOLD}>Combine player pages by Roblox history</SectionTitle>
      <div className="px-4 pb-3 space-y-3 text-sm">
        <p className="text-xs" style={{ color: CHALK_DIM }}>Looks up every tracked player's Roblox account and its full past-username history, then links that account to any other roster or free-agent entry (in any season) that's still filed under one of those old usernames — like a player showing up as a free agent for a past season because they were on a roster that season under a name they've since changed. Once linked, their player pages combine automatically; nothing gets deleted or renamed.</p>
        <button onClick={run} disabled={running} className="px-3 py-2 rounded font-bold text-sm disabled:opacity-40" style={{ background: GOLD, color: INK }}>{running ? 'Syncing…' : 'Sync now'}</button>
        {result && result.error && <p className="text-xs" style={{ color: NEGATIVE }}>{result.error}</p>}
        {result && !result.error && (
          <div className="space-y-1 pt-2" style={{ borderTop: `1px solid ${LINE}` }}>
            <p className="text-xs" style={{ color: CHALK_DIM }}>Checked {result.checked} Roblox account{result.checked === 1 ? '' : 's'} — linked {result.linked} entr{result.linked === 1 ? 'y' : 'ies'} into their real page, enriched past-name records on {result.namesEnriched}.</p>
            {result.conflicts.length > 0 && (
              <div>
                <p className="text-xs font-semibold" style={{ color: GOLD }}>Left alone (already linked to a different Roblox account — check these by hand):</p>
                {result.conflicts.map((c, i) => <p key={i} className="text-xs" style={{ color: CHALK_DIM }}>{c.name}</p>)}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

// Badge definitions are global to the whole site (like the team registry),
// so only Site Owner and Commissioner can create or delete one — same
// trust tier as the awards system these complement. Any admin can still
// assign an already-created badge to a player from the player page itself.
function BadgeManagerPanel({ league, onAddBadgeDef, onRemoveBadgeDef }) {
  const { role } = useAuth();
  const canManage = role === 'site_owner' || role === 'commissioner';
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState(GOLD);
  const [imageUrl, setImageUrl] = useState(null);
  const [imageBusy, setImageBusy] = useState(false);
  const defs = (league && league.badgeDefs) || [];
  if (!canManage && defs.length === 0) return null;
  const handleImage = async (file) => {
    if (!file) return;
    setImageBusy(true);
    try {
      const dataUrl = await resizeImageFile(file, 96);
      if (dataUrl.length > 1_500_000) alert('That image is too large even after resizing — try a smaller file.');
      else setImageUrl(dataUrl);
    } catch (e) { alert('Could not read that image file.'); }
    setImageBusy(false);
  };
  const add = () => {
    if (!name.trim()) return;
    onAddBadgeDef(name, icon, color, imageUrl);
    setName(''); setIcon(''); setImageUrl(null);
  };
  return (
    <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
      <SectionTitle accent={GOLD}>Player badges</SectionTitle>
      <div className="px-4 pb-3 space-y-3 text-sm">
        <p className="text-xs" style={{ color: CHALK_DIM }}>Custom badges the Site Owner or Commissioner can create here, then hand out to any player from their player page — for callouts that don't fit the awards system (e.g. "Franchise Player", "Community MVP"). Use an emoji or upload a small custom image as the icon.</p>
        {defs.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {defs.map(b => (
              <div key={b.id} className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full text-xs font-semibold" style={{ background: `${b.color}22`, color: b.color, border: `1px solid ${b.color}55` }}>
                <BadgeIcon badge={b} size={14} /><span>{b.name}</span>
                {canManage && <button onClick={() => { if (confirm(`Delete badge "${b.name}"? Removes it from every player who has it.`)) onRemoveBadgeDef(b.id); }} className="p-0.5 rounded-full" style={{ color: b.color }}><X size={11} /></button>}
              </div>
            ))}
          </div>
        )}
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            {imageUrl ? (
              <button onClick={() => setImageUrl(null)} title="Remove image, use emoji instead" className="relative w-9 h-9 rounded-full overflow-hidden flex-shrink-0" style={{ border: `1px solid ${LINE}` }}>
                <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                <span className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100" style={{ background: 'rgba(0,0,0,0.6)' }}><X size={14} color="#fff" /></span>
              </button>
            ) : (
              <>
                <input value={icon} onChange={e => setIcon(e.target.value.slice(0, 4))} placeholder="🏆" className="w-14 bg-[#242424] border rounded px-2 py-2 text-sm text-center" style={{ borderColor: LINE, color: CHALK }} />
                <label className="px-2 py-2 rounded text-[11px] font-bold cursor-pointer flex-shrink-0" style={{ background: PANEL2, color: CHALK_DIM }}>
                  {imageBusy ? '…' : 'Image'}
                  <input type="file" accept="image/*" className="hidden" disabled={imageBusy} onChange={e => handleImage(e.target.files && e.target.files[0])} />
                </label>
              </>
            )}
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Badge name" className="flex-1 min-w-[100px] bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
            <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-9 h-9 rounded cursor-pointer bg-transparent flex-shrink-0" style={{ border: `1px solid ${LINE}` }} />
            <button onClick={add} disabled={!name.trim()} className="px-3 py-2 rounded font-bold text-sm disabled:opacity-40 flex-shrink-0" style={{ background: GOLD, color: INK }}><Plus size={16} /></button>
          </div>
        )}
      </div>
    </Panel>
  );
}

// A settings group's heading — sits a level above SectionTitle to separate
// "League Rules" from "Admin Access" etc. without turning every group into
// its own collapsible (which would cost a click just to see what's there).
function SettingsGroupHeader({ label }) {
  return (
    <div className="pt-2 pb-1 px-1 text-xs font-bold uppercase tracking-widest" style={{ color: CHALK_DIM, borderBottom: `1px solid ${LINE}` }}>{label}</div>
  );
}

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time, no
// timezone suffix — Date's own toISOString is UTC, so this rolls one by
// hand from the epoch ms a banner's startAt/endAt is stored as.
function toDatetimeLocalValue(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// A message shown at the top of Home while active. Optionally scheduled —
// startAt/endAt let it show/hide itself on time instead of relying on
// someone remembering to flip the toggle (e.g. "Playoffs start Saturday"
// posted days ahead, or a downtime notice that clears itself afterward).
function HomepageBannerPanel({ league, onSetMaintenanceBanner }) {
  const banner = (league && league.maintenanceBanner) || {};
  const [message, setMessage] = useState(banner.message || '');
  const [active, setActive] = useState(!!banner.active);
  const [startAt, setStartAt] = useState(toDatetimeLocalValue(banner.startAt));
  const [endAt, setEndAt] = useState(toDatetimeLocalValue(banner.endAt));
  const now = Date.now();
  const status = !banner.active || !banner.message ? 'off'
    : banner.startAt && now < banner.startAt ? 'upcoming'
    : banner.endAt && now > banner.endAt ? 'expired'
    : 'live';
  const statusColor = status === 'live' ? GOLD : status === 'upcoming' ? PRIMARY : CHALK_DIM;
  const statusLabel = { live: 'Showing now', upcoming: 'Scheduled — not showing yet', expired: 'Window passed — not showing', off: 'Off' }[status];
  const save = () => onSetMaintenanceBanner(message, active, startAt ? new Date(startAt).getTime() : null, endAt ? new Date(endAt).getTime() : null);
  return (
    <Panel style={{ borderColor: status === 'live' ? GOLD : status === 'upcoming' ? PRIMARY : LINE }}>
      <SectionTitle accent={GOLD}>Homepage banner</SectionTitle>
      <div className="px-4 pb-3 space-y-2">
        <p className="text-xs" style={{ color: CHALK_DIM }}>A short message shown at the top of the Home tab while enabled — a planned downtime window, a quick announcement, whatever's worth a heads-up. Optionally schedule it to start and/or end on its own instead of remembering to toggle it.</p>
        <input value={message} onChange={e => setMessage(e.target.value)} placeholder="e.g. Playoffs start this Saturday — see the bracket on Home" className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
        <label className="flex items-center gap-2 text-sm" style={{ color: CHALK }}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
          Enabled
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>Starts (optional)</span>
            <input type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)} className="bg-[#242424] border rounded px-2 py-1.5 text-xs" style={{ borderColor: LINE, color: CHALK }} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>Ends (optional)</span>
            <input type="datetime-local" value={endAt} onChange={e => setEndAt(e.target.value)} className="bg-[#242424] border rounded px-2 py-1.5 text-xs" style={{ borderColor: LINE, color: CHALK }} />
          </label>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button onClick={save} className="px-3 py-1.5 rounded font-bold text-xs" style={{ background: GOLD, color: INK }}>Save banner</button>
          <span className="text-[11px] font-semibold" style={{ color: statusColor }}>{statusLabel}</span>
        </div>
      </div>
    </Panel>
  );
}

// Unlike the scheduled homepage banner, this is meant for "right now" —
// no start/end window, shows on every tab immediately when turned on
// (site down for maintenance in 5 minutes, a live incident, etc.).
function EmergencyBannerPanel({ league, onSetEmergencyBanner }) {
  const banner = (league && league.emergencyBanner) || {};
  const [message, setMessage] = useState(banner.message || '');
  const [active, setActive] = useState(!!banner.active);
  const save = () => onSetEmergencyBanner(message, active);
  return (
    <Panel style={{ borderColor: banner.active && banner.message ? NEGATIVE : LINE }}>
      <SectionTitle accent={NEGATIVE}>Emergency broadcast</SectionTitle>
      <div className="px-4 pb-3 space-y-2">
        <p className="text-xs" style={{ color: CHALK_DIM }}>An urgent, unscheduled banner shown on every tab the moment it's turned on — for something that needs eyes right now, not a heads-up planned ahead of time. Use the homepage banner above for that.</p>
        <input value={message} onChange={e => setMessage(e.target.value)} placeholder="e.g. Site going down for emergency maintenance in 5 minutes" className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
        <label className="flex items-center gap-2 text-sm" style={{ color: CHALK }}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
          Enabled
        </label>
        <div className="flex items-center gap-3 pt-1">
          <button onClick={save} className="px-3 py-1.5 rounded font-bold text-xs" style={{ background: NEGATIVE, color: INK }}>Save broadcast</button>
          {banner.active && banner.message && <span className="text-[11px] font-semibold" style={{ color: NEGATIVE }}>Showing now, every tab</span>}
        </div>
      </div>
    </Panel>
  );
}

function EmergencyBanner({ banner }) {
  if (!banner || !banner.active || !banner.message) return null;
  return (
    <div className="mx-4 mt-4 px-4 py-2.5 flex items-center gap-3 rounded-xl" style={{ background: NEGATIVE, color: INK }}>
      <AlertTriangle size={15} className="flex-shrink-0" />
      <span className="flex-1 text-sm font-bold">{banner.message}</span>
    </div>
  );
}

function SettingsView({ settings, saveSettings, theme, saveTheme, sport, season, teamsById, importGames, addManualGame, generateSchedule, league, onRunKpbImport, onSyncPlayerIdentities }) {
  const { hasPermission } = useAuth();
  const canManageSettings = hasPermission('manageSettings');
  const canManageSchedule = hasPermission('manageSchedule');
  const showImportGroup = canManageSchedule || canManageSettings;
  return (
    <div className="p-3 space-y-3">
      {canManageSettings && <SettingsGroupHeader label="League rules & format" />}
      {canManageSettings && (
      <Panel>
        <SectionTitle>Season settings</SectionTitle>
        <div className="px-4 pb-3 space-y-3 text-sm">
          <label className="flex items-center justify-between gap-2" style={{ color: CHALK }}>
            <span>Playoff spots<div className="text-[11px]" style={{ color: CHALK_DIM }}>How many teams make the postseason</div></span>
            <NumInput value={settings.playoffSpots} min={1} max={64} onChange={v => saveSettings({ ...settings, playoffSpots: v })} w="w-16" />
          </label>
          <label className="flex items-center justify-between gap-2" style={{ color: CHALK }}>
            <span>Tournament season<div className="text-[11px]" style={{ color: CHALK_DIM }}>Stats still show up on player pages under this season, but aren't folded into anyone's combined career totals — for one-off events like a WBC-style tournament</div></span>
            <input type="checkbox" checked={!!settings.isTournament} onChange={e => saveSettings({ ...settings, isTournament: e.target.checked })} style={{ accentColor: PRIMARY, width: 18, height: 18 }} />
          </label>
          <div className="flex items-center justify-between gap-2 flex-wrap" style={{ color: CHALK }}>
            <span>Playoff seeding<div className="text-[11px]" style={{ color: CHALK_DIM }}>Divisional gives each division's leader a guaranteed seed, then fills remaining spots with wild cards by record. WBC-style treats divisions as pool-play groups and advances the top finishers from every group before any wild cards (needs divisions set up in the Teams tab)</div></span>
            <div className="flex rounded overflow-hidden border flex-shrink-0" style={{ borderColor: LINE }}>
              {[['overall', 'Overall'], ['divisional', 'Divisional'], ['wbc', 'WBC-style']].map(([m, label]) => (
                <button key={m} onClick={() => saveSettings({ ...settings, playoffFormat: m })} className="px-2.5 py-1 text-xs font-semibold" style={{ background: (settings.playoffFormat || 'overall') === m ? PRIMARY : 'transparent', color: (settings.playoffFormat || 'overall') === m ? INK : CHALK_DIM }}>{label}</button>
              ))}
            </div>
          </div>
          {settings.playoffFormat === 'wbc' && (
            <label className="flex items-center justify-between gap-2" style={{ color: CHALK }}>
              <span>Advance per group<div className="text-[11px]" style={{ color: CHALK_DIM }}>How many teams from each group (division) move on to the knockout stage</div></span>
              <NumInput value={settings.groupAdvanceCount || 2} min={1} max={8} onChange={v => saveSettings({ ...settings, groupAdvanceCount: v })} w="w-16" />
            </label>
          )}
          <label className="flex items-center justify-between gap-2" style={{ color: CHALK }}>
            <span>Reseed each round<div className="text-[11px]" style={{ color: CHALK_DIM }}>Best remaining seed always plays the worst remaining seed (like the NFL) instead of following fixed bracket slots</div></span>
            <input type="checkbox" checked={!!settings.reseedPlayoffs} onChange={e => saveSettings({ ...settings, reseedPlayoffs: e.target.checked })} style={{ accentColor: PRIMARY, width: 18, height: 18 }} />
          </label>
          <label className="flex items-center justify-between gap-2" style={{ color: CHALK }}>
            <span>Play-in tournament<div className="text-[11px]" style={{ color: CHALK_DIM }}>Number of bubble teams (0 = off) that play a single-elimination mini-bracket for the final playoff spot, instead of it going straight to the next-best record</div></span>
            <NumInput value={settings.playInTeams || 0} min={0} max={8} onChange={v => saveSettings({ ...settings, playInTeams: v })} w="w-16" />
          </label>
          <label className="flex items-center justify-between gap-2" style={{ color: CHALK }}>
            <span>Playoff series length<div className="text-[11px]" style={{ color: CHALK_DIM }}>Default games per round — higher seed hosts more of them</div></span>
            <div className="flex rounded overflow-hidden border" style={{ borderColor: LINE }}>
              {[1, 3, 5, 7].map(n => (
                <button key={n} onClick={() => saveSettings({ ...settings, seriesLength: n })} className="px-2.5 py-1 text-xs font-semibold" style={{ background: (settings.seriesLength || 1) === n ? PRIMARY : 'transparent', color: (settings.seriesLength || 1) === n ? INK : CHALK_DIM }}>Bo{n}</button>
              ))}
            </div>
          </label>
          {(() => {
            const roundsCount = Math.max(1, Math.log2(nextPow2(Math.max(1, settings.playoffSpots))));
            const roundNames = (i) => i === 0 ? 'Round 1' : i === roundsCount - 1 ? 'Final' : `Round ${i + 1}`;
            return (
              <div className="pt-1" style={{ borderTop: `1px solid ${LINE}` }}>
                <div className="text-xs font-semibold mb-2" style={{ color: CHALK }}>Series length by round<div className="text-[11px] font-normal" style={{ color: CHALK_DIM }}>Override the default above for specific rounds (e.g. wild card round shorter, final longer)</div></div>
                <div className="flex flex-wrap gap-3">
                  {Array.from({ length: roundsCount }).map((_, i) => {
                    const round = i + 1;
                    const val = getSeriesLength(settings, round);
                    return (
                      <label key={i} className="flex flex-col items-center gap-1" style={{ color: CHALK }}>
                        <span className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>{roundNames(i)}</span>
                        <input value={(settings.playoffRoundNames && settings.playoffRoundNames[String(round)]) || ''}
                          onChange={e => saveSettings({ ...settings, playoffRoundNames: { ...(settings.playoffRoundNames || {}), [String(round)]: e.target.value } })}
                          placeholder={getPlayoffRoundName({}, round, roundsCount)}
                          className="w-24 bg-[#242424] border rounded px-1.5 py-1 text-center text-[11px]" style={{ borderColor: LINE, color: CHALK }} />
                        <div className="flex rounded overflow-hidden border" style={{ borderColor: LINE }}>
                          {[1, 3, 5, 7].map(n => (
                            <button key={n} onClick={() => {
                              const arr = Array.from({ length: roundsCount }, (_, ri) => getSeriesLength(settings, ri + 1));
                              arr[i] = n;
                              saveSettings({ ...settings, seriesLengths: arr });
                            }} className="px-2 py-1 text-[11px] font-semibold" style={{ background: val === n ? PRIMARY : 'transparent', color: val === n ? INK : CHALK_DIM }}>{n}</button>
                          ))}
                        </div>
                      </label>
                    );
                  })}
                </div>
                {Array.isArray(settings.seriesLengths) && (
                  <button onClick={() => { const s = { ...settings }; delete s.seriesLengths; saveSettings(s); }} className="text-[11px] mt-2" style={{ color: CHALK_DIM }}>Reset to default for all rounds</button>
                )}
              </div>
            );
          })()}
          <label className="flex items-center justify-between gap-2" style={{ color: CHALK }}>
            <span>Home-field advantage<div className="text-[11px]" style={{ color: CHALK_DIM }}>Win-probability points added to the home team in playoff games</div></span>
            <NumInput value={settings.homeFieldBoost} min={0} max={20} onChange={v => saveSettings({ ...settings, homeFieldBoost: v })} w="w-16" />
          </label>
          <label className="flex items-center justify-between gap-2" style={{ color: CHALK }}>
            <span>Simulation runs<div className="text-[11px]" style={{ color: CHALK_DIM }}>More runs = steadier playoff odds, slower to compute</div></span>
            <NumInput value={settings.simRuns} min={100} max={20000} step={100} onChange={v => saveSettings({ ...settings, simRuns: v })} w="w-20" />
          </label>
          <label className="flex items-center justify-between gap-2" style={{ color: CHALK }}>
            <span>Standard {sport.periodPlural}<div className="text-[11px]" style={{ color: CHALK_DIM }}>Used to flag extra-{sport.periodPlural} games</div></span>
            <NumInput value={settings.standardInnings} min={1} max={15} onChange={v => saveSettings({ ...settings, standardInnings: v })} w="w-16" />
          </label>
          <label className="flex items-center justify-between gap-2" style={{ color: CHALK }}>
            <span>Odds decimal places<div className="text-[11px]" style={{ color: CHALK_DIM }}>Precision shown on the Odds tab</div></span>
            <NumInput value={settings.oddsDecimals} min={0} max={2} onChange={v => saveSettings({ ...settings, oddsDecimals: v })} w="w-14" />
          </label>
          <div className="flex items-center justify-between gap-2" style={{ color: CHALK }}>
            <span>Schedule labels<div className="text-[11px]" style={{ color: CHALK_DIM }}>How games are grouped and labeled</div></span>
            <div className="flex rounded overflow-hidden border" style={{ borderColor: LINE }}>
              {['date', 'round'].map(m => (
                <button key={m} onClick={() => saveSettings({ ...settings, scheduleMode: m })} className="px-2.5 py-1 text-xs font-semibold capitalize" style={{ background: settings.scheduleMode === m ? PRIMARY : 'transparent', color: settings.scheduleMode === m ? INK : CHALK_DIM }}>{m}</button>
              ))}
            </div>
          </div>
        </div>
      </Panel>
      )}
      {canManageSettings && (
        <Panel>
          <SectionTitle>Odds display</SectionTitle>
          <div className="px-4 pb-3 text-sm space-y-3">
            <div className="flex items-center justify-between gap-2" style={{ color: CHALK }}>
              <span>Default odds format<div className="text-[11px]" style={{ color: CHALK_DIM }}>Percent chance, or American moneyline ("+125") — visitors can override this for themselves from the Odds tab</div></span>
              <div className="flex rounded overflow-hidden border" style={{ borderColor: LINE }}>
                {['percent', 'american'].map(m => (
                  <button key={m} onClick={() => saveSettings({ ...settings, oddsFormat: m })} className="px-2.5 py-1 text-xs font-semibold capitalize" style={{ background: (settings.oddsFormat || 'percent') === m ? PRIMARY : 'transparent', color: (settings.oddsFormat || 'percent') === m ? INK : CHALK_DIM }}>{m}</button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2" style={{ color: CHALK }}>
              <span>Roster limit<div className="text-[11px]" style={{ color: CHALK_DIM }}>Max players per team this season — flags any team over the limit on Roster/Teams. 0 = no limit</div></span>
              <NumInput value={settings.rosterLimit || 0} min={0} max={99} onChange={v => saveSettings({ ...settings, rosterLimit: v })} w="w-16" />
            </div>
          </div>
        </Panel>
      )}
      {showImportGroup && <SettingsGroupHeader label="Data import & sync" />}
      {canManageSchedule && (
        <ScheduleManagementPanel season={season} settings={settings} importGames={importGames} addManualGame={addManualGame} generateSchedule={generateSchedule} teamsById={teamsById} />
      )}
      {canManageSettings && <KpbImportPanel league={league} onRunImport={onRunKpbImport} />}
      {canManageSettings && <PlayerIdentitySyncPanel onRunSync={onSyncPlayerIdentities} />}
      {canManageSettings && <SettingsGroupHeader label="Appearance" />}
      <AppearanceSettings theme={theme} saveTheme={saveTheme} />
    </div>
  );
}
/* ==================================================================== */
/* Teams (season roster) view                                            */
/* ==================================================================== */
// Generic paste → preview → (resolve unmatched teams) → import panel, shared
// by the draft-board and star-rating importers below — same shape as the
// roster sheet importer just above (textarea, preview list, a resolver for
// any team name that didn't match one already on file), just without that
// one's per-team roster-replace semantics since these two apply narrower
// per-row edits (a draft pick, a star rating) instead of declaring a whole
// roster.
function SheetTextImportPanel({ title, placeholder, description, parseFn, renderRow, onImport, summaryText, teamsIndex, borderColor = PRIMARY }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [items, setItems] = useState(null);
  const [resolutions, setResolutions] = useState({});
  const preview = () => { setItems(parseFn(text)); setResolutions({}); };
  const unmatchedNames = items
    ? [...new Set(items.map(it => it.teamName).filter(Boolean))].filter(n => !teamsIndex.some(t => normalizeTeamName(t.name) === normalizeTeamName(n)))
    : [];
  const reset = () => { setItems(null); setText(''); setResolutions({}); setOpen(false); };
  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    // parseFn already reads tab-separated or comma-CSV rows either way
    // (splitSheetLine detects which), so a raw CSV file's text drops
    // straight into the same pipeline as pasted text — no separate parser
    // needed to "detect" the file's columns.
    reader.onload = () => { setText(String(reader.result || '')); setItems(null); setResolutions({}); };
    reader.readAsText(f);
    e.target.value = '';
  };
  return (
    <Panel className="overflow-hidden" style={{ borderColor }}>
      <SectionTitle accent={borderColor} right={<button onClick={() => setOpen(v => !v)} className="text-[11px] font-bold" style={{ color: borderColor }}>{open ? 'Hide' : 'Import'}</button>}>{title}</SectionTitle>
      {open && (
        <div className="px-4 pb-3 space-y-2">
          <p className="text-xs" style={{ color: CHALK_DIM }}>{description}</p>
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-semibold cursor-pointer" style={{ background: PANEL2, color: CHALK, border: `1px solid ${LINE}` }}>
            <Upload size={14} /> Choose .csv file
            <input type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
          </label>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={5} placeholder={placeholder} className="w-full bg-[#242424] border rounded px-3 py-2 text-xs font-mono" style={{ borderColor: LINE, color: CHALK }} />
          <button onClick={preview} disabled={!text.trim()} className="px-3 py-2 rounded font-bold text-sm disabled:opacity-40" style={{ background: borderColor, color: INK }}>Preview import</button>
          {items && (
            <div className="rounded-lg border" style={{ borderColor: LINE }}>
              {items.length === 0 ? (
                <p className="px-3 py-3 text-xs" style={{ color: NEGATIVE }}>Couldn't find any rows to import in that text.</p>
              ) : (
                <>
                  <div className="max-h-56 overflow-y-auto divide-y" style={{ borderColor: LINE }}>
                    {items.map((it, i) => <div key={i} className="px-3 py-2 text-xs" style={{ color: CHALK }}>{renderRow(it)}</div>)}
                  </div>
                  {unmatchedNames.length > 0 && (
                    <div className="px-3 py-2 space-y-1.5" style={{ borderTop: `1px solid ${LINE}` }}>
                      <p className="text-[11px] font-semibold" style={{ color: GOLD }}>These team names don't match anything on file (probably a rebrand this sheet predates) — pick the right team, or leave it to create a new one:</p>
                      {unmatchedNames.map(n => (
                        <div key={n} className="flex items-center justify-between gap-2">
                          <span className="text-xs truncate" style={{ color: CHALK }}>{n}</span>
                          <select value={resolutions[n] || ''} onChange={e => setResolutions(r => ({ ...r, [n]: e.target.value }))} className="bg-[#242424] border rounded px-1.5 py-1 text-[11px]" style={{ borderColor: GOLD, color: CHALK }}>
                            <option value="" style={{ background: PANEL2, color: CHALK }}>Create new team "{n}"</option>
                            {[...teamsIndex].sort((a, c) => a.name.localeCompare(c.name)).map(t => <option key={t.id} value={t.id} style={{ background: PANEL2, color: CHALK }}>Actually: {t.name}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end gap-2 px-3 py-2">
                    <button onClick={reset} className="text-xs" style={{ color: CHALK_DIM }}>Cancel</button>
                    <button onClick={() => { onImport(items, resolutions); reset(); }} className="px-3 py-1.5 rounded font-bold text-xs" style={{ background: borderColor, color: INK }}>{summaryText(items)}</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// A live, real-time draft-day board — add one pick at a time as the draft
// actually happens, instead of pasting the whole finished board afterward
// (SheetTextImportPanel above still covers that case). Every visitor sees
// picks the moment an admin saves them, same as anything else on the site.
function LiveDraftBoardPanel({ season, teamsById, isLoggedIn, onAddLiveDraftPick }) {
  const picks = season.liveDraftPicks || [];
  const [round, setRound] = useState(1);
  const [pickInRound, setPickInRound] = useState(1);
  const [teamId, setTeamId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const submit = () => {
    if (!teamId || !playerName.trim()) return;
    onAddLiveDraftPick(round, pickInRound, teamId, playerName);
    setPlayerName('');
    setPickInRound(n => n + 1);
  };
  if (!isLoggedIn && picks.length === 0) return null;
  return (
    <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
      <SectionTitle accent={GOLD}>Live draft board{picks.length > 0 ? ` (${picks.length} picks)` : ''}</SectionTitle>
      {isLoggedIn && (
        <div className="px-4 pb-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1"><span className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>Round</span><input type="number" min="1" value={round} onChange={e => setRound(Number(e.target.value) || 1)} className="w-16 bg-[#242424] border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, color: CHALK }} /></label>
          <label className="flex flex-col gap-1"><span className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>Pick</span><input type="number" min="1" value={pickInRound} onChange={e => setPickInRound(Number(e.target.value) || 1)} className="w-16 bg-[#242424] border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, color: CHALK }} /></label>
          <label className="flex flex-col gap-1 flex-1 min-w-[140px]"><span className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>Team</span>
            <select value={teamId} onChange={e => setTeamId(e.target.value)} className="bg-[#242424] border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, color: CHALK }}>
              <option value="">Select team…</option>
              {season.members.map(m => <option key={m.teamId} value={m.teamId} style={{ background: PANEL2, color: CHALK }}>{(teamsById[m.teamId] && teamsById[m.teamId].name) || m.scheduleName}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[140px]"><span className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>Player</span><input value={playerName} onChange={e => setPlayerName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} className="bg-[#242424] border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, color: CHALK }} /></label>
          <button onClick={submit} disabled={!teamId || !playerName.trim()} className="px-3 py-2 rounded font-bold text-sm disabled:opacity-40" style={{ background: GOLD, color: INK }}>Add pick</button>
        </div>
      )}
      {picks.length > 0 && (
        <div className="px-2 pb-2 max-h-64 overflow-y-auto">
          {[...picks].reverse().map((p, i) => {
            const t = teamsById[p.teamId];
            return (
              <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 text-sm" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
                <span className="w-16 flex-shrink-0 font-mono text-xs" style={{ color: CHALK_DIM }}>R{p.round} P{p.pickInRound}</span>
                {t && <TeamMark team={t} size={14} />}
                <span className="flex-1 truncate" style={{ color: CHALK }}>{p.playerName}</span>
                <span className="text-xs" style={{ color: CHALK_DIM }}>{t ? t.name : ''}</span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
function TeamsView({ season, teamsById, teamsIndex, addExistingTeam, createAndAddTeam, updateMemberField, updateGlobalTeamField, removeMember, onOpenTeam, importRosterSheet, importDraftBoard, importStarsSheet, addDivision, updateDivision, removeDivision, assignMemberDivision, settings, onAddLiveDraftPick }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageRosters');
  const [name, setName] = useState('');
  const [pickId, setPickId] = useState('');
  const [sheetText, setSheetText] = useState('');
  const [sheetPreview, setSheetPreview] = useState(null);
  const [sheetResolutions, setSheetResolutions] = useState({});
  const [showSheetImport, setShowSheetImport] = useState(false);
  const [search, setSearch] = useState('');
  const memberIds = new Set(season.members.map(m => m.teamId));
  const available = teamsIndex.filter(t => !memberIds.has(t.id));

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const teamHits = season.members.filter(m => {
      const gt = teamsById[m.teamId];
      return (gt && gt.name.toLowerCase().includes(q)) || (m.scheduleName || '').toLowerCase().includes(q);
    }).map(m => ({ type: 'team', teamId: m.teamId, name: (teamsById[m.teamId] && teamsById[m.teamId].name) || m.scheduleName }));
    const playerHits = [];
    season.members.forEach(m => {
      (m.roster || []).forEach(p => {
        if (p.name.toLowerCase().includes(q)) {
          playerHits.push({ type: 'player', teamId: m.teamId, name: p.name, teamName: (teamsById[m.teamId] && teamsById[m.teamId].name) || m.scheduleName });
        }
      });
    });
    return [...teamHits, ...playerHits];
  }, [search, season.members, teamsById]);

  const handleSheetFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setSheetText(String(reader.result || ''));
    reader.readAsText(f);
  };
  const runSheetPreview = () => { setSheetPreview(parseRosterSheetCsv(sheetText)); setSheetResolutions({}); };

  return (
    <div className="p-3 space-y-3">
      <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
        <SectionTitle accent={PRIMARY}>Search teams &amp; players</SectionTitle>
        <div className="px-4 pb-3 space-y-2">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search this season…" className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
          {searchResults && (
            <div className="rounded-lg border max-h-56 overflow-y-auto" style={{ borderColor: LINE }}>
              {searchResults.length === 0 && <p className="px-3 py-3 text-xs" style={{ color: CHALK_DIM }}>No matches.</p>}
              {searchResults.map((r, i) => (
                <button key={i} onClick={() => onOpenTeam(r.teamId)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
                  {r.type === 'team' ? <Users size={13} style={{ color: PRIMARY }} /> : <span style={{ fontSize: 11, color: CHALK_DIM }}>●</span>}
                  <span style={{ color: CHALK }}>{r.name}</span>
                  {r.type === 'player' && <span className="text-xs" style={{ color: CHALK_DIM }}>({r.teamName})</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </Panel>
      <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
        <SectionTitle accent={PRIMARY}>Add a team to this season</SectionTitle>
        <fieldset disabled={!isLoggedIn} className="contents">
        <div className="px-4 pb-3 space-y-3">
          <div className="flex gap-2">
            <select value={pickId} onChange={e => setPickId(e.target.value)} className="flex-1 bg-[#242424] border rounded px-2 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }}>
              <option style={{ background: PANEL2, color: CHALK }} value="">Choose an existing team…</option>
              {available.map(t => <option style={{ background: PANEL2, color: CHALK }} key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button onClick={() => { if (pickId) { addExistingTeam(pickId); setPickId(''); } }} disabled={!pickId} className="px-3 py-2 rounded font-bold text-sm disabled:opacity-40" style={{ background: PRIMARY, color: INK }}>Add</button>
          </div>
          <div className="flex gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Or create a new team" className="flex-1 bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
            <button onClick={() => { if (name.trim()) { createAndAddTeam(name.trim()); setName(''); } }} className="px-3 py-2 rounded font-bold text-sm flex items-center gap-1" style={{ background: PRIMARY, color: INK }}><Plus size={16} /> Create</button>
          </div>
        </div>
        </fieldset>
      </Panel>

      <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
        <SectionTitle accent={PRIMARY} right={<button onClick={() => setShowSheetImport(v => !v)} disabled={!isLoggedIn} className="text-[11px] font-bold disabled:opacity-40" style={{ color: PRIMARY }}>{showSheetImport ? 'Hide' : 'Import'}</button>}>Import a full roster sheet</SectionTitle>
        {showSheetImport && isLoggedIn && (
          <div className="px-4 pb-3 space-y-2">
            <p className="text-xs" style={{ color: CHALK_DIM }}>Paste or upload a CSV export of a roster spreadsheet with several teams laid out side by side — either "Team | Role | Username | Stars" blocks, or just a team name in the header row with a bare username per row underneath it (several such sections can be stacked, separated by a blank row). Teams are matched by name — new ones are created automatically. Re-importing replaces each matched team's roster with what's in the sheet, so it always matches exactly (no duplicate or stale players left behind).</p>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-semibold cursor-pointer" style={{ background: PANEL2, color: CHALK, border: `1px solid ${LINE}` }}>
              <Upload size={14} /> Choose .csv file
              <input type="file" accept=".csv,.txt" className="hidden" onChange={handleSheetFile} />
            </label>
            <textarea value={sheetText} onChange={e => setSheetText(e.target.value)} rows={5} placeholder="Paste roster sheet CSV here…" className="w-full bg-[#242424] border rounded px-3 py-2 text-xs font-mono" style={{ borderColor: LINE, color: CHALK }} />
            <button onClick={runSheetPreview} disabled={!sheetText.trim()} className="px-3 py-2 rounded font-bold text-sm disabled:opacity-40" style={{ background: PRIMARY, color: INK }}>Preview import</button>
            {sheetPreview && (
              <div className="rounded-lg border" style={{ borderColor: LINE }}>
                {sheetPreview.length === 0 ? (
                  <p className="px-3 py-3 text-xs" style={{ color: NEGATIVE }}>Couldn't find any team blocks in that file — check that each team has a header row (either "Team | Name | Stars" labels, or just the team's name) followed by its players.</p>
                ) : (
                  <>
                    <div className="max-h-56 overflow-y-auto divide-y" style={{ borderColor: LINE }}>
                      {sheetPreview.map((b, i) => {
                        const existing = teamsIndex.find(t => normalizeTeamName(t.name) === normalizeTeamName(b.teamName));
                        return (
                          <div key={i} className="px-3 py-2 text-xs">
                            <div className="flex items-center gap-2 flex-wrap">
                              {existing ? <Check size={12} style={{ color: WIN }} /> : <Plus size={12} style={{ color: GOLD }} />}
                              <span className="font-bold" style={{ color: CHALK }}>{b.teamName}</span>
                              <span style={{ color: CHALK_DIM }}>{existing ? '(existing team)' : '(no exact match)'} · {b.players.length} players</span>
                              {!existing && (
                                <select value={sheetResolutions[b.teamName] || ''} onChange={e => setSheetResolutions(r => ({ ...r, [b.teamName]: e.target.value }))} className="bg-[#242424] border rounded px-1.5 py-1 text-[11px]" style={{ borderColor: GOLD, color: CHALK }}>
                                  <option value="" style={{ background: PANEL2, color: CHALK }}>Create new team "{b.teamName}"</option>
                                  {[...teamsIndex].sort((a, c) => a.name.localeCompare(c.name)).map(t => <option key={t.id} value={t.id} style={{ background: PANEL2, color: CHALK }}>Actually: {t.name}</option>)}
                                </select>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-end gap-2 px-3 py-2">
                      <button onClick={() => { setSheetPreview(null); setSheetText(''); setSheetResolutions({}); setShowSheetImport(false); }} className="text-xs" style={{ color: CHALK_DIM }}>Cancel</button>
                      <button onClick={() => { importRosterSheet(sheetPreview, sheetResolutions); setSheetPreview(null); setSheetText(''); setSheetResolutions({}); setShowSheetImport(false); }} className="px-3 py-1.5 rounded font-bold text-xs" style={{ background: PRIMARY, color: INK }}>Import {sheetPreview.reduce((s, b) => s + b.players.length, 0)} players across {sheetPreview.length} teams</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Panel>
      {isLoggedIn && (
        <SheetTextImportPanel
          title="Import a draft board" borderColor={GOLD} teamsIndex={teamsIndex}
          description={'Paste a draft board — one row per pick, shaped like "R1 P1 | Team | Player | #1" (a ROUND N row above each round is fine, it\'s ignored — the round/pick number comes from the R#P# label). Sets each player\'s draft pick; creates them on that team if they aren\'t tracked yet.'}
          placeholder={'R1 P1\tLA Stars\t2facedyam\t#1\nR1 P2\tPittsburg Stallions\tAceelord\t#2'}
          parseFn={parseDraftBoardSheet}
          renderRow={(p) => <>Round {p.round}, Pick {p.pickInRound}{p.overall ? ` (#${p.overall} overall)` : ''} — <span className="font-bold">{p.teamName}</span>: {p.playerName}</>}
          summaryText={(items) => `Import ${items.length} draft picks`}
          onImport={(items, resolutions) => importDraftBoard(items, resolutions)}
        />
      )}
      {isLoggedIn && (
        <SheetTextImportPanel
          title="Import star ratings" borderColor={GOLD} teamsIndex={teamsIndex}
          description="Paste a flat Team/Player/Stars sheet (team repeats per row, or leave it blank for a free agent). Applies each rating to that player — creates them (on that team, or as a free agent) if they aren't tracked yet. Not treated as a full roster: players missing from the sheet are left alone."
          placeholder={'Anaheim\txjrdnz\t4.5\nAnaheim\tJoshyboyhitsbombs\t4.5\n\tWorldNutCon\t4.5'}
          parseFn={parseStarsSheet}
          renderRow={(r) => <>{r.starLevel != null ? `${r.starLevel}★` : 'R'} — {r.teamName ? <><span className="font-bold">{r.teamName}</span>: </> : <span style={{ color: CHALK_DIM }}>(free agent) </span>}{r.playerName}</>}
          summaryText={(items) => `Import ${items.length} star ratings`}
          onImport={(items, resolutions) => importStarsSheet(items, resolutions)}
        />
      )}
      {onAddLiveDraftPick && <LiveDraftBoardPanel season={season} teamsById={teamsById} isLoggedIn={isLoggedIn} onAddLiveDraftPick={onAddLiveDraftPick} />}
      <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
        <SectionTitle accent={PRIMARY}>Roster, colors &amp; logos</SectionTitle>
        <fieldset disabled={!isLoggedIn} className="contents">
        <div className="px-3 pb-3 space-y-3">
          {season.members.length === 0 && <p className="px-1 py-4 text-sm" style={{ color: CHALK_DIM }}>No teams yet.</p>}
          {season.members.map(m => {
            const gt = teamsById[m.teamId] || { id: m.teamId, name: m.scheduleName, color: null, logoUrl: null, wordmarkUrl: null };
            const rosterLimit = settings && settings.rosterLimit;
            const overLimit = rosterLimit > 0 && (m.roster || []).length > rosterLimit;
            return (
              <div key={m.teamId} className="rounded-lg p-3" style={{ background: PANEL2, border: `1px solid ${LINE}`, borderLeft: `4px solid ${teamColor(gt)}`, opacity: m.active === false ? 0.55 : 1 }}>
                <div className="flex items-center gap-2 mb-2">
                  <button onClick={() => onOpenTeam(m.teamId)} className="flex-1 min-w-0 text-left text-sm font-semibold truncate" style={{ color: CHALK }}>{gt.name}</button>
                  {overLimit && <span title={`Over the ${rosterLimit}-player roster limit`} className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: `${NEGATIVE}22`, color: NEGATIVE }}>{(m.roster || []).length}/{rosterLimit}</span>}
                  <button onClick={() => updateMemberField(m.teamId, 'active', m.active === false ? true : false)} className="text-[10px] px-2 py-1 rounded font-semibold flex-shrink-0" style={{ background: PANEL, color: m.active === false ? GOLD : CHALK_DIM, border: `1px solid ${LINE}` }}>
                    {m.active === false ? 'Inactive' : 'Active'}
                  </button>
                  <button onClick={() => { if (confirm(`Remove ${gt.name} from this season?`)) removeMember(m.teamId); }} className="p-1.5 rounded flex-shrink-0" style={{ color: NEGATIVE }}><Trash2 size={14} /></button>
                </div>
                <div className="flex items-center gap-3 flex-wrap pl-1 mb-2">
                  <span className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>Matches schedule text:</span>
                  <input value={m.scheduleName ?? gt.name} onChange={e => updateMemberField(m.teamId, 'scheduleName', e.target.value)} className="flex-1 min-w-[100px] bg-[#242424] border rounded px-2 py-1 text-xs" style={{ borderColor: LINE, color: CHALK }} />
                </div>
                <div className="flex items-center gap-3 flex-wrap pl-1 mb-2">
                  <span className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>Manager:</span>
                  {(() => {
                    const pmPlayer = (m.roster || []).find(p => (p.role || '').trim().toUpperCase() === 'PM');
                    return pmPlayer
                      ? <span className="flex-1 min-w-[100px] text-xs px-2 py-1" style={{ color: CHALK }}>{pmPlayer.name} <span style={{ color: CHALK_DIM }}>(from roster PM slot)</span></span>
                      : <input value={m.managerName || ''} onChange={e => updateMemberField(m.teamId, 'managerName', e.target.value)} placeholder="Optional" className="flex-1 min-w-[100px] bg-[#242424] border rounded px-2 py-1 text-xs" style={{ borderColor: LINE, color: CHALK }} />;
                  })()}
                </div>
                {(season.divisions || []).length > 0 && (
                  <div className="flex items-center gap-3 flex-wrap pl-1 mb-2">
                    <span className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>Division:</span>
                    <select value={m.divisionId || ''} onChange={e => assignMemberDivision(m.teamId, e.target.value)} className="flex-1 min-w-[100px] bg-[#242424] border rounded px-2 py-1 text-xs" style={{ borderColor: LINE, color: CHALK }}>
                      <option style={{ background: PANEL2, color: CHALK }} value="">Unassigned</option>
                      {season.divisions.map(d => <option style={{ background: PANEL2, color: CHALK }} key={d.id} value={d.id}>{d.conference ? `${d.conference} — ${d.name}` : d.name}</option>)}
                    </select>
                  </div>
                )}
                <BrandEditor gt={gt} updateGlobalTeamField={updateGlobalTeamField} />
              </div>
            );
          })}
        </div>
        </fieldset>
      </Panel>

      <DivisionsPanel divisions={season.divisions || []} addDivision={addDivision} updateDivision={updateDivision} removeDivision={removeDivision} />
    </div>
  );
}

function DivisionsPanel({ divisions, addDivision, updateDivision, removeDivision }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageRosters');
  const [name, setName] = useState('');
  const [conference, setConference] = useState('');
  const [editingId, setEditingId] = useState(null);
  return (
    <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
      <SectionTitle accent={PRIMARY}>Divisions &amp; conferences</SectionTitle>
      <fieldset disabled={!isLoggedIn} className="contents">
      <div className="px-4 pb-2 space-y-2">
        <p className="text-xs" style={{ color: CHALK_DIM }}>Optional — group teams into divisions (and divisions into conferences) for grouped standings and, if you turn on "Divisional" playoff format in Settings, guaranteed division-winner seeds plus wild cards.</p>
        <div className="flex gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Division name (e.g. East)" className="flex-1 bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
          <input value={conference} onChange={e => setConference(e.target.value)} placeholder="Conference (optional)" className="flex-1 bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
        </div>
        <button onClick={() => { if (name.trim()) { addDivision(name.trim(), conference.trim()); setName(''); setConference(''); } }} className="px-3 py-2 rounded font-bold text-sm flex items-center gap-1" style={{ background: PRIMARY, color: INK }}><Plus size={16} /> Add division</button>
      </div>
      <div className="px-2 pb-2">
        {divisions.length === 0 && <p className="px-2 py-3 text-sm" style={{ color: CHALK_DIM }}>No divisions yet.</p>}
        {divisions.map(d => (
          <div key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm" style={{ borderTop: `1px solid ${LINE}` }}>
            {editingId === d.id ? (
              <>
                <input value={d.name} onChange={e => updateDivision(d.id, 'name', e.target.value)} className="flex-1 min-w-0 bg-[#242424] border rounded px-2 py-1 text-xs" style={{ borderColor: LINE, color: CHALK }} />
                <input value={d.conference || ''} onChange={e => updateDivision(d.id, 'conference', e.target.value)} placeholder="Conference" className="flex-1 min-w-0 bg-[#242424] border rounded px-2 py-1 text-xs" style={{ borderColor: LINE, color: CHALK }} />
                <button onClick={() => setEditingId(null)} className="p-1" style={{ color: WIN }}><Check size={16} /></button>
              </>
            ) : (
              <>
                <span className="flex-1 min-w-0 truncate" style={{ color: CHALK }}>{d.conference ? `${d.conference} — ${d.name}` : d.name}</span>
                <button onClick={() => setEditingId(d.id)} className="p-1" style={{ color: CHALK_DIM }}><Pencil size={13} /></button>
                <button onClick={() => removeDivision(d.id)} className="p-1" style={{ color: NEGATIVE }}><Trash2 size={13} /></button>
              </>
            )}
          </div>
        ))}
      </div>
      </fieldset>
    </Panel>
  );
}

/* ==================================================================== */
/* Schedule view                                                         */
/* ==================================================================== */
function ScheduleBalanceChecker({ season, teamsById }) {
  const [open, setOpen] = useState(false);
  const stats = {};
  season.members.forEach(m => { stats[m.teamId] = { home: 0, away: 0, opponents: {} }; });
  (season.games || []).filter(g => !g.isPlayoff && !g.isPlayIn && g.homeTeamId && g.awayTeamId).forEach(g => {
    if (stats[g.homeTeamId]) { stats[g.homeTeamId].home++; stats[g.homeTeamId].opponents[g.awayTeamId] = (stats[g.homeTeamId].opponents[g.awayTeamId] || 0) + 1; }
    if (stats[g.awayTeamId]) { stats[g.awayTeamId].away++; stats[g.awayTeamId].opponents[g.homeTeamId] = (stats[g.awayTeamId].opponents[g.homeTeamId] || 0) + 1; }
  });
  const rows = season.members.map(m => {
    const s = stats[m.teamId] || { home: 0, away: 0, opponents: {} };
    const total = s.home + s.away;
    const oppCounts = Object.values(s.opponents);
    const oppSpread = oppCounts.length ? Math.max(...oppCounts) - Math.min(...oppCounts) : 0;
    return { teamId: m.teamId, name: (teamsById[m.teamId] && teamsById[m.teamId].name) || m.scheduleName, home: s.home, away: s.away, total, homeAwayGap: Math.abs(s.home - s.away), oppSpread };
  });
  const flagged = rows.filter(r => r.total > 0 && (r.homeAwayGap >= 3 || r.oppSpread >= 2));
  if (rows.every(r => r.total === 0)) return null;
  return (
    <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
      <SectionTitle accent={PRIMARY} right={<button onClick={() => setOpen(v => !v)} className="text-[11px] font-bold" style={{ color: PRIMARY }}>{open ? 'Hide' : 'Check'}</button>}>Schedule balance</SectionTitle>
      {!open ? (
        <p className="px-4 pb-3 text-xs" style={{ color: CHALK_DIM }}>{flagged.length === 0 ? 'No major home/away or opponent-count imbalances detected.' : `${flagged.length} team${flagged.length === 1 ? '' : 's'} with a notable imbalance — tap Check for details.`}</p>
      ) : (
        <>
          <div className="px-2 pb-2">
            {rows.map(r => (
              <div key={r.teamId} className="flex items-center gap-2 px-2 py-1.5 text-sm" style={{ borderTop: `1px solid ${LINE}` }}>
                <span className="flex-1 truncate" style={{ color: CHALK }}>{r.name}</span>
                <span className="font-mono text-xs" style={{ color: r.homeAwayGap >= 3 ? GOLD : CHALK_DIM }}>{r.home}H-{r.away}A</span>
                <span className="font-mono text-xs" style={{ color: r.oppSpread >= 2 ? GOLD : CHALK_DIM }}>opp spread {r.oppSpread}</span>
              </div>
            ))}
          </div>
          <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>Flags a team in gold when their home/away split differs by 3+ games, or when they play some opponents notably more than others (spread of 2+ meetings).</p>
        </>
      )}
    </Panel>
  );
}

function RoundRobinGenerator({ season, teamsById, generateSchedule }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageSchedule');
  const [selected, setSelected] = useState(() => new Set(season.members.map(m => m.teamId)));
  const [roundsOfPlay, setRoundsOfPlay] = useState(2);
  const [open, setOpen] = useState(false);
  const [autoDate, setAutoDate] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [blackout, setBlackout] = useState(() => new Set(season.settings.blackoutWeekdays || []));
  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleBlackout = (day) => setBlackout(s => { const n = new Set(s); n.has(day) ? n.delete(day) : n.add(day); return n; });
  const count = selected.size;
  const gamesPreview = count >= 2 ? count * (count - 1) / 2 * roundsOfPlay : 0;
  return (
    <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
      <SectionTitle accent={PRIMARY} right={isLoggedIn && <button onClick={() => setOpen(v => !v)} className="text-[11px] font-bold" style={{ color: PRIMARY }}>{open ? 'Hide' : 'Open'}</button>}>Generate round-robin schedule</SectionTitle>
      {open && isLoggedIn && (
        <div className="px-4 pb-3 space-y-3">
          <p className="text-xs" style={{ color: CHALK_DIM }}>Automatically builds a full schedule where every selected team plays every other one evenly — no manual entry needed. Adds to whatever's already on the schedule.</p>
          <div className="flex flex-wrap gap-2">
            {season.members.map(m => {
              const gt = teamsById[m.teamId];
              const on = selected.has(m.teamId);
              return <button key={m.teamId} onClick={() => toggle(m.teamId)} className="text-xs px-2 py-1 rounded font-semibold" style={{ background: on ? PRIMARY : PANEL2, color: on ? INK : CHALK_DIM, border: `1px solid ${LINE}` }}>{gt ? gt.name : m.scheduleName}</button>;
            })}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm" style={{ color: CHALK }}>Times each pair plays</span>
            <NumInput value={roundsOfPlay} min={1} max={10} onChange={setRoundsOfPlay} w="w-16" />
          </div>
          <p className="text-xs font-mono" style={{ color: CHALK_DIM }}>{count} teams selected → {gamesPreview} games</p>
          <label className="flex items-center gap-2 text-xs" style={{ color: CHALK_DIM }}>
            <input type="checkbox" checked={autoDate} onChange={e => setAutoDate(e.target.checked)} style={{ accentColor: PRIMARY }} /> Auto-assign a real date to each round instead of "Round N"
          </label>
          {autoDate && (
            <div className="space-y-2 pl-1">
              <div>
                <div className="text-[10px] uppercase mb-1" style={{ color: CHALK_DIM }}>First round's date</div>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-[#242424] border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, color: CHALK }} />
              </div>
              <div>
                <div className="text-[10px] uppercase mb-1" style={{ color: CHALK_DIM }}>No games on</div>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAY_LABELS.map((label, day) => (
                    <button key={day} onClick={() => toggleBlackout(day)} className="text-xs px-2 py-1 rounded font-semibold" style={{ background: blackout.has(day) ? NEGATIVE : PANEL2, color: blackout.has(day) ? INK : CHALK_DIM, border: `1px solid ${LINE}` }}>{label}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <button onClick={() => { generateSchedule([...selected], roundsOfPlay, autoDate ? { startDate, blackoutWeekdays: [...blackout] } : null); setOpen(false); }} disabled={count < 2 || (autoDate && !startDate)} className="px-3 py-2 rounded font-bold text-sm disabled:opacity-40" style={{ background: PRIMARY, color: INK }}>Generate schedule</button>
        </div>
      )}
    </Panel>
  );
}

// Matches an OCR'd name against a team roster: exact first (normalized —
// lowercase, punctuation stripped), then a loose substring fallback, since
// in-game usernames often get a character or two mangled by the scan.
function matchRosterPlayer(name, roster) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(name);
  if (!n) return '';
  let hit = roster.find(p => norm(p.name) === n);
  if (hit) return hit.id;
  hit = roster.find(p => norm(p.name).includes(n) || n.includes(norm(p.name)));
  return hit ? hit.id : '';
}

/* ==================================================================== */
/* Player career stats                                                   */
/* ==================================================================== */

// Baseball box-score IP notation: the digits after the decimal point are
// OUTS (0, 1, or 2), not tenths — "5.2" means 5 innings + 2 outs.
function ipDisplayToOuts(ip) {
  const n = Number(ip) || 0;
  const whole = Math.trunc(n);
  const frac = Math.round((n - whole) * 10);
  return whole * 3 + Math.min(2, Math.max(0, frac));
}
function outsToIpDisplay(outs) {
  const o = Math.max(0, Math.round(outs));
  return `${Math.floor(o / 3)}.${o % 3}`;
}

// Coerces a saved stat row (game.playerStats[side][i]) to numbers, filling
// in defaults for fields older imports won't have (doubles/triples were
// added after the OCR importer shipped — home runs got the same treatment
// back when that was added, since the stat screen never reports it either).
function normalizeStatRow(row, extra) {
  return {
    ...extra,
    ab: Number(row.ab) || 0, r: Number(row.r) || 0, h: Number(row.h) || 0, rbi: Number(row.rbi) || 0,
    bb: Number(row.bb) || 0, so: Number(row.so) || 0, ip: Number(row.ip) || 0, ha: Number(row.ha) || 0,
    er: Number(row.er) || 0, bbAllowed: Number(row.bbAllowed) || 0, k: Number(row.k) || 0,
    hrAllowed: Number(row.hrAllowed) || 0, e: Number(row.e) || 0, hr: Number(row.hr) || 0,
    doubles: Number(row.doubles) || 0, triples: Number(row.triples) || 0,
    // Only set on rows that represent more than one game at once (e.g. an
    // hcbb.info season import) — sumPlayerTotals falls back to counting 1
    // per row (its long-standing behavior) when this is absent, since every
    // other row in the app is genuinely a single game's box score.
    g: row.g != null ? Number(row.g) || 0 : undefined,
  };
}

// A "career" spans season-roster entries that each get their own internal
// id (see addPlayer) — there's no persistent player identity in the data
// model, so career history is pulled together by a closure match instead:
// starting from the clicked name, pull in every roster/free-agent entry
// anywhere in the league that shares a Roblox account id with an already-
// matched entry, or whose current name or usernameHistory (past on-site
// names, tracked when a Roblox rename is detected) overlaps an already-
// matched entry's names. That lets a roster import that uses an old
// username — or a season recorded before a rename was resolved — still
// land on the same career instead of forking into a second identity.
// Returns every season/team this identity appears on, plus every per-game
// stat line saved against any of those entries.
function getPlayerCareerData(league, playerName) {
  const norm = (s) => (s || '').trim().toLowerCase();
  const allEntries = [];
  (league.seasons || []).forEach(season => {
    (season.members || []).forEach(member => {
      (member.roster || []).forEach(p => allEntries.push({ season, teamId: member.teamId, playerId: p.id, player: p }));
    });
    (season.freeAgents || []).forEach(p => allEntries.push({ season, teamId: null, playerId: p.id, player: p }));
  });
  const namesOf = (p) => [norm(p.name), ...((p.usernameHistory || []).map(norm))];
  const knownNames = new Set([norm(playerName)]);
  const knownIds = new Set();
  const matched = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    allEntries.forEach((entry, i) => {
      if (matched.has(i)) return;
      const rid = entry.player.robloxUserId ? String(entry.player.robloxUserId) : null;
      const names = namesOf(entry.player);
      if ((rid && knownIds.has(rid)) || names.some(n => knownNames.has(n))) {
        matched.add(i);
        changed = true;
        if (rid) knownIds.add(rid);
        names.forEach(n => knownNames.add(n));
      }
    });
  }
  const seasonsInfo = allEntries.filter((_, i) => matched.has(i));
  const gameLog = [];
  seasonsInfo.forEach(info => {
    // A season flagged as a one-off tournament (e.g. a WBC-style event)
    // still shows its own stats on the player page — that happens
    // naturally, every row below is tagged with its season same as always
    // — but isTournament rows are excluded wherever totals get combined
    // across seasons into "career" numbers (see regTotals/poTotals below).
    const isTournamentSeason = !!(info.season.settings && info.season.settings.isTournament);
    (info.season.games || []).forEach(g => {
      if (g.isBye || g.isSpringTraining) return;
      ['home', 'away'].forEach(side => {
        const rows = (g.playerStats && g.playerStats[side]) || [];
        const row = rows.find(r => r.playerId === info.playerId);
        if (!row) return;
        // teamId comes from the game itself (which side the player's row is
        // filed under), not info.teamId (their current/final roster spot) —
        // a player traded mid-season keeps the team they actually played
        // for on each individual game, so a trade doesn't retroactively
        // repaint earlier games as having been played for the new team.
        const hs = Number(g.homeScore), as = Number(g.awayScore);
        gameLog.push(normalizeStatRow(row, {
          seasonId: info.season.id, seasonName: info.season.name,
          teamId: side === 'home' ? g.homeTeamId : g.awayTeamId,
          oppTeamId: side === 'home' ? g.awayTeamId : g.homeTeamId, side,
          gameId: g.id, date: g.date, isPlayoff: !!g.isPlayoff, isPlayIn: !!g.isPlayIn,
          isTournament: isTournamentSeason,
          oneRunGame: !Number.isNaN(hs) && !Number.isNaN(as) && Math.abs(hs - as) === 1,
        }));
      });
    });
    // Season totals imported from an external site (currently just hcbb.info's
    // KPB leaderboard) aren't tied to any one game, so they're kept in their
    // own array instead of season.games — one synthetic "row" per import,
    // folded into the same gameLog every other total is summed from.
    (info.season.importedStatLines || []).filter(r => r.playerId === info.playerId).forEach(row => {
      gameLog.push(normalizeStatRow(row, {
        seasonId: info.season.id, seasonName: info.season.name, teamId: info.teamId,
        oppTeamId: null, side: null, gameId: row.id, date: row.sourceLabel || 'Imported',
        isPlayoff: !!row.isPlayoff, isPlayIn: false, isImport: true, sourceLabel: row.sourceLabel,
        isTournament: isTournamentSeason,
      }));
    });
  });
  gameLog.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return { seasonsInfo, gameLog, knownNames: [...knownNames] };
}

function sumPlayerTotals(gameLog) {
  const t = { g: gameLog.reduce((s, row) => s + (row.g != null ? row.g : 1), 0), ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0, outs: 0, ha: 0, er: 0, bbAllowed: 0, k: 0, hrAllowed: 0, e: 0, hr: 0, doubles: 0, triples: 0 };
  gameLog.forEach(row => {
    t.ab += row.ab; t.r += row.r; t.h += row.h; t.rbi += row.rbi; t.bb += row.bb; t.so += row.so;
    t.outs += ipDisplayToOuts(row.ip); t.ha += row.ha; t.er += row.er; t.bbAllowed += row.bbAllowed;
    t.k += row.k; t.hrAllowed += row.hrAllowed; t.e += row.e; t.hr += row.hr;
    t.doubles += row.doubles; t.triples += row.triples;
  });
  return t;
}

// Singles are never entered directly — they're always however many of the
// OCR'd total hits are left over once home runs, doubles, and triples (the
// only hit types anyone actually enters) are accounted for. That keeps H as
// the single source of truth instead of two manually-entered numbers that
// could silently drift out of sync with each other.
function playerSingles(t) { return Math.max(0, t.h - t.hr - t.doubles - t.triples); }

function computeBattingAdvanced(t) {
  const avg = t.ab > 0 ? t.h / t.ab : 0;
  const obpDenom = t.ab + t.bb;
  const obp = obpDenom > 0 ? (t.h + t.bb) / obpDenom : 0;
  const totalBases = playerSingles(t) * 1 + t.doubles * 2 + t.triples * 3 + t.hr * 4;
  const slg = t.ab > 0 ? totalBases / t.ab : 0;
  return { avg, obp, slg, ops: obp + slg, iso: slg - avg };
}
function computePitchingAdvanced(t) {
  const era = t.outs > 0 ? (t.er * 27) / t.outs : 0;
  const whip = t.outs > 0 ? ((t.ha + t.bbAllowed) * 3) / t.outs : 0;
  const k9 = t.outs > 0 ? (t.k * 27) / t.outs : 0;
  const bb9 = t.outs > 0 ? (t.bbAllowed * 27) / t.outs : 0;
  return { ip: t.outs / 3, era, whip, k9, bb9, kbb: t.bbAllowed > 0 ? t.k / t.bbAllowed : (t.k > 0 ? Infinity : 0) };
}

// A simplified, "good enough for a casual league" WAR — not an official
// sabermetric figure (no park factors, defense, or baserunning; replacement
// level is approximated as league-average rather than true replacement).
// Batting side uses standard linear-weights run values per event; pitching
// side is runs saved vs. this season's league-average ERA. Both convert to
// wins at the usual ~10 runs per win.
function computePlayerWAR(t, leagueERA) {
  const battingRuns = 0.9 * playerSingles(t) + 1.25 * t.doubles + 1.6 * t.triples + 2.0 * t.hr
    + 0.33 * t.bb - 0.3 * Math.max(0, t.ab - t.h);
  const ip = t.outs / 3;
  const pitchingRuns = t.outs > 0 ? ((leagueERA - (t.er * 9) / ip) / 9) * ip : 0;
  return (battingRuns + pitchingRuns) / 10;
}

// League-average OPS/ERA for one season, regular season only — the baseline
// an OPS+/ERA+ index (100 = league average, standard sabermetric convention)
// is measured against.
function computeSeasonLeagueAverages(season, teamsById) {
  const players = computeSeasonPlayerLeaders(season, teamsById, 'regular');
  const batters = players.filter(p => p.totals.ab >= 3);
  const totalOuts = players.reduce((s, p) => s + p.totals.outs, 0);
  const totalER = players.reduce((s, p) => s + p.totals.er, 0);
  const totalAB = batters.reduce((s, p) => s + p.totals.ab, 0);
  const totalOPSWeighted = batters.reduce((s, p) => s + p.batting.ops * p.totals.ab, 0);
  return {
    leagueERA: totalOuts > 0 ? (totalER * 27) / totalOuts : null,
    leagueOPS: totalAB > 0 ? totalOPSWeighted / totalAB : null,
  };
}

// Every roster player in this season with at least one imported game line,
// with career-style totals/advanced stats scoped to just this season — the
// pool the Leaders page ranks. WAR needs a league-average ERA baseline, so
// it's computed once here and threaded through rather than per-player.
// League-wide offensive/pitching environment for one season — every regular-
// season plate appearance and inning pooled together, not per-player, so
// "did the league get more offense-heavy this season" is one number instead
// of eyeballing a leaderboard.
function computeSeasonScoringEnvironment(season) {
  const rows = [];
  (season.games || []).forEach(g => {
    if (!g.played || g.isBye || g.isSpringTraining || g.isPlayoff) return;
    ['home', 'away'].forEach(side => {
      ((g.playerStats && g.playerStats[side]) || []).forEach(row => rows.push(normalizeStatRow(row)));
    });
  });
  const totals = sumPlayerTotals(rows);
  return {
    avg: totals.ab > 0 ? totals.h / totals.ab : 0,
    era: totals.outs > 0 ? (totals.er * 27) / totals.outs : 0,
    ab: totals.ab,
  };
}

function computeSeasonPlayerLeaders(season, teamsById, mode = 'regular') {
  const byPlayer = new Map();
  (season.members || []).forEach(member => {
    (member.roster || []).forEach(p => { if (!p.banned) byPlayer.set(p.id, { playerId: p.id, name: p.name, teamId: member.teamId, rows: [] }); });
  });
  (season.freeAgents || []).forEach(p => { if (!p.banned) byPlayer.set(p.id, { playerId: p.id, name: p.name, teamId: null, rows: [] }); });
  (season.games || []).forEach(g => {
    if (g.isBye || g.isSpringTraining) return;
    if (!!g.isPlayoff !== (mode === 'playoffs')) return;
    ['home', 'away'].forEach(side => {
      ((g.playerStats && g.playerStats[side]) || []).forEach(row => {
        const entry = byPlayer.get(row.playerId);
        if (entry) entry.rows.push(normalizeStatRow(row, {}));
      });
    });
  });
  // Imported season totals (e.g. from hcbb.info, or a manual entry) carry
  // their own regular-season/playoffs flag now — hcbb imports are always
  // regular season (set at import time), but a manual entry can be either.
  (season.importedStatLines || []).forEach(row => {
    if (!!row.isPlayoff !== (mode === 'playoffs')) return;
    const entry = byPlayer.get(row.playerId);
    if (entry) entry.rows.push(normalizeStatRow(row, {}));
  });
  const players = [...byPlayer.values()].filter(e => e.rows.length > 0).map(e => {
    const totals = sumPlayerTotals(e.rows);
    return { playerId: e.playerId, name: e.name, teamId: e.teamId, totals, batting: computeBattingAdvanced(totals), pitching: computePitchingAdvanced(totals) };
  });
  const leagueOuts = players.reduce((s, p) => s + p.totals.outs, 0);
  const leagueER = players.reduce((s, p) => s + p.totals.er, 0);
  const leagueERA = leagueOuts > 0 ? (leagueER * 27) / leagueOuts : 4.5;
  players.forEach(p => { p.war = computePlayerWAR(p.totals, leagueERA); });
  return players;
}

// A player's most recent N regular-season games this season, not the whole
// season to date — "who's hot right now" instead of who's been good since
// day one. Imported season-total lines don't carry a single game date, so
// they're excluded here (there's nothing to window them by); a rolling
// leaderboard on a league that only ever bulk-imports totals just won't
// have entries, same as any other stat with no qualifying data.
function computeRollingFormLeaders(season, teamsById, gamesWindow) {
  const byPlayer = new Map();
  (season.members || []).forEach(member => {
    (member.roster || []).forEach(p => { if (!p.banned) byPlayer.set(p.id, { playerId: p.id, name: p.name, teamId: member.teamId, rows: [] }); });
  });
  (season.freeAgents || []).forEach(p => { if (!p.banned) byPlayer.set(p.id, { playerId: p.id, name: p.name, teamId: null, rows: [] }); });
  (season.games || []).forEach(g => {
    if (g.isBye || g.isSpringTraining || g.isPlayoff || !g.played) return;
    ['home', 'away'].forEach(side => {
      ((g.playerStats && g.playerStats[side]) || []).forEach(row => {
        const entry = byPlayer.get(row.playerId);
        if (entry) entry.rows.push(normalizeStatRow(row, { date: g.date || '' }));
      });
    });
  });
  const players = [...byPlayer.values()].map(e => {
    const sorted = [...e.rows].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const windowRows = sorted.slice(-gamesWindow);
    const totals = sumPlayerTotals(windowRows);
    return { playerId: e.playerId, name: e.name, teamId: e.teamId, gamesInWindow: windowRows.length, totals, batting: computeBattingAdvanced(totals), pitching: computePitchingAdvanced(totals) };
  }).filter(p => p.gamesInWindow > 0);
  const windowOuts = players.reduce((s, p) => s + p.totals.outs, 0);
  const windowER = players.reduce((s, p) => s + p.totals.er, 0);
  const windowERA = windowOuts > 0 ? (windowER * 27) / windowOuts : 4.5;
  players.forEach(p => { p.war = computePlayerWAR(p.totals, windowERA); });
  return players;
}

// "Pennant-race clutch" = performance in close games (decided by 2 or
// fewer) played during the stretch run (the last quarter of the season's
// games, by date) — the games most likely to actually swing a playoff race.
// Same shape as computeRollingFormLeaders, just a different game filter.
function computeClutchLeaders(season, teamsById) {
  const byPlayer = new Map();
  (season.members || []).forEach(member => {
    (member.roster || []).forEach(p => { if (!p.banned) byPlayer.set(p.id, { playerId: p.id, name: p.name, teamId: member.teamId, rows: [] }); });
  });
  (season.freeAgents || []).forEach(p => { if (!p.banned) byPlayer.set(p.id, { playerId: p.id, name: p.name, teamId: null, rows: [] }); });
  const dated = (season.games || []).filter(g => g.played && !g.isBye && !g.isSpringTraining && !g.isPlayoff && !g.isForfeit && g.date)
    .slice().sort((a, b) => a.date.localeCompare(b.date));
  const stretchCount = Math.max(5, Math.ceil(dated.length * 0.25));
  const stretchGames = dated.slice(-stretchCount);
  const closeGames = stretchGames.filter(g => Math.abs(Number(g.homeScore) - Number(g.awayScore)) <= 2);
  closeGames.forEach(g => {
    ['home', 'away'].forEach(side => {
      ((g.playerStats && g.playerStats[side]) || []).forEach(row => {
        const entry = byPlayer.get(row.playerId);
        if (entry) entry.rows.push(normalizeStatRow(row));
      });
    });
  });
  const players = [...byPlayer.values()].map(e => {
    const totals = sumPlayerTotals(e.rows);
    return { playerId: e.playerId, name: e.name, teamId: e.teamId, clutchGames: e.rows.length, totals, batting: computeBattingAdvanced(totals), pitching: computePitchingAdvanced(totals) };
  }).filter(p => p.clutchGames > 0);
  return { players, closeGameCount: closeGames.length, stretchGameCount: stretchGames.length };
}

// Every real person's combined stats across every season in the league —
// the pool the "All-Time" leaderboard scope ranks. Groups every roster/
// free-agent entry in the league into one identity per real person with a
// union-find over the same signals getPlayerCareerData uses for one player
// at a time (shared Roblox id, or a name/usernameHistory overlap) — just
// run once for everybody instead of once per lookup — then sums each
// group's games across every season. Tournament seasons are excluded, same
// convention as a player's own career totals on their page.
function computeCareerLeaders(league, mode = 'regular') {
  const norm = (s) => (s || '').trim().toLowerCase();
  const allEntries = [];
  (league.seasons || []).forEach(season => {
    (season.members || []).forEach(member => {
      (member.roster || []).forEach(p => allEntries.push({ season, teamId: member.teamId, playerId: p.id, player: p }));
    });
    (season.freeAgents || []).forEach(p => allEntries.push({ season, teamId: null, playerId: p.id, player: p }));
  });
  const namesOf = (p) => [norm(p.name), ...((p.usernameHistory || []).map(norm))];

  const n = allEntries.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const byId = new Map();
  const byName = new Map();
  allEntries.forEach((entry, i) => {
    const rid = entry.player.robloxUserId ? String(entry.player.robloxUserId) : null;
    if (rid) { if (byId.has(rid)) union(i, byId.get(rid)); else byId.set(rid, i); }
    namesOf(entry.player).forEach(nm => { if (!nm) return; if (byName.has(nm)) union(i, byName.get(nm)); else byName.set(nm, i); });
  });

  const groups = new Map();
  allEntries.forEach((entry, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(entry); });

  const players = [];
  groups.forEach(entries => {
    const rows = [];
    entries.forEach(entry => {
      const isTournamentSeason = !!(entry.season.settings && entry.season.settings.isTournament);
      if (isTournamentSeason) return;
      (entry.season.games || []).forEach(g => {
        if (g.isBye || g.isSpringTraining) return;
        if (!!g.isPlayoff !== (mode === 'playoffs')) return;
        ['home', 'away'].forEach(side => {
          const gRows = (g.playerStats && g.playerStats[side]) || [];
          const row = gRows.find(r => r.playerId === entry.playerId);
          if (row) rows.push(normalizeStatRow(row, {}));
        });
      });
      (entry.season.importedStatLines || []).forEach(row => {
        if (row.playerId !== entry.playerId) return;
        if (!!row.isPlayoff !== (mode === 'playoffs')) return;
        rows.push(normalizeStatRow(row, {}));
      });
    });
    if (rows.length === 0) return;
    // The most recently-created season this identity appears in decides
    // the display name/team — same "latest wins" convention used elsewhere.
    const latest = [...entries].sort((a, b) => (a.season.createdAt || 0) - (b.season.createdAt || 0)).pop();
    const totals = sumPlayerTotals(rows);
    players.push({
      playerId: latest.playerId, name: latest.player.name, teamId: latest.teamId,
      totals, batting: computeBattingAdvanced(totals), pitching: computePitchingAdvanced(totals),
    });
  });
  const leagueOuts = players.reduce((s, p) => s + p.totals.outs, 0);
  const leagueER = players.reduce((s, p) => s + p.totals.er, 0);
  const leagueERA = leagueOuts > 0 ? (leagueER * 27) / leagueOuts : 4.5;
  players.forEach(p => { p.war = computePlayerWAR(p.totals, leagueERA); });
  return players;
}

// A "rookie" is an identity whose earliest non-tournament season appearance
// anywhere in the league is the season currently being viewed — same
// union-find identity closure computeCareerLeaders uses, just asking "when
// did this person first show up" instead of "what's their career total."
function computeRookieClass(league, activeSeasonId) {
  const activeSeason = (league.seasons || []).find(s => s.id === activeSeasonId);
  if (!activeSeason) return [];
  const norm = (s) => (s || '').trim().toLowerCase();
  const allEntries = [];
  (league.seasons || []).forEach(season => {
    (season.members || []).forEach(member => {
      (member.roster || []).forEach(p => allEntries.push({ season, teamId: member.teamId, playerId: p.id, player: p }));
    });
    (season.freeAgents || []).forEach(p => allEntries.push({ season, teamId: null, playerId: p.id, player: p }));
  });
  const namesOf = (p) => [norm(p.name), ...((p.usernameHistory || []).map(norm))];
  const n = allEntries.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const byId = new Map(); const byName = new Map();
  allEntries.forEach((entry, i) => {
    const rid = entry.player.robloxUserId ? String(entry.player.robloxUserId) : null;
    if (rid) { if (byId.has(rid)) union(i, byId.get(rid)); else byId.set(rid, i); }
    namesOf(entry.player).forEach(nm => { if (!nm) return; if (byName.has(nm)) union(i, byName.get(nm)); else byName.set(nm, i); });
  });
  const groups = new Map();
  allEntries.forEach((entry, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(entry); });

  const rookies = [];
  groups.forEach(entries => {
    const nonTournament = entries.filter(e => !(e.season.settings && e.season.settings.isTournament));
    if (nonTournament.length === 0) return;
    const earliest = [...nonTournament].sort((a, b) => (a.season.createdAt || 0) - (b.season.createdAt || 0))[0];
    if (earliest.season.id !== activeSeasonId) return;
    const inActive = entries.find(e => e.season.id === activeSeasonId);
    if (!inActive || inActive.player.banned) return;
    const rows = [];
    (activeSeason.games || []).forEach(g => {
      if (g.isBye || g.isSpringTraining || g.isPlayoff || !g.played) return;
      ['home', 'away'].forEach(side => {
        ((g.playerStats && g.playerStats[side]) || []).forEach(row => { if (row.playerId === inActive.playerId) rows.push(normalizeStatRow(row)); });
      });
    });
    const totals = sumPlayerTotals(rows);
    rookies.push({
      playerId: inActive.playerId, name: inActive.player.name, teamId: inActive.teamId,
      draftPick: inActive.player.draftPick || null,
      totals, batting: computeBattingAdvanced(totals), pitching: computePitchingAdvanced(totals),
    });
  });
  return rookies;
}

// A team's average roster experience — per current roster spot, how many
// distinct non-tournament seasons (league-wide, not just for this team)
// that identity has appeared in up through the season being viewed. Same
// union-find identity closure as computeRookieClass, just counting instead
// of asking "is this their first."
function computeTeamExperience(league, activeSeasonId) {
  const activeSeason = (league.seasons || []).find(s => s.id === activeSeasonId);
  if (!activeSeason) return [];
  const norm = (s) => (s || '').trim().toLowerCase();
  const allEntries = [];
  (league.seasons || []).forEach(season => {
    (season.members || []).forEach(member => {
      (member.roster || []).forEach(p => allEntries.push({ season, teamId: member.teamId, playerId: p.id, player: p }));
    });
    (season.freeAgents || []).forEach(p => allEntries.push({ season, teamId: null, playerId: p.id, player: p }));
  });
  const namesOf = (p) => [norm(p.name), ...((p.usernameHistory || []).map(norm))];
  const n = allEntries.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const byId = new Map(); const byName = new Map();
  allEntries.forEach((entry, i) => {
    const rid = entry.player.robloxUserId ? String(entry.player.robloxUserId) : null;
    if (rid) { if (byId.has(rid)) union(i, byId.get(rid)); else byId.set(rid, i); }
    namesOf(entry.player).forEach(nm => { if (!nm) return; if (byName.has(nm)) union(i, byName.get(nm)); else byName.set(nm, i); });
  });
  const activeCreatedAt = activeSeason.createdAt || 0;
  const seasonsByRoot = new Map();
  allEntries.forEach((entry, i) => {
    if (entry.season.settings && entry.season.settings.isTournament) return;
    if ((entry.season.createdAt || 0) > activeCreatedAt) return;
    const r = find(i);
    if (!seasonsByRoot.has(r)) seasonsByRoot.set(r, new Set());
    seasonsByRoot.get(r).add(entry.season.id);
  });

  const results = new Map();
  (activeSeason.members || []).forEach(member => {
    const tenures = [];
    (member.roster || []).forEach(p => {
      if (p.banned) return;
      const idx = allEntries.findIndex(e => e.season.id === activeSeasonId && e.playerId === p.id);
      if (idx === -1) return;
      const seasons = seasonsByRoot.get(find(idx));
      tenures.push(seasons ? seasons.size : 1);
    });
    if (tenures.length > 0) results.set(member.teamId, { teamId: member.teamId, avgSeasons: tenures.reduce((a, b) => a + b, 0) / tenures.length, rosterSize: tenures.length });
  });
  return [...results.values()];
}

function meanStdDev(values) {
  if (values.length === 0) return { mean: 0, stddev: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, stddev: Math.sqrt(variance) };
}
// A .850 OPS means something different in a season where the league hit
// .750 than one where it hit .650 — this ranks a career by how many
// standard deviations above that specific season's mean each qualifying
// season was, then averages those, instead of just summing raw totals
// (computeCareerLeaders) where a career built entirely in high-offense
// seasons would otherwise look better than an equally-good one that
// happened to play in a pitchers'-league era. Reuses the same
// closure/union-find identity grouping as computeCareerLeaders since this
// needs the same "which entries are actually the same person" answer.
function computeZScoreLeaders(league, teamsById, mode = 'regular') {
  const norm = (s) => (s || '').trim().toLowerCase();
  const allEntries = [];
  (league.seasons || []).forEach(season => {
    (season.members || []).forEach(member => {
      (member.roster || []).forEach(p => allEntries.push({ season, teamId: member.teamId, playerId: p.id, player: p }));
    });
    (season.freeAgents || []).forEach(p => allEntries.push({ season, teamId: null, playerId: p.id, player: p }));
  });
  const namesOf = (p) => [norm(p.name), ...((p.usernameHistory || []).map(norm))];
  const n = allEntries.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const byId = new Map(), byName = new Map();
  allEntries.forEach((entry, i) => {
    const rid = entry.player.robloxUserId ? String(entry.player.robloxUserId) : null;
    if (rid) { if (byId.has(rid)) union(i, byId.get(rid)); else byId.set(rid, i); }
    namesOf(entry.player).forEach(nm => { if (!nm) return; if (byName.has(nm)) union(i, byName.get(nm)); else byName.set(nm, i); });
  });
  const groupOf = new Map();
  allEntries.forEach((entry, i) => { const r = find(i); if (!groupOf.has(r)) groupOf.set(r, []); groupOf.get(r).push(entry); });

  // z-scores per season, computed once per season and shared across
  // whichever identities qualified in it.
  const battingZByEntry = new Map(); // entry index -> z
  const pitchingZByEntry = new Map();
  (league.seasons || []).forEach(season => {
    if (season.settings && season.settings.isTournament) return;
    const seasonPlayers = computeSeasonPlayerLeaders(season, teamsById, mode);
    const qualBat = seasonPlayers.filter(p => p.totals.ab >= 3);
    const qualPitch = seasonPlayers.filter(p => p.totals.outs >= 3);
    const { mean: batMean, stddev: batSd } = meanStdDev(qualBat.map(p => p.batting.ops));
    const { mean: eraMean, stddev: eraSd } = meanStdDev(qualPitch.map(p => p.pitching.era));
    allEntries.forEach((entry, i) => {
      if (entry.season !== season) return;
      const asBatter = qualBat.find(p => p.playerId === entry.playerId);
      if (asBatter && batSd > 0) battingZByEntry.set(i, (asBatter.batting.ops - batMean) / batSd);
      const asPitcher = qualPitch.find(p => p.playerId === entry.playerId);
      if (asPitcher && eraSd > 0) pitchingZByEntry.set(i, (eraMean - asPitcher.pitching.era) / eraSd); // inverted: lower ERA = higher z
    });
  });

  const players = [];
  groupOf.forEach(entries => {
    const battingZs = [], pitchingZs = [];
    entries.forEach((entry) => {
      const i = allEntries.indexOf(entry);
      if (battingZByEntry.has(i)) battingZs.push(battingZByEntry.get(i));
      if (pitchingZByEntry.has(i)) pitchingZs.push(pitchingZByEntry.get(i));
    });
    if (battingZs.length === 0 && pitchingZs.length === 0) return;
    const latest = [...entries].sort((a, b) => (a.season.createdAt || 0) - (b.season.createdAt || 0)).pop();
    players.push({
      playerId: latest.playerId, name: latest.player.name, teamId: latest.teamId,
      zBatting: battingZs.length ? battingZs.reduce((s, v) => s + v, 0) / battingZs.length : null,
      zPitching: pitchingZs.length ? pitchingZs.reduce((s, v) => s + v, 0) / pitchingZs.length : null,
      seasonsBatQualified: battingZs.length, seasonsPitchQualified: pitchingZs.length,
    });
  });
  return players;
}

const fmtStatRate = (v) => v.toFixed(3).replace(/^0/, '');
const fmtStat2 = (v) => v.toFixed(2);
const fmtStat1 = (v) => (v >= 0 ? '+' : '') + v.toFixed(1);
const fmtStatInt = (v) => String(Math.round(v));
const fmtStatIp = (v) => v.toFixed(1);
// Shared by the custom leaderboard builder's stat dropdown — the same
// value/format/sort-direction pairs the fixed leaderboard cards use, just
// picked at runtime instead of one card per stat. "qualifier" says which
// raw total the minimum-to-qualify field filters on for that stat.
const CUSTOM_STAT_OPTIONS = [
  { key: 'avg', label: 'Batting Average', group: 'batting', valueFn: p => p.batting.avg, formatFn: fmtStatRate, sortDesc: true, qualifier: 'ab' },
  { key: 'ops', label: 'OPS', group: 'batting', valueFn: p => p.batting.ops, formatFn: fmtStatRate, sortDesc: true, qualifier: 'ab' },
  { key: 'obp', label: 'On-Base %', group: 'batting', valueFn: p => p.batting.obp, formatFn: fmtStatRate, sortDesc: true, qualifier: 'ab' },
  { key: 'slg', label: 'Slugging %', group: 'batting', valueFn: p => p.batting.slg, formatFn: fmtStatRate, sortDesc: true, qualifier: 'ab' },
  { key: 'iso', label: 'Isolated Power', group: 'batting', valueFn: p => p.batting.iso, formatFn: fmtStatRate, sortDesc: true, qualifier: 'ab' },
  { key: 'hr', label: 'Home Runs', group: 'batting', valueFn: p => p.totals.hr, formatFn: fmtStatInt, sortDesc: true, qualifier: null },
  { key: 'rbi', label: 'RBI', group: 'batting', valueFn: p => p.totals.rbi, formatFn: fmtStatInt, sortDesc: true, qualifier: null },
  { key: 'h', label: 'Hits', group: 'batting', valueFn: p => p.totals.h, formatFn: fmtStatInt, sortDesc: true, qualifier: null },
  { key: 'r', label: 'Runs', group: 'batting', valueFn: p => p.totals.r, formatFn: fmtStatInt, sortDesc: true, qualifier: null },
  { key: 'doubles', label: 'Doubles', group: 'batting', valueFn: p => p.totals.doubles, formatFn: fmtStatInt, sortDesc: true, qualifier: null },
  { key: 'triples', label: 'Triples', group: 'batting', valueFn: p => p.totals.triples, formatFn: fmtStatInt, sortDesc: true, qualifier: null },
  { key: 'bb', label: 'Walks (Batting)', group: 'batting', valueFn: p => p.totals.bb, formatFn: fmtStatInt, sortDesc: true, qualifier: null },
  { key: 'so', label: 'Strikeouts (Batting)', group: 'batting', valueFn: p => p.totals.so, formatFn: fmtStatInt, sortDesc: false, qualifier: null },
  { key: 'era', label: 'ERA', group: 'pitching', valueFn: p => p.pitching.era, formatFn: fmtStat2, sortDesc: false, qualifier: 'ip' },
  { key: 'whip', label: 'WHIP', group: 'pitching', valueFn: p => p.pitching.whip, formatFn: fmtStat2, sortDesc: false, qualifier: 'ip' },
  { key: 'ip', label: 'Innings Pitched', group: 'pitching', valueFn: p => p.pitching.ip, formatFn: fmtStatIp, sortDesc: true, qualifier: null },
  { key: 'k', label: 'Strikeouts (Pitching)', group: 'pitching', valueFn: p => p.totals.k, formatFn: fmtStatInt, sortDesc: true, qualifier: null },
  { key: 'k9', label: 'K/9', group: 'pitching', valueFn: p => p.pitching.k9, formatFn: fmtStat2, sortDesc: true, qualifier: 'ip' },
  { key: 'bb9', label: 'BB/9', group: 'pitching', valueFn: p => p.pitching.bb9, formatFn: fmtStat2, sortDesc: false, qualifier: 'ip' },
  { key: 'war', label: 'WAR', group: 'both', valueFn: p => p.war, formatFn: fmtStat1, sortDesc: true, qualifier: null },
];
// Baseball-Savant-style percentile rankings — where a player's regular-
// season rate stats fall (0-100) against every other qualifying regular/
// pitcher in that same season, reusing CUSTOM_STAT_OPTIONS so the value/
// direction/qualifier logic can't drift out of sync with the leaderboard
// builder above. Counting stats (HR, RBI, etc.) are deliberately left out —
// Savant's own percentile shelf is rate/quality metrics, not raw totals,
// since a part-timer's counting stats aren't comparable to a full-timer's.
const SAVANT_BATTING_KEYS = ['ops', 'avg', 'obp', 'slg', 'iso', 'bb', 'so'];
const SAVANT_PITCHING_KEYS = ['era', 'whip', 'k9', 'bb9'];
// Unlike the leaderboard builder (which only enforces a minimum sample on
// rate stats and happily lists raw BB/SO totals for anyone), a percentile
// bar is meaningless without a real sample behind it — a pitcher with 0 ABs
// "qualifying" for a batting-walks percentile off a trivial 0-for-0 is
// worse than not showing the bar at all. Gate by stat group instead of the
// stat's own (sometimes null) qualifier field.
function qualifiesForStat(stat, p) {
  if (stat.group === 'batting') return p.totals.ab >= 3;
  if (stat.group === 'pitching') return p.totals.outs >= 3;
  return true;
}
function computePercentile(stat, player, pool) {
  const values = pool.filter(p => qualifiesForStat(stat, p)).map(stat.valueFn).filter(Number.isFinite);
  if (values.length < 2 || !qualifiesForStat(stat, player)) return null;
  const v = stat.valueFn(player);
  if (!Number.isFinite(v)) return null;
  const worseOrEqual = stat.sortDesc ? values.filter(x => x <= v).length : values.filter(x => x >= v).length;
  return Math.max(0, Math.min(100, Math.round(((worseOrEqual - 1) / (values.length - 1)) * 100)));
}
// Blue (bad) → grey (average) → red (good), the same three-stop gradient
// Baseball Savant uses on its percentile shelf.
function savantColor(pct) {
  if (pct == null) return CHALK_DIM;
  const lo = pct <= 50 ? [64, 105, 225] : [148, 148, 148];
  const hi = pct <= 50 ? [148, 148, 148] : [214, 39, 40];
  const t = pct <= 50 ? pct / 50 : (pct - 50) / 50;
  const [r, g, b] = lo.map((c, i) => Math.round(c + (hi[i] - c) * t));
  return `rgb(${r}, ${g}, ${b})`;
}
function PercentileBar({ stat, player, pool }) {
  const pct = computePercentile(stat, player, pool);
  if (pct == null) return null;
  const color = savantColor(pct);
  const value = stat.valueFn(player);
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="w-20 text-xs font-semibold flex-shrink-0 truncate" style={{ color: CHALK }}>{stat.label}</span>
      <div className="flex-1 h-2 rounded-full relative" style={{ background: LINE }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-6 h-5 flex-shrink-0 rounded-full text-[11px] font-bold flex items-center justify-center" style={{ background: color, color: '#0a0a0a' }}>{pct}</span>
      <span className="w-10 text-right font-mono text-xs flex-shrink-0" style={{ color: CHALK_DIM }}>{stat.formatFn(value)}</span>
    </div>
  );
}
function SavantPercentilesPanel({ player, pool, seasonName }) {
  const battingStats = SAVANT_BATTING_KEYS.map(k => CUSTOM_STAT_OPTIONS.find(s => s.key === k)).filter(s => computePercentile(s, player, pool) != null);
  const pitchingStats = SAVANT_PITCHING_KEYS.map(k => CUSTOM_STAT_OPTIONS.find(s => s.key === k)).filter(s => computePercentile(s, player, pool) != null);
  if (battingStats.length === 0 && pitchingStats.length === 0) return null;
  return (
    <Panel className="overflow-hidden">
      <SectionTitle accent={GOLD}>Percentile rankings</SectionTitle>
      <p className="px-4 pb-2 text-xs" style={{ color: CHALK_DIM }}>Where {player.name} ranks against every qualifying regular-season {pitchingStats.length > 0 && battingStats.length === 0 ? 'pitcher' : 'batter'} in {seasonName} (min. 3 AB / 1 IP). 100 = best in the league, 0 = worst.</p>
      <div className="px-4 pb-3">
        {battingStats.length > 0 && (
          <div>
            {pitchingStats.length > 0 && <p className="text-[10px] uppercase font-bold pt-1 pb-0.5" style={{ color: CHALK_DIM }}>Batting</p>}
            {battingStats.map(s => <PercentileBar key={s.key} stat={s} player={player} pool={pool} />)}
          </div>
        )}
        {pitchingStats.length > 0 && (
          <div>
            {battingStats.length > 0 && <p className="text-[10px] uppercase font-bold pt-1 pb-0.5" style={{ color: CHALK_DIM }}>Pitching</p>}
            {pitchingStats.map(s => <PercentileBar key={s.key} stat={s} player={player} pool={pool} />)}
          </div>
        )}
      </div>
    </Panel>
  );
}

// Lets a visitor pick any tracked stat, a minimum sample size, and how many
// names to show, instead of only the fixed set of cards above — shares
// whatever season/all-time and regular/playoffs scope the page is already
// showing, since that's the same "which games count" choice either way.
function CustomLeaderboardBuilder({ players, teamsById, onOpenPlayer, leagueLogoUrl, scope, standings }) {
  const [statKey, setStatKey] = useState('ops');
  const [minQualifier, setMinQualifier] = useState(3);
  const [limit, setLimit] = useState(25);
  const [sosAdjusted, setSosAdjusted] = useState(false);
  const stat = CUSTOM_STAT_OPTIONS.find(s => s.key === statKey) || CUSTOM_STAT_OPTIONS[0];
  const pool = stat.qualifier === 'ab' ? players.filter(p => p.totals.ab >= minQualifier)
    : stat.qualifier === 'ip' ? players.filter(p => p.totals.outs >= minQualifier * 3)
    : players;
  // Career rows can span teams/seasons a single season's SOS figure can't
  // speak to, so the adjustment only makes sense for "This Season" scope.
  const sosByTeamId = useMemo(() => {
    const m = {};
    (standings || []).forEach(t => { if (t.sos != null) m[t.id] = t.sos; });
    return m;
  }, [standings]);
  const canSosAdjust = scope !== 'career' && Object.keys(sosByTeamId).length > 0;
  // A mild multiplier off strength of schedule (win% of opponents faced) —
  // a tougher slate nudges the stat up, an easier one nudges it down, same
  // direction the stat already sorts in.
  const adjustedValueFn = (p) => {
    const raw = stat.valueFn(p);
    if (!canSosAdjust || !sosAdjusted) return raw;
    const sos = sosByTeamId[p.teamId];
    if (sos == null) return raw;
    const factor = 1 + (sos - 0.5) * 0.4;
    return stat.sortDesc ? raw * factor : raw / factor;
  };
  return (
    <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
      <SectionTitle accent={PRIMARY}>Build a leaderboard</SectionTitle>
      <div className="px-4 pb-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>Stat</span>
          <select value={statKey} onChange={e => setStatKey(e.target.value)} className="bg-[#242424] border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, color: CHALK }}>
            <optgroup label="Batting">{CUSTOM_STAT_OPTIONS.filter(s => s.group === 'batting').map(s => <option key={s.key} value={s.key} style={{ background: PANEL2, color: CHALK }}>{s.label}</option>)}</optgroup>
            <optgroup label="Pitching">{CUSTOM_STAT_OPTIONS.filter(s => s.group === 'pitching').map(s => <option key={s.key} value={s.key} style={{ background: PANEL2, color: CHALK }}>{s.label}</option>)}</optgroup>
            <optgroup label="Overall">{CUSTOM_STAT_OPTIONS.filter(s => s.group === 'both').map(s => <option key={s.key} value={s.key} style={{ background: PANEL2, color: CHALK }}>{s.label}</option>)}</optgroup>
          </select>
        </label>
        {stat.qualifier && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>Min {stat.qualifier === 'ab' ? 'at-bats' : 'innings pitched'}</span>
            <input type="number" min="0" value={minQualifier} onChange={e => setMinQualifier(Number(e.target.value) || 0)} className="w-24 bg-[#242424] border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, color: CHALK }} />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>Show top</span>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))} className="bg-[#242424] border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, color: CHALK }}>
            {[10, 25, 50, 100].map(n => <option key={n} value={n} style={{ background: PANEL2, color: CHALK }}>{n}</option>)}
          </select>
        </label>
        {canSosAdjust && (
          <label className="flex items-center gap-1.5 pb-1.5" title="Nudges the stat by strength of schedule — a tougher slate counts for a bit more, an easier one a bit less">
            <input type="checkbox" checked={sosAdjusted} onChange={e => setSosAdjusted(e.target.checked)} />
            <span className="text-xs" style={{ color: CHALK_DIM }}>SOS-adjusted</span>
          </label>
        )}
      </div>
      <div className="px-4 pb-3">
        <LeaderBoardCard title={stat.label + (canSosAdjust && sosAdjusted ? ' (SOS-adj.)' : '')} players={pool} valueFn={adjustedValueFn} formatFn={stat.formatFn} sortDesc={stat.sortDesc} limit={limit} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
      </div>
    </Panel>
  );
}

const PLAYER_HIGH_FIELDS = [
  { key: 'h', label: 'Hits' }, { key: 'r', label: 'Runs' }, { key: 'rbi', label: 'RBI' },
  { key: 'hr', label: 'Home Runs' }, { key: 'bb', label: 'Walks' }, { key: 'k', label: 'Strikeouts (pitching)' },
];
function computePlayerGameHighs(gameLog) {
  return PLAYER_HIGH_FIELDS.map(f => {
    let best = null;
    gameLog.forEach(row => { if (!best || row[f.key] > best[f.key]) best = row; });
    return { ...f, value: best ? best[f.key] : 0, row: best && best[f.key] > 0 ? best : null };
  }).filter(x => x.row);
}

// A rough single-game "game score" blending batting and pitching production
// into one number, purely to rank a player's own games against each other —
// not a real sabermetric formula, just enough signal to surface standout
// performances without a human curating them one by one.
function playerGameScore(row) {
  const outs = ipDisplayToOuts(row.ip);
  const batting = row.h * 1 + row.hr * 3 + row.rbi * 1 + row.r * 0.5 + row.bb * 0.3 - row.so * 0.3;
  const pitching = row.k * 1 + (outs / 3) * 1 - row.er * 1.5 - row.ha * 0.3 - row.bbAllowed * 0.3;
  return batting + pitching;
}
function computePlayerNotableGames(gameLog) {
  const notes = [];
  gameLog.forEach(row => {
    const tags = [];
    if (row.hr >= 2) tags.push(`${row.hr}-homer game`);
    if (row.h >= 4) tags.push(`${row.h}-hit game`);
    if (row.rbi >= 4) tags.push(`${row.rbi}-RBI game`);
    const outs = ipDisplayToOuts(row.ip);
    if (outs >= 15 && row.er === 0) tags.push(`${outsToIpDisplay(outs)} IP shutout`);
    if (row.k >= 8) tags.push(`${row.k}-strikeout outing`);
    if (tags.length > 0) notes.push({ row, tags });
  });
  return notes;
}

// Distinct player names across every season/team in the league — the pool
// a player-compare picker draws from.
// Every badge on the books, with who currently holds it. league.playerProfiles
// is keyed by identity (Roblox id when known, else a normalized name), same
// convention PlayerPage reads badges through — this just walks every key
// instead of one identity's lookup keys. A player's badge key can go stale
// after a rename (the write moves to their new id/name key, the old key
// isn't cleaned up), so a very rarely-renamed edge case could show a past
// username here rather than the current one; not worth a full identity
// closure for a showcase wall.
function computeBadgeHolders(league) {
  const allEntries = [];
  (league.seasons || []).forEach(season => {
    (season.members || []).forEach(m => (m.roster || []).forEach(p => allEntries.push(p)));
    (season.freeAgents || []).forEach(p => allEntries.push(p));
  });
  const nameForKey = (key) => {
    if (/^\d+$/.test(key)) {
      const hit = [...allEntries].reverse().find(p => p.robloxUserId && String(p.robloxUserId) === key);
      return hit ? hit.name : key;
    }
    const hit = [...allEntries].reverse().find(p => (p.name || '').trim().toLowerCase() === key);
    return hit ? hit.name : key;
  };
  const profiles = league.playerProfiles || {};
  const byBadge = new Map();
  Object.entries(profiles).forEach(([key, profile]) => {
    (profile.badges || []).forEach(badgeId => {
      if (!byBadge.has(badgeId)) byBadge.set(badgeId, new Set());
      byBadge.get(badgeId).add(nameForKey(key));
    });
  });
  return byBadge;
}

function getAllPlayerNames(league) {
  const seen = new Set();
  (league.seasons || []).forEach(season => {
    (season.members || []).forEach(member => {
      (member.roster || []).forEach(p => { if (p.name && p.name.trim()) seen.add(p.name.trim()); });
    });
  });
  return [...seen].sort((a, b) => a.localeCompare(b));
}

// Per-visitor Roblox avatar lookup via the /api/roblox-avatar proxy route
// (Roblox's own APIs don't send CORS headers for browser callers). Looks up
// by robloxUserId when the player record already has one — which survives a
// Roblox username change, and lets the caller compare the freshly-resolved
// `username` in the result against the stored player name to notice a
// rename happened — falling back to a username lookup for players that
// haven't had an id backfilled yet. Cached in sessionStorage per lookup key
// so navigating around doesn't re-fetch.
function useRobloxAvatar(username, robloxUserId) {
  const [state, setState] = useState({ url: null, loading: true, userId: null, resolvedUsername: null });
  useEffect(() => {
    if (!username && !robloxUserId) { setState({ url: null, loading: false, userId: null, resolvedUsername: null }); return; }
    let cancelled = false;
    const cacheKey = robloxUserId ? `lt-rbx-id:${robloxUserId}` : `lt-rbx-avatar:${(username || '').trim().toLowerCase()}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached !== null) { setState(cached === 'null' ? { url: null, loading: false, userId: null, resolvedUsername: null } : { ...JSON.parse(cached), loading: false }); return; }
    } catch (e) { /* sessionStorage unavailable or malformed cache entry */ }
    setState({ url: null, loading: true, userId: null, resolvedUsername: null });
    const qs = robloxUserId ? `userId=${encodeURIComponent(robloxUserId)}` : `username=${encodeURIComponent(username)}`;
    fetch(`/api/roblox-avatar?${qs}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(data => {
        if (cancelled) return;
        const next = { url: data.avatarUrl, userId: data.userId, resolvedUsername: data.username };
        setState({ ...next, loading: false });
        try { sessionStorage.setItem(cacheKey, JSON.stringify(next)); } catch (e) { /* ignore */ }
      })
      .catch(() => {
        if (cancelled) return;
        setState({ url: null, loading: false, userId: null, resolvedUsername: null });
        try { sessionStorage.setItem(cacheKey, 'null'); } catch (e) { /* ignore */ }
      });
    return () => { cancelled = true; };
  }, [username, robloxUserId]);
  return state;
}

// Drag-to-select crop tool: draws a selection box over the uploaded image and
// hands back a canvas cropped (and scaled to the image's real resolution) to
// just that region, so OCR only has to read the stats table itself.
function ImageCropper({ src, onDone, onCancel }) {
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const [rect, setRect] = useState(null);
  const dragRef = useRef(null);

  const getPos = (e) => {
    const box = containerRef.current.getBoundingClientRect();
    return { x: Math.min(Math.max(e.clientX - box.left, 0), box.width), y: Math.min(Math.max(e.clientY - box.top, 0), box.height) };
  };
  const onPointerDown = (e) => { e.preventDefault(); const p = getPos(e); dragRef.current = p; setRect({ x: p.x, y: p.y, w: 0, h: 0 }); };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const p = getPos(e), start = dragRef.current;
    setRect({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) });
  };
  const onPointerUp = () => { dragRef.current = null; };

  const applyCrop = (useFull) => {
    const img = imgRef.current;
    if (!img) return;
    const scaleX = img.naturalWidth / img.clientWidth, scaleY = img.naturalHeight / img.clientHeight;
    const r = (!useFull && rect && rect.w > 8 && rect.h > 8) ? rect : { x: 0, y: 0, w: img.clientWidth, h: img.clientHeight };
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(r.w * scaleX));
    canvas.height = Math.max(1, Math.round(r.h * scaleY));
    canvas.getContext('2d').drawImage(img, r.x * scaleX, r.y * scaleY, r.w * scaleX, r.h * scaleY, 0, 0, canvas.width, canvas.height);
    onDone(canvas);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: CHALK_DIM }}>Drag over just the stats table to crop to it — tighter crops usually read better. Or skip straight to using the full image.</p>
      <div ref={containerRef} className="relative select-none" style={{ cursor: 'crosshair', touchAction: 'none' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
        <img ref={imgRef} src={src} alt="" className="w-full block rounded" draggable={false} />
        {rect && rect.w > 0 && rect.h > 0 && (
          <div className="absolute border-2 pointer-events-none" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderColor: PRIMARY, boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)' }} />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => applyCrop(false)} disabled={!rect || rect.w < 8 || rect.h < 8} className="px-3 py-2 rounded font-bold text-sm disabled:opacity-40" style={{ background: PRIMARY, color: INK }}>Crop &amp; continue</button>
        <button onClick={() => applyCrop(true)} className="px-3 py-2 rounded font-bold text-sm" style={{ background: PANEL2, color: CHALK, border: `1px solid ${LINE}` }}>Use full image</button>
        {rect && <button onClick={() => setRect(null)} className="px-2 py-2 rounded text-xs" style={{ color: CHALK_DIM }}>Clear selection</button>}
        <button onClick={onCancel} className="px-2 py-2 rounded text-xs ml-auto" style={{ color: CHALK_DIM }}>Cancel</button>
      </div>
    </div>
  );
}

// Tesseract is tuned for high-contrast printed text, not a game's stylized
// UI (small text over a colored/textured panel) — fed the raw crop as-is,
// real screenshots read as garbage far more often than not. Upscaling small
// crops and stretching the grayscale contrast to the image's own black/white
// extremes is a standard, cheap way to close most of that gap before OCR
// ever sees it.
function preprocessForOcr(canvas) {
  const scale = canvas.width < 900 ? 3 : canvas.width < 1400 ? 2 : 1;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(canvas.width * scale));
  out.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  const imgData = ctx.getImageData(0, 0, out.width, out.height);
  const d = imgData.data;
  const gray = new Uint8ClampedArray(d.length / 4);
  let min = 255, max = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    gray[p] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = Math.round(((gray[p] - min) / range) * 255);
    d[i] = v; d[i + 1] = v; d[i + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);
  return out;
}

// Upload → crop → OCR → review-and-fix-up-before-saving flow for importing
// one team's box score from a screenshot of the in-game stat screen. Also
// doubles as the editor for stats already saved on this game/side (opens
// straight to the review step, pre-filled, when existingRows is passed).
function StatImportModal({ game, side, team, roster, existingRows, onSave, onClose }) {
  const [step, setStep] = useState(existingRows ? 'review' : 'upload');
  const [imgSrc, setImgSrc] = useState(null);
  const [error, setError] = useState(null);
  const emptyValues = () => Object.fromEntries(STAT_COLUMNS.map(c => [c.key, 0]));
  const [rows, setRows] = useState(() => (existingRows || []).map(r => ({
    name: r.name || '', playerId: r.playerId || '',
    values: Object.fromEntries(STAT_COLUMNS.map(c => [c.key, r[c.key] || 0])),
    hr: r.hr || 0, doubles: r.doubles || 0, triples: r.triples || 0,
  })));
  const fileRef = useRef(null);

  const onPickFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setImgSrc(reader.result); setStep('crop'); };
    reader.readAsDataURL(file);
  };

  const runOcr = async (canvas) => {
    setStep('ocr'); setError(null);
    try {
      const { createWorker, OEM } = await import('tesseract.js');
      // tesseract.js defaults to fetching its worker script, core WASM, and
      // language data from the jsdelivr CDN at OCR time — three separate
      // external requests that break the whole import for anyone whose
      // browser/network blocks that CDN (ad blockers, school/office
      // filtering, etc. all commonly do). Self-hosting them under
      // /public/tesseract and pointing the worker at those instead makes
      // OCR work the same way the rest of the app's own assets do.
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: '/tesseract/worker.min.js',
        corePath: '/tesseract/core',
        langPath: '/tesseract/lang',
      });
      const preCanvas = preprocessForOcr(canvas);
      const { data } = await worker.recognize(preCanvas.toDataURL('image/png'));
      await worker.terminate();
      const parsed = ocrLinesToStatRows(parseOcrTsvToLines(data.tsv));
      if (parsed.length === 0) setError("Couldn't find any rows in that image — try a tighter crop, or add rows manually below.");
      setRows(parsed.map(p => ({ name: p.name, playerId: matchRosterPlayer(p.name, roster), values: p.values, hr: 0, doubles: 0, triples: 0 })));
      setStep('review');
    } catch (e) {
      // Logged rather than swallowed silently — the on-screen message has to
      // stay generic (a random visitor can't act on a stack trace), but
      // without this, diagnosing a real failure meant guessing blind.
      console.error('Screenshot stat import OCR failed:', e);
      setError('Could not read the screenshot automatically. Add rows and enter stats by hand below.');
      setRows(rows.length ? rows : [{ name: '', playerId: '', values: emptyValues(), hr: 0, doubles: 0, triples: 0 }]);
      setStep('review');
    }
  };

  const updateRow = (i, patch) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const updateRowValue = (i, key, v) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, values: { ...r.values, [key]: v } } : r));
  const removeRow = (i) => setRows(rs => rs.filter((_, idx) => idx !== i));
  const addRow = () => setRows(rs => [...rs, { name: '', playerId: '', values: emptyValues(), hr: 0, doubles: 0, triples: 0 }]);

  const save = () => {
    const entries = rows.filter(r => r.playerId).map(r => {
      const values = {};
      STAT_COLUMNS.forEach(c => { values[c.key] = Number(r.values[c.key]) || 0; });
      return { playerId: r.playerId, name: r.name, ...values, hr: Number(r.hr) || 0, doubles: Number(r.doubles) || 0, triples: Number(r.triples) || 0 };
    });
    onSave(entries);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl" style={{ background: PANEL, border: `1px solid ${LINE}` }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${LINE}` }}>
          <div>
            <div className="text-[10px] uppercase font-bold" style={{ color: PRIMARY }}>Import stats</div>
            <div className="text-sm font-bold" style={{ color: CHALK }}>{team ? team.name : (side === 'home' ? 'Home' : 'Away')} · {side === 'home' ? 'Home' : 'Away'}</div>
          </div>
          <button onClick={onClose} className="p-1 rounded" style={{ color: CHALK_DIM }}><X size={18} /></button>
        </div>
        <div className="p-4">
          {step === 'upload' && (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: CHALK_DIM }}>Upload a screenshot of {team ? team.name : 'this team'}'s in-game stat screen. You'll get to crop it and check the results before anything saves.</p>
              <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />
              <button onClick={() => fileRef.current && fileRef.current.click()} className="px-4 py-3 rounded font-bold text-sm flex items-center gap-2" style={{ background: PRIMARY, color: INK }}><Upload size={16} /> Choose screenshot</button>
              <div>
                <button onClick={() => { setRows([{ name: '', playerId: '', values: emptyValues(), hr: 0 }]); setStep('review'); }} className="text-xs font-semibold" style={{ color: CHALK_DIM }}>Skip — enter stats manually instead</button>
              </div>
            </div>
          )}
          {step === 'crop' && imgSrc && (
            <ImageCropper src={imgSrc} onDone={runOcr} onCancel={() => setStep('upload')} />
          )}
          {step === 'ocr' && (
            <div className="py-10 flex flex-col items-center gap-3">
              <RefreshCw size={22} className="animate-spin" style={{ color: PRIMARY }} />
              <p className="text-sm" style={{ color: CHALK_DIM }}>Reading the screenshot…</p>
            </div>
          )}
          {step === 'review' && (
            <div className="space-y-3">
              {error && <p className="text-xs" style={{ color: NEGATIVE }}>{error}</p>}
              <p className="text-xs" style={{ color: CHALK_DIM }}>Check each row, match it to a roster player, and fix anything the scan misread — nothing saves until you hit Save. The stat screen doesn't break hits down by type or report home runs at all, so 1B/2B/3B/HR are always by hand; singles are whatever's left of H once HR/2B/3B are accounted for.</p>
              <div className="overflow-x-auto">
                <table className="text-xs" style={{ color: CHALK, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th className="text-left px-1 pb-1">Name</th>
                      <th className="text-left px-1 pb-1">Matched to</th>
                      {STAT_COLUMNS.map((c, i) => <th key={i} className="px-1 pb-1">{c.label}</th>)}
                      <th className="px-1 pb-1" style={{ color: GOLD }}>1B</th>
                      <th className="px-1 pb-1" style={{ color: GOLD }}>2B</th>
                      <th className="px-1 pb-1" style={{ color: GOLD }}>3B</th>
                      <th className="px-1 pb-1" style={{ color: GOLD }}>HR</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                        <td className="px-1 py-1"><input value={r.name} onChange={e => updateRow(i, { name: e.target.value })} className="w-28 bg-[#242424] border rounded px-1 py-1" style={{ borderColor: LINE, color: CHALK }} /></td>
                        <td className="px-1 py-1">
                          <select value={r.playerId} onChange={e => updateRow(i, { playerId: e.target.value })} className="bg-[#242424] border rounded px-1 py-1" style={{ borderColor: r.playerId ? LINE : NEGATIVE, color: CHALK }}>
                            <option value="">— unmatched —</option>
                            {roster.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </td>
                        {STAT_COLUMNS.map(c => (
                          <td key={c.key} className="px-1 py-1"><input value={r.values[c.key]} onChange={e => updateRowValue(i, c.key, e.target.value)} className="w-10 bg-[#242424] border rounded px-1 py-1 text-center" style={{ borderColor: LINE, color: CHALK }} /></td>
                        ))}
                        <td className="px-1 py-1 text-center font-mono" style={{ color: CHALK_DIM }} title="Computed: H − HR − 2B − 3B">
                          {Math.max(0, (Number(r.values.h) || 0) - (Number(r.hr) || 0) - (Number(r.doubles) || 0) - (Number(r.triples) || 0))}
                        </td>
                        <td className="px-1 py-1"><input value={r.doubles} onChange={e => updateRow(i, { doubles: e.target.value })} className="w-10 bg-[#242424] border rounded px-1 py-1 text-center" style={{ borderColor: GOLD, color: CHALK }} /></td>
                        <td className="px-1 py-1"><input value={r.triples} onChange={e => updateRow(i, { triples: e.target.value })} className="w-10 bg-[#242424] border rounded px-1 py-1 text-center" style={{ borderColor: GOLD, color: CHALK }} /></td>
                        <td className="px-1 py-1"><input value={r.hr} onChange={e => updateRow(i, { hr: e.target.value })} className="w-10 bg-[#242424] border rounded px-1 py-1 text-center" style={{ borderColor: GOLD, color: CHALK }} /></td>
                        <td className="px-1 py-1"><button onClick={() => removeRow(i)} style={{ color: NEGATIVE }}><Trash2 size={13} /></button></td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={STAT_COLUMNS.length + 7} className="px-1 py-3 text-center" style={{ color: CHALK_DIM }}>No rows yet — add one below.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={addRow} className="px-2 py-1.5 rounded text-xs font-semibold flex items-center gap-1" style={{ background: PANEL2, color: CHALK, border: `1px solid ${LINE}` }}><Plus size={13} /> Add row</button>
                <button onClick={save} className="px-3 py-2 rounded font-bold text-sm ml-auto flex items-center gap-1" style={{ background: PRIMARY, color: INK }}><Save size={14} /> Save stats</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// A spreadsheet-style score entry table for catching up a whole day (or
// round) of results at once, instead of opening one game at a time.
// Collapsed by default since it's a batch tool, not something anyone needs
// open on every visit.
function BulkScoreEntryPanel({ games, teamsById, onBulkSaveScores }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState({});
  const unplayed = games.filter(g => !g.played && !g.isPlayoff && !g.isPlayIn && g.homeTeamId && g.awayTeamId);
  if (unplayed.length === 0) return null;
  const setRow = (gameId, field, value) => setRows(r => ({ ...r, [gameId]: { ...(r[gameId] || {}), [field]: value } }));
  const filledCount = Object.values(rows).filter(r => r && r.away !== undefined && r.away !== '' && r.home !== undefined && r.home !== '').length;
  const saveAll = () => {
    const updates = unplayed.map(g => {
      const r = rows[g.id];
      if (!r || r.away === '' || r.away === undefined || r.home === '' || r.home === undefined) return null;
      return { gameId: g.id, awayScore: Number(r.away), homeScore: Number(r.home), innings: Number(r.innings) || 7 };
    }).filter(Boolean);
    if (updates.length === 0) return;
    onBulkSaveScores(updates);
    setRows({});
  };
  return (
    <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
      <SectionTitle accent={GOLD} right={<button onClick={() => setOpen(v => !v)} className="text-[11px] font-bold" style={{ color: GOLD }}>{open ? 'Close' : 'Open'}</button>}>Bulk score entry</SectionTitle>
      {open && (
        <div className="px-2 pb-3">
          <p className="px-2 pb-2 text-xs" style={{ color: CHALK_DIM }}>Fill in as many as you've got, then save them all at once.</p>
          <div className="space-y-1.5 px-2">
            {unplayed.map(g => {
              const away = teamsById[g.awayTeamId], home = teamsById[g.homeTeamId];
              const r = rows[g.id] || {};
              return (
                <div key={g.id} className="flex items-center gap-2 text-xs">
                  <span className="w-20 flex-shrink-0 truncate" style={{ color: CHALK_DIM }}>{g.date || ''}</span>
                  <span className="flex-1 min-w-0 truncate" style={{ color: CHALK }}>{away ? away.name : g.awayScheduleName}</span>
                  <input type="number" value={r.away ?? ''} onChange={e => setRow(g.id, 'away', e.target.value)} className="w-14 bg-[#242424] border rounded px-1.5 py-1 text-center" style={{ borderColor: LINE, color: CHALK }} />
                  <span style={{ color: CHALK_DIM }}>@</span>
                  <input type="number" value={r.home ?? ''} onChange={e => setRow(g.id, 'home', e.target.value)} className="w-14 bg-[#242424] border rounded px-1.5 py-1 text-center" style={{ borderColor: LINE, color: CHALK }} />
                  <span className="flex-1 min-w-0 truncate" style={{ color: CHALK }}>{home ? home.name : g.homeScheduleName}</span>
                </div>
              );
            })}
          </div>
          <button onClick={saveAll} disabled={filledCount === 0} className="mt-3 mx-2 px-3 py-2 rounded font-bold text-xs disabled:opacity-40" style={{ background: GOLD, color: INK }}>Save {filledCount || ''} score{filledCount === 1 ? '' : 's'}</button>
        </div>
      )}
    </Panel>
  );
}
function ScheduleView({ season, settings, saveScore, deleteGame, declareForfeit, setWinnerOverride, teamsById, sport, updateGameNotes, updateGameStreamUrl, updateGameTime, saveGamePlayerStats, setGameOngoing, setGameDelayed, swapHomeAway, onBulkSaveScores }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageSchedule');
  const scheduleMode = settings.scheduleMode || 'date';
  const [editingId, setEditingId] = useState(null);
  const [scoreForm, setScoreForm] = useState({ away: '', home: '', innings: '7' });
  const [liveEditingId, setLiveEditingId] = useState(null);
  const [liveForm, setLiveForm] = useState({ away: '0', home: '0', period: '1', half: 'top' });
  const [filter, setFilter] = useState('all');
  const [openLabel, setOpenLabel] = useState(null);
  const [statImport, setStatImport] = useState(null); // { gameId, side } | null
  // Byes never appear on the schedule — there's no game to score, so they'd
  // just be a dead row. advancePlayoffs/advancePlayIn still use the
  // underlying isBye game objects in season.games to resolve slot winners;
  // this only affects what's rendered here.
  const games = (season.games || []).filter(g => !g.isBye);
  const liveStandingsForSeeds = computeStandings(season, teamsById).active;
  const seedByTeamId = {};
  liveStandingsForSeeds.forEach((t, i) => { seedByTeamId[t.id] = i + 1; });
  const maxPlayoffRound = games.filter(g => g.isPlayoff).reduce((m, g) => Math.max(m, g.playoffRound), 0);
  // Total bracket depth (not just the highest round generated so far — later
  // rounds don't exist as games yet while an earlier round is still being
  // played, which would otherwise make round 1 look like the Final).
  const totalPlayoffRounds = Math.max(maxPlayoffRound, Math.log2(nextPow2(Math.max(1, Math.min(settings.playoffSpots || 0, liveStandingsForSeeds.length) || maxPlayoffRound || 1))));
  const seededTeamLabel = (teamId, scheduleName) => {
    const t = teamsById[teamId];
    const name = t ? t.name : (scheduleName || 'TBD');
    const seed = teamId ? seedByTeamId[teamId] : null;
    return seed ? `#${seed} ${name}` : name;
  };

  const groups = [];
  const seenKeys = {};
  games.forEach(g => {
    const isPlayoff = !!g.isPlayoff, isPlayIn = !!g.isPlayIn;
    let gkey, label, sortA = 0, sortB = 0;
    if (isPlayoff || isPlayIn) {
      // Group by series (round + bracket slot), not by round alone — each
      // matchup gets its own header with both teams and seeds named, rather
      // than lumping every Round 1 series under one generic "Playoffs R1".
      const roundNum = isPlayoff ? g.playoffRound : g.playInRound;
      gkey = `${isPlayoff ? 'po' : 'pi'}-${roundNum}-${g.bracketSlot}`;
      const roundLabel = isPlayoff
        ? getPlayoffRoundName(settings, roundNum, totalPlayoffRounds)
        : (roundNum === 1 ? 'Play-In' : `Play-In Round ${roundNum}`);
      label = `${isPlayoff ? 'Playoffs' : 'Play-In'} ${roundLabel} — ${seededTeamLabel(g.awayTeamId, g.awayScheduleName)} vs ${seededTeamLabel(g.homeTeamId, g.homeScheduleName)}`;
      sortA = roundNum; sortB = g.bracketSlot;
    } else if (g.isSpringTraining) {
      // Kept in their own labeled group rather than folded into a regular
      // date group, so it's never ambiguous whether a game counted.
      gkey = `st-${g.date || 'unlabeled'}`;
      label = `Spring Training — ${g.date || 'Unlabeled'}`;
    } else {
      gkey = roundGroupKey(g.date, scheduleMode);
      label = g.date || 'Unlabeled';
    }
    if (!(gkey in seenKeys)) { seenKeys[gkey] = { key: gkey, label, games: [], isPlayoff, isPlayIn, isSpringTraining: !!g.isSpringTraining, sortA, sortB }; groups.push(seenKeys[gkey]); }
    seenKeys[gkey].games.push(g);
  });
  // Same fix as getOrderedRounds: sort by actual round/date number, not by
  // whichever round's first game happened to be entered first.
  groups.sort((a, b) => {
    if (a.isPlayoff !== b.isPlayoff) return a.isPlayoff ? 1 : -1;
    if (a.isPlayIn !== b.isPlayIn) return a.isPlayIn ? 1 : -1;
    if (a.isPlayoff || a.isPlayIn) return (a.sortA - b.sortA) || (a.sortB - b.sortB);
    return compareGameDates(a.label, b.label, scheduleMode);
  });

  useEffect(() => {
    if (groups.length === 0) { setOpenLabel(null); return; }
    let idx = 0;
    for (let i = 0; i < groups.length; i++) if (groups[i].games.some(g => g.played)) idx = i;
    setOpenLabel(groups[idx].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season.id, games.length]);

  const openScoreEditor = (g) => { setEditingId(g.id); setLiveEditingId(null); setScoreForm({ away: g.awayScore ?? '', home: g.homeScore ?? '', innings: g.innings ?? String(settings.standardInnings || 7) }); };
  const [copied, setCopied] = useState(false);
  const copySchedule = () => {
    const lines = [`${season.name} — Schedule`, ''];
    groups.forEach(g => {
      lines.push(`${scheduleMode === 'round' && !g.isPlayoff && !g.isPlayIn && g.label !== 'Unlabeled' ? formatRoundLabel(g.label) : g.label}:`);
      g.games.forEach(game => {
        const away = teamsById[game.awayTeamId], home = teamsById[game.homeTeamId];
        const awayName = away ? away.name : game.awayScheduleName, homeName = home ? home.name : game.homeScheduleName;
        lines.push(`  ${awayName} @ ${homeName}${game.played ? `  (${game.awayScore}-${game.homeScore})` : ''}`);
      });
      lines.push('');
    });
    const text2 = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text2).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => { prompt('Copy this text:', text2); });
    } else { prompt('Copy this text:', text2); }
  };

  return (
    <div className="p-3 space-y-3">
      <style>{`@keyframes lt-live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
      {(() => {
        const regGames = games.filter(g => !g.isPlayoff && !g.isPlayIn);
        const played = regGames.filter(g => g.played);
        const totalMargin = played.filter(g => !g.isForfeit).reduce((s, g) => s + Math.abs(Number(g.homeScore) - Number(g.awayScore)), 0);
        const marginCount = played.filter(g => !g.isForfeit).length;
        return (
          <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
            <SectionTitle accent={PRIMARY}>Schedule snapshot</SectionTitle>
            <div className="grid grid-cols-3 gap-px" style={{ background: LINE }}>
              <StatBox label="Total Games" value={regGames.length} />
              <StatBox label="Played" value={played.length} color={WIN} />
              <StatBox label="Remaining" value={regGames.length - played.length} />
              <StatBox label="Avg Margin" value={marginCount ? (totalMargin / marginCount).toFixed(1) : '—'} />
            </div>
          </Panel>
        );
      })()}
      {isLoggedIn && onBulkSaveScores && <BulkScoreEntryPanel games={games} teamsById={teamsById} onBulkSaveScores={onBulkSaveScores} />}
      <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
        <SectionTitle accent={PRIMARY} right={
          <div className="flex items-center gap-2">
            <button onClick={copySchedule} className="text-[11px] font-semibold flex items-center gap-1" style={{ color: copied ? WIN : PRIMARY }}><Save size={12} /> {copied ? 'Copied!' : 'Copy'}</button>
            <span className="text-[11px] font-mono" style={{ color: CHALK_DIM }}>{games.filter(g => g.played).length}/{games.length} played</span>
          </div>
        }>Schedule</SectionTitle>
        <div className="flex gap-1 px-4 pb-3">
          {['all', 'upcoming', 'played'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className="px-2.5 py-1 rounded text-[11px] font-semibold capitalize" style={{ background: filter === f ? PRIMARY : PANEL2, color: filter === f ? INK : CHALK_DIM }}>{f}</button>
          ))}
        </div>
        <div className="px-2 pb-3 space-y-2">
          {groups.length === 0 && <p className="px-2 py-4 text-sm" style={{ color: CHALK_DIM }}>No games yet — add some below.</p>}
          {groups.map(group => {
            const visibleGames = group.games.filter(g => filter === 'all' || (filter === 'played' && g.played) || (filter === 'upcoming' && !g.played));
            if (visibleGames.length === 0) return null;
            const isOpen = openLabel === group.key;
            const playedCount = group.games.filter(g => g.played).length;
            return (
              <div key={group.key} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
                <button onClick={() => setOpenLabel(isOpen ? null : group.key)} className="w-full flex items-center gap-2 px-3 py-2 text-left" style={{ background: PANEL2 }}>
                  {group.isPlayoff && <Crown size={12} style={{ color: GOLD }} />}
                  {group.isPlayIn && <Sparkles size={12} style={{ color: PRIMARY }} />}
                  {group.isSpringTraining && <Sun size={12} style={{ color: CHALK_DIM }} />}
                  <span className="font-head flex-1 text-xs font-semibold uppercase tracking-wide" style={{ color: group.isPlayoff ? GOLD : group.isSpringTraining ? CHALK_DIM : PRIMARY }}>
                    {scheduleMode === 'round' && !group.isPlayoff && !group.isPlayIn && !group.isSpringTraining && group.label !== 'Unlabeled' ? formatRoundLabel(group.label) : group.label}
                  </span>
                  {group.isSpringTraining && <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: PANEL, color: CHALK_DIM, border: `1px solid ${LINE}` }}>Doesn't count</span>}
                  <span className="text-[10px] font-mono" style={{ color: CHALK_DIM }}>{playedCount}/{group.games.length}</span>
                  <ChevronRight size={14} style={{ color: CHALK_DIM, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
                </button>
                {isOpen && visibleGames.map(g => {
                  const home = teamsById[g.homeTeamId], away = teamsById[g.awayTeamId];
                  const homeColor = home ? teamColor(home) : LINE, awayColor = away ? teamColor(away) : LINE;
                  const w = gameWinner(g);
                  return (
                    <div key={g.id} style={{ borderTop: `1px solid ${LINE}` }}>
                      <div className="px-3 py-2.5" style={{ borderLeft: `4px solid ${awayColor}`, borderRight: `4px solid ${homeColor}` }}>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0 flex items-center gap-1.5">
                            {away && <TeamMark team={away} size={20} />}
                            <span className="font-head text-sm font-semibold truncate" style={{ color: w === 'away' ? CHALK : CHALK_DIM }}>{away ? away.name : g.awayScheduleName}</span>
                          </div>
                          <div className="flex-shrink-0 text-center px-1">
                            {g.played ? (
                              <div className="font-head font-bold text-lg tabular-nums" style={{ color: CHALK }}>{g.awayScore}<span style={{ color: CHALK_DIM, fontWeight: 400 }}>–</span>{g.homeScore}</div>
                            ) : g.isOngoing ? (
                              <div className="font-head font-bold text-base tabular-nums" style={{ color: NEGATIVE }}>{g.liveAwayScore ?? 0}<span style={{ fontWeight: 400 }}>–</span>{g.liveHomeScore ?? 0}</div>
                            ) : (
                              <span className="text-[10px] font-bold uppercase" style={{ color: CHALK_DIM }}>@</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0 flex items-center gap-1.5 justify-end">
                            <span className="font-head text-sm font-semibold truncate text-right" style={{ color: w === 'home' ? CHALK : CHALK_DIM }}>{home ? home.name : g.homeScheduleName}</span>
                            {home && <TeamMark team={home} size={20} />}
                          </div>
                        </div>
                        <div className="flex items-center justify-center gap-2 mt-1.5">
                          {g.played
                            ? <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: PANEL2, color: CHALK_DIM }}>
                                Final{g.innings && g.innings !== (settings.standardInnings || 7) && !g.isPlayoff ? `/${g.innings}` : ''}{g.isForfeit ? ' (F)' : ''}{g.winnerOverride ? ' *' : ''}
                              </span>
                            : g.isOngoing
                              ? (g.isDelayed
                                ? <span className="flex items-center gap-1 font-bold text-[10px] uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: `${GOLD}22`, color: GOLD }}>
                                    <Pause size={10} /> Delayed
                                  </span>
                                : <span className="flex items-center gap-1 font-bold text-[10px] uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: `${NEGATIVE}22`, color: NEGATIVE }}>
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: NEGATIVE, animation: 'lt-live-pulse 1.4s ease-in-out infinite' }} />
                                    Live{formatLivePeriod(sport, g.livePeriod, g.liveHalf) ? ` · ${formatLivePeriod(sport, g.livePeriod, g.liveHalf)}` : ''}
                                  </span>)
                              : <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: PANEL2, color: CHALK_DIM }}>Upcoming</span>}
                          {g.streamUrl && !g.played && (
                            <a href={g.streamUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: `${PRIMARY}22`, color: PRIMARY }}><Video size={11} /> Watch</a>
                          )}
                        </div>
                        {!g.played && g.gameTimeUTC != null && (
                          <div className="text-center text-[11px] font-semibold mt-1" style={{ color: CHALK_DIM }}>{formatGameTimeOfDayLocal(g.gameTimeUTC)}</div>
                        )}
                        {isLoggedIn && (
                          <div className="flex items-center justify-center gap-1 mt-1.5 pt-1.5" style={{ borderTop: `1px solid ${LINE}` }}>
                            {!g.played && (
                              <button onClick={() => { setLiveForm({ away: String(g.liveAwayScore ?? 0), home: String(g.liveHomeScore ?? 0), period: String(g.livePeriod ?? 1), half: g.liveHalf || 'top' }); setLiveEditingId(g.id); setEditingId(null); }} className="p-1 rounded" style={{ color: g.isOngoing ? (g.isDelayed ? GOLD : NEGATIVE) : CHALK_DIM }} title={g.isOngoing ? (g.isDelayed ? 'Delayed — update live game' : 'Update live game') : 'Mark as ongoing'}><Activity size={13} /></button>
                            )}
                            <button onClick={() => swapHomeAway(g.id)} className="p-1 rounded font-bold text-xs" style={{ color: CHALK_DIM }} title="Swap home/away">⇄</button>
                            <button onClick={() => openScoreEditor(g)} className="p-1 rounded" style={{ color: PRIMARY }}><Pencil size={13} /></button>
                            <button onClick={() => deleteGame(g.id)} className="p-1 rounded" style={{ color: NEGATIVE }}><Trash2 size={13} /></button>
                          </div>
                        )}
                      </div>
                      {liveEditingId === g.id && (
                        <div className="px-3 pb-3 space-y-2" style={{ borderLeft: `3px solid ${awayColor}`, borderRight: `3px solid ${homeColor}` }}>
                          <div className="flex flex-wrap items-end gap-2">
                            <div><div className="text-[10px] uppercase mb-1" style={{ color: CHALK_DIM }}>Away (live)</div><NumInput value={liveForm.away} onChange={v => setLiveForm(f => ({ ...f, away: v }))} min={0} /></div>
                            <div><div className="text-[10px] uppercase mb-1" style={{ color: CHALK_DIM }}>Home (live)</div><NumInput value={liveForm.home} onChange={v => setLiveForm(f => ({ ...f, home: v }))} min={0} /></div>
                            <div><div className="text-[10px] uppercase mb-1" style={{ color: CHALK_DIM }}>{sport.period.charAt(0).toUpperCase() + sport.period.slice(1)}</div><NumInput value={liveForm.period} onChange={v => setLiveForm(f => ({ ...f, period: v }))} min={1} w="w-12" /></div>
                            {sport.period === 'inning' && (
                              <div className="flex rounded overflow-hidden border" style={{ borderColor: LINE }}>
                                {['top', 'bottom'].map(h => (
                                  <button key={h} onClick={() => setLiveForm(f => ({ ...f, half: h }))} className="px-2 py-1.5 text-xs font-bold capitalize" style={{ background: liveForm.half === h ? NEGATIVE : PANEL2, color: liveForm.half === h ? INK : CHALK_DIM }}>{h}</button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button onClick={() => { setGameOngoing(g.id, true, { away: Number(liveForm.away) || 0, home: Number(liveForm.home) || 0, period: Number(liveForm.period) || 1, half: liveForm.half }); setLiveEditingId(null); }} className="px-3 py-1.5 rounded font-bold text-xs flex items-center gap-1" style={{ background: NEGATIVE, color: INK }}><Activity size={12} /> {g.isOngoing ? 'Update' : 'Go live'}</button>
                            {g.isOngoing && (g.isDelayed
                              ? <button onClick={() => { setGameDelayed(g.id, false); setLiveEditingId(null); }} className="px-3 py-1.5 rounded font-bold text-xs flex items-center gap-1" style={{ background: GOLD, color: INK }}><Activity size={12} /> Resume</button>
                              : <button onClick={() => { setGameDelayed(g.id, true); setLiveEditingId(null); }} className="px-3 py-1.5 rounded font-bold text-xs flex items-center gap-1" style={{ background: 'transparent', color: GOLD, border: `1px solid ${GOLD}` }}><Pause size={12} /> Mark delayed</button>)}
                            {g.isOngoing && <button onClick={() => { setGameOngoing(g.id, false); setLiveEditingId(null); }} className="px-3 py-1.5 rounded font-bold text-xs" style={{ background: PANEL2, color: CHALK_DIM, border: `1px solid ${LINE}` }}>End live</button>}
                            <button onClick={() => setLiveEditingId(null)} className="px-2 py-1.5 rounded text-xs" style={{ color: CHALK_DIM }}>Cancel</button>
                          </div>
                          {g.isDelayed && <p className="text-[11px] font-semibold" style={{ color: GOLD }}>Marked delayed — score is held as-is and won't pulse as live until you resume or update it.</p>}
                          <p className="text-[11px]" style={{ color: CHALK_DIM }}>Live score and {sport.period} are informational only — they don't count toward standings until you enter a final score with the pencil icon.</p>
                        </div>
                      )}
                      {editingId === g.id && (
                        <div className="px-3 pb-3 space-y-2" style={{ borderLeft: `3px solid ${awayColor}`, borderRight: `3px solid ${homeColor}` }}>
                          <div className="flex flex-wrap items-end gap-2">
                            <div><div className="text-[10px] uppercase mb-1" style={{ color: CHALK_DIM }}>Away runs</div><NumInput value={scoreForm.away} onChange={v => setScoreForm(f => ({ ...f, away: v }))} /></div>
                            <div><div className="text-[10px] uppercase mb-1" style={{ color: CHALK_DIM }}>Home runs</div><NumInput value={scoreForm.home} onChange={v => setScoreForm(f => ({ ...f, home: v }))} /></div>
                            <div><div className="text-[10px] uppercase mb-1" style={{ color: CHALK_DIM }}>{sport.periodPlural.charAt(0).toUpperCase() + sport.periodPlural.slice(1)}</div><NumInput value={scoreForm.innings} onChange={v => setScoreForm(f => ({ ...f, innings: v }))} /></div>
                            <button onClick={() => { saveScore(g.id, { awayScore: Number(scoreForm.away), homeScore: Number(scoreForm.home), innings: Number(scoreForm.innings) || (settings.standardInnings || 7) }); setEditingId(null); }}
                              disabled={scoreForm.away === '' || scoreForm.home === ''} className="px-3 py-1.5 rounded font-bold text-xs flex items-center gap-1 disabled:opacity-40" style={{ background: PRIMARY, color: INK }}><Save size={13} /> Save</button>
                            <button onClick={() => setEditingId(null)} className="px-2 py-1.5 rounded text-xs" style={{ color: CHALK_DIM }}>Cancel</button>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 pt-1" style={{ borderTop: `1px solid ${LINE}` }}>
                            <span className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>Forfeit:</span>
                            <button onClick={() => { if (confirm(`Declare a forfeit — ${away ? away.name : g.awayScheduleName} forfeits, ${home ? home.name : g.homeScheduleName} wins 9-0?`)) { declareForfeit(g.id, 'away'); setEditingId(null); } }}
                              className="px-2 py-1 rounded text-[11px] font-semibold" style={{ background: PANEL, color: NEGATIVE, border: `1px solid ${LINE}` }}>Away forfeits</button>
                            <button onClick={() => { if (confirm(`Declare a forfeit — ${home ? home.name : g.homeScheduleName} forfeits, ${away ? away.name : g.awayScheduleName} wins 9-0?`)) { declareForfeit(g.id, 'home'); setEditingId(null); } }}
                              className="px-2 py-1 rounded text-[11px] font-semibold" style={{ background: PANEL, color: NEGATIVE, border: `1px solid ${LINE}` }}>Home forfeits</button>
                          </div>
                          {g.played && (
                            <div className="flex flex-wrap items-center gap-2 pt-1" style={{ borderTop: `1px solid ${LINE}` }}>
                              <span className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>Winner:</span>
                              <button onClick={() => setWinnerOverride(g.id, 'away')} className="px-2 py-1 rounded text-[11px] font-semibold" style={{ background: w === 'away' && g.winnerOverride ? PRIMARY : PANEL, color: w === 'away' && g.winnerOverride ? INK : CHALK, border: `1px solid ${LINE}` }}>{away ? away.name : 'Away'} won</button>
                              <button onClick={() => setWinnerOverride(g.id, 'home')} className="px-2 py-1 rounded text-[11px] font-semibold" style={{ background: w === 'home' && g.winnerOverride ? PRIMARY : PANEL, color: w === 'home' && g.winnerOverride ? INK : CHALK, border: `1px solid ${LINE}` }}>{home ? home.name : 'Home'} won</button>
                              {g.winnerOverride && <button onClick={() => setWinnerOverride(g.id, null)} className="px-2 py-1 rounded text-[11px]" style={{ color: CHALK_DIM }}>Use score instead</button>}
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-2 pt-1" style={{ borderTop: `1px solid ${LINE}` }}>
                            <span className="text-[10px] uppercase flex-shrink-0" style={{ color: CHALK_DIM }}>Start time (ET):</span>
                            <input type="datetime-local" defaultValue={utcMsToEasternDatetimeLocal(g.gameTimeUTC)} onBlur={e => updateGameTime(g.id, e.target.value ? easternDatetimeLocalToUtcMs(e.target.value) : null)} className="bg-[#242424] border rounded px-2 py-1 text-xs" style={{ borderColor: LINE, color: CHALK }} />
                            {g.gameTimeUTC != null && <span className="text-[11px]" style={{ color: CHALK_DIM }}>{formatGameTimeLocal(g.gameTimeUTC)} for you</span>}
                          </div>
                          <div className="flex items-center gap-2 pt-1" style={{ borderTop: `1px solid ${LINE}` }}>
                            <span className="text-[10px] uppercase flex-shrink-0" style={{ color: CHALK_DIM }}>Note:</span>
                            <input defaultValue={g.notes || ''} onBlur={e => updateGameNotes(g.id, e.target.value)} placeholder="e.g. walk-off, rain delay…" className="flex-1 bg-[#242424] border rounded px-2 py-1 text-xs" style={{ borderColor: LINE, color: CHALK }} />
                          </div>
                          <div className="flex items-center gap-2 pt-1" style={{ borderTop: `1px solid ${LINE}` }}>
                            <span className="text-[10px] uppercase flex-shrink-0 flex items-center gap-1" style={{ color: CHALK_DIM }}><Video size={11} /> Stream:</span>
                            <input defaultValue={g.streamUrl || ''} onBlur={e => updateGameStreamUrl(g.id, e.target.value.trim())} placeholder="Twitch or YouTube link" className="flex-1 bg-[#242424] border rounded px-2 py-1 text-xs" style={{ borderColor: LINE, color: CHALK }} />
                          </div>
                          <div className="flex flex-wrap items-center gap-2 pt-1" style={{ borderTop: `1px solid ${LINE}` }}>
                            <span className="text-[10px] uppercase flex-shrink-0" style={{ color: CHALK_DIM }}>Stats:</span>
                            <button onClick={() => setStatImport({ gameId: g.id, side: 'away' })} className="px-2 py-1 rounded text-[11px] font-semibold" style={{ background: PANEL, color: CHALK, border: `1px solid ${LINE}` }}>
                              {g.playerStats && g.playerStats.away && g.playerStats.away.length > 0 ? `Away: ${g.playerStats.away.length} players ✓` : 'Import away stats'}
                            </button>
                            <button onClick={() => setStatImport({ gameId: g.id, side: 'home' })} className="px-2 py-1 rounded text-[11px] font-semibold" style={{ background: PANEL, color: CHALK, border: `1px solid ${LINE}` }}>
                              {g.playerStats && g.playerStats.home && g.playerStats.home.length > 0 ? `Home: ${g.playerStats.home.length} players ✓` : 'Import home stats'}
                            </button>
                          </div>
                        </div>
                      )}
                      {editingId !== g.id && g.notes && (
                        <div className="px-3 pb-2 text-[11px] italic" style={{ color: CHALK_DIM, borderLeft: `3px solid ${awayColor}`, borderRight: `3px solid ${homeColor}` }}>{g.notes}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Panel>
      {statImport && (() => {
        const g = (season.games || []).find(gg => gg.id === statImport.gameId);
        if (!g) return null;
        const teamId = statImport.side === 'home' ? g.homeTeamId : g.awayTeamId;
        const team = teamsById[teamId];
        const member = (season.members || []).find(m => m.teamId === teamId);
        const roster = (member && member.roster) || [];
        const existingRows = g.playerStats && g.playerStats[statImport.side];
        return (
          <StatImportModal
            game={g} side={statImport.side} team={team} roster={roster} existingRows={existingRows}
            onSave={(entries) => saveGamePlayerStats(g.id, statImport.side, entries)}
            onClose={() => setStatImport(null)}
          />
        );
      })()}
    </div>
  );
}

// Schedule-management tools (import, manual add, round-robin generator,
// balance checker) — moved out of the Schedule tab (which is now a public
// read-mostly game list) into Settings, since they're all admin-only setup
// tools rather than something a visitor would ever need.
function ScheduleManagementPanel({ season, settings, importGames, addManualGame, generateSchedule, teamsById }) {
  const scheduleMode = settings.scheduleMode || 'date';
  const labelWord = scheduleMode === 'round' ? 'Round' : 'Date';
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [manual, setManual] = useState({ date: '', awayTeamId: '', homeTeamId: '', isSpringTraining: false });
  const [showAdd, setShowAdd] = useState(false);
  const handleFile = (e) => { const f = e.target.files[0]; if (!f) return; const reader = new FileReader(); reader.onload = () => setText(String(reader.result || '')); reader.readAsText(f); };
  const runPreview = () => setPreview(parseScheduleText(text, scheduleMode));
  const confirmImport = () => { if (!preview) return; importGames(preview.filter(r => r.matched)); setPreview(null); setText(''); setShowAdd(false); };
  return (
    <>
      <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
        <SectionTitle accent={PRIMARY} right={<button onClick={() => setShowAdd(v => !v)} className="text-[11px] font-bold" style={{ color: PRIMARY }}>{showAdd ? 'Hide' : 'Add games'}</button>}>Add to schedule</SectionTitle>
        {showAdd && (
          <div className="px-4 pb-3 space-y-3">
            <div className="space-y-2">
              <p className="text-xs" style={{ color: CHALK_DIM }}>Put a {labelWord.toLowerCase()} on its own line, then list that {labelWord.toLowerCase()}'s games underneath. Change this in the "Schedule labels" setting above.</p>
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-semibold cursor-pointer" style={{ background: PANEL2, color: CHALK, border: `1px solid ${LINE}` }}>
                <Upload size={14} /> Choose .txt file
                <input type="file" accept=".txt,.csv" className="hidden" onChange={handleFile} />
              </label>
              <textarea value={text} onChange={e => setText(e.target.value)} rows={6}
                placeholder={scheduleMode === 'round' ? 'Round 1\nHeat @ Ospreys\nWolves @ Falcons\n\nRound 2\nOspreys @ Wolves' : 'April 5\nHeat @ Ospreys\nWolves @ Falcons\n\nApril 12\nOspreys @ Wolves'}
                className="w-full bg-[#242424] border rounded px-3 py-2 text-sm font-mono" style={{ borderColor: LINE, color: CHALK }} />
              <button onClick={runPreview} disabled={!text.trim()} className="px-3 py-2 rounded font-bold text-sm disabled:opacity-40" style={{ background: PRIMARY, color: INK }}>Preview import</button>
              {preview && (
                <div className="mt-2 rounded-lg border" style={{ borderColor: LINE }}>
                  <div className="max-h-56 overflow-y-auto divide-y" style={{ borderColor: LINE }}>
                    {preview.map(r => r.isHeader ? (
                      <div key={r.rowId} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: PRIMARY, background: PANEL2 }}>{scheduleMode === 'round' ? formatRoundLabel(r.date) : r.date}</div>
                    ) : (
                      <div key={r.rowId} className="px-3 py-1.5 text-xs flex items-center gap-2">
                        {r.matched ? <Check size={12} style={{ color: PRIMARY }} /> : <X size={12} style={{ color: NEGATIVE }} />}
                        <span style={{ color: r.matched ? CHALK : CHALK_DIM }}>{r.matched ? `${r.away} @ ${r.home}${r.awayScore != null ? ` (${r.awayScore}-${r.homeScore})` : ''}` : `Unrecognized: "${r.raw}"`}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 text-xs" style={{ color: CHALK_DIM }}>
                    <span>{preview.filter(r => r.matched).length} of {preview.filter(r => !r.isHeader).length} lines recognized</span>
                    <div className="flex gap-2">
                      <button onClick={() => setPreview(null)} className="px-2 py-1 rounded" style={{ color: CHALK_DIM }}>Cancel</button>
                      <button onClick={confirmImport} className="px-3 py-1.5 rounded font-bold" style={{ background: PRIMARY, color: INK }}>Import games</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 items-end text-sm pt-2" style={{ borderTop: `1px solid ${LINE}` }}>
              <div><div className="text-[10px] uppercase mb-1" style={{ color: CHALK_DIM }}>{labelWord}</div>
                <input value={manual.date} onChange={e => setManual(m => ({ ...m, date: e.target.value }))} placeholder={scheduleMode === 'round' ? '3' : 'Apr 12'} className="w-24 bg-[#242424] border rounded px-2 py-1.5" style={{ borderColor: LINE, color: CHALK }} /></div>
              <div><div className="text-[10px] uppercase mb-1" style={{ color: CHALK_DIM }}>Away</div>
                <select value={manual.awayTeamId} onChange={e => setManual(m => ({ ...m, awayTeamId: e.target.value }))} className="bg-[#242424] border rounded px-2 py-1.5" style={{ borderColor: LINE, color: CHALK }}>
                  <option style={{ background: PANEL2, color: CHALK }} value="">Select</option>{season.members.map(m => <option style={{ background: PANEL2, color: CHALK }} key={m.teamId} value={m.teamId}>{teamsById[m.teamId]?.name || m.scheduleName}</option>)}
                </select></div>
              <div><div className="text-[10px] uppercase mb-1" style={{ color: CHALK_DIM }}>Home</div>
                <select value={manual.homeTeamId} onChange={e => setManual(m => ({ ...m, homeTeamId: e.target.value }))} className="bg-[#242424] border rounded px-2 py-1.5" style={{ borderColor: LINE, color: CHALK }}>
                  <option style={{ background: PANEL2, color: CHALK }} value="">Select</option>{season.members.map(m => <option style={{ background: PANEL2, color: CHALK }} key={m.teamId} value={m.teamId}>{teamsById[m.teamId]?.name || m.scheduleName}</option>)}
                </select></div>
              <label className="flex items-center gap-1.5 text-xs pb-1.5" style={{ color: CHALK_DIM }}>
                <input type="checkbox" checked={manual.isSpringTraining} onChange={e => setManual(m => ({ ...m, isSpringTraining: e.target.checked }))} style={{ accentColor: PRIMARY }} /> Spring training (exhibition — won't count toward standings/stats)
              </label>
              <button onClick={() => { if (manual.awayTeamId && manual.homeTeamId && manual.awayTeamId !== manual.homeTeamId) { addManualGame(manual); setManual({ date: '', awayTeamId: '', homeTeamId: '', isSpringTraining: false }); } }} className="px-3 py-1.5 rounded font-bold flex items-center gap-1" style={{ background: PRIMARY, color: INK }}><Plus size={14} /> Add</button>
            </div>
          </div>
        )}
      </Panel>
      <RoundRobinGenerator season={season} teamsById={teamsById} generateSchedule={generateSchedule} />
      <ScheduleBalanceChecker season={season} teamsById={teamsById} />
    </>
  );
}

/* ==================================================================== */
/* Stats view                                                            */
/* ==================================================================== */
function StatsView({ standings, onOpenTeam, season }) {
  // Second-half surge: splits each team's games in half chronologically and
  // compares win% in each half — a different lens from Hot & Cold (which
  // only looks at the last 10) or Power Rankings (which is season-wide).
  const surgeRanked = standings.map(t => {
    const results = t.results || [];
    if (results.length < 6) return null;
    const mid = Math.floor(results.length / 2);
    const first = results.slice(0, mid), second = results.slice(mid);
    const firstW = first.filter(r => r === 'W').length, secondW = second.filter(r => r === 'W').length;
    const firstPct = firstW / first.length, secondPct = secondW / second.length;
    return { ...t, firstPct, secondPct, surge: secondPct - firstPct, firstRecord: `${firstW}-${first.length - firstW}`, secondRecord: `${secondW}-${second.length - secondW}` };
  }).filter(x => x && Math.abs(x.surge) > 0.15).sort((a, b) => b.surge - a.surge);

  const remainingByTeam = season ? computeRemaining(season) : {};
  const bestFinishRanked = standings.map(t => ({ t, bf: computeBestPossibleFinish(standings, t.id, remainingByTeam) }))
    .filter(x => x.bf && x.bf.remaining > 0 && x.bf.bestRank < x.bf.currentRank)
    .sort((a, b) => (a.bf.currentRank - a.bf.bestRank) === (b.bf.currentRank - b.bf.bestRank) ? a.bf.bestRank - b.bf.bestRank : (b.bf.currentRank - b.bf.bestRank) - (a.bf.currentRank - a.bf.bestRank));

  const powerRanked = [...standings].map(t => {
    const diffPerG = t.gp > 0 ? t.diff / t.gp : 0;
    const sosAdj = ((t.sos != null ? t.sos : 0.5) - 0.5) * 0.2;
    const power = t.pct + diffPerG * 0.1 + sosAdj;
    const rf2 = t.rf * t.rf, ra2 = t.ra * t.ra;
    const pythPct = (rf2 + ra2) > 0 ? rf2 / (rf2 + ra2) : 0.5;
    const pythW = pythPct * t.gp;
    const luck = t.w - pythW;
    return { ...t, power, pythW, pythL: t.gp - pythW, luck };
  }).sort((a, b) => b.power - a.power);

  // Clutch rating: how a team performs specifically in high-leverage, tight
  // games (decided by 1 run, or that went to extra innings/periods).
  const clutchRanked = [...standings].map(t => {
    const oneRunGp = t.oneRunW + t.oneRunL, xInnGp = t.xInnW + t.xInnL;
    const oneRunPct = oneRunGp > 0 ? t.oneRunW / oneRunGp : null;
    const xInnPct = xInnGp > 0 ? t.xInnW / xInnGp : null;
    const parts = [oneRunPct, xInnPct].filter(v => v != null);
    const clutch = parts.length ? (oneRunPct != null ? oneRunPct * 0.65 : 0) + (xInnPct != null ? xInnPct * 0.35 : 0) : null;
    return { ...t, clutch, oneRunGp, xInnGp };
  }).filter(t => t.clutch != null && (t.oneRunGp + t.xInnGp) > 0).sort((a, b) => b.clutch - a.clutch);

  // Hot/cold index: recent form (last 10) compared to season-long win%, so a
  // team playing above or below their overall level stands out.
  const formRanked = [...standings].map(t => {
    const l10w = t.last10.filter(r => r === 'W').length, l10gp = t.last10.length;
    const l10Pct = l10gp > 0 ? l10w / l10gp : null;
    const delta = l10Pct != null ? l10Pct - t.pct : null;
    return { ...t, l10Pct, delta, l10w, l10gp };
  }).filter(t => t.l10gp >= 5)
    // Sort by ABSOLUTE recent form first (a team on a losing streak should
    // never rank above a team on a winning one, no matter their season-long
    // baseline), then by the relative trend as a tiebreaker.
    .sort((a, b) => b.l10Pct - a.l10Pct || b.delta - a.delta);

  return (
    <div className="p-3 space-y-3">
      <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
        <SectionTitle accent={GOLD}>Power rankings</SectionTitle>
        <div className="px-2 pb-3">
          {powerRanked.map((t, i) => (
            <div key={t.id} className="flex items-center gap-2 px-2 py-2 text-sm" style={{ borderBottom: `1px solid ${LINE}`, borderLeft: `3px solid ${teamColor(t)}` }}>
              <span className="font-mono w-5 flex-shrink-0" style={{ color: CHALK_DIM }}>{i + 1}</span>
              <button onClick={() => onOpenTeam(t.id)} className="flex-1 min-w-0 flex items-center gap-2 text-left" style={{ color: CHALK }}><TeamMark team={t} size={16} /> <span className="truncate">{t.displayName}</span></button>
              <span className="font-mono text-xs" style={{ color: t.luck > 0.5 ? WIN : t.luck < -0.5 ? NEGATIVE : CHALK_DIM }}>{t.luck > 0 ? `+${t.luck.toFixed(1)}` : t.luck.toFixed(1)} luck</span>
            </div>
          ))}
          {powerRanked.length === 0 && <p className="px-2 py-4 text-sm" style={{ color: CHALK_DIM }}>No teams yet.</p>}
        </div>
        <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>Blends win%, run differential per game, and strength of schedule. "Luck" compares actual wins to Pythagorean expected wins (from runs scored/allowed) — positive means winning more than their run totals suggest.</p>
      </Panel>
      {clutchRanked.length > 0 && (
        <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
          <SectionTitle accent={GOLD}>Clutch rating</SectionTitle>
          <div className="px-2 pb-3">
            {clutchRanked.map((t, i) => (
              <div key={t.id} className="flex items-center gap-2 px-2 py-2 text-sm" style={{ borderBottom: `1px solid ${LINE}`, borderLeft: `3px solid ${teamColor(t)}` }}>
                <span className="font-mono w-5 flex-shrink-0" style={{ color: CHALK_DIM }}>{i + 1}</span>
                <button onClick={() => onOpenTeam(t.id)} className="flex-1 min-w-0 flex items-center gap-2 text-left" style={{ color: CHALK }}><TeamMark team={t} size={16} /> <span className="truncate">{t.displayName}</span></button>
                <span className="font-mono text-xs" style={{ color: CHALK_DIM }}>{t.oneRunW}-{t.oneRunL} 1R · {t.xInnW}-{t.xInnL} XI</span>
              </div>
            ))}
          </div>
          <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>Ranked by winning percentage in 1-run games (weighted 65%) and extra-innings games (weighted 35%) — how teams perform when it's tight. Only includes teams with at least one such game.</p>
        </Panel>
      )}
      {formRanked.length > 0 && (
        <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
          <SectionTitle accent={GOLD}>Hot &amp; cold</SectionTitle>
          <div className="px-2 pb-3">
            {formRanked.map((t, i) => (
              <div key={t.id} className="flex items-center gap-2 px-2 py-2 text-sm" style={{ borderBottom: `1px solid ${LINE}`, borderLeft: `3px solid ${teamColor(t)}` }}>
                <span className="font-mono w-5 flex-shrink-0" style={{ color: CHALK_DIM }}>{i + 1}</span>
                <button onClick={() => onOpenTeam(t.id)} className="flex-1 min-w-0 flex items-center gap-2 text-left" style={{ color: CHALK }}><TeamMark team={t} size={16} /> <span className="truncate">{t.displayName}</span></button>
                <span className="font-mono text-xs" style={{ color: CHALK_DIM }}>{t.l10w}-{t.l10gp - t.l10w} L10</span>
                <span className="font-mono text-xs font-bold" style={{ color: t.delta > 0.1 ? WIN : t.delta < -0.1 ? NEGATIVE : CHALK_DIM }}>{t.delta > 0 ? '+' : ''}{(t.delta * 100).toFixed(0)}pp</span>
              </div>
            ))}
          </div>
          <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>Ranked by last-10 record first (so a losing streak always sorts below a winning one, no matter the season-long record) — the +/- number is how that compares to their season-long win%, as a secondary trend signal.</p>
        </Panel>
      )}
      {bestFinishRanked.length > 0 && (
        <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
          <SectionTitle accent={GOLD}>Best possible finish</SectionTitle>
          <div className="px-2 pb-3">
            {bestFinishRanked.map(({ t, bf }) => (
              <div key={t.id} className="px-2 py-2 text-sm" style={{ borderBottom: `1px solid ${LINE}`, borderLeft: `3px solid ${teamColor(t)}` }}>
                <div className="flex items-center gap-2">
                  <button onClick={() => onOpenTeam(t.id)} className="flex-1 min-w-0 flex items-center gap-2 text-left" style={{ color: CHALK }}><TeamMark team={t} size={16} /> <span className="truncate">{t.displayName}</span></button>
                  <span className="font-mono text-xs" style={{ color: CHALK_DIM }}>#{bf.currentRank} →</span>
                  <span className="font-mono text-sm font-bold" style={{ color: WIN }}>#{bf.bestRank}</span>
                </div>
                <div className="text-[11px] pl-1 mt-0.5" style={{ color: CHALK_DIM }}>if they win out ({bf.remaining} left)</div>
              </div>
            ))}
          </div>
          <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>Only teams that could still climb are shown. A team's floor is its current win total — if that alone already beats a rival's ceiling, that rival is unreachable no matter what happens.</p>
        </Panel>
      )}
      {surgeRanked.length > 0 && (
        <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
          <SectionTitle accent={GOLD}>Second-half surge</SectionTitle>
          <div className="px-2 pb-3">
            {surgeRanked.map(t => (
              <div key={t.id} className="flex items-center gap-2 px-2 py-2 text-sm" style={{ borderBottom: `1px solid ${LINE}`, borderLeft: `3px solid ${teamColor(t)}` }}>
                <button onClick={() => onOpenTeam(t.id)} className="flex-1 min-w-0 flex items-center gap-2 text-left" style={{ color: CHALK }}><TeamMark team={t} size={16} /> <span className="truncate">{t.displayName}</span></button>
                <span className="font-mono text-xs" style={{ color: CHALK_DIM }}>{t.firstRecord} → {t.secondRecord}</span>
                <span className="font-mono text-xs font-bold" style={{ color: t.surge > 0 ? WIN : NEGATIVE }}>{t.surge > 0 ? '+' : ''}{(t.surge * 100).toFixed(0)}pp</span>
              </div>
            ))}
          </div>
          <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>Splits each team's games in half and compares win% in each — only shown for teams with at least a 15-point swing between the first and second half of their season.</p>
        </Panel>
      )}
      <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
        <SectionTitle accent={GOLD}>Advanced stats</SectionTitle>
        <div className="overflow-x-auto px-2 pb-2">
          <table className="text-sm" style={{ color: CHALK }}>
            <thead><tr className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>
              <th className="text-left px-2 py-1">Team</th><th className="px-2 py-1">Strk</th><th className="px-2 py-1">RS/G</th><th className="px-2 py-1">RA/G</th>
              <th className="px-2 py-1">SOS</th><th className="px-2 py-1">SOV</th><th className="px-2 py-1">1-Run</th><th className="px-2 py-1">X-Inn</th><th className="px-2 py-1">Def IP</th>
            </tr></thead>
            <tbody>
              {standings.map(t => (
                <tr key={t.id} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td className="px-2 py-1.5 font-semibold whitespace-nowrap" style={{ borderLeft: `3px solid ${teamColor(t)}` }}><button onClick={() => onOpenTeam(t.id)} className="flex items-center gap-2 pl-1.5" style={{ color: CHALK }}><TeamMark team={t} size={16} /> <span className="truncate max-w-[110px]">{t.displayName}</span></button></td>
                  <td className="px-2 py-1.5 text-center font-mono" style={{ color: t.streak.type === 'W' ? WIN : t.streak.type === 'L' ? NEGATIVE : CHALK_DIM }}>{t.streak.label}</td>
                  <td className="px-2 py-1.5 text-center font-mono">{t.rsPerG.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-center font-mono">{t.raPerG.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-center font-mono">{t.sos != null ? t.sos.toFixed(3).replace(/^0/, '') : '—'}</td>
                  <td className="px-2 py-1.5 text-center font-mono">{t.sov != null ? t.sov.toFixed(3).replace(/^0/, '') : '—'}</td>
                  <td className="px-2 py-1.5 text-center font-mono">{t.oneRunW}-{t.oneRunL}</td>
                  <td className="px-2 py-1.5 text-center font-mono">{t.xInnW}-{t.xInnL}</td>
                  <td className="px-2 py-1.5 text-center font-mono">{t.defInnings}</td>
                </tr>
              ))}
              {standings.length === 0 && <tr><td colSpan={9} className="text-center py-6 text-sm" style={{ color: CHALK_DIM }}>No teams yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="px-4 pb-2 text-[11px]" style={{ color: CHALK_DIM }}>SOV (strength of victory) averages the win% of opponents actually beaten — distinct from SOS, which averages every opponent played regardless of outcome.</p>
        <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>SOS is the average win% of every opponent on the schedule. Defensive innings approximates innings played on defense from each game's recorded length.</p>
      </Panel>
      <Panel>
        <SectionTitle>Home &amp; away splits</SectionTitle>
        <div className="overflow-x-auto px-2 pb-2">
          <table className="text-sm" style={{ color: CHALK }}>
            <thead><tr className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>
              <th className="text-left px-2 py-1">Team</th><th className="px-2 py-1">Home</th><th className="px-2 py-1">Away</th>
              <th className="px-2 py-1">Home RS/G</th><th className="px-2 py-1">Home RA/G</th><th className="px-2 py-1">Away RS/G</th><th className="px-2 py-1">Away RA/G</th>
            </tr></thead>
            <tbody>
              {standings.map(t => (
                <tr key={t.id} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td className="px-2 py-1.5 font-semibold whitespace-nowrap" style={{ borderLeft: `3px solid ${teamColor(t)}` }}><button onClick={() => onOpenTeam(t.id)} className="flex items-center gap-2 pl-1.5" style={{ color: CHALK }}><TeamMark team={t} size={16} /> <span className="truncate max-w-[110px]">{t.displayName}</span></button></td>
                  <td className="px-2 py-1.5 text-center font-mono">{t.homeW}-{t.homeL}</td>
                  <td className="px-2 py-1.5 text-center font-mono">{t.awayW}-{t.awayL}</td>
                  <td className="px-2 py-1.5 text-center font-mono">{t.homeRsPerG.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-center font-mono">{t.homeRaPerG.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-center font-mono">{t.awayRsPerG.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-center font-mono">{t.awayRaPerG.toFixed(2)}</td>
                </tr>
              ))}
              {standings.length === 0 && <tr><td colSpan={7} className="text-center py-6 text-sm" style={{ color: CHALK_DIM }}>No teams yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

/* ==================================================================== */
/* Team page (season-scoped)                                             */
/* ==================================================================== */
function StarLevelBadge({ value, size = 12 }) {
  return <span className="font-mono font-bold" style={{ color: (value == null || value === 'R') ? CHALK_DIM : GOLD, fontSize: size }}>{formatStarLevel(value)}</span>;
}
function StarLevelEditor({ value, onChange, disabled = false }) {
  const isR = value == null || value === 'R';
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {!isR && <NumInput value={value} onChange={v => onChange(v)} w="w-14" allowDecimal step={0.5} min={0} disabled={disabled} />}
      <button type="button" disabled={disabled} onClick={() => onChange(isR ? 3 : null)} className="text-[10px] px-1.5 py-1 rounded font-bold flex-shrink-0 disabled:opacity-50" style={{ background: isR ? GOLD : PANEL, color: isR ? INK : CHALK_DIM, border: `1px solid ${LINE}` }}>R</button>
    </div>
  );
}

function RosterPanel({ member, color, updatePlayerField, removePlayer, addPlayer, addPlayersBulk, teamOptions, onTrade, onSuspend, onBan, onOpenPlayer, teamGamesPlayed }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageRosters');
  // Signing, releasing, banning, suspending, and moving a player by trade
  // are all Board-and-up moves — a Manager can still browse rosters and
  // tweak role/star level, just not transact players.
  const canManageMoves = hasPermission('manageRosterMoves');
  const [name, setName] = useState('');
  const [starLevel, setStarLevel] = useState(null);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkPreview, setBulkPreview] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [tradingId, setTradingId] = useState(null);
  const roster = member.roster || [];
  const starTotal = roster.reduce((s, p) => s + (typeof p.starLevel === 'number' ? p.starLevel : 0), 0);
  const starAvg = rosterStrength(roster);

  return (
    <Panel className="overflow-hidden" style={{ borderColor: color }}>
      <SectionTitle accent={color} right={canManageMoves && <button onClick={() => setShowBulk(v => !v)} className="text-[11px] font-semibold" style={{ color }}>{showBulk ? 'Hide import' : 'Import roster'}</button>}>Roster</SectionTitle>
      {roster.length > 0 && (
        <p className="px-4 -mt-1 pb-2 text-xs flex items-center gap-1" style={{ color: CHALK_DIM }}>
          <Star size={12} style={{ color: GOLD }} /> Team rating: <span className="font-mono font-bold" style={{ color: GOLD }}>{starTotal}★</span> total{starAvg != null ? ` (${starAvg.toFixed(1)}★ avg)` : ''}
        </p>
      )}

      {showBulk && canManageMoves && (
        <div className="px-4 pb-3 space-y-2">
          <p className="text-xs" style={{ color: CHALK_DIM }}>One player per line: <code>Name, Stars</code> — only name is required. Use "R" for unrated.</p>
          <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={4} placeholder={'Jordan Lee, 5.5\nSam Rivera, R'}
            className="w-full bg-[#242424] border rounded px-3 py-2 text-sm font-mono" style={{ borderColor: LINE, color: CHALK }} />
          <button onClick={() => setBulkPreview(parseRosterText(bulkText))} disabled={!bulkText.trim()} className="px-3 py-1.5 rounded font-bold text-xs disabled:opacity-40" style={{ background: color, color: INK }}>Preview</button>
          {bulkPreview && (
            <div className="rounded-lg border" style={{ borderColor: LINE }}>
              <div className="max-h-40 overflow-y-auto divide-y" style={{ borderColor: LINE }}>
                {bulkPreview.map((r, i) => (
                  <div key={i} className="px-3 py-1.5 text-xs flex items-center gap-2">
                    {r.matched ? <Check size={12} style={{ color: WIN }} /> : <X size={12} style={{ color: NEGATIVE }} />}
                    <span style={{ color: r.matched ? CHALK : CHALK_DIM }}>{r.matched ? `${r.name} — ${formatStarLevel(r.starLevel)}` : 'Skipped (no name)'}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 px-3 py-2">
                <button onClick={() => { setBulkPreview(null); setBulkText(''); setShowBulk(false); }} className="text-xs" style={{ color: CHALK_DIM }}>Cancel</button>
                <button onClick={() => { addPlayersBulk(bulkPreview); setBulkPreview(null); setBulkText(''); setShowBulk(false); }} className="px-3 py-1.5 rounded font-bold text-xs" style={{ background: color, color: INK }}>Add {bulkPreview.filter(r => r.matched).length} players</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="px-2 pb-2">
        {roster.length === 0 && <p className="px-2 py-4 text-sm" style={{ color: CHALK_DIM }}>No players yet.</p>}
        {roster.map(p => {
          const isOpen = expandedId === p.id;
          return (
            <div key={p.id} className="mb-2 rounded-lg" style={{ background: PANEL2, border: `1px solid ${LINE}` }}>
              <div className="flex items-center gap-2 px-3 py-2">
                <button onClick={() => setExpandedId(isOpen ? null : p.id)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
                  {p.role && <span className="text-[10px] font-mono px-1 rounded flex-shrink-0" style={{ background: PANEL, color: CHALK_DIM }}>{p.role}</span>}
                  <span className="text-sm font-semibold truncate" style={{ color: (p.banned || p.suspended) ? NEGATIVE : CHALK }}>{p.name}</span>
                  {p.banned && <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: `${NEGATIVE}22`, color: NEGATIVE }}>Banned</span>}
                  {p.suspended && (() => {
                    const remaining = p.suspensionGames ? Math.max(0, p.suspensionGames - ((teamGamesPlayed || 0) - (p.suspensionStartGames || 0))) : null;
                    return <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: `${NEGATIVE}22`, color: NEGATIVE }}>{remaining != null ? (remaining > 0 ? `Suspended · ${remaining} left` : 'Suspension served') : 'Suspended'}</span>;
                  })()}
                </button>
                {onOpenPlayer && <button onClick={() => onOpenPlayer(p.name)} className="text-[10px] font-semibold uppercase flex-shrink-0" style={{ color }}>Profile</button>}
                <StarLevelEditor value={p.starLevel} onChange={v => updatePlayerField(p.id, 'starLevel', v)} disabled={!isLoggedIn} />
                <button onClick={() => setExpandedId(isOpen ? null : p.id)} className="p-1 flex-shrink-0" style={{ color: CHALK_DIM }}><ChevronRight size={14} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} /></button>
              </div>
              {isOpen && (
                <div className="px-3 pb-3 space-y-2" style={{ borderTop: `1px solid ${LINE}` }}>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <div><div className="text-[10px] uppercase mb-1" style={{ color: CHALK_DIM }}>Role/slot</div><input value={p.role || ''} onChange={e => updatePlayerField(p.id, 'role', e.target.value)} disabled={!isLoggedIn} className="w-16 bg-[#242424] border rounded px-2 py-1 text-xs disabled:opacity-50" style={{ borderColor: LINE, color: CHALK }} /></div>
                  </div>
                  {p.suspended && p.suspensionReason && <p className="text-xs italic" style={{ color: NEGATIVE }}>Suspension reason: {p.suspensionReason}</p>}
                  {p.suspended && p.suspensionGames && <p className="text-xs" style={{ color: CHALK_DIM }}>Length: {p.suspensionGames} game{p.suspensionGames === 1 ? '' : 's'}</p>}
                  {p.banned && p.banReason && <p className="text-xs italic" style={{ color: NEGATIVE }}>Ban reason: {p.banReason}</p>}
                  {canManageMoves && (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    {teamOptions && teamOptions.length > 0 && (
                      <button onClick={() => setTradingId(tradingId === p.id ? null : p.id)} className="text-xs flex items-center gap-1" style={{ color: PRIMARY }}><RefreshCw size={13} /> Trade</button>
                    )}
                    {onSuspend && (
                      p.suspended
                        ? <button onClick={() => onSuspend(p.id, false)} className="text-xs flex items-center gap-1" style={{ color: WIN }}><Check size={13} /> Lift suspension</button>
                        : <button onClick={() => {
                            const reason = prompt(`Reason for suspending ${p.name}? (optional)`) || '';
                            const durRaw = prompt('Suspension length in games? (leave blank for indefinite)') || '';
                            const dur = parseInt(durRaw, 10);
                            onSuspend(p.id, true, reason, Number.isFinite(dur) && dur > 0 ? dur : null);
                          }} className="text-xs flex items-center gap-1" style={{ color: GOLD }}><AlertTriangle size={13} /> Suspend</button>
                    )}
                    {onBan && (
                      p.banned
                        ? <button onClick={() => onBan(p.id, false)} className="text-xs flex items-center gap-1" style={{ color: WIN }}><Check size={13} /> Lift ban</button>
                        : <button onClick={() => { if (confirm(`Ban ${p.name}? They'll disappear from stat leaders until unbanned.`)) { const reason = prompt(`Reason for banning ${p.name}? (optional)`) || ''; onBan(p.id, true, reason); } }} className="text-xs flex items-center gap-1" style={{ color: NEGATIVE }}><Ban size={13} /> Ban</button>
                    )}
                    <button onClick={() => { if (confirm(`Release ${p.name} to free agency? Their stats stay intact, and they can be re-signed later.`)) removePlayer(p.id); }} className="text-xs flex items-center gap-1" style={{ color: NEGATIVE }}><Trash2 size={13} /> Release</button>
                  </div>
                  )}
                  {canManageMoves && tradingId === p.id && teamOptions && (
                    <div className="pt-1" style={{ borderTop: `1px solid ${LINE}` }}>
                      <div className="text-[10px] uppercase mb-1.5 mt-2" style={{ color: CHALK_DIM }}>Trade {p.name} to:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {teamOptions.map(t => (
                          <button key={t.id} onClick={() => { onTrade(t.id, p.id); setTradingId(null); setExpandedId(null); }} className="text-xs px-2 py-1 rounded font-semibold" style={{ background: PANEL, color: CHALK, border: `1px solid ${LINE}` }}>{t.name}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canManageMoves && (
      <div className="px-4 pb-3 flex items-center gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Player name" className="flex-1 bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
        <StarLevelEditor value={starLevel} onChange={setStarLevel} />
        <button onClick={() => { if (name.trim()) { addPlayer(name.trim(), starLevel); setName(''); setStarLevel(null); } }} className="px-3 py-2 rounded font-bold text-sm flex-shrink-0" style={{ background: color, color: INK }}><Plus size={16} /></button>
      </div>
      )}
    </Panel>
  );
}

// Admin-only aggregate roster view: every team's roster (create/remove/trade/
// suspend) in one place, so managing the league doesn't require opening each
// team's page individually. Reuses RosterPanel per-team, same as TeamPage.
// Two-team trade builder: pick both sides, check off whoever's moving from
// each roster, execute as one atomic multi-player trade.
function TradeCenter({ season, teamsById, onExecuteTrade, onProposeTrade }) {
  const { hasPermission } = useAuth();
  const canManageMoves = hasPermission('manageRosterMoves');
  const [teamAId, setTeamAId] = useState('');
  const [teamBId, setTeamBId] = useState('');
  const [selectedA, setSelectedA] = useState([]);
  const [selectedB, setSelectedB] = useState([]);
  const memberA = season.members.find(m => m.teamId === teamAId);
  const memberB = season.members.find(m => m.teamId === teamBId);
  const toggle = (list, setList, id) => setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const bothPicked = teamAId && teamBId && teamAId !== teamBId;
  const canTrade = bothPicked && (selectedA.length > 0 || selectedB.length > 0);

  const RosterColumn = ({ member, sel, setSel }) => {
    const gt = teamsById[member.teamId] || { id: member.teamId, name: member.scheduleName };
    return (
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: LINE }}>
        <div className="px-2 py-1.5 text-xs font-bold flex items-center gap-1.5 truncate" style={{ background: PANEL2, color: CHALK }}><TeamMark team={gt} size={14} /> {gt.name}</div>
        <div className="max-h-56 overflow-y-auto">
          {(member.roster || []).map(p => (
            <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer" style={{ borderTop: `1px solid ${LINE}` }}>
              <input type="checkbox" checked={sel.includes(p.id)} onChange={() => toggle(sel, setSel, p.id)} style={{ accentColor: PRIMARY }} />
              <span className="truncate" style={{ color: CHALK }}>{p.name}</span>
            </label>
          ))}
          {(member.roster || []).length === 0 && <p className="px-2 py-2 text-xs" style={{ color: CHALK_DIM }}>No players.</p>}
        </div>
      </div>
    );
  };

  return (
    <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
      <SectionTitle accent={PRIMARY}>Trade center</SectionTitle>
      <div className="px-4 pb-3 space-y-3">
        <div className="flex items-center gap-2">
          <select value={teamAId} onChange={e => { setTeamAId(e.target.value); setSelectedA([]); }} className="flex-1 bg-[#242424] border rounded px-2 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }}>
            <option value="">Team A…</option>
            {season.members.map(m => <option key={m.teamId} value={m.teamId}>{(teamsById[m.teamId] || {}).name || m.scheduleName}</option>)}
          </select>
          <span className="text-xs font-bold flex-shrink-0" style={{ color: CHALK_DIM }}>⇄</span>
          <select value={teamBId} onChange={e => { setTeamBId(e.target.value); setSelectedB([]); }} className="flex-1 bg-[#242424] border rounded px-2 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }}>
            <option value="">Team B…</option>
            {season.members.map(m => <option key={m.teamId} value={m.teamId}>{(teamsById[m.teamId] || {}).name || m.scheduleName}</option>)}
          </select>
        </div>
        {bothPicked && memberA && memberB && (
          <div className="grid grid-cols-2 gap-3">
            <RosterColumn member={memberA} sel={selectedA} setSel={setSelectedA} />
            <RosterColumn member={memberB} sel={selectedB} setSel={setSelectedB} />
          </div>
        )}
        {bothPicked && (
          <div className="flex flex-wrap gap-2">
            {canManageMoves && <button onClick={() => { onExecuteTrade(teamAId, teamBId, selectedA, selectedB); setSelectedA([]); setSelectedB([]); }} disabled={!canTrade} className="px-3 py-2 rounded font-bold text-sm flex items-center gap-1 disabled:opacity-40" style={{ background: PRIMARY, color: INK }}><RefreshCw size={14} /> Execute now{canTrade ? ` (${selectedA.length + selectedB.length} players)` : ''}</button>}
            <button onClick={() => { onProposeTrade(teamAId, teamBId, selectedA, selectedB); setSelectedA([]); setSelectedB([]); }} disabled={!canTrade} className="px-3 py-2 rounded font-bold text-sm flex items-center gap-1 disabled:opacity-40" style={{ background: 'transparent', color: PRIMARY, border: `1px solid ${PRIMARY}` }}>Save as proposal</button>
          </div>
        )}
        <p className="text-[11px]" style={{ color: CHALK_DIM }}>{canManageMoves ? <>&ldquo;Save as proposal&rdquo; parks the trade for review below instead of moving anyone right away.</> : 'Trades are parked as a proposal for a Board member or above to review and execute.'}</p>
      </div>
    </Panel>
  );
}

// A trade parked by "Save as proposal" instead of executed immediately —
// sits here until someone reviews it and either applies it (Execute) or
// throws it out (Discard). Player names are the snapshot taken when the
// proposal was made, not a live roster lookup, so it still reads sensibly
// even if a listed player has since been moved or renamed elsewhere.
function PendingTradesPanel({ pendingTrades, teamsById, onExecute, onDiscard }) {
  const { hasPermission } = useAuth();
  const canManageMoves = hasPermission('manageRosterMoves');
  if (!pendingTrades || pendingTrades.length === 0) return null;
  return (
    <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
      <SectionTitle accent={GOLD}>Pending trade proposals ({pendingTrades.length})</SectionTitle>
      <div className="px-4 pb-3 space-y-2">
        {pendingTrades.map(t => {
          const teamA = teamsById[t.teamAId], teamB = teamsById[t.teamBId];
          return (
            <div key={t.id} className="rounded-lg border p-3 space-y-2" style={{ borderColor: LINE, background: PANEL2 }}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: CHALK }}>
                  {teamA ? <TeamMark team={teamA} size={14} /> : null} {teamA ? teamA.name : 'Unknown team'}
                  <span style={{ color: CHALK_DIM }}>⇄</span>
                  {teamB ? <TeamMark team={teamB} size={14} /> : null} {teamB ? teamB.name : 'Unknown team'}
                </span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {canManageMoves && <button onClick={() => onExecute(t.id)} className="text-[11px] font-bold px-2.5 py-1 rounded flex items-center gap-1" style={{ background: PRIMARY, color: INK }}><Check size={12} /> Execute</button>}
                  <button onClick={() => { if (confirm('Discard this trade proposal? This does not undo anything since nothing was moved yet.')) onDiscard(t.id); }} className="text-[11px] font-bold px-2.5 py-1 rounded" style={{ color: NEGATIVE, border: `1px solid ${NEGATIVE}` }}>Discard</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs" style={{ color: CHALK_DIM }}>
                <div>{t.fromA.length > 0 ? t.fromA.map(p => p.name).join(', ') : <em>Nothing</em>} <span style={{ color: CHALK }}>→ {teamB ? teamB.name : 'other team'}</span></div>
                <div>{t.fromB.length > 0 ? t.fromB.map(p => p.name).join(', ') : <em>Nothing</em>} <span style={{ color: CHALK }}>→ {teamA ? teamA.name : 'other team'}</span></div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function FreeAgentsPanel({ season, teamsById, signFreeAgent, deleteFreeAgent, deleteFreeAgentsBulk, setPlayerBanned }) {
  const { hasPermission } = useAuth();
  const canManageMoves = hasPermission('manageRosterMoves');
  const [signingId, setSigningId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const freeAgents = season.freeAgents || [];
  // Selection is keyed by id, so a stale checkbox from a previously-viewed
  // season can't carry over and silently delete the wrong players.
  useEffect(() => { setSelected(new Set()); }, [season.id]);
  if (freeAgents.length === 0) return null;
  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = freeAgents.length > 0 && freeAgents.every(p => selected.has(p.id));
  const deleteSelected = () => {
    if (selected.size === 0) return;
    if (confirm(`Permanently delete ${selected.size} free agent${selected.size === 1 ? '' : 's'}? This does not affect their existing stats.`)) {
      deleteFreeAgentsBulk([...selected]);
      setSelected(new Set());
    }
  };
  return (
    <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
      <SectionTitle accent={GOLD} right={canManageMoves && deleteFreeAgentsBulk && freeAgents.length > 1 && (
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: CHALK_DIM }}>
            <input type="checkbox" checked={allSelected} onChange={e => setSelected(e.target.checked ? new Set(freeAgents.map(p => p.id)) : new Set())} style={{ accentColor: GOLD }} /> Select all
          </label>
          {selected.size > 0 && <button onClick={deleteSelected} className="text-[11px] font-bold px-2 py-1 rounded flex items-center gap-1" style={{ background: `${NEGATIVE}22`, color: NEGATIVE }}><Trash2 size={12} /> Delete {selected.size}</button>}
        </div>
      )}>Free agents ({freeAgents.length})</SectionTitle>
      <p className="px-4 pb-3 text-xs" style={{ color: CHALK_DIM }}>Released players land here instead of being deleted, so their stats stay on Leaders and their player page. Sign one to a roster to bring them back, or bulk-delete stale entries from an old season.</p>
      <div className="px-2 pb-3">
        {freeAgents.map((p, i) => (
          <div key={p.id} className="flex items-center gap-2 px-2 py-2" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
            {canManageMoves && deleteFreeAgentsBulk && freeAgents.length > 1 && (
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="flex-shrink-0" style={{ accentColor: GOLD }} />
            )}
            <span className="flex-1 text-sm font-semibold truncate" style={{ color: p.banned ? NEGATIVE : CHALK }}>{p.name}</span>
            {p.banned && <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: `${NEGATIVE}22`, color: NEGATIVE }}>Banned</span>}
            {setPlayerBanned && canManageMoves && (
              p.banned
                ? <button onClick={() => setPlayerBanned(p.id, false)} className="text-xs flex items-center gap-1 flex-shrink-0" style={{ color: WIN }}><Check size={13} /> Lift ban</button>
                : <button onClick={() => { if (confirm(`Ban ${p.name}? They'll disappear from stat leaders until unbanned.`)) { const reason = prompt(`Reason for banning ${p.name}? (optional)`) || ''; setPlayerBanned(p.id, true, reason); } }} className="text-xs flex items-center gap-1 flex-shrink-0" style={{ color: NEGATIVE }}><Ban size={13} /> Ban</button>
            )}
            {canManageMoves && (signingId === p.id ? (
              <select autoFocus defaultValue="" onChange={e => { if (e.target.value) { signFreeAgent(e.target.value, p.id); setSigningId(null); } }} onBlur={() => setSigningId(null)} className="text-xs px-2 py-1.5 rounded" style={{ background: PANEL2, color: CHALK, border: `1px solid ${LINE}` }}>
                <option value="" disabled>Sign to…</option>
                {season.members.map(m => <option key={m.teamId} value={m.teamId}>{(teamsById[m.teamId] && teamsById[m.teamId].name) || m.scheduleName}</option>)}
              </select>
            ) : (
              <button onClick={() => setSigningId(p.id)} className="text-[11px] font-bold px-2 py-1.5 rounded flex-shrink-0" style={{ background: `${GOLD}22`, color: GOLD }}>Sign…</button>
            ))}
            <button onClick={() => { if (confirm(`Permanently delete ${p.name} from the free agent pool? This does not affect their existing stats.`)) deleteFreeAgent(p.id); }} className="text-xs flex-shrink-0" style={{ color: CHALK_DIM }} title="Delete permanently"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
    </Panel>
  );
}
function NewSigningPanel({ season, teamsById, addPlayer, signFreeAgent }) {
  const { hasPermission } = useAuth();
  const [open, setOpen] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [mode, setMode] = useState('new');
  const [name, setName] = useState('');
  const [starLevel, setStarLevel] = useState(null);
  const [faId, setFaId] = useState('');
  const freeAgents = season.freeAgents || [];
  if (!hasPermission('manageRosterMoves')) return null;
  const reset = () => { setOpen(false); setTeamId(''); setMode('new'); setName(''); setStarLevel(null); setFaId(''); };
  const submit = () => {
    if (!teamId) return;
    if (mode === 'new') {
      if (!name.trim()) return;
      addPlayer(teamId, name.trim(), starLevel);
    } else {
      if (!faId) return;
      signFreeAgent(teamId, faId);
    }
    reset();
  };
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm" style={{ background: PRIMARY, color: INK }}><Plus size={16} /> New Signing</button>
    );
  }
  return (
    <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
      <SectionTitle accent={PRIMARY} right={<button onClick={reset} className="text-[11px] font-semibold" style={{ color: CHALK_DIM }}>Cancel</button>}>New signing</SectionTitle>
      <div className="px-4 pb-3 space-y-3">
        <select value={teamId} onChange={e => setTeamId(e.target.value)} className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }}>
          <option value="" disabled>Sign to which team?</option>
          {season.members.map(m => <option key={m.teamId} value={m.teamId}>{(teamsById[m.teamId] && teamsById[m.teamId].name) || m.scheduleName}</option>)}
        </select>
        {freeAgents.length > 0 && (
          <div className="flex rounded-lg overflow-hidden border w-fit" style={{ borderColor: LINE }}>
            {[['new', 'New player'], ['fa', 'From free agency']].map(([m, label]) => (
              <button key={m} onClick={() => setMode(m)} className="px-3 py-1.5 text-xs font-bold" style={{ background: mode === m ? PRIMARY : 'transparent', color: mode === m ? INK : CHALK_DIM }}>{label}</button>
            ))}
          </div>
        )}
        {mode === 'new' ? (
          <div className="flex items-center gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Player name" className="flex-1 bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
            <StarLevelEditor value={starLevel} onChange={setStarLevel} />
          </div>
        ) : (
          <select value={faId} onChange={e => setFaId(e.target.value)} className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }}>
            <option value="" disabled>Choose a free agent…</option>
            {freeAgents.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <button onClick={submit} disabled={!teamId || (mode === 'new' ? !name.trim() : !faId)} className="px-4 py-2 rounded font-bold text-sm disabled:opacity-40" style={{ background: PRIMARY, color: INK }}>Sign player</button>
      </div>
    </Panel>
  );
}
function RosterManagementView({ season, teamsById, updatePlayerField, removePlayer, addPlayer, addPlayersBulk, tradePlayer, tradePlayers, proposeTrade, executeTradeProposal, discardTradeProposal, setPlayerSuspended, setPlayerBanned, onOpenPlayer, signFreeAgent, deleteFreeAgent, deleteFreeAgentsBulk }) {
  const [openTeamId, setOpenTeamId] = useState(null);
  return (
    <div className="p-4 space-y-3">
      <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
        <SectionTitle accent={PRIMARY}>Roster management</SectionTitle>
        <p className="px-4 pb-3 text-xs" style={{ color: CHALK_DIM }}>Create, trade, remove, and suspend players for any team in the season. This follows whichever season you're currently viewing — switch seasons (the layers icon, top right) to clean up an older season's free agent pool.</p>
      </Panel>
      <NewSigningPanel season={season} teamsById={teamsById} addPlayer={addPlayer} signFreeAgent={signFreeAgent} />
      <FreeAgentsPanel season={season} teamsById={teamsById} signFreeAgent={signFreeAgent} deleteFreeAgent={deleteFreeAgent} deleteFreeAgentsBulk={deleteFreeAgentsBulk} setPlayerBanned={setPlayerBanned} />
      <TradeCenter season={season} teamsById={teamsById} onExecuteTrade={tradePlayers} onProposeTrade={proposeTrade} />
      <PendingTradesPanel pendingTrades={season.pendingTrades} teamsById={teamsById} onExecute={executeTradeProposal} onDiscard={discardTradeProposal} />
      {season.members.length === 0 && <Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>No teams in this season yet — add some in the Teams tab.</p></Panel>}
      {season.members.map(m => {
        const gt = teamsById[m.teamId] || { id: m.teamId, name: m.scheduleName };
        const color = teamColor(gt);
        const isOpen = openTeamId === m.teamId;
        const roster = m.roster || [];
        const suspendedCount = roster.filter(p => p.suspended).length;
        return (
          <div key={m.teamId}>
            <button onClick={() => setOpenTeamId(isOpen ? null : m.teamId)} className="w-full flex items-center gap-2 px-4 py-3 rounded-xl" style={{ background: PANEL, border: `1px solid ${LINE}` }}>
              <TeamMark team={gt} size={20} />
              <span className="flex-1 font-bold truncate text-left" style={{ color: CHALK }}>{gt.name || m.scheduleName}</span>
              <span className="text-xs font-mono flex-shrink-0" style={{ color: CHALK_DIM }}>{roster.length} player{roster.length === 1 ? '' : 's'}</span>
              {suspendedCount > 0 && <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: `${NEGATIVE}22`, color: NEGATIVE }}>{suspendedCount} suspended</span>}
              <ChevronRight size={16} style={{ color: CHALK_DIM, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
            </button>
            {isOpen && (
              <div className="mt-2">
                <RosterPanel member={m} color={color}
                  updatePlayerField={(pid, f, v) => updatePlayerField(m.teamId, pid, f, v)}
                  removePlayer={(pid) => removePlayer(m.teamId, pid)}
                  addPlayer={(n, s) => addPlayer(m.teamId, n, s)}
                  addPlayersBulk={(rows) => addPlayersBulk(m.teamId, rows)}
                  teamOptions={season.members.filter(mm => mm.teamId !== m.teamId).map(mm => ({ id: mm.teamId, name: (teamsById[mm.teamId] && teamsById[mm.teamId].name) || mm.scheduleName || 'Unknown team' }))}
                  onTrade={(toTeamId, playerId) => tradePlayer(m.teamId, toTeamId, playerId)}
                  onSuspend={(pid, susp, reason, dur) => setPlayerSuspended(m.teamId, pid, susp, reason, dur)}
                  onBan={(pid, banned, reason) => setPlayerBanned(pid, banned, reason)}
                  teamGamesPlayed={(season.games || []).filter(g => g.played && !g.isBye && (g.homeTeamId === m.teamId || g.awayTeamId === m.teamId)).length}
                  onOpenPlayer={onOpenPlayer}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RebrandPanel({ team, color, teamsById, onRebrand, onClearRebrand }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [abbr, setAbbr] = useState('');
  const [rbColor, setRbColor] = useState(color);
  const [logoUrl, setLogoUrl] = useState(null);
  const [logoBusy, setLogoBusy] = useState(false);
  // Rebrand "into" any other team already created in the site-wide team
  // registry (same list the Teams tab manages), not a fixed set of made-up
  // names — picking one carries over its name/color/logo/wordmark.
  const otherTeams = Object.values(teamsById || {}).filter(t => t.id !== team.id).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const startEditing = () => {
    setName((team.rebrand && team.rebrand.name) || '');
    setAbbr((team.rebrand && team.rebrand.abbr) || team.abbr || '');
    setRbColor((team.rebrand && team.rebrand.color) || color);
    setLogoUrl((team.rebrand && team.rebrand.logoUrl) || null);
    setOpen(true);
  };
  const applyExistingTeam = (t) => {
    setName(t.name || '');
    setAbbr(t.abbr || '');
    setRbColor(t.color || color);
    setLogoUrl(t.logoUrl || null);
  };
  const handleLogo = async (file) => {
    if (!file) return;
    setLogoBusy(true);
    try {
      const dataUrl = await resizeImageFile(file, 320);
      if (dataUrl.length > 1_500_000) alert('That image is too large even after resizing — try a smaller file.');
      else setLogoUrl(dataUrl);
    } catch (e) { alert('Could not read that image file.'); }
    setLogoBusy(false);
  };
  return (
    <Panel>
      <SectionTitle right={<button onClick={() => (open ? setOpen(false) : startEditing())} className="text-[11px] font-semibold" style={{ color }}>{open ? 'Cancel' : (team.rebrand ? 'Edit rebrand' : 'Rebrand team')}</button>}>Team identity</SectionTitle>
      {team.rebrand && !open && (
        <p className="px-4 pb-3 text-xs" style={{ color: CHALK_DIM }}>Rebranded to <span className="font-semibold" style={{ color }}>{team.rebrand.name}</span> this season — was "{team.originalName}". Other seasons still show the original name.</p>
      )}
      {open && (
        <div className="px-4 pb-3 space-y-3">
          <p className="text-xs" style={{ color: CHALK_DIM }}>Changes this team's name/color/logo for the rest of this season only — other seasons keep "{team.originalName}".</p>
          {otherTeams.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold mb-1.5" style={{ color: CHALK_DIM }}>Rebrand into an existing team</div>
              <div className="flex flex-wrap gap-1.5">
                {otherTeams.map(t => (
                  <button key={t.id} onClick={() => applyExistingTeam(t)} className="text-xs pl-1.5 pr-2 py-1 rounded font-semibold flex items-center gap-1.5" style={{ background: PANEL2, color: CHALK, border: `1px solid ${LINE}` }}>
                    <TeamMark team={t} size={16} /> {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="New team name" className="flex-1 bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
            <input value={abbr} onChange={e => setAbbr(e.target.value.toUpperCase().slice(0, 4))} placeholder="ABBR" maxLength={4} className="w-16 bg-[#242424] border rounded px-2 py-2 text-xs font-mono text-center uppercase" style={{ borderColor: LINE, color: CHALK }} title="Abbreviation" />
            <input type="color" value={rbColor} onChange={e => setRbColor(e.target.value)} className="w-9 h-9 rounded cursor-pointer bg-transparent flex-shrink-0" style={{ border: `1px solid ${LINE}` }} />
          </div>
          <div className="flex items-center gap-2">
            {logoUrl && <img src={logoUrl} alt="" className="w-10 h-10 object-contain rounded flex-shrink-0" style={{ background: PANEL2, border: `1px solid ${LINE}` }} />}
            <label className="text-[11px] px-3 py-2 rounded cursor-pointer font-semibold" style={{ background: PANEL2, color: PRIMARY, border: `1px solid ${LINE}` }}>
              {logoBusy ? 'Uploading…' : 'New logo (optional)'}
              <input type="file" accept="image/*" className="hidden" onChange={e => handleLogo(e.target.files[0])} />
            </label>
            {logoUrl && <button onClick={() => setLogoUrl(null)} className="text-[11px]" style={{ color: CHALK_DIM }}>Remove</button>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { if (name.trim()) { onRebrand(team.id, { name: name.trim(), color: rbColor, logoUrl, abbr: abbr.trim() || null }); setOpen(false); } }} disabled={!name.trim()} className="px-3 py-2 rounded font-bold text-sm disabled:opacity-40" style={{ background: color, color: INK }}>Save rebrand</button>
            {team.rebrand && <button onClick={() => { if (confirm(`Revert to "${team.originalName}"?`)) { onClearRebrand(team.id); setOpen(false); } }} className="px-3 py-2 rounded text-sm" style={{ color: NEGATIVE }}>Revert to original</button>}
          </div>
        </div>
      )}
    </Panel>
  );
}

function TeamPage({ season, settings, team, standingsRow, teamsById, h2hMatrix, championshipCount, onBack, onOpenGlobalHistory, onOpenCompare, updatePlayerField, removePlayer, addPlayer, addPlayersBulk, tradePlayer, updateMemberField, setPlayerSuspended, setPlayerBanned, onOpenPlayer, onRebrand, onClearRebrand }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageRosters');
  if (!team) return <div className="p-4"><button onClick={onBack} className="flex items-center gap-1 text-sm mb-3" style={{ color: CHALK_DIM }}><ArrowLeft size={14} /> Back</button><Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>That team could not be found.</p></Panel></div>;
  const color = teamColor(team);
  const games = sortGamesChronologically((season.games || []).filter(g => g.homeTeamId === team.id || g.awayTeamId === team.id), (season.settings && season.settings.scheduleMode) || 'date');
  const last10Record = standingsRow ? `${standingsRow.last10.filter(r => r === 'W').length}-${standingsRow.last10.filter(r => r === 'L').length}` : '0-0';
  const member = season.members.find(m => m.teamId === team.id) || {};
  const pmPlayer = (member.roster || []).find(p => (p.role || '').trim().toUpperCase() === 'PM');
  const managerName = pmPlayer ? pmPlayer.name : member.managerName;
  const fullStandings = useMemo(() => computeStandings(season, teamsById).active, [season, teamsById]);
  const bestFinish = useMemo(() => computeBestPossibleFinish(fullStandings, team.id, computeRemaining(season)), [fullStandings, team.id, season]);

  // Next scheduled game + a quick win-probability read, matching how the
  // Odds tab computes single-game odds (no home-field boost — that's only
  // applied inside playoff series simulations).
  const nextGame = games.find(g => !g.played && !g.isPlayoff && !g.isPlayIn);
  let nextGameInfo = null;
  if (nextGame) {
    const isHome = nextGame.homeTeamId === team.id;
    const oppId = isHome ? nextGame.awayTeamId : nextGame.homeTeamId;
    const me = fullStandings.find(t => t.id === team.id);
    const opp = fullStandings.find(t => t.id === oppId);
    const oppTeam = teamsById[oppId];
    if (me && opp) {
      const h2h = h2hRecord(h2hMatrix, isHome ? me.id : opp.id, isHome ? opp.id : me.id);
      const pHomeSide = winProb(isHome ? me : opp, isHome ? opp : me, h2h);
      const myOdds = (isHome ? pHomeSide : 1 - pHomeSide) * 100;
      nextGameInfo = { isHome, oppTeam, myOdds, date: nextGame.date };
    }
  }

  const opponentIds = [...new Set(season.members.filter(m => m.teamId !== team.id).map(m => m.teamId))];
  const h2hRows = opponentIds.map(oid => {
    const rec = h2hMatrix[team.id] && h2hMatrix[team.id][oid];
    if (!rec || rec.w + rec.l === 0) return null;
    const opp = teamsById[oid];
    return { id: oid, name: opp ? opp.name : (season.members.find(m => m.teamId === oid) || {}).scheduleName || 'Unknown', w: rec.w, l: rec.l, diff: rec.rf - rec.ra };
  }).filter(Boolean).sort((a, b) => (b.w - b.l) - (a.w - a.l));

  // "Heat" blends how close the season series is (record + average run
  // differential per game) with how many times the two teams have already
  // met — a single lopsided game shouldn't read as a rivalry, but a close
  // series that keeps growing should.
  const rivalryTop = h2hRows.map(r => {
    const games = r.w + r.l;
    const closenessRecord = 1 - Math.min(1, Math.abs(r.w - r.l) / games);
    const closenessRuns = 1 - Math.min(1, (Math.abs(r.diff) / games) / 8);
    const volume = Math.min(1, games / 6);
    const heat = Math.round(((closenessRecord * 0.6 + closenessRuns * 0.4) * 0.75 + volume * 0.25) * 100);
    return { ...r, games, heat };
  }).sort((a, b) => b.heat - a.heat)[0] || null;
  const rivalryLabel = (heat) => heat >= 80 ? 'Blood Feud' : heat >= 60 ? 'Heated Rivalry' : heat >= 40 ? 'Building Rivalry' : 'Casual Matchup';

  let bestWin = null, worstLoss = null;
  games.forEach(g => {
    if (!g.played || g.isForfeit) return;
    const isHome = g.homeTeamId === team.id;
    const my = isHome ? g.homeScore : g.awayScore, opp = isHome ? g.awayScore : g.homeScore;
    const w = gameWinner(g);
    const won = (isHome && w === 'home') || (!isHome && w === 'away');
    const margin = my - opp;
    if (won && (!bestWin || margin > bestWin.margin)) bestWin = { g, margin, isHome };
    if (!won && w != null && (!worstLoss || margin < worstLoss.margin)) worstLoss = { g, margin, isHome };
  });
  const nameForOpp = (g, isHome) => {
    const oppId = isHome ? g.awayTeamId : g.homeTeamId;
    return teamsById[oppId]?.name || (isHome ? g.awayScheduleName : g.homeScheduleName);
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1 text-sm" style={{ color: CHALK_DIM }}><ArrowLeft size={14} /> Back</button>
        <div className="flex items-center gap-3">
          <button onClick={() => onOpenCompare(team.id)} className="flex items-center gap-1 text-xs font-semibold" style={{ color }}><BarChart3 size={13} /> Compare</button>
          <button onClick={() => onOpenGlobalHistory(team.id)} className="flex items-center gap-1 text-xs font-semibold" style={{ color }}><History size={13} /> Full history</button>
        </div>
      </div>
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: color, boxShadow: `0 4px 20px -4px ${color}44` }}>
        <div className="relative p-5 flex items-center gap-4 overflow-hidden" style={{ background: `linear-gradient(105deg, ${color}, ${color} 45%, rgba(0,0,0,0.82))`, borderBottom: `2px solid ${color}` }}>
          {team.logoUrl
            ? <img src={team.logoUrl} alt="" className="relative w-16 h-16 object-contain flex-shrink-0 rounded-xl" style={{ boxShadow: `0 0 0 2px rgba(255,255,255,0.4)` }} />
            : <div className="relative w-16 h-16 rounded-xl flex-shrink-0" style={{ background: 'rgba(0,0,0,0.35)', border: '2px solid rgba(255,255,255,0.4)' }} />}
          <div className="relative flex-1 min-w-0">
            {team.wordmarkUrl ? <img src={team.wordmarkUrl} alt="" className="max-h-10 max-w-full object-contain" /> : <h2 className="font-head text-2xl sm:text-3xl font-bold uppercase tracking-tight truncate" style={{ color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>{team.displayName}</h2>}
            {managerName && <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>Managed by {managerName}</p>}
            {standingsRow && <p className="font-head text-sm font-semibold mt-1" style={{ color: '#fff' }}>{standingsRow.w}-{standingsRow.l} ({standingsRow.pct.toFixed(3).replace(/^0/, '')}) · Rank #{standingsRow.rank}{standingsRow.gb > 0 ? ` · ${standingsRow.gb.toFixed(1)} GB` : ''}</p>}
            {(member.roster || []).length > 0 && (
              <p className="text-xs flex items-center gap-1 mt-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
                <Star size={11} style={{ color: GOLD }} /> {(member.roster || []).reduce((s, p) => s + (typeof p.starLevel === 'number' ? p.starLevel : 0), 0)}★ team rating
              </p>
            )}
            {championshipCount > 0 && (
              <p className="flex items-center gap-1 text-xs font-bold mt-1" style={{ color: GOLD }}>
                <Crown size={13} /> {championshipCount} league championship{championshipCount === 1 ? '' : 's'}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
      <div className="lg:col-span-2 space-y-3">
      {standingsRow && (
        <>
          <Panel className="overflow-hidden" style={{ borderColor: color }}>
            <SectionTitle accent={color}>Record</SectionTitle>
            <div className="grid grid-cols-3 gap-px" style={{ background: LINE }}>
              <StatBox label="Streak" value={standingsRow.streak.label} color={standingsRow.streak.type === 'W' ? WIN : standingsRow.streak.type === 'L' ? NEGATIVE : CHALK} />
              <StatBox label="Last 10" value={last10Record} />
              <StatBox label="Strength of Sched." value={standingsRow.sos != null ? standingsRow.sos.toFixed(3).replace(/^0/, '') : '—'} />
              <StatBox label="Home Record" value={`${standingsRow.homeW}-${standingsRow.homeL}`} />
              <StatBox label="Away Record" value={`${standingsRow.awayW}-${standingsRow.awayL}`} />
              <StatBox label="1-Run Games" value={`${standingsRow.oneRunW}-${standingsRow.oneRunL}`} />
            </div>
            {(() => {
              const gamesLeft = games.filter(g => !g.played && !g.isPlayoff && !g.isPlayIn).length;
              if (gamesLeft === 0 || standingsRow.gp === 0) return null;
              const paceWins = Math.round(standingsRow.pct * (standingsRow.gp + gamesLeft));
              return (
                <p className="px-4 py-2 text-xs" style={{ color: CHALK_DIM, borderTop: `1px solid ${LINE}` }}>
                  {gamesLeft} game{gamesLeft === 1 ? '' : 's'} remaining — on pace for about <span className="font-bold" style={{ color }}>{paceWins} wins</span> at the current rate.
                </p>
              );
            })()}
            {bestFinish && bestFinish.remaining > 0 && (
              <div className="px-4 py-2 text-xs" style={{ color: CHALK_DIM, borderTop: `1px solid ${LINE}` }}>
                <span>Best possible finish: </span>
                <span className="font-bold" style={{ color: bestFinish.bestRank < bestFinish.currentRank ? WIN : CHALK }}>#{bestFinish.bestRank}</span>
                <span> — win out ({bestFinish.remaining} game{bestFinish.remaining === 1 ? '' : 's'}, {bestFinish.maxWins} wins)</span>
                {bestFinish.lockedAhead.length > 0 && <span>{`, with ${bestFinish.lockedAhead.map(o => o.displayName).join(', ')} mathematically unreachable no matter what`}</span>}
                {bestFinish.catchable.length > 0 && <span>{` — ${bestFinish.catchable.map(o => o.displayName).join(', ')} would also need to slip.`}</span>}
                {bestFinish.catchable.length === 0 && bestFinish.lockedAhead.length === 0 && <span>.</span>}
              </div>
            )}
          </Panel>
          <Panel className="overflow-hidden" style={{ borderColor: color }}>
            <SectionTitle accent={color}>Scoring</SectionTitle>
            <div className="grid grid-cols-3 gap-px" style={{ background: LINE }}>
              <StatBox label="RS / Game" value={standingsRow.rsPerG.toFixed(2)} />
              <StatBox label="RA / Game" value={standingsRow.raPerG.toFixed(2)} />
              <StatBox label="Run Diff" value={standingsRow.diff > 0 ? `+${standingsRow.diff}` : standingsRow.diff} color={standingsRow.diff > 0 ? WIN : standingsRow.diff < 0 ? NEGATIVE : CHALK} />
              <StatBox label="Home RS/G" value={standingsRow.homeRsPerG.toFixed(2)} />
              <StatBox label="Away RS/G" value={standingsRow.awayRsPerG.toFixed(2)} />
              <StatBox label="Def. Innings" value={standingsRow.defInnings} />
            </div>
          </Panel>
          <Panel className="overflow-hidden" style={{ borderColor: color }}>
            <SectionTitle accent={color}>Trends &amp; situational</SectionTitle>
            <div className="grid grid-cols-3 gap-px" style={{ background: LINE }}>
              <StatBox label="Longest Win Streak" value={standingsRow.longestWinStreak} color={WIN} />
              <StatBox label="Longest Skid" value={standingsRow.longestLossStreak} color={NEGATIVE} />
              <StatBox label="Extra Innings" value={`${standingsRow.xInnW}-${standingsRow.xInnL}`} />
              <StatBox label="Forfeit Record" value={`${standingsRow.forfeitW || 0}-${standingsRow.forfeitL || 0}`} />
            </div>
          </Panel>
          {(bestWin || worstLoss) && (
            <Panel className="overflow-hidden" style={{ borderColor: color }}>
              <SectionTitle accent={color}>Notable games</SectionTitle>
              <div className="px-4 pb-3 space-y-2 text-sm">
                {bestWin && <p style={{ color: CHALK }}><span style={{ color: WIN }} className="font-bold">Best win:</span> {bestWin.margin > 0 ? `+${bestWin.margin}` : bestWin.margin} vs {nameForOpp(bestWin.g, bestWin.isHome)}{bestWin.g.date ? ` (${bestWin.g.date})` : ''}</p>}
                {worstLoss && <p style={{ color: CHALK }}><span style={{ color: NEGATIVE }} className="font-bold">Worst loss:</span> {worstLoss.margin} vs {nameForOpp(worstLoss.g, worstLoss.isHome)}{worstLoss.g.date ? ` (${worstLoss.g.date})` : ''}</p>}
              </div>
            </Panel>
          )}
        </>
      )}

      {(() => {
        // Top 3 hitters/pitchers on just this team, this season — the same
        // pool the league-wide Stat Leaders page ranks, filtered down to one
        // roster instead of needing to cross-reference the league page.
        const teamPlayers = computeSeasonPlayerLeaders(season, teamsById, 'regular').filter(p => p.teamId === team.id);
        const teamBatters = teamPlayers.filter(p => p.totals.ab >= 3).sort((a, b) => b.batting.ops - a.batting.ops).slice(0, 3);
        const teamPitchers = teamPlayers.filter(p => p.totals.outs >= 3).sort((a, b) => a.pitching.era - b.pitching.era).slice(0, 3);
        if (teamBatters.length === 0 && teamPitchers.length === 0) return null;
        return (
          <Panel className="overflow-hidden" style={{ borderColor: color }}>
            <SectionTitle accent={color}>Team leaders</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-3 pb-3">
              {teamBatters.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase font-bold px-1 pb-1.5" style={{ color: CHALK_DIM }}>Top hitters (OPS)</div>
                  {teamBatters.map((p, i) => (
                    <button key={p.playerId} onClick={() => onOpenPlayer(p.name)} className="w-full flex items-center gap-2 px-1 py-1.5 text-left" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
                      <span className="w-4 text-xs font-mono flex-shrink-0" style={{ color: CHALK_DIM }}>{i + 1}</span>
                      <span className="flex-1 text-sm font-semibold truncate" style={{ color: CHALK }}>{p.name}</span>
                      <span className="text-sm font-mono font-bold flex-shrink-0" style={{ color }}>{p.batting.ops.toFixed(3)}</span>
                    </button>
                  ))}
                </div>
              )}
              {teamPitchers.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase font-bold px-1 pb-1.5" style={{ color: CHALK_DIM }}>Top pitchers (ERA)</div>
                  {teamPitchers.map((p, i) => (
                    <button key={p.playerId} onClick={() => onOpenPlayer(p.name)} className="w-full flex items-center gap-2 px-1 py-1.5 text-left" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
                      <span className="w-4 text-xs font-mono flex-shrink-0" style={{ color: CHALK_DIM }}>{i + 1}</span>
                      <span className="flex-1 text-sm font-semibold truncate" style={{ color: CHALK }}>{p.name}</span>
                      <span className="text-sm font-mono font-bold flex-shrink-0" style={{ color }}>{p.pitching.era.toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        );
      })()}

      <RosterPanel member={member} color={color} updatePlayerField={(pid, f, v) => updatePlayerField(team.id, pid, f, v)} removePlayer={(pid) => removePlayer(team.id, pid)} addPlayer={(n, s) => addPlayer(team.id, n, s)} addPlayersBulk={(rows) => addPlayersBulk(team.id, rows)} teamOptions={season.members.filter(m => m.teamId !== team.id).map(m => ({ id: m.teamId, name: (teamsById[m.teamId] && teamsById[m.teamId].name) || m.scheduleName || 'Unknown team' }))} onTrade={(toTeamId, playerId) => tradePlayer(team.id, toTeamId, playerId)} onSuspend={(pid, susp, reason, dur) => setPlayerSuspended(team.id, pid, susp, reason, dur)} onBan={(pid, banned, reason) => setPlayerBanned(pid, banned, reason)} onOpenPlayer={onOpenPlayer} teamGamesPlayed={games.filter(g => g.played && !g.isBye).length} />

      <Panel className="overflow-hidden" style={{ borderColor: color }}>
        <SectionTitle accent={color}>Schedule &amp; results</SectionTitle>
        <div className="px-2 pb-3 max-h-[440px] overflow-y-auto">
          {games.length === 0 && <p className="px-2 py-4 text-sm" style={{ color: CHALK_DIM }}>No games scheduled for this team.</p>}
          {games.map(g => {
            const isHome = g.homeTeamId === team.id;
            const oppId = isHome ? g.awayTeamId : g.homeTeamId;
            const oppTeam = teamsById[oppId];
            const oppName = oppTeam ? oppTeam.name : (isHome ? g.awayScheduleName : g.homeScheduleName);
            const myScore = isHome ? g.homeScore : g.awayScore, oppScore = isHome ? g.awayScore : g.homeScore;
            const w = gameWinner(g);
            const won = g.played && ((isHome && w === 'home') || (!isHome && w === 'away'));
            const lost = g.played && w != null && !won;
            return (
              <div key={g.id} className="flex items-center gap-2 px-2 py-2 text-sm" style={{ borderBottom: `1px solid ${LINE}`, borderLeft: `3px solid ${color}` }}>
                <span className="text-[11px] w-16 flex-shrink-0 truncate" style={{ color: CHALK_DIM }}>{g.isPlayoff ? g.date : (settings.scheduleMode === 'round' && g.date ? formatRoundLabel(g.date) : (g.date || '—'))}</span>
                <span className="w-6 flex-shrink-0 text-[11px]" style={{ color: CHALK_DIM }}>{isHome ? 'vs' : '@'}</span>
                <span className="flex-1 truncate">{oppName}</span>
                {g.played
                  ? <span className="font-mono text-xs px-2 py-0.5 rounded font-bold" style={{ background: won ? 'rgba(45,212,191,0.15)' : lost ? 'rgba(251,113,102,0.15)' : 'transparent', color: won ? WIN : lost ? NEGATIVE : CHALK_DIM }}>{won ? 'W' : lost ? 'L' : 'T'} {myScore}-{oppScore}{g.isForfeit ? ' (F)' : ''}{g.winnerOverride ? ' *' : ''}</span>
                  : <span className="text-[11px]" style={{ color: CHALK_DIM }}>upcoming</span>}
              </div>
            );
          })}
        </div>
      </Panel>
      </div>

      <div className="space-y-3">
        {isLoggedIn && <RebrandPanel team={team} color={color} teamsById={teamsById} onRebrand={onRebrand} onClearRebrand={onClearRebrand} />}

        {nextGameInfo && (
          <Panel className="overflow-hidden" style={{ borderColor: color }}>
            <SectionTitle accent={color}>Next game</SectionTitle>
            <div className="px-4 pb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm" style={{ color: CHALK }}>{nextGameInfo.isHome ? 'vs' : '@'}</span>
                {nextGameInfo.oppTeam && <TeamMark team={nextGameInfo.oppTeam} size={20} />}
                <span className="text-sm font-semibold truncate" style={{ color: CHALK }}>{nextGameInfo.oppTeam ? nextGameInfo.oppTeam.name : 'TBD'}</span>
              </div>
              <span className="font-mono text-sm font-bold flex-shrink-0" style={{ color: nextGameInfo.myOdds >= 50 ? WIN : CHALK_DIM }}>{nextGameInfo.myOdds.toFixed(0)}%</span>
            </div>
            {nextGameInfo.date && <p className="px-4 pb-3 text-xs" style={{ color: CHALK_DIM }}>{nextGameInfo.date}</p>}
          </Panel>
        )}

        {rivalryTop && (
          <Panel className="overflow-hidden" style={{ borderColor: color }}>
            <SectionTitle accent={color}>Rivalry meter</SectionTitle>
            <div className="px-4 pb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold truncate" style={{ color: CHALK }}>{rivalryTop.name}</span>
                <span className="font-mono text-xs flex-shrink-0" style={{ color: CHALK_DIM }}>{rivalryTop.w}-{rivalryTop.l} · {rivalryTop.diff > 0 ? `+${rivalryTop.diff}` : rivalryTop.diff} rd</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: LINE }}>
                <div className="h-full rounded-full" style={{ width: `${rivalryTop.heat}%`, background: rivalryTop.heat >= 60 ? NEGATIVE : color }} />
              </div>
              <p className="mt-1.5 text-xs font-semibold" style={{ color: rivalryTop.heat >= 60 ? NEGATIVE : CHALK_DIM }}>{rivalryLabel(rivalryTop.heat)} · {rivalryTop.heat}/100</p>
            </div>
          </Panel>
        )}

        <Panel className="overflow-hidden" style={{ borderColor: color }}>
          <SectionTitle accent={color}>Head-to-head</SectionTitle>
          <div className="px-2 pb-3">
            {h2hRows.length === 0 && <p className="px-2 py-3 text-sm" style={{ color: CHALK_DIM }}>No games played against anyone yet this season.</p>}
            {h2hRows.map(r => (
              <div key={r.id} className="flex items-center gap-2 px-2 py-2 text-sm" style={{ borderBottom: `1px solid ${LINE}` }}>
                <span className="flex-1 truncate" style={{ color: CHALK }}>{r.name}</span>
                <span className="font-mono text-xs" style={{ color: r.w >= r.l ? WIN : NEGATIVE }}>{r.w}-{r.l}</span>
                <span className="font-mono text-xs w-14 text-right" style={{ color: CHALK_DIM }}>{r.diff > 0 ? `+${r.diff}` : r.diff} rd</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      </div>
    </div>
  );
}

/* ==================================================================== */
/* Team comparison page                                                  */
/* ==================================================================== */
// The "winning" side of a stat used to be rendered in the raw, fully-
// saturated team color as bold text — readable, but a bright/neon team
// color at full opacity reads as a harsh flash against the dark panel.
// Keeping the text in the normal chalk color and using the team color only
// as a soft ~10%-opacity background wash keeps the emphasis without the
// clash, since alpha blends into whatever's behind it instead of fighting it.
function CompareStatRow({ label, aVal, bVal, aBetter, bBetter, aColor, bColor }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-sm" style={{ borderBottom: `1px solid ${LINE}` }}>
      <span className="w-16 flex-shrink-0 text-right font-mono font-semibold rounded px-1.5 py-0.5" style={{ color: aBetter ? CHALK : CHALK_DIM, background: aBetter ? `${aColor}1A` : 'transparent' }}>{aVal}</span>
      <span className="flex-1 text-center text-[10px] uppercase tracking-wide" style={{ color: CHALK_DIM }}>{label}</span>
      <span className="w-16 flex-shrink-0 font-mono font-semibold rounded px-1.5 py-0.5 text-right" style={{ color: bBetter ? CHALK : CHALK_DIM, background: bBetter ? `${bColor}1A` : 'transparent' }}>{bVal}</span>
    </div>
  );
}

// Scales a pair of same-direction (higher-is-better) values onto a 30-100
// radar axis — the better of the two lands on 100, not on whatever its raw
// units happen to be, so wildly different stats (win% vs. runs/game vs. a
// signed run differential) can share one chart. A tie parks both at 70 so
// it doesn't read as "both terrible."
function normPair(a, b) {
  if (a === b) return [70, 70];
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const scale = (v) => 30 + ((v - lo) / (hi - lo)) * 70;
  return [scale(a), scale(b)];
}

function ComparePage({ season, standingsAll, teamsById, h2hMatrix, initialTeamId, initialTeamBId, onBack, onOpenTeam }) {
  const [aId, setAId] = useState(initialTeamId || (season.members[0] && season.members[0].teamId) || '');
  const [bId, setBId] = useState(initialTeamBId || (season.members.find(m => m.teamId !== initialTeamId) || {}).teamId || '');
  const teamA = standingsAll.find(t => t.id === aId);
  const teamB = standingsAll.find(t => t.id === bId);
  const colorA = teamA ? teamColor(teamA) : PRIMARY, colorB = teamB ? teamColor(teamB) : NEGATIVE;
  const h2h = aId && bId ? (h2hMatrix[aId] && h2hMatrix[aId][bId]) : null;
  // Every previous meeting between these two — regular season and playoffs
  // both, unlike h2hMatrix (which the season-series sentence below reads
  // from, and which deliberately excludes playoffs to keep that "season
  // series" framing accurate).
  const matchups = (aId && bId) ? (season.games || [])
    .filter(g => g.played && ((g.homeTeamId === aId && g.awayTeamId === bId) || (g.homeTeamId === bId && g.awayTeamId === aId)))
    .sort((x, y) => (y.date || '').localeCompare(x.date || '')) : [];
  const radarData = (teamA && teamB) ? (() => {
    const [winA, winB] = normPair(teamA.pct, teamB.pct);
    const [offA, offB] = normPair(teamA.rsPerG, teamB.rsPerG);
    const [defA, defB] = normPair(-teamA.raPerG, -teamB.raPerG);
    const [diffA, diffB] = normPair(teamA.diff, teamB.diff);
    const [sosA, sosB] = normPair(teamA.sos ?? 0.5, teamB.sos ?? 0.5);
    return [
      { metric: 'Win %', a: winA, b: winB },
      { metric: 'Offense', a: offA, b: offB },
      { metric: 'Defense', a: defA, b: defB },
      { metric: 'Run Diff', a: diffA, b: diffB },
      { metric: 'Sched.', a: sosA, b: sosB },
    ];
  })() : [];

  return (
    <div className="p-3 space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm" style={{ color: CHALK_DIM }}><ArrowLeft size={14} /> Back</button>
      <Panel>
        <SectionTitle>Team comparison</SectionTitle>
        <div className="px-4 pb-3 flex items-center gap-2">
          <select value={aId} onChange={e => setAId(e.target.value)} className="flex-1 bg-[#242424] border rounded px-2 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }}>
            {season.members.map(m => <option style={{ background: PANEL2, color: CHALK }} key={m.teamId} value={m.teamId}>{teamsById[m.teamId]?.name || m.scheduleName}</option>)}
          </select>
          <span className="text-xs font-bold" style={{ color: CHALK_DIM }}>VS</span>
          <select value={bId} onChange={e => setBId(e.target.value)} className="flex-1 bg-[#242424] border rounded px-2 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }}>
            {season.members.map(m => <option style={{ background: PANEL2, color: CHALK }} key={m.teamId} value={m.teamId}>{teamsById[m.teamId]?.name || m.scheduleName}</option>)}
          </select>
        </div>
      </Panel>
      {teamA && teamB && (
        <>
          <div className="rounded-xl overflow-hidden flex" style={{ border: `1px solid ${LINE}` }}>
            <button onClick={() => onOpenTeam(teamA.id)} className="flex-1 p-3 flex items-center gap-2" style={{ background: `${colorA}12` }}>
              <TeamMark team={teamA} size={22} /> <span className="font-bold truncate" style={{ color: CHALK }}>{teamA.displayName}</span>
            </button>
            <button onClick={() => onOpenTeam(teamB.id)} className="flex-1 p-3 flex items-center justify-end gap-2" style={{ background: `${colorB}12` }}>
              <span className="font-bold truncate" style={{ color: CHALK }}>{teamB.displayName}</span> <TeamMark team={teamB} size={22} />
            </button>
          </div>
          <Panel>
            <SectionTitle>At a glance</SectionTitle>
            <div className="px-2 pb-3" style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData}>
                  <PolarGrid stroke={LINE} />
                  <PolarAngleAxis dataKey="metric" tick={{ fill: CHALK_DIM, fontSize: 11 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar name={teamA.displayName} dataKey="a" stroke={colorA} fill={colorA} fillOpacity={0.35} />
                  <Radar name={teamB.displayName} dataKey="b" stroke={colorB} fill={colorB} fillOpacity={0.35} />
                  <Legend wrapperStyle={{ fontSize: 11, color: CHALK_DIM }} />
                  <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} formatter={(v) => v.toFixed(0)} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>Each axis is scaled between these two teams only — 100 means better of the two on that measure, not a league-wide max.</p>
          </Panel>
          <Panel>
            <div className="py-2">
              <CompareStatRow label="Record" aVal={`${teamA.w}-${teamA.l}`} bVal={`${teamB.w}-${teamB.l}`} aBetter={teamA.pct > teamB.pct} bBetter={teamB.pct > teamA.pct} aColor={colorA} bColor={colorB} />
              <CompareStatRow label="Win %" aVal={teamA.pct.toFixed(3).replace(/^0/, '')} bVal={teamB.pct.toFixed(3).replace(/^0/, '')} aBetter={teamA.pct > teamB.pct} bBetter={teamB.pct > teamA.pct} aColor={colorA} bColor={colorB} />
              <CompareStatRow label="Run Diff" aVal={teamA.diff > 0 ? `+${teamA.diff}` : teamA.diff} bVal={teamB.diff > 0 ? `+${teamB.diff}` : teamB.diff} aBetter={teamA.diff > teamB.diff} bBetter={teamB.diff > teamA.diff} aColor={colorA} bColor={colorB} />
              <CompareStatRow label="RS/Game" aVal={teamA.rsPerG.toFixed(2)} bVal={teamB.rsPerG.toFixed(2)} aBetter={teamA.rsPerG > teamB.rsPerG} bBetter={teamB.rsPerG > teamA.rsPerG} aColor={colorA} bColor={colorB} />
              <CompareStatRow label="RA/Game" aVal={teamA.raPerG.toFixed(2)} bVal={teamB.raPerG.toFixed(2)} aBetter={teamA.raPerG < teamB.raPerG} bBetter={teamB.raPerG < teamA.raPerG} aColor={colorA} bColor={colorB} />
              <CompareStatRow label="Streak" aVal={teamA.streak.label} bVal={teamB.streak.label} aBetter={teamA.streak.type === 'W'} bBetter={teamB.streak.type === 'W'} aColor={colorA} bColor={colorB} />
              <CompareStatRow label="Strength of Sched." aVal={teamA.sos != null ? teamA.sos.toFixed(3).replace(/^0/, '') : '—'} bVal={teamB.sos != null ? teamB.sos.toFixed(3).replace(/^0/, '') : '—'} aBetter={(teamA.sos || 0) > (teamB.sos || 0)} bBetter={(teamB.sos || 0) > (teamA.sos || 0)} aColor={colorA} bColor={colorB} />
              <CompareStatRow label="Home Record" aVal={`${teamA.homeW}-${teamA.homeL}`} bVal={`${teamB.homeW}-${teamB.homeL}`} aBetter={false} bBetter={false} aColor={colorA} bColor={colorB} />
              <CompareStatRow label="Away Record" aVal={`${teamA.awayW}-${teamA.awayL}`} bVal={`${teamB.awayW}-${teamB.awayL}`} aBetter={false} bBetter={false} aColor={colorA} bColor={colorB} />
            </div>
          </Panel>
          <Panel>
            <SectionTitle>Head-to-head</SectionTitle>
            {h2h && (h2h.w + h2h.l) > 0 ? (
              <div className="px-4 pb-3 text-sm" style={{ color: CHALK }}>
                <p>{teamA.displayName} leads the season series <span className="font-mono font-bold">{h2h.w}-{h2h.l}</span>, run differential <span className="font-mono font-bold">{h2h.rf - h2h.ra > 0 ? `+${h2h.rf - h2h.ra}` : h2h.rf - h2h.ra}</span>.</p>
              </div>
            ) : (
              <p className="px-4 pb-3 text-sm" style={{ color: CHALK_DIM }}>These teams haven't played each other yet this season.</p>
            )}
          </Panel>
          {matchups.length > 0 && (
            <Panel className="overflow-hidden">
              <SectionTitle>Previous matchups ({matchups.length})</SectionTitle>
              <div className="px-2 pb-2">
                {matchups.map((g, i) => {
                  const aIsHome = g.homeTeamId === aId;
                  const aScore = aIsHome ? g.homeScore : g.awayScore;
                  const bScore = aIsHome ? g.awayScore : g.homeScore;
                  const aWon = Number(aScore) > Number(bScore);
                  return (
                    <div key={g.id} className="flex items-center justify-between gap-2 px-2 py-2 text-sm" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
                      <span className="text-xs" style={{ color: CHALK_DIM }}>{g.date || '—'}{g.isPlayoff ? <span style={{ color: GOLD }}> · Playoffs</span> : ''}{g.isForfeit ? <span style={{ color: NEGATIVE }}> · Forfeit</span> : ''}</span>
                      <span className="font-mono font-bold">
                        <span style={{ color: aWon ? colorA : CHALK_DIM }}>{teamA.displayName} {aScore}</span>
                        {' – '}
                        <span style={{ color: !aWon ? colorB : CHALK_DIM }}>{bScore} {teamB.displayName}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

/* ==================================================================== */
/* Player career page                                                    */
/* ==================================================================== */
// Season-by-season batting/pitching tables shared by the regular-season and
// playoffs sections of a player's page. `rows` is [{label, totals, isTotal?}]
// — one row per season the player has a line in that split, plus a Total
// row appended only when there's more than one season to sum.
function PlayerBattingTable({ rows }) {
  return (
    <div className="overflow-x-auto px-2 pb-3">
      <table className="w-full text-sm" style={{ color: CHALK }}>
        <thead><tr className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>
          <th className="text-left px-2 py-1">Season</th><th className="px-2 py-1">G</th><th className="px-2 py-1">AB</th><th className="px-2 py-1">R</th><th className="px-2 py-1">H</th><th className="px-2 py-1">HR</th><th className="px-2 py-1">RBI</th><th className="px-2 py-1">BB</th><th className="px-2 py-1">SO</th><th className="px-2 py-1">AVG</th><th className="px-2 py-1">OPS</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const b = computeBattingAdvanced(r.totals);
            return (
              <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                <td className="px-2 py-1.5 font-semibold truncate max-w-[100px]" style={{ color: r.isTotal ? PRIMARY : CHALK }}>{r.label}</td>
                <td className="px-2 py-1.5 text-center font-mono">{r.totals.g}</td>
                <td className="px-2 py-1.5 text-center font-mono">{r.totals.ab}</td>
                <td className="px-2 py-1.5 text-center font-mono">{r.totals.r}</td>
                <td className="px-2 py-1.5 text-center font-mono">{r.totals.h}</td>
                <td className="px-2 py-1.5 text-center font-mono">{r.totals.hr}</td>
                <td className="px-2 py-1.5 text-center font-mono">{r.totals.rbi}</td>
                <td className="px-2 py-1.5 text-center font-mono">{r.totals.bb}</td>
                <td className="px-2 py-1.5 text-center font-mono">{r.totals.so}</td>
                <td className="px-2 py-1.5 text-center font-mono font-bold" style={{ color: PRIMARY }}>{b.avg.toFixed(3).replace(/^0/, '')}</td>
                <td className="px-2 py-1.5 text-center font-mono" style={{ color: GOLD }}>{b.ops.toFixed(3).replace(/^0/, '')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function PlayerPitchingTable({ rows }) {
  return (
    <div className="overflow-x-auto px-2 pb-3">
      <table className="w-full text-sm" style={{ color: CHALK }}>
        <thead><tr className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>
          <th className="text-left px-2 py-1">Season</th><th className="px-2 py-1">G</th><th className="px-2 py-1">IP</th><th className="px-2 py-1">HA</th><th className="px-2 py-1">ER</th><th className="px-2 py-1">BB</th><th className="px-2 py-1">K</th><th className="px-2 py-1">HR</th><th className="px-2 py-1">ERA</th><th className="px-2 py-1">WHIP</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const p = computePitchingAdvanced(r.totals);
            return (
              <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                <td className="px-2 py-1.5 font-semibold truncate max-w-[100px]" style={{ color: r.isTotal ? PRIMARY : CHALK }}>{r.label}</td>
                <td className="px-2 py-1.5 text-center font-mono">{r.totals.g}</td>
                <td className="px-2 py-1.5 text-center font-mono">{outsToIpDisplay(r.totals.outs)}</td>
                <td className="px-2 py-1.5 text-center font-mono">{r.totals.ha}</td>
                <td className="px-2 py-1.5 text-center font-mono">{r.totals.er}</td>
                <td className="px-2 py-1.5 text-center font-mono">{r.totals.bbAllowed}</td>
                <td className="px-2 py-1.5 text-center font-mono">{r.totals.k}</td>
                <td className="px-2 py-1.5 text-center font-mono">{r.totals.hrAllowed}</td>
                <td className="px-2 py-1.5 text-center font-mono font-bold" style={{ color: PRIMARY }}>{p.era.toFixed(2)}</td>
                <td className="px-2 py-1.5 text-center font-mono" style={{ color: GOLD }}>{p.whip.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const MANUAL_STAT_FIELDS = [
  { key: 'ab', label: 'At-Bats', group: 'batting' }, { key: 'r', label: 'Runs', group: 'batting' },
  { key: 'h', label: 'Hits', group: 'batting' }, { key: 'hr', label: 'Home Runs', group: 'batting' },
  { key: 'doubles', label: 'Doubles', group: 'batting' }, { key: 'triples', label: 'Triples', group: 'batting' },
  { key: 'rbi', label: 'RBI', group: 'batting' }, { key: 'bb', label: 'Walks', group: 'batting' },
  { key: 'so', label: 'Strikeouts', group: 'batting' },
  { key: 'ha', label: 'Hits Allowed', group: 'pitching' }, { key: 'er', label: 'Earned Runs', group: 'pitching' },
  { key: 'bbAllowed', label: 'Walks Allowed', group: 'pitching' }, { key: 'k', label: 'Strikeouts', group: 'pitching' },
  { key: 'hrAllowed', label: 'Home Runs Allowed', group: 'pitching' }, { key: 'e', label: 'Errors', group: 'pitching' },
];
// A compact add/edit form for one season stat line — used both for editing an
// existing line (imported or manual) and for adding a brand-new manual one.
// Batting and pitching are broken into their own clearly-labeled sections
// (full words, not abbreviations like the old "BB (P)" — easy to mix up
// with batting walks) since this is filled in by hand, unlike the
// abbreviated columns in the OCR review table this reuses the data shape
// from. IP is entered directly in the app's box-score notation (".1"/".2"
// = thirds of an inning) since that's what every other IP field expects.
// Regular season and playoffs are two independent lines for the same
// player/season (a player can have both), not one line with a toggle that
// overwrites the other.
function PlayerStatLineForm({ initial, onSave, onCancel }) {
  const battingFields = MANUAL_STAT_FIELDS.filter(f => f.group === 'batting');
  const pitchingFields = MANUAL_STAT_FIELDS.filter(f => f.group === 'pitching');
  const [vals, setVals] = useState(() => Object.fromEntries(MANUAL_STAT_FIELDS.map(f => [f.key, (initial && initial[f.key]) || 0])));
  const [g, setG] = useState((initial && initial.g) || 0);
  const [ip, setIp] = useState((initial && initial.ip) || '0.0');
  const [isPlayoff, setIsPlayoff] = useState(!!(initial && initial.isPlayoff));
  const set = (k, v) => setVals(prev => ({ ...prev, [k]: v }));
  const FieldGrid = ({ fields }) => (
    <div className="grid grid-cols-3 gap-2">
      {fields.map(f => (
        <label key={f.key} className="flex flex-col gap-0.5">
          <span className="text-[10px]" style={{ color: CHALK_DIM }}>{f.label}</span>
          <input type="number" value={vals[f.key]} onChange={e => set(f.key, Number(e.target.value) || 0)} className="w-full bg-[#242424] border rounded px-1.5 py-1 text-xs text-center" style={{ borderColor: LINE, color: CHALK }} />
        </label>
      ))}
    </div>
  );
  return (
    <div className="space-y-3 p-3 rounded" style={{ background: PANEL2, border: `1px solid ${LINE}` }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px]" style={{ color: CHALK_DIM }}>Games played</span>
          <input type="number" value={g} onChange={e => setG(Number(e.target.value) || 0)} className="w-20 bg-[#242424] border rounded px-1.5 py-1 text-xs text-center" style={{ borderColor: LINE, color: CHALK }} />
        </label>
        <div className="flex rounded overflow-hidden border flex-shrink-0" style={{ borderColor: LINE }}>
          {[[false, 'Regular season'], [true, 'Playoffs']].map(([v, label]) => (
            <button key={label} onClick={() => setIsPlayoff(v)} className="px-2.5 py-1.5 text-xs font-semibold" style={{ background: isPlayoff === v ? (v ? GOLD : PRIMARY) : 'transparent', color: isPlayoff === v ? INK : CHALK_DIM }}>{label}</button>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: PRIMARY }}>Batting</div>
        <FieldGrid fields={battingFields} />
      </div>
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: GOLD }}>Pitching</div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px]" style={{ color: CHALK_DIM }}>Innings Pitched</span>
            <input value={ip} onChange={e => setIp(e.target.value)} placeholder="5.1" className="w-full bg-[#242424] border rounded px-1.5 py-1 text-xs text-center" style={{ borderColor: LINE, color: CHALK }} />
          </label>
        </div>
        <p className="text-[10px] -mt-1 mb-2" style={{ color: CHALK_DIM }}>Box-score notation: 5.1 = 5⅓ innings, 5.2 = 5⅔ (the digit after the dot is outs, not tenths).</p>
        <FieldGrid fields={pitchingFields} />
      </div>
      <div className="flex gap-2">
        <button onClick={() => onSave({ ...vals, g, ip, isPlayoff })} className="px-3 py-1.5 rounded font-bold text-xs" style={{ background: PRIMARY, color: INK }}>Save</button>
        <button onClick={onCancel} className="px-3 py-1.5 rounded text-xs" style={{ color: CHALK_DIM }}>Cancel</button>
      </div>
    </div>
  );
}

// Site Owner's catch-all edit surface for a player: hand out custom badges,
// add manual accolades/team credits (for anything the tracked roster/award
// data doesn't cover), and add or correct a season's stat line directly.
// Collapsed by default so it doesn't dominate the page for the common case
// of just viewing stats.
// A suspension/ban appeal is the one write action open to a logged-out
// visitor — no admin approval loop, just a message parked for an admin to
// see and act on (via the normal suspend/ban tools) rather than anything
// automatic.
function AppealPanel({ seasonId, playerId, playerName, teamId, onSubmitAppeal }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  if (sent) {
    return <Panel style={{ borderColor: WIN }}><p className="px-4 py-4 text-sm" style={{ color: CHALK }}>Appeal submitted — a league admin will review it.</p></Panel>;
  }
  return (
    <Panel style={{ borderColor: NEGATIVE }}>
      <SectionTitle accent={NEGATIVE} right={!open ? <button onClick={() => setOpen(true)} className="text-[11px] font-bold" style={{ color: NEGATIVE }}>Submit an appeal</button> : null}>Currently suspended or banned</SectionTitle>
      {open && (
        <div className="px-4 pb-3 space-y-2">
          <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Explain why this suspension/ban should be reconsidered…" rows={3} className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
          <div className="flex gap-2">
            <button onClick={() => { if (!message.trim()) return; onSubmitAppeal(seasonId, playerId, playerName, teamId, message); setSent(true); }} disabled={!message.trim()} className="px-3 py-1.5 rounded font-bold text-xs disabled:opacity-40" style={{ background: NEGATIVE, color: '#fff' }}>Send appeal</button>
            <button onClick={() => setOpen(false)} className="text-xs" style={{ color: CHALK_DIM }}>Cancel</button>
          </div>
        </div>
      )}
    </Panel>
  );
}
// Badge assignment is split out from PlayerEditPanel so Commissioner can
// hand out badges without also getting the rest of Site Owner's editing
// powers there (rename, accolades, manual stat lines).
function PlayerBadgeAssigner({ league, playerBadges, primaryIdentityKey, onSetPlayerBadges }) {
  const { role } = useAuth();
  const canManage = role === 'site_owner' || role === 'commissioner';
  const badgeDefs = (league && league.badgeDefs) || [];
  if (!canManage || badgeDefs.length === 0) return null;
  const badgeIdSet = new Set(playerBadges.map(b => b.id));
  const toggleBadge = (id) => {
    const next = badgeIdSet.has(id) ? [...badgeIdSet].filter(x => x !== id) : [...badgeIdSet, id];
    onSetPlayerBadges(primaryIdentityKey, next);
  };
  return (
    <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
      <SectionTitle accent={GOLD}>Assign badges</SectionTitle>
      <div className="px-4 pb-3 flex flex-wrap gap-1.5">
        {badgeDefs.map(b => {
          const has = badgeIdSet.has(b.id);
          return (
            <button key={b.id} onClick={() => toggleBadge(b.id)} className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold" style={{ background: has ? `${b.color}33` : 'transparent', color: has ? b.color : CHALK_DIM, border: `1px solid ${has ? b.color : LINE}` }}>
              <BadgeIcon badge={b} size={14} /> {b.name}
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
function PlayerEditPanel({ league, seasonsInfo, teamsById, displayName, playerAccolades, playerTeamCredits, primaryIdentityKey, onAddPlayerAccolade, onRemovePlayerAccolade, onAddPlayerTeamCredit, onRemovePlayerTeamCredit, onUpsertManualStatLine, onDeleteManualStatLine, onRenamePlayer }) {
  const [open, setOpen] = useState(false);
  const [accName, setAccName] = useState('');
  const [accSeason, setAccSeason] = useState('');
  const [tcTeamId, setTcTeamId] = useState('');
  const [tcSeasonLabel, setTcSeasonLabel] = useState('');
  const [editingLine, setEditingLine] = useState(null); // { seasonId, line } | { newSeasonId }
  const [nameDraft, setNameDraft] = useState(displayName || '');
  const allStatLines = seasonsInfo.flatMap(info => (info.season.importedStatLines || []).filter(l => l.playerId === info.playerId).map(l => ({ ...l, seasonId: info.season.id, seasonName: info.season.name })));
  const nameChanged = nameDraft.trim() && nameDraft.trim() !== (displayName || '').trim();
  const saveRename = () => {
    if (!nameChanged) return;
    onRenamePlayer(seasonsInfo.map(info => ({ seasonId: info.season.id, playerId: info.playerId })), nameDraft.trim());
  };

  if (!open) {
    return <button onClick={() => setOpen(true)} className="w-full text-xs font-bold uppercase tracking-wide px-3 py-2 rounded-lg" style={{ background: PANEL2, color: PRIMARY, border: `1px solid ${LINE}` }}>Site Owner: edit player</button>;
  }
  return (
    <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
      <SectionTitle accent={PRIMARY} right={<button onClick={() => setOpen(false)} className="text-[11px] font-semibold" style={{ color: CHALK_DIM }}>Close</button>}>Site Owner: edit player</SectionTitle>
      <div className="px-4 pb-3 space-y-3 text-sm">
        <div>
          <div className="text-xs font-semibold mb-1.5" style={{ color: CHALK }}>Player name</div>
          <p className="text-[10px] mb-1.5" style={{ color: CHALK_DIM }}>Fixes a misspelled import (e.g. a sheet typo that created a separate player) — renaming here merges it back into the correctly-spelled player's page automatically. The old name is kept on record so nothing that still uses it breaks. This also locks the name in place — it won't get overwritten if the player's Roblox account is renamed later.</p>
          <div className="flex gap-1.5">
            <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} className="flex-1 bg-[#242424] border rounded px-2 py-1.5 text-xs" style={{ borderColor: LINE, color: CHALK }} />
            <button onClick={saveRename} disabled={!nameChanged} className="px-2.5 py-1.5 rounded font-bold text-xs disabled:opacity-40" style={{ background: PRIMARY, color: INK }}>Save</button>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold mb-1.5" style={{ color: CHALK }}>Accolades</div>
          {playerAccolades.length > 0 && (
            <div className="space-y-1 mb-2">
              {playerAccolades.map(a => (
                <div key={a.id} className="flex items-center justify-between text-xs" style={{ color: CHALK }}>
                  <span>{a.name}{a.seasonName ? ` (${a.seasonName})` : ''}</span>
                  <button onClick={() => onRemovePlayerAccolade(a._key, a.id)} style={{ color: NEGATIVE }}><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <input value={accName} onChange={e => setAccName(e.target.value)} placeholder="Accolade name" className="flex-1 bg-[#242424] border rounded px-2 py-1.5 text-xs" style={{ borderColor: LINE, color: CHALK }} />
            <input value={accSeason} onChange={e => setAccSeason(e.target.value)} placeholder="Season (optional)" className="w-28 bg-[#242424] border rounded px-2 py-1.5 text-xs" style={{ borderColor: LINE, color: CHALK }} />
            <button onClick={() => { if (accName.trim()) { onAddPlayerAccolade(primaryIdentityKey, accName, accSeason); setAccName(''); setAccSeason(''); } }} disabled={!accName.trim()} className="px-2.5 py-1.5 rounded font-bold text-xs disabled:opacity-40" style={{ background: PRIMARY, color: INK }}><Plus size={14} /></button>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold mb-1.5" style={{ color: CHALK }}>Extra team credits<div className="text-[10px] font-normal" style={{ color: CHALK_DIM }}>For teams not reflected in tracked roster history</div></div>
          {playerTeamCredits.length > 0 && (
            <div className="space-y-1 mb-2">
              {playerTeamCredits.map(c => {
                const t = teamsById[c.teamId];
                return (
                  <div key={c.id} className="flex items-center justify-between text-xs" style={{ color: CHALK }}>
                    <span>{t ? t.name : 'Unknown team'}{c.seasonLabel ? ` — ${c.seasonLabel}` : ''}</span>
                    <button onClick={() => onRemovePlayerTeamCredit(c._key, c.id)} style={{ color: NEGATIVE }}><X size={12} /></button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex gap-1.5">
            <select value={tcTeamId} onChange={e => setTcTeamId(e.target.value)} className="flex-1 bg-[#242424] border rounded px-2 py-1.5 text-xs" style={{ borderColor: LINE, color: CHALK }}>
              <option value="" style={{ background: PANEL2, color: CHALK }}>Team…</option>
              {Object.values(teamsById).map(t => <option key={t.id} value={t.id} style={{ background: PANEL2, color: CHALK }}>{t.name}</option>)}
            </select>
            <input value={tcSeasonLabel} onChange={e => setTcSeasonLabel(e.target.value)} placeholder="Season label" className="w-28 bg-[#242424] border rounded px-2 py-1.5 text-xs" style={{ borderColor: LINE, color: CHALK }} />
            <button onClick={() => { if (tcTeamId) { onAddPlayerTeamCredit(primaryIdentityKey, tcTeamId, tcSeasonLabel, ''); setTcTeamId(''); setTcSeasonLabel(''); } }} disabled={!tcTeamId} className="px-2.5 py-1.5 rounded font-bold text-xs disabled:opacity-40" style={{ background: PRIMARY, color: INK }}><Plus size={14} /></button>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold mb-1.5" style={{ color: CHALK }}>Season stat lines</div>
          <div className="space-y-2">
            {allStatLines.map(l => (
              editingLine && editingLine.line && editingLine.line.id === l.id ? (
                <PlayerStatLineForm key={l.id} initial={l} onCancel={() => setEditingLine(null)} onSave={(fields) => { onUpsertManualStatLine(l.seasonId, l.playerId, fields); setEditingLine(null); }} />
              ) : (
                <div key={l.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded" style={{ background: PANEL2, color: CHALK }}>
                  <span>{l.seasonName} <span style={{ color: CHALK_DIM }}>({l.sourceLabel || l.source})</span></span>
                  <span className="flex items-center gap-2">
                    <button onClick={() => setEditingLine({ seasonId: l.seasonId, line: l })} style={{ color: PRIMARY }}><Pencil size={12} /></button>
                    <button onClick={() => onDeleteManualStatLine(l.seasonId, l.id)} style={{ color: NEGATIVE }}><X size={12} /></button>
                  </span>
                </div>
              )
            ))}
            {seasonsInfo.length > 0 && (
              editingLine && editingLine.newSeasonId ? (
                <PlayerStatLineForm
                  initial={null} onCancel={() => setEditingLine(null)}
                  onSave={(fields) => { const info = seasonsInfo.find(i => i.season.id === editingLine.newSeasonId); if (info) onUpsertManualStatLine(info.season.id, info.playerId, fields); setEditingLine(null); }}
                />
              ) : (
                <select
                  value="" className="w-full bg-[#242424] border rounded px-2 py-1.5 text-xs" style={{ borderColor: LINE, color: CHALK }}
                  onChange={e => { if (e.target.value) setEditingLine({ newSeasonId: e.target.value }); }}
                >
                  <option value="" style={{ background: PANEL2, color: CHALK }}>Add stat line for season…</option>
                  {seasonsInfo.map(info => <option key={info.season.id} value={info.season.id} style={{ background: PANEL2, color: CHALK }}>{info.season.name}</option>)}
                </select>
              )
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function PlayerPage({ league, teamsById, playerName, onBack, onOpenTeam, onOpenPlayerCompare, activeSeasonId, onRemoveActivity, onClearAllActivity, onBackfillRobloxId, onSyncRobloxRename, onPlayerRenamed, onRenamePlayer, onSetPlayerBadges, onAddPlayerAccolade, onRemovePlayerAccolade, onAddPlayerTeamCredit, onRemovePlayerTeamCredit, onUpsertManualStatLine, onDeleteManualStatLine, onRemoveTeamPlayed, onSubmitAppeal }) {
  const { hasPermission, role } = useAuth();
  const canManage = hasPermission('manageRosters');
  const isSiteOwner = role === 'site_owner';
  const { seasonsInfo, gameLog, knownNames } = useMemo(() => getPlayerCareerData(league, playerName), [league, playerName]);
  // The entry to treat as "current" — the site's designated current season
  // (activeSeasonId) if this identity appears there, since seasonsInfo's
  // array order reflects when each season was created, not which one is
  // actually current. A player traded (or signed) into a new team in a
  // later-created season, viewed before that season was made current, was
  // otherwise still showing their older team. Falls back to whichever
  // season this identity was most recently recorded in when they don't
  // appear in the current season at all (e.g. they've since left the
  // league, or that season hasn't been created/entered yet).
  const currentSeasonEntry = seasonsInfo.length > 0
    ? (seasonsInfo.find(info => info.season.id === activeSeasonId) || seasonsInfo[seasonsInfo.length - 1])
    : null;
  // Percentile rankings compare this identity's currentSeasonEntry season
  // line against every other regular-season player from that same season —
  // computeSeasonPlayerLeaders gives every entry, including this player's
  // own, the exact same shape (totals/batting/pitching/war) keyed by the
  // season-scoped playerId currentSeasonEntry already carries.
  const percentileSeason = currentSeasonEntry ? currentSeasonEntry.season : null;
  const percentilePool = percentileSeason ? computeSeasonPlayerLeaders(percentileSeason, teamsById, 'regular') : [];
  const myPercentileEntry = currentSeasonEntry ? percentilePool.find(p => p.playerId === currentSeasonEntry.playerId) : null;
  // The most recent roster/free-agent entry for this name carries the
  // Roblox account id, if one's been resolved yet — looking avatars up by id
  // instead of username means a rename doesn't break the avatar, and lets
  // the effect below notice the rename by comparing the id's current live
  // username against what's stored.
  const latestRobloxUserId = currentSeasonEntry ? currentSeasonEntry.player.robloxUserId : null;
  // The name this identity is known by most recently — used instead of the
  // raw playerName prop so a click that landed here via an old username
  // (an old transaction log entry, a stale link) doesn't get compared
  // against itself and mistaken for a fresh rename.
  const latestName = currentSeasonEntry ? currentSeasonEntry.player.name : playerName;
  const avatar = useRobloxAvatar(latestName, latestRobloxUserId);
  // A site owner's manual rename (nameOverride) is a deliberate choice —
  // skip the auto-sync entirely for it, otherwise it gets silently renamed
  // right back to the live Roblox username on the very next admin visit.
  const nameIsOverridden = !!(currentSeasonEntry && currentSeasonEntry.player.nameOverride);
  useEffect(() => {
    // Only an admin's visit actually writes anything (kv_store only accepts
    // authenticated writes anyway) — a logged-out viewer just keeps seeing
    // the name as currently stored until an admin's visit syncs it.
    if (avatar.loading || !canManage || nameIsOverridden) return;
    if (!latestRobloxUserId && avatar.userId) {
      if (onBackfillRobloxId) onBackfillRobloxId(latestName, avatar.userId);
    } else if (latestRobloxUserId && avatar.resolvedUsername && avatar.resolvedUsername !== latestName) {
      if (onSyncRobloxRename) onSyncRobloxRename(latestRobloxUserId, avatar.resolvedUsername);
      if (onPlayerRenamed) onPlayerRenamed(avatar.resolvedUsername);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatar.loading, avatar.userId, avatar.resolvedUsername, latestRobloxUserId, latestName, canManage, nameIsOverridden]);
  // Activity log entries don't carry a playerId (they're free-text), so a
  // name match is the only way to find "this player's" transactions —
  // consistent with how the rest of the page threads career history
  // together by name. Delete is only offered for entries still in the
  // active season, since onRemoveActivity only knows how to edit that one.
  const playerTransactions = useMemo(() => {
    const norm = (s) => (s || '').trim().toLowerCase();
    // Match against every name this identity has ever gone by (not just
    // whichever name got clicked to land here) so a rename doesn't orphan
    // older transaction log entries that still mention the old name.
    const targets = knownNames && knownNames.length ? knownNames : [norm(playerName)];
    const out = [];
    (league.seasons || []).forEach(season => {
      (season.activityLog || []).forEach(a => { const text = norm(a.text); if (targets.some(t => text.includes(t))) out.push({ ...a, seasonId: season.id, seasonName: season.name }); });
    });
    return out.sort((a, b) => (b.at || 0) - (a.at || 0));
  }, [league, playerName, knownNames]);

  if (seasonsInfo.length === 0) {
    return (
      <div className="p-4">
        <button onClick={onBack} className="flex items-center gap-1 text-sm mb-3" style={{ color: CHALK_DIM }}><ArrowLeft size={14} /> Back</button>
        <Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>That player could not be found.</p></Panel>
      </div>
    );
  }

  const totals = sumPlayerTotals(gameLog);

  // Season-by-season, split into regular season vs. playoffs — postseason
  // performance is kept separate rather than blended into the same line,
  // same convention real box scores use. Within a season, also split by
  // team when the player played for more than one (traded mid-season) —
  // each game's row now carries the team they actually played that game
  // for, so this reads straight off gameLog rather than needing separate
  // roster bookkeeping.
  const seasonSplits = seasonsInfo.map(info => {
    const rows = gameLog.filter(r => r.seasonId === info.season.id);
    const isTournament = !!(info.season.settings && info.season.settings.isTournament);
    const teamIds = [...new Set(rows.map(r => r.teamId))];
    const perTeam = teamIds.length > 1 ? teamIds.map(teamId => {
      const teamRows = rows.filter(r => r.teamId === teamId);
      return { teamId, reg: sumPlayerTotals(teamRows.filter(r => !r.isPlayoff)), po: sumPlayerTotals(teamRows.filter(r => r.isPlayoff)) };
    }) : null;
    return { seasonName: info.season.name, isTournament, reg: sumPlayerTotals(rows.filter(r => !r.isPlayoff)), po: sumPlayerTotals(rows.filter(r => r.isPlayoff)), perTeam };
  });
  // Tournament-season rows still show up here (tagged), but are marked so
  // the "Total" row below can skip them — a tournament shows on the player
  // page without folding into anyone's combined career totals.
  const expandSeasonRows = (phase, hasStat) => {
    const rows = [];
    seasonSplits.forEach(s => {
      const tag = s.isTournament ? ' (Tournament)' : '';
      if (s.perTeam) {
        const qualifying = s.perTeam.filter(pt => hasStat(pt[phase]));
        qualifying.forEach(pt => {
          const t = teamsById[pt.teamId];
          rows.push({ label: `${s.seasonName}${tag} — ${t ? teamAbbr(t) : 'FA'}`, totals: pt[phase], isTournament: s.isTournament });
        });
        if (qualifying.length > 1 && hasStat(s[phase])) rows.push({ label: `${s.seasonName}${tag} — Combined`, totals: s[phase], isTotal: true, isTournament: s.isTournament });
      } else if (hasStat(s[phase])) {
        rows.push({ label: `${s.seasonName}${tag}`, totals: s[phase], isTournament: s.isTournament });
      }
    });
    return rows;
  };
  const regBattingRows = expandSeasonRows('reg', t => t.ab > 0);
  const regPitchingRows = expandSeasonRows('reg', t => t.outs > 0);
  const poBattingRows = expandSeasonRows('po', t => t.ab > 0);
  const poPitchingRows = expandSeasonRows('po', t => t.outs > 0);
  const regTotals = sumPlayerTotals(gameLog.filter(r => !r.isPlayoff && !r.isTournament));
  const poTotals = sumPlayerTotals(gameLog.filter(r => r.isPlayoff && !r.isTournament));
  const careerRowCount = (rows) => rows.filter(r => !r.isTournament).length;
  if (careerRowCount(regBattingRows) > 1) regBattingRows.push({ label: 'Total', totals: regTotals, isTotal: true });
  if (careerRowCount(regPitchingRows) > 1) regPitchingRows.push({ label: 'Total', totals: regTotals, isTotal: true });
  if (careerRowCount(poBattingRows) > 1) poBattingRows.push({ label: 'Total', totals: poTotals, isTotal: true });
  if (careerRowCount(poPitchingRows) > 1) poPitchingRows.push({ label: 'Total', totals: poTotals, isTotal: true });
  // Advanced rate stats below are regular-season only — postseason samples
  // are usually too small for OPS/ERA/WHIP etc. to mean much on their own,
  // and the per-season playoff tables above already show raw playoff lines.
  const batting = computeBattingAdvanced(regTotals);
  const pitching = computePitchingAdvanced(regTotals);
  // Single best statistical season by OPS (batting) and ERA (pitching) —
  // reads the same per-season regular-season totals the season-by-season
  // tables below already compute, just picks the extremes out of them.
  const qualifyingBattingSeasons = seasonSplits.filter(s => !s.isTournament && s.reg.ab >= 3).map(s => ({ seasonName: s.seasonName, ops: computeBattingAdvanced(s.reg).ops }));
  const peakBattingSeason = qualifyingBattingSeasons.length > 1 ? qualifyingBattingSeasons.reduce((a, b) => b.ops > a.ops ? b : a) : null;
  const qualifyingPitchingSeasons = seasonSplits.filter(s => !s.isTournament && s.reg.outs >= 3).map(s => ({ seasonName: s.seasonName, era: computePitchingAdvanced(s.reg).era }));
  const peakPitchingSeason = qualifyingPitchingSeasons.length > 1 ? qualifyingPitchingSeasons.reduce((a, b) => b.era < a.era ? b : a) : null;
  const hasBatting = regTotals.ab > 0;
  const hasPitching = regTotals.outs > 0;

  // OPS+/ERA+ — indexed to this season's league average (100 = average),
  // regular season only, same convention as the raw advanced stats above.
  const seasonLeagueAvg = currentSeasonEntry ? computeSeasonLeagueAverages(currentSeasonEntry.season, teamsById) : null;
  const opsPlus = seasonLeagueAvg && seasonLeagueAvg.leagueOPS ? Math.round((batting.ops / seasonLeagueAvg.leagueOPS) * 100) : null;
  const eraPlus = seasonLeagueAvg && seasonLeagueAvg.leagueERA && pitching.era > 0 ? Math.round((seasonLeagueAvg.leagueERA / pitching.era) * 100) : null;

  // One-run-game splits — batting/pitching lines for games decided by
  // exactly one run vs. everything else, regular season only.
  const oneRunRows = gameLog.filter(r => r.oneRunGame && !r.isPlayoff && !r.isTournament);
  const otherRunRows = gameLog.filter(r => !r.oneRunGame && !r.isPlayoff && !r.isTournament);
  const oneRunBatting = computeBattingAdvanced(sumPlayerTotals(oneRunRows));
  const otherBatting = computeBattingAdvanced(sumPlayerTotals(otherRunRows));
  const oneRunPitching = computePitchingAdvanced(sumPlayerTotals(oneRunRows));
  const otherPitching = computePitchingAdvanced(sumPlayerTotals(otherRunRows));
  const hasOneRunSplit = oneRunRows.length > 0 && otherRunRows.length > 0;

  // Rest-of-season pace — this player's current per-game rate on their
  // current team, projected across that team's remaining scheduled games.
  const paceSeason = currentSeasonEntry ? currentSeasonEntry.season : null;
  const paceTeamId = currentSeasonEntry ? currentSeasonEntry.teamId : null;
  const paceRows = paceSeason ? gameLog.filter(r => r.seasonId === paceSeason.id && !r.isPlayoff && !r.isImport) : [];
  const paceGamesPlayed = new Set(paceRows.map(r => r.gameId)).size;
  const paceTeamGames = paceSeason && paceTeamId ? (paceSeason.games || []).filter(g => !g.isBye && !g.isSpringTraining && !g.isPlayoff && (g.homeTeamId === paceTeamId || g.awayTeamId === paceTeamId)) : [];
  const paceGamesRemaining = paceTeamGames.filter(g => !g.played).length;
  const paceTotals = sumPlayerTotals(paceRows);
  const showPace = paceGamesRemaining > 0 && paceGamesPlayed >= 3 && (paceTotals.ab > 0 || paceTotals.outs > 0);
  const paceStats = paceTotals.ab > 0
    ? [{ label: 'Hits', v: paceTotals.h }, { label: 'HR', v: paceTotals.hr }, { label: 'RBI', v: paceTotals.rbi }]
    : [{ label: 'Strikeouts', v: paceTotals.k }];

  // Milestone countdown — flags a career round-number threshold only once
  // it's genuinely close, not the whole list of thresholds still ahead.
  const careerTotalsForMilestones = sumPlayerTotals(gameLog.filter(r => !r.isTournament));
  const milestoneDefs = [
    { label: 'career hits', total: careerTotalsForMilestones.h, thresholds: [50, 100, 250, 500, 1000] },
    { label: 'career home runs', total: careerTotalsForMilestones.hr, thresholds: [10, 25, 50, 100] },
    { label: 'career RBI', total: careerTotalsForMilestones.rbi, thresholds: [50, 100, 250, 500] },
    { label: 'career strikeouts (pitching)', total: careerTotalsForMilestones.k, thresholds: [50, 100, 250, 500] },
  ];
  const upcomingMilestones = milestoneDefs.map(d => {
    const next = d.thresholds.find(t => t > d.total);
    if (!next) return null;
    const remaining = next - d.total;
    if (remaining > Math.max(10, next * 0.08)) return null;
    return { label: d.label, next, remaining };
  }).filter(Boolean);

  // Season-over-season trend — one point per season this identity has a
  // regular-season batting or pitching line, not per game (the AVG/ERA
  // trend chart above already covers the game-by-game view).
  const seasonTrendData = seasonSplits.filter(s => !s.isTournament && (s.reg.ab > 0 || s.reg.outs > 0)).map(s => {
    const b = computeBattingAdvanced(s.reg), p = computePitchingAdvanced(s.reg);
    return { season: s.seasonName, value: hasBatting ? b.ops : p.era };
  });

  // Counting-stat bars, one group per season — the trend charts above cover
  // rate stats; this is the "how much" complement to their "how good."
  const seasonCountingData = seasonSplits.filter(s => !s.isTournament && (s.reg.ab > 0 || s.reg.outs > 0)).map(s => ({
    season: s.seasonName,
    h: s.reg.h, hr: s.reg.hr, rbi: s.reg.rbi,
    k: s.reg.k, bb: s.reg.bbAllowed,
  }));

  // Career hit-type mix (regular season) — singles are derived the same way
  // the rest of the site treats them, never entered directly.
  const hitTypeData = hasBatting ? [
    { name: 'Singles', value: playerSingles(regTotals) },
    { name: 'Doubles', value: regTotals.doubles },
    { name: 'Triples', value: regTotals.triples },
    { name: 'Home Runs', value: regTotals.hr },
  ].filter(d => d.value > 0) : [];
  const HIT_TYPE_COLORS = [PRIMARY, GOLD, WIN, NEGATIVE];

  // "Teams played on" needs every team a player suited up for, not just
  // where they ended up — a mid-season trade means seasonsInfo (one entry
  // per season, wherever they currently sit) alone would miss whichever
  // team they were on before the trade. seasonSplits already worked this
  // out per season (via perTeam, built from gameLog's per-game teamId), so
  // reuse it instead of re-deriving it.
  const teamsPlayedOn = seasonsInfo.flatMap((info, i) => {
    const split = seasonSplits[i];
    const teamIds = split.perTeam ? split.perTeam.map(pt => pt.teamId) : [info.teamId];
    // draftPick is a field on the player's one roster/FA record for that
    // season, not per-team, so it's the same value regardless of which of
    // this season's teamIds we're building a row for here.
    return teamIds.map(teamId => ({ season: info.season, teamId, playerId: info.playerId, draftPick: info.player.draftPick || null }));
  });

  const latest = currentSeasonEntry;
  // Show whichever name this identity is known by most recently, not
  // necessarily whatever name was clicked to land here (an old transaction
  // log entry or a stale link could point at a since-renamed username).
  const displayName = latest.player.name;
  const normName = (s) => (s || '').trim().toLowerCase();
  const latestTeam = teamsById[latest.teamId];
  const color = latestTeam ? teamColor(latestTeam) : PRIMARY;
  // Badges/accolades/team-credits are keyed by identity (Roblox id when
  // known, else normalized name) rather than by any one season's playerId
  // — reads union every key this identity has ever been known by so an
  // entry written before an id was linked still surfaces afterward.
  const identityLookupKeys = [...new Set([...(latestRobloxUserId ? [String(latestRobloxUserId)] : []), ...(knownNames || [])])];
  const primaryIdentityKey = latestRobloxUserId ? String(latestRobloxUserId) : normName(displayName);
  const profiles = league.playerProfiles || {};
  const playerBadgeIds = [...new Set(identityLookupKeys.flatMap(k => (profiles[k] && profiles[k].badges) || []))];
  // Each entry keeps track of which identity key it's actually stored
  // under (_key) — an identity can accumulate entries under more than one
  // key over time (e.g. a name-key from before a Roblox id was linked), so
  // removal has to target the key the entry really lives in.
  const playerAccolades = identityLookupKeys.flatMap(k => ((profiles[k] && profiles[k].accolades) || []).map(a => ({ ...a, _key: k })));
  const playerTeamCredits = identityLookupKeys.flatMap(k => ((profiles[k] && profiles[k].teamCredits) || []).map(c => ({ ...c, _key: k })));
  const playerBadges = playerBadgeIds.map(id => (league.badgeDefs || []).find(b => b.id === id)).filter(Boolean);
  // Game-by-game highlight sections don't make sense for an imported season
  // total (it's not one game), so those are summed into the season/career
  // totals above but left out of anything framed as a single performance.
  const gameOnlyLog = gameLog.filter(r => !r.isImport);
  const highs = computePlayerGameHighs(gameOnlyLog);
  const notable = computePlayerNotableGames(gameOnlyLog);
  const topPerformances = [...gameOnlyLog].map(row => ({ row, score: playerGameScore(row) })).sort((a, b) => b.score - a.score).slice(0, 5);
  const recentGames = [...gameOnlyLog].slice(-10).reverse();
  const careerLog = gameLog.filter(r => !r.isTournament);
  const trendData = (() => {
    if (hasBatting) {
      let cumH = 0, cumAB = 0;
      return careerLog.map((row, i) => { cumH += row.h; cumAB += row.ab; return { i: i + 1, value: cumAB > 0 ? cumH / cumAB : 0 }; });
    }
    let cumER = 0, cumOuts = 0;
    return careerLog.map((row, i) => { cumER += row.er; cumOuts += ipDisplayToOuts(row.ip); return { i: i + 1, value: cumOuts > 0 ? (cumER * 27) / cumOuts : 0 }; });
  })();

  const awards = [];
  const nameTargets = knownNames && knownNames.length ? knownNames : [normName(playerName)];
  seasonsInfo.forEach(info => {
    const winners = info.season.awardWinners || {};
    Object.entries(winners).forEach(([awardId, raw]) => {
      const isThisPlayer = normalizeAwardWinners(raw).some(w => w.type === 'player' && (w.playerId === info.playerId || (!w.playerId && w.name && nameTargets.includes(normName(w.name)))));
      if (isThisPlayer) {
        const def = (league.awardDefs || []).find(a => a.id === awardId);
        if (def) awards.push({ name: def.name, seasonName: info.season.name });
      }
    });
  });
  // A player rostered on a season's championship team, even briefly before
  // a trade, gets that credited here automatically — teamsPlayedOn already
  // has the per-season/per-team breakdown worked out.
  teamsPlayedOn.forEach(entry => {
    if (entry.teamId && entry.season.championTeamId === entry.teamId) {
      const t = teamsById[entry.teamId];
      awards.push({ name: `${t ? t.name : 'Team'} — League Champion`, seasonName: entry.season.name, isChampionship: true });
    }
  });
  // Site Owner's manually-added accolades (for anything that doesn't fit
  // the season awards system) — stored per identity, unioned across every
  // key this identity has been known by (see identityLookupKeys below).
  (playerAccolades || []).forEach(a => awards.push({ name: a.name, seasonName: a.seasonName, id: a.id, isManual: true, _key: a._key }));

  // Header badge row, auto-derived from the same award/championship data as
  // the accolades list below — grouped and counted (one "MVP ×3" pill, not
  // three separate ones) so a long career doesn't turn the header into a
  // wall of pills. Manual accolades are excluded here since they already
  // render in the dedicated accolades section further down the page.
  const autoBadges = [];
  {
    const groups = {};
    awards.forEach(a => {
      if (a.isManual) return;
      const key = a.isChampionship ? 'League Champion' : a.name;
      if (!groups[key]) groups[key] = { label: key, count: 0, seasons: [], isChampionship: !!a.isChampionship };
      groups[key].count += 1;
      if (a.seasonName) groups[key].seasons.push(a.seasonName);
    });
    Object.values(groups).forEach(g => autoBadges.push({
      key: `award:${g.label}`, label: g.label, count: g.count, isChampionship: g.isChampionship,
      detail: g.seasons.length ? `Won: ${g.seasons.join(', ')}` : '',
    }));
  }
  const hofEntry = (league.hallOfFame || []).find(e => e.playerName && nameTargets.includes(normName(e.playerName)));
  if (hofEntry) autoBadges.push({ key: 'hof', label: 'Hall of Fame', count: 0, isHof: true, detail: hofEntry.year ? `Inducted — Class of ${hofEntry.year}` : 'Inducted into the Hall of Fame' });

  const GameRef = ({ row }) => {
    const opp = teamsById[row.oppTeamId];
    return <span className="text-xs flex-shrink-0" style={{ color: CHALK_DIM }}>{row.date ? `${row.date} · ` : ''}{opp ? `vs ${opp.name}` : ''}{row.isPlayoff ? ' (Playoffs)' : ''}</span>;
  };

  return (
    <div className="p-3 space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm" style={{ color: CHALK_DIM }}><ArrowLeft size={14} /> Back</button>

      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: color, boxShadow: `0 4px 20px -4px ${color}44` }}>
        <div className="relative p-5 flex items-center gap-4 overflow-hidden" style={{ background: `linear-gradient(105deg, ${color}, ${color} 45%, rgba(0,0,0,0.82))` }}>
          <div className="relative w-16 h-16 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.35)', border: '2px solid rgba(255,255,255,0.5)' }}>
            {avatar.loading ? (
              <RefreshCw size={20} className="animate-spin" style={{ color: 'rgba(255,255,255,0.8)' }} />
            ) : avatar.url ? (
              <img src={avatar.url} alt="" className="w-full h-full object-cover" />
            ) : (
              <Users size={28} style={{ color: 'rgba(255,255,255,0.8)' }} />
            )}
          </div>
          <div className="relative flex-1 min-w-0">
            <h2 className="font-head text-2xl sm:text-3xl font-bold uppercase tracking-tight truncate" style={{ color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>{displayName}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {latestTeam ? <button onClick={() => onOpenTeam(latest.teamId)} className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: '#fff' }}><TeamMark team={latestTeam} size={16} /> {latestTeam.name}</button> : <span className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>Free Agent</span>}
            </div>
            {(playerBadges.length > 0 || autoBadges.length > 0) && (
              <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                {autoBadges.map(b => (
                  <span key={b.key} title={b.detail || b.label} className="flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-xs font-bold shadow-sm" style={{ background: GOLD, color: '#241a02' }}>
                    {b.isHof ? <Star size={13} fill="#241a02" /> : b.isChampionship ? <Crown size={13} /> : <AwardIcon size={13} />}
                    <span>{b.count > 1 ? `${b.count}x ` : ''}{b.label}</span>
                  </span>
                ))}
                {playerBadges.map(b => (
                  <span key={b.id} title={b.name} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold shadow-sm" style={{ background: '#fff', color: '#1a1a1a' }}>
                    <BadgeIcon badge={b} size={14} /><span>{b.name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => onOpenPlayerCompare(displayName)} className="relative flex items-center gap-1 text-xs font-semibold flex-shrink-0 px-2 py-1 rounded-full" style={{ color: '#fff', background: 'rgba(0,0,0,0.3)' }}><BarChart3 size={13} /> Compare</button>
        </div>
      </div>

      {(latest.player.suspended || latest.player.banned) && onSubmitAppeal && (
        <AppealPanel seasonId={latest.season.id} playerId={latest.playerId} playerName={displayName} teamId={latest.teamId} onSubmitAppeal={onSubmitAppeal} />
      )}

      <PlayerBadgeAssigner league={league} playerBadges={playerBadges} primaryIdentityKey={primaryIdentityKey} onSetPlayerBadges={onSetPlayerBadges} />

      {isSiteOwner && (
        <PlayerEditPanel
          league={league} seasonsInfo={seasonsInfo} teamsById={teamsById} displayName={displayName}
          playerAccolades={playerAccolades} playerTeamCredits={playerTeamCredits}
          primaryIdentityKey={primaryIdentityKey}
          onAddPlayerAccolade={onAddPlayerAccolade} onRemovePlayerAccolade={onRemovePlayerAccolade}
          onAddPlayerTeamCredit={onAddPlayerTeamCredit} onRemovePlayerTeamCredit={onRemovePlayerTeamCredit}
          onUpsertManualStatLine={onUpsertManualStatLine} onDeleteManualStatLine={onDeleteManualStatLine}
          onRenamePlayer={(entries, newName) => { onRenamePlayer(entries, newName); if (onPlayerRenamed) onPlayerRenamed(newName); }}
        />
      )}

      {gameLog.length === 0 ? (
        <>
          <Panel>
            <SectionTitle>Teams played on</SectionTitle>
            <div className="px-2 pb-2">
              {teamsPlayedOn.map((entry, i) => {
                const t = teamsById[entry.teamId];
                const isFA = entry.teamId == null;
                const dp = entry.draftPick;
                return (
                  <div key={i} className="flex items-center gap-2 px-2 py-2" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
                    <button onClick={() => t && onOpenTeam(entry.teamId)} disabled={isFA} className="flex-1 min-w-0 flex items-center gap-2 text-left disabled:cursor-default">
                      {t && <TeamMark team={t} size={18} />}
                      <span className="flex-1 min-w-0 text-sm font-semibold truncate" style={{ color: CHALK }}>{t ? t.name : (isFA ? 'Free Agent' : 'Unknown team')}</span>
                    </button>
                    <span className="text-right flex-shrink-0">
                      <span className="block text-xs" style={{ color: CHALK_DIM }}>{entry.season.name}</span>
                      {dp && <span className="block text-[10px]" style={{ color: GOLD }}>R{dp.round} P{dp.pickInRound}{dp.overall ? ` · #${dp.overall} overall` : ''}</span>}
                    </span>
                    {canManage && !isFA && (
                      <button onClick={() => { if (confirm(`Remove ${t ? t.name : 'this team'} from ${displayName}'s history for ${entry.season.name}? Any stats already recorded there for them go with it — this can't be undone.`)) onRemoveTeamPlayed(entry.season.id, entry.teamId, entry.playerId); }} className="p-1 rounded flex-shrink-0" style={{ color: CHALK_DIM }}><X size={13} /></button>
                    )}
                  </div>
                );
              })}
              {playerTeamCredits.map((c, i) => {
                const t = teamsById[c.teamId];
                return (
                  <button key={`tc-${c.id}`} onClick={() => t && onOpenTeam(c.teamId)} className="w-full flex items-center gap-2 px-2 py-2 text-left" style={{ borderTop: (teamsPlayedOn.length + i) > 0 ? `1px solid ${LINE}` : 'none' }}>
                    {t && <TeamMark team={t} size={18} />}
                    <span className="flex-1 text-sm font-semibold truncate" style={{ color: CHALK }}>{t ? t.name : 'Unknown team'}</span>
                    <span className="text-xs flex-shrink-0" style={{ color: CHALK_DIM }}>{c.seasonLabel || 'Manually added'}</span>
                  </button>
                );
              })}
            </div>
          </Panel>
          {playerTransactions.length > 0 && (
            <Panel className="overflow-hidden">
              <SectionTitle right={canManage && <button onClick={() => { if (confirm(`Remove all ${playerTransactions.length} transaction${playerTransactions.length === 1 ? '' : 's'} for ${displayName}? This can't be undone.`)) onClearAllActivity(playerTransactions.map(a => ({ id: a.id, seasonId: a.seasonId }))); }} className="text-[11px] font-semibold" style={{ color: NEGATIVE }}>Clear all</button>}>Transactions</SectionTitle>
              <div className="px-2 pb-2">
                {playerTransactions.map(a => (
                  <ActivityRow key={a.id} a={a} teamsById={teamsById} onRemove={canManage ? (id) => onRemoveActivity(id, a.seasonId) : null} />
                ))}
              </div>
            </Panel>
          )}
          <Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>No stats imported for this player yet.</p></Panel>
        </>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
        <div className="lg:col-span-2 space-y-3">
          {(peakBattingSeason || peakPitchingSeason) && (
            <Panel style={{ borderColor: GOLD }}>
              <SectionTitle accent={GOLD}>Career-peak season</SectionTitle>
              <div className="px-4 pb-3 flex flex-wrap gap-4">
                {peakBattingSeason && (
                  <div>
                    <p className="text-[10px] uppercase font-bold" style={{ color: CHALK_DIM }}>Best by OPS</p>
                    <p className="text-sm font-semibold" style={{ color: CHALK }}>{peakBattingSeason.seasonName}</p>
                    <p className="text-xs" style={{ color: CHALK_DIM }}>{fmtStatRate(peakBattingSeason.ops)} OPS</p>
                  </div>
                )}
                {peakPitchingSeason && (
                  <div>
                    <p className="text-[10px] uppercase font-bold" style={{ color: CHALK_DIM }}>Best by ERA</p>
                    <p className="text-sm font-semibold" style={{ color: CHALK }}>{peakPitchingSeason.seasonName}</p>
                    <p className="text-xs" style={{ color: CHALK_DIM }}>{peakPitchingSeason.era.toFixed(2)} ERA</p>
                  </div>
                )}
              </div>
            </Panel>
          )}
          {regBattingRows.length > 0 && (
            <Panel>
              <SectionTitle accent={PRIMARY}>Regular season batting</SectionTitle>
              <PlayerBattingTable rows={regBattingRows} />
            </Panel>
          )}
          {regPitchingRows.length > 0 && (
            <Panel>
              <SectionTitle accent={PRIMARY}>Regular season pitching</SectionTitle>
              <PlayerPitchingTable rows={regPitchingRows} />
            </Panel>
          )}
          {poBattingRows.length > 0 && (
            <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
              <SectionTitle accent={GOLD}>Playoffs batting</SectionTitle>
              <PlayerBattingTable rows={poBattingRows} />
            </Panel>
          )}
          {poPitchingRows.length > 0 && (
            <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
              <SectionTitle accent={GOLD}>Playoffs pitching</SectionTitle>
              <PlayerPitchingTable rows={poPitchingRows} />
            </Panel>
          )}

          <Panel>
            <SectionTitle accent={GOLD}>Advanced stats (regular season)</SectionTitle>
            <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {hasBatting && <>
                <StatBox label="OBP" value={batting.obp.toFixed(3).replace(/^0/, '')} />
                <StatBox label="SLG" value={batting.slg.toFixed(3).replace(/^0/, '')} />
                <StatBox label="OPS" value={batting.ops.toFixed(3).replace(/^0/, '')} color={GOLD} />
                <StatBox label="ISO" value={batting.iso.toFixed(3).replace(/^0/, '')} />
                {opsPlus != null && <StatBox label="OPS+" value={opsPlus} color={opsPlus >= 100 ? WIN : NEGATIVE} />}
              </>}
              {hasPitching && <>
                <StatBox label="WHIP" value={pitching.whip.toFixed(2)} />
                <StatBox label="K/9" value={pitching.k9.toFixed(1)} />
                <StatBox label="BB/9" value={pitching.bb9.toFixed(1)} />
                <StatBox label="K/BB" value={pitching.kbb === Infinity ? '∞' : pitching.kbb.toFixed(2)} />
                {eraPlus != null && <StatBox label="ERA+" value={eraPlus} color={eraPlus >= 100 ? WIN : NEGATIVE} />}
              </>}
            </div>
            {(opsPlus != null || eraPlus != null) && <p className="px-4 pb-3 text-[10px]" style={{ color: CHALK_DIM }}>OPS+/ERA+ are indexed to this season's league average — 100 is exactly average, higher is better either way.</p>}
          </Panel>

          {trendData.length >= 3 && (
            <Panel>
              <SectionTitle>{hasBatting ? 'AVG trend' : 'ERA trend'}</SectionTitle>
              <div className="px-2 pb-3" style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid stroke={LINE} strokeDasharray="3 3" />
                    <XAxis dataKey="i" stroke={CHALK_DIM} tick={{ fontSize: 10 }} />
                    <YAxis stroke={CHALK_DIM} tick={{ fontSize: 10 }} domain={hasBatting ? [0, 1] : ['auto', 'auto']} />
                    <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, fontSize: 12 }} formatter={(v) => hasBatting ? v.toFixed(3) : v.toFixed(2)} />
                    <Line type="monotone" dataKey="value" stroke={PRIMARY} dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )}

          {seasonTrendData.length >= 2 && (
            <Panel>
              <SectionTitle>{hasBatting ? 'OPS by season' : 'ERA by season'}</SectionTitle>
              <div className="px-2 pb-3" style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={seasonTrendData}>
                    <CartesianGrid stroke={LINE} strokeDasharray="3 3" />
                    <XAxis dataKey="season" stroke={CHALK_DIM} tick={{ fontSize: 10 }} />
                    <YAxis stroke={CHALK_DIM} tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                    <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, fontSize: 12 }} formatter={(v) => hasBatting ? v.toFixed(3) : v.toFixed(2)} />
                    <Line type="monotone" dataKey="value" stroke={GOLD} dot strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )}

          {seasonCountingData.length >= 2 && (
            <Panel>
              <SectionTitle>{hasBatting ? 'Hits, HR & RBI by season' : 'Strikeouts & walks by season'}</SectionTitle>
              <div className="px-2 pb-3" style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={seasonCountingData}>
                    <CartesianGrid stroke={LINE} strokeDasharray="3 3" />
                    <XAxis dataKey="season" stroke={CHALK_DIM} tick={{ fontSize: 10 }} />
                    <YAxis stroke={CHALK_DIM} tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11, color: CHALK_DIM }} />
                    {hasBatting ? [
                      <Bar key="h" dataKey="h" name="Hits" fill={PRIMARY} radius={[3, 3, 0, 0]} />,
                      <Bar key="hr" dataKey="hr" name="HR" fill={GOLD} radius={[3, 3, 0, 0]} />,
                      <Bar key="rbi" dataKey="rbi" name="RBI" fill={WIN} radius={[3, 3, 0, 0]} />,
                    ] : [
                      <Bar key="k" dataKey="k" name="Strikeouts" fill={PRIMARY} radius={[3, 3, 0, 0]} />,
                      <Bar key="bb" dataKey="bb" name="Walks allowed" fill={NEGATIVE} radius={[3, 3, 0, 0]} />,
                    ]}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )}

          {hitTypeData.length > 0 && (
            <Panel>
              <SectionTitle>Career hit mix</SectionTitle>
              <div className="px-2 pb-3" style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={hitTypeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name}: ${value}`}>
                      {hitTypeData.map((d, i) => <Cell key={d.name} fill={HIT_TYPE_COLORS[i % HIT_TYPE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11, color: CHALK_DIM }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )}

          {hasOneRunSplit && (
            <Panel>
              <SectionTitle>One-run game splits</SectionTitle>
              <div className="px-4 pb-3 grid grid-cols-2 gap-3">
                {hasBatting ? <>
                  <StatBox label="OPS · 1-run games" value={oneRunBatting.ops.toFixed(3).replace(/^0/, '')} color={GOLD} />
                  <StatBox label="OPS · other games" value={otherBatting.ops.toFixed(3).replace(/^0/, '')} />
                </> : <>
                  <StatBox label="ERA · 1-run games" value={oneRunPitching.era.toFixed(2)} color={GOLD} />
                  <StatBox label="ERA · other games" value={otherPitching.era.toFixed(2)} />
                </>}
              </div>
            </Panel>
          )}

          {showPace && (
            <Panel>
              <SectionTitle accent={PRIMARY}>Rest-of-season pace</SectionTitle>
              <p className="px-4 pb-2 text-xs" style={{ color: CHALK_DIM }}>Current per-game rate projected across {paceGamesRemaining} remaining game{paceGamesRemaining === 1 ? '' : 's'} this season.</p>
              <div className="px-4 pb-3 grid grid-cols-3 gap-3">
                {paceStats.map(s => (
                  <StatBox key={s.label} label={s.label} value={Math.round((s.v / paceGamesPlayed) * (paceGamesPlayed + paceGamesRemaining))} color={PRIMARY} />
                ))}
              </div>
            </Panel>
          )}

          <Panel>
            <SectionTitle>Recent games</SectionTitle>
            <div className="overflow-x-auto px-2 pb-3">
              <table className="w-full text-xs" style={{ color: CHALK }}>
                <thead><tr className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>
                  <th className="text-left px-2 py-1">Date</th><th className="text-left px-2 py-1">Opp</th><th className="px-2 py-1">AB</th><th className="px-2 py-1">H</th><th className="px-2 py-1">HR</th><th className="px-2 py-1">RBI</th><th className="px-2 py-1">IP</th><th className="px-2 py-1">K</th><th className="px-2 py-1">ER</th>
                </tr></thead>
                <tbody>
                  {recentGames.map((row, i) => {
                    const opp = teamsById[row.oppTeamId];
                    return (
                      <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                        <td className="px-2 py-1.5 font-mono whitespace-nowrap">{row.date || '—'}</td>
                        <td className="px-2 py-1.5 truncate">{opp ? opp.name : '—'}</td>
                        <td className="px-2 py-1.5 text-center font-mono">{row.ab}</td>
                        <td className="px-2 py-1.5 text-center font-mono">{row.h}</td>
                        <td className="px-2 py-1.5 text-center font-mono">{row.hr}</td>
                        <td className="px-2 py-1.5 text-center font-mono">{row.rbi}</td>
                        <td className="px-2 py-1.5 text-center font-mono">{ipDisplayToOuts(row.ip) > 0 ? outsToIpDisplay(ipDisplayToOuts(row.ip)) : '—'}</td>
                        <td className="px-2 py-1.5 text-center font-mono">{row.k}</td>
                        <td className="px-2 py-1.5 text-center font-mono">{row.er}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div className="space-y-3">
          {upcomingMilestones.length > 0 && (
            <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
              <SectionTitle accent={GOLD}>Milestone watch</SectionTitle>
              <div className="px-2 pb-2">
                {upcomingMilestones.map((m, i) => (
                  <div key={m.label} className="px-2 py-2 text-sm" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none', color: CHALK }}>
                    <span className="font-bold" style={{ color: GOLD }}>{m.remaining}</span> away from {m.next.toLocaleString()} {m.label}
                  </div>
                ))}
              </div>
            </Panel>
          )}
          <Panel>
            <SectionTitle>Teams played on</SectionTitle>
            <div className="px-2 pb-2">
              {teamsPlayedOn.map((entry, i) => {
                const t = teamsById[entry.teamId];
                const isFA = entry.teamId == null;
                const dp = entry.draftPick;
                return (
                  <div key={i} className="flex items-center gap-2 px-2 py-2" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
                    <button onClick={() => t && onOpenTeam(entry.teamId)} disabled={isFA} className="flex-1 min-w-0 flex items-center gap-2 text-left disabled:cursor-default">
                      {t && <TeamMark team={t} size={18} />}
                      <span className="flex-1 min-w-0 text-sm font-semibold truncate" style={{ color: CHALK }}>{t ? t.name : (isFA ? 'Free Agent' : 'Unknown team')}</span>
                    </button>
                    <span className="text-right flex-shrink-0">
                      <span className="block text-xs" style={{ color: CHALK_DIM }}>{entry.season.name}</span>
                      {dp && <span className="block text-[10px]" style={{ color: GOLD }}>R{dp.round} P{dp.pickInRound}{dp.overall ? ` · #${dp.overall} overall` : ''}</span>}
                    </span>
                    {canManage && !isFA && (
                      <button onClick={() => { if (confirm(`Remove ${t ? t.name : 'this team'} from ${displayName}'s history for ${entry.season.name}? Any stats already recorded there for them go with it — this can't be undone.`)) onRemoveTeamPlayed(entry.season.id, entry.teamId, entry.playerId); }} className="p-1 rounded flex-shrink-0" style={{ color: CHALK_DIM }}><X size={13} /></button>
                    )}
                  </div>
                );
              })}
              {playerTeamCredits.map((c, i) => {
                const t = teamsById[c.teamId];
                return (
                  <button key={`tc-${c.id}`} onClick={() => t && onOpenTeam(c.teamId)} className="w-full flex items-center gap-2 px-2 py-2 text-left" style={{ borderTop: (teamsPlayedOn.length + i) > 0 ? `1px solid ${LINE}` : 'none' }}>
                    {t && <TeamMark team={t} size={18} />}
                    <span className="flex-1 text-sm font-semibold truncate" style={{ color: CHALK }}>{t ? t.name : 'Unknown team'}</span>
                    <span className="text-xs flex-shrink-0" style={{ color: CHALK_DIM }}>{c.seasonLabel || 'Manually added'}</span>
                  </button>
                );
              })}
            </div>
          </Panel>

          {playerTransactions.length > 0 && (
            <Panel className="overflow-hidden">
              <SectionTitle right={canManage && <button onClick={() => { if (confirm(`Remove all ${playerTransactions.length} transaction${playerTransactions.length === 1 ? '' : 's'} for ${displayName}? This can't be undone.`)) onClearAllActivity(playerTransactions.map(a => ({ id: a.id, seasonId: a.seasonId }))); }} className="text-[11px] font-semibold" style={{ color: NEGATIVE }}>Clear all</button>}>Transactions</SectionTitle>
              <div className="px-2 pb-2">
                {playerTransactions.map(a => (
                  <ActivityRow key={a.id} a={a} teamsById={teamsById} onRemove={canManage ? (id) => onRemoveActivity(id, a.seasonId) : null} />
                ))}
              </div>
            </Panel>
          )}

          {awards.length > 0 && (() => {
            // Grouped by award name so a repeat winner (2x MVP, etc.) reads
            // as one line with every season it was won, instead of the same
            // award name repeated once per season.
            const groups = [];
            awards.forEach(a => {
              let g = groups.find(g => g.name === a.name);
              if (!g) { g = { name: a.name, isChampionship: a.isChampionship, entries: [] }; groups.push(g); }
              g.entries.push(a);
            });
            groups.sort((a, b) => b.entries.length - a.entries.length);
            return (
              <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
                <SectionTitle accent={GOLD}>Award history</SectionTitle>
                <div className="px-4 pb-3 space-y-2.5">
                  {groups.map((g, gi) => (
                    <div key={gi}>
                      <div className="flex items-center gap-2 text-sm font-bold" style={{ color: GOLD }}>
                        {g.isChampionship ? <Crown size={14} /> : <AwardIcon size={14} />}
                        {g.entries.length > 1 ? `${g.entries.length}x ` : ''}{g.name}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-1 pl-5">
                        {g.entries.map((a, i) => (
                          <span key={i} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: PANEL2, color: CHALK_DIM }}>
                            {a.seasonName || '—'}
                            {a.isManual && isSiteOwner && <button onClick={() => onRemovePlayerAccolade(a._key, a.id)} style={{ color: CHALK_DIM }}><X size={11} /></button>}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            );
          })()}

          {highs.length > 0 && (
            <Panel>
              <SectionTitle accent={GOLD}>Game highs</SectionTitle>
              <div className="px-4 pb-3 space-y-2">
                {highs.map(h => (
                  <div key={h.key} className="flex items-center justify-between text-sm gap-2">
                    <span style={{ color: CHALK_DIM }}>{h.label}</span>
                    <span className="font-mono font-bold flex items-center gap-2" style={{ color: CHALK }}>{h.value} <GameRef row={h.row} /></span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {notable.length > 0 && (
            <Panel>
              <SectionTitle accent={GOLD}>Notable games</SectionTitle>
              <div className="px-4 pb-3 space-y-2">
                {notable.map((n, i) => (
                  <div key={i} className="flex items-center justify-between text-sm gap-2">
                    <span className="font-semibold" style={{ color: CHALK }}>{n.tags.join(', ')}</span> <GameRef row={n.row} />
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {myPercentileEntry && percentileSeason && (
            <SavantPercentilesPanel player={myPercentileEntry} pool={percentilePool} seasonName={percentileSeason.name} />
          )}
          <Panel>
            <SectionTitle accent={PRIMARY}>Top performances</SectionTitle>
            <div className="px-2 pb-3">
              {topPerformances.map((tp, i) => (
                <div key={i} className="flex items-center justify-between px-2 py-2 text-sm gap-2" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
                  <span style={{ color: CHALK }}>{tp.row.h}H {tp.row.rbi}RBI{tp.row.hr ? ` ${tp.row.hr}HR` : ''}{ipDisplayToOuts(tp.row.ip) > 0 ? ` · ${tp.row.k}K ${outsToIpDisplay(ipDisplayToOuts(tp.row.ip))}IP` : ''}</span>
                  <GameRef row={tp.row} />
                </div>
              ))}
            </div>
          </Panel>
        </div>
        </div>
      )}
    </div>
  );
}

function PlayerComparePage({ league, teamsById, initialNameA, initialNameB, onBack, onOpenPlayer, activeSeasonId }) {
  const allNames = useMemo(() => getAllPlayerNames(league), [league]);
  // Grouping players by their current team (this season) turns the picker
  // from one giant alphabetical list into "pick a team, then a player" —
  // free agents get their own bucket since they're not on any roster.
  const activeSeason = useMemo(() => (league.seasons || []).find(s => s.id === activeSeasonId), [league, activeSeasonId]);
  const rosterGroups = useMemo(() => {
    if (!activeSeason) return [];
    const groups = (activeSeason.members || []).map(m => ({
      key: m.teamId,
      teamName: (teamsById[m.teamId] && teamsById[m.teamId].name) || m.scheduleName || 'Unknown team',
      names: (m.roster || []).map(p => p.name).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    })).filter(g => g.names.length > 0);
    const faNames = (activeSeason.freeAgents || []).map(p => p.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
    if (faNames.length > 0) groups.push({ key: '__fa', teamName: 'Free Agents', names: faNames });
    return groups;
  }, [activeSeason, teamsById]);
  const findGroupKeyForName = (name) => (rosterGroups.find(g => g.names.includes(name)) || {}).key ?? '__all';

  const [teamAKey, setTeamAKey] = useState(() => findGroupKeyForName(initialNameA || allNames[0] || ''));
  const [nameA, setNameA] = useState(initialNameA || allNames[0] || '');
  const [teamBKey, setTeamBKey] = useState(() => findGroupKeyForName(initialNameB || allNames.find(n => n !== initialNameA) || allNames[1] || ''));
  const [nameB, setNameB] = useState(initialNameB || allNames.find(n => n !== initialNameA) || allNames[1] || '');

  if (allNames.length === 0) {
    return (
      <div className="p-4">
        <button onClick={onBack} className="flex items-center gap-1 text-sm mb-3" style={{ color: CHALK_DIM }}><ArrowLeft size={14} /> Back</button>
        <Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>No players in this league yet.</p></Panel>
      </div>
    );
  }

  const namesForKey = (key) => key === '__all' ? allNames : ((rosterGroups.find(g => g.key === key) || {}).names || allNames);

  const dataA = getPlayerCareerData(league, nameA);
  const dataB = getPlayerCareerData(league, nameB);
  // Tournament-season stats don't count toward career totals here either,
  // same as the player page's own combined totals.
  const totalsA = sumPlayerTotals(dataA.gameLog.filter(r => !r.isTournament)), totalsB = sumPlayerTotals(dataB.gameLog.filter(r => !r.isTournament));
  const battingA = computeBattingAdvanced(totalsA), battingB = computeBattingAdvanced(totalsB);
  const pitchingA = computePitchingAdvanced(totalsA), pitchingB = computePitchingAdvanced(totalsB);
  // Same fix as PlayerPage: prefer the entry for the season actually being
  // viewed (activeSeasonId) over whichever season this identity's record
  // was most recently created in — otherwise switching the season viewer
  // to an older season didn't update who's shown as on what team here.
  const currentEntryFor = (seasonsInfo) => seasonsInfo.length > 0
    ? (seasonsInfo.find(info => info.season.id === activeSeasonId) || seasonsInfo[seasonsInfo.length - 1])
    : null;
  const latestA = currentEntryFor(dataA.seasonsInfo);
  const latestB = currentEntryFor(dataB.seasonsInfo);
  const teamA = latestA ? teamsById[latestA.teamId] : null;
  const teamB = latestB ? teamsById[latestB.teamId] : null;
  const colorA = teamA ? teamColor(teamA) : PRIMARY, colorB = teamB ? teamColor(teamB) : NEGATIVE;
  const bothPitch = totalsA.outs > 0 && totalsB.outs > 0;

  const PickerSide = ({ teamKey, setTeamKey, name, setName }) => (
    <div className="flex-1 min-w-0 space-y-1.5">
      {rosterGroups.length > 0 && (
        <select value={teamKey} onChange={e => { const k = e.target.value; setTeamKey(k); const names = namesForKey(k); if (names.length && !names.includes(name)) setName(names[0]); }} className="w-full bg-[#242424] border rounded px-2 py-1.5 text-xs" style={{ borderColor: LINE, color: CHALK_DIM }}>
          <option value="__all" style={{ background: PANEL2, color: CHALK }}>All players</option>
          {rosterGroups.map(g => <option key={g.key} value={g.key} style={{ background: PANEL2, color: CHALK }}>{g.teamName}</option>)}
        </select>
      )}
      <select value={name} onChange={e => setName(e.target.value)} className="w-full bg-[#242424] border rounded px-2 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }}>
        {namesForKey(teamKey).map(n => <option key={n} value={n} style={{ background: PANEL2, color: CHALK }}>{n}</option>)}
      </select>
    </div>
  );

  return (
    <div className="p-3 space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm" style={{ color: CHALK_DIM }}><ArrowLeft size={14} /> Back</button>
      <Panel>
        <SectionTitle>Player comparison</SectionTitle>
        <div className="px-4 pb-3 flex items-start gap-2">
          <PickerSide teamKey={teamAKey} setTeamKey={setTeamAKey} name={nameA} setName={setNameA} />
          <span className="text-xs font-bold pt-2" style={{ color: CHALK_DIM }}>VS</span>
          <PickerSide teamKey={teamBKey} setTeamKey={setTeamBKey} name={nameB} setName={setNameB} />
        </div>
      </Panel>
      <div className="rounded-xl overflow-hidden flex" style={{ border: `1px solid ${LINE}` }}>
        <button onClick={() => onOpenPlayer(nameA)} className="flex-1 p-3 flex items-center gap-2" style={{ background: `${colorA}12` }}>
          {teamA && <TeamMark team={teamA} size={20} />} <span className="font-bold truncate" style={{ color: CHALK }}>{nameA}</span>
        </button>
        <button onClick={() => onOpenPlayer(nameB)} className="flex-1 p-3 flex items-center justify-end gap-2" style={{ background: `${colorB}12` }}>
          <span className="font-bold truncate" style={{ color: CHALK }}>{nameB}</span> {teamB && <TeamMark team={teamB} size={20} />}
        </button>
      </div>
      <Panel>
        <div className="py-2">
          <CompareStatRow label="Games" aVal={totalsA.g} bVal={totalsB.g} aBetter={totalsA.g > totalsB.g} bBetter={totalsB.g > totalsA.g} aColor={colorA} bColor={colorB} />
          <CompareStatRow label="AVG" aVal={battingA.avg.toFixed(3).replace(/^0/, '')} bVal={battingB.avg.toFixed(3).replace(/^0/, '')} aBetter={battingA.avg > battingB.avg} bBetter={battingB.avg > battingA.avg} aColor={colorA} bColor={colorB} />
          <CompareStatRow label="OBP" aVal={battingA.obp.toFixed(3).replace(/^0/, '')} bVal={battingB.obp.toFixed(3).replace(/^0/, '')} aBetter={battingA.obp > battingB.obp} bBetter={battingB.obp > battingA.obp} aColor={colorA} bColor={colorB} />
          <CompareStatRow label="SLG" aVal={battingA.slg.toFixed(3).replace(/^0/, '')} bVal={battingB.slg.toFixed(3).replace(/^0/, '')} aBetter={battingA.slg > battingB.slg} bBetter={battingB.slg > battingA.slg} aColor={colorA} bColor={colorB} />
          <CompareStatRow label="OPS" aVal={battingA.ops.toFixed(3).replace(/^0/, '')} bVal={battingB.ops.toFixed(3).replace(/^0/, '')} aBetter={battingA.ops > battingB.ops} bBetter={battingB.ops > battingA.ops} aColor={colorA} bColor={colorB} />
          <CompareStatRow label="HR" aVal={totalsA.hr} bVal={totalsB.hr} aBetter={totalsA.hr > totalsB.hr} bBetter={totalsB.hr > totalsA.hr} aColor={colorA} bColor={colorB} />
          <CompareStatRow label="RBI" aVal={totalsA.rbi} bVal={totalsB.rbi} aBetter={totalsA.rbi > totalsB.rbi} bBetter={totalsB.rbi > totalsA.rbi} aColor={colorA} bColor={colorB} />
          <CompareStatRow label="ERA" aVal={totalsA.outs > 0 ? pitchingA.era.toFixed(2) : '—'} bVal={totalsB.outs > 0 ? pitchingB.era.toFixed(2) : '—'} aBetter={bothPitch && pitchingA.era < pitchingB.era} bBetter={bothPitch && pitchingB.era < pitchingA.era} aColor={colorA} bColor={colorB} />
          <CompareStatRow label="WHIP" aVal={totalsA.outs > 0 ? pitchingA.whip.toFixed(2) : '—'} bVal={totalsB.outs > 0 ? pitchingB.whip.toFixed(2) : '—'} aBetter={bothPitch && pitchingA.whip < pitchingB.whip} bBetter={bothPitch && pitchingB.whip < pitchingA.whip} aColor={colorA} bColor={colorB} />
          <CompareStatRow label="K/9" aVal={totalsA.outs > 0 ? pitchingA.k9.toFixed(1) : '—'} bVal={totalsB.outs > 0 ? pitchingB.k9.toFixed(1) : '—'} aBetter={bothPitch && pitchingA.k9 > pitchingB.k9} bBetter={bothPitch && pitchingB.k9 > pitchingA.k9} aColor={colorA} bColor={colorB} />
        </div>
      </Panel>
      {(() => {
        const seasonOrder = (league.seasons || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).filter(s => !(s.settings && s.settings.isTournament));
        const trendSeasons = seasonOrder.map(s => {
          const rowsA = dataA.gameLog.filter(r => r.seasonId === s.id && !r.isTournament);
          const rowsB = dataB.gameLog.filter(r => r.seasonId === s.id && !r.isTournament);
          const totA = sumPlayerTotals(rowsA), totB = sumPlayerTotals(rowsB);
          return {
            label: s.name,
            opsA: totA.ab >= 3 ? Number(computeBattingAdvanced(totA).ops.toFixed(3)) : null,
            opsB: totB.ab >= 3 ? Number(computeBattingAdvanced(totB).ops.toFixed(3)) : null,
            eraA: totA.outs >= 3 ? Number(computePitchingAdvanced(totA).era.toFixed(2)) : null,
            eraB: totB.outs >= 3 ? Number(computePitchingAdvanced(totB).era.toFixed(2)) : null,
          };
        }).filter(s => s.opsA != null || s.opsB != null || s.eraA != null || s.eraB != null);
        if (trendSeasons.length < 2) return null;
        const showOps = trendSeasons.some(s => s.opsA != null || s.opsB != null);
        const showEra = trendSeasons.some(s => s.eraA != null || s.eraB != null);
        return (
          <Panel>
            <SectionTitle>Season-by-season trend</SectionTitle>
            <div className="px-2 pb-3 space-y-4">
              {showOps && (
                <div>
                  <p className="px-2 text-xs font-bold uppercase" style={{ color: CHALK_DIM }}>OPS</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={trendSeasons} margin={{ left: -10, right: 12, top: 8 }}>
                      <CartesianGrid stroke={LINE} strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fill: CHALK_DIM, fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: CHALK_DIM, fontSize: 10 }} domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(3).replace(/^0/, '')} />
                      <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} formatter={(v) => v != null ? v.toFixed(3).replace(/^0/, '') : '—'} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="opsA" name={nameA} stroke={colorA} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="opsB" name={nameB} stroke={colorB} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              {showEra && (
                <div>
                  <p className="px-2 text-xs font-bold uppercase" style={{ color: CHALK_DIM }}>ERA</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={trendSeasons} margin={{ left: -10, right: 12, top: 8 }}>
                      <CartesianGrid stroke={LINE} strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fill: CHALK_DIM, fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: CHALK_DIM, fontSize: 10 }} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="eraA" name={nameA} stroke={colorA} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="eraB" name={nameB} stroke={colorB} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </Panel>
        );
      })()}
    </div>
  );
}

/* ==================================================================== */
/* Stat leaders                                                          */
/* ==================================================================== */
function LeaderBoardCard({ title, accent = PRIMARY, players, valueFn, formatFn, teamsById, onOpenPlayer, sortDesc = true, limit = 5, leagueLogoUrl, scope = 'season' }) {
  const ranked = [...players].sort((a, b) => sortDesc ? valueFn(b) - valueFn(a) : valueFn(a) - valueFn(b)).slice(0, limit);
  // A career/all-time row can span several teams over several seasons —
  // there's no single "current team" that's actually correct for it, so
  // rather than pick one (arbitrarily, and sometimes misleadingly) via
  // whichever season happened to be created last, this scope just doesn't
  // claim a team at all. "This Season" rows are unambiguous and keep it.
  const showTeam = scope !== 'career';
  return (
    <Panel>
      <SectionTitle accent={accent}>{title}</SectionTitle>
      <div className="px-2 pb-3">
        {ranked.length === 0 && <p className="px-2 py-3 text-sm" style={{ color: CHALK_DIM }}>Not enough data yet.</p>}
        {ranked.map((p, i) => {
          const t = showTeam ? teamsById[p.teamId] : null;
          return (
            <button key={p.playerId} onClick={() => onOpenPlayer(p.name)} className="w-full flex items-center gap-2 px-2 py-1.5 text-left" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
              <span className="w-4 text-xs font-mono flex-shrink-0" style={{ color: CHALK_DIM }}>{i + 1}</span>
              {showTeam && (t ? <TeamMark team={t} size={14} /> : leagueLogoUrl ? <img src={leagueLogoUrl} alt="" style={{ width: 14, height: 14, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} /> : <span className="inline-block rounded-full flex-shrink-0" style={{ width: 8, height: 8, background: CHALK_DIM }} />)}
              <span className="flex-1 text-sm font-semibold truncate" style={{ color: CHALK }}>{p.name}</span>
              {showTeam && <span className="text-[10px] font-mono font-bold flex-shrink-0" style={{ color: CHALK_DIM }}>{t ? teamAbbr(t) : 'FA'}</span>}
              <span className="text-sm font-mono font-bold flex-shrink-0" style={{ color: accent }}>{formatFn(valueFn(p))}</span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function StatLeadersView({ league, season, teamsById, onOpenPlayer, leagueLogoUrl, standings }) {
  const [mode, setMode] = useState('regular');
  const [scope, setScope] = useState('season'); // 'season' | 'career' | 'last10' | 'last20'
  const isRollingScope = scope === 'last10' || scope === 'last20';
  const hasPlayoffGames = useMemo(() => (season.games || []).some(g => g.isPlayoff && !g.isBye), [season]);
  const seasonPlayers = useMemo(() => computeSeasonPlayerLeaders(season, teamsById, mode), [season, teamsById, mode]);
  const careerPlayers = useMemo(() => computeCareerLeaders(league, mode), [league, mode]);
  const rollingPlayers = useMemo(() => computeRollingFormLeaders(season, teamsById, scope === 'last20' ? 20 : 10), [season, teamsById, scope]);
  const zScorePlayers = useMemo(() => computeZScoreLeaders(league, teamsById, mode), [league, teamsById, mode]);
  const clutch = useMemo(() => computeClutchLeaders(season, teamsById), [season, teamsById]);
  const players = scope === 'career' ? careerPlayers : isRollingScope ? rollingPlayers : seasonPlayers;
  // Small samples make rate stats (AVG/OPS/ERA…) meaningless — a 1-for-1
  // game is a .1000 hitter otherwise. Counting stats (HR, RBI, K…) don't
  // need a qualifier since more games played only helps, never inflates.
  const batters = players.filter(p => p.totals.ab >= 3);
  const pitchers = players.filter(p => p.totals.outs >= 3);
  const fmtRate = (v) => v.toFixed(3).replace(/^0/, '');
  const fmt2 = (v) => v.toFixed(2);
  const fmt1 = (v) => (v >= 0 ? '+' : '') + v.toFixed(1);
  const fmtInt = (v) => String(Math.round(v));
  const fmtIp = (v) => v.toFixed(1);

  return (
    <div className="p-3 space-y-3">
      <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
        <SectionTitle accent={GOLD} right={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: LINE }}>
              {[['season', 'This Season'], ['last10', 'Last 10'], ['last20', 'Last 20'], ['career', 'All-Time']].map(([s, label]) => (
                <button key={s} onClick={() => setScope(s)} className="px-3 py-1.5 text-xs font-bold" style={{ background: scope === s ? GOLD : 'transparent', color: scope === s ? INK : CHALK_DIM }}>{label}</button>
              ))}
            </div>
            {hasPlayoffGames && !isRollingScope && (
              <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: LINE }}>
                {[['regular', 'Regular Season'], ['playoffs', 'Playoffs']].map(([m, label]) => (
                  <button key={m} onClick={() => setMode(m)} className="px-3 py-1.5 text-xs font-bold" style={{ background: mode === m ? GOLD : 'transparent', color: mode === m ? INK : CHALK_DIM }}>{label}</button>
                ))}
              </div>
            )}
          </div>
        }>Stat leaders</SectionTitle>
        <p className="px-4 pb-3 text-xs" style={{ color: CHALK_DIM }}>{scope === 'career' ? 'Ranked from every season on record, combined per player' : isRollingScope ? `Ranked from each player's most recent ${scope === 'last20' ? '20' : '10'} regular-season games` : "Ranked from imported game stats for this season"} {!isRollingScope && (mode === 'playoffs' ? 'playoff games' : 'regular season')} only. Rate stats (AVG, OPS, ERA, WHIP) need at least 3 AB or 1 IP to qualify. WAR is a simplified estimate — linear-weights batting runs plus runs saved vs. league-average ERA, not an official sabermetric figure.</p>
      </Panel>

      {players.length === 0 ? (
        <Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>{scope === 'career' ? 'No career stats recorded yet.' : isRollingScope ? 'No single-game stats recorded yet this season to build a rolling window from — bulk-imported season totals don\'t carry individual game dates.' : mode === 'playoffs' ? 'No playoff stats imported yet this season.' : "No stats imported yet this season — import a game's box score from the Schedule tab."}</p></Panel>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <LeaderBoardCard title="Batting Average" players={batters} valueFn={p => p.batting.avg} formatFn={fmtRate} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
          <LeaderBoardCard title="OPS" accent={GOLD} players={batters} valueFn={p => p.batting.ops} formatFn={fmtRate} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
          <LeaderBoardCard title="On-Base %" players={batters} valueFn={p => p.batting.obp} formatFn={fmtRate} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
          <LeaderBoardCard title="Slugging %" players={batters} valueFn={p => p.batting.slg} formatFn={fmtRate} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
          <LeaderBoardCard title="Isolated Power" players={batters} valueFn={p => p.batting.iso} formatFn={fmtRate} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
          <LeaderBoardCard title="Home Runs" players={players} valueFn={p => p.totals.hr} formatFn={fmtInt} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
          <LeaderBoardCard title="RBI" players={players} valueFn={p => p.totals.rbi} formatFn={fmtInt} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
          <LeaderBoardCard title="Hits" players={players} valueFn={p => p.totals.h} formatFn={fmtInt} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
          <LeaderBoardCard title="Runs" players={players} valueFn={p => p.totals.r} formatFn={fmtInt} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
          <LeaderBoardCard title="Doubles" players={players} valueFn={p => p.totals.doubles} formatFn={fmtInt} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
          <LeaderBoardCard title="Triples" players={players} valueFn={p => p.totals.triples} formatFn={fmtInt} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
          <LeaderBoardCard title="Walks (Batting)" players={players} valueFn={p => p.totals.bb} formatFn={fmtInt} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
          <LeaderBoardCard title="Strikeouts (Batting)" accent={NEGATIVE} players={players} valueFn={p => p.totals.so} formatFn={fmtInt} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} sortDesc={false} />
          <LeaderBoardCard title="ERA" accent={NEGATIVE} players={pitchers} valueFn={p => p.pitching.era} formatFn={fmt2} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} sortDesc={false} />
          <LeaderBoardCard title="WHIP" accent={NEGATIVE} players={pitchers} valueFn={p => p.pitching.whip} formatFn={fmt2} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} sortDesc={false} />
          <LeaderBoardCard title="Innings Pitched" players={pitchers} valueFn={p => p.pitching.ip} formatFn={fmtIp} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
          <LeaderBoardCard title="Strikeouts (Pitching)" players={pitchers} valueFn={p => p.totals.k} formatFn={fmtInt} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
          <LeaderBoardCard title="K/9" players={pitchers} valueFn={p => p.pitching.k9} formatFn={fmt2} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
          <LeaderBoardCard title="BB/9" accent={NEGATIVE} players={pitchers} valueFn={p => p.pitching.bb9} formatFn={fmt2} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} sortDesc={false} />
          <LeaderBoardCard title="K/BB" players={pitchers} valueFn={p => (p.pitching.kbb === Infinity ? 999 : p.pitching.kbb)} formatFn={(v) => v === 999 ? '∞' : fmt2(v)} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
          <LeaderBoardCard title="WAR" accent={GOLD} players={players} valueFn={p => p.war} formatFn={fmt1} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} />
        </div>
      )}

      {players.length > 0 && <CustomLeaderboardBuilder players={players} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope={scope} standings={standings} />}

      {scope === 'career' && (zScorePlayers.some(p => p.zBatting != null) || zScorePlayers.some(p => p.zPitching != null)) && (
        <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
          <SectionTitle accent={GOLD}>Era-adjusted career leaders</SectionTitle>
          <p className="px-4 pb-3 text-xs" style={{ color: CHALK_DIM }}>Ranked by average standard deviations above each qualifying season's own mean, not raw totals — so a career built in a low-offense era isn't buried under one built in a high-offense era, or vice versa. Only counts seasons where the player had a qualifying sample (3+ AB or 1+ IP).</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-3 pb-3">
            <LeaderBoardCard title="OPS (Era-Adjusted)" accent={GOLD} players={zScorePlayers.filter(p => p.zBatting != null)} valueFn={p => p.zBatting} formatFn={fmt2} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope="career" />
            <LeaderBoardCard title="ERA (Era-Adjusted)" accent={GOLD} players={zScorePlayers.filter(p => p.zPitching != null)} valueFn={p => p.zPitching} formatFn={fmt2} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope="career" />
          </div>
        </Panel>
      )}

      {scope === 'season' && clutch.closeGameCount > 0 && (
        <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
          <SectionTitle accent={GOLD}>Pennant-race clutch index</SectionTitle>
          <p className="px-4 pb-3 text-xs" style={{ color: CHALK_DIM }}>Performance in this season's stretch run — {clutch.closeGameCount} game{clutch.closeGameCount === 1 ? '' : 's'} decided by 2 or fewer out of the last {clutch.stretchGameCount} played.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-3 pb-3">
            <LeaderBoardCard title="Clutch OPS" accent={GOLD} players={clutch.players.filter(p => p.totals.ab >= 2)} valueFn={p => p.batting.ops} formatFn={fmt2} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope="season" />
            <LeaderBoardCard title="Clutch ERA" accent={GOLD} players={clutch.players.filter(p => p.totals.outs >= 2)} valueFn={p => p.pitching.era} formatFn={fmt2} teamsById={teamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={leagueLogoUrl} scope="season" sortDesc={false} />
          </div>
        </Panel>
      )}
    </div>
  );
}

function RookieClassView({ league, activeSeasonId, teamsById, onOpenPlayer, leagueLogoUrl }) {
  const rookies = useMemo(() => computeRookieClass(league, activeSeasonId), [league, activeSeasonId]);
  const batters = rookies.filter(p => p.totals.ab >= 3).sort((a, b) => b.batting.ops - a.batting.ops);
  const pitchers = rookies.filter(p => p.totals.outs >= 3).sort((a, b) => a.pitching.era - b.pitching.era);
  const RookieRow = ({ p, statLabel, statVal }) => {
    const t = teamsById[p.teamId];
    return (
      <button onClick={() => onOpenPlayer(p.name)} className="w-full flex items-center gap-2 px-2 py-2 text-left" style={{ borderTop: `1px solid ${LINE}` }}>
        {t ? <TeamMark team={t} size={16} /> : leagueLogoUrl ? <img src={leagueLogoUrl} alt="" style={{ width: 16, height: 16, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} /> : null}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold truncate" style={{ color: CHALK }}>{p.name}</span>
          {p.draftPick && <span className="block text-[10px]" style={{ color: GOLD }}>R{p.draftPick.round} P{p.draftPick.pickInRound}{p.draftPick.overall ? ` · #${p.draftPick.overall} overall` : ''}</span>}
        </span>
        <span className="text-xs font-mono font-bold flex-shrink-0" style={{ color: CHALK_DIM }}>{statLabel} {statVal}</span>
      </button>
    );
  };
  return (
    <div className="p-3 space-y-3">
      <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
        <SectionTitle accent={GOLD}>Rookie class</SectionTitle>
        <p className="px-4 pb-3 text-xs" style={{ color: CHALK_DIM }}>Every player making their first appearance anywhere in the league's recorded history this season — {rookies.length} so far.</p>
      </Panel>
      {rookies.length === 0 ? (
        <Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>No rookies recorded yet this season.</p></Panel>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Panel className="overflow-hidden">
            <SectionTitle>Batters ({batters.length})</SectionTitle>
            <div className="px-2 pb-2">
              {batters.length === 0 ? <p className="px-2 py-3 text-sm" style={{ color: CHALK_DIM }}>None qualify yet.</p> : batters.map(p => <RookieRow key={p.playerId} p={p} statLabel="OPS" statVal={fmtStatRate(p.batting.ops)} />)}
            </div>
          </Panel>
          <Panel className="overflow-hidden">
            <SectionTitle>Pitchers ({pitchers.length})</SectionTitle>
            <div className="px-2 pb-2">
              {pitchers.length === 0 ? <p className="px-2 py-3 text-sm" style={{ color: CHALK_DIM }}>None qualify yet.</p> : pitchers.map(p => <RookieRow key={p.playerId} p={p} statLabel="ERA" statVal={p.pitching.era.toFixed(2)} />)}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function BadgeShowcaseView({ league, onOpenPlayer }) {
  const holdersByBadge = useMemo(() => computeBadgeHolders(league), [league]);
  const defs = (league.badgeDefs || []).slice();
  return (
    <div className="p-3 space-y-3">
      <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
        <SectionTitle accent={GOLD}>Badge showcase</SectionTitle>
        <p className="px-4 pb-3 text-xs" style={{ color: CHALK_DIM }}>Every badge in the league, and everyone who's earned it.</p>
      </Panel>
      {defs.length === 0 ? (
        <Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>No badges defined yet.</p></Panel>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {defs.map(b => {
            const holders = [...(holdersByBadge.get(b.id) || [])].sort((a, b) => a.localeCompare(b));
            return (
              <Panel key={b.id} className="overflow-hidden">
                <div className="px-4 pt-3 flex items-center gap-2">
                  <BadgeIcon badge={b} size={28} />
                  <div>
                    <p className="text-sm font-bold" style={{ color: CHALK }}>{b.name}</p>
                    <p className="text-[11px]" style={{ color: CHALK_DIM }}>{holders.length} holder{holders.length === 1 ? '' : 's'}</p>
                  </div>
                </div>
                <div className="px-4 py-3">
                  {holders.length === 0 ? (
                    <p className="text-xs" style={{ color: CHALK_DIM }}>Nobody's earned this one yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {holders.map(name => (
                        <button key={name} onClick={() => onOpenPlayer(name)} className="px-2 py-1 rounded-full text-xs font-semibold" style={{ background: PANEL2, color: CHALK }}>{name}</button>
                      ))}
                    </div>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ==================================================================== */
/* Odds view (bracket, magic/elim numbers, sim, h2h odds)                */
/* ==================================================================== */
const FUTURES_CATEGORY_META = {
  finish: { icon: Layers, label: 'Standings', color: PRIMARY },
  playoffs: { icon: AwardIcon, label: 'Playoffs', color: PRIMARY },
  champion: { icon: Crown, label: 'Championship', color: GOLD },
  streak: { icon: Activity, label: 'Streak Watch', color: NEGATIVE },
  nextgame: { icon: Calendar, label: 'Next Game', color: PRIMARY },
  sweep: { icon: Sparkles, label: 'Season Series', color: PRIMARY },
  headtohead: { icon: Users, label: 'Head-to-Head', color: PRIMARY },
};
function futuresConfidenceLabel(pct) {
  const d = Math.abs(pct - 50);
  if (d < 5) return 'Coin flip';
  if (d < 15) return 'Slight lean';
  if (d < 25) return 'Lean';
  return 'Strong lean';
}
// Per-visitor local override for odds display format — never written to the
// shared backend, just this browser's localStorage. Falls back to whatever
// the admin set as the season default.
function useLocalOddsFormat(adminDefault) {
  const [override, setOverrideState] = useState(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('lt-odds-format');
      if (saved === 'percent' || saved === 'american') setOverrideState(saved);
    } catch (e) { /* localStorage unavailable */ }
  }, []);
  const setOverride = useCallback((fmt) => {
    setOverrideState(fmt);
    try { if (fmt) localStorage.setItem('lt-odds-format', fmt); else localStorage.removeItem('lt-odds-format'); } catch (e) { /* ignore */ }
  }, []);
  return [override || adminDefault, setOverride];
}
function FutureCard({ f, oddsFormat, decimals }) {
  const meta = FUTURES_CATEGORY_META[f.category] || { icon: Percent, label: 'Futures', color: PRIMARY };
  const Icon = meta.icon;
  return (
    <div className="rounded-xl p-3.5" style={{ background: PANEL2, border: `1px solid ${LINE}` }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Icon size={12} style={{ color: meta.color }} />
          <span className="text-[10px] uppercase font-bold tracking-wide" style={{ color: meta.color }}>{meta.label}</span>
        </div>
        <span className="text-[10px]" style={{ color: CHALK_DIM }}>{futuresConfidenceLabel(f.pct)}</span>
      </div>
      <p className="text-sm mb-3 leading-snug" style={{ color: CHALK }}>{f.text}</p>
      <div className="flex items-center gap-3">
        <div className="flex-1 rounded-full overflow-hidden" style={{ background: LINE, height: 6 }}>
          <div style={{ width: `${f.pct}%`, height: '100%', background: f.pct >= 50 ? WIN : GOLD, borderRadius: 999 }} />
        </div>
        <span className="font-mono text-sm font-bold flex-shrink-0" style={{ color: f.pct >= 50 ? WIN : GOLD, minWidth: 40, textAlign: 'right' }}>{f.pct.toFixed(0)}%</span>
        <span className="font-mono text-xs flex-shrink-0" style={{ color: CHALK_DIM, minWidth: 46, textAlign: 'right' }}>{toAmericanOdds(f.pct)}</span>
      </div>
    </div>
  );
}

function FuturesPanel({ season, standings, teamsById, settings, h2hMatrix }) {
  const [pool, setPool] = useState(null);
  const [computing, setComputing] = useState(false);
  const [nonce, setNonce] = useState(0);
  const rounds = useMemo(() => getOrderedRounds(season), [season]);
  const roundIdx = useMemo(() => currentRoundIndex(rounds), [rounds]);
  const roundLabel = rounds[roundIdx] ? rounds[roundIdx].label : 'preseason';
  const playedCount = (season.games || []).filter(g => g.played).length;

  useEffect(() => {
    setComputing(true);
    const t = setTimeout(() => {
      const seasonSimRaw = standings.length >= 2 ? runSimulation(season, teamsById, 300, settings.playoffSpots, h2hMatrix) : null;
      const playInWinnerId = getPlayInWinner((season.games || []).filter(g => g.isPlayIn));
      const seededStandings = buildMainBracketSeeds(standings, settings, playInWinnerId);
      const playoffSimRaw = standings.length >= 2 ? simulatePlayoffs(seededStandings, settings.playoffSpots, settings, h2hMatrix, 300, settings.homeFieldBoost || 0, (season.games || []).filter(g => g.isPlayoff)) : null;
      setPool(computeFuturesPool(season, standings, settings, seasonSimRaw, playoffSimRaw, h2hMatrix));
      setComputing(false);
    }, 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season.id, playedCount, roundLabel]);
  useEffect(() => { setNonce(0); }, [roundLabel, season.id]);

  const selected = pool ? selectRoundFutures(pool, season.id, roundLabel, 5, nonce, 2) : [];
  const [oddsFormat] = useLocalOddsFormat(settings.oddsFormat || 'percent');
  const decimals = settings.oddsDecimals ?? 1;

  return (
    <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
      <SectionTitle accent={PRIMARY} right={
        computing ? <span className="text-[11px]" style={{ color: CHALK_DIM }}>Computing…</span> :
          <button onClick={() => setNonce(n => n + 1)} className="text-[11px] font-bold flex items-center gap-1" style={{ color: PRIMARY }}><RefreshCw size={12} /> Regenerate</button>
      }>Futures board</SectionTitle>
      <p className="px-4 pb-3 text-xs" style={{ color: CHALK_DIM }}>A fresh line-up of odds-based questions each round, all kept between {FUTURES_MIN_PCT}-{FUTURES_MAX_PCT}% so they're genuine toss-ups. Recomputes automatically as games get played and the round advances, or tap Regenerate for a different set right now.</p>
      <div className="px-3 pb-3 space-y-2.5">
        {!pool && <p className="px-2 py-4 text-sm" style={{ color: CHALK_DIM }}>Computing this round's futures…</p>}
        {pool && selected.length === 0 && <p className="px-2 py-4 text-sm" style={{ color: CHALK_DIM }}>Not enough close races yet for meaningful futures — check back after a few more games.</p>}
        {selected.map(f => <FutureCard key={f.id} f={f} oddsFormat={oddsFormat} decimals={decimals} />)}
      </div>
    </Panel>
  );
}

function OddsView({ season, teamsById, standings, settings, onOpenTeam, h2hMatrix, onStartPlayoffs, onClearPlayoffs, onStartPlayIn, onClearPlayIn, onOpenCompare, onBackfillOdds }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageSeasons');
  // Odds no longer simulate live on every visit — they're computed once by
  // the admin actions that actually change a result (saveScore,
  // declareForfeit, setWinnerOverride) and cached on season.oddsCache, so
  // every viewer just reads that same snapshot instead of each burning CPU
  // on their own copy of the same simulation. The one exception is an
  // older/legacy season that predates this cache: an admin viewing it
  // triggers a one-time backfill so it gets a cache going forward too.
  const sim = season.oddsCache ? season.oddsCache.sim : null;
  const playoffSim = season.oddsCache ? season.oddsCache.playoffSim : null;
  const decimals = settings.oddsDecimals ?? 1;
  const [oddsFormat, setOddsFormat] = useLocalOddsFormat(settings.oddsFormat || 'percent');
  const remainingRegular = (season.games || []).filter(g => !g.played && !g.isPlayoff && !g.isPlayIn && g.homeTeamId && g.awayTeamId);
  const remainingByTeam = computeRemaining(season);
  const clinchElim = computeClinchElim(standings, settings.playoffSpots, remainingByTeam);
  const playoffGames = (season.games || []).filter(g => g.isPlayoff);
  const playInGames = (season.games || []).filter(g => g.isPlayIn);
  const playInWinnerId = getPlayInWinner(playInGames);
  const seededStandings = buildMainBracketSeeds(standings, settings, playInWinnerId);
  const eliminatedIds = useMemo(() => computeEliminatedTeamIds(playoffGames, settings), [playoffGames, settings]);

  useEffect(() => {
    if (season.oddsCache || !isLoggedIn || !onBackfillOdds) return;
    const t = setTimeout(() => onBackfillOdds(), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season.id, !!season.oddsCache, isLoggedIn]);
  const maxSeed = standings.length;

  // The next unplayed game in each still-undecided playoff series, folded
  // into the same "Upcoming game odds" list as the regular-season games
  // below rather than a separate panel — only the earliest unplayed game
  // per series/slot, not every queued game in a Bo5/Bo7.
  const nextPlayoffGames = useMemo(() => {
    const bySlot = new Map();
    playoffGames.filter(g => !g.played && g.homeTeamId && g.awayTeamId).forEach(g => {
      const key = `${g.playoffRound}-${g.bracketSlot}`;
      const existing = bySlot.get(key);
      if (!existing || (g.seriesGame || 0) < (existing.seriesGame || 0)) bySlot.set(key, g);
    });
    return [...bySlot.values()];
  }, [playoffGames]);
  const remaining = [...remainingRegular, ...nextPlayoffGames];

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-end gap-2">
        <span className="text-[11px]" style={{ color: CHALK_DIM }}>Odds view (just for you):</span>
        <div className="flex rounded overflow-hidden border" style={{ borderColor: LINE }}>
          {['percent', 'american'].map(m => (
            <button key={m} onClick={() => setOddsFormat(m)} className="px-2.5 py-1 text-xs font-semibold capitalize" style={{ background: oddsFormat === m ? PRIMARY : 'transparent', color: oddsFormat === m ? INK : CHALK_DIM }}>{m}</button>
          ))}
        </div>
      </div>
      <PlayInBracket standings={standings} settings={settings} playInGames={playInGames} teamsById={teamsById} onStart={onStartPlayIn} onClear={onClearPlayIn} onOpenTeam={onOpenTeam} onOpenCompare={onOpenCompare} />
      <BracketView standings={seededStandings} settings={settings} playoffGames={playoffGames} teamsById={teamsById} onStart={onStartPlayoffs} onClear={onClearPlayoffs} onOpenTeam={onOpenTeam} h2hMatrix={h2hMatrix} onOpenCompare={onOpenCompare} />
      {isLoggedIn && <FuturesPanel season={season} standings={standings} teamsById={teamsById} settings={settings} h2hMatrix={h2hMatrix} />}

      <Panel>
        <SectionTitle>Playoff series odds</SectionTitle>
        {!playoffSim ? (
          <p className="px-4 pb-3 text-sm" style={{ color: CHALK_DIM }}>{season.oddsCache ? 'Not enough teams yet to simulate a bracket.' : 'Odds haven’t been computed for this season yet — they’ll generate the next time a score is entered.'}</p>
        ) : (
          <div className="overflow-x-auto px-2 pb-3">
            <table className="text-sm" style={{ color: CHALK, minWidth: '100%' }}>
              <thead><tr className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>
                <th className="text-left px-2 py-1">Team</th>
                {Array.from({ length: playoffSim.roundsCount - 1 }).map((_, i) => <th key={i} className="px-2 py-1">Rd {i + 2} <span style={{ textTransform: 'none' }}>(Bo{getSeriesLength(settings, i + 2)})</span></th>)}
                <th className="px-2 py-1">Champion <span style={{ textTransform: 'none' }}>(Bo{getSeriesLength(settings, playoffSim.roundsCount)})</span></th>
              </tr></thead>
              <tbody>
                {standings.slice(0, Math.min(settings.playoffSpots, standings.length)).filter(t => !eliminatedIds.has(t.id)).map(t => {
                  const r = playoffSim.results[t.id];
                  if (!r) return null;
                  return (
                    <tr key={t.id} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td className="px-2 py-1.5 font-semibold whitespace-nowrap" style={{ borderLeft: `3px solid ${teamColor(t)}` }}><button onClick={() => onOpenTeam(t.id)} className="flex items-center gap-2 pl-1.5" style={{ color: CHALK }}><TeamMark team={t} size={16} /> {t.displayName}</button></td>
                      {Array.from({ length: playoffSim.roundsCount - 1 }).map((_, i) => {
                        const p = r.reachPct[i + 2] || 0;
                        return <td key={i} className="px-2 py-1.5 text-center font-mono text-xs" style={{ color: p >= 50 ? WIN : p > 0 ? CHALK : CHALK_DIM }}>{fmtOdds(p, oddsFormat, decimals)}</td>;
                      })}
                      <td className="px-2 py-1.5 text-center font-mono text-xs font-bold" style={{ color: r.championPct >= 25 ? GOLD : CHALK }}>{fmtOdds(r.championPct, oddsFormat, decimals)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {playoffSim && <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>"Rd N" is the chance of reaching that round; Champion is the chance of winning it all. Based on {settings.simRuns.toLocaleString()} simulated brackets. Teams already eliminated from the bracket are dropped from this table.</p>}
      </Panel>

      <Panel>
        <SectionTitle>Magic &amp; elimination numbers</SectionTitle>
        <div className="overflow-x-auto px-2 pb-3">
          <table className="text-sm" style={{ color: CHALK }}>
            <thead><tr className="text-[10px] uppercase" style={{ color: CHALK_DIM }}><th className="text-left px-2 py-1">Team</th><th className="px-2 py-1">Status</th><th className="px-2 py-1">Number</th></tr></thead>
            <tbody>
              {standings.map(t => {
                const ce = clinchElim[t.id] || { status: 'alive', number: null };
                return (
                  <tr key={t.id} style={{ borderTop: `1px solid ${LINE}` }}>
                    <td className="px-2 py-1.5 font-semibold whitespace-nowrap" style={{ borderLeft: `3px solid ${teamColor(t)}` }}><button onClick={() => onOpenTeam(t.id)} className="flex items-center gap-2 pl-1.5" style={{ color: CHALK }}><TeamMark team={t} size={16} /> {t.displayName}</button></td>
                    <td className="px-2 py-1.5 text-center text-xs font-bold" style={{ color: ce.status === 'clinched' ? WIN : ce.status === 'eliminated' ? NEGATIVE : CHALK_DIM }}>
                      {ce.status === 'clinched' ? 'Clinched' : ce.status === 'eliminated' ? 'Eliminated' : 'Alive'}
                    </td>
                    <td className="px-2 py-1.5 text-center font-mono">{ce.number != null ? ce.number : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>Approximate, based on remaining games count vs. the bubble teams — not a full combinatorial check.</p>
      </Panel>

      {sim && (
        <Panel>
          <SectionTitle>Odds by finish position</SectionTitle>
          <div className="overflow-x-auto px-2 pb-3">
            <table className="text-sm" style={{ color: CHALK, minWidth: '100%' }}>
              <thead><tr className="text-[10px] uppercase" style={{ color: CHALK_DIM }}><th className="text-left px-2 py-1">Team</th>{Array.from({ length: maxSeed }).map((_, i) => <th key={i} className="px-2 py-1">{i + 1}</th>)}</tr></thead>
              <tbody>
                {standings.map(t => (
                  <tr key={t.id} style={{ borderTop: `1px solid ${LINE}` }}>
                    <td className="px-2 py-1.5 font-semibold whitespace-nowrap" style={{ borderLeft: `3px solid ${teamColor(t)}` }}><button onClick={() => onOpenTeam(t.id)} className="pl-1.5" style={{ color: CHALK }}>{t.displayName}</button></td>
                    {sim[t.id].seedPct.map((p, i) => <td key={i} className="px-2 py-1.5 text-center font-mono text-xs" style={{ color: p >= 50 ? WIN : p > 0 ? CHALK : CHALK_DIM }}>{p > 0 ? fmtOdds(p, oddsFormat, decimals) : '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 pb-3 text-xs" style={{ color: CHALK_DIM }}>Percent chance of finishing in each position, based on {settings.simRuns.toLocaleString()} simulated seasons.</p>
        </Panel>
      )}

      <Panel>
        <SectionTitle>Upcoming game odds</SectionTitle>
        <div className="px-3 pb-3 space-y-3 max-h-[420px] overflow-y-auto">
          {remaining.length === 0 && <p className="px-1 py-4 text-sm" style={{ color: CHALK_DIM }}>No unplayed games on the schedule.</p>}
          {(() => {
            const groups = [];
            const seen = {};
            remaining.forEach(g => {
              const gkey = roundGroupKey(g.date, settings.scheduleMode);
              if (!(gkey in seen)) { seen[gkey] = { key: gkey, label: g.date || 'Unlabeled', games: [] }; groups.push(seen[gkey]); }
              seen[gkey].games.push(g);
            });
            return groups.map(group => (
              <div key={group.key}>
                <div className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: PRIMARY }}>{settings.scheduleMode === 'round' ? formatRoundLabel(group.label) : group.label}</div>
                <div className="space-y-2">
                  {group.games.map(g => {
                    const home = standings.find(t => t.id === g.homeTeamId), away = standings.find(t => t.id === g.awayTeamId);
                    if (!home || !away) return null;
                    const h2h = h2hRecord(h2hMatrix, home.id, away.id);
                    const pHome = winProb(home, away, h2h);
                    const pctHome = pHome * 100, pctAway = 100 - pctHome;
                    const h2hGames = h2h.aWins + h2h.aLosses;
                    return (
                      <div key={g.id} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${g.isPlayoff ? GOLD : LINE}`, background: PANEL2 }}>
                        {g.isPlayoff && <div className="px-3 pt-2 text-[9px] uppercase font-bold tracking-wide" style={{ color: GOLD }}>Playoffs</div>}
                        <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
                          <button onClick={() => onOpenTeam(away.id)} className="flex items-center gap-1.5 min-w-0 flex-1">
                            <TeamMark team={away} size={18} /> <span className="text-sm font-bold truncate" style={{ color: CHALK }}>{away.displayName}</span>
                          </button>
                          <span className="text-[10px] flex-shrink-0" style={{ color: CHALK_DIM }}>@</span>
                          <button onClick={() => onOpenTeam(home.id)} className="flex items-center gap-1.5 min-w-0 flex-1 flex-row-reverse text-right">
                            <TeamMark team={home} size={18} /> <span className="text-sm font-bold truncate" style={{ color: CHALK }}>{home.displayName}</span>
                          </button>
                        </div>
                        <div className="flex h-2 mx-3 rounded overflow-hidden" style={{ background: LINE }}>
                          <div style={{ width: `${pctAway}%`, background: teamColor(away) }} />
                          <div style={{ width: `${pctHome}%`, background: teamColor(home) }} />
                        </div>
                        <div className="flex items-center justify-between px-3 py-2">
                          <span className="font-mono text-sm font-bold" style={{ color: pctAway >= 50 ? WIN : CHALK_DIM }}>{fmtOdds(pctAway, oddsFormat, decimals)}</span>
                          {h2hGames > 0 && <span className="text-[10px] font-mono" style={{ color: CHALK_DIM }}>H2H {h2h.aWins}-{h2h.aLosses}</span>}
                          <span className="font-mono text-sm font-bold" style={{ color: pctHome >= 50 ? WIN : CHALK_DIM }}>{fmtOdds(pctHome, oddsFormat, decimals)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ));
          })()}
        </div>
      </Panel>
    </div>
  );
}

/* ==================================================================== */
/* Extras view                                                           */
/* ==================================================================== */
/* ==================================================================== */
/* Awards                                                                */
/* ==================================================================== */
function AwardsView({ league, season, standings, teamsById, addAwardDef, updateAwardDef, removeAwardDef, addAwardWinner, removeAwardWinnerAt }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageAwards');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [pickerId, setPickerId] = useState(null);
  const [manualName, setManualName] = useState('');
  const awardDefs = league.awardDefs || [];
  const winners = season.awardWinners || {};

  const allPlayers = [];
  season.members.forEach(m => {
    if (m.active === false) return;
    const gt = teamsById[m.teamId];
    (m.roster || []).forEach(p => allPlayers.push({ id: p.id, name: p.name, teamId: m.teamId, teamName: gt ? gt.name : m.scheduleName }));
  });

  return (
    <div className="p-3 space-y-3">
      {isLoggedIn && (
        <Panel>
          <SectionTitle>Create an award</SectionTitle>
          <div className="px-4 pb-3 space-y-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Award name (e.g. MVP)" className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (optional)" className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
            <button onClick={() => { if (name.trim()) { addAwardDef(name.trim(), desc.trim()); setName(''); setDesc(''); } }} className="px-3 py-2 rounded font-bold text-sm flex items-center gap-1" style={{ background: PRIMARY, color: INK }}><Plus size={16} /> Create award</button>
            <p className="text-xs" style={{ color: CHALK_DIM }}>Awards are shared across every season of this league — pick a winner for each one below, per season.</p>
          </div>
        </Panel>
      )}

      {awardDefs.length === 0 && <Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>No awards yet — create one above.</p></Panel>}

      {awardDefs.map(a => {
        const winnerList = normalizeAwardWinners(winners[a.id]).map(w => {
          let label = null;
          if (w.type === 'team') { const t = teamsById[w.teamId]; label = t ? t.name : 'Unknown team'; }
          else if (w.type === 'player') {
            if (w.playerId) { const p = allPlayers.find(pl => pl.id === w.playerId); label = p ? `${p.name} (${p.teamName})` : 'Unknown player'; }
            else if (w.name) { label = `${w.name} (Free agent)`; }
          }
          return { ...w, label };
        });
        return (
          <Panel key={a.id}>
            <SectionTitle right={isLoggedIn && <button onClick={() => removeAwardDef(a.id)} className="p-1 rounded" style={{ color: NEGATIVE }}><Trash2 size={14} /></button>}>{a.name}</SectionTitle>
            <div className="px-4 pb-3 space-y-2">
              {a.description && <p className="text-xs" style={{ color: CHALK_DIM }}>{a.description}</p>}
              {winnerList.length > 0 ? (
                <div className="space-y-1.5">
                  {winnerList.map((w, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'rgba(245,198,75,0.12)' }}>
                      <span className="flex items-center gap-2 text-sm font-bold" style={{ color: GOLD }}><Crown size={15} /> {w.label}</span>
                      {isLoggedIn && <button onClick={() => removeAwardWinnerAt(a.id, i)} className="text-xs" style={{ color: CHALK_DIM }}>Remove</button>}
                    </div>
                  ))}
                </div>
              ) : !isLoggedIn && (
                <span className="text-xs" style={{ color: CHALK_DIM }}>No winner yet</span>
              )}
              {isLoggedIn && (
                <button onClick={() => setPickerId(pickerId === a.id ? null : a.id)} className="text-xs font-semibold px-3 py-1.5 rounded" style={{ background: PANEL2, color: PRIMARY, border: `1px solid ${LINE}` }}>{winnerList.length > 0 ? 'Add co-winner' : 'Pick a winner'}</button>
              )}
              {pickerId === a.id && (
                <div className="space-y-2 pt-2" style={{ borderTop: `1px solid ${LINE}` }}>
                  <div className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>Teams</div>
                  <div className="flex flex-wrap gap-2">
                    {standings.map(t => <button key={t.id} onClick={() => { addAwardWinner(a.id, { type: 'team', teamId: t.id }); setPickerId(null); }} className="text-xs px-2 py-1 rounded" style={{ background: PANEL2, color: CHALK, border: `1px solid ${LINE}` }}>{t.displayName}</button>)}
                  </div>
                  {allPlayers.length > 0 && (
                    <>
                      <div className="text-[10px] uppercase pt-1" style={{ color: CHALK_DIM }}>Players</div>
                      <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                        {allPlayers.map(p => <button key={p.id} onClick={() => { addAwardWinner(a.id, { type: 'player', playerId: p.id, teamId: p.teamId }); setPickerId(null); }} className="text-xs px-2 py-1 rounded" style={{ background: PANEL2, color: CHALK, border: `1px solid ${LINE}` }}>{p.name} <span style={{ color: CHALK_DIM }}>({p.teamName})</span></button>)}
                      </div>
                    </>
                  )}
                  <div className="text-[10px] uppercase pt-1" style={{ color: CHALK_DIM }}>Free agent (not on a current roster)</div>
                  <div className="flex items-center gap-2">
                    <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Type a player name" className="flex-1 bg-[#242424] border rounded px-2 py-1.5 text-xs" style={{ borderColor: LINE, color: CHALK }} />
                    <button onClick={() => { if (manualName.trim()) { addAwardWinner(a.id, { type: 'player', playerId: null, name: manualName.trim(), teamId: null }); setManualName(''); setPickerId(null); } }} disabled={!manualName.trim()} className="text-xs font-semibold px-2 py-1.5 rounded disabled:opacity-40 flex-shrink-0" style={{ background: PANEL2, color: PRIMARY, border: `1px solid ${LINE}` }}>Set winner</button>
                  </div>
                </div>
              )}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

// The league's all-time honor roll — separate from per-season Awards, this
// is for names the league wants remembered for good: legendary players,
// builders, whoever. Free-text so it can honor a person who never touched a
// roster (a commissioner, a streamer) just as easily as a star player.
function HallOfFameView({ league, addHallOfFameEntry, removeHallOfFameEntry, onOpenPlayer }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('manageAwards');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [year, setYear] = useState('');
  const [playerName, setPlayerName] = useState('');
  const entries = [...(league.hallOfFame || [])].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

  return (
    <div className="p-3 space-y-3">
      {canManage && (
        <Panel>
          <SectionTitle>Induct someone into the Hall of Fame</SectionTitle>
          <div className="px-4 pb-3 space-y-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
            <input value={year} onChange={e => setYear(e.target.value)} placeholder="Class / year (e.g. 2025)" className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
            <input value={playerName} onChange={e => setPlayerName(e.target.value)} placeholder="Linked player page name (optional, must match exactly)" className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Why they're being inducted (optional)" rows={2} className="w-full bg-[#242424] border rounded px-3 py-2 text-sm resize-none" style={{ borderColor: LINE, color: CHALK }} />
            <button onClick={() => { if (name.trim()) { addHallOfFameEntry(name.trim(), note, year, playerName); setName(''); setNote(''); setYear(''); setPlayerName(''); } }} disabled={!name.trim()} className="px-3 py-2 rounded font-bold text-sm flex items-center gap-1 disabled:opacity-40" style={{ background: PRIMARY, color: INK }}><Plus size={16} /> Induct</button>
          </div>
        </Panel>
      )}

      {entries.length === 0 && <Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>No Hall of Fame inductees yet.</p></Panel>}

      {entries.length > 0 && (
        <Panel>
          <div className="divide-y" style={{ borderColor: LINE }}>
            {entries.map(e => (
              <div key={e.id} className="px-4 py-3 flex items-start gap-3" style={{ borderColor: LINE }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(245,198,75,0.15)', border: `1.5px solid ${GOLD}` }}>
                  <AwardIcon size={16} style={{ color: GOLD }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {e.playerName ? (
                      <button onClick={() => onOpenPlayer(e.playerName)} className="text-sm font-bold hover:underline" style={{ color: CHALK }}>{e.name}</button>
                    ) : (
                      <span className="text-sm font-bold" style={{ color: CHALK }}>{e.name}</span>
                    )}
                    {e.year && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,198,75,0.12)', color: GOLD }}>Class of {e.year}</span>}
                  </div>
                  {e.note && <p className="text-xs mt-1" style={{ color: CHALK_DIM }}>{e.note}</p>}
                </div>
                {canManage && <button onClick={() => removeHallOfFameEntry(e.id)} className="p-1 rounded flex-shrink-0" style={{ color: NEGATIVE }}><Trash2 size={14} /></button>}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function LeagueInfoView({ league, updateLeagueInfo, addStaffMember, updateStaffMember, removeStaffMember, addLeagueLink, updateLeagueLink, removeLeagueLink, onUpdateConstitution }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageLeagueInfo');
  const info = league.info || {};
  const staff = league.staff || [];
  const links = info.links || [];
  const [descDraft, setDescDraft] = useState(info.description || '');
  useEffect(() => { setDescDraft(info.description || ''); }, [info.description]);
  const [discordDraft, setDiscordDraft] = useState(info.discordUrl || '');
  useEffect(() => { setDiscordDraft(info.discordUrl || ''); }, [info.discordUrl]);
  const [creatorDraft, setCreatorDraft] = useState(info.creatorName || '');
  useEffect(() => { setCreatorDraft(info.creatorName || ''); }, [info.creatorName]);
  const [staffName, setStaffName] = useState('');
  const [staffRole, setStaffRole] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const constitution = league.constitution || null;
  const [showConstitution, setShowConstitution] = useState(false);
  const [showConstitutionHistory, setShowConstitutionHistory] = useState(false);
  const [constitutionDraft, setConstitutionDraft] = useState((constitution && constitution.text) || '');
  useEffect(() => { setConstitutionDraft((constitution && constitution.text) || ''); }, [constitution && constitution.version]);

  return (
    <div className="p-3 space-y-3">
      <Panel>
        <SectionTitle>About the league</SectionTitle>
        <div className="px-4 pb-3">
          {isLoggedIn ? (
            <textarea value={descDraft} onChange={e => setDescDraft(e.target.value)} onBlur={() => updateLeagueInfo({ description: descDraft })} placeholder="A short description of the league…" rows={4} className="w-full bg-[#242424] border rounded px-3 py-2 text-sm resize-none" style={{ borderColor: LINE, color: CHALK }} />
          ) : info.description ? (
            <p className="text-sm whitespace-pre-wrap" style={{ color: CHALK }}>{info.description}</p>
          ) : (
            <p className="text-sm" style={{ color: CHALK_DIM }}>No description yet.</p>
          )}
        </div>
      </Panel>

      <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
        <SectionTitle accent={PRIMARY} right={
          <div className="flex items-center gap-2">
            {constitution && <button onClick={() => setShowConstitutionHistory(v => !v)} className="text-[11px] font-semibold" style={{ color: CHALK_DIM }}>{showConstitutionHistory ? 'Hide history' : `History (v${constitution.version})`}</button>}
            {isLoggedIn && <button onClick={() => setShowConstitution(v => !v)} className="text-[11px] font-semibold" style={{ color: PRIMARY }}>{showConstitution ? 'Close' : 'Edit'}</button>}
          </div>
        }>League constitution</SectionTitle>
        <div className="px-4 pb-3">
          {showConstitution && isLoggedIn ? (
            <div className="space-y-2">
              <textarea value={constitutionDraft} onChange={e => setConstitutionDraft(e.target.value)} placeholder="Rules, format, conduct policy — whatever the league's actual constitution covers…" rows={10} className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
              <button onClick={() => { onUpdateConstitution(constitutionDraft); setShowConstitution(false); }} className="px-3 py-2 rounded font-bold text-sm" style={{ background: PRIMARY, color: INK }}>Save new version</button>
            </div>
          ) : constitution && constitution.text ? (
            <p className="text-sm whitespace-pre-wrap" style={{ color: CHALK }}>{constitution.text}</p>
          ) : (
            <p className="text-sm" style={{ color: CHALK_DIM }}>No constitution on file yet.</p>
          )}
          {showConstitutionHistory && constitution && constitution.history && constitution.history.length > 0 && (
            <div className="mt-3 pt-3 space-y-3" style={{ borderTop: `1px solid ${LINE}` }}>
              {[...constitution.history].reverse().map(h => (
                <div key={h.version}>
                  <div className="text-[10px] uppercase font-bold mb-1" style={{ color: CHALK_DIM }}>v{h.version} · {h.updatedAt ? new Date(h.updatedAt).toLocaleString() : ''}</div>
                  <p className="text-xs whitespace-pre-wrap" style={{ color: CHALK_DIM }}>{h.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel>
        <SectionTitle>League staff</SectionTitle>
        <div className="px-4 pb-2 space-y-2">
          {staff.length === 0 && <p className="text-sm pb-2" style={{ color: CHALK_DIM }}>No staff listed yet.</p>}
          {staff.map(s => (
            <div key={s.id} className="flex items-center gap-2">
              {isLoggedIn ? (
                <>
                  <input defaultValue={s.name} onBlur={e => updateStaffMember(s.id, 'name', e.target.value)} placeholder="Name" className="flex-1 bg-[#242424] border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, color: CHALK }} />
                  <input defaultValue={s.role} onBlur={e => updateStaffMember(s.id, 'role', e.target.value)} placeholder="Role (e.g. Commissioner)" className="flex-1 bg-[#242424] border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, color: CHALK }} />
                  <button onClick={() => removeStaffMember(s.id)} className="p-1 rounded flex-shrink-0" style={{ color: NEGATIVE }}><Trash2 size={14} /></button>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-between px-3 py-2 rounded" style={{ background: PANEL2 }}>
                  <span className="text-sm font-semibold" style={{ color: CHALK }}>{s.name}</span>
                  <span className="text-xs" style={{ color: CHALK_DIM }}>{s.role}</span>
                </div>
              )}
            </div>
          ))}
        </div>
        {isLoggedIn && (
          <div className="px-4 pb-3 flex flex-wrap items-center gap-2 pt-2" style={{ borderTop: `1px solid ${LINE}` }}>
            <input value={staffName} onChange={e => setStaffName(e.target.value)} placeholder="Name" className="flex-1 min-w-[120px] bg-[#242424] border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, color: CHALK }} />
            <input value={staffRole} onChange={e => setStaffRole(e.target.value)} placeholder="Role (e.g. Commissioner)" className="flex-1 min-w-[120px] bg-[#242424] border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, color: CHALK }} />
            <button onClick={() => { if (staffName.trim()) { addStaffMember(staffName.trim(), staffRole.trim()); setStaffName(''); setStaffRole(''); } }} className="px-3 py-1.5 rounded font-bold text-xs flex items-center gap-1 flex-shrink-0" style={{ background: PRIMARY, color: INK }}><Plus size={14} /> Add</button>
          </div>
        )}
      </Panel>

      <Panel>
        <SectionTitle>Links</SectionTitle>
        <div className="px-4 pb-3 space-y-3">
          <div>
            <div className="text-[10px] uppercase mb-1" style={{ color: CHALK_DIM }}>Discord</div>
            {isLoggedIn ? (
              <input value={discordDraft} onChange={e => setDiscordDraft(e.target.value)} onBlur={() => updateLeagueInfo({ discordUrl: discordDraft })} placeholder="https://discord.gg/…" className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
            ) : info.discordUrl ? (
              <a href={info.discordUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-2 rounded font-bold text-sm" style={{ background: PANEL2, color: PRIMARY, border: `1px solid ${LINE}` }}>Join our Discord</a>
            ) : (
              <p className="text-sm" style={{ color: CHALK_DIM }}>No Discord link yet.</p>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase mb-1" style={{ color: CHALK_DIM }}>Site created by</div>
            {isLoggedIn ? (
              <input value={creatorDraft} onChange={e => setCreatorDraft(e.target.value)} onBlur={() => updateLeagueInfo({ creatorName: creatorDraft })} placeholder="Name / handle" className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
            ) : (
              <p className="text-sm" style={{ color: CHALK_DIM }}>{info.creatorName || 'Not listed.'}</p>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase mb-1" style={{ color: CHALK_DIM }}>Other links</div>
            {links.length === 0 && !isLoggedIn && <p className="text-sm" style={{ color: CHALK_DIM }}>No other links yet.</p>}
            {links.length > 0 && (
              <div className={isLoggedIn ? 'space-y-2 mb-2' : 'flex flex-wrap gap-2'}>
                {links.map(l => isLoggedIn ? (
                  <div key={l.id} className="flex items-center gap-2">
                    <input defaultValue={l.label} onBlur={e => updateLeagueLink(l.id, 'label', e.target.value)} placeholder="Label (e.g. Twitter)" className="w-32 flex-shrink-0 bg-[#242424] border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, color: CHALK }} />
                    <input defaultValue={l.url} onBlur={e => updateLeagueLink(l.id, 'url', e.target.value)} placeholder="https://…" className="flex-1 bg-[#242424] border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, color: CHALK }} />
                    <button onClick={() => removeLeagueLink(l.id)} className="p-1 rounded flex-shrink-0" style={{ color: NEGATIVE }}><Trash2 size={14} /></button>
                  </div>
                ) : l.url ? (
                  <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-2 rounded font-bold text-sm" style={{ background: PANEL2, color: PRIMARY, border: `1px solid ${LINE}` }}>{l.label || l.url}</a>
                ) : null)}
              </div>
            )}
            {isLoggedIn && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <input value={linkLabel} onChange={e => setLinkLabel(e.target.value)} placeholder="Label (e.g. Twitter)" className="w-32 flex-shrink-0 bg-[#242424] border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, color: CHALK }} />
                <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://…" className="flex-1 min-w-[140px] bg-[#242424] border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, color: CHALK }} />
                <button onClick={() => { if (linkUrl.trim()) { addLeagueLink(linkLabel.trim(), linkUrl.trim()); setLinkLabel(''); setLinkUrl(''); } }} disabled={!linkUrl.trim()} className="px-3 py-1.5 rounded font-bold text-xs flex items-center gap-1 flex-shrink-0 disabled:opacity-40" style={{ background: PRIMARY, color: INK }}><Plus size={14} /> Add</button>
              </div>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}

// The rank-order builder for a Power Rankings post: move-up/down instead of
// drag-and-drop (works the same on mobile and desktop with no extra
// dependency), one optional blurb per team. Seeded from the most recent
// Power Rankings post's order when one exists, so "previous rank" — and the
// move arrows on the published post — mean something without the admin
// having to type last time's ranks in by hand.
function RankBuilder({ teams, order, setOrder, blurbs, setBlurb }) {
  const move = (idx, dir) => {
    const next = [...order];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setOrder(next);
  };
  return (
    <div className="space-y-1.5">
      {order.map((teamId, i) => {
        const t = teams[teamId] || { id: teamId, name: 'Unknown team' };
        return (
          <div key={teamId} className="flex items-center gap-2 rounded-lg p-2" style={{ background: PANEL2, border: `1px solid ${LINE}` }}>
            <span className="w-5 text-center text-xs font-mono font-bold flex-shrink-0" style={{ color: PRIMARY }}>{i + 1}</span>
            <TeamMark team={t} size={16} />
            <span className="text-xs font-bold flex-shrink-0 w-28 truncate" style={{ color: CHALK }}>{t.name}</span>
            <input value={blurbs[teamId] || ''} onChange={e => setBlurb(teamId, e.target.value)} placeholder="One-line blurb (optional)" className="flex-1 min-w-0 bg-[#1a1a1a] border rounded px-2 py-1 text-xs" style={{ borderColor: LINE, color: CHALK }} />
            <div className="flex flex-col flex-shrink-0">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="disabled:opacity-25" style={{ color: CHALK_DIM }}><ChevronUp size={14} /></button>
              <button onClick={() => move(i, 1)} disabled={i === order.length - 1} className="disabled:opacity-25" style={{ color: CHALK_DIM }}><ChevronDown size={14} /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
// A published Power Rankings post's ranked list — a move arrow compares
// each team's rank to prevRank (captured from the last Power Rankings post
// at the time this one was published), not to whatever the ranks say now.
function PowerRankingsList({ rankings, teamsById, onOpenTeam }) {
  return (
    <div className="space-y-1">
      {rankings.map((r, i) => {
        const t = teamsById[r.teamId] || { id: r.teamId, name: 'Unknown team' };
        const rank = i + 1;
        const delta = r.prevRank != null ? r.prevRank - rank : null;
        return (
          <button key={r.teamId} onClick={() => onOpenTeam && onOpenTeam(r.teamId)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
            <span className="w-5 text-center text-xs font-mono font-bold flex-shrink-0" style={{ color: PRIMARY }}>{rank}</span>
            <TeamMark team={t} size={15} />
            <span className="flex-1 min-w-0 text-xs font-bold truncate" style={{ color: CHALK }}>{t.name}{r.blurb ? <span className="font-normal ml-1.5" style={{ color: CHALK_DIM }}>— {r.blurb}</span> : null}</span>
            {delta != null && delta !== 0 && (
              <span className="text-[10px] font-mono font-bold flex items-center gap-0.5 flex-shrink-0" style={{ color: delta > 0 ? WIN : NEGATIVE }}>
                {delta > 0 ? <ChevronUp size={11} /> : <ChevronDown size={11} />}{Math.abs(delta)}
              </span>
            )}
            {delta === 0 && <span className="text-[10px] font-mono flex-shrink-0" style={{ color: CHALK_DIM }}>—</span>}
          </button>
        );
      })}
    </div>
  );
}
// Drafts a preseason preview post from the previous season's results and
// this season's rosters — a starting point for whoever writes it up, not a
// finished article. Matches "returning" players by name (not id, since a
// fresh season's rosters aren't guaranteed to reuse last season's player
// ids) against last season's leaders. Returns null when there's no prior
// season to preview off of.
function buildSeasonPreviewDraft(league, season, teamsById) {
  const priorSeasons = league.seasons.filter(s => s.id !== season.id && (s.createdAt || 0) < (season.createdAt || 0));
  if (priorSeasons.length === 0) return null;
  const prevSeason = [...priorSeasons].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  const prevStandings = computeStandings(prevSeason, teamsById).active;
  const champion = prevSeason.championTeamId ? teamsById[prevSeason.championTeamId] : null;
  const norm = (s) => (s || '').trim().toLowerCase();
  const currentNames = new Set();
  (season.members || []).forEach(m => (m.roster || []).forEach(p => currentNames.add(norm(p.name))));
  const prevLeaders = computeSeasonPlayerLeaders(prevSeason, teamsById, 'regular');
  const returning = prevLeaders.filter(p => currentNames.has(norm(p.name)) && p.totals.ab >= 10).sort((a, b) => b.war - a.war).slice(0, 3);
  const prevTeamKeys = new Set(prevSeason.members.map(pm => normalizeTeamName((teamsById[pm.teamId] && teamsById[pm.teamId].name) || pm.scheduleName)));
  const newTeamNames = season.members.map(m => (teamsById[m.teamId] && teamsById[m.teamId].name) || m.scheduleName).filter(name => !prevTeamKeys.has(normalizeTeamName(name)));

  const lines = [];
  if (champion) lines.push(`Coming off a championship season, ${champion.name} enters ${season.name} as the team to beat.`);
  if (prevStandings.length > 0) {
    lines.push('', `Final ${prevSeason.name} standings:`);
    prevStandings.slice(0, 5).forEach((t, i) => lines.push(`${i + 1}. ${t.displayName} (${t.w}-${t.l})`));
  }
  if (returning.length > 0) {
    lines.push('', 'Players to watch:');
    returning.forEach(p => {
      const t = teamsById[p.teamId];
      lines.push(`- ${p.name}${t ? ` (${t.name})` : ''} — ${p.totals.h}-for-${p.totals.ab}, ${p.totals.hr} HR, ${p.totals.rbi} RBI last season`);
    });
  }
  if (newTeamNames.length > 0) lines.push('', `New for ${season.name}: ${newTeamNames.join(', ')}.`);
  return { title: `${season.name} Preview`, body: lines.join('\n') };
}
// Finds the top WAR performer over a recent window (the last 7 calendar
// days when the schedule uses real dates, otherwise the most recent couple
// of labeled rounds, since round numbers don't carry a fixed cadence) — a
// suggestion for the admin to confirm and publish, not an automatic post.
function buildPlayerOfWeekDraft(season, teamsById) {
  const scheduleMode = (season.settings && season.settings.scheduleMode) || 'date';
  const allPlayed = sortGamesChronologically((season.games || []).filter(g => g.played && !g.isBye && !g.isSpringTraining), scheduleMode);
  if (allPlayed.length === 0) return null;
  let recentGames = [];
  if (scheduleMode !== 'round') {
    const lastDate = Date.parse(allPlayed[allPlayed.length - 1].date);
    if (!isNaN(lastDate)) {
      const cutoff = lastDate - 7 * 24 * 60 * 60 * 1000;
      recentGames = allPlayed.filter(g => { const t = Date.parse(g.date); return !isNaN(t) && t >= cutoff; });
    }
  }
  if (recentGames.length === 0) {
    const labelsInOrder = [...new Set(allPlayed.map(g => g.date))];
    const recentLabels = new Set(labelsInOrder.slice(-2));
    recentGames = allPlayed.filter(g => recentLabels.has(g.date));
  }
  const meta = new Map();
  (season.members || []).forEach(m => (m.roster || []).forEach(p => meta.set(p.id, { name: p.name, teamId: m.teamId })));
  const byPlayer = new Map();
  recentGames.forEach(g => {
    ['home', 'away'].forEach(side => {
      ((g.playerStats && g.playerStats[side]) || []).forEach(row => {
        if (!meta.has(row.playerId)) return;
        const rows = byPlayer.get(row.playerId) || [];
        rows.push(normalizeStatRow(row, {}));
        byPlayer.set(row.playerId, rows);
      });
    });
  });
  if (byPlayer.size === 0) return null;
  const candidates = [...byPlayer.entries()].map(([playerId, rows]) => {
    const totals = sumPlayerTotals(rows);
    return { playerId, ...meta.get(playerId), totals, batting: computeBattingAdvanced(totals), pitching: computePitchingAdvanced(totals) };
  });
  const leagueOuts = candidates.reduce((s, p) => s + p.totals.outs, 0);
  const leagueER = candidates.reduce((s, p) => s + p.totals.er, 0);
  const leagueERA = leagueOuts > 0 ? (leagueER * 27) / leagueOuts : 4.5;
  candidates.forEach(p => { p.war = computePlayerWAR(p.totals, leagueERA); });
  candidates.sort((a, b) => b.war - a.war);
  const top = candidates[0];
  const t = teamsById[top.teamId];
  const parts = [];
  if (top.totals.ab > 0) parts.push(`${top.totals.h}-for-${top.totals.ab} (${top.batting.avg.toFixed(3).replace(/^0/, '')}), ${top.totals.hr} HR, ${top.totals.rbi} RBI`);
  if (top.totals.outs > 0) parts.push(`${top.pitching.ip.toFixed(1)} IP, ${top.pitching.era.toFixed(2)} ERA, ${top.totals.k} K`);
  return {
    title: `Player of the Week: ${top.name}`,
    body: `${top.name}${t ? ` (${t.name})` : ''} takes Player of the Week honors: ${parts.join('; ')}.`,
  };
}
// Pre-fills the article composer from the last 7 days of played games (by
// the most recent game date in the season, not real-world "today" — a
// league playing through old data shouldn't get an empty recap) — scores
// plus the week's top batter/pitcher, reusing computeSeasonPlayerLeaders
// against just that week's games instead of a separate aggregation.
function draftWeeklyRecap(season, teamsById) {
  const played = (season.games || []).filter(g => g.played && !g.isBye && !g.isSpringTraining && g.date && g.homeTeamId && g.awayTeamId);
  if (played.length === 0) return null;
  const maxDate = played.reduce((m, g) => g.date > m ? g.date : m, played[0].date);
  const windowStartStr = new Date(new Date(maxDate).getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const weekGames = played.filter(g => g.date >= windowStartStr && g.date <= maxDate).sort((a, b) => a.date.localeCompare(b.date));
  if (weekGames.length === 0) return null;
  const nameFor = (id, fb) => (teamsById[id] && teamsById[id].name) || fb || 'Unknown';
  const scoreLines = weekGames.map(g => `${nameFor(g.awayTeamId, g.awayScheduleName)} ${g.awayScore} @ ${nameFor(g.homeTeamId, g.homeScheduleName)} ${g.homeScore}`);
  const weekLeaders = computeSeasonPlayerLeaders({ ...season, games: weekGames }, teamsById, 'regular');
  const topBatter = weekLeaders.filter(p => p.totals.ab >= 1).sort((a, b) => b.batting.ops - a.batting.ops)[0] || null;
  const topPitcher = weekLeaders.filter(p => p.totals.outs >= 1).sort((a, b) => a.pitching.era - b.pitching.era)[0] || null;
  const lines = [`Scores from ${windowStartStr} to ${maxDate}:`, '', ...scoreLines, ''];
  if (topBatter) lines.push(`Top performer at the plate: ${topBatter.name} — ${fmtStatRate(topBatter.batting.ops)} OPS, ${topBatter.totals.hr} HR, ${topBatter.totals.rbi} RBI.`);
  if (topPitcher) lines.push(`Top arm: ${topPitcher.name} — ${topPitcher.pitching.era.toFixed(2)} ERA, ${topPitcher.totals.k} K.`);
  return { title: `Weekly Recap: ${windowStartStr} – ${maxDate}`, body: lines.join('\n') };
}

function NewsView({ league, season, teamsById, addNewsPost, updateNewsPost, removeNewsPost, onOpenTeam }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageNews');
  const news = league.news || [];
  const [postType, setPostType] = useState('article'); // 'article' | 'rankings'
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [author, setAuthor] = useState('');
  const [imageUrl, setImageUrl] = useState(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [editImageUrl, setEditImageUrl] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const seasonTeamIds = (season && season.members || []).map(m => m.teamId);
  const lastRankings = news.find(n => n.rankings && n.rankings.length > 0);
  const initialOrder = () => {
    if (lastRankings) {
      const known = lastRankings.rankings.map(r => r.teamId).filter(id => seasonTeamIds.includes(id));
      const missing = seasonTeamIds.filter(id => !known.includes(id));
      return [...known, ...missing];
    }
    return seasonTeamIds;
  };
  const [rankOrder, setRankOrder] = useState(initialOrder);
  const [rankBlurbs, setRankBlurbs] = useState({});
  const setBlurb = (teamId, v) => setRankBlurbs(b => ({ ...b, [teamId]: v }));
  const openRankBuilder = () => { setPostType('rankings'); setRankOrder(initialOrder()); };

  const handleImageFile = async (file, setUrl) => {
    if (!file) return;
    setImageBusy(true);
    try {
      const dataUrl = await resizeImageFile(file, 640);
      if (dataUrl.length > 1_500_000) alert('That image is too large even after resizing — try a smaller file.');
      else setUrl(dataUrl);
    } catch (e) { alert('Could not read that image file.'); }
    setImageBusy(false);
  };

  const publish = () => {
    if (!title.trim()) return;
    if (postType === 'rankings') {
      const prevByTeam = new Map((lastRankings ? lastRankings.rankings : []).map((r, i) => [r.teamId, i + 1]));
      const rankings = rankOrder.map(teamId => ({ teamId, blurb: (rankBlurbs[teamId] || '').trim(), prevRank: prevByTeam.has(teamId) ? prevByTeam.get(teamId) : null }));
      addNewsPost(title.trim(), body.trim(), { author: author.trim(), imageUrl, rankings });
    } else {
      addNewsPost(title.trim(), body.trim(), { author: author.trim(), imageUrl });
    }
    setTitle(''); setBody(''); setAuthor(''); setImageUrl(null); setRankBlurbs({}); setPostType('article');
  };

  return (
    <div className="p-3 space-y-3">
      {isLoggedIn && (
        <Panel>
          <SectionTitle right={
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: LINE }}>
              <button onClick={() => setPostType('article')} className="px-2.5 py-1 text-[11px] font-bold" style={{ background: postType === 'article' ? PRIMARY : 'transparent', color: postType === 'article' ? INK : CHALK_DIM }}>Article</button>
              <button onClick={openRankBuilder} className="px-2.5 py-1 text-[11px] font-bold" style={{ background: postType === 'rankings' ? GOLD : 'transparent', color: postType === 'rankings' ? INK : CHALK_DIM }}>Power Rankings</button>
            </div>
          }>Post news</SectionTitle>
          <div className="px-4 pb-3 space-y-2">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder={postType === 'rankings' ? 'e.g. Week 6 Power Rankings' : 'Headline'} className="w-full bg-[#242424] border rounded px-3 py-2 text-sm font-bold" style={{ borderColor: LINE, color: CHALK }} />
            {postType === 'article' && season && (
              <button onClick={() => { const draft = draftWeeklyRecap(season, teamsById); if (draft) { setTitle(draft.title); setBody(draft.body); } else alert('Not enough recent scores to draft a recap yet.'); }} className="text-xs font-bold flex items-center gap-1.5 px-2.5 py-1.5 rounded" style={{ background: PANEL2, color: PRIMARY }}>
                <Sparkles size={13} /> Auto-draft weekly recap
              </button>
            )}
            {postType === 'rankings' ? (
              seasonTeamIds.length === 0 ? (
                <p className="text-xs" style={{ color: CHALK_DIM }}>No teams in this season yet — add some in the Teams tab first.</p>
              ) : (
                <>
                  <p className="text-xs" style={{ color: CHALK_DIM }}>Reorder with the arrows{lastRankings ? " — seeded from last time's ranks, so move arrows on the published post mean something" : ''}.</p>
                  <RankBuilder teams={teamsById} order={rankOrder} setOrder={setRankOrder} blurbs={rankBlurbs} setBlurb={setBlurb} />
                  <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Intro blurb (optional, shown above the rankings)…" rows={2} className="w-full bg-[#242424] border rounded px-3 py-2 text-sm resize-none" style={{ borderColor: LINE, color: CHALK }} />
                </>
              )
            ) : (
              <>
                <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Story…" rows={4} className="w-full bg-[#242424] border rounded px-3 py-2 text-sm resize-none" style={{ borderColor: LINE, color: CHALK }} />
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => { const draft = buildSeasonPreviewDraft(league, season, teamsById); if (draft) { setTitle(draft.title); setBody(draft.body); } else alert('No prior season to preview off of yet.'); }} className="text-[11px] font-semibold px-2.5 py-1.5 rounded" style={{ background: PANEL2, color: PRIMARY, border: `1px solid ${LINE}` }}>Generate season preview</button>
                  <button onClick={() => { const draft = buildPlayerOfWeekDraft(season, teamsById); if (draft) { setTitle(draft.title); setBody(draft.body); } else alert('Not enough recent stats to suggest one yet.'); }} className="text-[11px] font-semibold px-2.5 py-1.5 rounded" style={{ background: PANEL2, color: GOLD, border: `1px solid ${LINE}` }}>Suggest Player of the Week</button>
                </div>
                <p className="text-[11px]" style={{ color: CHALK_DIM }}>Both fill in a draft below for you to edit before publishing — nothing posts automatically.</p>
              </>
            )}
            <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="Writer credit (optional)" className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
            <div className="flex items-center gap-2">
              {imageUrl && <img src={imageUrl} alt="" className="w-16 h-16 object-cover rounded" style={{ border: `1px solid ${LINE}` }} />}
              <label className="text-[11px] px-3 py-2 rounded cursor-pointer font-semibold" style={{ background: PANEL2, color: PRIMARY, border: `1px solid ${LINE}` }}>
                {imageBusy ? 'Uploading…' : imageUrl ? 'Change thumbnail' : 'Add thumbnail'}
                <input type="file" accept="image/*" className="hidden" onChange={e => handleImageFile(e.target.files[0], setImageUrl)} />
              </label>
              {imageUrl && <button onClick={() => setImageUrl(null)} className="text-[11px]" style={{ color: CHALK_DIM }}>Remove</button>}
            </div>
            <button onClick={publish} disabled={postType === 'rankings' && rankOrder.length === 0} className="px-3 py-2 rounded font-bold text-sm flex items-center gap-1 disabled:opacity-40" style={{ background: PRIMARY, color: INK }}><Plus size={16} /> Publish</button>
          </div>
        </Panel>
      )}

      {news.length === 0 && <Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>No news posted yet.</p></Panel>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {news.map(n => {
          if (editingId === n.id) {
            return (
              <Panel key={n.id} className="sm:col-span-2 lg:col-span-3">
                <div className="p-4 space-y-2">
                  <input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="w-full bg-[#242424] border rounded px-3 py-2 text-sm font-bold" style={{ borderColor: LINE, color: CHALK }} />
                  <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={4} className="w-full bg-[#242424] border rounded px-3 py-2 text-sm resize-none" style={{ borderColor: LINE, color: CHALK }} />
                  <input value={editAuthor} onChange={e => setEditAuthor(e.target.value)} placeholder="Writer credit (optional)" className="w-full bg-[#242424] border rounded px-3 py-2 text-sm" style={{ borderColor: LINE, color: CHALK }} />
                  <div className="flex items-center gap-2">
                    {editImageUrl && <img src={editImageUrl} alt="" className="w-16 h-16 object-cover rounded" style={{ border: `1px solid ${LINE}` }} />}
                    <label className="text-[11px] px-3 py-2 rounded cursor-pointer font-semibold" style={{ background: PANEL2, color: PRIMARY, border: `1px solid ${LINE}` }}>
                      {imageBusy ? 'Uploading…' : editImageUrl ? 'Change thumbnail' : 'Add thumbnail'}
                      <input type="file" accept="image/*" className="hidden" onChange={e => handleImageFile(e.target.files[0], setEditImageUrl)} />
                    </label>
                    {editImageUrl && <button onClick={() => setEditImageUrl(null)} className="text-[11px]" style={{ color: CHALK_DIM }}>Remove</button>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { updateNewsPost(n.id, { title: editTitle, body: editBody, author: editAuthor, imageUrl: editImageUrl }); setEditingId(null); }} className="px-3 py-1.5 rounded font-bold text-xs" style={{ background: PRIMARY, color: INK }}>Save</button>
                    <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded text-xs" style={{ color: CHALK_DIM }}>Cancel</button>
                  </div>
                </div>
              </Panel>
            );
          }
          const isExpanded = expandedId === n.id;
          const excerpt = n.body && n.body.length > 140 ? `${n.body.slice(0, 140)}…` : n.body;
          const isRankings = n.rankings && n.rankings.length > 0;
          return (
            <Panel key={n.id} className={`flex flex-col ${isRankings ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
              {n.imageUrl ? (
                <img src={n.imageUrl} alt="" className="w-full object-cover aspect-video" />
              ) : !isRankings ? (
                <div className="w-full aspect-video flex items-center justify-center" style={{ background: PANEL2 }}><Newspaper size={28} style={{ color: CHALK_DIM }} /></div>
              ) : null}
              <div className="p-3 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-head text-base font-semibold leading-snug flex-1 flex items-center gap-2" style={{ color: CHALK }}>
                    {n.title}
                    {isRankings && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: `${GOLD}22`, color: GOLD }}>Power Rankings</span>}
                  </h3>
                  {isLoggedIn && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => { setEditingId(n.id); setEditTitle(n.title); setEditBody(n.body); setEditAuthor(n.author || ''); setEditImageUrl(n.imageUrl || null); }} className="p-1 rounded" style={{ color: PRIMARY }}><Pencil size={13} /></button>
                      <button onClick={() => removeNewsPost(n.id)} className="p-1 rounded" style={{ color: NEGATIVE }}><Trash2 size={13} /></button>
                    </div>
                  )}
                </div>
                <div className="text-[10px] uppercase mt-1 mb-2" style={{ color: CHALK_DIM }}>
                  {new Date(n.at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}{n.author ? ` · By ${n.author}` : ''}
                </div>
                {isRankings && n.body && (
                  <p className="text-sm whitespace-pre-wrap mb-2" style={{ color: CHALK_DIM }}>{n.body}</p>
                )}
                {isRankings ? (
                  <PowerRankingsList rankings={n.rankings} teamsById={teamsById} onOpenTeam={onOpenTeam} />
                ) : n.body && (
                  <>
                    <p className="text-sm whitespace-pre-wrap flex-1" style={{ color: CHALK_DIM }}>{isExpanded ? n.body : excerpt}</p>
                    {n.body.length > 140 && (
                      <button onClick={() => setExpandedId(isExpanded ? null : n.id)} className="text-xs font-bold mt-2 self-start" style={{ color: PRIMARY }}>{isExpanded ? 'Show less' : 'Read more'}</button>
                    )}
                  </>
                )}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

function ExtrasView({ extras, teamsById, leagueRecords, activityLog, season, standings, onRemoveActivity, onOpenTeam, onOpenPlayer }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageSeasons');
  const consistency = useMemo(() => season ? computeTeamConsistency(season, teamsById) : [], [season, teamsById]);
  const workload = useMemo(() => season ? computePitcherWorkload(season, teamsById) : [], [season, teamsById]);
  const draftGrades = useMemo(() => season ? computeDraftClassGrades(season, teamsById) : [], [season, teamsById]);
  const draftValue = useMemo(() => season ? computeDraftValueBoard(season, teamsById) : [], [season, teamsById]);
  if (!extras) return <div className="p-3 space-y-3"><Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>Enter some scores to unlock fun stats here.</p></Panel></div>;
  const GameCard = ({ label, g, note }) => {
    if (!g) return null;
    const away = teamsById[g.awayTeamId], home = teamsById[g.homeTeamId];
    return (
      <div className="px-4 py-3" style={{ borderBottom: `1px solid ${LINE}`, borderLeft: `3px solid ${away ? teamColor(away) : LINE}`, borderRight: `3px solid ${home ? teamColor(home) : LINE}` }}>
        <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: PRIMARY }}>{label}</div>
        <div className="text-sm flex items-center gap-1.5" style={{ color: CHALK }}>{away && <TeamMark team={away} size={13} />}{g.awayName} <span className="font-mono">{g.awayScore}</span> @ {g.homeName} <span className="font-mono">{g.homeScore}</span>{home && <TeamMark team={home} size={13} />}</div>
        <div className="text-xs mt-0.5" style={{ color: CHALK_DIM }}>{g.date ? `${g.date} · ` : ''}{note}</div>
      </div>
    );
  };
  let movers = [];
  if (season) {
    const rounds = getOrderedRounds(season);
    if (rounds.length >= 2) {
      const firstRanked = computeStandingsThroughRound(season, teamsById, rounds, 0).active;
      const currentRanked = computeStandings(season, teamsById).active;
      const firstRankById = {};
      firstRanked.forEach(t => { firstRankById[t.id] = t.rank; });
      movers = currentRanked.filter(t => firstRankById[t.id] != null).map(t => ({ id: t.id, name: t.displayName, delta: firstRankById[t.id] - t.rank, from: firstRankById[t.id], to: t.rank }))
        .filter(m => m.delta !== 0).sort((a, b) => b.delta - a.delta);
    }
  }
  const biggestRiser = movers.length ? movers[0] : null;
  const biggestFaller = movers.length ? movers[movers.length - 1] : null;
  const hasNotable = extras.highest || extras.lowest || extras.longest || extras.shortest || extras.biggestBlowout || extras.highestSingleTeamScore;
  return (
    <div className="p-3 space-y-3">
      {(biggestRiser && biggestRiser.delta > 0) || (biggestFaller && biggestFaller.delta < 0) ? (
        <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
          <SectionTitle accent={GOLD}>Biggest movers</SectionTitle>
          <div className="px-2 pb-2">
            {biggestRiser && biggestRiser.delta > 0 && (
              <div className="flex items-center gap-2 px-2 py-2 text-sm" style={{ borderTop: `1px solid ${LINE}` }}>
                <span style={{ color: WIN }}>▲</span>
                <span className="flex-1" style={{ color: CHALK }}>{biggestRiser.name}</span>
                <span className="font-mono text-xs" style={{ color: CHALK_DIM }}>#{biggestRiser.from} → #{biggestRiser.to}</span>
              </div>
            )}
            {biggestFaller && biggestFaller.delta < 0 && biggestFaller.id !== biggestRiser?.id && (
              <div className="flex items-center gap-2 px-2 py-2 text-sm" style={{ borderTop: `1px solid ${LINE}` }}>
                <span style={{ color: NEGATIVE }}>▼</span>
                <span className="flex-1" style={{ color: CHALK }}>{biggestFaller.name}</span>
                <span className="font-mono text-xs" style={{ color: CHALK_DIM }}>#{biggestFaller.from} → #{biggestFaller.to}</span>
              </div>
            )}
          </div>
          <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>Standings position from the first round of the season to now.</p>
        </Panel>
      ) : null}
      {hasNotable && (
        <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
          <SectionTitle accent={GOLD}>Notable games</SectionTitle>
          <div>
            {extras.highest && <GameCard label="Highest scoring" g={extras.highest} note={`${extras.highest.total} combined runs`} />}
            {extras.lowest && <GameCard label="Lowest scoring" g={extras.lowest} note={`${extras.lowest.total} combined runs`} />}
            {extras.longest && <GameCard label="Longest game" g={extras.longest} note={`${extras.longest.innings || '—'} innings`} />}
            {extras.shortest && <GameCard label="Shortest game" g={extras.shortest} note={`${extras.shortest.innings || '—'} innings`} />}
            {extras.biggestBlowout && <GameCard label="Biggest blowout" g={extras.biggestBlowout} note={`won by ${extras.biggestBlowout.margin}`} />}
            {extras.highestSingleTeamScore && <GameCard label="Best single-team output" g={extras.highestSingleTeamScore} note={`${extras.highestSingleTeamScore.topTeamName} put up ${extras.highestSingleTeamScore.topScore}`} />}
          </div>
        </Panel>
      )}

      {extras.blowoutWinLeaders && extras.blowoutWinLeaders.length > 0 && (
        <Panel className="overflow-hidden">
          <SectionTitle>Blowout win tracker</SectionTitle>
          <p className="px-4 pb-2 text-xs" style={{ color: CHALK_DIM }}>Wins by {BLOWOUT_MARGIN}+ runs this season.</p>
          <div className="px-2 pb-2">
            {extras.blowoutWinLeaders.map((r, i) => {
              const t = teamsById[r.teamId];
              return (
                <button key={r.teamId} onClick={() => t && onOpenTeam(r.teamId)} className="w-full flex items-center gap-2 px-2 py-2 text-left" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
                  {t && <TeamMark team={t} size={16} />}
                  <span className="flex-1 text-sm font-semibold truncate" style={{ color: CHALK }}>{r.teamName}</span>
                  <span className="text-sm font-mono font-bold" style={{ color: GOLD }}>{r.count}</span>
                </button>
              );
            })}
          </div>
        </Panel>
      )}
      <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
        <SectionTitle accent={GOLD}>League totals</SectionTitle>
        <div className="grid grid-cols-3 gap-px" style={{ background: LINE }}>
          <StatBox label="Games Played" value={extras.totalGames} />
          <StatBox label="1-Run Games" value={extras.oneRunCount} />
          <StatBox label="Extra-Inning Games" value={extras.xInnCount} />
          <StatBox label="Forfeits" value={extras.forfeitCount} />
        </div>
      </Panel>
      {extras.sweeps.length > 0 && (
        <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
          <SectionTitle accent={GOLD}>Season sweeps</SectionTitle>
          <div className="px-2 pb-2">
            {extras.sweeps.map((s, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-2 text-sm" style={{ borderBottom: `1px solid ${LINE}` }}>
                <span className="flex-1" style={{ color: CHALK }}><span className="font-bold" style={{ color: WIN }}>{s.winnerName}</span> swept the season series {s.count}-0 vs {s.loserName}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
      {extras.upsets && extras.upsets.length > 0 && (
        <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
          <SectionTitle accent={GOLD}>Upset alerts</SectionTitle>
          <div className="px-2 pb-2">
            {extras.upsets.map((u, i) => (
              <div key={i} className="px-2 py-2 text-sm" style={{ borderBottom: `1px solid ${LINE}` }}>
                <span style={{ color: CHALK }}><span className="font-bold" style={{ color: GOLD }}>#{u.winnerRank} {u.winnerName}</span> beat <span style={{ color: CHALK_DIM }}>#{u.loserRank} {u.loserName}</span></span>
                <div className="text-[11px]" style={{ color: CHALK_DIM }}>{u.date ? `${u.date} · ` : ''}{u.awayScore}-{u.homeScore}</div>
              </div>
            ))}
          </div>
          <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>Based on final standings rank, not the rank at the time the game was actually played.</p>
        </Panel>
      )}
      {extras.closest.length > 0 && (
        <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
          <SectionTitle accent={GOLD}>Nail-biters (1-run or tied)</SectionTitle>
          <div className="px-2 pb-2">
            {extras.closest.map((g, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-2 text-sm" style={{ borderBottom: `1px solid ${LINE}` }}>
                <span className="text-[11px] w-14 flex-shrink-0" style={{ color: CHALK_DIM }}>{g.date || '—'}</span>
                <span className="flex-1 truncate" style={{ color: CHALK }}>{g.awayName} {g.awayScore} @ {g.homeName} {g.homeScore}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
      {leagueRecords && (
        <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
          <SectionTitle accent={GOLD}>League records book</SectionTitle>
          <div className="px-2 pb-2">
            {leagueRecords.bestRecord && (
              <div className="px-2 py-2 text-sm" style={{ borderTop: `1px solid ${LINE}` }}>
                <div className="text-[10px] uppercase" style={{ color: PRIMARY }}>Best single-season record</div>
                <div style={{ color: CHALK }}>{leagueRecords.bestRecord.teamName} — {leagueRecords.bestRecord.w}-{leagueRecords.bestRecord.l} <span style={{ color: CHALK_DIM }}>({leagueRecords.bestRecord.seasonName})</span></div>
              </div>
            )}
            {leagueRecords.bestRunDiff && (
              <div className="px-2 py-2 text-sm" style={{ borderTop: `1px solid ${LINE}` }}>
                <div className="text-[10px] uppercase" style={{ color: PRIMARY }}>Best run differential (season)</div>
                <div style={{ color: CHALK }}>{leagueRecords.bestRunDiff.teamName} — {leagueRecords.bestRunDiff.diff > 0 ? `+${leagueRecords.bestRunDiff.diff}` : leagueRecords.bestRunDiff.diff} <span style={{ color: CHALK_DIM }}>({leagueRecords.bestRunDiff.seasonName})</span></div>
              </div>
            )}
            {leagueRecords.longestStreak && leagueRecords.longestStreak.count > 0 && (
              <div className="px-2 py-2 text-sm" style={{ borderTop: `1px solid ${LINE}` }}>
                <div className="text-[10px] uppercase" style={{ color: PRIMARY }}>Longest win streak</div>
                <div style={{ color: CHALK }}>{leagueRecords.longestStreak.teamName} — {leagueRecords.longestStreak.count} games <span style={{ color: CHALK_DIM }}>({leagueRecords.longestStreak.seasonName})</span></div>
              </div>
            )}
            {leagueRecords.highestScore && (
              <div className="px-2 py-2 text-sm" style={{ borderTop: `1px solid ${LINE}` }}>
                <div className="text-[10px] uppercase" style={{ color: PRIMARY }}>Highest single-team score</div>
                <div style={{ color: CHALK }}>{leagueRecords.highestScore.teamName} — {leagueRecords.highestScore.score} <span style={{ color: CHALK_DIM }}>({leagueRecords.highestScore.seasonName})</span></div>
              </div>
            )}
          </div>
          <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>Scanned across every season in this league.</p>
        </Panel>
      )}
      {consistency.length > 0 && (
        <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
          <SectionTitle accent={GOLD}>Team consistency</SectionTitle>
          <p className="px-4 pb-2 text-[11px]" style={{ color: CHALK_DIM }}>Standard deviation of run differential per game — same record, different ride. Steadiest teams first.</p>
          <div className="px-2 pb-2">
            {consistency.map((c, i) => {
              const t = teamsById[c.teamId];
              return (
                <button key={c.teamId} onClick={() => onOpenTeam && onOpenTeam(c.teamId)} className="w-full flex items-center gap-2 px-2 py-1.5 text-left" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
                  <span className="w-4 text-xs font-mono flex-shrink-0" style={{ color: CHALK_DIM }}>{i + 1}</span>
                  {t && <TeamMark team={t} size={14} />}
                  <span className="flex-1 text-sm font-semibold truncate" style={{ color: CHALK }}>{c.teamName}</span>
                  <span className="text-[10px] uppercase font-bold flex-shrink-0" style={{ color: i === 0 ? WIN : i === consistency.length - 1 ? NEGATIVE : CHALK_DIM }}>{i === 0 ? 'Steadiest' : i === consistency.length - 1 ? 'Rollercoaster' : ''}</span>
                  <span className="text-sm font-mono font-bold flex-shrink-0" style={{ color: GOLD }}>±{c.stdev.toFixed(1)}</span>
                </button>
              );
            })}
          </div>
        </Panel>
      )}
      {(draftGrades.length > 0 || draftValue.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {draftGrades.length > 0 && (
            <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
              <SectionTitle accent={GOLD}>Draft class grades</SectionTitle>
              <p className="px-4 pb-2 text-[11px]" style={{ color: CHALK_DIM }}>Drafted players' WAR this season, curved against every other team's class.</p>
              <div className="px-2 pb-2">
                {draftGrades.map((r, i) => {
                  const t = teamsById[r.teamId];
                  return (
                    <button key={r.teamId} onClick={() => onOpenTeam && onOpenTeam(r.teamId)} className="w-full flex items-center gap-2 px-2 py-1.5 text-left" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
                      {t && <TeamMark team={t} size={14} />}
                      <span className="flex-1 text-sm font-semibold truncate" style={{ color: CHALK }}>{r.teamName}</span>
                      <span className="text-[10px] font-mono flex-shrink-0" style={{ color: CHALK_DIM }}>{r.picks.length} pick{r.picks.length === 1 ? '' : 's'}</span>
                      <span className="text-sm font-mono font-bold flex-shrink-0 w-6 text-center rounded" style={{ color: INK, background: GOLD }}>{r.grade}</span>
                    </button>
                  );
                })}
              </div>
            </Panel>
          )}
          {draftValue.length > 0 && (
            <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
              <SectionTitle accent={GOLD}>Draft steals</SectionTitle>
              <p className="px-4 pb-2 text-[11px]" style={{ color: CHALK_DIM }}>Biggest gap between draft slot and what they've actually produced.</p>
              <div className="px-2 pb-2">
                {draftValue.slice(0, 8).map((p, i) => (
                  <button key={p.playerId} onClick={() => onOpenPlayer && onOpenPlayer(p.name)} className="w-full flex items-center gap-2 px-2 py-1.5 text-left" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
                    <span className="w-4 text-xs font-mono flex-shrink-0" style={{ color: CHALK_DIM }}>{i + 1}</span>
                    <span className="flex-1 text-sm font-semibold truncate" style={{ color: CHALK }}>{p.name}</span>
                    <span className="text-[10px] font-mono flex-shrink-0" style={{ color: CHALK_DIM }}>Pick #{p.overall}</span>
                    <span className="text-sm font-mono font-bold flex-shrink-0" style={{ color: GOLD }}>{p.war.toFixed(1)} WAR</span>
                  </button>
                ))}
              </div>
            </Panel>
          )}
        </div>
      )}
      {workload.length > 0 && (
        <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
          <SectionTitle accent={GOLD}>Pitcher workload</SectionTitle>
          <div className="px-2 pb-2">
            {workload.slice(0, 10).map((p, i) => (
              <button key={p.playerId} onClick={() => onOpenPlayer && onOpenPlayer(p.name)} className="w-full flex items-center gap-2 px-2 py-1.5 text-left" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
                <span className="w-4 text-xs font-mono flex-shrink-0" style={{ color: CHALK_DIM }}>{i + 1}</span>
                <span className="flex-1 text-sm font-semibold truncate" style={{ color: CHALK }}>{p.name}</span>
                <span className="text-[10px] font-mono flex-shrink-0" style={{ color: CHALK_DIM }}>{p.teamName}</span>
                <span className="text-[10px] font-mono flex-shrink-0" style={{ color: CHALK_DIM }}>{p.appearances} app</span>
                <span className="text-sm font-mono font-bold flex-shrink-0" style={{ color: GOLD }}>{p.ip.toFixed(1)} IP</span>
              </button>
            ))}
          </div>
        </Panel>
      )}
      {activityLog && activityLog.length > 0 && (
        <Panel className="overflow-hidden" style={{ borderColor: GOLD }}>
          <SectionTitle accent={GOLD}>Recent activity</SectionTitle>
          <div className="px-2 pb-2 max-h-64 overflow-y-auto">
            {activityLog.slice().reverse().slice(0, 20).map(a => (
              <ActivityRow key={a.id} a={a} teamsById={teamsById} onRemove={isLoggedIn ? onRemoveActivity : null} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ==================================================================== */
/* Transactions view                                                     */
/* ==================================================================== */
const TRANSACTION_TYPES = [
  { value: 'all', label: 'All' },
  { value: 'add', label: 'Signings' },
  { value: 'trade', label: 'Trades' },
  { value: 'remove', label: 'Releases' },
  { value: 'suspend', label: 'Suspensions' },
  { value: 'ban', label: 'Bans' },
  { value: 'rebrand', label: 'Rebrands' },
];
function TransactionsView({ season, teamsById, onOpenPlayer, onRemoveActivity, onDismissAppeal }) {
  const { hasPermission } = useAuth();
  const isLoggedIn = hasPermission('manageRosters');
  const appeals = season.appeals || [];
  const [filter, setFilter] = useState('all');
  const activityLog = season.activityLog || [];

  const suspendedPlayers = [];
  const bannedPlayers = [];
  (season.members || []).forEach(m => {
    (m.roster || []).forEach(p => {
      if (p.suspended) suspendedPlayers.push({ ...p, teamId: m.teamId });
      if (p.banned) bannedPlayers.push({ ...p, teamId: m.teamId });
    });
  });
  (season.freeAgents || []).forEach(p => {
    if (p.suspended) suspendedPlayers.push({ ...p, teamId: null });
    if (p.banned) bannedPlayers.push({ ...p, teamId: null });
  });

  const filtered = filter === 'all' ? activityLog
    : filter === 'suspend' ? activityLog.filter(a => a.type === 'suspend' || a.type === 'unsuspend')
    : filter === 'ban' ? activityLog.filter(a => a.type === 'ban' || a.type === 'unban')
    : activityLog.filter(a => a.type === filter);
  const sorted = filtered.slice().reverse();

  const PlayerRow = ({ p, reason }) => {
    const t = teamsById[p.teamId];
    return (
      <button onClick={() => onOpenPlayer(p.name)} className="w-full flex items-center gap-2 px-2 py-2 text-left" style={{ borderTop: `1px solid ${LINE}` }}>
        {t ? <TeamMark team={t} size={16} /> : <span className="text-[9px] uppercase font-bold flex-shrink-0" style={{ color: CHALK_DIM }}>FA</span>}
        <span className="flex-1 text-sm font-semibold truncate" style={{ color: CHALK }}>{p.name}</span>
        {reason && <span className="text-xs italic truncate max-w-[140px]" style={{ color: CHALK_DIM }}>{reason}</span>}
      </button>
    );
  };

  return (
    <div className="p-3 space-y-3">
      <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
        <SectionTitle accent={PRIMARY}>Transactions</SectionTitle>
        <p className="px-4 pb-3 text-xs" style={{ color: CHALK_DIM }}>Every signing, trade, release, suspension, and ban recorded this season.</p>
      </Panel>

      {isLoggedIn && appeals.length > 0 && (
        <Panel className="overflow-hidden" style={{ borderColor: NEGATIVE }}>
          <SectionTitle accent={NEGATIVE}>Pending appeals ({appeals.length})</SectionTitle>
          <div className="px-2 pb-2">
            {appeals.map((a, i) => {
              const t = teamsById[a.teamId];
              return (
                <div key={a.id} className="px-2 py-2" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
                  <div className="flex items-center gap-2">
                    <button onClick={() => onOpenPlayer(a.playerName)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
                      {t && <TeamMark team={t} size={14} />}
                      <span className="text-sm font-semibold truncate" style={{ color: CHALK }}>{a.playerName}</span>
                    </button>
                    <span className="text-[10px] flex-shrink-0" style={{ color: CHALK_DIM }}>{new Date(a.createdAt).toLocaleDateString()}</span>
                    <button onClick={() => onDismissAppeal(season.id, a.id)} className="text-[10px] font-bold flex-shrink-0 px-2 py-1 rounded" style={{ background: PANEL2, color: CHALK_DIM }}>Dismiss</button>
                  </div>
                  <p className="text-xs mt-1" style={{ color: CHALK_DIM }}>{a.message}</p>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {(suspendedPlayers.length > 0 || bannedPlayers.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {suspendedPlayers.length > 0 && (
            <Panel>
              <SectionTitle accent={GOLD}>Active suspensions ({suspendedPlayers.length})</SectionTitle>
              <div className="px-2 pb-2">{suspendedPlayers.map(p => <PlayerRow key={p.id} p={p} reason={p.suspensionReason} />)}</div>
            </Panel>
          )}
          {bannedPlayers.length > 0 && (
            <Panel style={{ borderColor: NEGATIVE }}>
              <SectionTitle accent={NEGATIVE}>Banned players ({bannedPlayers.length})</SectionTitle>
              <div className="px-2 pb-2">{bannedPlayers.map(p => <PlayerRow key={p.id} p={p} reason={p.banReason} />)}</div>
            </Panel>
          )}
        </div>
      )}

      <Panel className="overflow-hidden">
        <SectionTitle right={
          <div className="flex flex-wrap gap-1 justify-end">
            {TRANSACTION_TYPES.map(t => (
              <button key={t.value} onClick={() => setFilter(t.value)} className="text-[10px] font-bold px-2 py-1 rounded" style={{ background: filter === t.value ? PRIMARY : PANEL2, color: filter === t.value ? INK : CHALK_DIM }}>{t.label}</button>
            ))}
          </div>
        }>Full log</SectionTitle>
        {sorted.length === 0 ? (
          <p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>No transactions match this filter.</p>
        ) : (
          <div className="px-2 pb-2">
            {sorted.map(a => <ActivityRow key={a.id} a={a} teamsById={teamsById} onRemove={isLoggedIn ? onRemoveActivity : null} />)}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ==================================================================== */
/* Graphs view                                                           */
/* ==================================================================== */
const GRAPH_CATEGORIES = [
  { key: 'trends', label: 'Trends' },
  { key: 'teams', label: 'Team comparisons' },
  { key: 'players', label: 'Players' },
  { key: 'h2h', label: 'Head-to-head' },
  { key: 'capsule', label: 'Time Capsule' },
];
// Freezes standings and stat leaders at any past point in the season —
// picked as a round/date index into the same `rounds` list computeRoundHistory
// was built from upstream, so this panel's index and roundHistory's are the
// same round no re-deriving needed. Leaders are recomputed on the fly from
// only the games up through that point (computeSeasonPlayerLeaders doesn't
// actually read teamsById, so scoping it to a game subset is just handing it
// a season object with a shorter games array).
function TimeCapsulePanel({ season, rounds, roundHistory, teamsById, onOpenTeam, onOpenPlayer }) {
  const [idx, setIdx] = useState(Math.max(0, rounds.length - 1));
  useEffect(() => { setIdx(Math.max(0, rounds.length - 1)); }, [rounds.length]);
  if (rounds.length === 0) return <Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>Enter some scores in the Schedule tab to look back at a past point in the season.</p></Panel>;

  const snap = roundHistory[idx];
  const gamesUpTo = [];
  for (let i = 0; i <= idx && i < rounds.length; i++) gamesUpTo.push(...rounds[i].games);
  const leaders = computeSeasonPlayerLeaders({ ...season, games: gamesUpTo }, teamsById, 'regular');
  const batters = [...leaders.filter(p => p.totals.ab >= 3)].sort((a, b) => b.batting.ops - a.batting.ops).slice(0, 5);
  const pitchers = [...leaders.filter(p => p.totals.outs >= 3)].sort((a, b) => a.pitching.era - b.pitching.era).slice(0, 5);
  const isLatest = idx === rounds.length - 1;

  const LeaderList = ({ title, rows, valueFmt }) => (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: LINE }}>
      <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide" style={{ background: PANEL2, color: CHALK_DIM }}>{title}</div>
      {rows.length === 0 && <p className="px-3 py-3 text-xs" style={{ color: CHALK_DIM }}>Not enough data at this point yet.</p>}
      {rows.map((p, i) => (
        <button key={p.playerId} onClick={() => onOpenPlayer(p.name)} className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-left" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
          <span style={{ color: CHALK }}>{p.name}</span>
          <span className="font-mono font-bold" style={{ color: PRIMARY }}>{valueFmt(p)}</span>
        </button>
      ))}
    </div>
  );

  return (
    <Panel className="overflow-hidden" style={{ borderColor: PRIMARY }}>
      <SectionTitle accent={PRIMARY}>Time capsule</SectionTitle>
      <div className="px-4 pb-3">
        <p className="text-xs mb-3" style={{ color: CHALK_DIM }}>Standings and leaders exactly as they stood after a given point in the season — drag to look back at how the race actually unfolded.</p>
        <input type="range" min="0" max={rounds.length - 1} value={idx} onChange={e => setIdx(Number(e.target.value))} className="w-full accent-current" style={{ color: PRIMARY }} />
        <div className="flex justify-between items-center text-[10px] mt-1.5" style={{ color: CHALK_DIM }}>
          <span className="truncate">{rounds[0].label}</span>
          <span className="font-bold flex-shrink-0 px-2" style={{ color: PRIMARY }}>{isLatest ? 'Now' : rounds[idx].label}</span>
          <span className="truncate text-right">{rounds[rounds.length - 1].label}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 px-4 pb-3">
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: LINE }}>
          <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide" style={{ background: PANEL2, color: CHALK_DIM }}>Standings</div>
          {snap.standings.map((t, i) => (
            <button key={t.id} onClick={() => onOpenTeam(t.id)} className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-left" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}>
              <span className="flex items-center gap-1.5 min-w-0" style={{ color: CHALK }}>
                <span className="w-3 flex-shrink-0" style={{ color: CHALK_DIM }}>{i + 1}</span>
                <TeamMark team={t} size={14} /> <span className="truncate">{t.displayName}</span>
              </span>
              <span className="font-mono flex-shrink-0" style={{ color: CHALK_DIM }}>{t.w}-{t.l}</span>
            </button>
          ))}
        </div>
        <div className="space-y-3">
          <LeaderList title="OPS leaders" rows={batters} valueFmt={p => p.batting.ops.toFixed(3).replace(/^0/, '')} />
          <LeaderList title="ERA leaders" rows={pitchers} valueFmt={p => p.pitching.era.toFixed(2)} />
        </div>
      </div>
    </Panel>
  );
}
// Free-form scatter of any two tracked stats against each other — reuses
// the same CUSTOM_STAT_OPTIONS list (and its qualifier thresholds) the
// custom leaderboard builder uses, so "does OPS actually track with WAR on
// this roster" is a couple of dropdown picks instead of eyeballing tables.
function StatCorrelationExplorer({ players, teamsById }) {
  const [xKey, setXKey] = useState('ops');
  const [yKey, setYKey] = useState('war');
  const statX = CUSTOM_STAT_OPTIONS.find(s => s.key === xKey) || CUSTOM_STAT_OPTIONS[0];
  const statY = CUSTOM_STAT_OPTIONS.find(s => s.key === yKey) || CUSTOM_STAT_OPTIONS[1];
  const poolFor = (stat) => stat.qualifier === 'ab' ? players.filter(p => p.totals.ab >= 3)
    : stat.qualifier === 'ip' ? players.filter(p => p.totals.outs >= 9)
    : players;
  const eligible = new Set(poolFor(statX).filter(p => poolFor(statY).includes(p)).map(p => p.playerId));
  const points = players.filter(p => eligible.has(p.playerId)).map(p => ({
    x: statX.valueFn(p), y: statY.valueFn(p), name: p.name,
    color: (teamsById[p.teamId] && teamColor(teamsById[p.teamId])) || PRIMARY,
  })).filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y));
  return (
    <Panel>
      <SectionTitle accent={GOLD}>Stat correlation explorer</SectionTitle>
      <div className="px-4 pb-3 space-y-3">
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>X axis</span>
            <select value={xKey} onChange={e => setXKey(e.target.value)} className="bg-[#242424] border rounded px-2 py-1.5 text-xs" style={{ borderColor: LINE, color: CHALK }}>
              {CUSTOM_STAT_OPTIONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase" style={{ color: CHALK_DIM }}>Y axis</span>
            <select value={yKey} onChange={e => setYKey(e.target.value)} className="bg-[#242424] border rounded px-2 py-1.5 text-xs" style={{ borderColor: LINE, color: CHALK }}>
              {CUSTOM_STAT_OPTIONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        </div>
        {points.length < 2 ? (
          <p className="text-sm" style={{ color: CHALK_DIM }}>Not enough qualifying players for both stats yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid stroke={LINE} />
              <XAxis type="number" dataKey="x" name={statX.label} tick={{ fill: CHALK_DIM, fontSize: 11 }} />
              <YAxis type="number" dataKey="y" name={statY.label} tick={{ fill: CHALK_DIM, fontSize: 11 }} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const pt = payload[0].payload;
                return (
                  <div className="rounded px-2.5 py-1.5 text-xs" style={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }}>
                    <p className="font-semibold">{pt.name}</p>
                    <p style={{ color: CHALK_DIM }}>{statX.label}: {statX.formatFn(pt.x)}</p>
                    <p style={{ color: CHALK_DIM }}>{statY.label}: {statY.formatFn(pt.y)}</p>
                  </div>
                );
              }} />
              <Scatter data={points} fill={PRIMARY}>
                {points.map((pt, i) => <Cell key={i} fill={pt.color} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  );
}

function GraphsView({ league, allSeasons, roundHistory, standings, scoringTrend, season, h2hMatrix, onOpenTeam, onOpenPlayer, sport }) {
  const [metric, setMetric] = useState('rank');
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [cat, setCat] = useState('trends');
  const [spotA, setSpotA] = useState(null);
  const [spotB, setSpotB] = useState(null);
  const [expTeamId, setExpTeamId] = useState(null);
  if (roundHistory.length === 0) return <div className="p-4"><Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>Enter some scores in the Schedule tab to see trend graphs.</p></Panel></div>;

  const chartData = roundHistory.map(snap => {
    const row = { label: snap.label };
    snap.standings.forEach(t => { row[t.id] = metric === 'rank' ? t.rank : metric === 'gb' ? t.gb : metric === 'diff' ? t.diff : metric === 'wins' ? t.w : t.pct; });
    return row;
  });
  const metricLabel = { rank: 'Standings position', gb: 'Games behind leader', diff: 'Run differential', pct: 'Win percentage', wins: 'Cumulative wins' }[metric];
  const yReversed = metric === 'rank';
  const fmtVal = (v) => v == null ? '—' : (metric === 'pct' ? v.toFixed(3).replace(/^0/, '') : (metric === 'rank' || metric === 'wins' ? v : (v > 0 ? `+${v}` : v)));

  // Margin-of-victory distribution across the whole season
  const scoreWord = sport ? sport.scorePlural : 'runs';
  const marginBuckets = { '1': 0, '2-3': 0, '4-6': 0, '7+': 0 };
  (season.games || []).filter(g => g.played && !g.isPlayoff && !g.isForfeit).forEach(g => {
    const m = Math.abs(Number(g.homeScore) - Number(g.awayScore));
    if (m <= 1) marginBuckets['1']++;
    else if (m <= 3) marginBuckets['2-3']++;
    else if (m <= 6) marginBuckets['4-6']++;
    else marginBuckets['7+']++;
  });
  const marginLabels = { '1': `1 ${sport ? sport.score : 'run'}`, '2-3': `2-3 ${scoreWord}`, '4-6': `4-6 ${scoreWord}`, '7+': `7+ ${scoreWord}` };
  const marginData = Object.entries(marginBuckets).map(([bucket, count]) => ({ bucket: marginLabels[bucket], count }));

  // League-wide batting average/ERA per season, oldest to newest — skips
  // tournament seasons (same "not a real season for career totals" carve-out
  // used everywhere else) and any season with too few at-bats to mean anything.
  const scoringEnvData = (allSeasons || [])
    .filter(s => !s.settings || !s.settings.isTournament)
    .slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .map(s => ({ label: s.name, ...computeSeasonScoringEnvironment(s) }))
    .filter(s => s.ab >= 20);

  // Offense vs. defense scatter (RS/G on x, RA/G on y — inverted so "up and to the right" reads as good)
  const scatterData = standings.map(t => ({ x: t.rsPerG, y: t.raPerG, name: t.displayName, id: t.id, color: teamColor(t) }));
  const leagueAvgRs = standings.length ? standings.reduce((s, t) => s + t.rsPerG, 0) / standings.length : 0;
  const leagueAvgRa = standings.length ? standings.reduce((s, t) => s + t.raPerG, 0) / standings.length : 0;

  // Power ranking trend — same composite formula as the Stats tab (win% +
  // run-diff/game + strength-of-schedule adjustment), tracked at every round
  // snapshot instead of just the current moment.
  const powerTrendData = roundHistory.map(snap => {
    const row = { label: snap.label };
    snap.standings.forEach(t => {
      const diffPerG = t.gp > 0 ? t.diff / t.gp : 0;
      const sosAdj = ((t.sos != null ? t.sos : 0.5) - 0.5) * 0.2;
      row[t.id] = t.pct + diffPerG * 0.1 + sosAdj;
    });
    return row;
  });

  // Strength of schedule vs. win% — teams above the diagonal-ish trend are
  // over-performing a tough schedule; below it, under-performing a soft one.
  const sosData = standings.filter(t => t.sos != null).map(t => ({ x: t.sos, y: t.pct, name: t.displayName, id: t.id, color: teamColor(t) }));

  // Home vs. away win% per team
  const homeAwayData = standings.map(t => ({
    name: t.displayName,
    home: (t.homeW + t.homeL) > 0 ? (t.homeW / (t.homeW + t.homeL)) * 100 : 0,
    away: (t.awayW + t.awayL) > 0 ? (t.awayW / (t.awayW + t.awayL)) * 100 : 0,
  }));

  // Pythagorean win% (runs-for^2 / (runs-for^2 + runs-against^2), the
  // standard Bill James exponent) vs. actual win% — teams well above the
  // line are outperforming their run differential (close-game luck), teams
  // below it are underperforming it.
  const pythagData = standings.filter(t => t.rf + t.ra > 0).map(t => {
    const rf2 = t.rf * t.rf, ra2 = t.ra * t.ra;
    return { x: rf2 / (rf2 + ra2), y: t.pct, name: t.displayName, id: t.id, color: teamColor(t) };
  });

  // Same Pythagorean expectation as the scatter above, but tracked round by
  // round for one team — actual wins vs. what the run differential up to
  // that point predicted, so a hot/cold streak (or genuine improvement)
  // shows up as the two lines actually diverging or converging over time.
  const expWinsTeamId = expTeamId || (standings[0] && standings[0].id) || null;
  const expWinsData = expWinsTeamId ? roundHistory.map(snap => {
    const t = snap.standings.find(s => s.id === expWinsTeamId);
    if (!t) return null;
    const rf2 = t.rf * t.rf, ra2 = t.ra * t.ra;
    const pythPct = (rf2 + ra2) > 0 ? rf2 / (rf2 + ra2) : 0.5;
    return { label: snap.label, actual: t.w, expected: Math.round(pythPct * t.gp * 10) / 10 };
  }).filter(Boolean) : [];

  // Player leaders (this season, regular season) for the Players category —
  // reuses the same aggregation Stat Leaders runs, just charted instead of
  // listed.
  const teamsByIdLocal = Object.fromEntries(league.map(t => [t.id, t]));
  const rounds = getOrderedRounds(season);
  const playerLeaders = computeSeasonPlayerLeaders(season, teamsByIdLocal, 'regular');
  const topHrData = [...playerLeaders].sort((a, b) => b.totals.hr - a.totals.hr).slice(0, 8).map(p => ({ name: p.name, value: p.totals.hr, color: (teamsByIdLocal[p.teamId] && teamColor(teamsByIdLocal[p.teamId])) || PRIMARY }));
  const topWarData = [...playerLeaders].sort((a, b) => b.war - a.war).slice(0, 8).map(p => ({ name: p.name, value: Number(p.war.toFixed(1)), color: (teamsByIdLocal[p.teamId] && teamColor(teamsByIdLocal[p.teamId])) || GOLD }));

  // Average roster experience (distinct league-wide seasons played through
  // this one) per team, for the "teams" category's experience curve chart.
  const experienceData = computeTeamExperience({ seasons: allSeasons || [] }, season.id)
    .map(e => ({ name: (teamsByIdLocal[e.teamId] && teamsByIdLocal[e.teamId].name) || '—', value: Number(e.avgSeasons.toFixed(2)), color: (teamsByIdLocal[e.teamId] && teamColor(teamsByIdLocal[e.teamId])) || PRIMARY }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="p-3 space-y-3">
      <div className="flex flex-wrap gap-1 rounded-lg overflow-hidden border w-fit" style={{ borderColor: LINE }}>
        {GRAPH_CATEGORIES.map(c => (
          <button key={c.key} onClick={() => setCat(c.key)} className="px-3 py-1.5 text-xs font-bold" style={{ background: cat === c.key ? PRIMARY : 'transparent', color: cat === c.key ? INK : CHALK_DIM }}>{c.label}</button>
        ))}
      </div>
      {cat === 'trends' && (
      <Panel>
        <SectionTitle right={
          <select value={metric} onChange={e => { setMetric(e.target.value); setSelectedIdx(null); }} className="bg-[#242424] border rounded px-2 py-1 text-xs" style={{ borderColor: LINE, color: CHALK }}>
            <option style={{ background: PANEL2, color: CHALK }} value="rank">Position</option><option style={{ background: PANEL2, color: CHALK }} value="gb">Games behind</option><option style={{ background: PANEL2, color: CHALK }} value="diff">Run diff</option><option style={{ background: PANEL2, color: CHALK }} value="pct">Win %</option><option style={{ background: PANEL2, color: CHALK }} value="wins">Wins</option>
          </select>
        }>{metricLabel} by round</SectionTitle>
        <div className="px-2 pb-2">
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData} margin={{ left: -10, right: 12, top: 8 }} onClick={e => { if (e && e.activeTooltipIndex != null) setSelectedIdx(e.activeTooltipIndex); }} onMouseMove={e => { if (e && e.activeTooltipIndex != null) setSelectedIdx(e.activeTooltipIndex); }}>
              <CartesianGrid stroke={LINE} strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fill: CHALK_DIM, fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis reversed={yReversed} allowDecimals={metric !== 'rank' && metric !== 'wins'} tick={{ fill: CHALK_DIM, fontSize: 10 }} />
              <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} />
              <Legend wrapperStyle={{ fontSize: 11, color: CHALK_DIM }} />
              {selectedIdx != null && chartData[selectedIdx] && <ReferenceLine x={chartData[selectedIdx].label} stroke={CHALK_DIM} strokeDasharray="4 4" />}
              {league.map(t => <Line key={t.id} type="monotone" dataKey={t.id} name={t.name} stroke={teamColor(t)} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />)}
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[11px] px-2 pb-2" style={{ color: CHALK_DIM }}>Tap or click a point on the line to pin its exact values below.</p>
          {selectedIdx != null && chartData[selectedIdx] && (
            <div className="mx-2 mb-2 p-3 rounded-lg" style={{ background: PANEL2, border: `1px solid ${LINE}` }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold" style={{ color: PRIMARY }}>{chartData[selectedIdx].label}</span>
                <button onClick={() => setSelectedIdx(null)} className="text-[11px]" style={{ color: CHALK_DIM }}>Clear</button>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {league.map(t => (
                  <button key={t.id} onClick={() => onOpenTeam(t.id)} className="flex items-center gap-1.5 text-xs font-mono">
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: teamColor(t), display: 'inline-block' }} />
                    <span style={{ color: CHALK }}>{t.name}:</span>
                    <span style={{ color: CHALK_DIM }}>{fmtVal(chartData[selectedIdx][t.id])}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Panel>
      )}

      {cat === 'trends' && (
      <Panel>
        <SectionTitle>Power ranking trend</SectionTitle>
        <div className="px-2 pb-2">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={powerTrendData} margin={{ left: -10, right: 12, top: 8 }}>
              <CartesianGrid stroke={LINE} strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fill: CHALK_DIM, fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: CHALK_DIM, fontSize: 10 }} />
              <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} />
              <Legend wrapperStyle={{ fontSize: 11, color: CHALK_DIM }} />
              {league.map(t => <Line key={t.id} type="monotone" dataKey={t.id} name={t.name} stroke={teamColor(t)} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />)}
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[11px] px-2 pb-2" style={{ color: CHALK_DIM }}>The same composite score from the Power Rankings panel in Stats (win% + run differential + strength of schedule), tracked round by round instead of just right now.</p>
        </div>
      </Panel>
      )}

      {cat === 'trends' && scoringTrend.length > 0 && (
        <Panel>
          <SectionTitle>League scoring trend</SectionTitle>
          <div className="px-2 pb-3">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={scoringTrend} margin={{ left: -10, right: 12, top: 8 }}>
                <CartesianGrid stroke={LINE} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: CHALK_DIM, fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: CHALK_DIM, fontSize: 10 }} />
                <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} />
                <Line type="monotone" dataKey="avgRuns" name="Avg. combined runs/game" stroke={GOLD} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      {cat === 'trends' && scoringEnvData.length > 1 && (
        <Panel>
          <SectionTitle>Scoring environment across seasons</SectionTitle>
          <p className="px-4 pt-1 text-xs" style={{ color: CHALK_DIM }}>League-wide batting average and ERA, one point per season — is the league getting more offense- or pitching-heavy over time?</p>
          <div className="px-2 pb-3">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={scoringEnvData} margin={{ left: -6, right: 12, top: 8 }}>
                <CartesianGrid stroke={LINE} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: CHALK_DIM, fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis yAxisId="avg" tick={{ fill: CHALK_DIM, fontSize: 10 }} tickFormatter={(v) => v.toFixed(3).replace(/^0/, '')} />
                <YAxis yAxisId="era" orientation="right" tick={{ fill: CHALK_DIM, fontSize: 10 }} tickFormatter={(v) => v.toFixed(2)} />
                <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} formatter={(v, name) => [name === 'League AVG' ? v.toFixed(3).replace(/^0/, '') : v.toFixed(2), name]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="avg" type="monotone" dataKey="avg" name="League AVG" stroke={PRIMARY} strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="era" type="monotone" dataKey="era" name="League ERA" stroke={NEGATIVE} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      {cat === 'teams' && (
      <>
      <Panel>
        <SectionTitle>Offense vs. defense</SectionTitle>
        <div className="px-2 pb-2">
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: -10 }}>
              <CartesianGrid stroke={LINE} strokeDasharray="3 3" />
              <XAxis type="number" dataKey="x" name="Runs scored/game" tick={{ fill: CHALK_DIM, fontSize: 10 }} label={{ value: 'Runs scored / game →', position: 'insideBottom', offset: -4, fill: CHALK_DIM, fontSize: 10 }} />
              <YAxis type="number" dataKey="y" name="Runs allowed/game" reversed tick={{ fill: CHALK_DIM, fontSize: 10 }} label={{ value: '← Runs allowed / game (better)', angle: -90, position: 'insideLeft', fill: CHALK_DIM, fontSize: 10 }} />
              <ZAxis range={[80, 80]} />
              <ReferenceLine x={leagueAvgRs} stroke={LINE} />
              <ReferenceLine y={leagueAvgRa} stroke={LINE} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} formatter={(v, n) => [v.toFixed(2), n === 'x' ? 'RS/G' : 'RA/G']} labelFormatter={() => ''} />
              <Scatter data={scatterData} onClick={(d) => onOpenTeam(d.id)}>
                {scatterData.map(d => <Cell key={d.id} fill={d.color} cursor="pointer" />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <p className="text-[11px] px-2 pb-2" style={{ color: CHALK_DIM }}>Top-right quadrant (relative to the gray league-average lines) = above-average offense and defense. Tap a dot to open that team.</p>
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Pythagorean win % vs. actual</SectionTitle>
        <div className="px-2 pb-2">
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: -10 }}>
              <CartesianGrid stroke={LINE} strokeDasharray="3 3" />
              <XAxis type="number" dataKey="x" domain={[0, 1]} tick={{ fill: CHALK_DIM, fontSize: 10 }} label={{ value: 'Pythagorean (expected) win % →', position: 'insideBottom', offset: -4, fill: CHALK_DIM, fontSize: 10 }} />
              <YAxis type="number" dataKey="y" domain={[0, 1]} tick={{ fill: CHALK_DIM, fontSize: 10 }} label={{ value: 'Actual win % →', angle: -90, position: 'insideLeft', fill: CHALK_DIM, fontSize: 10 }} />
              <ZAxis range={[80, 80]} />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke={LINE} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} formatter={(v, n) => [v.toFixed(3), n === 'x' ? 'Expected' : 'Actual']} labelFormatter={() => ''} />
              <Scatter data={pythagData} onClick={(d) => onOpenTeam(d.id)}>
                {pythagData.map(d => <Cell key={d.id} fill={d.color} cursor="pointer" />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <p className="text-[11px] px-2 pb-2" style={{ color: CHALK_DIM }}>Above the diagonal = winning more than run differential predicts (often not sustainable). Below it = a better team than the record shows. Tap a dot to open that team.</p>
        </div>
      </Panel>

      {expWinsData.length >= 2 && (
        <Panel>
          <SectionTitle right={
            <select value={expWinsTeamId || ''} onChange={e => setExpTeamId(e.target.value)} className="bg-[#242424] border rounded px-2 py-1 text-xs" style={{ borderColor: LINE, color: CHALK }}>
              {standings.map(t => <option key={t.id} value={t.id} style={{ background: PANEL2, color: CHALK }}>{t.displayName}</option>)}
            </select>
          }>Expected wins by round</SectionTitle>
          <div className="px-2 pb-2">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={expWinsData} margin={{ left: -10, right: 12, top: 8 }}>
                <CartesianGrid stroke={LINE} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: CHALK_DIM, fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: CHALK_DIM, fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} />
                <Legend wrapperStyle={{ fontSize: 11, color: CHALK_DIM }} />
                <Line type="monotone" dataKey="actual" name="Actual wins" stroke={PRIMARY} dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="expected" name="Expected (Pythagorean)" stroke={GOLD} dot={false} strokeWidth={2} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[11px] px-2 pb-2" style={{ color: CHALK_DIM }}>Actual wins pulling ahead of expected = winning the close ones. Falling behind = the run differential says this team is better than its record.</p>
          </div>
        </Panel>
      )}

      {season.oddsCache && season.oddsCache.sim && (
        <Panel>
          <SectionTitle>Playoff odds ({season.settings.playoffSpots} spot{season.settings.playoffSpots === 1 ? '' : 's'}, {season.settings.simRuns.toLocaleString()} runs)</SectionTitle>
          <div className="px-4 pb-3">
            <ResponsiveContainer width="100%" height={Math.max(160, standings.length * 34)}>
              <BarChart data={standings.map(t => ({ name: t.displayName, pct: season.oddsCache.sim[t.id] ? Number(season.oddsCache.sim[t.id].playoffPct.toFixed(1)) : 0, id: t.id }))} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid stroke={LINE} horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fill: CHALK_DIM, fontSize: 11 }} unit="%" />
                <YAxis type="category" dataKey="name" width={100} tick={{ fill: CHALK, fontSize: 11 }} />
                <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} formatter={v => `${v}%`} />
                <Bar dataKey="pct" radius={[0, 4, 4, 0]}>{standings.map(t => <Cell key={t.id} fill={teamColor(t)} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      <Panel>
        <SectionTitle>Strength of schedule vs. win %</SectionTitle>
        <div className="px-2 pb-2">
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: -10 }}>
              <CartesianGrid stroke={LINE} strokeDasharray="3 3" />
              <XAxis type="number" dataKey="x" domain={[0, 1]} tick={{ fill: CHALK_DIM, fontSize: 10 }} label={{ value: 'Strength of schedule →', position: 'insideBottom', offset: -4, fill: CHALK_DIM, fontSize: 10 }} />
              <YAxis type="number" dataKey="y" domain={[0, 1]} tick={{ fill: CHALK_DIM, fontSize: 10 }} label={{ value: 'Win % →', angle: -90, position: 'insideLeft', fill: CHALK_DIM, fontSize: 10 }} />
              <ZAxis range={[80, 80]} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} formatter={(v, n) => [v.toFixed(3), n === 'x' ? 'SOS' : 'Win%']} labelFormatter={() => ''} />
              <Scatter data={sosData} onClick={(d) => onOpenTeam(d.id)}>
                {sosData.map(d => <Cell key={d.id} fill={d.color} cursor="pointer" />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <p className="text-[11px] px-2 pb-2" style={{ color: CHALK_DIM }}>Up and to the right = winning a lot against a tough schedule. Up and to the left = padding a good record against a soft one. Tap a dot to open that team.</p>
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Home vs. away win %</SectionTitle>
        <div className="px-2 pb-3">
          <ResponsiveContainer width="100%" height={Math.max(160, standings.length * 30)}>
            <BarChart data={homeAwayData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid stroke={LINE} horizontal={false} />
              <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fill: CHALK_DIM, fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fill: CHALK, fontSize: 11 }} />
              <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} formatter={v => `${v.toFixed(0)}%`} />
              <Legend wrapperStyle={{ fontSize: 11, color: CHALK_DIM }} />
              <Bar dataKey="home" name="Home win %" fill={PRIMARY} radius={[0, 3, 3, 0]} />
              <Bar dataKey="away" name="Away win %" fill={GOLD} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Runs for vs. against</SectionTitle>
        <div className="px-2 pb-3">
          <ResponsiveContainer width="100%" height={Math.max(160, standings.length * 30)}>
            <BarChart data={standings.map(t => ({ name: t.displayName, RF: t.rf, RA: t.ra }))} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid stroke={LINE} horizontal={false} />
              <XAxis type="number" tick={{ fill: CHALK_DIM, fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fill: CHALK, fontSize: 11 }} />
              <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} />
              <Legend wrapperStyle={{ fontSize: 11, color: CHALK_DIM }} />
              <Bar dataKey="RF" fill={WIN} radius={[0, 3, 3, 0]} />
              <Bar dataKey="RA" fill={NEGATIVE} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Margin of victory</SectionTitle>
        <div className="px-2 pb-3">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={marginData} margin={{ left: -10, right: 16, top: 8 }}>
              <CartesianGrid stroke={LINE} strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tick={{ fill: CHALK_DIM, fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: CHALK_DIM, fontSize: 10 }} />
              <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} />
              <Bar dataKey="count" name="Games" radius={[4, 4, 0, 0]}>
                {marginData.map((d, i) => <Cell key={i} fill={i === 0 ? WIN : PRIMARY} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[11px] px-2" style={{ color: CHALK_DIM }}>How many games were decided by each run margin this season.</p>
        </div>
      </Panel>
      {experienceData.length > 0 && (
        <Panel>
          <SectionTitle>Team experience curve</SectionTitle>
          <div className="px-2 pb-3">
            <ResponsiveContainer width="100%" height={Math.max(160, experienceData.length * 32)}>
              <BarChart data={experienceData} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid stroke={LINE} horizontal={false} />
                <XAxis type="number" allowDecimals tick={{ fill: CHALK_DIM, fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fill: CHALK, fontSize: 11 }} />
                <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} formatter={(v) => [v.toFixed(2), 'Avg. seasons']} />
                <Bar dataKey="value" name="Avg. seasons" radius={[0, 3, 3, 0]}>
                  {experienceData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[11px] px-2" style={{ color: CHALK_DIM }}>Average number of league-wide seasons each current roster spot has played through, including this one — a proxy for how veteran vs. how green a roster is.</p>
          </div>
        </Panel>
      )}
      </>
      )}

      {cat === 'players' && (
        playerLeaders.length === 0 ? (
          <Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>No stats imported yet this season.</p></Panel>
        ) : (
        <>
          <Panel>
            <SectionTitle accent={GOLD}>Home run leaders</SectionTitle>
            <div className="px-2 pb-3">
              <ResponsiveContainer width="100%" height={Math.max(160, topHrData.length * 32)}>
                <BarChart data={topHrData} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid stroke={LINE} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: CHALK_DIM, fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fill: CHALK, fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} />
                  <Bar dataKey="value" name="HR" radius={[0, 3, 3, 0]}>
                    {topHrData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel>
            <SectionTitle accent={GOLD}>WAR leaders</SectionTitle>
            <div className="px-2 pb-3">
              <ResponsiveContainer width="100%" height={Math.max(160, topWarData.length * 32)}>
                <BarChart data={topWarData} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid stroke={LINE} horizontal={false} />
                  <XAxis type="number" tick={{ fill: CHALK_DIM, fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fill: CHALK, fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: PANEL2, border: `1px solid ${LINE}`, color: CHALK }} />
                  <Bar dataKey="value" name="WAR" radius={[0, 3, 3, 0]}>
                    {topWarData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="text-[11px] px-2" style={{ color: CHALK_DIM }}>Same simplified WAR formula used on Stat Leaders — bars colored by each player's current team.</p>
            </div>
          </Panel>
          <StatCorrelationExplorer players={playerLeaders} teamsById={teamsByIdLocal} />
        </>
        )
      )}

      {cat === 'h2h' && standings.length > 1 && (
        <H2HSection standings={standings} h2hMatrix={h2hMatrix} season={season} onOpenTeam={onOpenTeam} spotA={spotA} spotB={spotB} setSpotA={setSpotA} setSpotB={setSpotB} />
      )}

      {cat === 'capsule' && (
        <TimeCapsulePanel season={season} rounds={rounds} roundHistory={roundHistory} teamsById={teamsByIdLocal} onOpenTeam={onOpenTeam} onOpenPlayer={onOpenPlayer} />
      )}
    </div>
  );
}

// Interpolates a cell's background between the loss and win accent colors
// based on how lopsided the record is, and its opacity based on how many
// games have actually been played (a 1-0 record shouldn't read as loud as
// a 10-1 one).
function h2hCellStyle(rec) {
  if (!rec || rec.w + rec.l === 0) return { background: 'transparent', color: CHALK_DIM };
  const total = rec.w + rec.l;
  const winPct = rec.w / total;
  const color = winPct > 0.5 ? WIN : winPct < 0.5 ? NEGATIVE : CHALK_DIM;
  const magnitude = Math.abs(winPct - 0.5) * 2;
  const sample = Math.min(1, total / 5);
  const alpha = Math.round((10 + magnitude * 35) * sample).toString(16).padStart(2, '0');
  return { background: `${color}${alpha}`, color };
}

function H2HSection({ standings, h2hMatrix, season, onOpenTeam, spotA, spotB, setSpotA, setSpotB }) {
  const aId = spotA || standings[0].id;
  const bId = spotB || (standings.find(t => t.id !== aId) || standings[0]).id;
  const teamA = standings.find(t => t.id === aId) || standings[0];
  const teamB = standings.find(t => t.id === bId) || standings[1];
  const rec = (h2hMatrix[aId] && h2hMatrix[aId][bId]) || { w: 0, l: 0, rf: 0, ra: 0 };
  const total = rec.w + rec.l;
  const winPct = total > 0 ? rec.w / total : 0.5;
  const colorA = teamColor(teamA), colorB = teamColor(teamB);
  const meetings = (season.games || [])
    .filter(g => g.played && ((g.homeTeamId === aId && g.awayTeamId === bId) || (g.homeTeamId === bId && g.awayTeamId === aId)))
    .sort((x, y) => (y.date || '').localeCompare(x.date || ''));

  return (
    <div className="space-y-3">
      <Panel className="overflow-hidden">
        <div className="px-4 pt-4 pb-2 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wide" style={{ color: CHALK_DIM }}>Spotlight</span>
          {/* Each side's options exclude whichever team the other side has
              picked — the same team can't land on both sides, which used to
              corrupt the hero cards below (they'd share a React key, and
              React would leave a stale duplicate on the next selection
              change instead of cleanly swapping it). */}
          <select value={aId} onChange={e => setSpotA(e.target.value)} className="bg-[#242424] border rounded px-2 py-1 text-xs" style={{ borderColor: LINE, color: CHALK }}>
            {standings.filter(t => t.id !== bId).map(t => <option key={t.id} value={t.id} style={{ background: PANEL2, color: CHALK }}>{t.displayName}</option>)}
          </select>
          <span className="text-xs" style={{ color: CHALK_DIM }}>vs</span>
          <select value={bId} onChange={e => setSpotB(e.target.value)} className="bg-[#242424] border rounded px-2 py-1 text-xs" style={{ borderColor: LINE, color: CHALK }}>
            {standings.filter(t => t.id !== aId).map(t => <option key={t.id} value={t.id} style={{ background: PANEL2, color: CHALK }}>{t.displayName}</option>)}
          </select>
        </div>
        <div className="relative overflow-hidden" style={{ background: `linear-gradient(105deg, ${colorA}, ${colorA}dd 42%, rgba(0,0,0,0.85) 50%, ${colorB}dd 58%, ${colorB})` }}>
          <div className="grid grid-cols-2 gap-4 px-5 py-6">
            {[[teamA, rec.w, 'left'], [teamB, rec.l, 'right']].map(([t, wins, align]) => (
              <button key={align} onClick={() => onOpenTeam(t.id)} className="flex flex-col gap-2" style={{ alignItems: align === 'left' ? 'flex-start' : 'flex-end', textAlign: align }}>
                <TeamMark team={t} size={44} />
                <span className="font-head text-lg sm:text-2xl font-bold uppercase tracking-tight truncate max-w-full" style={{ color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>{t.displayName}</span>
                <span className="font-mono text-4xl sm:text-5xl font-black" style={{ color: '#fff', textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>{wins}</span>
              </button>
            ))}
          </div>
          <div className="px-5 pb-5">
            <div className="h-2 rounded-full overflow-hidden flex" style={{ background: 'rgba(0,0,0,0.35)' }}>
              <div style={{ width: `${Math.round(winPct * 100)}%`, background: '#fff' }} />
            </div>
            <div className="flex justify-between mt-1.5 text-[11px] font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>
              <span>{total > 0 ? `${Math.round(winPct * 100)}% all-time` : 'No meetings yet'}</span>
              <span>{rec.rf}-{rec.ra} combined runs</span>
            </div>
          </div>
        </div>
        {meetings.length > 0 && (
          <div className="px-2 pb-3 pt-1">
            {meetings.map(g => {
              const aIsHome = g.homeTeamId === aId;
              const aScore = aIsHome ? g.homeScore : g.awayScore;
              const bScore = aIsHome ? g.awayScore : g.homeScore;
              const aWon = Number(aScore) > Number(bScore);
              return (
                <div key={g.id} className="flex items-center justify-between px-2 py-1.5 text-xs" style={{ borderTop: `1px solid ${LINE}` }}>
                  <span style={{ color: CHALK_DIM }}>{g.date || '—'}{g.isPlayoff ? <span style={{ color: GOLD }}> · Playoffs</span> : ''}</span>
                  <span className="font-mono font-bold" style={{ color: CHALK }}>
                    <span style={{ color: aWon ? WIN : CHALK_DIM }}>{aScore}</span>
                    {' – '}
                    <span style={{ color: !aWon ? WIN : CHALK_DIM }}>{bScore}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel>
        <SectionTitle>Head-to-head win matrix</SectionTitle>
        <div className="overflow-x-auto px-2 pb-3">
          <table className="text-sm" style={{ color: CHALK, borderCollapse: 'separate', borderSpacing: '3px' }}>
            <thead>
              <tr>
                <th className="px-1 py-1"></th>
                {standings.map(t => (
                  <th key={t.id} className="px-1 py-1">
                    <button onClick={() => onOpenTeam(t.id)} title={t.displayName}><TeamMark team={t} size={26} /></button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {standings.map(row => (
                <tr key={row.id}>
                  <td className="pr-2 py-1 font-semibold whitespace-nowrap">
                    <button onClick={() => onOpenTeam(row.id)} className="flex items-center gap-1.5" style={{ color: CHALK }}><TeamMark team={row} size={22} /> {row.displayName}</button>
                  </td>
                  {standings.map(col => {
                    if (col.id === row.id) return <td key={col.id} className="px-1.5 py-2 text-center rounded" style={{ background: PANEL2, color: LINE }}>—</td>;
                    const cellRec = h2hMatrix[row.id] && h2hMatrix[row.id][col.id];
                    return (
                      <td key={col.id} className="px-1.5 py-2 text-center">
                        <button
                          onClick={() => { setSpotA(row.id); setSpotB(col.id); }}
                          title={`${row.displayName} vs ${col.displayName}`}
                          className="w-full h-full px-1.5 py-1.5 rounded font-mono font-bold text-sm"
                          style={h2hCellStyle(cellRec)}
                        >
                          {cellRec && cellRec.w + cellRec.l > 0 ? `${cellRec.w}-${cellRec.l}` : '·'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 pb-3 text-[11px]" style={{ color: CHALK_DIM }}>Reading across a row: that team's record against each column team. Click any cell to load it into the spotlight above.</p>
      </Panel>
    </div>
  );
}

// A persistent bar pinned to the bottom of the viewport, visible on every
// tab — live games (with a running score) when there are any, otherwise the
// last couple of final scores, so a visitor mid-Roster-edit or reading News
// doesn't have to jump back to Home to see the game happening right now.
// Dismissible per visit (reappears next time the page loads) rather than
// permanently, since a live game is exactly the kind of thing worth being
// re-reminded of.
function LiveTicker({ season, teamsById, sport, onOpenTeam }) {
  const [dismissed, setDismissed] = useState(false);
  const liveGames = (season.games || []).filter(g => g.isOngoing && !g.played);
  const scheduleMode = (season.settings && season.settings.scheduleMode) || 'date';
  const recentFinals = liveGames.length === 0
    ? sortGamesChronologically((season.games || []).filter(g => g.played && !g.isBye && !g.isSpringTraining), scheduleMode).slice(-3).reverse()
    : [];
  const items = [...liveGames, ...recentFinals];
  if (dismissed || items.length === 0) return null;

  const Item = ({ g }) => {
    const home = teamsById[g.homeTeamId], away = teamsById[g.awayTeamId];
    const inProgress = g.isOngoing && !g.played;
    const delayed = inProgress && !!g.isDelayed;
    const isLive = inProgress && !delayed;
    const periodLabel = inProgress ? formatLivePeriod(sport, g.livePeriod, g.liveHalf) : null;
    const awayScore = inProgress ? g.liveAwayScore : g.awayScore;
    const homeScore = inProgress ? g.liveHomeScore : g.homeScore;
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg flex-shrink-0" style={{ background: PANEL2, border: `1px solid ${isLive ? NEGATIVE : delayed ? GOLD : LINE}` }}>
        {isLive && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: NEGATIVE, animation: 'lt-live-pulse 1.4s ease-in-out infinite' }} />}
        <button onClick={() => away && onOpenTeam(away.id)} className="flex items-center gap-1 text-xs font-semibold" style={{ color: CHALK }}>{away && <TeamMark team={away} size={13} />} {away ? away.name : g.awayScheduleName}</button>
        <span className="font-mono text-xs font-bold" style={{ color: CHALK }}>{awayScore}-{homeScore}</span>
        <button onClick={() => home && onOpenTeam(home.id)} className="flex items-center gap-1 text-xs font-semibold" style={{ color: CHALK }}>{home ? home.name : g.homeScheduleName} {home && <TeamMark team={home} size={13} />}</button>
        <span className="text-[10px] font-bold uppercase flex-shrink-0" style={{ color: isLive ? NEGATIVE : delayed ? GOLD : CHALK_DIM }}>{isLive ? (periodLabel || 'Live') : delayed ? 'Delayed' : 'Final'}</span>
      </div>
    );
  };

  const anyLive = liveGames.some(g => !g.isDelayed);
  const anyDelayed = liveGames.some(g => g.isDelayed);
  const headerLabel = anyLive ? 'Live' : anyDelayed ? 'Delayed' : 'Latest';
  const headerColor = anyLive ? NEGATIVE : anyDelayed ? GOLD : CHALK_DIM;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30" style={{ background: `${PANEL}f7`, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', borderTop: `1px solid ${LINE}` }}>
      <div className="max-w-6xl mx-auto px-3 py-2 flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase flex-shrink-0" style={{ color: headerColor }}>{headerLabel}</span>
        <div className="flex-1 flex items-center gap-2 overflow-x-auto">
          {items.map(g => <Item key={g.id} g={g} />)}
        </div>
        <button onClick={() => setDismissed(true)} className="p-1 rounded flex-shrink-0" style={{ color: CHALK_DIM }}><X size={14} /></button>
      </div>
    </div>
  );
}

// A floating "send feedback" button visible to every visitor, logged in or
// not — posts straight to /api/feedback, which relays it to a Discord
// webhook. Sits above LiveTicker's fixed bottom bar (bottom-20 instead of
// bottom-4) so the two never overlap regardless of whether the ticker is
// currently showing.
function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error

  const submit = async () => {
    if (!message.trim()) return;
    setStatus('sending');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, page: typeof window !== 'undefined' ? window.location.href : '' }),
      });
      if (!res.ok) throw new Error('failed');
      setStatus('sent');
      setMessage('');
      setTimeout(() => { setOpen(false); setStatus('idle'); }, 1500);
    } catch (e) { setStatus('error'); }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="fixed z-40 flex items-center gap-1.5 px-3 py-2 rounded-full font-bold text-xs shadow-lg" style={{ bottom: 84, right: 16, background: PRIMARY, color: INK }}>
        <MessageSquare size={14} /> Feedback
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-sm rounded-xl border p-4 space-y-3" style={{ background: PANEL, borderColor: LINE }}>
            <div className="flex items-center justify-between">
              <h3 className="font-head text-sm font-bold uppercase tracking-wide" style={{ color: CHALK }}>Send feedback</h3>
              <button onClick={() => setOpen(false)} style={{ color: CHALK_DIM }}><X size={16} /></button>
            </div>
            {status === 'sent' ? (
              <p className="text-sm font-semibold" style={{ color: WIN }}>Thanks — sent!</p>
            ) : (
              <>
                <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} placeholder="Bug report, idea, anything…" className="w-full bg-[#242424] border rounded px-3 py-2 text-sm resize-none" style={{ borderColor: LINE, color: CHALK }} />
                {status === 'error' && <p className="text-xs" style={{ color: NEGATIVE }}>Couldn't send that — try again in a moment.</p>}
                <button onClick={submit} disabled={!message.trim() || status === 'sending'} className="w-full px-3 py-2 rounded font-bold text-sm disabled:opacity-40" style={{ background: PRIMARY, color: INK }}>{status === 'sending' ? 'Sending…' : 'Send'}</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Header bell for logged-in admins — surfaces pending trade proposals and
// suspensions that have run out their game count but haven't been lifted,
// instead of making someone remember to check the Roster/Transactions tabs.
function NotificationBell({ notifications }) {
  const [open, setOpen] = useState(false);
  if (!notifications || notifications.length === 0) return null;
  return (
    <div className="relative flex-shrink-0">
      <button onClick={() => setOpen(o => !o)} title="Notifications" className="relative p-1.5 rounded" style={{ color: CHALK_DIM }}>
        <Bell size={16} />
        <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-[9px] font-bold" style={{ width: 14, height: 14, background: NEGATIVE, color: '#fff' }}>{notifications.length}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 rounded-xl border w-72 shadow-xl overflow-hidden" style={{ background: PANEL, borderColor: LINE }}>
          <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${LINE}` }}>
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: CHALK }}>Needs attention</span>
            <button onClick={() => setOpen(false)} style={{ color: CHALK_DIM }}><X size={14} /></button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.map(n => (
              <button key={n.id} onClick={() => { n.onClick(); setOpen(false); }} className="w-full text-left px-3 py-2 text-xs flex items-start gap-2" style={{ borderBottom: `1px solid ${LINE}`, color: CHALK }}>
                {n.type === 'trade' ? <Users size={12} className="flex-shrink-0 mt-0.5" style={{ color: PRIMARY }} /> : <Ban size={12} className="flex-shrink-0 mt-0.5" style={{ color: NEGATIVE }} />}
                <span>{n.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Public popover listing league.changelog entries newest-first. Site owner
// edits the list from the Admin dashboard (ChangelogPanel below); this is
// the read-only view every visitor sees.
function WhatsNewButton({ changelog }) {
  const [open, setOpen] = useState(false);
  const entries = (changelog || []).slice().sort((a, b) => b.at - a.at).slice(0, 25);
  if (entries.length === 0) return null;
  return (
    <div className="relative flex-shrink-0">
      <button onClick={() => setOpen(o => !o)} title="What's new" className="p-1.5 rounded" style={{ color: CHALK_DIM }}><Sparkles size={16} /></button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 rounded-xl border w-80 shadow-xl overflow-hidden" style={{ background: PANEL, borderColor: LINE }}>
          <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${LINE}` }}>
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: CHALK }}>What's new</span>
            <button onClick={() => setOpen(false)} style={{ color: CHALK_DIM }}><X size={14} /></button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {entries.map(e => (
              <div key={e.id} className="px-3 py-2 text-xs" style={{ borderBottom: `1px solid ${LINE}` }}>
                <p style={{ color: CHALK }}>{e.text}</p>
                <p className="mt-0.5" style={{ color: CHALK_DIM }}>{new Date(e.at).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// One search bar for teams, players, and news instead of a separate search
// box per page. Matches on substring, capped so the dropdown stays scannable.
function GlobalSearch({ teamsIndex, league, onOpenTeam, onOpenPlayer, setTab }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!query) return { teams: [], players: [], news: [] };
    const teams = teamsIndex.filter(t => t.name.toLowerCase().includes(query)).slice(0, 5);
    const players = getAllPlayerNames(league).filter(n => n.toLowerCase().includes(query)).slice(0, 5);
    const news = (league.news || []).filter(n => n.title && n.title.toLowerCase().includes(query)).slice(0, 5);
    return { teams, players, news };
  }, [query, teamsIndex, league]);
  const hasResults = results.teams.length || results.players.length || results.news.length;

  const pick = (fn) => { fn(); setOpen(false); setQ(''); };

  return (
    <div className="relative flex-shrink-0">
      <button onClick={() => setOpen(o => !o)} title="Search" className="p-1.5 rounded" style={{ color: CHALK_DIM }}><Search size={16} /></button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 rounded-xl border w-80 shadow-xl overflow-hidden" style={{ background: PANEL, borderColor: LINE }}>
          <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${LINE}` }}>
            <Search size={14} style={{ color: CHALK_DIM }} />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search teams, players, news…" className="flex-1 bg-transparent text-sm outline-none" style={{ color: CHALK }} />
            <button onClick={() => setOpen(false)} style={{ color: CHALK_DIM }}><X size={14} /></button>
          </div>
          {query && (
            <div className="max-h-80 overflow-y-auto">
              {!hasResults && <p className="px-3 py-3 text-xs" style={{ color: CHALK_DIM }}>No matches.</p>}
              {results.teams.map(t => (
                <button key={`t-${t.id}`} onClick={() => pick(() => onOpenTeam(t.id))} className="w-full text-left px-3 py-2 text-xs flex items-center gap-2" style={{ borderBottom: `1px solid ${LINE}`, color: CHALK }}>
                  <Trophy size={12} style={{ color: PRIMARY }} /> {t.name}
                </button>
              ))}
              {results.players.map(name => (
                <button key={`p-${name}`} onClick={() => pick(() => onOpenPlayer(name))} className="w-full text-left px-3 py-2 text-xs flex items-center gap-2" style={{ borderBottom: `1px solid ${LINE}`, color: CHALK }}>
                  <Users size={12} style={{ color: GOLD }} /> {name}
                </button>
              ))}
              {results.news.map(n => (
                <button key={`n-${n.id}`} onClick={() => pick(() => setTab('news'))} className="w-full text-left px-3 py-2 text-xs flex items-center gap-2" style={{ borderBottom: `1px solid ${LINE}`, color: CHALK }}>
                  <Newspaper size={12} style={{ color: CHALK_DIM }} /> {n.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// A short notice at the top of the Home tab, shown to every visitor while
// the admin has it active. Dismissing it is per-visitor and per-message —
// a new message (or the same one re-enabled) shows again even if an older
// one was dismissed.
function MaintenanceBanner({ banner }) {
  const [dismissedKey, setDismissedKey] = useState(null);
  if (!banner || !banner.active || !banner.message || dismissedKey === banner.message) return null;
  const now = Date.now();
  if (banner.startAt && now < banner.startAt) return null;
  if (banner.endAt && now > banner.endAt) return null;
  return (
    <div className="mx-4 mt-4 px-4 py-2.5 flex items-center gap-3 rounded-xl" style={{ background: GOLD, color: INK }}>
      <AlertTriangle size={15} className="flex-shrink-0" />
      <span className="flex-1 text-sm font-semibold">{banner.message}</span>
      <button onClick={() => setDismissedKey(banner.message)} className="p-1 flex-shrink-0"><X size={15} /></button>
    </div>
  );
}

// Groups of tab keys that share one top-level nav button, to keep the main
// nav short — clicking the button lands on the group's first member (or
// stays put if you're already on one), and SubNav below lets you switch
// between the group's pages without going back to the main nav.
const STATS_GROUP = ['stats', 'leaders', 'graphs', 'rookies'];
const EXTRAS_GROUP = ['extras', 'odds'];
const AWARDS_GROUP = ['awards', 'halloffame', 'badges'];

function SubNav({ tab, setTab, items }) {
  return (
    <div className="px-4 pt-3 flex flex-wrap gap-2">
      {items.map(([key, label]) => (
        <button key={key} onClick={() => setTab(key)} className="px-3 py-1.5 rounded-full text-xs font-bold" style={{ background: tab === key ? PRIMARY : PANEL2, color: tab === key ? INK : CHALK_DIM, border: `1px solid ${tab === key ? PRIMARY : LINE}` }}>{label}</button>
      ))}
    </div>
  );
}

/* ==================================================================== */
/* Main App                                                              */
/* ==================================================================== */
function App() {
  const { isLoggedIn, hasPermission, user, roleLabel } = useAuth();
  const [screen, setScreen] = useState(FIXED_LEAGUE_ID ? 'league' : 'leagues'); // leagues | registry | history | league
  const [leaguesIndex, setLeaguesIndex] = useState([]);
  const [teamsIndex, setTeamsIndex] = useState([]);
  const [teamsById, setTeamsById] = useState({});
  const [league, setLeague] = useState(null);
  const [tab, setTab] = useState('home');
  const [prevTab, setPrevTab] = useState('home');
  const canGM = hasPermission('manageRosters');
  useEffect(() => { if (tab === 'teams' && !isLoggedIn) setTab('home'); }, [tab, isLoggedIn]);
  useEffect(() => { if (tab === 'roster' && !canGM) setTab('home'); }, [tab, canGM]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [compareInitialId, setCompareInitialId] = useState(null);
  const [compareSecondId, setCompareSecondId] = useState(null);
  const [selectedPlayerName, setSelectedPlayerName] = useState(null);
  const [comparePlayerAName, setComparePlayerAName] = useState(null);
  const [comparePlayerBName, setComparePlayerBName] = useState(null);
  const [historyBack, setHistoryBack] = useState('leagues');
  const [historyTeamId, setHistoryTeamId] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [roundIdx, setRoundIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [theme, setTheme] = useState(DEFAULT_THEME);
  // Per-visitor local light/dark override — never written to the shared
  // backend, just this browser's localStorage. null means "use the site's
  // theme as the admin set it."
  const [localThemeMode, setLocalThemeModeState] = useState(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('lt-theme-mode');
      if (saved === 'dark' || saved === 'light') setLocalThemeModeState(saved);
    } catch (e) { /* localStorage unavailable */ }
  }, []);
  const setLocalThemeMode = useCallback((mode) => {
    setLocalThemeModeState(mode);
    try { if (mode) localStorage.setItem('lt-theme-mode', mode); else localStorage.removeItem('lt-theme-mode'); } catch (e) { /* ignore */ }
  }, []);
  const effectiveTheme = localThemeMode ? THEME_PRESETS[localThemeMode] : theme;

  useEffect(() => {
    (async () => {
      const raw = await loadObj('theme');
      if (raw) setTheme({ ...DEFAULT_THEME, ...raw });
    })();
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--lt-chalk', effectiveTheme.chalk || DEFAULT_THEME.chalk);
    root.style.setProperty('--lt-chalk-dim', effectiveTheme.chalkDim || DEFAULT_THEME.chalkDim);
    root.style.setProperty('--lt-primary', effectiveTheme.primary || DEFAULT_THEME.primary);
    root.style.setProperty('--lt-ink', effectiveTheme.ink || DEFAULT_THEME.ink);
    root.style.setProperty('--lt-panel', effectiveTheme.panel || DEFAULT_THEME.panel);
    root.style.setProperty('--lt-panel2', effectiveTheme.panel2 || DEFAULT_THEME.panel2);
    root.style.setProperty('--lt-line', effectiveTheme.line || DEFAULT_THEME.line);
  }, [effectiveTheme]);
  const saveTheme = (next) => { setTheme(next); saveObj('theme', next); };

  const leagueRef = useRef(null);
  const saveQueuesRef = useRef({});
  useEffect(() => { leagueRef.current = league; }, [league]);

  const queueSave = useCallback((key, obj) => {
    setSaveStatus('saving');
    const prevQ = saveQueuesRef.current[key] || Promise.resolve();
    const q = prevQ
      .then(() => saveObj(key, obj))
      .then(ok => { setSaveStatus(ok ? 'saved' : 'error'); return ok; })
      .catch((e) => { setSaveStatus(e && e.name === 'LeagueRowConflict' ? 'conflict' : 'error'); });
    saveQueuesRef.current[key] = q;
    return q;
  }, []);
  const flushAllQueues = useCallback(async () => { await Promise.all(Object.values(saveQueuesRef.current)); }, []);


  const refreshTeamsById = useCallback(async (ids) => {
    const uniq = [...new Set(ids)];
    const missing = uniq.filter(id => !teamsById[id]);
    if (missing.length === 0) return;
    const loaded = {};
    for (const id of missing) { const t = await loadObj(`team:${id}`); if (t) loaded[id] = t; }
    setTeamsById(prev => ({ ...prev, ...loaded }));
  }, [teamsById]);

  useEffect(() => {
    (async () => {
      if (FIXED_LEAGUE_ID) {
        await openLeague(FIXED_LEAGUE_ID);
        setLoading(false);
        return;
      }
      const [lIdx, tIdx] = await Promise.all([loadList('leagues-index'), loadList('teams-index')]);
      setLeaguesIndex(lIdx);
      setTeamsIndex(tIdx);
      const lastId = await storGet('current-league-id');
      if (lastId && lIdx.find(l => l.id === lastId)) {
        const raw = await loadObj(`league:${lastId}`);
        if (raw) {
          const shaped = migrateShape(raw);
          setLeague(shaped);
          const ids = [];
          shaped.seasons.forEach(s => s.members.forEach(m => ids.push(m.teamId)));
          const loadedT = {};
          for (const id of [...new Set(ids)]) { const t = await loadObj(`team:${id}`); if (t) loadedT[id] = t; }
          setTeamsById(loadedT);
          setTab('home');
        }
      }
      setLoading(false);
    })();
  }, []);

  const persistLeague = useCallback((lg) => { setLeague(lg); queueSave(`league:${lg.id}`, lg); }, [queueSave]);
  // One presence write per Admin-tab visit, not a recurring interval —
  // persistLeague saves the whole league object every time, so a periodic
  // ping would meaningfully raise the odds of clobbering a concurrent
  // admin's real edit for freshness this feature doesn't need.
  useEffect(() => {
    if (tab !== 'admin' || !isLoggedIn || !league || !user) return;
    const username = (user.email || '').split('@')[0];
    if (!username) return;
    persistLeague({ ...league, presence: { ...(league.presence || {}), [username]: { role: roleLabel || '', at: Date.now() } } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isLoggedIn, league?.id]);
  const retrySave = useCallback(() => { if (leagueRef.current) queueSave(`league:${leagueRef.current.id}`, leagueRef.current); }, [queueSave]);

  const refreshIndexes = async () => { setLeaguesIndex(await loadList('leagues-index')); setTeamsIndex(await loadList('teams-index')); };

  /* ---- leagues ---- */
  const openLeague = async (id) => {
    setLoadError(null);
    try {
      const raw = await loadObj(`league:${id}`);
      if (!raw) { setLoadError("Couldn't open that league — it may have been removed. Try refreshing the list."); await refreshIndexes(); return; }
      let shaped = migrateShape(raw);
      // persist any migration + create global teams for legacy embedded teams
      if (shaped._legacyTeams) {
        for (const t of shaped._legacyTeams) {
          const existing = await loadObj(`team:${t.id}`);
          if (!existing) {
            const gt = { id: t.id, name: t.displayName || t.scheduleName, color: t.color || null, logoUrl: t.logoUrl || null, wordmarkUrl: t.wordmarkUrl || null, createdAt: Date.now() };
            await saveObj(`team:${t.id}`, gt);
            const idx = await loadList('teams-index');
            if (!idx.find(x => x.id === t.id)) { idx.push({ id: t.id, name: gt.name }); await saveList('teams-index', idx); }
          }
        }
        delete shaped._legacyTeams;
        await saveObj(`league:${id}`, shaped);
        await refreshIndexes();
      }
      setLeague(shaped);
      const ids = [];
      shaped.seasons.forEach(s => s.members.forEach(m => ids.push(m.teamId)));
      const loadedT = {};
      for (const tid of [...new Set(ids)]) { const t = await loadObj(`team:${tid}`); if (t) loadedT[tid] = t; }
      setTeamsById(prev => ({ ...prev, ...loadedT }));
      // teamsIndex (the {id,name} list of every team in the site-wide
      // registry, not just this league's current members) otherwise only
      // ever loads via the leagues-picker screen or the team registry — on
      // a hosted single-league deployment neither of those is ever visited
      // in the normal course of using the site, so teamsIndex silently
      // stayed empty for the whole session. That's what was breaking
      // "Add a team to this season"'s existing-team dropdown, and the
      // sheet importers' unmatched-team detection.
      setTeamsIndex(await loadList('teams-index'));
      setSelectedTeamId(null);
      setRoundIdx(0);
      setTab(shaped.seasons.length ? 'home' : 'seasons');
      setScreen('league');
      await storSet('current-league-id', id);
    } catch (e) { setLoadError('Something went wrong opening that league. Please try again.'); }
  };

  const createLeague = async (name, sport) => {
    const season = newSeason('Season 1');
    const lg = { id: uid('league'), name, sport: sport || 'baseball', createdAt: Date.now(), seasons: [season], activeSeasonId: season.id };
    await saveObj(`league:${lg.id}`, lg);
    const newIdx = [...leaguesIndex, { id: lg.id, name }];
    setLeaguesIndex(newIdx); await saveList('leagues-index', newIdx);
    setLeague(lg); setTab('home'); setScreen('league'); setSelectedTeamId(null); setRoundIdx(0);
    await storSet('current-league-id', lg.id);
  };
  const deleteLeagueById = async (id) => {
    await storDelete(`league:${id}`);
    const newIdx = leaguesIndex.filter(l => l.id !== id);
    setLeaguesIndex(newIdx); await saveList('leagues-index', newIdx);
    if (league && league.id === id) { setLeague(null); setScreen('leagues'); }
  };
  const renameLeague = async (id, name) => {
    const newIdx = leaguesIndex.map(l => l.id === id ? { ...l, name } : l);
    setLeaguesIndex(newIdx); await saveList('leagues-index', newIdx);
    if (league && league.id === id) persistLeague({ ...league, name });
    else { const lg = await loadObj(`league:${id}`); if (lg) await saveObj(`league:${id}`, { ...lg, name }); }
  };
  const setLeagueLogo = (logoUrl) => { if (league) persistLeague({ ...league, logoUrl }); };
  const backToLeagues = async () => {
    try { await flushAllQueues(); } catch (e) { /* best effort */ }
    setLeague(null); setSelectedTeamId(null); setScreen('leagues'); setLoadError(null);
    refreshIndexes();
  };

  /* ---- global team registry ---- */
  const openRegistry = async () => {
    const idx = await loadList('teams-index');
    setTeamsIndex(idx);
    setLeaguesIndex(await loadList('leagues-index'));
    const missing = idx.filter(t => !teamsById[t.id]);
    if (missing.length) {
      const loaded = {};
      for (const t of missing) { const gt = await loadObj(`team:${t.id}`); if (gt) loaded[t.id] = gt; }
      setTeamsById(prev => ({ ...prev, ...loaded }));
    }
    setScreen('registry');
  };
  const createGlobalTeam = async (name) => {
    const gt = { id: uid('t'), name, color: null, logoUrl: null, wordmarkUrl: null, createdAt: Date.now() };
    await saveObj(`team:${gt.id}`, gt);
    const idx = [...teamsIndex, { id: gt.id, name }];
    setTeamsIndex(idx); await saveList('teams-index', idx);
    setTeamsById(prev => ({ ...prev, [gt.id]: gt }));
    return gt;
  };
  // Backfills any season-referenced team missing from the site-wide registry
  // (possible during the period teamsIndex was silently broken on this
  // hosted deployment — see the openLeague note above, and it's also just a
  // reasonable safety net going forward), then looks for registry entries
  // that share a normalized name. Those are almost always a duplicate
  // created by an import that couldn't see the already-registered team (the
  // same root cause) rather than two different teams that happen to share a
  // name, so each group gets merged into one canonical team (the oldest of
  // the group) — every reference across every season is repointed to it, so
  // the merged-away id's seasons/games/awards/credits all show up under the
  // survivor and its History page reflects every season it actually played.
  // A name-group is left alone (reported as skipped, nothing touched) if two
  // of its ids are ever members of the SAME season at once — that's the one
  // case that really can be two different teams sharing a name.
  const syncTeamRegistry = async () => {
    if (!league) return { added: 0, merged: [], skipped: [] };
    const referencedIds = new Set();
    league.seasons.forEach(s => s.members.forEach(m => referencedIds.add(m.teamId)));

    let idx = [...teamsIndex];
    const idxIds = new Set(idx.map(t => t.id));
    const byIdDraft = { ...teamsById };
    let added = 0;
    for (const tid of referencedIds) {
      let gt = byIdDraft[tid];
      if (!gt) { gt = await loadObj(`team:${tid}`); if (gt) byIdDraft[tid] = gt; }
      if (!gt) {
        const member = league.seasons.flatMap(s => s.members).find(m => m.teamId === tid);
        gt = { id: tid, name: (member && member.scheduleName) || 'Unnamed team', color: null, logoUrl: null, wordmarkUrl: null, createdAt: Date.now() };
        await saveObj(`team:${tid}`, gt);
        byIdDraft[tid] = gt;
      }
      if (!idxIds.has(tid)) { idx.push({ id: tid, name: gt.name }); idxIds.add(tid); added++; }
    }

    const groups = new Map();
    idx.forEach(t => {
      const key = normalizeTeamName(t.name);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t.id);
    });

    const remap = {};
    const mergedNames = [];
    const skipped = [];
    groups.forEach((ids) => {
      if (ids.length < 2) return;
      const withCreated = ids.map(id => ({ id, createdAt: (byIdDraft[id] && byIdDraft[id].createdAt) || 0 }));
      withCreated.sort((a, b) => a.createdAt - b.createdAt);
      const canonical = withCreated[0].id;
      const losers = withCreated.slice(1).map(x => x.id);
      const collides = league.seasons.some(s => {
        const present = new Set(s.members.map(m => m.teamId));
        return [canonical, ...losers].filter(id => present.has(id)).length > 1;
      });
      if (collides) { skipped.push((byIdDraft[canonical] && byIdDraft[canonical].name) || canonical); return; }
      losers.forEach(l => { remap[l] = canonical; });
      mergedNames.push((byIdDraft[canonical] && byIdDraft[canonical].name) || canonical);
    });

    if (Object.keys(remap).length === 0) {
      if (added > 0) { setTeamsIndex(idx); await saveList('teams-index', idx); setTeamsById(byIdDraft); }
      return { added, merged: [], skipped };
    }

    const rid = (id) => remap[id] || id;
    const seasons = league.seasons.map(s => ({
      ...s,
      members: s.members.map(m => ({ ...m, teamId: rid(m.teamId) })),
      games: (s.games || []).map(g => ({ ...g, homeTeamId: g.homeTeamId ? rid(g.homeTeamId) : g.homeTeamId, awayTeamId: g.awayTeamId ? rid(g.awayTeamId) : g.awayTeamId, higherSeedId: g.higherSeedId ? rid(g.higherSeedId) : g.higherSeedId })),
      championTeamId: s.championTeamId ? rid(s.championTeamId) : s.championTeamId,
      activityLog: (s.activityLog || []).map(a => ({ ...a, teamId: a.teamId ? rid(a.teamId) : a.teamId, toTeamId: a.toTeamId ? rid(a.toTeamId) : a.toTeamId })),
    }));
    const awardDefs = (league.awardDefs || []).map(a => ({
      ...a,
      winners: (a.winners || []).map(w => w.type === 'team' ? { ...w, teamId: rid(w.teamId) } : w),
    }));
    const profiles = league.playerProfiles || {};
    const playerProfiles = Object.fromEntries(Object.entries(profiles).map(([k, p]) => [k, { ...p, teamCredits: (p.teamCredits || []).map(c => ({ ...c, teamId: rid(c.teamId) })) }]));

    const finalIdx = idx.filter(t => !remap[t.id]);
    const finalById = { ...byIdDraft };
    Object.keys(remap).forEach(l => { delete finalById[l]; });

    setTeamsIndex(finalIdx); await saveList('teams-index', finalIdx);
    setTeamsById(finalById);
    persistLeague({ ...league, seasons, awardDefs, playerProfiles });

    return { added, merged: mergedNames, skipped };
  };
  const openTeamHistory = async (teamId, back) => {
    setHistoryBack(back || screen);
    setHistoryTeamId(teamId);
    setScreen('history');
    setHistoryLoading(true);
    let team = teamsById[teamId];
    if (!team) { team = await loadObj(`team:${teamId}`); if (team) setTeamsById(prev => ({ ...prev, [teamId]: team })); }
    const results = [];
    for (const l of leaguesIndex) {
      const raw = await loadObj(`league:${l.id}`);
      if (!raw) continue;
      const shaped = migrateShape(raw);
      const localTeamsById = { ...teamsById };
      (shaped._legacyTeams || []).forEach(t => { if (!localTeamsById[t.id]) localTeamsById[t.id] = { id: t.id, name: t.displayName || t.scheduleName, color: t.color, logoUrl: t.logoUrl, wordmarkUrl: t.wordmarkUrl }; });
      if (team) localTeamsById[teamId] = team;
      shaped.seasons.forEach(s => {
        const member = s.members.find(m => m.teamId === teamId);
        if (!member) return;
        const st = computeStandings(s, localTeamsById);
        const row = st.all.find(t => t.id === teamId);
        results.push({
          leagueName: shaped.name, seasonName: s.name,
          record: row ? `${row.w}-${row.l}` : '0-0',
          w: row ? row.w : 0, l: row ? row.l : 0,
          rank: st.active.find(t => t.id === teamId)?.rank || null,
          champion: s.championTeamId === teamId,
          managerName: ((member.roster || []).find(p => (p.role || '').trim().toUpperCase() === 'PM') || {}).name || member.managerName || null,
        });
      });
    }
    setHistoryData(results);
    setHistoryLoading(false);
  };

  /* ---- seasons ---- */
  // viewSeasonId is which season THIS VISITOR is browsing — separate from
  // league.activeSeasonId (the shared default admins set for new visitors).
  // Everyone, logged in or not, can switch what they're looking at; only
  // admins can change the shared default. Every mutation in this file keys
  // off `activeSeason` below, so switching what a logged-in admin is
  // viewing also lets them edit/import stats for a past season.
  const [viewSeasonId, setViewSeasonId] = useState(null);
  const activeSeasonRaw = useMemo(() => {
    if (!league) return null;
    const wantId = (viewSeasonId && league.seasons.some(s => s.id === viewSeasonId)) ? viewSeasonId : league.activeSeasonId;
    return league.seasons.find(s => s.id === wantId) || league.seasons[0];
  }, [league, viewSeasonId]);
  // Backfill any settings keys added since a season was first created (older
  // seasons may be missing seriesLength/oddsFormat/homeFieldBoost etc), and
  // any top-level season fields added later (divisions).
  const activeSeason = useMemo(() => activeSeasonRaw ? { ...activeSeasonRaw, settings: { ...DEFAULT_SETTINGS, ...activeSeasonRaw.settings }, divisions: activeSeasonRaw.divisions || [], activityLog: activeSeasonRaw.activityLog || [], futuresPicks: activeSeasonRaw.futuresPicks || {} } : null, [activeSeasonRaw]);
  const sport = useMemo(() => sportOf(league), [league]);
  // teamsById with this season's rebrands layered on top — used for display
  // everywhere except the Teams admin screen, which edits the true global
  // team record and should show that, not a rebrand override.
  const displayTeamsById = useMemo(() => {
    if (!activeSeason) return teamsById;
    const rebranded = (activeSeason.members || []).filter(m => m.rebrand && teamsById[m.teamId]);
    if (rebranded.length === 0) return teamsById;
    const out = { ...teamsById };
    rebranded.forEach(m => {
      const base = out[m.teamId];
      out[m.teamId] = { ...base, name: m.rebrand.name || base.name, color: m.rebrand.color || base.color, logoUrl: m.rebrand.logoUrl || base.logoUrl, wordmarkUrl: m.rebrand.wordmarkUrl || base.wordmarkUrl };
    });
    return out;
  }, [teamsById, activeSeason]);

  const switchSeason = (seasonId) => { setViewSeasonId(seasonId); setSelectedTeamId(null); setRoundIdx(0); setTab('home'); };
  const setDefaultSeason = (seasonId) => { if (!league) return; persistLeague({ ...league, activeSeasonId: seasonId }); };
  const createSeason = (name, copyRoster, tournamentMode) => {
    if (!league) return;
    const s = newSeason(name);
    if (tournamentMode) s.settings = { ...s.settings, playoffFormat: 'wbc', isTournament: true };
    if (copyRoster && activeSeason) s.members = activeSeason.members.map(m => ({ teamId: m.teamId, scheduleName: m.scheduleName, baselineW: 0, baselineL: 0, baselineRF: 0, baselineRA: 0, active: m.active }));
    const lg = appendAuditEntry({ ...league, seasons: [...league.seasons, s], activeSeasonId: s.id }, 'Season created', s.name);
    persistLeague(lg); setSelectedTeamId(null); setRoundIdx(0); setTab('home');
  };
  const renameSeason = (seasonId, name) => { if (!league) return; persistLeague({ ...league, seasons: league.seasons.map(s => s.id === seasonId ? { ...s, name } : s) }); };
  const deleteSeason = (seasonId) => {
    if (!league) return;
    const target = league.seasons.find(s => s.id === seasonId);
    const remaining = league.seasons.filter(s => s.id !== seasonId);
    const activeSeasonId = league.activeSeasonId === seasonId ? (remaining[0] ? remaining[0].id : null) : league.activeSeasonId;
    persistLeague(appendAuditEntry({ ...league, seasons: remaining, activeSeasonId }, 'Season deleted', target ? target.name : seasonId));
  };
  const setChampion = (seasonId, teamId) => { if (!league) return; persistLeague({ ...league, seasons: league.seasons.map(s => s.id === seasonId ? { ...s, championTeamId: teamId } : s) }); };
  const setSeasonPublic = (seasonId, isPublic) => { if (!league) return; persistLeague({ ...league, seasons: league.seasons.map(s => s.id === seasonId ? { ...s, public: isPublic } : s) }); };

  /* ---- season roster ops ---- */
  const addExistingTeamToSeason = async (teamId) => {
    if (!league || !activeSeason) return;
    let t = teamsById[teamId];
    if (!t) { t = await loadObj(`team:${teamId}`); if (t) setTeamsById(prev => ({ ...prev, [teamId]: t })); }
    const member = { teamId, scheduleName: (t && t.name) || '', baselineW: 0, baselineL: 0, baselineRF: 0, baselineRA: 0, active: true };
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, members: [...s.members, member] } : s);
    persistLeague({ ...league, seasons });
  };
  const createAndAddTeamToSeason = async (name) => {
    const gt = await createGlobalTeam(name);
    if (!league || !activeSeason) return;
    const member = { teamId: gt.id, scheduleName: name, baselineW: 0, baselineL: 0, baselineRF: 0, baselineRA: 0, active: true };
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, members: [...s.members, member] } : s);
    persistLeague({ ...league, seasons });
    return gt;
  };
  const updateMemberField = (teamId, field, value) => {
    if (!league || !activeSeason) return;
    const numeric = ['baselineW', 'baselineL', 'baselineRF', 'baselineRA'];
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, members: s.members.map(m => m.teamId === teamId ? { ...m, [field]: numeric.includes(field) ? (Number(value) || 0) : value } : m) } : s);
    persistLeague({ ...league, seasons });
  };
  const removeMember = (teamId) => {
    if (!league || !activeSeason) return;
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, members: s.members.filter(m => m.teamId !== teamId) } : s);
    persistLeague({ ...league, seasons });
  };

  /* ---- divisions & conferences ---- */
  const addDivision = (name, conference) => {
    if (!league || !activeSeason) return;
    const div = newDivision(name, conference);
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, divisions: [...(s.divisions || []), div] } : s);
    persistLeague({ ...league, seasons });
  };
  const updateDivision = (divId, field, value) => {
    if (!league || !activeSeason) return;
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, divisions: (s.divisions || []).map(d => d.id === divId ? { ...d, [field]: value } : d) } : s);
    persistLeague({ ...league, seasons });
  };
  const removeDivision = (divId) => {
    if (!league || !activeSeason) return;
    if (!confirm('Delete this division? Teams in it will become unassigned.')) return;
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? {
      ...s,
      divisions: (s.divisions || []).filter(d => d.id !== divId),
      members: s.members.map(m => m.divisionId === divId ? { ...m, divisionId: null } : m),
    } : s);
    persistLeague({ ...league, seasons });
  };
  const assignMemberDivision = (teamId, divisionId) => updateMemberField(teamId, 'divisionId', divisionId || null);

  const updateMemberRoster = (teamId, updateFn) => {
    if (!league || !activeSeason) return;
    const seasons = league.seasons.map(s => {
      if (s.id !== activeSeason.id) return s;
      return { ...s, members: s.members.map(m => m.teamId === teamId ? { ...m, roster: updateFn(m.roster || []) } : m) };
    });
    persistLeague({ ...league, seasons });
  };
  // Roster edit + its activity-log entry must land in ONE persistLeague call:
  // calling updateMemberRoster() then a separate logActivity() would have the
  // second call build its "seasons" off the pre-update `league` closure (React
  // state hasn't re-rendered yet), so the queued save from the activity-log
  // call would silently overwrite the roster change with a stale copy.
  const updateMemberRosterWithActivity = (teamId, updateFn, activityEntry) => {
    if (!league || !activeSeason) return;
    const seasons = league.seasons.map(s => {
      if (s.id !== activeSeason.id) return s;
      const members = s.members.map(m => m.teamId === teamId ? { ...m, roster: updateFn(m.roster || []) } : m);
      const activityLog = activityEntry ? [...(s.activityLog || []), { id: uid('act'), at: Date.now(), ...activityEntry }] : (s.activityLog || []);
      return { ...s, members, activityLog };
    });
    persistLeague({ ...league, seasons });
  };
  const addPlayer = (teamId, name, starLevel) => {
    updateMemberRosterWithActivity(
      teamId,
      roster => [...roster, newPlayer(name, starLevel)],
      { type: 'add', teamId, text: `${name} added to ${(teamsById[teamId] && teamsById[teamId].name) || 'a team'}` }
    );
  };
  const addPlayersBulk = (teamId, parsedRows) => updateMemberRoster(teamId, roster => [
    ...roster,
    ...parsedRows.filter(r => r.matched).map(r => newPlayer(r.name, r.starLevel)),
  ]);
  const updatePlayerField = (teamId, playerId, field, value) => updateMemberRoster(teamId, roster => roster.map(p => p.id === playerId ? { ...p, [field]: value } : p));
  // Removing a player never deletes them — they move to the season's free
  // agent pool instead, so their already-imported game stats (which are
  // keyed by playerId, untouched here) stay visible on Leaders/their player
  // page instead of silently vanishing because no roster references their id
  // or name anymore.
  const removePlayer = (teamId, playerId) => {
    if (!league || !activeSeason) return;
    const member = activeSeason.members.find(m => m.teamId === teamId);
    const player = (member && (member.roster || [])).find(p => p.id === playerId);
    if (!player) return;
    const teamName = (teamsById[teamId] && teamsById[teamId].name) || 'a team';
    const seasons = league.seasons.map(s => {
      if (s.id !== activeSeason.id) return s;
      const members = s.members.map(m => m.teamId === teamId ? { ...m, roster: (m.roster || []).filter(p => p.id !== playerId) } : m);
      const freeAgents = [...(s.freeAgents || []), { ...player, formerTeamId: teamId }];
      const activityLog = [...(s.activityLog || []), { id: uid('act'), type: 'remove', teamId, text: `${player.name} released by ${teamName} — now a free agent`, at: Date.now() }];
      return { ...s, members, freeAgents, activityLog };
    });
    persistLeague({ ...league, seasons });
  };
  // Corrective tool for the player page's "Teams played on" list, not a
  // normal roster move: a true delete of that one season/team roster
  // entry (unlike removePlayer, which demotes to free agent and keeps
  // stats attached) — for cleaning up a bad import match (e.g. a sheet
  // that matched the wrong post-rebrand team), which the confirm dialog
  // in the UI warns is exactly what this does. Season-aware (not limited
  // to activeSeason) since the entry being removed can be from any season.
  const removeTeamPlayed = (seasonId, teamId, playerId) => {
    if (!league) return;
    const seasons = league.seasons.map(s => s.id === seasonId ? { ...s, members: s.members.map(m => m.teamId === teamId ? { ...m, roster: (m.roster || []).filter(p => p.id !== playerId) } : m) } : s);
    persistLeague({ ...league, seasons });
  };
  // Signs a player out of the free agent pool onto a roster — the inverse of
  // removePlayer. Keeps the same player id so their free-agent-stint stats
  // (if any were imported while unattached) stay attributed to them.
  const signFreeAgent = (teamId, playerId) => {
    if (!league || !activeSeason) return;
    const fa = (activeSeason.freeAgents || []).find(p => p.id === playerId);
    if (!fa) return;
    const teamName = (teamsById[teamId] && teamsById[teamId].name) || 'a team';
    const { formerTeamId, ...player } = fa;
    const seasons = league.seasons.map(s => {
      if (s.id !== activeSeason.id) return s;
      const freeAgents = (s.freeAgents || []).filter(p => p.id !== playerId);
      const members = s.members.map(m => m.teamId === teamId ? { ...m, roster: [...(m.roster || []), player] } : m);
      const activityLog = [...(s.activityLog || []), { id: uid('act'), type: 'add', teamId, text: `${player.name} signed by ${teamName}`, at: Date.now() }];
      return { ...s, members, freeAgents, activityLog };
    });
    persistLeague({ ...league, seasons });
  };
  // Permanently deletes a free agent from the pool (e.g. a mis-entered
  // name) — unlike removePlayer this has no roster to preserve stats
  // against continuity for, so it's a hard delete.
  const deleteFreeAgent = (playerId) => {
    if (!league || !activeSeason) return;
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, freeAgents: (s.freeAgents || []).filter(p => p.id !== playerId) } : s);
    persistLeague({ ...league, seasons });
  };
  // Same as deleteFreeAgent but for a whole batch in one write — clearing
  // out a stale free-agent pool on an old season one-by-one would mean one
  // persistLeague round-trip per player.
  const deleteFreeAgentsBulk = (playerIds) => {
    if (!league || !activeSeason || playerIds.length === 0) return;
    const idSet = new Set(playerIds);
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, freeAgents: (s.freeAgents || []).filter(p => !idSet.has(p.id)) } : s);
    persistLeague({ ...league, seasons });
  };
  const setPlayerSuspended = (teamId, playerId, suspended, reason, durationGames) => {
    if (!league || !activeSeason) return;
    const player = ((activeSeason.members.find(m => m.teamId === teamId)) || {}).roster?.find(p => p.id === playerId);
    // Games-served is tracked as "team's completed games at suspension time"
    // rather than a countdown, so it stays correct even if games get
    // rescored/reordered later — remaining is always derived, never stored.
    const gamesPlayed = (activeSeason.games || []).filter(g => g.played && !g.isBye && (g.homeTeamId === teamId || g.awayTeamId === teamId)).length;
    const text = player ? (suspended
      ? `${player.name} (${(teamsById[teamId] && teamsById[teamId].name) || 'a team'}) suspended${durationGames ? ` for ${durationGames} game${durationGames === 1 ? '' : 's'}` : ''}${reason ? ` — ${reason}` : ''}`
      : `${player.name} (${(teamsById[teamId] && teamsById[teamId].name) || 'a team'}) suspension lifted`) : '';
    const seasons = league.seasons.map(s => {
      if (s.id !== activeSeason.id) return s;
      const members = s.members.map(m => m.teamId === teamId ? {
        ...m, roster: (m.roster || []).map(p => p.id === playerId ? {
          ...p, suspended, suspensionReason: suspended ? (reason || '') : '',
          suspensionGames: suspended ? (durationGames || null) : null,
          suspensionStartGames: suspended ? gamesPlayed : null,
        } : p),
      } : m);
      const activityLog = player ? [...(s.activityLog || []), { id: uid('act'), type: suspended ? 'suspend' : 'unsuspend', teamId, text, at: Date.now() }] : (s.activityLog || []);
      return { ...s, members, activityLog };
    });
    persistLeague(appendAuditEntry({ ...league, seasons }, suspended ? 'Player suspended' : 'Player suspension lifted', text || (player && player.name) || ''));
  };
  // Bans are more severe than a suspension: the player disappears from stat
  // leaders entirely (see computeSeasonPlayerLeaders's banned filter) rather
  // than just being unable to play. Works whether the player is currently
  // rostered or sitting in the free agent pool, since a released player can
  // still be banned after the fact.
  const setPlayerBanned = (playerId, banned, reason) => {
    if (!league || !activeSeason) return;
    const member = activeSeason.members.find(m => (m.roster || []).some(p => p.id === playerId));
    const fa = !member && (activeSeason.freeAgents || []).find(p => p.id === playerId);
    const player = (member && member.roster.find(p => p.id === playerId)) || fa;
    if (!player) return;
    const teamName = member ? ((teamsById[member.teamId] && teamsById[member.teamId].name) || 'a team') : 'free agency';
    const text = banned ? `${player.name} (${teamName}) banned${reason ? ` — ${reason}` : ''}` : `${player.name} ban lifted`;
    const seasons = league.seasons.map(s => {
      if (s.id !== activeSeason.id) return s;
      const members = s.members.map(m => ({ ...m, roster: (m.roster || []).map(p => p.id === playerId ? { ...p, banned, banReason: banned ? (reason || '') : '' } : p) }));
      const freeAgents = (s.freeAgents || []).map(p => p.id === playerId ? { ...p, banned, banReason: banned ? (reason || '') : '' } : p);
      const activityLog = [...(s.activityLog || []), {
        id: uid('act'), type: banned ? 'ban' : 'unban', teamId: member ? member.teamId : null,
        text,
        at: Date.now(),
      }];
      return { ...s, members, freeAgents, activityLog };
    });
    persistLeague(appendAuditEntry({ ...league, seasons }, banned ? 'Player banned' : 'Player ban lifted', text));
  };
  // Anyone can submit an appeal from a suspended/banned player's page — no
  // login required, this is the one write action a logged-out visitor can
  // trigger — it just parks a message for an admin to review and act on
  // (lift the suspension/ban themselves) rather than doing anything
  // automatically.
  const submitAppeal = (seasonId, playerId, playerName, teamId, message) => {
    if (!league || !message.trim()) return;
    const appeal = { id: uid('appeal'), playerId, playerName, teamId, message: message.trim(), createdAt: Date.now() };
    const seasons = league.seasons.map(s => s.id === seasonId ? { ...s, appeals: [...(s.appeals || []), appeal] } : s);
    persistLeague({ ...league, seasons });
  };
  const dismissAppeal = (seasonId, appealId) => {
    if (!league) return;
    const seasons = league.seasons.map(s => s.id === seasonId ? { ...s, appeals: (s.appeals || []).filter(a => a.id !== appealId) } : s);
    persistLeague({ ...league, seasons });
  };
  const tradePlayer = (fromTeamId, toTeamId, playerId) => {
    if (!league || !activeSeason || fromTeamId === toTeamId) return;
    let movedPlayer = null;
    const afterRemoval = activeSeason.members.map(m => {
      if (m.teamId !== fromTeamId) return m;
      const roster = m.roster || [];
      const idx = roster.findIndex(p => p.id === playerId);
      if (idx < 0) return m;
      movedPlayer = roster[idx];
      return { ...m, roster: roster.filter(p => p.id !== playerId) };
    });
    if (!movedPlayer) return;
    const finalMembers = afterRemoval.map(m => m.teamId === toTeamId ? { ...m, roster: [...(m.roster || []), movedPlayer] } : m);
    const fromName = (teamsById[fromTeamId] && teamsById[fromTeamId].name) || 'a team';
    const toName = (teamsById[toTeamId] && teamsById[toTeamId].name) || 'a team';
    const logEntry = { id: uid('act'), type: 'trade', teamId: fromTeamId, toTeamId, text: `${movedPlayer.name} traded from ${fromName} to ${toName}`, at: Date.now() };
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, members: finalMembers, activityLog: [...(s.activityLog || []), logEntry] } : s);
    persistLeague({ ...league, seasons });
  };
  // Multi-player trade between two teams in one atomic move — either side
  // can send zero or more players (a one-sided "give away" is allowed too).
  const tradePlayers = (teamAId, teamBId, idsFromA, idsFromB) => {
    if (!league || !activeSeason || teamAId === teamBId) return;
    let movedFromA = [], movedFromB = [];
    const afterRemoval = activeSeason.members.map(m => {
      if (m.teamId === teamAId) {
        const roster = m.roster || [];
        movedFromA = roster.filter(p => idsFromA.includes(p.id));
        return { ...m, roster: roster.filter(p => !idsFromA.includes(p.id)) };
      }
      if (m.teamId === teamBId) {
        const roster = m.roster || [];
        movedFromB = roster.filter(p => idsFromB.includes(p.id));
        return { ...m, roster: roster.filter(p => !idsFromB.includes(p.id)) };
      }
      return m;
    });
    if (movedFromA.length === 0 && movedFromB.length === 0) return;
    const finalMembers = afterRemoval.map(m => {
      if (m.teamId === teamAId) return { ...m, roster: [...(m.roster || []), ...movedFromB] };
      if (m.teamId === teamBId) return { ...m, roster: [...(m.roster || []), ...movedFromA] };
      return m;
    });
    const nameA = (teamsById[teamAId] && teamsById[teamAId].name) || 'Team A';
    const nameB = (teamsById[teamBId] && teamsById[teamBId].name) || 'Team B';
    const parts = [];
    if (movedFromA.length) parts.push(`${movedFromA.map(p => p.name).join(', ')} to ${nameB}`);
    if (movedFromB.length) parts.push(`${movedFromB.map(p => p.name).join(', ')} to ${nameA}`);
    const logEntry = { id: uid('act'), type: 'trade', teamId: teamAId, toTeamId: teamBId, text: `Trade: ${parts.join(' — ')}`, at: Date.now() };
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, members: finalMembers, activityLog: [...(s.activityLog || []), logEntry] } : s);
    persistLeague({ ...league, seasons });
  };
  // Saves a multi-player trade for later review instead of moving anyone
  // right away — a proposal, not an action. Player names are snapshotted at
  // proposal time so the pending list still reads sensibly even if someone
  // gets renamed or removed from the roster before it's acted on.
  const proposeTrade = (teamAId, teamBId, idsFromA, idsFromB) => {
    if (!league || !activeSeason || teamAId === teamBId) return;
    const memberA = activeSeason.members.find(m => m.teamId === teamAId);
    const memberB = activeSeason.members.find(m => m.teamId === teamBId);
    const fromA = ((memberA && memberA.roster) || []).filter(p => idsFromA.includes(p.id)).map(p => ({ id: p.id, name: p.name }));
    const fromB = ((memberB && memberB.roster) || []).filter(p => idsFromB.includes(p.id)).map(p => ({ id: p.id, name: p.name }));
    if (fromA.length === 0 && fromB.length === 0) return;
    const proposal = { id: uid('trade'), teamAId, teamBId, fromA, fromB, createdAt: Date.now() };
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, pendingTrades: [...(s.pendingTrades || []), proposal] } : s);
    persistLeague({ ...league, seasons });
  };
  // Applies a pending proposal's roster swap and removes it from the pending
  // list in the same persist — reusing tradePlayers here would need two
  // separate persistLeague calls (one from tradePlayers, one to drop the
  // proposal), and the second would clobber the first since this closure's
  // `league` doesn't see tradePlayers' update until the next render. So the
  // swap logic is duplicated here rather than composed, to keep it atomic.
  const executeTradeProposal = (tradeId) => {
    if (!league || !activeSeason) return;
    const trade = (activeSeason.pendingTrades || []).find(t => t.id === tradeId);
    if (!trade) return;
    const { teamAId, teamBId } = trade;
    const idsFromA = trade.fromA.map(p => p.id), idsFromB = trade.fromB.map(p => p.id);
    let movedFromA2 = [], movedFromB2 = [];
    const afterRemoval2 = activeSeason.members.map(m => {
      if (m.teamId === teamAId) { const roster = m.roster || []; movedFromA2 = roster.filter(p => idsFromA.includes(p.id)); return { ...m, roster: roster.filter(p => !idsFromA.includes(p.id)) }; }
      if (m.teamId === teamBId) { const roster = m.roster || []; movedFromB2 = roster.filter(p => idsFromB.includes(p.id)); return { ...m, roster: roster.filter(p => !idsFromB.includes(p.id)) }; }
      return m;
    });
    const finalMembers2 = afterRemoval2.map(m => {
      if (m.teamId === teamAId) return { ...m, roster: [...(m.roster || []), ...movedFromB2] };
      if (m.teamId === teamBId) return { ...m, roster: [...(m.roster || []), ...movedFromA2] };
      return m;
    });
    const nameA2 = (teamsById[teamAId] && teamsById[teamAId].name) || 'Team A';
    const nameB2 = (teamsById[teamBId] && teamsById[teamBId].name) || 'Team B';
    const parts2 = [];
    if (movedFromA2.length) parts2.push(`${movedFromA2.map(p => p.name).join(', ')} to ${nameB2}`);
    if (movedFromB2.length) parts2.push(`${movedFromB2.map(p => p.name).join(', ')} to ${nameA2}`);
    const logEntry2 = { id: uid('act'), type: 'trade', teamId: teamAId, toTeamId: teamBId, text: `Trade: ${parts2.join(' — ')}`, at: Date.now() };
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, members: finalMembers2, activityLog: [...(s.activityLog || []), logEntry2], pendingTrades: (s.pendingTrades || []).filter(t => t.id !== tradeId) } : s);
    persistLeague({ ...league, seasons });
  };
  const discardTradeProposal = (tradeId) => {
    if (!league || !activeSeason) return;
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, pendingTrades: (s.pendingTrades || []).filter(t => t.id !== tradeId) } : s);
    persistLeague({ ...league, seasons });
  };
  // Rebrands are season-scoped (member.rebrand), not a change to the global
  // team record, so other seasons — and this team's own history before the
  // rebrand — keep showing the original identity.
  const rebrandTeam = (teamId, { name, color, logoUrl, wordmarkUrl }) => {
    if (!league || !activeSeason) return;
    const member = activeSeason.members.find(m => m.teamId === teamId);
    const globalTeam = teamsById[teamId];
    const oldName = (member && member.rebrand && member.rebrand.name) || (globalTeam && globalTeam.name) || 'This team';
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? {
      ...s,
      members: s.members.map(m => m.teamId === teamId ? { ...m, rebrand: { name, color: color || null, logoUrl: logoUrl || null, wordmarkUrl: wordmarkUrl || null } } : m),
      activityLog: [...(s.activityLog || []), { id: uid('act'), type: 'rebrand', teamId, text: `${oldName} rebranded to ${name}`, at: Date.now() }],
    } : s);
    persistLeague(appendAuditEntry({ ...league, seasons }, 'Team rebranded', `${oldName} → ${name}`));
  };
  const clearRebrand = (teamId) => {
    if (!league || !activeSeason) return;
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, members: s.members.map(m => m.teamId === teamId ? { ...m, rebrand: null } : m) } : s);
    persistLeague({ ...league, seasons });
  };

  // Imports a whole multi-team roster spreadsheet at once: for each team block,
  // finds a matching existing team (by name) or creates one, then merges in the
  // parsed players — updating role/star level for players that already exist
  // (matched by name) so re-importing an updated sheet doesn't wipe out stats
  // you've already entered, and adding anyone new.
  // Resolves a sheet's raw team-name text to a local team id: an explicit
  // resolution (the admin picking the correct team for a name that didn't
  // auto-match — a rebrand the sheet predates is the usual reason) always
  // wins; otherwise tries an exact normalized-name match against the
  // global team registry, and only creates a brand-new team if nothing
  // matched at all. Mutates teamsByIdDraft/teamsIndexDraft in place.
  const resolveOrCreateTeam = async (teamName, resolutions, teamsByIdDraft, teamsIndexDraft) => {
    if (resolutions && resolutions[teamName]) return resolutions[teamName];
    const normTeamName = normalizeTeamName(teamName);
    let gt = Object.values(teamsByIdDraft).find(t => normalizeTeamName(t.name) === normTeamName);
    if (!gt) {
      const idxEntry = teamsIndexDraft.find(t => normalizeTeamName(t.name) === normTeamName);
      if (idxEntry) { gt = await loadObj(`team:${idxEntry.id}`); if (gt) teamsByIdDraft[idxEntry.id] = gt; }
    }
    if (!gt) {
      gt = { id: uid('t'), name: teamName, color: null, logoUrl: null, wordmarkUrl: null, createdAt: Date.now() };
      teamsByIdDraft[gt.id] = gt;
      teamsIndexDraft.push({ id: gt.id, name: gt.name });
      await saveObj(`team:${gt.id}`, gt);
    }
    return gt.id;
  };
  // Makes sure the season has a member row (with a roster array to push
  // players into) for this team, creating one if this is its first
  // appearance in the season. Returns the updated members array and the
  // row's index.
  const ensureSeasonMember = (membersDraft, teamId, scheduleName) => {
    let idx = membersDraft.findIndex(m => m.teamId === teamId);
    if (idx < 0) {
      membersDraft = [...membersDraft, { teamId, scheduleName, baselineW: 0, baselineL: 0, baselineRF: 0, baselineRA: 0, active: true, roster: [] }];
      idx = membersDraft.length - 1;
    }
    return { membersDraft, idx };
  };
  const importRosterSheet = async (blocks, resolutions) => {
    if (!league || !activeSeason) return;
    const teamsByIdDraft = { ...teamsById };
    const teamsIndexDraft = [...teamsIndex];
    let membersDraft = [...activeSeason.members];
    // A player who's currently listed as a free agent this season gets
    // moved onto the roster (and dropped from free agency) instead of being
    // duplicated as a brand-new player when a sheet re-drafts/re-signs them.
    let freeAgentsDraft = [...(activeSeason.freeAgents || [])];
    const normPN = (s) => (s || '').trim().toLowerCase();
    const matchesName = (p, n) => normPN(p.name) === n || (p.usernameHistory || []).some(h => normPN(h) === n);

    for (const block of blocks) {
      const teamName = (block.teamName || '').trim();
      if (!teamName) continue;
      const teamId = await resolveOrCreateTeam(teamName, resolutions, teamsByIdDraft, teamsIndexDraft);
      const ensured = ensureSeasonMember(membersDraft, teamId, teamName);
      membersDraft = ensured.membersDraft;
      const memberIdx = ensured.idx;
      // Full replace, not merge: the sheet is the source of truth for this
      // team's roster on every import, so re-importing an updated sheet
      // can't leave stale players behind or create name-variant duplicates.
      // Dedupe within the sheet itself too (case-insensitive name), keeping
      // the last row if a name appears twice in one import.
      const seen = new Map();
      block.players.forEach(pl => { if (pl.name) seen.set(pl.name.toLowerCase(), pl); });
      // A returning player keeps their existing record (id, robloxUserId,
      // usernameHistory, banned/suspended state, ...) instead of getting
      // recreated from scratch — matched by their current name OR any past
      // username, so a sheet that still uses someone's old on-site name
      // (before a rename synced) reuses that same identity rather than
      // forking a second one. If the match came through an old name, the
      // already-resolved current name wins over the sheet's stale one.
      const existingRoster = (membersDraft[memberIdx] && membersDraft[memberIdx].roster) || [];
      const newRoster = [...seen.values()].map(pl => {
        const n = normPN(pl.name);
        const existing = existingRoster.find(p => matchesName(p, n));
        if (existing) {
          return { ...existing, name: normPN(existing.name) === n ? pl.name : existing.name, starLevel: pl.starLevel, role: pl.role };
        }
        const faIdx = freeAgentsDraft.findIndex(p => matchesName(p, n));
        if (faIdx >= 0) {
          const fa = freeAgentsDraft[faIdx];
          freeAgentsDraft = freeAgentsDraft.filter((_, i) => i !== faIdx);
          return { ...fa, name: normPN(fa.name) === n ? pl.name : fa.name, starLevel: pl.starLevel, role: pl.role };
        }
        return { ...newPlayer(pl.name, pl.starLevel), role: pl.role };
      });
      membersDraft = membersDraft.map((m, i) => i === memberIdx ? { ...m, roster: newRoster } : m);
    }

    setTeamsById(teamsByIdDraft);
    setTeamsIndex(teamsIndexDraft); saveList('teams-index', teamsIndexDraft);
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, members: membersDraft, freeAgents: freeAgentsDraft } : s);
    persistLeague({ ...league, seasons });
  };
  // Imports a draft board: each pick either sets draftPick on a player
  // already on that team's roster (matched by name/usernameHistory, same
  // identity rules as everywhere else) or creates them there if the draft
  // is the first record of them existing at all.
  const importDraftBoard = async (picks, resolutions) => {
    if (!league || !activeSeason) return;
    const teamsByIdDraft = { ...teamsById };
    const teamsIndexDraft = [...teamsIndex];
    let membersDraft = [...activeSeason.members];
    // A drafted player who's currently a free agent this season gets moved
    // onto the team instead of being duplicated as a new player.
    let freeAgentsDraft = [...(activeSeason.freeAgents || [])];
    const normPN = (s) => (s || '').trim().toLowerCase();
    const matchesName = (p, n) => normPN(p.name) === n || (p.usernameHistory || []).some(h => normPN(h) === n);

    for (const pick of picks) {
      const teamId = await resolveOrCreateTeam(pick.teamName, resolutions, teamsByIdDraft, teamsIndexDraft);
      const ensured = ensureSeasonMember(membersDraft, teamId, pick.teamName);
      membersDraft = ensured.membersDraft;
      const memberIdx = ensured.idx;
      const roster = membersDraft[memberIdx].roster || [];
      const n = normPN(pick.playerName);
      const existingIdx = roster.findIndex(p => matchesName(p, n));
      const draftPick = { round: pick.round, pickInRound: pick.pickInRound, overall: pick.overall };
      let newRoster;
      if (existingIdx >= 0) {
        newRoster = roster.map((p, i) => i === existingIdx ? { ...p, draftPick } : p);
      } else {
        const faIdx = freeAgentsDraft.findIndex(p => matchesName(p, n));
        if (faIdx >= 0) {
          const fa = freeAgentsDraft[faIdx];
          freeAgentsDraft = freeAgentsDraft.filter((_, i) => i !== faIdx);
          newRoster = [...roster, { ...fa, draftPick }];
        } else {
          newRoster = [...roster, { ...newPlayer(pick.playerName, null), draftPick }];
        }
      }
      membersDraft = membersDraft.map((m, i) => i === memberIdx ? { ...m, roster: newRoster } : m);
    }

    setTeamsById(teamsByIdDraft);
    setTeamsIndex(teamsIndexDraft); saveList('teams-index', teamsIndexDraft);
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, members: membersDraft, freeAgents: freeAgentsDraft } : s);
    persistLeague({ ...league, seasons });
  };
  // Imports a flat star-rating sheet: applies starLevel to a matched
  // player (on the given team, or as a free agent when the sheet left the
  // team blank), creating them if this is the first record of them.
  const importStarsSheet = async (rows, resolutions) => {
    if (!league || !activeSeason) return;
    const teamsByIdDraft = { ...teamsById };
    const teamsIndexDraft = [...teamsIndex];
    let membersDraft = [...activeSeason.members];
    let freeAgentsDraft = [...(activeSeason.freeAgents || [])];
    const normPN = (s) => (s || '').trim().toLowerCase();
    const matchesName = (p, n) => normPN(p.name) === n || (p.usernameHistory || []).some(h => normPN(h) === n);

    for (const row of rows) {
      const n = normPN(row.playerName);
      if (!row.teamName) {
        const idx = freeAgentsDraft.findIndex(p => matchesName(p, n));
        freeAgentsDraft = idx >= 0
          ? freeAgentsDraft.map((p, i) => i === idx ? { ...p, starLevel: row.starLevel } : p)
          : [...freeAgentsDraft, { ...newPlayer(row.playerName, row.starLevel) }];
        continue;
      }
      const teamId = await resolveOrCreateTeam(row.teamName, resolutions, teamsByIdDraft, teamsIndexDraft);
      const ensured = ensureSeasonMember(membersDraft, teamId, row.teamName);
      membersDraft = ensured.membersDraft;
      const memberIdx = ensured.idx;
      const roster = membersDraft[memberIdx].roster || [];
      const existingIdx = roster.findIndex(p => matchesName(p, n));
      let newRoster;
      if (existingIdx >= 0) {
        newRoster = roster.map((p, i) => i === existingIdx ? { ...p, starLevel: row.starLevel } : p);
      } else {
        // A player who's currently a free agent this season is moved onto
        // the team instead of being duplicated as a new player.
        const faIdx = freeAgentsDraft.findIndex(p => matchesName(p, n));
        if (faIdx >= 0) {
          const fa = freeAgentsDraft[faIdx];
          freeAgentsDraft = freeAgentsDraft.filter((_, i) => i !== faIdx);
          newRoster = [...roster, { ...fa, starLevel: row.starLevel }];
        } else {
          newRoster = [...roster, newPlayer(row.playerName, row.starLevel)];
        }
      }
      membersDraft = membersDraft.map((m, i) => i === memberIdx ? { ...m, roster: newRoster } : m);
    }

    setTeamsById(teamsByIdDraft);
    setTeamsIndex(teamsIndexDraft); saveList('teams-index', teamsIndexDraft);
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, members: membersDraft, freeAgents: freeAgentsDraft } : s);
    persistLeague({ ...league, seasons });
  };

  /* ---- KPB (hcbb.info) stat import ---- */
  // Converts hcbb.info's per-season combined batting+pitching totals for one
  // player into this app's normalized stat-row shape. hcbb's innings_pitched
  // is true decimal innings; this app stores IP in the ".1/.2 = thirds of an
  // inning" box-score notation everywhere else, so it has to be converted
  // via outs rather than copied straight across.
  const hcbbRowToStatFields = (hp) => ({
    // games_played covers every game this player appeared in at all (the
    // same "one row = one game" convention the rest of the app uses for G),
    // so it's what stands in for a game count on this single aggregate row.
    g: hp.games_played || 0,
    ab: hp.at_bats || 0, r: hp.runs_scored || 0, h: hp.hits || 0, rbi: hp.rbis || 0,
    bb: hp.walks || 0, so: hp.strikeouts || 0,
    ip: outsToIpDisplay(Math.round((hp.innings_pitched || 0) * 3)),
    ha: hp.hits_allowed || 0, er: hp.er || 0, bbAllowed: hp.walks_pitching || 0,
    k: hp.strikeouts_pitched || 0, hrAllowed: hp.homeruns_allowed || 0, e: hp.errors || 0,
    hr: hp.homeruns || 0, doubles: hp.doubles || 0, triples: hp.triples || 0,
  });
  // mapping: { '1': localSeasonId|null, '2': ..., '3': ... }. Runs entirely
  // client-side (this is an admin-triggered, one-off bulk action, not
  // something that needs a server route beyond the CORS proxy) and returns a
  // summary object the UI reports back to whoever ran it. Re-running with the
  // same mapping is safe — each import line is keyed by (source, source
  // season, player) and replaced rather than duplicated.
  const runKpbImport = async (mapping) => {
    if (!league) return { error: 'No league loaded.' };
    const seasonEntries = Object.entries(mapping).filter(([, sid]) => sid);
    if (seasonEntries.length === 0) return { error: 'Pick at least one season to import into.' };

    const norm = (s) => (s || '').trim().toLowerCase();
    // Deep-enough clone: every array that might get a new/changed player
    // needs its own copy so mutations below don't touch the live league
    // state until the single persistLeague call at the end.
    const seasonsDraft = league.seasons.map(s => ({
      ...s,
      members: (s.members || []).map(m => ({ ...m, roster: (m.roster || []).map(p => ({ ...p })) })),
      freeAgents: (s.freeAgents || []).map(p => ({ ...p })),
      importedStatLines: [...(s.importedStatLines || [])],
    }));

    const collectEntries = () => {
      const out = [];
      seasonsDraft.forEach(s => {
        s.members.forEach(m => m.roster.forEach(p => out.push({ seasonId: s.id, teamId: m.teamId, player: p })));
        s.freeAgents.forEach(p => out.push({ seasonId: s.id, teamId: null, player: p }));
      });
      return out;
    };
    const allEntries = collectEntries();
    if (allEntries.length === 0) return { error: 'No players tracked in this league yet — nothing to match hcbb.info players against.' };

    // Resolve a Roblox account id for every local name that doesn't already
    // have one, so matching goes by id (survives Roblox username changes)
    // rather than a name that might be stale. Deduped by name and rate-
    // limited to a handful of concurrent lookups since this can be dozens of
    // players.
    const nameToId = new Map();
    allEntries.forEach(({ player }) => { if (player.robloxUserId) nameToId.set(norm(player.name), player.robloxUserId); });
    const unresolvedNames = [...new Set(allEntries.filter(({ player }) => !player.robloxUserId).map(({ player }) => norm(player.name)))];
    const CONCURRENCY = 5;
    for (let i = 0; i < unresolvedNames.length; i += CONCURRENCY) {
      const batch = unresolvedNames.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (nm) => {
        try {
          const res = await fetch(`/api/roblox-avatar?username=${encodeURIComponent(nm)}`);
          if (res.ok) { const data = await res.json(); if (data.userId) nameToId.set(nm, data.userId); }
        } catch (e) { /* leave unresolved — this player just won't match */ }
      }));
    }
    allEntries.forEach(({ player }) => { if (!player.robloxUserId) { const id = nameToId.get(norm(player.name)); if (id) player.robloxUserId = id; } });

    const byRobloxId = new Map();
    allEntries.forEach(entry => {
      const id = entry.player.robloxUserId;
      if (!id) return;
      if (!byRobloxId.has(id)) byRobloxId.set(id, []);
      byRobloxId.get(id).push(entry);
    });

    const seasonById = new Map(seasonsDraft.map(s => [s.id, s]));
    const summary = { seasons: {} };

    for (const [kpbSeason, targetSeasonId] of seasonEntries) {
      const targetSeason = seasonById.get(targetSeasonId);
      const sourceLabel = `KPB S${kpbSeason}`;
      if (!targetSeason) { summary.seasons[kpbSeason] = { error: 'That local season no longer exists.' }; continue; }
      let data;
      try {
        const res = await fetch(`/api/hcbb-import?season=${kpbSeason}`);
        if (!res.ok) { summary.seasons[kpbSeason] = { error: `hcbb.info request failed (${res.status}).` }; continue; }
        data = await res.json();
      } catch (e) { summary.seasons[kpbSeason] = { error: 'Network error contacting hcbb.info.' }; continue; }

      let matched = 0, unmatched = 0, created = 0;
      (data.players || []).forEach(hp => {
        const robloxId = hp.player_id;
        const locals = robloxId ? byRobloxId.get(robloxId) : null;
        if (!locals || locals.length === 0) { unmatched++; return; }
        matched++;
        let entry = locals.find(e => e.seasonId === targetSeasonId);
        if (!entry) {
          // Known player, but not part of this local season yet — land them
          // as a free agent so the import has somewhere to attach and they
          // still show up in that season's stat leaders.
          const bestName = locals[locals.length - 1].player.name;
          const newFa = { ...newPlayer(bestName), robloxUserId: robloxId };
          targetSeason.freeAgents.push(newFa);
          entry = { seasonId: targetSeasonId, teamId: null, player: newFa };
          byRobloxId.get(robloxId).push(entry);
          created++;
        }
        const line = {
          id: uid('imp'), playerId: entry.player.id, source: 'hcbb-kpb', sourceSeason: String(kpbSeason), sourceLabel,
          importedAt: Date.now(), ...hcbbRowToStatFields(hp),
        };
        const existingIdx = targetSeason.importedStatLines.findIndex(l => l.source === 'hcbb-kpb' && l.sourceSeason === String(kpbSeason) && l.playerId === entry.player.id);
        if (existingIdx >= 0) targetSeason.importedStatLines[existingIdx] = line;
        else targetSeason.importedStatLines.push(line);
      });
      summary.seasons[kpbSeason] = { targetSeasonName: targetSeason.name, matched, unmatched, created, total: (data.players || []).length };
    }

    persistLeague({ ...league, seasons: seasonsDraft });
    return summary;
  };

  // Walks every player's Roblox account id, pulls their full past-username
  // history from Roblox, and backfills that id onto any other roster/free
  // agent entry anywhere in the league whose name matches one of those past
  // usernames — the case the site owner reported: a player shows up as a
  // free agent for some past season under an old username because that
  // season's entry was never individually visited (which is what triggers
  // the site's normal per-page-view rename sync), so it never got linked to
  // the rest of their history. getPlayerCareerData already unions any
  // entries that share a robloxUserId (or a name/usernameHistory overlap)
  // into one page, so once every entry that's really the same person carries
  // the same id, their pages combine automatically — no separate "merge"
  // step needed. Also folds every known past name into usernameHistory on
  // each linked entry, so future sheet imports (which match by name, not by
  // Roblox id) find the same identity too.
  // Two entries that already carry two DIFFERENT non-null Roblox ids are
  // left alone and reported as a conflict rather than guessed at — that's
  // either two different real people who happened to share a username at
  // different times, or a bad manual edit, and either way isn't safe to
  // auto-merge.
  const syncPlayerIdentities = async () => {
    if (!league) return { error: 'No league loaded.' };
    const norm = (s) => (s || '').trim().toLowerCase();
    const seasonsDraft = league.seasons.map(s => ({
      ...s,
      members: (s.members || []).map(m => ({ ...m, roster: (m.roster || []).map(p => ({ ...p })) })),
      freeAgents: (s.freeAgents || []).map(p => ({ ...p })),
    }));
    const allEntries = [];
    seasonsDraft.forEach(s => {
      s.members.forEach(m => m.roster.forEach(p => allEntries.push(p)));
      s.freeAgents.forEach(p => allEntries.push(p));
    });
    if (allEntries.length === 0) return { error: 'No players tracked in this league yet.' };

    // Resolve a Roblox id for every entry that doesn't have one yet, same
    // as the KPB import's bulk lookup, so as many entries as possible start
    // this pass already carrying an id to look up history for.
    const nameToId = new Map();
    allEntries.forEach(p => { if (p.robloxUserId) nameToId.set(norm(p.name), p.robloxUserId); });
    const unresolvedNames = [...new Set(allEntries.filter(p => !p.robloxUserId).map(p => norm(p.name)))];
    const CONCURRENCY = 5;
    for (let i = 0; i < unresolvedNames.length; i += CONCURRENCY) {
      const batch = unresolvedNames.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (nm) => {
        try {
          const res = await fetch(`/api/roblox-avatar?username=${encodeURIComponent(nm)}`);
          if (res.ok) { const data = await res.json(); if (data.userId) nameToId.set(nm, data.userId); }
        } catch (e) { /* leave unresolved */ }
      }));
    }
    allEntries.forEach(p => { if (!p.robloxUserId) { const id = nameToId.get(norm(p.name)); if (id) p.robloxUserId = id; } });

    const knownIds = [...new Set(allEntries.map(p => p.robloxUserId).filter(Boolean))];
    // Properly-cased usernames from Roblox, keyed by id — kept as Roblox
    // returns them (not lowercased) so usernameHistory stays readable.
    const historyById = new Map();
    for (let i = 0; i < knownIds.length; i += CONCURRENCY) {
      const batch = knownIds.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (id) => {
        try {
          const res = await fetch(`/api/roblox-username-history?userId=${encodeURIComponent(id)}`);
          if (res.ok) { const data = await res.json(); historyById.set(id, data.usernames || []); }
        } catch (e) { /* leave this id's history unknown — it just won't link anything new */ }
      }));
    }

    let linked = 0;
    let namesEnriched = 0;
    const conflicts = [];
    knownIds.forEach(id => {
      // Every name known to belong to this Roblox id: its Roblox history,
      // plus every local entry already confirmed to carry this id (current
      // name and any usernameHistory already recorded) — normalized key to
      // dedupe, but keeping the best-known original casing for storage.
      const namesById = new Map();
      (historyById.get(id) || []).forEach(nm => namesById.set(norm(nm), nm));
      allEntries.forEach(p => {
        if (p.robloxUserId !== id) return;
        if (!namesById.has(norm(p.name))) namesById.set(norm(p.name), p.name);
        (p.usernameHistory || []).forEach(h => { if (!namesById.has(norm(h))) namesById.set(norm(h), h); });
      });
      if (namesById.size === 0) return;
      const normSet = new Set(namesById.keys());

      allEntries.forEach(p => {
        const n = norm(p.name);
        const matchesPastName = normSet.has(n) || (p.usernameHistory || []).some(h => normSet.has(norm(h)));
        if (!matchesPastName) return;
        if (!p.robloxUserId) { p.robloxUserId = id; linked++; }
        else if (p.robloxUserId !== id) {
          conflicts.push({ name: p.name, existingId: p.robloxUserId, conflictingId: id });
          return;
        }
        const existingNorm = new Set((p.usernameHistory || []).map(norm));
        const additions = [...namesById.entries()].filter(([nk]) => nk !== n && !existingNorm.has(nk)).map(([, nv]) => nv);
        if (additions.length > 0) { p.usernameHistory = [...(p.usernameHistory || []), ...additions]; namesEnriched++; }
      });
    });

    persistLeague({ ...league, seasons: seasonsDraft });
    return { checked: knownIds.length, linked, namesEnriched, conflicts };
  };

  /* ---- awards ---- */
  const addAwardDef = (name, description) => {
    if (!league) return;
    const def = newAwardDef(name, description);
    persistLeague({ ...league, awardDefs: [...(league.awardDefs || []), def] });
  };
  const updateAwardDef = (id, field, value) => {
    if (!league) return;
    persistLeague({ ...league, awardDefs: (league.awardDefs || []).map(a => a.id === id ? { ...a, [field]: value } : a) });
  };
  const removeAwardDef = (id) => {
    if (!league) return;
    if (!confirm('Delete this award? Past winners recorded for it will be removed too.')) return;
    const seasons = league.seasons.map(s => {
      if (!s.awardWinners || !s.awardWinners[id]) return s;
      const aw = { ...s.awardWinners }; delete aw[id];
      return { ...s, awardWinners: aw };
    });
    persistLeague({ ...league, awardDefs: (league.awardDefs || []).filter(a => a.id !== id), seasons });
  };
  const addAwardWinner = (awardId, winner) => {
    if (!league || !activeSeason) return;
    const seasons = league.seasons.map(s => {
      if (s.id !== activeSeason.id) return s;
      const list = normalizeAwardWinners((s.awardWinners || {})[awardId]);
      const isDup = list.some(w => w.type === winner.type && (
        winner.type === 'team' ? w.teamId === winner.teamId
        : winner.playerId ? w.playerId === winner.playerId
        : (w.name || '').trim().toLowerCase() === (winner.name || '').trim().toLowerCase()
      ));
      if (isDup) return s;
      return { ...s, awardWinners: { ...(s.awardWinners || {}), [awardId]: [...list, winner] } };
    });
    persistLeague({ ...league, seasons });
  };
  const removeAwardWinnerAt = (awardId, index) => {
    if (!league || !activeSeason) return;
    const seasons = league.seasons.map(s => {
      if (s.id !== activeSeason.id || !s.awardWinners || !s.awardWinners[awardId]) return s;
      const list = normalizeAwardWinners(s.awardWinners[awardId]).filter((_, i) => i !== index);
      const aw = { ...s.awardWinners };
      if (list.length === 0) delete aw[awardId]; else aw[awardId] = list;
      return { ...s, awardWinners: aw };
    });
    persistLeague({ ...league, seasons });
  };
  /* ---- hall of fame ---- */
  const addHallOfFameEntry = (name, note, year, playerName) => {
    if (!league || !name.trim()) return;
    const entry = { id: uid('hof'), name: name.trim(), note: (note || '').trim(), year: (year || '').trim(), playerName: (playerName || '').trim() || null, addedAt: Date.now() };
    persistLeague(appendAuditEntry({ ...league, hallOfFame: [...(league.hallOfFame || []), entry] }, 'Hall of Fame inductee added', entry.name));
  };
  const removeHallOfFameEntry = (id) => {
    if (!league) return;
    const entry = (league.hallOfFame || []).find(e => e.id === id);
    persistLeague(appendAuditEntry({ ...league, hallOfFame: (league.hallOfFame || []).filter(e => e.id !== id) }, 'Hall of Fame inductee removed', entry ? entry.name : id));
  };
  const removeActivityItem = (activityId, seasonId) => {
    if (!league) return;
    const targetId = seasonId || (activeSeason && activeSeason.id);
    if (!targetId) return;
    const seasons = league.seasons.map(s => s.id === targetId ? { ...s, activityLog: (s.activityLog || []).filter(a => a.id !== activityId) } : s);
    persistLeague({ ...league, seasons });
  };
  // Bulk version for "clear all" actions (e.g. a player's whole transactions
  // box) — one persist covering every season involved, rather than firing a
  // separate save per entry.
  const removeActivityItems = (items) => {
    if (!league || !items || items.length === 0) return;
    const idsBySeason = {};
    items.forEach(({ id, seasonId }) => { (idsBySeason[seasonId] = idsBySeason[seasonId] || new Set()).add(id); });
    const seasons = league.seasons.map(s => {
      const ids = idsBySeason[s.id];
      if (!ids) return s;
      return { ...s, activityLog: (s.activityLog || []).filter(a => !ids.has(a.id)) };
    });
    persistLeague({ ...league, seasons });
  };
  // A manual, site-owner-triggered rename of a specific set of entries —
  // unlike syncRobloxRename (which follows a Roblox account id automatically
  // wherever it goes), this fixes the case where a sheet import created a
  // stray, disconnected player from a misspelled name: renaming just that
  // entry to the correct spelling makes it match the real player's name on
  // the next page load, so getPlayerCareerData's closure folds it into the
  // same page — no separate merge step needed. Also keeps the old (bad)
  // name in usernameHistory so anything still referencing it — an old
  // activity log line, an unresolved robloxUserId — still resolves here
  // rather than forking a second identity again.
  // Also stamps nameOverride so the Roblox auto-sync effect (below) leaves
  // this name alone from now on — without it, a player whose robloxUserId
  // is already known would get silently renamed right back to their live
  // Roblox username on the very next admin visit, undoing this edit.
  const renamePlayer = (entries, newName) => {
    if (!league || !entries || entries.length === 0) return;
    const trimmed = (newName || '').trim();
    if (!trimmed) return;
    const targets = new Set(entries.map(e => `${e.seasonId}:${e.playerId}`));
    const renameIfTarget = (seasonId) => (p) => {
      if (!targets.has(`${seasonId}:${p.id}`)) return p;
      if (p.name === trimmed) return p.nameOverride ? p : { ...p, nameOverride: true };
      const history = [...new Set([...(p.usernameHistory || []), p.name])];
      return { ...p, name: trimmed, usernameHistory: history, nameOverride: true };
    };
    const seasons = league.seasons.map(s => ({
      ...s,
      members: (s.members || []).map(m => ({ ...m, roster: (m.roster || []).map(renameIfTarget(s.id)) })),
      freeAgents: (s.freeAgents || []).map(renameIfTarget(s.id)),
    }));
    persistLeague({ ...league, seasons });
  };
  /* ---- Roblox identity (avatar id + username-change sync) ---- */
  // The first time a player's Roblox avatar resolves, stamp their account id
  // onto every roster/free-agent entry across every season that currently
  // shares their name — matched by name since that's all there is to go on
  // before an id exists. From then on lookups go by id instead of name.
  const backfillRobloxId = (name, robloxUserId) => {
    if (!league || !robloxUserId) return;
    const norm = (s) => (s || '').trim().toLowerCase();
    const target = norm(name);
    let changed = false;
    const setIfMatch = (p) => {
      if (!p.robloxUserId && norm(p.name) === target) { changed = true; return { ...p, robloxUserId }; }
      return p;
    };
    const seasons = league.seasons.map(s => ({
      ...s,
      members: (s.members || []).map(m => ({ ...m, roster: (m.roster || []).map(setIfMatch) })),
      freeAgents: (s.freeAgents || []).map(setIfMatch),
    }));
    if (!changed) return;
    persistLeague({ ...league, seasons });
  };
  // Once an id is known, a live username lookup that no longer matches the
  // stored name means the Roblox account was renamed — propagate the new
  // name to every roster/free-agent entry sharing that id, across every
  // season, so the whole career (not just the current season) follows the
  // rename instead of splitting into two identities under two names.
  // Skips any entry a site owner has manually renamed (nameOverride) —
  // otherwise a manual rename would just get silently overwritten back to
  // the live Roblox username on the admin's very next visit to the page.
  const syncRobloxRename = (robloxUserId, newName) => {
    if (!league || !robloxUserId || !newName) return;
    let changed = false;
    const renameIfMatch = (p) => {
      if (p.robloxUserId === robloxUserId && p.name !== newName && !p.nameOverride) {
        changed = true;
        // Keep every past name this identity has shown up under — a roster
        // import (or an old activity log entry) using an old username still
        // needs to resolve back to this same player instead of forking off
        // a second identity.
        const history = [...new Set([...(p.usernameHistory || []), p.name])];
        return { ...p, name: newName, usernameHistory: history };
      }
      return p;
    };
    const seasons = league.seasons.map(s => ({
      ...s,
      members: (s.members || []).map(m => ({ ...m, roster: (m.roster || []).map(renameIfMatch) })),
      freeAgents: (s.freeAgents || []).map(renameIfMatch),
    }));
    if (!changed) return;
    persistLeague({ ...league, seasons });
  };
  // The identity closure getPlayerCareerData/computeCareerLeaders use is
  // automatic (shared Roblox id, or overlapping usernameHistory) — this
  // covers the case it can't: two genuinely-the-same person entered under
  // unrelated names with no id set on either. Non-destructive: it doesn't
  // rewrite any existing record, it just adds mergeName into every current
  // "keepName" record's usernameHistory, which is enough for the union-find
  // closure to link both names into one identity everywhere it's computed.
  const mergePlayers = (keepName, mergeName) => {
    if (!league || !keepName || !mergeName) return;
    const norm = (s) => (s || '').trim().toLowerCase();
    const target = norm(keepName);
    let changed = false;
    const addIfMatch = (p) => {
      if (norm(p.name) === target) {
        const history = [...new Set([...(p.usernameHistory || []), mergeName.trim()])];
        if (history.length !== (p.usernameHistory || []).length) changed = true;
        return { ...p, usernameHistory: history };
      }
      return p;
    };
    const seasons = league.seasons.map(s => ({
      ...s,
      members: (s.members || []).map(m => ({ ...m, roster: (m.roster || []).map(addIfMatch) })),
      freeAgents: (s.freeAgents || []).map(addIfMatch),
    }));
    if (!changed) return;
    persistLeague(appendAuditEntry({ ...league, seasons }, 'Players merged', `${mergeName} → ${keepName}`));
  };

  /* ---- player badges, accolades, team credits, manual stat lines ---- */
  // None of these are tied to a season-scoped roster/free-agent id — they
  // belong to the player's whole career — so they're keyed the same way
  // getPlayerCareerData resolves identity: preferably their Roblox account
  // id (stable across renames), falling back to their normalized current
  // name when no id is known yet. Lookups on the player page union every
  // key this identity has ever been known by (id + every past/current
  // name), so an entry written under an old name-key before an id existed
  // still surfaces once the id is linked — no migration needed.
  const setBadgeDefs = (defs) => { if (league) persistLeague({ ...league, badgeDefs: defs }); };
  const addBadgeDef = (name, icon, color, imageUrl) => {
    if (!league || !name.trim()) return;
    const def = { id: uid('badge'), name: name.trim(), icon: (icon || '').trim() || '★', color: color || GOLD, imageUrl: imageUrl || null };
    persistLeague(appendAuditEntry({ ...league, badgeDefs: [...(league.badgeDefs || []), def] }, 'Badge created', def.name));
  };
  const removeBadgeDef = (badgeId) => {
    if (!league) return;
    const def = (league.badgeDefs || []).find(b => b.id === badgeId);
    persistLeague(appendAuditEntry({ ...league, badgeDefs: (league.badgeDefs || []).filter(b => b.id !== badgeId) }, 'Badge removed', def ? def.name : badgeId));
  };
  const setPlayerBadges = (identityKey, badgeIds) => {
    if (!league || !identityKey) return;
    persistLeague({ ...league, playerProfiles: { ...(league.playerProfiles || {}), [identityKey]: { ...((league.playerProfiles || {})[identityKey] || {}), badges: badgeIds } } });
  };
  const addPlayerAccolade = (identityKey, name, seasonName) => {
    if (!league || !identityKey || !name.trim()) return;
    const profiles = league.playerProfiles || {};
    const existing = profiles[identityKey] || {};
    const accolades = [...(existing.accolades || []), { id: uid('acc'), name: name.trim(), seasonName: (seasonName || '').trim() }];
    persistLeague({ ...league, playerProfiles: { ...profiles, [identityKey]: { ...existing, accolades } } });
  };
  const removePlayerAccolade = (identityKey, accoladeId) => {
    if (!league) return;
    const profiles = league.playerProfiles || {};
    const existing = profiles[identityKey];
    if (!existing) return;
    persistLeague({ ...league, playerProfiles: { ...profiles, [identityKey]: { ...existing, accolades: (existing.accolades || []).filter(a => a.id !== accoladeId) } } });
  };
  const addPlayerTeamCredit = (identityKey, teamId, seasonLabel, note) => {
    if (!league || !identityKey || !teamId) return;
    const profiles = league.playerProfiles || {};
    const existing = profiles[identityKey] || {};
    const teamCredits = [...(existing.teamCredits || []), { id: uid('tc'), teamId, seasonLabel: (seasonLabel || '').trim(), note: (note || '').trim() }];
    persistLeague({ ...league, playerProfiles: { ...profiles, [identityKey]: { ...existing, teamCredits } } });
  };
  const removePlayerTeamCredit = (identityKey, creditId) => {
    if (!league) return;
    const profiles = league.playerProfiles || {};
    const existing = profiles[identityKey];
    if (!existing) return;
    persistLeague({ ...league, playerProfiles: { ...profiles, [identityKey]: { ...existing, teamCredits: (existing.teamCredits || []).filter(c => c.id !== creditId) } } });
  };
  // Manual stat lines reuse the exact same season.importedStatLines shape
  // the hcbb.info import writes (source distinguishes them: 'manual' vs
  // 'hcbb-kpb'), so they automatically flow through Stat Leaders and career
  // totals with no extra plumbing. Keyed on (source, playerId) — a season
  // only ever has one manual line per player, replaced on edit rather than
  // duplicated.
  const upsertManualStatLine = (seasonId, playerId, fields) => {
    if (!league || !seasonId || !playerId) return;
    const isPlayoff = !!fields.isPlayoff;
    const seasons = league.seasons.map(s => {
      if (s.id !== seasonId) return s;
      const lines = [...(s.importedStatLines || [])];
      // Regular season and playoffs are independent lines for the same
      // player/season, so the match has to include isPlayoff too — otherwise
      // saving one would silently overwrite the other.
      const idx = lines.findIndex(l => l.source === 'manual' && l.playerId === playerId && !!l.isPlayoff === isPlayoff);
      const line = { id: idx >= 0 ? lines[idx].id : uid('imp'), playerId, source: 'manual', sourceSeason: 'manual', sourceLabel: isPlayoff ? 'Manual entry (Playoffs)' : 'Manual entry', importedAt: Date.now(), ...fields, isPlayoff };
      if (idx >= 0) lines[idx] = line; else lines.push(line);
      return { ...s, importedStatLines: lines };
    });
    persistLeague({ ...league, seasons });
  };
  const deleteManualStatLine = (seasonId, lineId) => {
    if (!league) return;
    const seasons = league.seasons.map(s => s.id === seasonId ? { ...s, importedStatLines: (s.importedStatLines || []).filter(l => l.id !== lineId) } : s);
    persistLeague({ ...league, seasons });
  };

  /* ---- league info & staff ---- */
  const updateLeagueInfo = (patch) => {
    if (!league) return;
    const next = { ...league, info: { ...(league.info || {}), ...patch } };
    persistLeague(appendAuditEntry(next, 'League info updated', Object.keys(patch).join(', ')));
  };
  // Standalone audit entry for actions that don't already go through
  // persistLeague on their own — currently just role grants/changes/revokes,
  // which write straight to Supabase's admin_roles table (see
  // ManageAdminsPanel) rather than through the league kv_store.
  const logAudit = (action, detail) => { if (league) persistLeague(appendAuditEntry(league, action, detail)); };
  const addStaffMember = (name, role) => {
    if (!league) return;
    const member = { id: uid('staff'), name, role };
    persistLeague({ ...league, staff: [...(league.staff || []), member] });
  };
  const updateStaffMember = (id, field, value) => {
    if (!league) return;
    persistLeague({ ...league, staff: (league.staff || []).map(s => s.id === id ? { ...s, [field]: value } : s) });
  };
  const removeStaffMember = (id) => {
    if (!league) return;
    persistLeague({ ...league, staff: (league.staff || []).filter(s => s.id !== id) });
  };
  // Free-form extra links (Twitter, YouTube, Twitch, a website, a rulebook
  // doc, ...) alongside the dedicated Discord field — league.info.links is
  // an ordered {id, label, url} list rather than more named fields, since
  // there's no fixed set of platforms a league might want to link to.
  const addLeagueLink = (label, url) => {
    if (!league) return;
    const link = { id: uid('link'), label, url };
    const info = league.info || {};
    persistLeague({ ...league, info: { ...info, links: [...(info.links || []), link] } });
  };
  const updateLeagueLink = (id, field, value) => {
    if (!league) return;
    const info = league.info || {};
    persistLeague({ ...league, info: { ...info, links: (info.links || []).map(l => l.id === id ? { ...l, [field]: value } : l) } });
  };
  const removeLeagueLink = (id) => {
    if (!league) return;
    const info = league.info || {};
    persistLeague({ ...league, info: { ...info, links: (info.links || []).filter(l => l.id !== id) } });
  };

  /* ---- news ---- */
  const addNewsPost = (title, body, extra) => {
    if (!league) return;
    // rankings, when present, is a Power Rankings post: an ordered
    // [{teamId, blurb, prevRank}] array rendered as a numbered list with
    // move arrows instead of (or above) the free-text body.
    const post = { id: uid('news'), title, body, author: (extra && extra.author) || '', imageUrl: (extra && extra.imageUrl) || null, rankings: (extra && extra.rankings) || null, at: Date.now() };
    persistLeague({ ...league, news: [post, ...(league.news || [])] });
  };
  const updateNewsPost = (id, patch) => {
    if (!league) return;
    persistLeague({ ...league, news: (league.news || []).map(n => n.id === id ? { ...n, ...patch } : n) });
  };
  const removeNewsPost = (id) => {
    if (!league) return;
    if (!confirm('Delete this news post?')) return;
    persistLeague({ ...league, news: (league.news || []).filter(n => n.id !== id) });
  };

  const updateGlobalTeamField = (teamId, field, value) => {
    const gt = teamsById[teamId] || { id: teamId, name: (teamsIndex.find(t => t.id === teamId) || {}).name || '', color: null, logoUrl: null, wordmarkUrl: null, createdAt: Date.now() };
    const updated = { ...gt, [field]: value };
    setTeamsById(prev => ({ ...prev, [teamId]: updated }));
    queueSave(`team:${teamId}`, updated);
    if (field === 'name') { const idx = teamsIndex.map(t => t.id === teamId ? { ...t, name: value } : t); setTeamsIndex(idx); saveList('teams-index', idx); }
  };

  /* ---- schedule / games ops (act on active season) ---- */
  const resolveOrCreateMember = async (membersDraft, scheduleNameRaw, teamsByIdDraft, teamsIndexDraft) => {
    const scheduleName = scheduleNameRaw.trim();
    let m = membersDraft.find(m => (m.scheduleName || '').toLowerCase() === scheduleName.toLowerCase());
    if (m) return m.teamId;
    // check the FULL global roster (not just what's already loaded locally) so the same
    // team used across multiple seasons is reused instead of duplicated.
    let idxEntry = teamsIndexDraft.find(t => t.name.toLowerCase() === scheduleName.toLowerCase());
    let gt = idxEntry ? teamsByIdDraft[idxEntry.id] : null;
    if (idxEntry && !gt) { gt = await loadObj(`team:${idxEntry.id}`); if (gt) teamsByIdDraft[idxEntry.id] = gt; }
    if (!gt) {
      gt = { id: uid('t'), name: scheduleName, color: null, logoUrl: null, wordmarkUrl: null, createdAt: Date.now() };
      teamsByIdDraft[gt.id] = gt;
      teamsIndexDraft.push({ id: gt.id, name: gt.name });
      await saveObj(`team:${gt.id}`, gt);
    }
    const newMember = { teamId: gt.id, scheduleName, baselineW: 0, baselineL: 0, baselineRF: 0, baselineRA: 0, active: true };
    membersDraft.push(newMember);
    return gt.id;
  };

  const importGames = async (rows) => {
    if (!league || !activeSeason) return;
    const membersDraft = [...activeSeason.members];
    const teamsByIdDraft = { ...teamsById };
    const teamsIndexDraft = [...teamsIndex];
    const newGames = [];
    for (const r of rows) {
      const awayId = await resolveOrCreateMember(membersDraft, r.away, teamsByIdDraft, teamsIndexDraft);
      const homeId = await resolveOrCreateMember(membersDraft, r.home, teamsByIdDraft, teamsIndexDraft);
      const played = r.awayScore != null && r.homeScore != null;
      newGames.push({ id: uid('g'), date: r.date || '', awayTeamId: awayId, homeTeamId: homeId, awayScheduleName: r.away, homeScheduleName: r.home, awayScore: played ? r.awayScore : null, homeScore: played ? r.homeScore : null, innings: r.innings || (activeSeason.settings.standardInnings || 7), played });
    }
    setTeamsById(teamsByIdDraft);
    setTeamsIndex(teamsIndexDraft); saveList('teams-index', teamsIndexDraft);
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, members: membersDraft, games: [...s.games, ...newGames] } : s);
    persistLeague({ ...league, seasons });
  };
  const generateSchedule = (teamIds, roundsOfPlay, dateOptions) => {
    if (!league || !activeSeason || teamIds.length < 2) return;
    const pairs = generateRoundRobinSchedule(teamIds, roundsOfPlay);
    const maxRound = pairs.reduce((m, p) => Math.max(m, p.round), 0);
    const roundDates = dateOptions && dateOptions.startDate ? assignRoundDates(maxRound, dateOptions.startDate, dateOptions.blackoutWeekdays || []) : null;
    const newGames = pairs.map(p => {
      const away = teamsById[p.awayTeamId], home = teamsById[p.homeTeamId];
      return { id: uid('g'), date: roundDates ? roundDates[p.round - 1] : String(p.round), awayTeamId: p.awayTeamId, homeTeamId: p.homeTeamId, awayScheduleName: away ? away.name : '', homeScheduleName: home ? home.name : '', awayScore: null, homeScore: null, innings: activeSeason.settings.standardInnings || 7, played: false };
    });
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? {
      ...s, games: [...s.games, ...newGames],
      settings: { ...s.settings, scheduleMode: roundDates ? 'date' : 'round', blackoutWeekdays: dateOptions ? (dateOptions.blackoutWeekdays || []) : s.settings.blackoutWeekdays },
    } : s);
    persistLeague({ ...league, seasons });
  };
  const addManualGame = ({ date, awayTeamId, homeTeamId, isSpringTraining }) => {
    if (!league || !activeSeason) return;
    const away = teamsById[awayTeamId], home = teamsById[homeTeamId];
    // Normalize the round label the same way imported "Round N" headers are stored,
    // so a manually typed "Round 1" and an imported "Round 1" land in the same group
    // instead of silently splitting into two.
    let normalizedDate = date;
    if ((activeSeason.settings.scheduleMode || 'date') === 'round' && date) {
      const stripped = String(date).trim().replace(/^(round|rd|r|week|wk)\.?\s*#?\s*/i, '').trim();
      normalizedDate = stripped || date;
    }
    const g = { id: uid('g'), date: normalizedDate, awayTeamId, homeTeamId, awayScheduleName: away?.name, homeScheduleName: home?.name, awayScore: null, homeScore: null, innings: activeSeason.settings.standardInnings || 7, played: false, isSpringTraining: !!isSpringTraining };
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, games: [...s.games, g] } : s);
    persistLeague({ ...league, seasons });
  };
  // Recomputes the odds cache from a season's just-updated games and stashes
  // it on the season object being persisted — the one point where a score
  // change actually feeds back into standings, so it's the natural spot to
  // re-simulate once instead of leaving it to run live on every Odds visit.
  const withOddsCache = (updatedSeason) => {
    const oddsCache = computeOddsCache(updatedSeason, teamsById, buildH2H(updatedSeason.games));
    return { ...updatedSeason, oddsCache };
  };
  // One-time migration path for a season that has games/scores from before
  // this cache existed — an admin viewing Odds triggers this once so the
  // season gets a cache going forward, instead of leaving it permanently
  // uncached (see the effect in OddsView).
  const backfillOddsCache = () => {
    if (!league || !activeSeason || activeSeason.oddsCache) return;
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? withOddsCache(s) : s);
    persistLeague({ ...league, seasons });
  };
  const saveScore = (gameId, { awayScore, homeScore, innings }) => {
    if (!league || !activeSeason) return;
    const updatedGames = activeSeason.games.map(g => g.id === gameId ? { ...g, awayScore, homeScore, innings, played: true, isForfeit: false, forfeitBy: null, isOngoing: false, isDelayed: false } : g);
    const { games: afterPlayIn } = advancePlayIn(updatedGames);
    const { games, championTeamId } = advancePlayoffs(afterPlayIn, activeSeason.settings, seedById);
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? withOddsCache({ ...s, games, championTeamId: championTeamId !== undefined ? championTeamId : s.championTeamId }) : s);
    persistLeague({ ...league, seasons });
  };
  // Bulk score entry: applies every filled-in row from the spreadsheet-style
  // panel in one pass/one save, instead of one saveScore call (and one
  // persistLeague race) per game.
  const bulkSaveScores = (updates) => {
    if (!league || !activeSeason || !updates || updates.length === 0) return;
    const byGameId = new Map(updates.map(u => [u.gameId, u]));
    const updatedGames = activeSeason.games.map(g => {
      const u = byGameId.get(g.id);
      if (!u) return g;
      return { ...g, awayScore: u.awayScore, homeScore: u.homeScore, innings: u.innings, played: true, isForfeit: false, forfeitBy: null, isOngoing: false, isDelayed: false };
    });
    const { games: afterPlayIn } = advancePlayIn(updatedGames);
    const { games, championTeamId } = advancePlayoffs(afterPlayIn, activeSeason.settings, seedById);
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? withOddsCache({ ...s, games, championTeamId: championTeamId !== undefined ? championTeamId : s.championTeamId }) : s);
    persistLeague({ ...league, seasons });
  };
  const declareForfeit = (gameId, forfeitBy) => {
    if (!league || !activeSeason) return;
    const game = activeSeason.games.find(g => g.id === gameId);
    const homeScore = forfeitBy === 'home' ? 0 : 9;
    const awayScore = forfeitBy === 'away' ? 0 : 9;
    const updatedGames = activeSeason.games.map(g => g.id === gameId ? { ...g, awayScore, homeScore, innings: 0, played: true, isForfeit: true, forfeitBy, winnerOverride: null, isOngoing: false, isDelayed: false } : g);
    const { games: afterPlayIn } = advancePlayIn(updatedGames);
    const { games, championTeamId } = advancePlayoffs(afterPlayIn, activeSeason.settings, seedById);
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? withOddsCache({ ...s, games, championTeamId: championTeamId !== undefined ? championTeamId : s.championTeamId }) : s);
    const homeName = game ? ((teamsById[game.homeTeamId] && teamsById[game.homeTeamId].name) || 'Home') : 'Home';
    const awayName = game ? ((teamsById[game.awayTeamId] && teamsById[game.awayTeamId].name) || 'Away') : 'Away';
    persistLeague(appendAuditEntry({ ...league, seasons }, 'Forfeit declared', `${awayName} @ ${homeName} — ${forfeitBy === 'home' ? homeName : awayName} forfeited`));
  };
  // Marks a not-yet-final game as currently in progress — purely informational
  // (doesn't count toward standings/streaks, same as any unplayed game) but
  // surfaced with a "LIVE" badge in the schedule and its own panel on Home so
  // it's easy to see what's happening right now. Optionally carries a
  // live/in-progress score and period (inning/quarter/half, plus top/bottom
  // for sports that have it) for display only.
  const setGameOngoing = (gameId, ongoing, liveState) => {
    if (!league || !activeSeason) return;
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? {
      ...s, games: s.games.map(g => g.id === gameId ? {
        ...g,
        isOngoing: ongoing,
        // Going live/updating always means it's actually live again, and
        // ending live abandons the session entirely — either way this isn't
        // "delayed" anymore. Marking delayed is its own explicit action
        // (setGameDelayed) so a paused game's score survives in between.
        isDelayed: false,
        liveAwayScore: ongoing ? (liveState ? liveState.away : g.liveAwayScore) : null,
        liveHomeScore: ongoing ? (liveState ? liveState.home : g.liveHomeScore) : null,
        livePeriod: ongoing ? (liveState ? liveState.period : g.livePeriod) : null,
        liveHalf: ongoing ? (liveState ? liveState.half : g.liveHalf) : null,
      } : g)
    } : s);
    persistLeague({ ...league, seasons });
  };
  // Pauses a live game in place (weather delay, resumes later) without
  // wiping its live score/period the way ending live does — the schedule
  // shows "Delayed" instead of a pulsing "Live" badge until someone resumes
  // it or updates the score again.
  const setGameDelayed = (gameId, delayed) => {
    if (!league || !activeSeason) return;
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? {
      ...s, games: s.games.map(g => g.id === gameId ? { ...g, isDelayed: delayed } : g)
    } : s);
    persistLeague({ ...league, seasons });
  };
  const setWinnerOverride = (gameId, winnerOverride) => {
    if (!league || !activeSeason) return;
    const game = activeSeason.games.find(g => g.id === gameId);
    const updatedGames = activeSeason.games.map(g => g.id === gameId ? { ...g, winnerOverride } : g);
    const { games: afterPlayIn } = advancePlayIn(updatedGames);
    const { games, championTeamId } = advancePlayoffs(afterPlayIn, activeSeason.settings, seedById);
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? withOddsCache({ ...s, games, championTeamId: championTeamId !== undefined ? championTeamId : s.championTeamId }) : s);
    const homeName = game ? ((teamsById[game.homeTeamId] && teamsById[game.homeTeamId].name) || 'Home') : 'Home';
    const awayName = game ? ((teamsById[game.awayTeamId] && teamsById[game.awayTeamId].name) || 'Away') : 'Away';
    const winnerName = winnerOverride === 'home' ? homeName : winnerOverride === 'away' ? awayName : 'cleared';
    persistLeague(appendAuditEntry({ ...league, seasons }, 'Game winner overridden', `${awayName} @ ${homeName} — winner set to ${winnerName}`));
  };
  // Swaps which team is "home" vs "away" on a game — purely a relabeling, so
  // scores, live state, forfeit side, and any winner override all swap along
  // with it to keep pointing at the same actual result. Doesn't touch which
  // team actually won, so no need to re-run playoff advancement.
  const swapHomeAway = (gameId) => {
    if (!league || !activeSeason) return;
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? {
      ...s, games: s.games.map(g => g.id === gameId ? {
        ...g,
        homeTeamId: g.awayTeamId, awayTeamId: g.homeTeamId,
        homeScheduleName: g.awayScheduleName, awayScheduleName: g.homeScheduleName,
        homeScore: g.awayScore, awayScore: g.homeScore,
        liveHomeScore: g.liveAwayScore ?? null, liveAwayScore: g.liveHomeScore ?? null,
        winnerOverride: g.winnerOverride === 'home' ? 'away' : g.winnerOverride === 'away' ? 'home' : g.winnerOverride,
        forfeitBy: g.forfeitBy === 'home' ? 'away' : g.forfeitBy === 'away' ? 'home' : g.forfeitBy,
      } : g)
    } : s);
    persistLeague({ ...league, seasons });
  };
  const startPlayIn = () => {
    if (!league || !activeSeason) return;
    if (activeSeason.games.some(g => g.isPlayIn)) return;
    const std = computeStandings(activeSeason, teamsById).active;
    const round1 = generatePlayInRound1(std, activeSeason.settings.playoffSpots, activeSeason.settings.playInTeams || 0);
    if (round1.length === 0) return;
    const { games } = advancePlayIn([...activeSeason.games, ...round1]);
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, games } : s);
    persistLeague({ ...league, seasons });
  };
  const clearPlayIn = () => {
    if (!league || !activeSeason) return;
    const games = activeSeason.games.filter(g => !g.isPlayIn);
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, games } : s);
    persistLeague({ ...league, seasons });
  };
  const startPlayoffs = () => {
    if (!league || !activeSeason) return;
    if (activeSeason.games.some(g => g.isPlayoff)) return;
    const playInWinnerId = getPlayInWinner(activeSeason.games);
    if ((activeSeason.settings.playInTeams || 0) >= 2 && !playInWinnerId) return;
    const std = buildMainBracketSeeds(computeStandings(activeSeason, teamsById).active, activeSeason.settings, playInWinnerId);
    const round1 = generatePlayoffRound1(std, activeSeason.settings.playoffSpots, activeSeason.settings.seriesLength);
    if (round1.length === 0) return;
    const { games, championTeamId } = advancePlayoffs([...activeSeason.games, ...round1], activeSeason.settings, seedById);
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, games, championTeamId: championTeamId !== undefined ? championTeamId : s.championTeamId } : s);
    persistLeague({ ...league, seasons });
  };
  const clearPlayoffs = () => {
    if (!league || !activeSeason) return;
    const games = activeSeason.games.filter(g => !g.isPlayoff);
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, games, championTeamId: null } : s);
    persistLeague({ ...league, seasons });
  };
  const deleteGame = (gameId) => {
    if (!league || !activeSeason) return;
    const game = activeSeason.games.find(g => g.id === gameId);
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, games: s.games.filter(g => g.id !== gameId) } : s);
    const homeName = game ? ((teamsById[game.homeTeamId] && teamsById[game.homeTeamId].name) || 'Home') : 'Home';
    const awayName = game ? ((teamsById[game.awayTeamId] && teamsById[game.awayTeamId].name) || 'Away') : 'Away';
    persistLeague(appendAuditEntry({ ...league, seasons }, 'Game deleted', game ? `${awayName} @ ${homeName} (${game.date || ''})` : gameId));
  };
  const updateGameNotes = (gameId, notes) => {
    if (!league || !activeSeason) return;
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, games: s.games.map(g => g.id === gameId ? { ...g, notes } : g) } : s);
    persistLeague({ ...league, seasons });
  };
  const updateGameStreamUrl = (gameId, streamUrl) => {
    if (!league || !activeSeason) return;
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, games: s.games.map(g => g.id === gameId ? { ...g, streamUrl } : g) } : s);
    persistLeague({ ...league, seasons });
  };
  const updateGameTime = (gameId, gameTimeUTC) => {
    if (!league || !activeSeason) return;
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, games: s.games.map(g => g.id === gameId ? { ...g, gameTimeUTC } : g) } : s);
    persistLeague({ ...league, seasons });
  };
  const applyPending = (kind, item) => {
    if (!league || !activeSeason) return { ok: false, error: 'No active season is loaded.' };
    if (!item) return { ok: false, error: 'That review item has nothing to apply.' };
    const ownerOf = (playerId) => (activeSeason.members || []).find(m => (m.roster || []).some(p => p.id === playerId));
    const gameById = (gameId) => (activeSeason.games || []).find(g => g.id === gameId);

    if (kind === 'final_score') {
      const game = gameById(item.gameId);
      if (!game) return { ok: false, error: 'That game is no longer on the schedule.' };
      if (game.played) return { ok: false, error: 'That game has already been scored.' };
      saveScore(item.gameId, { awayScore: item.awayScore, homeScore: item.homeScore, innings: item.innings });
      return { ok: true };
    }
    if (kind === 'game_time') {
      if (!gameById(item.gameId)) return { ok: false, error: 'That game is no longer on the schedule.' };
      updateGameTime(item.gameId, item.gameTimeUTC);
      return { ok: true };
    }
    if (kind === 'trade') {
      const [a, b] = item.sides || [];
      if (!a || !b) return { ok: false, error: 'That trade does not have two sides.' };
      for (const side of item.sides) {
        for (const playerId of side.playerIds || []) {
          const owner = ownerOf(playerId);
          if (!owner) return { ok: false, error: 'One of those players is no longer on a roster.' };
          if (owner.teamId === side.teamId) return { ok: false, error: 'One of those players is already on the receiving team.' };
        }
      }
      tradePlayers(a.teamId, b.teamId, b.playerIds, a.playerIds);
      return { ok: true };
    }
    if (kind === 'sign') {
      if (item.playerId) {
        if (ownerOf(item.playerId)) return { ok: false, error: 'That player is already on a roster.' };
        signFreeAgent(item.teamId, item.playerId);
      } else {
        addPlayer(item.teamId, item.playerName, item.starLevel);
      }
      return { ok: true };
    }
    if (kind === 'release') {
      const owner = ownerOf(item.playerId);
      if (!owner) return { ok: false, error: 'That player is not on a roster.' };
      removePlayer(owner.teamId, item.playerId);
      return { ok: true };
    }
    if (kind === 'suspend' || kind === 'unsuspend') {
      const owner = ownerOf(item.playerId);
      if (!owner) return { ok: false, error: 'That player is not on a roster.' };
      setPlayerSuspended(owner.teamId, item.playerId, kind === 'suspend', item.reason, item.games);
      return { ok: true };
    }
    if (kind === 'ban' || kind === 'unban') {
      setPlayerBanned(item.playerId, kind === 'ban', item.reason);
      return { ok: true };
    }
    return { ok: false, error: `The site does not know how to apply "${kind}".` };
  };
  const saveGamePlayerStats = (gameId, side, entries) => {
    if (!league || !activeSeason) return;
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, games: s.games.map(g => g.id === gameId ? { ...g, playerStats: { ...(g.playerStats || {}), [side]: entries } } : g) } : s);
    persistLeague({ ...league, seasons });
  };
  const saveSettings = (settings) => {
    if (!league || !activeSeason) return;
    const seasons = league.seasons.map(s => s.id === activeSeason.id ? { ...s, settings } : s);
    persistLeague(appendAuditEntry({ ...league, seasons }, 'Season settings updated', activeSeason.name));
  };
  // A single, versioned rulebook document — separate from the free-text
  // League Info description — with a read-only history of past versions so
  // a change to the rules is traceable, not just silently overwritten.
  const updateConstitution = (text) => {
    if (!league) return;
    const trimmed = (text || '').trim();
    const prior = league.constitution;
    const version = prior ? (prior.version || 1) + 1 : 1;
    const history = prior ? [...(prior.history || []), { version: prior.version || 1, text: prior.text, updatedAt: prior.updatedAt }] : [];
    persistLeague(appendAuditEntry({ ...league, constitution: { text: trimmed, version, updatedAt: Date.now(), history } }, 'League constitution updated', `v${version}`));
  };
  // A short message the Site Owner can post at the top of the Home tab —
  // shown as a dismissible banner to every visitor while active,
  // independent of any one season.
  const setMaintenanceBanner = (message, active, startAt, endAt) => {
    if (!league) return;
    persistLeague({ ...league, maintenanceBanner: { message: (message || '').trim(), active: !!active, startAt: startAt || null, endAt: endAt || null } });
  };
  const setEmergencyBanner = (message, active) => {
    if (!league) return;
    persistLeague(appendAuditEntry({ ...league, emergencyBanner: { message: (message || '').trim(), active: !!active } }, active ? 'Emergency broadcast enabled' : 'Emergency broadcast disabled', message));
  };
  const addChangelogEntry = (text) => {
    if (!league) return;
    const entry = { id: uid('cl'), text, at: Date.now() };
    persistLeague(appendAuditEntry({ ...league, changelog: [...(league.changelog || []), entry] }, 'Changelog entry added', text));
  };
  const removeChangelogEntry = (id) => {
    if (!league) return;
    persistLeague(appendAuditEntry({ ...league, changelog: (league.changelog || []).filter(e => e.id !== id) }, 'Changelog entry removed', id));
  };
  // Live draft-day entry: appends one pick at a time to the running board
  // and, same as the bulk draft-board importer, stamps draftPick straight
  // onto the matching roster/free-agent entry (or signs them fresh) so it
  // shows up immediately everywhere draftPick already renders.
  const addLiveDraftPick = (round, pickInRound, teamId, playerName) => {
    if (!league || !activeSeason || !teamId || !playerName.trim()) return;
    const overall = ((activeSeason.liveDraftPicks || []).length) + 1;
    const draftPick = { round, pickInRound, overall };
    const pick = { id: uid('pick'), round, pickInRound, overall, teamId, playerName: playerName.trim(), at: Date.now() };
    const member = activeSeason.members.find(m => m.teamId === teamId);
    const norm = (s) => (s || '').trim().toLowerCase();
    const existingIdx = member ? (member.roster || []).findIndex(p => norm(p.name) === norm(playerName)) : -1;
    const seasons = league.seasons.map(s => {
      if (s.id !== activeSeason.id) return s;
      const members = s.members.map(m => {
        if (m.teamId !== teamId) return m;
        if (existingIdx >= 0) return { ...m, roster: m.roster.map((p, i) => i === existingIdx ? { ...p, draftPick } : p) };
        return { ...m, roster: [...(m.roster || []), { ...newPlayer(playerName.trim(), null), draftPick }] };
      });
      return { ...s, members, liveDraftPicks: [...(s.liveDraftPicks || []), pick] };
    });
    persistLeague({ ...league, seasons });
  };

  /* ---- navigation helpers ---- */
  const subNavTabs = ['team', 'compare', 'player', 'playerCompare'];
  const onOpenTeam = (teamId) => { setSelectedTeamId(teamId); setPrevTab(subNavTabs.includes(tab) ? prevTab : tab); setTab('team'); };
  const backFromTeam = () => { setTab(prevTab); setSelectedTeamId(null); };
  const onOpenCompare = (teamId, teamBId) => { setCompareInitialId(teamId); setCompareSecondId(teamBId || null); setPrevTab(subNavTabs.includes(tab) ? prevTab : tab); setTab('compare'); };
  const backFromCompare = () => { setTab(prevTab); setCompareInitialId(null); setCompareSecondId(null); };
  const onOpenPlayer = (name) => { setSelectedPlayerName(name); setPrevTab(subNavTabs.includes(tab) ? prevTab : tab); setTab('player'); };
  const backFromPlayer = () => { setTab(prevTab); setSelectedPlayerName(null); };
  const onOpenPlayerCompare = (nameA, nameB) => { setComparePlayerAName(nameA); setComparePlayerBName(nameB || null); setPrevTab(subNavTabs.includes(tab) ? prevTab : tab); setTab('playerCompare'); };
  const backFromPlayerCompare = () => { setTab(prevTab); setComparePlayerAName(null); setComparePlayerBName(null); };

  /* ---- derived data ---- */
  const teamChampionshipCounts = useMemo(() => {
    const counts = {};
    if (league) league.seasons.forEach(s => { if (s.championTeamId) counts[s.championTeamId] = (counts[s.championTeamId] || 0) + 1; });
    return counts;
  }, [league]);
  const standingsResult = useMemo(() => activeSeason ? computeStandings(activeSeason, displayTeamsById) : { all: [], active: [] }, [activeSeason, displayTeamsById]);
  const standings = standingsResult.active;
  // Seed lookup used for reseeding rounds (best remaining seed vs. worst
  // remaining seed) — built from the standings order, same as bracket seeding.
  const seedById = useMemo(() => { const m = {}; standings.forEach((t, i) => { m[t.id] = i + 1; }); return m; }, [standings]);
  const rounds = useMemo(() => activeSeason ? getOrderedRounds(activeSeason) : [], [activeSeason]);
  // Re-derive the "current round" whenever games are added OR whenever a
  // game's played status changes (entering a score doesn't change the game
  // COUNT, so that alone was never re-triggering this — the home page would
  // stay stuck on round 1 as soon as it was first computed).
  const playedCount = activeSeason ? (activeSeason.games || []).filter(g => g.played).length : 0;
  useEffect(() => { if (rounds.length) setRoundIdx(currentRoundIndex(rounds)); }, [activeSeason?.id, activeSeason?.games?.length, playedCount]);
  const movementById = useMemo(() => {
    if (!activeSeason || rounds.length < 2) return {};
    const curIdx = lastPlayedRoundIndex(rounds);
    if (curIdx < 1) return {};
    const prev = computeStandingsThroughRound(activeSeason, teamsById, rounds, curIdx - 1).active;
    const prevRankById = {};
    prev.forEach(t => { prevRankById[t.id] = t.rank; });
    const map = {};
    standings.forEach(t => { if (prevRankById[t.id] != null) map[t.id] = prevRankById[t.id] - t.rank; });
    return map;
  }, [activeSeason, teamsById, rounds, standings]);
  const roundHistory = useMemo(() => activeSeason ? computeRoundHistory(activeSeason, teamsById, rounds) : [], [activeSeason, teamsById, rounds]);
  const scoringTrend = useMemo(() => computeScoringTrend(rounds), [rounds]);
  const extras = useMemo(() => activeSeason ? computeExtras(activeSeason, teamsById) : null, [activeSeason, teamsById]);
  const leagueRecords = useMemo(() => computeLeagueRecords(league, teamsById), [league, teamsById]);
  const h2hMatrix = useMemo(() => activeSeason ? buildH2H(activeSeason.games) : {}, [activeSeason]);
  const selectedTeam = useMemo(() => selectedTeamId ? (teamsById[selectedTeamId] ? { ...teamsById[selectedTeamId] } : null) : null, [selectedTeamId, teamsById]);
  const selectedTeamMerged = useMemo(() => {
    if (!selectedTeamId || !activeSeason) return null;
    const member = activeSeason.members.find(m => m.teamId === selectedTeamId);
    if (!member) return null;
    return mergeTeam(teamsById[selectedTeamId] || null, member);
  }, [selectedTeamId, activeSeason, teamsById]);
  const selectedStandingsRow = useMemo(() => standingsResult.all.find(t => t.id === selectedTeamId) || null, [standingsResult, selectedTeamId]);
  const historyTeam = historyTeamId ? teamsById[historyTeamId] : null;

  // What needs an admin's attention right now — pending trades, and
  // suspensions whose game count has run out but haven't been lifted yet.
  const notifications = useMemo(() => {
    if (!isLoggedIn || !activeSeason) return [];
    const items = [];
    if (canGM) {
      (activeSeason.pendingTrades || []).forEach(t => {
        const teamA = teamsById[t.teamAId], teamB = teamsById[t.teamBId];
        items.push({
          id: `trade-${t.id}`, type: 'trade', createdAt: t.createdAt,
          label: `Trade proposal: ${(teamA && teamA.name) || '?'} ⇄ ${(teamB && teamB.name) || '?'}`,
          onClick: () => setTab('roster'),
        });
      });
    }
    activeSeason.members.forEach(m => {
      const team = teamsById[m.teamId];
      const teamGamesPlayed = (activeSeason.games || []).filter(g => g.played && !g.isBye && (g.homeTeamId === m.teamId || g.awayTeamId === m.teamId)).length;
      (m.roster || []).forEach(p => {
        if (!p.suspended || !p.suspensionGames) return;
        const remaining = Math.max(0, p.suspensionGames - (teamGamesPlayed - (p.suspensionStartGames || 0)));
        if (remaining <= 0) {
          items.push({
            id: `susp-${p.id}`, type: 'suspension', createdAt: p.suspensionStartGames || 0,
            label: `${p.name}'s suspension is served (${(team && team.name) || m.scheduleName})`,
            onClick: () => onOpenPlayer(p.name),
          });
        }
      });
    });
    (activeSeason.appeals || []).forEach(a => {
      items.push({
        id: `appeal-${a.id}`, type: 'appeal', createdAt: a.createdAt,
        label: `Appeal from ${a.playerName}`,
        onClick: () => setTab('transactions'),
      });
    });
    return items;
  }, [isLoggedIn, canGM, activeSeason, teamsById]);
  // Free agents sitting in a season other than the one being viewed — a
  // nudge toward the bulk-delete tool on the GM tab, since those pools only
  // grow if nobody ever switches back to clean them out.
  const staleFreeAgentCount = useMemo(() => {
    if (!league || !activeSeason) return 0;
    return league.seasons.filter(s => s.id !== activeSeason.id).reduce((sum, s) => sum + (s.freeAgents || []).length, 0);
  }, [league, activeSeason]);

  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ background: INK, color: CHALK_DIM }}>Loading…</div>;

  /* ---- render ---- */
  let body = null;
  if (screen === 'leagues') {
    body = <LeaguesView index={leaguesIndex} onOpen={openLeague} onCreate={createLeague} onDelete={deleteLeagueById} onRename={renameLeague} onRefresh={refreshIndexes} loadError={loadError} onOpenRegistry={openRegistry} onOpenAppearance={() => setScreen('appearance')} />;
  } else if (screen === 'appearance') {
    body = (
      <div className="p-3 space-y-3">
        <button onClick={() => setScreen('leagues')} className="flex items-center gap-1 text-sm" style={{ color: CHALK_DIM }}><ArrowLeft size={14} /> Back</button>
        <AppearanceSettings theme={theme} saveTheme={saveTheme} />
      </div>
    );
  } else if (screen === 'registry') {
    body = <TeamRegistryView teamsIndex={teamsIndex} teamsById={teamsById} onBack={() => setScreen(FIXED_LEAGUE_ID ? 'league' : 'leagues')} onCreate={createGlobalTeam} onOpenHistory={(id) => openTeamHistory(id, 'registry')} updateGlobalTeamField={updateGlobalTeamField} onSyncTeams={syncTeamRegistry} />;
  } else if (screen === 'history') {
    body = <TeamHistoryPage team={historyTeam} history={historyData} loading={historyLoading} onBack={() => setScreen(historyBack)} />;
  } else if (screen === 'league' && league) {
    const activeSeasonPublic = activeSeason ? activeSeason.public !== false : true;
    if (tab === 'seasons') {
      body = <SeasonsView league={league} viewingSeasonId={activeSeason && activeSeason.id} onBack={() => setTab('home')} onSwitch={switchSeason} onSetDefault={setDefaultSeason} onCreate={createSeason} onRename={renameSeason} onDelete={deleteSeason} onSetChampion={setChampion} onSetPublic={setSeasonPublic} teamsById={teamsById} onSetLogo={setLeagueLogo} />;
    } else if (!activeSeason) {
      body = <div className="p-4"><Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>This league has no seasons yet.</p></Panel></div>;
    } else if (!activeSeasonPublic && !isLoggedIn) {
      body = <div className="p-4"><Panel><p className="px-4 py-8 text-sm text-center" style={{ color: CHALK_DIM }}>This season isn't public yet. Check back later, or log in if you're an admin.</p></Panel></div>;
    } else if (tab === 'home') {
      body = <HomeView season={activeSeason} teamsById={displayTeamsById} settings={activeSeason.settings} onOpenTeam={onOpenTeam} h2hMatrix={h2hMatrix} sport={sport} onStartPlayoffs={startPlayoffs} onClearPlayoffs={clearPlayoffs} onStartPlayIn={startPlayIn} onClearPlayIn={clearPlayIn} onOpenCompare={onOpenCompare} news={league.news || []} onViewNews={() => setTab('news')} onOpenPlayer={onOpenPlayer} onViewLeaders={() => setTab('leaders')} onViewTransactions={() => setTab('transactions')} notifications={notifications} staleFreeAgentCount={staleFreeAgentCount} onViewGM={() => setTab('roster')} onViewAdmin={() => setTab('admin')} />;
    } else if (tab === 'standings') {
      body = <StandingsView standings={standings} updateMemberField={updateMemberField} season={activeSeason} settings={activeSeason.settings} movementById={movementById} onOpenTeam={onOpenTeam} />;
    } else if (tab === 'teams' && isLoggedIn) {
      body = <TeamsView season={activeSeason} teamsById={teamsById} teamsIndex={teamsIndex} addExistingTeam={addExistingTeamToSeason} createAndAddTeam={createAndAddTeamToSeason} updateMemberField={updateMemberField} updateGlobalTeamField={updateGlobalTeamField} removeMember={removeMember} onOpenTeam={onOpenTeam} importRosterSheet={importRosterSheet} importDraftBoard={importDraftBoard} importStarsSheet={importStarsSheet} addDivision={addDivision} updateDivision={updateDivision} removeDivision={removeDivision} assignMemberDivision={assignMemberDivision} settings={activeSeason.settings} onAddLiveDraftPick={addLiveDraftPick} />;
    } else if (tab === 'roster' && canGM) {
      body = <RosterManagementView season={activeSeason} teamsById={displayTeamsById} updatePlayerField={updatePlayerField} removePlayer={removePlayer} addPlayer={addPlayer} addPlayersBulk={addPlayersBulk} tradePlayer={tradePlayer} tradePlayers={tradePlayers} proposeTrade={proposeTrade} executeTradeProposal={executeTradeProposal} discardTradeProposal={discardTradeProposal} setPlayerSuspended={setPlayerSuspended} setPlayerBanned={setPlayerBanned} onOpenPlayer={onOpenPlayer} signFreeAgent={signFreeAgent} deleteFreeAgent={deleteFreeAgent} deleteFreeAgentsBulk={deleteFreeAgentsBulk} />;
    } else if (tab === 'schedule') {
      body = <ScheduleView season={activeSeason} settings={activeSeason.settings} saveScore={saveScore} deleteGame={deleteGame} declareForfeit={declareForfeit} setWinnerOverride={setWinnerOverride} teamsById={displayTeamsById} sport={sport} updateGameNotes={updateGameNotes} updateGameStreamUrl={updateGameStreamUrl} updateGameTime={updateGameTime} saveGamePlayerStats={saveGamePlayerStats} setGameOngoing={setGameOngoing} setGameDelayed={setGameDelayed} swapHomeAway={swapHomeAway} onBulkSaveScores={bulkSaveScores} />;
    } else if (tab === 'stats') {
      body = <StatsView standings={standings} onOpenTeam={onOpenTeam} season={activeSeason} />;
    } else if (tab === 'leaders') {
      body = <StatLeadersView league={league} season={activeSeason} teamsById={displayTeamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={league && league.logoUrl} standings={standings} />;
    } else if (tab === 'awards') {
      body = <AwardsView league={league} season={activeSeason} standings={standings} teamsById={displayTeamsById} addAwardDef={addAwardDef} updateAwardDef={updateAwardDef} removeAwardDef={removeAwardDef} addAwardWinner={addAwardWinner} removeAwardWinnerAt={removeAwardWinnerAt} />;
    } else if (tab === 'halloffame') {
      body = <HallOfFameView league={league} addHallOfFameEntry={addHallOfFameEntry} removeHallOfFameEntry={removeHallOfFameEntry} onOpenPlayer={onOpenPlayer} />;
    } else if (tab === 'badges') {
      body = <BadgeShowcaseView league={league} onOpenPlayer={onOpenPlayer} />;
    } else if (tab === 'transactions') {
      body = <TransactionsView season={activeSeason} teamsById={displayTeamsById} onOpenPlayer={onOpenPlayer} onRemoveActivity={removeActivityItem} onDismissAppeal={dismissAppeal} />;
    } else if (tab === 'odds') {
      body = <OddsView season={activeSeason} teamsById={displayTeamsById} standings={standings} settings={activeSeason.settings} onOpenTeam={onOpenTeam} h2hMatrix={h2hMatrix} onStartPlayoffs={startPlayoffs} onClearPlayoffs={clearPlayoffs} onStartPlayIn={startPlayIn} onClearPlayIn={clearPlayIn} onOpenCompare={onOpenCompare} onBackfillOdds={backfillOddsCache} />;
    } else if (tab === 'extras') {
      body = <ExtrasView extras={extras} teamsById={displayTeamsById} leagueRecords={leagueRecords} activityLog={activeSeason.activityLog || []} season={activeSeason} standings={standings} onRemoveActivity={removeActivityItem} onOpenTeam={onOpenTeam} onOpenPlayer={onOpenPlayer} />;
    } else if (tab === 'graphs') {
      body = <GraphsView league={Object.values(teamsById).filter(t => activeSeason.members.some(m => m.teamId === t.id))} allSeasons={league.seasons} roundHistory={roundHistory} standings={standings} scoringTrend={scoringTrend} season={activeSeason} h2hMatrix={h2hMatrix} onOpenTeam={onOpenTeam} onOpenPlayer={onOpenPlayer} sport={sport} />;
    } else if (tab === 'rookies') {
      body = <RookieClassView league={league} activeSeasonId={activeSeason.id} teamsById={displayTeamsById} onOpenPlayer={onOpenPlayer} leagueLogoUrl={league && league.logoUrl} />;
    } else if (tab === 'news') {
      body = <NewsView league={league} season={activeSeason} teamsById={displayTeamsById} addNewsPost={addNewsPost} updateNewsPost={updateNewsPost} removeNewsPost={removeNewsPost} onOpenTeam={onOpenTeam} />;
    } else if (tab === 'info') {
      body = <LeagueInfoView league={league} updateLeagueInfo={updateLeagueInfo} addStaffMember={addStaffMember} updateStaffMember={updateStaffMember} removeStaffMember={removeStaffMember} addLeagueLink={addLeagueLink} updateLeagueLink={updateLeagueLink} removeLeagueLink={removeLeagueLink} onUpdateConstitution={updateConstitution} />;
    } else if (tab === 'settings') {
      body = <SettingsView settings={activeSeason.settings} saveSettings={saveSettings} theme={theme} saveTheme={saveTheme} sport={sport} season={activeSeason} teamsById={teamsById} importGames={importGames} addManualGame={addManualGame} generateSchedule={generateSchedule} league={league} onRunKpbImport={runKpbImport} onSyncPlayerIdentities={syncPlayerIdentities} />;
    } else if (tab === 'admin') {
      body = <AdminDashboardView league={league} season={activeSeason} teamsById={teamsById} applyPending={applyPending} notifications={notifications} staleFreeAgentCount={staleFreeAgentCount} settings={activeSeason.settings} onViewGM={() => setTab('roster')} onViewTransactions={() => setTab('transactions')} onAddBadgeDef={addBadgeDef} onRemoveBadgeDef={removeBadgeDef} onSetMaintenanceBanner={setMaintenanceBanner} onSetEmergencyBanner={setEmergencyBanner} onAddChangelogEntry={addChangelogEntry} onRemoveChangelogEntry={removeChangelogEntry} onMergePlayers={mergePlayers} onLogAudit={logAudit} onOpenRegistry={openRegistry} />;
    } else if (tab === 'team') {
      body = <TeamPage season={activeSeason} settings={activeSeason.settings} team={selectedTeamMerged} standingsRow={selectedStandingsRow} teamsById={displayTeamsById} h2hMatrix={h2hMatrix} championshipCount={selectedTeamId ? (teamChampionshipCounts[selectedTeamId] || 0) : 0} onBack={backFromTeam} onOpenGlobalHistory={(id) => openTeamHistory(id, 'league')} onOpenCompare={onOpenCompare} updatePlayerField={updatePlayerField} removePlayer={removePlayer} addPlayer={addPlayer} addPlayersBulk={addPlayersBulk} tradePlayer={tradePlayer} updateMemberField={updateMemberField} setPlayerSuspended={setPlayerSuspended} setPlayerBanned={setPlayerBanned} onOpenPlayer={onOpenPlayer} onRebrand={rebrandTeam} onClearRebrand={clearRebrand} />;
    } else if (tab === 'compare') {
      body = <ComparePage season={activeSeason} standingsAll={standingsResult.all} teamsById={displayTeamsById} h2hMatrix={h2hMatrix} initialTeamId={compareInitialId} initialTeamBId={compareSecondId} onBack={backFromCompare} onOpenTeam={onOpenTeam} />;
    } else if (tab === 'player') {
      body = <PlayerPage league={league} teamsById={displayTeamsById} playerName={selectedPlayerName} onBack={backFromPlayer} onOpenTeam={onOpenTeam} onOpenPlayerCompare={onOpenPlayerCompare} activeSeasonId={activeSeason && activeSeason.id} onRemoveActivity={removeActivityItem} onClearAllActivity={removeActivityItems} onBackfillRobloxId={backfillRobloxId} onSyncRobloxRename={syncRobloxRename} onPlayerRenamed={setSelectedPlayerName} onRenamePlayer={renamePlayer} onSetPlayerBadges={setPlayerBadges} onAddPlayerAccolade={addPlayerAccolade} onRemovePlayerAccolade={removePlayerAccolade} onAddPlayerTeamCredit={addPlayerTeamCredit} onRemovePlayerTeamCredit={removePlayerTeamCredit} onUpsertManualStatLine={upsertManualStatLine} onDeleteManualStatLine={deleteManualStatLine} onRemoveTeamPlayed={removeTeamPlayed} onSubmitAppeal={submitAppeal} />;
    } else if (tab === 'playerCompare') {
      body = <PlayerComparePage league={league} teamsById={displayTeamsById} initialNameA={comparePlayerAName} initialNameB={comparePlayerBName} onBack={backFromPlayerCompare} onOpenPlayer={onOpenPlayer} activeSeasonId={activeSeason && activeSeason.id} />;
    }
  }

  const inSeasonTabs = screen === 'league' && league && activeSeason && tab !== 'seasons';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: INK, color: CHALK, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <header className="sticky top-0 z-20" style={{ background: `${PANEL}f2`, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', borderBottom: `1px solid ${LINE}` }}>
        <div className="max-w-6xl mx-auto px-4 flex items-center gap-3" style={{ height: 60 }}>
          {screen === 'league' && !FIXED_LEAGUE_ID && <button onClick={backToLeagues} className="p-1 rounded flex-shrink-0" style={{ color: CHALK_DIM }}><ArrowLeft size={18} /></button>}
          {(screen === 'registry' || screen === 'history') && screen !== 'league' && <button onClick={() => setScreen(screen === 'history' ? historyBack : (FIXED_LEAGUE_ID ? 'league' : 'leagues'))} className="p-1 rounded flex-shrink-0" style={{ color: CHALK_DIM }}><ArrowLeft size={18} /></button>}
          {screen === 'league' && league && league.logoUrl ? (
            <img src={league.logoUrl} alt="" className="w-8 h-8 object-contain flex-shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${PRIMARY}1f`, border: `1.5px solid ${PRIMARY}` }}>
              <Trophy size={15} style={{ color: PRIMARY }} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="font-head text-lg font-bold tracking-tight truncate uppercase leading-none" style={{ color: CHALK, letterSpacing: '-0.01em' }}>
              {screen === 'league' && league ? league.name : screen === 'registry' ? 'All Teams' : screen === 'history' ? 'Team History' : screen === 'appearance' ? 'Settings & Appearance' : 'Your Leagues'}
            </h1>
          </div>
          {screen === 'league' && league && (
            <button onClick={() => setTab('seasons')} className="p-1.5 rounded flex-shrink-0" style={{ color: PRIMARY }}><Layers size={18} /></button>
          )}
          {screen === 'league' && isLoggedIn && (
            saveStatus === 'conflict' ? (
              <button onClick={() => window.location.reload()} className="text-[10px] font-bold underline flex-shrink-0" style={{ color: NEGATIVE }}>Changed elsewhere — Reload</button>
            ) : saveStatus === 'error' ? (
              <button onClick={retrySave} className="text-[10px] font-bold underline flex-shrink-0 hidden sm:inline" style={{ color: NEGATIVE }}>Save failed — Retry</button>
            ) : (
              <span className="text-[10px] font-semibold flex-shrink-0 hidden sm:inline" style={{ color: CHALK_DIM }}>
                {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : ''}
              </span>
            )
          )}
          {screen === 'league' && league && <GlobalSearch teamsIndex={teamsIndex} league={league} onOpenTeam={onOpenTeam} onOpenPlayer={onOpenPlayer} setTab={setTab} />}
          {screen === 'league' && league && <WhatsNewButton changelog={league.changelog} />}
          {isLoggedIn && <NotificationBell notifications={notifications} />}
          <button onClick={() => setLocalThemeMode((localThemeMode || 'dark') === 'dark' ? 'light' : 'dark')} title="Light / dark mode (just for you)" className="p-1.5 rounded flex-shrink-0" style={{ color: CHALK_DIM }}>
            {(localThemeMode || 'dark') === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <LoginControl chalk={CHALK} chalkDim={CHALK_DIM} primary={PRIMARY} ink={INK} panel={PANEL} panel2={PANEL2} line={LINE} />
        </div>
        {inSeasonTabs && (
          <nav className="max-w-6xl mx-auto px-2 flex gap-1 overflow-x-auto" style={{ borderTop: `1px solid ${LINE}` }}>
            <TabBtn active={tab === 'home'} onClick={() => setTab('home')} label="Home" />
            <TabBtn active={tab === 'news'} onClick={() => setTab('news')} label="News" />
            <TabBtn active={tab === 'standings'} onClick={() => setTab('standings')} label="Standings" />
            {isLoggedIn && <TabBtn active={tab === 'teams'} onClick={() => setTab('teams')} label="Teams" />}
            {canGM && <TabBtn active={tab === 'roster'} onClick={() => setTab('roster')} label="GM" />}
            <TabBtn active={tab === 'schedule'} onClick={() => setTab('schedule')} label="Schedule" />
            <TabBtn active={STATS_GROUP.includes(tab)} onClick={() => setTab(STATS_GROUP.includes(tab) ? tab : 'stats')} label="Stats" />
            <TabBtn active={AWARDS_GROUP.includes(tab)} onClick={() => setTab(AWARDS_GROUP.includes(tab) ? tab : 'awards')} label="Awards" />
            <TabBtn active={tab === 'transactions'} onClick={() => setTab('transactions')} label="Transactions" />
            <TabBtn active={EXTRAS_GROUP.includes(tab)} onClick={() => setTab(EXTRAS_GROUP.includes(tab) ? tab : 'extras')} label="Extras" />
            <TabBtn active={tab === 'info'} onClick={() => setTab('info')} label="Info" />
            {hasPermission('manageRosterMoves') && <TabBtn active={tab === 'admin'} onClick={() => setTab('admin')} label="Admin" />}
            {isLoggedIn && <TabBtn active={tab === 'settings'} onClick={() => setTab('settings')} label="Settings" />}
          </nav>
        )}
      </header>

      {league && <EmergencyBanner banner={league.emergencyBanner} />}

      <main className={`flex-1 ${inSeasonTabs && (activeSeason.games || []).length > 0 ? 'pb-20' : ''}`}>
        <div className="max-w-6xl mx-auto w-full">
          {inSeasonTabs && tab === 'home' && league && <MaintenanceBanner banner={league.maintenanceBanner} />}
          {STATS_GROUP.includes(tab) && <SubNav tab={tab} setTab={setTab} items={[['stats', 'Team Stats'], ['leaders', 'Leaders'], ['graphs', 'Graphs'], ['rookies', 'Rookies']]} />}
          {EXTRAS_GROUP.includes(tab) && <SubNav tab={tab} setTab={setTab} items={[['extras', 'Fun Stats'], ['odds', 'Odds']]} />}
          {AWARDS_GROUP.includes(tab) && <SubNav tab={tab} setTab={setTab} items={[['awards', 'Awards'], ['halloffame', 'Hall of Fame'], ['badges', 'Badges']]} />}
          {body}
        </div>
      </main>

      {inSeasonTabs && <LiveTicker season={activeSeason} teamsById={displayTeamsById} sport={sport} onOpenTeam={onOpenTeam} />}
      <FeedbackButton />
    </div>
  );
}

// Error boundaries only work as class components — there's no hook
// equivalent to componentDidCatch/getDerivedStateFromError. Wraps the whole
// app so an unexpected crash anywhere shows a friendly screen instead of a
// blank white page, with a reload button as the escape hatch.
class CrashBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error('LeagueTracker crashed:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#0e0e0e' }}>
          <div className="max-w-sm text-center space-y-4">
            <AlertTriangle size={40} className="mx-auto" style={{ color: NEGATIVE }} />
            <h1 className="text-lg font-bold" style={{ color: '#f4f4f4' }}>Something broke</h1>
            <p className="text-sm" style={{ color: '#9a9a9a' }}>The page hit an unexpected error. Reloading usually fixes it — nothing you did caused this.</p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 rounded font-bold text-sm" style={{ background: PRIMARY, color: '#0e0e0e' }}>Reload page</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function LeagueTracker() {
  return (
    <CrashBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </CrashBoundary>
  );
}

