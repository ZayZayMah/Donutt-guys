const { 
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, 
  PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
  EmbedBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle 
} = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const DB_FILE = './data.json';
let db = { settings: {}, stickyRoles: {}, giveaways: {}, warnings: {}, timeouts: {}, appeals: {} };

if (fs.existsSync(DB_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) {}
}
function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ----------------------------------------------------------------------
// SLASH COMMAND REGISTRATION
// ----------------------------------------------------------------------
const commands = [
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Start a giveaway')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt => opt.setName('prize').setDescription('Prize name').setRequired(true))
    .addIntegerOption(opt => opt.setName('winners').setDescription('Number of winners').setRequired(true))
    .addStringOption(opt => opt.setName('duration').setDescription('Duration (e.g., 10s, 1h, 2d)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('settings_tickets')
    .setDescription('Configure ticket panels')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt => opt.setName('panel_name').setDescription('Name for ticket panel button').setRequired(true))
    .addChannelOption(opt => opt.setName('category').setDescription('Category to create tickets in').addChannelTypes(ChannelType.GuildCategory).setRequired(true)),

  new SlashCommandBuilder()
    .setName('settings_welcomer')
    .setDescription('Configure welcome system')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt => opt.setName('channel').setDescription('Welcome channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption(opt => opt.setName('type').setDescription('Message type').addChoices({name: 'Text', value: 'text'}, {name: 'Image Banner', value: 'image'}).setRequired(true))
    .addStringOption(opt => opt.setName('content').setDescription('Custom message (use {user} and {server})').setRequired(true)),

  new SlashCommandBuilder()
    .setName('settings_roles')
    .setDescription('Setup role-selection panel & autorole')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(opt => opt.setName('autorole').setDescription('Role given automatically on join').setRequired(false))
    .addRoleOption(opt => opt.setName('panel_role').setDescription('Role to add/remove via button panel').setRequired(false))
    .addStringOption(opt => opt.setName('button_label').setDescription('Label for the role button').setRequired(false)),

  new SlashCommandBuilder()
    .setName('settings_sticky')
    .setDescription('Set a sticky message for a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt => opt.setName('channel').setDescription('Target channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption(opt => opt.setName('message').setDescription('Message to keep at the bottom').setRequired(true)),

  new SlashCommandBuilder()
    .setName('settings_stats')
    .setDescription('Configure server stats voice channel name layout')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt => opt.setName('template').setDescription('Format eg. Members: {members} | Boosts: {boosts}').setRequired(true)),

  new SlashCommandBuilder()
    .setName('settings_moderation')
    .setDescription('Configure automod rules, logging channels, and escalation actions')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt => opt.setName('log_channel').setDescription('Channel for moderation logs').addChannelTypes(ChannelType.GuildText).setRequired(false))
    .addRoleOption(opt => opt.setName('immune_role').setDescription('Role immune to moderation automod').setRequired(false))
    .addStringOption(opt => opt.setName('automod_action').setDescription('Automod filter toggle').addChoices({name: 'Block Bad Words & Links', value: 'strict'}, {name: 'Off', value: 'off'}).setRequired(false)),

  new SlashCommandBuilder()
    .setName('channel')
    .setDescription('Lock or unlock current channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('lock').setDescription('Lock channel'))
    .addSubcommand(sub => sub.setName('unlock').setDescription('Unlock channel')),

  new SlashCommandBuilder()
    .setName('server')
    .setDescription('Pause or unpause the entire server')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('pause').setDescription('Pause server').addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true)))
    .addSubcommand(sub => sub.setName('unpause').setDescription('Unpause server')),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(opt => opt.setName('user').setDescription('User to kick').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for kick').setRequired(false)),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member with optional expiration time')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(opt => opt.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption(opt => opt.setName('duration').setDescription('Ban duration e.g. 7d (leave blank for permanent)').setRequired(false))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(false)),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
    .addStringOption(opt => opt.setName('duration').setDescription('Duration e.g. 1d, 30m').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(false)),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true)),

  new SlashCommandBuilder()
    .setName('role')
    .setDescription('Add or remove a role from a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('add').setDescription('Add role').addUserOption(o=>o.setName('user').setRequired(true)).addRoleOption(o=>o.setName('role').setRequired(true)))
    .addSubcommand(sub => sub.setName('remove').setDescription('Remove role').addUserOption(o=>o.setName('user').setRequired(true)).addRoleOption(o=>o.setName('role').setRequired(true)))
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`Donutt Guys Bot connected as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Successfully registered all commands for Donutt Guys Bot.');
  } catch (err) { console.error(err); }

  setInterval(updateServerStats, 10 * 60 * 1000);
});

async function updateServerStats() {
  for (const guildId of Object.keys(db.settings)) {
    const settings = db.settings[guildId];
    if (settings?.stats && settings.stats.channelId) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      const channel = guild.channels.cache.get(settings.stats.channelId);
      if (!channel) continue;

      let format = settings.stats.template || 'Members: {members} | Boosts: {boosts}';
      let newName = format
        .replace('{members}', guild.memberCount)
        .replace('{boosts}', guild.premiumSubscriptionCount || 0);

      await channel.setName(newName).catch(() => {});
    }
  }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.guild) return;
  if (!db.settings[interaction.guildId]) db.settings[interaction.guildId] = {};
  const guildSettings = db.settings[interaction.guildId];

  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'settings_stats') {
      const template = interaction.options.getString('template');
      let statsChan = interaction.guild.channels.cache.find(c => c.name.includes('Members:') || c.name.includes('Stats:'));
      
      if (!statsChan) {
        statsChan = await interaction.guild.channels.create({
          name: '📊 Stats Loading...',
          type: ChannelType.GuildVoice,
          permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }]
        });
      }

      guildSettings.stats = { channelId: statsChan.id, template };
      saveDb();
      await updateServerStats();
      return interaction.reply({ content: `Server stats channel set up successfully! Channel: ${statsChan}`, ephemeral: true });
    }

    if (commandName === 'settings_moderation') {
      const logChan = interaction.options.getChannel('log_channel');
      const immuneRole = interaction.options.getRole('immune_role');
      const automod = interaction.options.getString('automod_action');

      if (!guildSettings.moderation) guildSettings.moderation = {};
      if (logChan) guildSettings.moderation.logChannelId = logChan.id;
      if (immuneRole) guildSettings.moderation.immuneRoleId = immuneRole.id;
      if (automod) guildSettings.moderation.automod = automod;
      saveDb();
      return interaction.reply({ content: 'Moderation settings successfully updated!', ephemeral: true });
    }

    if (commandName === 'channel') {
      const sub = interaction.options.getSubcommand();
      const channel = interaction.channel;
      if (sub === 'lock') {
        await channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });
        return interaction.reply({ content: '🔒 Channel locked for non-administrators.', ephemeral: true });
      } else {
        await channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: null });
        return interaction.reply({ content: '🔓 Channel unlocked.', ephemeral: true });
      }
    }

    if (commandName === 'server') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'pause') {
        const reason = interaction.options.getString('reason');
        let lockChan = interaction.guild.channels.cache.find(c => c.name === '🔒server-locked🔒');
        if (!lockChan) {
          lockChan = await interaction.guild.channels.create({
            name: '🔒server-locked🔒',
            type: ChannelType.GuildText,
            permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionFlagsBits.SendMessages], allow: [PermissionFlagsBits.ViewChannel] }]
          });
        }
        await lockChan.send(`🔒 **Server Paused / Maintenance**\nReason: ${reason}`);
        for (const [id, ch] of interaction.guild.channels.cache) {
          if (ch.type === ChannelType.GuildText && ch.id !== lockChan.id) {
            await ch.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false }).catch(()=>{});
          }
        }
        return interaction.reply({ content: 'Server has been paused and locked down.', ephemeral: true });
      } else {
        for (const [id, ch] of interaction.guild.channels.cache) {
          if (ch.type === ChannelType.GuildText) {
            await ch.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: null }).catch(()=>{});
          }
        }
        return interaction.reply({ content: 'Server unpaused and permissions restored.', ephemeral: true });
      }
    }

    if (commandName === 'kick') {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const member = await interaction.guild.members.fetch(user.id).catch(()=>{});
      if (!member) return interaction.reply({ content: 'User not found in server.', ephemeral: true });

      await sendPunishmentDM(user, 'Kick', interaction.guild.name, reason, 'Never');
      await member.kick(reason);
      logModeration(interaction.guild, 'Kicked', user, interaction.user, reason);
      return interaction.reply({ content: `Successfully kicked ${user.tag}.`, ephemeral: true });
    }

    if (commandName === 'ban') {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const durationStr = interaction.options.getString('duration');
      let expireStr = 'Permanent';

      if (durationStr) {
        let ms = parseDuration(durationStr);
        expireStr = new Date(Date.now() + ms).toUTCString();
      }

      await sendPunishmentDM(user, 'Ban', interaction.guild.name, reason, expireStr);
      await interaction.guild.members.ban(user, { reason });
      logModeration(interaction.guild, 'Banned', user, interaction.user, `${reason} (Expires: ${expireStr})`);
      return interaction.reply({ content: `Successfully banned ${user.tag}.`, ephemeral: true });
    }

    if (commandName === 'timeout') {
      const user = interaction.options.getUser('user');
      const durationStr = interaction.options.getString('duration');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const member = await interaction.guild.members.fetch(user.id).catch(()=>{});
      if (!member) return interaction.reply({ content: 'Member not found.', ephemeral: true });

      let ms = parseDuration(durationStr);
      if (!ms) return interaction.reply({ content: 'Invalid duration.', ephemeral: true });

      let expireStr = new Date(Date.now() + ms).toUTCString();
      await member.timeout(ms, reason);
      await sendPunishmentDM(user, 'Timeout', interaction.guild.name, reason, expireStr);
      logModeration(interaction.guild, 'Timeout', user, interaction.user, `${reason} (Until: ${expireStr})`);
      return interaction.reply({ content: `Timed out ${user.tag} for ${durationStr}.`, ephemeral: true });
    }

    if (commandName === 'warn') {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      
      if (!db.warnings[interaction.guildId]) db.warnings[interaction.guildId] = {};
      if (!db.warnings[interaction.guildId][user.id]) db.warnings[interaction.guildId][user.id] = [];
      
      db.warnings[interaction.guildId][user.id].push(reason);
      let count = db.warnings[interaction.guildId][user.id].length;
      saveDb();

      await sendPunishmentDM(user, 'Warning', interaction.guild.name, reason, 'N/A');
      logModeration(interaction.guild, `Warning #${count}`, user, interaction.user, reason);

      const member = await interaction.guild.members.fetch(user.id).catch(()=>{});
      if (count >= 2 && member) {
        await member.timeout(24 * 60 * 60 * 1000, 'Automatic escalation: 2 warnings reached.');
        interaction.followUp({ content: `User reached 2 warnings and was automatically timed out for 1 day.`, ephemeral: true });
      }

      return interaction.reply({ content: `Warned ${user.tag} successfully (Total warnings: ${count}).`, ephemeral: true });
    }

    if (commandName === 'role') {
      const sub = interaction.options.getSubcommand();
      const user = interaction.options.getUser('user');
      const role = interaction.options.getRole('role');
      const member = await interaction.guild.members.fetch(user.id).catch(()=>{});
      if (!member) return interaction.reply({ content: 'Member not found.', ephemeral: true });

      if (sub === 'add') {
        await member.roles.add(role);
        return interaction.reply({ content: `Added role ${role.name} to ${user.tag}.`, ephemeral: true });
      } else {
        await member.roles.remove(role);
        return interaction.reply({ content: `Removed role ${role.name} from ${user.tag}.`, ephemeral: true });
      }
    }
  }

  else if (interaction.isModalSubmit() && interaction.customId === 'appeal_modal') {
    const why = interaction.fields.getTextInputValue('appeal_why');
    const desc = interaction.fields.getTextInputValue('appeal_desc');
    const guildId = interaction.user.client.guilds.cache.first().id;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return interaction.reply({ content: 'Error processing appeal.', ephemeral: true });

    let categoryId = guildSettings.tickets?.[0]?.categoryId;
    const appealChannel = await guild.channels.create({
      name: `appeal-${interaction.user.username}`,
      type: ChannelType.GuildText,
      parent: categoryId || null,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
      ]
    });

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`close_appeal_${interaction.user.id}`).setLabel('Close Appeal').setStyle(ButtonStyle.Danger)
    );

    await appealChannel.send({ 
      content: `📋 **New Moderation Appeal** from <@${interaction.user.id}>\n**Why appeal:** ${why}\n**Description:** ${desc}`,
      components: [closeRow]
    });

    db.appeals[appealChannel.id] = { userId: interaction.user.id, guildId: guild.id, status: 'Being Appealed' };
    saveDb();

    await interaction.reply({ content: 'Your appeal form has been submitted to the staff team!', ephemeral: true });
  }

  else if (interaction.isButton()) {
    if (interaction.customId === 'open_appeal_form') {
      const modal = new ModalBuilder().setCustomId('appeal_modal').setTitle('Punishment Appeal Form');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('appeal_why').setLabel('Why would you like to appeal?').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('appeal_desc').setLabel('Describe what happened').setStyle(TextInputStyle.Paragraph).setRequired(true))
      );
      return interaction.showModal(modal);
    }

    if (interaction.customId.startsWith('close_appeal_')) {
      await interaction.channel.send('Closing appeal ticket...');
      setTimeout(() => interaction.channel.delete().catch(()=>{}), 3000);
    }
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  if (!message.guild && db.appeals) {
    for (const [chanId, data] of Object.entries(db.appeals)) {
      if (data.userId === message.author.id) {
        const guild = client.guilds.cache.get(data.guildId);
        const channel = guild?.channels.cache.get(chanId);
        if (channel) {
          await channel.send(`**${message.author.username}** (Appealing) - ${message.content}`);
          await message.react('✅').catch(()=>{});
          return;
        }
      }
    }
  }

  if (!message.guild) return;

  if (db.appeals[message.channel.id]) {
    const data = db.appeals[message.channel.id];
    const user = await client.users.fetch(data.userId).catch(()=>{});
    if (user) {
      await user.send(`**Staff Response** - ${message.content}`).catch(()=>{});
      await message.react('✅').catch(()=>{});
    }
    return;
  }
});

async function sendPunishmentDM(user, type, serverName, reason, expire) {
  const embed = new EmbedBuilder()
    .setTitle(`⚠️ You received a moderation action in ${serverName}`)
    .setDescription(`**Type:** ${type}\n**Reason:** ${reason}\n**Expires:** ${expire}`)
    .setColor('Red')
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('open_appeal_form').setLabel('Appeal Punishment').setStyle(ButtonStyle.Primary)
  );

  await user.send({ embeds: [embed], components: [row] }).catch(()=>{});
}

function logModeration(guild, action, target, moderator, reason) {
  const guildSettings = db.settings[guild.id];
  if (!guildSettings?.moderation?.logChannelId) return;
  const channel = guild.channels.cache.get(guildSettings.moderation.logChannelId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle(`Moderation Log: ${action}`)
    .addFields(
      { name: 'Target', value: `${target.tag} (${target.id})`, inline: true },
      { name: 'Moderator', value: `${moderator.tag}`, inline: true },
      { name: 'Reason', value: reason }
    )
    .setColor('Orange')
    .setTimestamp();

  channel.send({ embeds: [embed] }).catch(()=>{});
}

function parseDuration(str) {
  const match = str.match(/^(\d+)([smhd])$/);
  if (!match) return null;
  const num = parseInt(match[1]);
  const unit = match[2];
  if (unit === 's') return num * 1000;
  if (unit === 'm') return num * 60 * 1000;
  if (unit === 'h') return num * 3600 * 1000;
  if (unit === 'd') return num * 86400 * 1000;
  return null;
}

client.login(process.env.DISCORD_TOKEN);