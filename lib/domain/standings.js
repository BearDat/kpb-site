import { mergeTeam, gameWinner, computeStreak, longestStreaks, buildH2H, pairCoinFlip } from './core.js';

export function computeStandings(season, teamsById) {
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
      if (b.diff !== a.diff) return b.diff - a.diff;
      const rec = h2hMatrix[a.id] && h2hMatrix[a.id][b.id];
      if (rec && (rec.w + rec.l) > 0 && rec.w !== rec.l) return rec.w > rec.l ? -1 : 1;
      if (rec) {
        const hDiff = rec.rf - rec.ra;
        if (hDiff !== 0) return hDiff > 0 ? -1 : 1;
      }
      return pairCoinFlip(a.id, b.id) ? -1 : 1;
    });
  const leader = activeArr[0];
  activeArr.forEach((t, i) => {
    t.rank = i + 1;
    t.gb = leader ? ((leader.w - t.w) + (t.l - leader.l)) / 2 : 0;
  });
  return { all: fullArr, active: activeArr };
}

export function recentResults(season, teamsById, limit = 12) {
  const played = (season.games || []).filter(g => g.played && !g.isBye);
  const byTime = played.slice().sort((a, b) => {
    if (a.gameTimeUTC != null && b.gameTimeUTC != null) return b.gameTimeUTC - a.gameTimeUTC;
    if (a.gameTimeUTC != null) return -1;
    if (b.gameTimeUTC != null) return 1;
    return 0;
  });
  return byTime.slice(0, limit).map(g => decorateGame(g, season, teamsById));
}

export function upcomingGames(season, teamsById, limit = 12) {
  const pending = (season.games || []).filter(g => !g.played && !g.isBye);
  const byTime = pending.slice().sort((a, b) => {
    if (a.gameTimeUTC != null && b.gameTimeUTC != null) return a.gameTimeUTC - b.gameTimeUTC;
    if (a.gameTimeUTC != null) return -1;
    if (b.gameTimeUTC != null) return 1;
    return 0;
  });
  return byTime.slice(0, limit).map(g => decorateGame(g, season, teamsById));
}

export function decorateGame(g, season, teamsById) {
  const nameOf = (teamId) => {
    const member = (season.members || []).find(m => m.teamId === teamId);
    if (!member) return 'TBD';
    return mergeTeam(teamsById[teamId] || null, member);
  };
  const home = nameOf(g.homeTeamId);
  const away = nameOf(g.awayTeamId);
  const winner = g.played ? gameWinner(g) : null;
  return {
    id: g.id,
    date: g.date || null,
    gameTimeUTC: g.gameTimeUTC == null ? null : g.gameTimeUTC,
    played: !!g.played,
    innings: g.innings == null ? null : Number(g.innings),
    isPlayoff: !!g.isPlayoff,
    playoffRound: g.playoffRound || null,
    seriesGame: g.seriesGame || null,
    home: home === 'TBD' ? null : { id: home.id, name: home.displayName, abbr: home.abbr, color: home.color, logoUrl: home.logoUrl },
    away: away === 'TBD' ? null : { id: away.id, name: away.displayName, abbr: away.abbr, color: away.color, logoUrl: away.logoUrl },
    homeScore: g.homeScore == null ? null : Number(g.homeScore),
    awayScore: g.awayScore == null ? null : Number(g.awayScore),
    winner,
    streamUrl: g.streamUrl || null,
  };
}
