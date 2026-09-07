import { uid } from './core.js';
import { advancePlayIn, advancePlayoffs } from './advance.js';

export function appendAudit(league, action, detail) {
  const entry = { id: uid('audit'), action, detail: detail || '', at: Date.now() };
  return { ...league, auditLog: [...(league.auditLog || []).slice(-99), entry] };
}

function replaceSeason(league, seasonId, updater) {
  return { ...league, seasons: (league.seasons || []).map(s => (s.id === seasonId ? updater(s) : s)) };
}

export function findSeason(league, seasonId) {
  return (league.seasons || []).find(s => s.id === seasonId) || null;
}

export function findGame(league, seasonId, gameId) {
  const season = findSeason(league, seasonId);
  return season ? (season.games || []).find(g => g.id === gameId) || null : null;
}

function stripOddsCache(season) {
  const next = { ...season };
  delete next.oddsCache;
  return next;
}

function withAdvancedGames(season, updatedGames, seedById) {
  const { games: afterPlayIn } = advancePlayIn(updatedGames);
  const { games, championTeamId } = advancePlayoffs(afterPlayIn, season.settings || {}, seedById);
  return stripOddsCache({
    ...season,
    games,
    championTeamId: championTeamId !== undefined ? championTeamId : season.championTeamId,
  });
}

function mapGames(season, gameId, patch) {
  return (season.games || []).map(g => (g.id === gameId ? { ...g, ...patch } : g));
}

export function saveScore(seasonId, gameId, { awayScore, homeScore, innings }, seedById) {
  return (league) => replaceSeason(league, seasonId, season => withAdvancedGames(
    season,
    mapGames(season, gameId, {
      awayScore, homeScore, innings,
      played: true, isForfeit: false, forfeitBy: null, isOngoing: false, isDelayed: false,
    }),
    seedById,
  ));
}

export function clearScore(seasonId, gameId, seedById) {
  return (league) => replaceSeason(league, seasonId, season => withAdvancedGames(
    season,
    mapGames(season, gameId, {
      awayScore: null, homeScore: null, played: false,
      isForfeit: false, forfeitBy: null, winnerOverride: null, isOngoing: false, isDelayed: false,
    }),
    seedById,
  ));
}

export function declareForfeit(seasonId, gameId, forfeitBy, seedById) {
  return (league) => replaceSeason(league, seasonId, season => withAdvancedGames(
    season,
    mapGames(season, gameId, {
      homeScore: forfeitBy === 'home' ? 0 : 9,
      awayScore: forfeitBy === 'away' ? 0 : 9,
      innings: 0, played: true, isForfeit: true, forfeitBy,
      winnerOverride: null, isOngoing: false, isDelayed: false,
    }),
    seedById,
  ));
}

export function setGameTime(seasonId, gameId, gameTimeUTC) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season, games: mapGames(season, gameId, { gameTimeUTC }),
  }));
}

export function setGameOngoing(seasonId, gameId, ongoing) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season, games: mapGames(season, gameId, { isOngoing: ongoing, isDelayed: false }),
  }));
}

export function setGameDelayed(seasonId, gameId, delayed) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season, games: mapGames(season, gameId, { isDelayed: delayed }),
  }));
}

export function setGameStreamUrl(seasonId, gameId, streamUrl) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season, games: mapGames(season, gameId, { streamUrl: (streamUrl || '').trim() || null }),
  }));
}

export function addAwardDef(name, description) {
  return (league) => ({
    ...league,
    awardDefs: [...(league.awardDefs || []), { id: uid('award'), name: name.trim(), description: (description || '').trim() }],
  });
}

export function removeAwardDef(awardId) {
  return (league) => ({
    ...league,
    awardDefs: (league.awardDefs || []).filter(a => a.id !== awardId),
    seasons: (league.seasons || []).map(s => {
      if (!s.awardWinners || !s.awardWinners[awardId]) return s;
      const winners = { ...s.awardWinners };
      delete winners[awardId];
      return { ...s, awardWinners: winners };
    }),
  });
}

function winnerList(season, awardId) {
  const raw = (season.awardWinners || {})[awardId];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

export function addAwardWinner(seasonId, awardId, winner) {
  return (league) => replaceSeason(league, seasonId, season => {
    const list = winnerList(season, awardId);
    const duplicate = list.some(w => (winner.playerId
      ? w.playerId === winner.playerId
      : (w.name || '').trim().toLowerCase() === (winner.name || '').trim().toLowerCase()));
    if (duplicate) return season;
    return { ...season, awardWinners: { ...(season.awardWinners || {}), [awardId]: [...list, winner] } };
  });
}

export function removeAwardWinnerAt(seasonId, awardId, index) {
  return (league) => replaceSeason(league, seasonId, season => {
    const list = winnerList(season, awardId).filter((_, i) => i !== index);
    const winners = { ...(season.awardWinners || {}) };
    if (list.length === 0) delete winners[awardId];
    else winners[awardId] = list;
    return { ...season, awardWinners: winners };
  });
}

export function addHallOfFameEntry({ name, note, year, playerName }) {
  return (league) => appendAudit({
    ...league,
    hallOfFame: [...(league.hallOfFame || []), {
      id: uid('hof'),
      name: name.trim(),
      note: (note || '').trim(),
      year: (year || '').trim(),
      playerName: (playerName || '').trim() || null,
      addedAt: Date.now(),
    }],
  }, 'Hall of Fame inductee added', name.trim());
}

export function updateHallOfFameEntry(entryId, { name, note, year, playerName }) {
  return (league) => {
    const entry = (league.hallOfFame || []).find(e => e.id === entryId);
    const patched = {
      ...(entry || {}),
      name: name.trim(),
      note: (note || '').trim(),
      year: (year || '').trim(),
      playerName: (playerName || '').trim() || null,
    };
    return appendAudit(
      { ...league, hallOfFame: (league.hallOfFame || []).map(e => (e.id === entryId ? patched : e)) },
      'Hall of Fame inductee edited',
      name.trim(),
    );
  };
}

export function removeHallOfFameEntry(entryId) {
  return (league) => {
    const entry = (league.hallOfFame || []).find(e => e.id === entryId);
    return appendAudit(
      { ...league, hallOfFame: (league.hallOfFame || []).filter(e => e.id !== entryId) },
      'Hall of Fame inductee removed',
      entry ? entry.name : entryId,
    );
  };
}

export function upsertManualStatLine(seasonId, playerId, fields) {
  return (league) => replaceSeason(league, seasonId, season => {
    const isPlayoff = !!fields.isPlayoff;
    const lines = [...(season.importedStatLines || [])];
    const idx = lines.findIndex(l => l.source === 'manual' && l.playerId === playerId && !!l.isPlayoff === isPlayoff);
    const line = {
      id: idx >= 0 ? lines[idx].id : uid('imp'),
      playerId,
      source: 'manual',
      sourceSeason: 'manual',
      sourceLabel: isPlayoff ? 'Manual entry (Playoffs)' : 'Manual entry',
      importedAt: Date.now(),
      ...fields,
      isPlayoff,
    };
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
    return { ...season, importedStatLines: lines };
  });
}

export function removeStatLine(seasonId, lineId) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season, importedStatLines: (season.importedStatLines || []).filter(l => l.id !== lineId),
  }));
}

export function newNewsPostId() {
  return uid('news');
}

export function addNewsPost({ id, title, body, summary, author, imageUrl, media }) {
  return (league) => ({
    ...league,
    news: [{
      id: id || uid('news'),
      title: title.trim(),
      body: body || '',
      summary: (summary || '').trim(),
      blocks: [],
      author: (author || '').trim(),
      imageUrl: imageUrl || null,
      media: media || [],
      rankings: null,
      at: Date.now(),
    }, ...(league.news || [])],
  });
}

function mapPost(league, postId, updater) {
  return { ...league, news: (league.news || []).map(n => (n.id === postId ? updater(n) : n)) };
}

export function attachNewsMedia(postId, item) {
  return (league) => mapPost(league, postId, n => {
    const media = [...(n.media || []), item];
    const heroable = item.kind === 'image' ? item.url : null;
    return { ...n, media, imageUrl: n.imageUrl || heroable };
  });
}

export function detachNewsMedia(postId, mediaId) {
  return (league) => mapPost(league, postId, n => {
    const removed = (n.media || []).find(m => m.id === mediaId);
    const media = (n.media || []).filter(m => m.id !== mediaId);
    const clearedHero = removed && n.imageUrl === removed.url;
    const fallback = media.find(m => m.kind === 'image');
    return { ...n, media, imageUrl: clearedHero ? (fallback ? fallback.url : null) : n.imageUrl };
  });
}

export function setNewsBlocks(postId, blocks) {
  return (league) => mapPost(league, postId, n => ({ ...n, blocks }));
}

export function setNewsSummary(postId, summary) {
  return (league) => mapPost(league, postId, n => ({ ...n, summary }));
}

export function setNewsHero(postId, url) {
  return (league) => mapPost(league, postId, n => ({ ...n, imageUrl: url || null }));
}

export function updateNewsPost(postId, patch) {
  return (league) => ({
    ...league,
    news: (league.news || []).map(n => (n.id === postId ? { ...n, ...patch } : n)),
  });
}

export function removeNewsPost(postId) {
  return (league) => ({ ...league, news: (league.news || []).filter(n => n.id !== postId) });
}

export function newHighlightId() {
  return uid('hl');
}

export function addHighlight({ id, title, playerName, playerSlug, media, at }) {
  return (league) => ({
    ...league,
    highlights: [{
      id: id || uid('hl'),
      title: (title || '').trim(),
      playerName: (playerName || '').trim() || null,
      playerSlug: playerSlug || null,
      media: media || null,
      at: at || Date.now(),
    }, ...(league.highlights || [])],
  });
}

export function updateHighlight(highlightId, patch) {
  return (league) => ({
    ...league,
    highlights: (league.highlights || []).map(h => (h.id === highlightId ? { ...h, ...patch } : h)),
  });
}

export function removeHighlight(highlightId) {
  return (league) => ({ ...league, highlights: (league.highlights || []).filter(h => h.id !== highlightId) });
}
