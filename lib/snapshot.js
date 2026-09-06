import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const LEAGUE_ID = process.env.NEXT_PUBLIC_LEAGUE_ID;

export const SNAPSHOT_TTL_MS = 60000;

function client() {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isDataUri(value) {
  return typeof value === 'string' && value.startsWith('data:');
}

function slimTeam(id, team) {
  return {
    id,
    name: team.name || 'Unknown team',
    abbr: team.abbr || null,
    color: team.color || null,
    logoUrl: isDataUri(team.logoUrl) ? `/api/team-logo/${encodeURIComponent(id)}` : (team.logoUrl || null),
  };
}

function slimRebrand(rebrand, teamId) {
  if (!rebrand) return null;
  return {
    name: rebrand.name || null,
    abbr: rebrand.abbr || null,
    color: rebrand.color || null,
    logoUrl: isDataUri(rebrand.logoUrl) ? `/api/team-logo/${encodeURIComponent(teamId)}` : (rebrand.logoUrl || null),
  };
}

function slimPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    starLevel: typeof p.starLevel === 'number' ? p.starLevel : null,
    role: p.role || '',
    robloxUserId: p.robloxUserId || null,
    suspended: !!p.suspended,
    banned: !!p.banned,
  };
}

function slimSeason(season) {
  return {
    id: season.id,
    name: season.name,
    createdAt: season.createdAt || null,
    championTeamId: season.championTeamId || null,
    settings: season.settings || {},
    activityLog: season.activityLog || [],
    awardWinners: season.awardWinners || {},
    divisions: (season.divisions || []).map(d => ({ id: d.id, name: d.name || 'Division' })),
    members: (season.members || []).map(m => ({
      teamId: m.teamId,
      scheduleName: m.scheduleName || null,
      rebrand: slimRebrand(m.rebrand, m.teamId),
      active: m.active !== false,
      baselineW: Number(m.baselineW) || 0,
      baselineL: Number(m.baselineL) || 0,
      baselineRF: Number(m.baselineRF) || 0,
      baselineRA: Number(m.baselineRA) || 0,
      divisionId: m.divisionId || null,
      roster: (m.roster || []).map(slimPlayer),
    })),
    freeAgents: (season.freeAgents || []).map(slimPlayer),
    games: season.games || [],
    importedStatLines: season.importedStatLines || [],
  };
}

async function readLeague(supabase) {
  const { data, error } = await supabase
    .from('kv_store')
    .select('value, updated_at')
    .eq('key', `league:${LEAGUE_ID}`)
    .maybeSingle();
  if (error || !data) return null;
  try {
    return { league: JSON.parse(data.value), updatedAt: data.updated_at };
  } catch (e) {
    return null;
  }
}

async function readTeams(supabase, teamIds) {
  const ids = [...new Set(teamIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from('kv_store')
    .select('key, value')
    .in('key', ids.map(id => `team:${id}`));
  if (error || !data) return {};
  const teams = {};
  data.forEach(row => {
    const id = row.key.replace(/^team:/, '');
    try {
      teams[id] = slimTeam(id, JSON.parse(row.value));
    } catch (e) {
    }
  });
  return teams;
}

export async function buildSnapshot() {
  const supabase = client();
  if (!supabase || !LEAGUE_ID) return null;
  const row = await readLeague(supabase);
  if (!row) return null;

  const { league, updatedAt } = row;
  const seasons = (league.seasons || []).map(slimSeason);
  const teams = await readTeams(supabase, seasons.flatMap(s => s.members.map(m => m.teamId)));

  return {
    updatedAt,
    fetchedAt: Date.now(),
    id: league.id || LEAGUE_ID,
    name: league.name || 'League',
    info: league.info || {},
    staff: league.staff || [],
    news: (league.news || []).map(n => ({
      id: n.id,
      title: n.title || '',
      body: n.body || '',
      summary: n.summary || '',
      blocks: Array.isArray(n.blocks) ? n.blocks : null,
      author: n.author || '',
      at: n.at || null,
      imageUrl: isDataUri(n.imageUrl) ? `/api/news-image/${encodeURIComponent(n.id)}` : (n.imageUrl || null),
      media: (n.media || []).filter(m => m && m.url && !isDataUri(m.url)),
      rankings: n.rankings || null,
    })),
    awardDefs: league.awardDefs || [],
    hallOfFame: league.hallOfFame || [],
    highlights: (league.highlights || []).map(h => ({
      id: h.id,
      title: h.title || '',
      playerName: h.playerName || null,
      playerSlug: h.playerSlug || null,
      media: h.media && h.media.url && !isDataUri(h.media.url) ? h.media : null,
      at: h.at || null,
    })).filter(h => h.media),
    activeSeasonId: league.activeSeasonId || null,
    seasons,
    teams,
  };
}

let cached = null;
let inFlight = null;

export async function getSnapshot({ force = false } = {}) {
  if (!force && cached && Date.now() - cached.fetchedAt < SNAPSHOT_TTL_MS) return cached;
  if (force) {
    cached = null;
    inFlight = null;
  }
  if (!inFlight) {
    inFlight = buildSnapshot()
      .then(snapshot => {
        if (snapshot) cached = snapshot;
        return snapshot || cached;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}
