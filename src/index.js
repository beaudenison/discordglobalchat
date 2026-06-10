import 'dotenv/config';
import process from 'node:process';
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
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
const DEFAULT_SERVER_INVITE_URL = process.env.DEFAULT_SERVER_INVITE_URL || '';
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

if (!BOT_TOKEN || !CLIENT_ID) {
  // eslint-disable-next-line no-console
  console.error('Missing required environment variables BOT_TOKEN and/or CLIENT_ID.');
  process.exit(1);
}

const store = new JsonStore(DATA_FILE);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
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

function validInviteUrl(url) {
  try {
    const parsed = new URL(url);
    const hostOk = parsed.hostname === 'discord.gg' || parsed.hostname.endsWith('discord.com');
    return parsed.protocol === 'https:' && hostOk;
  } catch {
    return false;
  }
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

function buildRelayMessage(sourceMessage, sourceGuildConfig) {
  const fallbackInvite = sourceGuildConfig.serverInviteUrl || DEFAULT_SERVER_INVITE_URL || null;
  const serverName = sourceMessage.guild?.name || 'Unknown Server';

  const serverLabel = fallbackInvite
    ? `[${serverName}](${fallbackInvite})`
    : serverName;

  const messageContent = sourceMessage.content?.trim() || '[No text content]';
  return `From <@${sourceMessage.author.id}> in ${serverLabel}\n${messageContent}`;
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

  const outboundContent = buildRelayMessage(sourceMessage, sourceConfig);

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

      await webhookClient.send({
        username: `${sourceMessage.author.username} [${sourceMessage.guild.name}]`,
        avatarURL: sourceMessage.author.displayAvatarURL({ extension: 'png', size: 128 }),
        content: outboundContent,
        flags: MessageFlags.SuppressEmbeds,
        allowedMentions: { parse: [] }
      });

      if (sourceMessage.attachments.size > 0) {
        const files = sourceMessage.attachments.map((attachment) => attachment.url);
        await webhookClient.send({
          files,
          allowedMentions: { parse: [] }
        });
      }

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

  if (interaction.commandName === 'set-server-invite') {
    const url = interaction.options.getString('url', true).trim();
    if (!validInviteUrl(url)) {
      await interaction.reply({
        content: 'Please provide a valid https Discord invite URL.',
        ephemeral: true
      });
      return;
    }

    store.upsertGuild(guildId, { serverInviteUrl: url });

    await interaction.reply({
      content: 'Server invite URL saved and will be used in relayed message attribution.',
      ephemeral: true
    });
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
