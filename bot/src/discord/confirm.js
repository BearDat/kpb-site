import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { attachDmMessage } from '../queue.js';

const COLOR_REVIEW = 0xf5c64b;
const COLOR_OK = 0x4ade80;
const COLOR_FAIL = 0xfb7166;

const KIND_LABELS = {
  final_score: 'Final score',
  game_time: 'Game time',
  trade: 'Trade',
  sign: 'Signing',
  release: 'Release',
  suspend: 'Suspension',
  unsuspend: 'Suspension lifted',
  ban: 'Ban',
  unban: 'Ban lifted',
  awards: 'Season awards',
  unparsed: 'Unrecognized line',
};

function truncate(text, max) {
  const s = String(text == null ? '' : text);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function buildReviewEmbed(resolved, context) {
  const embed = new EmbedBuilder()
    .setColor(COLOR_REVIEW)
    .setTitle(`${KIND_LABELS[resolved.kind] || resolved.kind} needs a check`)
    .setDescription(truncate(resolved.display.line || context.rawText, 3000));

  const details = [];
  const d = resolved.display;
  if (d.game) details.push(`**Game** ${d.game}`);
  if (d.result) details.push(`**Result** ${d.result}`);
  if (d.left) details.push(`**Left** ${d.left}`);
  if (d.right) details.push(`**Right** ${d.right}`);
  if (d.sides) d.sides.forEach(s => details.push(`**Side** ${s}`));
  if (d.team) details.push(`**Team** ${d.team}`);
  if (d.player) details.push(`**Player** ${d.player}`);
  if (d.reason) details.push(`**Reason** ${d.reason}`);
  if (d.when) details.push(`**Time** ${d.when}`);
  if (d.season) details.push(`**Season** ${d.season}`);
  if (d.awards) d.awards.forEach(a => details.push(a));
  if (details.length > 0) embed.addFields({ name: 'Parsed as', value: truncate(details.join('\n'), 1024) });

  embed.addFields({
    name: 'Why I stopped',
    value: truncate(resolved.reasons.map(r => `• ${r}`).join('\n') || '• unspecified', 1024),
  });
  embed.addFields({
    name: 'Source',
    value: `[jump to message](https://discord.com/channels/${context.guildId || '@me'}/${context.channelId}/${context.messageId})`,
  });
  return embed;
}

export function buildReviewComponents(pendingId, resolved) {
  const rows = [];
  const unresolved = resolved.item && resolved.item.unresolvedEmoji ? resolved.item.unresolvedEmoji : [];

  unresolved.slice(0, 3).forEach(entry => {
    const options = (entry.candidates || []).slice(0, 25).map(team => ({
      label: truncate(team.name, 100),
      value: team.teamId,
    }));
    if (options.length === 0) return;
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`map:${pendingId}:${entry.emojiId}`)
        .setPlaceholder(truncate(`Which team is :${entry.emojiName}:?`, 150))
        .addOptions(options),
    ));
  });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ok:${pendingId}`).setLabel('Apply anyway').setStyle(ButtonStyle.Success).setDisabled(!resolved.item || !!unresolved.length),
    new ButtonBuilder().setCustomId(`no:${pendingId}`).setLabel('Ignore').setStyle(ButtonStyle.Secondary),
  );
  rows.push(buttons);
  return rows.slice(0, 5);
}

export async function sendReviewDm(client, pendingId, resolved, context) {
  try {
    const user = await client.users.fetch(config.adminUserId);
    const dm = await user.send({
      embeds: [buildReviewEmbed(resolved, context)],
      components: buildReviewComponents(pendingId, resolved),
    });
    await attachDmMessage(pendingId, dm.id);
    return dm;
  } catch (e) {
    log.error('could not DM the admin', { pendingId, error: e.message });
    return null;
  }
}

export async function notifyApplied(client, summary, context, actor) {
  if (!context.announce) return;
  try {
    const user = await client.users.fetch(config.adminUserId);
    const embed = new EmbedBuilder().setColor(COLOR_OK).setTitle('Applied').setDescription(truncate(summary, 3000));
    if (actor) embed.addFields({ name: 'By', value: truncate(actor, 256) });
    await user.send({ embeds: [embed] });
  } catch (e) {
    log.debug('applied notice not delivered', { error: e.message });
  }
}

export async function notifyFailure(client, title, detail) {
  try {
    const user = await client.users.fetch(config.adminUserId);
    await user.send({
      embeds: [new EmbedBuilder().setColor(COLOR_FAIL).setTitle(title).setDescription(truncate(detail, 3000))],
    });
  } catch (e) {
    log.error('failure notice not delivered', { error: e.message });
  }
}

export { COLOR_OK, COLOR_FAIL, COLOR_REVIEW, truncate };
