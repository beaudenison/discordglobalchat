import 'dotenv/config';
import process from 'node:process';
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  WebhookClient
} from 'discord.js';
import { commandsJson } from './commands.js';
import { JsonStore } from './storage.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DATA_FILE = process.env.DATA_FILE || '/app/data/config.json';
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

if (!BOT_TOKEN || !CLIENT_ID) {
  // eslint-disable-next-line no-console
  console.error('Missing required environment variables BOT_TOKEN and/or CLIENT_ID.');
  process.exit(1);
}

const store = new JsonStore(DATA_FILE);
const relayedMessageToSource = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

function shouldLog(level) {
  const levels = ['error', 'warn', 'info', 'debug'];
  return levels.indexOf(level) <= levels.indexOf(LOG_LEVEL);
}

function log(level, message, extra = {}) {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...extra
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}

function userIsAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commandsJson });
  log('info', 'slash_commands_registered', { count: commandsJson.length });
}

async function resolveReceiveWebhook(channel, guildConfig) {
  const webhookName = 'Global Chat Relay';

  if (guildConfig.receiveWebhookId) {
    try {
      const hooks = await channel.fetchWebhooks();
      const existing = hooks.get(guildConfig.receiveWebhookId);
      if (existing) {
        return existing;
      }
    } catch (error) {
      log('warn', 'fetch_webhooks_failed', {
        guildId: channel.guild.id,
        channelId: channel.id,
        error: error.message
      });
    }
  }

  const created = await channel.createWebhook({
    name: webhookName,
    reason: 'Required for global chat relay contextual message delivery'
  });

  store.upsertGuild(channel.guild.id, {
    receiveWebhookId: created.id,
    receiveWebhookToken: created.token
  });

  return created;
}

function buildRelayMessage(sourceMessage, replyNotice = '') {
  const serverName = sourceMessage.guild?.name || 'Unknown Server';

  const messageContent = sourceMessage.content?.trim() || '';
  const lines = [`From <@${sourceMessage.author.id}> in ${serverName}: `];

  if (replyNotice) {
    lines.push(replyNotice);
  }

  if (messageContent) {
    lines.push(messageContent);
  }

  return lines.join('\n');
}

function trackRelayMessage(relayedMessageId, sourceMessage) {
  relayedMessageToSource.set(relayedMessageId, {
    sourceGuildId: sourceMessage.guild.id,
    sourceChannelId: sourceMessage.channel.id,
    sourceMessageId: sourceMessage.id,
    sourceAuthorId: sourceMessage.author.id
  });

  // Keep a bounded cache so memory use does not grow without limit.
  const maxTrackedMessages = 5000;
  while (relayedMessageToSource.size > maxTrackedMessages) {
    const oldestKey = relayedMessageToSource.keys().next().value;
    relayedMessageToSource.delete(oldestKey);
  }
}

function resolveReactionEmoji(reaction) {
  if (reaction.emoji.id && reaction.emoji.name) {
    return `${reaction.emoji.name}:${reaction.emoji.id}`;
  }

  return reaction.emoji.name || null;
}

async function relayMessage(sourceMessage) {
  const sourceGuildId = sourceMessage.guild.id;
  const guilds = store.getAllGuilds();
  const sourceConfig = guilds[sourceGuildId];

  if (!sourceConfig?.broadcastChannelId) {
    return;
  }

  if (sourceConfig.broadcastChannelId !== sourceMessage.channel.id) {
    return;
  }

  const referencedRelay = sourceMessage.reference?.messageId
    ? relayedMessageToSource.get(sourceMessage.reference.messageId)
    : null;

  for (const [targetGuildId, targetConfig] of Object.entries(guilds)) {
    if (targetGuildId === sourceGuildId) {
      continue;
    }

    if (!targetConfig.receiveChannelId) {
      continue;
    }

    try {
      const targetGuild = await client.guilds.fetch(targetGuildId);
      const targetChannel = await targetGuild.channels.fetch(targetConfig.receiveChannelId);

      if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
        continue;
      }

      const me = targetGuild.members.me;
      const perms = targetChannel.permissionsFor(me);
      if (!perms?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageWebhooks
      ])) {
        log('warn', 'missing_permissions_for_target', {
          guildId: targetGuildId,
          channelId: targetChannel.id
        });
        continue;
      }

      const webhook = await resolveReceiveWebhook(targetChannel, targetConfig);
      const webhookClient = new WebhookClient({ id: webhook.id, token: webhook.token });

      const shouldNotifyReplyTarget =
        referencedRelay &&
        targetGuildId === referencedRelay.sourceGuildId &&
        referencedRelay.sourceAuthorId;

      const replyNotice = shouldNotifyReplyTarget
        ? `<@${referencedRelay.sourceAuthorId}>, this person replied to you.`
        : '';

      const outboundContent = buildRelayMessage(sourceMessage, replyNotice);
      const files = sourceMessage.attachments.size > 0
        ? sourceMessage.attachments.map((attachment) => attachment.url)
        : undefined;

      const relayedMessage = await webhookClient.send({
        username: 'Global Chat',
        avatarURL: sourceMessage.author.displayAvatarURL({ extension: 'png', size: 128 }),
        content: outboundContent,
        files,
        flags: MessageFlags.SuppressEmbeds,
        allowedMentions: shouldNotifyReplyTarget
          ? { parse: [], users: [referencedRelay.sourceAuthorId] }
          : { parse: [] }
      });

      trackRelayMessage(relayedMessage.id, sourceMessage);

      log('info', 'message_relayed', {
        sourceGuildId,
        targetGuildId,
        sourceChannelId: sourceMessage.channel.id,
        targetChannelId: targetChannel.id,
        sourceMessageId: sourceMessage.id
      });
    } catch (error) {
      log('error', 'relay_failed', {
        sourceGuildId,
        targetGuildId,
        sourceMessageId: sourceMessage.id,
        error: error.message
      });
    }
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  log('info', 'bot_ready', {
    user: readyClient.user.tag,
    guildCount: readyClient.guilds.cache.size
  });

  try {
    await registerCommands();
  } catch (error) {
    log('error', 'slash_command_registration_failed', { error: error.message });
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (!userIsAdmin(interaction)) {
    await interaction.reply({
      content: 'This command is restricted to administrators.',
      ephemeral: true
    });
    return;
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used inside a server.',
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === 'set-broadcast-channel') {
    const channel = interaction.options.getChannel('channel', true);
    if (channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'Please select a text channel.',
        ephemeral: true
      });
      return;
    }

    store.upsertGuild(guildId, { broadcastChannelId: channel.id });

    await interaction.reply({
      content: `Broadcast channel set to <#${channel.id}>.`,
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === 'set-receive-channel') {
    const channel = interaction.options.getChannel('channel', true);
    if (channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'Please select a text channel.',
        ephemeral: true
      });
      return;
    }

    store.upsertGuild(guildId, { receiveChannelId: channel.id });

    await interaction.reply({
      content: `Receive channel set to <#${channel.id}>.`,
      ephemeral: true
    });
    return;
  }

});

client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) {
    return;
  }

  if (message.author.bot) {
    return;
  }

  try {
    await relayMessage(message);
  } catch (error) {
    log('error', 'relay_pipeline_exception', {
      guildId: message.guild.id,
      channelId: message.channel.id,
      messageId: message.id,
      error: error.message
    });
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) {
    return;
  }

  try {
    if (reaction.partial) {
      await reaction.fetch();
    }

    const sourceRef = relayedMessageToSource.get(reaction.message.id);
    if (!sourceRef) {
      return;
    }

    const sourceGuild = await client.guilds.fetch(sourceRef.sourceGuildId);
    const sourceChannel = await sourceGuild.channels.fetch(sourceRef.sourceChannelId);
    if (!sourceChannel || sourceChannel.type !== ChannelType.GuildText) {
      return;
    }

    const emoji = resolveReactionEmoji(reaction);
    if (!emoji) {
      return;
    }

    const sourceMessage = await sourceChannel.messages.fetch(sourceRef.sourceMessageId);
    await sourceMessage.react(emoji);

    log('info', 'reaction_mirrored', {
      fromGuildId: reaction.message.guildId,
      toGuildId: sourceRef.sourceGuildId,
      receiveMessageId: reaction.message.id,
      sourceMessageId: sourceRef.sourceMessageId,
      emoji
    });
  } catch (error) {
    log('error', 'reaction_mirror_failed', {
      messageId: reaction.message?.id,
      emoji: reaction.emoji?.name,
      error: error.message
    });
  }
});

client.on(Events.Error, (error) => {
  log('error', 'client_error', { error: error.message });
});

const shutdown = async (signal) => {
  log('warn', 'shutdown_signal_received', { signal });
  try {
    await client.destroy();
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});

client.login(BOT_TOKEN);
