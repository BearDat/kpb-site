import { seasonTeam, awardsForPlayer, hallOfFameFor, resolvePlayerIdentity, entryMatchesIdentity } from './awards.js';
import { sumPlayerTotals, addTotals, computeBattingAdvanced, computePitchingAdvanced, collectPlayerStatRows } from './stats.js';

export function buildPlayer(snapshot, slug) {
  if (!snapshot) return null;
  const identity = resolvePlayerIdentity(snapshot, slug);
  const seasons = [];
  let nameCandidate = null;

  (snapshot.seasons || []).forEach(season => {
    const entries = [];
    (season.members || []).forEach(member => {
      (member.roster || []).forEach(p => {
        if (entryMatchesIdentity(p, identity)) entries.push({ player: p, teamId: member.teamId });
      });
    });
    (season.freeAgents || []).forEach(p => {
      if (entryMatchesIdentity(p, identity)) entries.push({ player: p, teamId: null });
    });
    if (entries.length === 0) return;

    const ids = new Set(entries.map(e => e.player.id));
    const rowsByPlayer = collectPlayerStatRows(season, { playoffs: false });
    const rows = [...ids].flatMap(id => rowsByPlayer.get(id) || []);
    const totals = sumPlayerTotals(rows);
    const playoffRowsByPlayer = collectPlayerStatRows(season, { playoffs: true });
    const playoffRows = [...ids].flatMap(id => playoffRowsByPlayer.get(id) || []);
    const playoffTotals = sumPlayerTotals(playoffRows);
    // Every name this identity has used shows up somewhere in the loop —
    // keep whichever comes from the most recently created season (or the
    // active one) so the page displays the player's current name, not
    // whichever old name this season happens to iterate to first.
    const isBetterName = !nameCandidate
      || season.id === snapshot.activeSeasonId
      || (nameCandidate.seasonId !== snapshot.activeSeasonId && (season.createdAt || 0) >= (nameCandidate.createdAt || 0));
    if (isBetterName) nameCandidate = { name: entries[0].player.name, seasonId: season.id, createdAt: season.createdAt };

    seasons.push({
      id: season.id,
      name: season.name,
      player: entries[0].player,
      team: seasonTeam(season, snapshot.teams, entries[0].teamId),
      hasStats: rows.length > 0,
      totals,
      batting: computeBattingAdvanced(totals),
      pitching: computePitchingAdvanced(totals),
      hasPlayoffStats: playoffRows.length > 0,
      playoffTotals,
      playoffBatting: computeBattingAdvanced(playoffTotals),
      playoffPitching: computePitchingAdvanced(playoffTotals),
    });
  });

  if (seasons.length === 0) return null;

  const name = nameCandidate.name;
  const withStats = seasons.filter(s => s.hasStats);
  const careerTotals = addTotals(withStats.map(s => s.totals));
  const withPlayoffStats = seasons.filter(s => s.hasPlayoffStats);
  const careerPlayoffTotals = addTotals(withPlayoffStats.map(s => s.playoffTotals));
  const current = seasons.find(s => s.id === snapshot.activeSeasonId) || seasons[0];
  return {
    slug,
    name,
    seasons,
    current,
    hasStats: withStats.length > 0,
    career: {
      totals: careerTotals,
      batting: computeBattingAdvanced(careerTotals),
      pitching: computePitchingAdvanced(careerTotals),
    },
    hasPlayoffStats: withPlayoffStats.length > 0,
    careerPlayoffs: {
      totals: careerPlayoffTotals,
      batting: computeBattingAdvanced(careerPlayoffTotals),
      pitching: computePitchingAdvanced(careerPlayoffTotals),
    },
    awards: awardsForPlayer(snapshot, slug),
    hallOfFame: hallOfFameFor(snapshot, slug),
  };
}
