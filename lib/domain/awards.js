import { mergeTeam, teamSlug } from './core.js';

export function playerSlug(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// A "career" spans season-roster entries that each get their own internal
// id — there's no persistent player identity in the data model, so a
// renamed player's history is pulled together by a closure match instead:
// starting from one slug, pull in every roster/free-agent entry anywhere in
// the league that shares a Roblox account id with an already-matched entry,
// or whose current name or usernameHistory (past on-site names, tracked
// when a rename is detected) overlaps an already-matched entry's names.
// That's what keeps a rename (e.g. Kremlinn -> mahalokrem) on one player
// page instead of forking into a second one. Returns the full set of slugs
// (every name this identity has ever used) so callers can match against any
// of them.
//
// The Roblox id is the only signal here that actually identifies a real
// account — a name or usernameHistory entry is just text, and two different
// real accounts can end up recording the same one (a rename, an admin typo,
// a coincidence). So a name/history match is only trusted to extend an
// identity when it doesn't contradict an id already confirmed for it: once
// two different non-null ids both surface while resolving one identity,
// that's proof of two different people, and neither is allowed to pull the
// other in just because a name string happens to line up.
function slugsOf(p) {
  return [p.name, ...((p.usernameHistory || []))].filter(Boolean).map(playerSlug);
}

// A roster/free-agent/award-winner entry belongs to a resolved identity if
// its own Roblox id agrees with one already confirmed for that identity, or
// — when the entry carries no id of its own to check — its name/history
// overlaps the identity's names. An entry whose id conflicts with the
// identity's is never included on a name match alone: that pattern (two
// accounts, one shared name string) is exactly what a false merge looks
// like, so id agreement is required whenever there's an id to check.
export function entryMatchesIdentity(entry, identity) {
  if (!entry) return false;
  const rid = entry.robloxUserId ? String(entry.robloxUserId) : null;
  if (rid && identity.ids.size > 0) return identity.ids.has(rid);
  return slugsOf(entry).some(s => identity.slugs.has(s));
}

export function resolvePlayerIdentity(snapshot, slug) {
  const entries = [];
  (snapshot.seasons || []).forEach(season => {
    (season.members || []).forEach(member => (member.roster || []).forEach(p => entries.push(p)));
    (season.freeAgents || []).forEach(p => entries.push(p));
  });

  const knownSlugs = new Set([slug]);
  const knownIds = new Set();
  const matched = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    entries.forEach((p, i) => {
      if (matched.has(i)) return;
      const rid = p.robloxUserId ? String(p.robloxUserId) : null;
      const idMatch = rid && knownIds.has(rid);
      const nameMatch = slugsOf(p).some(s => knownSlugs.has(s));
      if (!idMatch && !nameMatch) return;
      // A name match alone can't override a conflicting id: if this entry
      // carries an id and the identity already has a different one
      // confirmed, this is a different real account, not a rename.
      if (!idMatch && nameMatch && rid && knownIds.size > 0 && !knownIds.has(rid)) return;
      matched.add(i);
      changed = true;
      if (rid) knownIds.add(rid);
      slugsOf(p).forEach(s => knownSlugs.add(s));
    });
  }
  return { slugs: knownSlugs, ids: knownIds };
}

function normalizeAwardWinners(raw) {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

export function seasonTeam(season, teamsById, teamId) {
  if (!teamId) return null;
  const member = (season.members || []).find(m => m.teamId === teamId);
  if (!member) {
    const global = teamsById[teamId];
    return global ? { ...global, slug: teamSlug(global.name) } : null;
  }
  const merged = mergeTeam(teamsById[teamId] || null, member);
  return {
    id: merged.id,
    name: merged.displayName,
    abbr: merged.abbr,
    color: merged.color,
    logoUrl: merged.logoUrl,
    slug: teamSlug(merged.displayName),
  };
}

export function findSeasonPlayerById(season, playerId) {
  for (const member of season.members || []) {
    const hit = (member.roster || []).find(p => p.id === playerId);
    if (hit) return { player: hit, teamId: member.teamId };
  }
  const fa = (season.freeAgents || []).find(p => p.id === playerId);
  return fa ? { player: fa, teamId: null } : null;
}

function resolveWinner(winner, season, teamsById) {
  if (winner.type === 'team') {
    const team = seasonTeam(season, teamsById, winner.teamId);
    return { kind: 'team', name: team ? team.name : 'Unknown team', team };
  }
  const hit = winner.playerId ? findSeasonPlayerById(season, winner.playerId) : null;
  const name = hit ? hit.player.name : (winner.name || 'Unknown player');
  const teamId = hit ? hit.teamId : winner.teamId;
  return {
    kind: 'player',
    name,
    slug: playerSlug(name),
    robloxUserId: hit ? hit.player.robloxUserId : null,
    team: seasonTeam(season, teamsById, teamId),
    onRoster: !!hit,
  };
}

export function seasonAwards(snapshot, season) {
  const winners = season.awardWinners || {};
  const defs = snapshot.awardDefs || [];
  const order = new Map(defs.map((d, i) => [d.id, i]));
  return Object.keys(winners)
    .map(awardId => {
      const def = defs.find(d => d.id === awardId);
      return {
        id: awardId,
        name: def ? def.name : 'Retired award',
        description: def ? def.description : '',
        known: !!def,
        winners: normalizeAwardWinners(winners[awardId]).map(w => resolveWinner(w, season, snapshot.teams)),
      };
    })
    .filter(a => a.winners.length > 0)
    .sort((a, b) => (order.has(a.id) ? order.get(a.id) : 999) - (order.has(b.id) ? order.get(b.id) : 999));
}

export function awardsForPlayer(snapshot, slug) {
  const identity = resolvePlayerIdentity(snapshot, slug);
  const out = [];
  (snapshot.seasons || []).forEach(season => {
    seasonAwards(snapshot, season).forEach(award => {
      award.winners.forEach(w => {
        if (w.kind === 'player' && entryMatchesIdentity(w, identity)) {
          out.push({ awardId: award.id, award: award.name, seasonId: season.id, seasonName: season.name });
        }
      });
    });
    if (season.championTeamId) {
      const member = (season.members || []).find(m => m.teamId === season.championTeamId);
      const onIt = member && (member.roster || []).some(p => entryMatchesIdentity(p, identity));
      if (onIt) {
        const team = seasonTeam(season, snapshot.teams, season.championTeamId);
        out.push({ awardId: 'champion', award: `${team ? team.name : 'League'} — champion`, seasonId: season.id, seasonName: season.name, isChampionship: true });
      }
    }
  });
  return out;
}

export function playerSlugIndex(snapshot) {
  const slugs = new Set();
  if (!snapshot) return slugs;
  const addPlayer = (p) => {
    slugs.add(playerSlug(p.name));
    (p.usernameHistory || []).forEach(n => slugs.add(playerSlug(n)));
  };
  (snapshot.seasons || []).forEach(season => {
    (season.members || []).forEach(member => (member.roster || []).forEach(addPlayer));
    (season.freeAgents || []).forEach(addPlayer);
  });
  return slugs;
}

export function hallOfFameEntries(snapshot) {
  return [...(snapshot.hallOfFame || [])]
    .sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0))
    .map(entry => ({
      ...entry,
      slug: entry.playerName ? playerSlug(entry.playerName) : null,
    }));
}

export function hallOfFameFor(snapshot, slug) {
  const identity = resolvePlayerIdentity(snapshot, slug);
  return hallOfFameEntries(snapshot).find(e => e.slug && identity.slugs.has(e.slug)) || null;
}
