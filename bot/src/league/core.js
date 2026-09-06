export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getActiveSeason(league) {
  if (!league || !Array.isArray(league.seasons) || league.seasons.length === 0) return null;
  return league.seasons.find(s => s.id === league.activeSeasonId) || league.seasons[league.seasons.length - 1];
}

export function replaceSeason(league, seasonId, updater) {
  return { ...league, seasons: league.seasons.map(s => (s.id === seasonId ? updater(s) : s)) };
}

export function gameWinner(g) {
  if (g.winnerOverride === 'home' || g.winnerOverride === 'away') return g.winnerOverride;
  const hs = Number(g.homeScore);
  const as = Number(g.awayScore);
  if (Number.isNaN(hs) || Number.isNaN(as)) return null;
  if (hs > as) return 'home';
  if (as > hs) return 'away';
  return null;
}

export function teamDisplayName(teamId, season, teamsById) {
  const member = (season && season.members ? season.members : []).find(m => m.teamId === teamId);
  const team = teamsById ? teamsById[teamId] : null;
  const rebrand = member && member.rebrand;
  return (rebrand && rebrand.name) || (team && team.name) || (member && member.scheduleName) || 'Unknown team';
}

export function appendActivity(season, entry) {
  return [...(season.activityLog || []), { id: uid('act'), at: Date.now(), ...entry }];
}

export function appendAudit(league, action, detail, actor = null) {
  const entry = { id: uid('audit'), action, detail: detail || '', actor: actor || null, at: Date.now() };
  return { ...league, auditLog: [...(league.auditLog || []).slice(-99), entry] };
}

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

export function findRosterPlayer(season, name) {
  const target = norm(name);
  if (!target) return null;
  for (const member of season.members || []) {
    for (const player of member.roster || []) {
      if (norm(player.name) === target) {
        return { player, teamId: member.teamId, location: 'roster' };
      }
    }
  }
  for (const player of season.freeAgents || []) {
    if (norm(player.name) === target) {
      return { player, teamId: null, location: 'freeAgent' };
    }
  }
  return null;
}

export function findPlayerFuzzy(season, name) {
  const exact = findRosterPlayer(season, name);
  if (exact) return { match: exact, exact: true, candidates: [] };
  const target = norm(name);
  if (!target) return { match: null, exact: false, candidates: [] };
  const candidates = [];
  for (const member of season.members || []) {
    for (const player of member.roster || []) {
      if (norm(player.name).includes(target) || target.includes(norm(player.name))) {
        candidates.push({ player, teamId: member.teamId, location: 'roster' });
      }
    }
  }
  for (const player of season.freeAgents || []) {
    if (norm(player.name).includes(target) || target.includes(norm(player.name))) {
      candidates.push({ player, teamId: null, location: 'freeAgent' });
    }
  }
  return { match: candidates.length === 1 ? candidates[0] : null, exact: false, candidates };
}

export function parseStarValue(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s || /^r$/i.test(s)) return null;
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function rosterStarTotal(roster) {
  return (roster || [])
    .filter(p => typeof p.starLevel === 'number')
    .reduce((sum, p) => sum + p.starLevel, 0);
}
