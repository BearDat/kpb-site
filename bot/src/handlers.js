import { config } from './config.js';
import { log } from './logger.js';
import { getLeagueRaw, mutateLeague, markProcessed, isProcessed, ConflictError } from './store.js';
import { getActiveSeason } from './league/core.js';
import { loadTeamDirectory, loadEmojiAliases } from './resolve/teams.js';
import { parseForChannel } from './parsers/index.js';
import { resolveParsed } from './resolve/index.js';
import { APPLIERS } from './apply/index.js';
import { createPending, closePending } from './queue.js';
import { sendReviewDm, notifyApplied, notifyFailure } from './discord/confirm.js';

export async function buildContext({ learn = true } = {}) {
  const raw = await getLeagueRaw();
  if (!raw) throw new Error(`league:${config.leagueId} not found in kv_store`);
  const league = raw.data;
  const season = getActiveSeason(league);
  if (!season) throw new Error('league has no seasons');
  const directory = await loadTeamDirectory(season);
  const aliases = await loadEmojiAliases();
  const byId = new Map(directory.map(t => [t.teamId, t.name]));
  return {
    league,
    season,
    directory,
    aliases,
    learn,
    nameFor: (teamId) => byId.get(teamId) || 'Unknown team',
    directoryForSeason: (target) => (target.id === season.id ? directory : loadTeamDirectory(target)),
  };
}

function precheck(kind, item, season, league) {
  if (kind === 'final_score') {
    const game = (season.games || []).find(g => g.id === item.gameId);
    if (!game) {
      if (!item.newGame) return 'that game is no longer on the schedule';
      const slotGames = (season.games || []).filter(g => g.isPlayoff
        && g.playoffRound === item.newGame.playoffRound
        && g.bracketSlot === item.newGame.bracketSlot);
      if (slotGames.some(g => (g.seriesGame || 1) === item.newGame.seriesGame)) {
        return 'someone already added that series game';
      }
      return null;
    }
    if (game.played) return 'that game was already scored by someone else';
    return null;
  }
  if (kind === 'game_time') {
    const game = (season.games || []).find(g => g.id === item.gameId);
    if (!game) return 'that game is no longer on the schedule';
    return null;
  }
  if (kind === 'release') {
    const owner = (season.members || []).find(m => (m.roster || []).some(p => p.id === item.playerId));
    if (!owner) return 'that player is no longer on a roster';
    return null;
  }
  if (kind === 'trade') {
    for (const side of item.sides) {
      for (const playerId of side.playerIds) {
        const owner = (season.members || []).find(m => (m.roster || []).some(p => p.id === playerId));
        if (!owner) return 'one of the traded players is no longer on a roster';
        if (owner.teamId === side.teamId) return 'one of the traded players is already on the receiving team';
      }
    }
    return null;
  }
  if (kind === 'awards') {
    if (!(league.seasons || []).some(s => s.id === item.seasonId)) return 'that season is no longer in the league';
    return null;
  }
  if (kind === 'sign') {
    const rostered = (season.members || []).some(m => (m.roster || []).some(p => p.id === item.playerId));
    if (item.playerId && rostered) return 'that player was already signed by someone else';
    return null;
  }
  return null;
}

export async function applyResolved(resolved, ctx, actor = null) {
  const applier = APPLIERS[resolved.kind];
  if (!applier) throw new Error(`no applier for ${resolved.kind}`);
  let blocked = null;
  let summary = '';
  await mutateLeague(league => {
    const season = getActiveSeason(league);
    blocked = precheck(resolved.kind, resolved.item, season, league);
    if (blocked) return null;
    const result = applier(league, resolved.item, ctx.nameFor, actor);
    summary = result.summary;
    return result.league;
  });
  if (blocked) return { applied: false, blocked };
  return { applied: true, summary };
}

async function handleResolved(client, resolved, ctx, context) {
  if (resolved.confidence === 'high' && config.autoApply && resolved.item) {
    try {
      const result = await applyResolved(resolved, ctx, context.authorTag);
      if (result.applied) {
        log.info('applied', { kind: resolved.kind, summary: result.summary });
        await notifyApplied(client, result.summary, context, context.authorTag);
        return { outcome: 'applied', detail: result.summary };
      }
      resolved.reasons.push(result.blocked);
    } catch (e) {
      if (e instanceof ConflictError) resolved.reasons.push('the league data kept changing while I tried to save');
      else resolved.reasons.push(`save failed: ${e.message}`);
      log.error('apply failed', { kind: resolved.kind, error: e.message });
    }
  }

  const pendingId = await createPending({
    kind: resolved.kind,
    channelId: context.channelId,
    messageId: context.messageId,
    guildId: context.guildId,
    authorTag: context.authorTag,
    rawText: resolved.display.line || context.rawText,
    parsed: { item: resolved.item, display: resolved.display },
    reasons: resolved.reasons,
  });
  if (!pendingId) return { outcome: 'error', detail: 'could not queue for review' };
  await sendReviewDm(client, pendingId, resolved, context);
  return { outcome: 'queued', detail: resolved.reasons.join('; ') };
}

export async function processMessage(client, message, kind, { force = false } = {}) {
  if (message.author && message.author.bot) return;
  const content = message.content || '';
  if (!content.trim()) return;

  if (!force && await isProcessed(message.id)) {
    log.debug('already processed', { messageId: message.id });
    return;
  }

  let ctx;
  try {
    ctx = await buildContext();
  } catch (e) {
    log.error('context build failed', { error: e.message });
    await notifyFailure(client, 'Could not read the league', e.message);
    return;
  }

  const parsedRows = parseForChannel(kind, content);
  if (parsedRows.length === 0) {
    await markProcessed(message.id, kind, 'ignored', 'nothing to parse');
    return;
  }

  const context = {
    channelId: message.channelId,
    messageId: message.id,
    guildId: message.guildId,
    authorTag: message.author ? message.author.tag : null,
    rawText: content,
    announce: kind === 'awards',
  };

  const outcomes = [];
  for (const parsed of parsedRows) {
    const resolved = await resolveParsed(parsed, ctx);
    if (resolved.kind === 'skip' || (resolved.kind === 'unparsed' && parsedRows.length > 1)) {
      outcomes.push('skipped');
      continue;
    }
    const result = await handleResolved(client, resolved, ctx, context);
    outcomes.push(result.outcome);
    if (result.outcome === 'applied') {
      ctx = await buildContext();
    }
  }

  const summary = outcomes.reduce((acc, o) => {
    acc[o] = (acc[o] || 0) + 1;
    return acc;
  }, {});
  await markProcessed(message.id, kind, outcomes.includes('applied') ? 'applied' : outcomes.includes('queued') ? 'queued' : 'ignored', JSON.stringify(summary));
  log.info('message handled', { kind, messageId: message.id, summary });
}

export async function reprocessPending(client, pending) {
  const channel = await client.channels.fetch(pending.channel_id);
  const message = await channel.messages.fetch(pending.message_id);
  const kind = config.channels.get(pending.channel_id);
  if (!kind) throw new Error('that channel is no longer configured');
  await closePending(pending.id, 'superseded', 'reprocess', null);
  await processMessage(client, message, kind, { force: true });
}
