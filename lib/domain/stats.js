export function ipDisplayToOuts(ip) {
  const n = Number(ip) || 0;
  const whole = Math.trunc(n);
  const frac = Math.round((n - whole) * 10);
  return whole * 3 + Math.min(2, Math.max(0, frac));
}

export function outsToIpDisplay(outs) {
  const o = Math.max(0, Math.round(outs));
  return `${Math.floor(o / 3)}.${o % 3}`;
}

export function normalizeStatRow(row) {
  return {
    ab: Number(row.ab) || 0, r: Number(row.r) || 0, h: Number(row.h) || 0, rbi: Number(row.rbi) || 0,
    bb: Number(row.bb) || 0, so: Number(row.so) || 0, ip: Number(row.ip) || 0, ha: Number(row.ha) || 0,
    er: Number(row.er) || 0, bbAllowed: Number(row.bbAllowed) || 0, k: Number(row.k) || 0,
    hrAllowed: Number(row.hrAllowed) || 0, e: Number(row.e) || 0, hr: Number(row.hr) || 0,
    doubles: Number(row.doubles) || 0, triples: Number(row.triples) || 0,
    g: row.g != null ? Number(row.g) || 0 : undefined,
  };
}

export function sumPlayerTotals(rows) {
  const t = {
    g: rows.reduce((s, row) => s + (row.g != null ? row.g : 1), 0),
    ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0, outs: 0, ha: 0, er: 0,
    bbAllowed: 0, k: 0, hrAllowed: 0, e: 0, hr: 0, doubles: 0, triples: 0,
  };
  rows.forEach(row => {
    t.ab += row.ab; t.r += row.r; t.h += row.h; t.rbi += row.rbi; t.bb += row.bb; t.so += row.so;
    t.outs += ipDisplayToOuts(row.ip); t.ha += row.ha; t.er += row.er; t.bbAllowed += row.bbAllowed;
    t.k += row.k; t.hrAllowed += row.hrAllowed; t.e += row.e; t.hr += row.hr;
    t.doubles += row.doubles; t.triples += row.triples;
  });
  return t;
}

const TOTAL_FIELDS = ['g', 'ab', 'r', 'h', 'rbi', 'bb', 'so', 'outs', 'ha', 'er', 'bbAllowed', 'k', 'hrAllowed', 'e', 'hr', 'doubles', 'triples'];

export function addTotals(list) {
  const out = {};
  TOTAL_FIELDS.forEach(f => { out[f] = 0; });
  list.forEach(t => TOTAL_FIELDS.forEach(f => { out[f] += Number(t[f]) || 0; }));
  return out;
}

export function playerSingles(t) {
  return Math.max(0, t.h - t.hr - t.doubles - t.triples);
}

export function computeBattingAdvanced(t) {
  const avg = t.ab > 0 ? t.h / t.ab : 0;
  const obpDenom = t.ab + t.bb;
  const obp = obpDenom > 0 ? (t.h + t.bb) / obpDenom : 0;
  const totalBases = playerSingles(t) + t.doubles * 2 + t.triples * 3 + t.hr * 4;
  const slg = t.ab > 0 ? totalBases / t.ab : 0;
  return { avg, obp, slg, ops: obp + slg, iso: slg - avg };
}

export function computePitchingAdvanced(t) {
  const era = t.outs > 0 ? (t.er * 27) / t.outs : 0;
  const whip = t.outs > 0 ? ((t.ha + t.bbAllowed) * 3) / t.outs : 0;
  const k9 = t.outs > 0 ? (t.k * 27) / t.outs : 0;
  const bb9 = t.outs > 0 ? (t.bbAllowed * 27) / t.outs : 0;
  return { ip: t.outs / 3, era, whip, k9, bb9 };
}

function rosterIndex(season) {
  const byId = new Map();
  (season.members || []).forEach(member => {
    (member.roster || []).forEach(p => byId.set(p.id, { player: p, teamId: member.teamId }));
  });
  (season.freeAgents || []).forEach(p => byId.set(p.id, { player: p, teamId: null }));
  return byId;
}

// Stats reach a season two different ways: per-game box scores entered (or
// screenshot-imported) against a specific game, stored on
// game.playerStats.{home,away}; and season-wide bulk imports (hcbb.info, a
// draft/star sheet, or a manual entry) with no game attached, stored in
// season.importedStatLines. Every stat-consuming view needs both merged, or
// a season that only used one path (a game's box score without a matching
// importedStatLines entry, or vice versa) silently comes up empty.
export function collectPlayerStatRows(season, { playoffs = false } = {}) {
  const byPlayer = new Map();
  const push = (playerId, row) => {
    const list = byPlayer.get(playerId) || [];
    list.push(normalizeStatRow(row));
    byPlayer.set(playerId, list);
  };
  (season.games || []).forEach(g => {
    if (g.isBye || g.isSpringTraining) return;
    if (!!g.isPlayoff !== playoffs) return;
    ['home', 'away'].forEach(side => {
      ((g.playerStats && g.playerStats[side]) || []).forEach(row => push(row.playerId, row));
    });
  });
  (season.importedStatLines || []).forEach(line => {
    if (!!line.isPlayoff !== playoffs) return;
    push(line.playerId, line);
  });
  return byPlayer;
}

export function seasonPlayerTotals(season, { mode = 'regular' } = {}) {
  const byId = rosterIndex(season);
  const rowsByPlayer = collectPlayerStatRows(season, { playoffs: mode === 'playoffs' });
  let orphaned = 0;
  let counted = 0;
  const players = [];
  rowsByPlayer.forEach((rows, playerId) => {
    counted += rows.length;
    const hit = byId.get(playerId);
    if (!hit) {
      orphaned += rows.length;
      return;
    }
    const totals = sumPlayerTotals(rows);
    players.push({
      id: hit.player.id,
      name: hit.player.name,
      teamId: hit.teamId,
      totals,
      batting: computeBattingAdvanced(totals),
      pitching: computePitchingAdvanced(totals),
    });
  });
  return { players, orphaned, counted: counted - orphaned };
}

export const BATTING_BOARDS = [
  { key: 'avg', label: 'Average', of: p => p.batting.avg, format: v => v.toFixed(3).replace(/^0/, ''), min: t => t.ab >= 20 },
  { key: 'ops', label: 'OPS', of: p => p.batting.ops, format: v => v.toFixed(3), min: t => t.ab >= 20 },
  { key: 'hr', label: 'Home runs', of: p => p.totals.hr, format: v => String(v), min: t => t.ab > 0 },
  { key: 'rbi', label: 'RBI', of: p => p.totals.rbi, format: v => String(v), min: t => t.ab > 0 },
  { key: 'h', label: 'Hits', of: p => p.totals.h, format: v => String(v), min: t => t.ab > 0 },
  { key: 'r', label: 'Runs', of: p => p.totals.r, format: v => String(v), min: t => t.ab > 0 },
];

export const PITCHING_BOARDS = [
  { key: 'era', label: 'ERA', of: p => p.pitching.era, format: v => v.toFixed(2), min: t => t.outs >= 30, ascending: true },
  { key: 'whip', label: 'WHIP', of: p => p.pitching.whip, format: v => v.toFixed(2), min: t => t.outs >= 30, ascending: true },
  { key: 'k', label: 'Strikeouts', of: p => p.totals.k, format: v => String(v), min: t => t.outs > 0 },
  { key: 'k9', label: 'K per 9', of: p => p.pitching.k9, format: v => v.toFixed(1), min: t => t.outs >= 30 },
  { key: 'ip', label: 'Innings', of: p => p.pitching.ip, format: v => outsToIpDisplay(v * 3), min: t => t.outs > 0 },
];

// A playoff run is a handful of games at most, so the regular-season
// qualifying minimums (built for a full slate) would filter out every
// playoff performer — these scale down to something a real postseason
// sample can actually clear.
export const BATTING_BOARDS_PLAYOFFS = BATTING_BOARDS.map(b => (
  b.key === 'avg' || b.key === 'ops' ? { ...b, min: t => t.ab >= 5 } : b
));
export const PITCHING_BOARDS_PLAYOFFS = PITCHING_BOARDS.map(b => (
  b.key === 'era' || b.key === 'whip' || b.key === 'k9' ? { ...b, min: t => t.outs >= 9 } : b
));

export function leaderboard(players, board, limit = 5) {
  return players
    .filter(p => board.min(p.totals))
    .map(p => ({ player: p, value: board.of(p) }))
    .sort((a, b) => (board.ascending ? a.value - b.value : b.value - a.value))
    .slice(0, limit);
}
