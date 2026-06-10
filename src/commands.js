import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const commandBuilders = [
  new SlashCommandBuilder()
    .setName('set-broadcast-channel')
    .setDescription('Set the channel where local messages are broadcast to the global network')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('The outbound broadcast channel')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('set-receive-channel')
    .setDescription('Set the channel where inbound global messages are received')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('The inbound receive channel')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('set-server-invite')
    .setDescription('Set a permanent invite URL used for server attribution in relayed messages')
    .addStringOption((option) =>
      option
        .setName('url')
        .setDescription('Permanent invite URL (e.g. https://discord.gg/yourcode)')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

export const commandsJson = commandBuilders.map((builder) => builder.toJSON());
