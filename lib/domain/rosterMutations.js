import { uid } from './core.js';

function replaceSeason(league, seasonId, updater) {
  return { ...league, seasons: (league.seasons || []).map(s => (s.id === seasonId ? updater(s) : s)) };
}

function stripOddsCache(season) {
  const next = { ...season };
  delete next.oddsCache;
  return next;
}

function appendActivity(season, entry) {
  return [...(season.activityLog || []), { id: uid('act'), at: Date.now(), ...entry }];
}

function ownerOf(season, playerId) {
  return (season.members || []).find(m => (m.roster || []).some(p => p.id === playerId)) || null;
}

export function addPlayer(seasonId, teamId, name, starLevel) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season,
    members: (season.members || []).map(m => (m.teamId === teamId
      ? {
        ...m,
        roster: [...(m.roster || []), {
          id: uid('p'),
          name: name.trim(),
          starLevel: starLevel === '' || starLevel === null || starLevel === undefined ? null : Number(starLevel),
          role: '',
        }],
      }
      : m)),
    activityLog: appendActivity(season, { type: 'add', teamId, text: `${name.trim()} added` }),
  }));
}

export function updatePlayer(seasonId, playerId, fields) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season,
    members: (season.members || []).map(m => ({
      ...m, roster: (m.roster || []).map(p => (p.id === playerId ? { ...p, ...fields } : p)),
    })),
    freeAgents: (season.freeAgents || []).map(p => (p.id === playerId ? { ...p, ...fields } : p)),
  }));
}

export function releasePlayer(seasonId, playerId) {
  return (league) => replaceSeason(league, seasonId, season => {
    const owner = ownerOf(season, playerId);
    if (!owner) return season;
    const player = owner.roster.find(p => p.id === playerId);
    return {
      ...season,
      members: (season.members || []).map(m => (m.teamId === owner.teamId
        ? { ...m, roster: m.roster.filter(p => p.id !== playerId) }
        : m)),
      freeAgents: [...(season.freeAgents || []), player],
      activityLog: appendActivity(season, { type: 'remove', teamId: owner.teamId, text: `${player.name} released` }),
    };
  });
}

export function signFreeAgent(seasonId, teamId, playerId) {
  return (league) => replaceSeason(league, seasonId, season => {
    const player = (season.freeAgents || []).find(p => p.id === playerId);
    if (!player) return season;
    return {
      ...season,
      freeAgents: (season.freeAgents || []).filter(p => p.id !== playerId),
      members: (season.members || []).map(m => (m.teamId === teamId
        ? { ...m, roster: [...(m.roster || []), player] }
        : m)),
      activityLog: appendActivity(season, { type: 'add', teamId, text: `${player.name} signed` }),
    };
  });
}

export function deleteFreeAgent(seasonId, playerId) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season, freeAgents: (season.freeAgents || []).filter(p => p.id !== playerId),
  }));
}

export function tradePlayers(seasonId, moves) {
  return (league) => replaceSeason(league, seasonId, season => {
    const carried = [];
    moves.forEach(({ playerId, toTeamId }) => {
      const owner = ownerOf(season, playerId);
      const player = owner ? owner.roster.find(p => p.id === playerId) : null;
      if (player && owner.teamId !== toTeamId) carried.push({ player, toTeamId, fromTeamId: owner.teamId });
    });
    if (carried.length === 0) return season;
    const moving = new Set(carried.map(c => c.player.id));
    return {
      ...season,
      members: (season.members || []).map(m => ({
        ...m,
        roster: [
          ...(m.roster || []).filter(p => !moving.has(p.id)),
          ...carried.filter(c => c.toTeamId === m.teamId).map(c => c.player),
        ],
      })),
      activityLog: appendActivity(season, {
        type: 'trade',
        teamId: carried[0].fromTeamId,
        toTeamId: carried[0].toTeamId,
        text: `Trade: ${carried.map(c => c.player.name).join(', ')}`,
      }),
    };
  });
}

export function setPlayerDiscipline(seasonId, playerId, fields) {
  return (league) => replaceSeason(league, seasonId, season => {
    const owner = ownerOf(season, playerId);
    const played = owner
      ? (season.games || []).filter(g => g.played && !g.isBye
        && (g.homeTeamId === owner.teamId || g.awayTeamId === owner.teamId)).length
      : 0;
    const isSuspension = fields.suspended !== undefined;
    const patch = isSuspension
      ? {
        suspended: fields.suspended,
        suspensionReason: fields.suspended ? (fields.reason || '') : '',
        suspensionGames: fields.suspended ? (fields.games || null) : null,
        suspensionStartGames: fields.suspended ? played : null,
      }
      : { banned: fields.banned, banReason: fields.banned ? (fields.reason || '') : '' };

    const found = owner
      ? owner.roster.find(p => p.id === playerId)
      : (season.freeAgents || []).find(p => p.id === playerId);
    const name = found ? found.name : 'Player';
    const text = isSuspension
      ? `${name} ${fields.suspended ? 'suspended' : 'reinstated'}${fields.reason ? ` — ${fields.reason}` : ''}`
      : `${name} ${fields.banned ? 'banned' : 'unbanned'}${fields.reason ? ` — ${fields.reason}` : ''}`;

    return {
      ...season,
      members: (season.members || []).map(m => ({
        ...m, roster: (m.roster || []).map(p => (p.id === playerId ? { ...p, ...patch } : p)),
      })),
      freeAgents: (season.freeAgents || []).map(p => (p.id === playerId ? { ...p, ...patch } : p)),
      activityLog: appendActivity(season, {
        type: isSuspension ? (fields.suspended ? 'suspend' : 'unsuspend') : (fields.banned ? 'ban' : 'unban'),
        teamId: owner ? owner.teamId : null,
        text,
      }),
    };
  });
}

export function setRebrand(seasonId, teamId, rebrand) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season,
    members: (season.members || []).map(m => (m.teamId === teamId ? { ...m, rebrand } : m)),
  }));
}

export function setMemberActive(seasonId, teamId, active) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season,
    members: (season.members || []).map(m => (m.teamId === teamId ? { ...m, active } : m)),
  }));
}

export function removeMember(seasonId, teamId) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season, members: (season.members || []).filter(m => m.teamId !== teamId),
  }));
}

export function addDivision(seasonId, name) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season, divisions: [...(season.divisions || []), { id: uid('div'), name: name.trim() }],
  }));
}

export function renameDivision(seasonId, divisionId, name) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season, divisions: (season.divisions || []).map(d => (d.id === divisionId ? { ...d, name: name.trim() } : d)),
  }));
}

export function removeDivision(seasonId, divisionId) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season,
    divisions: (season.divisions || []).filter(d => d.id !== divisionId),
    members: (season.members || []).map(m => (m.divisionId === divisionId ? { ...m, divisionId: null } : m)),
  }));
}

export function setMemberDivision(seasonId, teamId, divisionId) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season, members: (season.members || []).map(m => (m.teamId === teamId ? { ...m, divisionId: divisionId || null } : m)),
  }));
}

export function setSeasonSettings(seasonId, settings) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season, settings: { ...(season.settings || {}), ...settings },
  }));
}

export function setActiveSeason(seasonId) {
  return (league) => ({ ...league, activeSeasonId: seasonId });
}

export function setChampion(seasonId, teamId) {
  return (league) => replaceSeason(league, seasonId, season => ({ ...season, championTeamId: teamId || null }));
}

export function addSeason(name) {
  return (league) => {
    const season = {
      id: uid('season'),
      name: name.trim(),
      createdAt: Date.now(),
      championTeamId: null,
      settings: { playoffSpots: 4, standardInnings: 7, seriesLength: 1, scheduleMode: 'date' },
      members: [],
      games: [],
      freeAgents: [],
      activityLog: [],
      awardWinners: {},
      importedStatLines: [],
    };
    return { ...league, seasons: [season, ...(league.seasons || [])] };
  };
}

export function addGame(seasonId, game) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season,
    games: [...(season.games || []), {
      id: uid('g'),
      played: false,
      homeScore: null,
      awayScore: null,
      innings: (season.settings && season.settings.standardInnings) || 7,
      ...game,
    }],
  }));
}

export function removeGame(seasonId, gameId) {
  return (league) => replaceSeason(league, seasonId, season => stripOddsCache({
    ...season, games: (season.games || []).filter(g => g.id !== gameId),
  }));
}

export function swapHomeAway(seasonId, gameId) {
  return (league) => replaceSeason(league, seasonId, season => ({
    ...season,
    games: (season.games || []).map(g => (g.id === gameId ? {
      ...g,
      homeTeamId: g.awayTeamId,
      awayTeamId: g.homeTeamId,
      homeScore: g.awayScore,
      awayScore: g.homeScore,
      forfeitBy: g.forfeitBy === 'home' ? 'away' : g.forfeitBy === 'away' ? 'home' : g.forfeitBy,
      winnerOverride: g.winnerOverride === 'home' ? 'away' : g.winnerOverride === 'away' ? 'home' : g.winnerOverride,
    } : g)),
  }));
}

export function clearPlayoffs(seasonId) {
  return (league) => replaceSeason(league, seasonId, season => stripOddsCache({
    ...season,
    games: (season.games || []).filter(g => !g.isPlayoff && !g.isPlayIn),
    championTeamId: null,
  }));
}

export function generateRoundRobin(seasonId, rounds) {
  return (league) => replaceSeason(league, seasonId, season => {
    const teams = (season.members || []).filter(m => m.active !== false).map(m => m.teamId);
    if (teams.length < 2) return season;
    const games = [];
    for (let r = 0; r < rounds; r += 1) {
      for (let i = 0; i < teams.length; i += 1) {
        for (let j = i + 1; j < teams.length; j += 1) {
          const flip = r % 2 === 1;
          games.push({
            id: uid('g'),
            date: `Round ${r + 1}`,
            homeTeamId: flip ? teams[j] : teams[i],
            awayTeamId: flip ? teams[i] : teams[j],
            homeScore: null,
            awayScore: null,
            innings: (season.settings && season.settings.standardInnings) || 7,
            played: false,
          });
        }
      }
    }
    return { ...season, games: [...(season.games || []), ...games] };
  });
}
