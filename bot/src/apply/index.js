import { uid, replaceSeason, appendActivity, appendAudit, findRosterPlayer } from '../league/core.js';
import { advancePlayIn, advancePlayoffs } from '../league/playoffs.js';

function activeSeasonId(league) {
  const season = league.seasons.find(s => s.id === league.activeSeasonId) || league.seasons[league.seasons.length - 1];
  return season ? season.id : null;
}

function stripOddsCache(season) {
  const next = { ...season };
  delete next.oddsCache;
  return next;
}

export function applyFinalScore(league, item, nameFor, actor) {
  const seasonId = activeSeasonId(league);
  let summary = '';
  const next = replaceSeason(league, seasonId, season => {
    const baseGames = item.newGame && !(season.games || []).some(g => g.id === item.newGame.id)
      ? [...(season.games || []), item.newGame]
      : (season.games || []);
    const updatedGames = baseGames.map(g => (g.id === item.gameId
      ? {
        ...g,
        homeScore: item.homeScore,
        awayScore: item.awayScore,
        innings: item.innings == null ? g.innings : item.innings,
        played: true,
        isForfeit: false,
        forfeitBy: null,
        isOngoing: false,
        isDelayed: false,
        notes: item.notes ? [g.notes, item.notes].filter(Boolean).join(' — ') : g.notes,
      }
      : g));
    const { games: afterPlayIn } = advancePlayIn(updatedGames);
    const { games, championTeamId } = advancePlayoffs(afterPlayIn, season.settings || {}, null);
    const game = games.find(g => g.id === item.gameId);
    summary = game
      ? `${nameFor(game.awayTeamId)} ${game.awayScore} @ ${nameFor(game.homeTeamId)} ${game.homeScore}`
      : 'score recorded';
    return stripOddsCache({
      ...season,
      games,
      championTeamId: championTeamId !== undefined ? championTeamId : season.championTeamId,
    });
  });
  return { league: appendAudit(next, 'Score recorded by bot', summary, actor), summary };
}

export function applyGameTime(league, item, nameFor, actor) {
  const seasonId = activeSeasonId(league);
  let summary = '';
  const next = replaceSeason(league, seasonId, season => {
    const games = (season.games || []).map(g => (g.id === item.gameId ? { ...g, gameTimeUTC: item.gameTimeUTC } : g));
    const game = games.find(g => g.id === item.gameId);
    summary = game
      ? `${nameFor(game.awayTeamId)} @ ${nameFor(game.homeTeamId)} set to ${new Date(item.gameTimeUTC).toISOString()}`
      : 'game time set';
    return { ...season, games };
  });
  return { league: appendAudit(next, 'Game time set by bot', summary, actor), summary };
}

export function applyTrade(league, item, nameFor, actor) {
  const seasonId = activeSeasonId(league);
  let summary = '';
  const next = replaceSeason(league, seasonId, season => {
    const moves = [];
    item.sides.forEach(side => {
      side.playerIds.forEach(playerId => {
        const owner = (season.members || []).find(m => (m.roster || []).some(p => p.id === playerId));
        const player = owner ? owner.roster.find(p => p.id === playerId) : null;
        if (player) moves.push({ player, fromTeamId: owner.teamId, toTeamId: side.teamId });
      });
    });
    if (moves.length === 0) return season;

    const movingIds = new Set(moves.map(m => m.player.id));
    const members = (season.members || []).map(m => {
      const kept = (m.roster || []).filter(p => !movingIds.has(p.id));
      const incoming = moves.filter(mv => mv.toTeamId === m.teamId).map(mv => mv.player);
      return { ...m, roster: [...kept, ...incoming] };
    });

    const parts = item.sides.map(side => {
      const received = moves.filter(mv => mv.toTeamId === side.teamId).map(mv => mv.player.name);
      return `${nameFor(side.teamId)} receive ${received.join(', ')}`;
    });
    summary = `Trade: ${parts.join(' — ')}`;
    const activityLog = appendActivity(season, {
      type: 'trade',
      teamId: item.sides[0].teamId,
      toTeamId: item.sides[1] ? item.sides[1].teamId : null,
      text: summary,
    });
    return { ...season, members, activityLog };
  });
  return { league: appendAudit(next, 'Trade recorded by bot', summary, actor), summary };
}

export function applySign(league, item, nameFor, actor) {
  const seasonId = activeSeasonId(league);
  let summary = '';
  const next = replaceSeason(league, seasonId, season => {
    const teamName = nameFor(item.teamId);
    const existing = (season.freeAgents || []).find(p => p.id === item.playerId);
    const player = existing || {
      id: uid('p'),
      name: item.playerName,
      starLevel: item.starLevel === undefined ? null : item.starLevel,
      role: '',
    };
    const freeAgents = (season.freeAgents || []).filter(p => p.id !== player.id);
    const members = (season.members || []).map(m => (m.teamId === item.teamId
      ? { ...m, roster: [...(m.roster || []), player] }
      : m));
    summary = `${player.name} signed by ${teamName}`;
    const activityLog = appendActivity(season, { type: 'add', teamId: item.teamId, text: summary });
    return { ...season, members, freeAgents, activityLog };
  });
  return { league: appendAudit(next, 'Signing recorded by bot', summary, actor), summary };
}

export function applyRelease(league, item, nameFor, actor) {
  const seasonId = activeSeasonId(league);
  let summary = '';
  const next = replaceSeason(league, seasonId, season => {
    const owner = (season.members || []).find(m => (m.roster || []).some(p => p.id === item.playerId));
    if (!owner) return season;
    const player = owner.roster.find(p => p.id === item.playerId);
    const teamName = nameFor(owner.teamId);
    const members = (season.members || []).map(m => (m.teamId === owner.teamId
      ? { ...m, roster: m.roster.filter(p => p.id !== item.playerId) }
      : m));
    const freeAgents = [...(season.freeAgents || []), player];
    summary = `${player.name} released by ${teamName} — now a free agent`;
    const activityLog = appendActivity(season, { type: 'remove', teamId: owner.teamId, text: summary });
    return { ...season, members, freeAgents, activityLog };
  });
  return { league: appendAudit(next, 'Release recorded by bot', summary, actor), summary };
}

export function applySuspension(league, item, nameFor, actor) {
  const seasonId = activeSeasonId(league);
  let summary = '';
  const next = replaceSeason(league, seasonId, season => {
    const owner = (season.members || []).find(m => (m.roster || []).some(p => p.id === item.playerId));
    if (!owner) return season;
    const player = owner.roster.find(p => p.id === item.playerId);
    const gamesPlayed = (season.games || []).filter(g => g.played && !g.isBye && (g.homeTeamId === owner.teamId || g.awayTeamId === owner.teamId)).length;
    const suspended = item.suspended !== false;
    summary = suspended
      ? `${player.name} (${nameFor(owner.teamId)}) suspended${item.games ? ` for ${item.games} game${item.games === 1 ? '' : 's'}` : ''}${item.reason ? ` — ${item.reason}` : ''}`
      : `${player.name} (${nameFor(owner.teamId)}) suspension lifted`;
    const members = (season.members || []).map(m => (m.teamId === owner.teamId
      ? {
        ...m,
        roster: m.roster.map(p => (p.id === item.playerId
          ? {
            ...p,
            suspended,
            suspensionReason: suspended ? (item.reason || '') : '',
            suspensionGames: suspended ? (item.games || null) : null,
            suspensionStartGames: suspended ? gamesPlayed : null,
          }
          : p)),
      }
      : m));
    const activityLog = appendActivity(season, {
      type: suspended ? 'suspend' : 'unsuspend',
      teamId: owner.teamId,
      text: summary,
    });
    return { ...season, members, activityLog };
  });
  return { league: appendAudit(next, suspended(item) ? 'Player suspended by bot' : 'Suspension lifted by bot', summary, actor), summary };
}

function suspended(item) {
  return item.suspended !== false;
}

export function applyBan(league, item, nameFor, actor) {
  const seasonId = activeSeasonId(league);
  let summary = '';
  const banned = item.banned !== false;
  const next = replaceSeason(league, seasonId, season => {
    const owner = (season.members || []).find(m => (m.roster || []).some(p => p.id === item.playerId));
    const fa = owner ? null : (season.freeAgents || []).find(p => p.id === item.playerId);
    const player = owner ? owner.roster.find(p => p.id === item.playerId) : fa;
    if (!player) return season;
    const teamName = owner ? nameFor(owner.teamId) : 'free agency';
    summary = banned
      ? `${player.name} (${teamName}) banned${item.reason ? ` — ${item.reason}` : ''}`
      : `${player.name} ban lifted`;
    const members = (season.members || []).map(m => ({
      ...m,
      roster: (m.roster || []).map(p => (p.id === item.playerId
        ? { ...p, banned, banReason: banned ? (item.reason || '') : '' }
        : p)),
    }));
    const freeAgents = (season.freeAgents || []).map(p => (p.id === item.playerId
      ? { ...p, banned, banReason: banned ? (item.reason || '') : '' }
      : p));
    const activityLog = appendActivity(season, {
      type: banned ? 'ban' : 'unban',
      teamId: owner ? owner.teamId : null,
      text: summary,
    });
    return { ...season, members, freeAgents, activityLog };
  });
  return { league: appendAudit(next, banned ? 'Player banned by bot' : 'Ban lifted by bot', summary, actor), summary };
}

export function applyAwards(league, item, nameFor, actor) {
  const known = league.awardDefs || [];
  const awardDefs = item.newAwardDefs.length > 0 ? [...known, ...item.newAwardDefs] : known;
  const withDefs = { ...league, awardDefs };
  const next = replaceSeason(withDefs, item.seasonId, season => ({ ...season, awardWinners: item.awardWinners }));

  const { awards, winners, previousAwards, previousWinners } = item.counts;
  const headline = `${item.seasonName} awards — ${awards} award${awards === 1 ? '' : 's'}, ${winners} winner${winners === 1 ? '' : 's'}`;
  const replaced = previousWinners > 0
    ? ` (replaced ${previousAwards} award${previousAwards === 1 ? '' : 's'}, ${previousWinners} winner${previousWinners === 1 ? '' : 's'})`
    : '';
  const summary = [`${headline}${replaced}`, ...item.roll, ...item.notes].join('\n');

  return { league: appendAudit(next, 'Awards recorded by bot', headline, actor), summary };
}

export const APPLIERS = {
  final_score: applyFinalScore,
  game_time: applyGameTime,
  trade: applyTrade,
  sign: applySign,
  release: applyRelease,
  suspend: applySuspension,
  unsuspend: applySuspension,
  ban: applyBan,
  unban: applyBan,
  awards: applyAwards,
};

export { findRosterPlayer };
