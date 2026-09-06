import { Client, GatewayIntentBits, Partials, Events } from 'discord.js';
import { config } from './config.js';
import { log, setLogLevel } from './logger.js';
import { getCursor, setCursor, markProcessed } from './store.js';
import { processMessage, buildContext, applyResolved, reprocessPending } from './handlers.js';
import { getPending, closePending } from './queue.js';
import { learnEmojiAlias } from './resolve/teams.js';
import { notifyFailure } from './discord/confirm.js';
import { COMMANDS } from './commands/definitions.js';
import { runCommand, autocompleteChoices } from './commands/handlers.js';

setLogLevel(config.logLevel);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const byIdAscending = (a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1);

async function fetchAllSince(channel, cursor, max) {
  const collected = [];
  let after = cursor;
  while (collected.length < max) {
    const batch = await channel.messages.fetch({ limit: 100, after });
    if (batch.size === 0) break;
    const ordered = [...batch.values()].sort(byIdAscending);
    collected.push(...ordered);
    after = ordered[ordered.length - 1].id;
    if (batch.size < 100) break;
  }
  if (collected.length > max) {
    log.warn('backfill hit BACKFILL_LIMIT — oldest are handled now, the rest on next restart', {
      channelId: channel.id,
      waiting: collected.length - max,
      limit: max,
    });
  }
  return collected.slice(0, max);
}

async function fetchMostRecent(channel) {
  const batch = await channel.messages.fetch({ limit: 100 });
  return [...batch.values()].sort(byIdAscending);
}

async function backfillChannel(channelId, kind) {
  const cursor = await getCursor(channelId);
  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (e) {
    log.error('could not fetch configured channel', { channelId, error: e.message });
    return;
  }
  if (!channel || !channel.isTextBased()) {
    log.error('configured channel is not a text channel', { channelId });
    return;
  }

  let ordered;
  try {
    ordered = cursor
      ? await fetchAllSince(channel, cursor, config.backfillLimit)
      : await fetchMostRecent(channel);
  } catch (e) {
    log.error('backfill fetch failed', { channelId, error: e.message });
    return;
  }

  if (ordered.length === 0) {
    log.info('backfill: nothing new', { channelId, kind });
    return;
  }
  log.info('backfill: processing', { channelId, kind, count: ordered.length, hadCursor: !!cursor });

  for (const message of ordered) {
    if (cursor) {
      try {
        await processMessage(client, message, kind);
      } catch (e) {
        log.error('backfill message failed', { messageId: message.id, error: e.message });
      }
    } else {
      await markProcessed(message.id, kind, 'skipped', 'predates the bot');
    }
  }
  await setCursor(channelId, ordered[ordered.length - 1].id);
}

async function registerCommands(c) {
  try {
    const existing = await c.application.commands.fetch();
    const stale = [...existing.values()].filter(cmd => !COMMANDS.some(x => x.name === cmd.name));
    await c.application.commands.set(COMMANDS);
    log.info('slash commands registered globally', {
      count: COMMANDS.length,
      replaced: stale.map(cmd => cmd.name),
    });
  } catch (e) {
    log.error('global slash command registration failed', { error: e.message });
    return;
  }

  if (!config.guildId) return;
  try {
    const guild = await c.guilds.fetch(config.guildId);
    const guildCommands = await guild.commands.fetch();
    if (guildCommands.size === 0) return;
    await guild.commands.set([]);
    log.info('cleared guild-scoped commands now served globally', {
      guildId: config.guildId,
      cleared: guildCommands.size,
    });
  } catch (e) {
    log.error('could not clear guild-scoped commands', { guildId: config.guildId, error: e.message });
  }
}

client.once(Events.ClientReady, async (c) => {
  log.info('connected', { tag: c.user.tag, channels: [...config.channels.entries()] });
  await registerCommands(c);
  try {
    await buildContext();
    log.info('league data reachable');
  } catch (e) {
    log.error('league data unreachable at startup', { error: e.message });
    await notifyFailure(client, 'Bot started but cannot read the league', e.message);
  }
  for (const [channelId, kind] of config.channels.entries()) {
    await backfillChannel(channelId, kind);
  }
  log.info('ready');
});

client.on(Events.MessageCreate, async (message) => {
  const kind = config.channels.get(message.channelId);
  if (!kind) return;
  try {
    await processMessage(client, message, kind);
    await setCursor(message.channelId, message.id);
  } catch (e) {
    log.error('message handling failed', { messageId: message.id, error: e.message, stack: e.stack });
    await notifyFailure(client, 'Failed while handling a message', `${e.message}\n\n${message.content.slice(0, 500)}`);
  }
});

async function respond(interaction, text) {
  const payload = { content: text, embeds: [], components: [] };
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    try {
      const focused = interaction.options.getFocused(true);
      const choices = await autocompleteChoices(interaction.commandName, focused.name, focused.value);
      await interaction.respond(choices);
    } catch (e) {
      log.error('autocomplete failed', { error: e.message });
      try { await interaction.respond([]); } catch (ignored) { /* interaction expired */ }
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    try {
      await interaction.deferReply();
      const result = await runCommand(interaction.commandName, (name) => {
        const opt = interaction.options.get(name);
        return opt ? opt.value : null;
      });
      if (typeof result === 'string') await interaction.editReply({ content: result });
      else await interaction.editReply({ embeds: [result] });
    } catch (e) {
      log.error('slash command failed', { command: interaction.commandName, error: e.message, stack: e.stack });
      const text = 'Something went wrong looking that up — try again in a moment.';
      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content: text });
        else await interaction.reply({ content: text, ephemeral: true });
      } catch (ignored) { /* interaction expired */ }
    }
    return;
  }

  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
  if (interaction.user.id !== config.adminUserId) {
    await interaction.reply({ content: 'These buttons are not for you.', ephemeral: true });
    return;
  }

  const [action, pendingId, extra] = interaction.customId.split(':');
  const pending = await getPending(pendingId);
  if (!pending) {
    await respond(interaction, 'That review item is gone.');
    return;
  }
  if (pending.status !== 'pending') {
    await respond(interaction, `Already ${pending.status}.`);
    return;
  }

  try {
    if (action === 'no') {
      await closePending(pendingId, 'ignored', interaction.user.tag, null);
      await respond(interaction, 'Ignored — nothing was written.');
      return;
    }

    if (action === 'map') {
      const teamId = interaction.values[0];
      await interaction.deferUpdate();
      await learnEmojiAlias(extra, `unknown-${extra}`, teamId, `confirmed-by-${interaction.user.tag}`);
      log.info('emoji mapped by admin', { emojiId: extra, teamId });
      await reprocessPending(client, pending);
      await interaction.editReply({
        content: 'Mapped that emoji and re-read the message. Any follow-up is in a new message.',
        embeds: [],
        components: [],
      });
      return;
    }

    if (action === 'ok') {
      await interaction.deferUpdate();
      const item = pending.parsed && pending.parsed.item;
      if (!item) {
        await closePending(pendingId, 'failed', interaction.user.tag, 'nothing to apply');
        await interaction.editReply({ content: 'There was nothing concrete to apply.', embeds: [], components: [] });
        return;
      }
      const ctx = await buildContext();
      const result = await applyResolved({ kind: pending.kind, item, reasons: [], display: {} }, ctx, interaction.user.tag);
      if (!result.applied) {
        await closePending(pendingId, 'failed', interaction.user.tag, result.blocked);
        await interaction.editReply({ content: `Did not apply: ${result.blocked}`, embeds: [], components: [] });
        return;
      }
      await closePending(pendingId, 'applied', interaction.user.tag, null);
      await interaction.editReply({ content: `Applied — ${result.summary}`, embeds: [], components: [] });
      return;
    }

    await respond(interaction, 'Unknown action.');
  } catch (e) {
    log.error('interaction failed', { action, pendingId, error: e.message, stack: e.stack });
    await closePending(pendingId, 'failed', interaction.user.tag, e.message);
    const text = `Something broke: ${e.message}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: text, embeds: [], components: [] });
    else await interaction.reply({ content: text, ephemeral: true });
  }
});

client.on(Events.Error, (e) => log.error('client error', { error: e.message }));
process.on('unhandledRejection', (e) => log.error('unhandled rejection', { error: e instanceof Error ? e.message : String(e) }));

async function shutdown(signal) {
  log.info('shutting down', { signal });
  await client.destroy();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

client.login(config.discordToken);
