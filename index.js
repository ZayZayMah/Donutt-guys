const { 
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, 
  PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
  EmbedBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder 
} = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: ['Channel', 'Message', 'User', 'GuildMember']
});

const DB_FILE = './data.json';
let db = { settings: {}, giveaways: {}, tickets: {}, warnings: {}, sticky: {}, appeals: {} };

if (fs.existsSync(DB_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) {}
}
function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getGuildSettings(guildId) {
  if (!guildId) return {};
  if (!db.settings[guildId]) {
    db.settings[guildId] = { 
      ticketReasons: ['General Support', 'Bug Report', 'Billing Inquiry'], 
      ticketPanelTitle: 'Customer Support Tickets',
      ticketPanelDesc: 'Select an option or click below to open a private support ticket.',
      ticketFooter: 'Powered by Donutt Guys',
      ticketType: 'dropdown'
    };
    saveDb();
  }
  return db.settings[guildId];
}

const commands = [
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Enterprise Ticket system suite')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('setup').setDescription('Deploy public ticket panel').addChannelOption(o=>o.setName('channel').setDescription('Target channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub.setName('close').setDescription('Close ticket channel'))
    .addSubcommand(sub => sub.setName('delete').setDescription('Delete ticket channel')),

  new SlashCommandBuilder().setName('ban').setDescription('Ban user with universal appeal notice').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addStringOption(o=>o.setName('duration').setDescription('Duration e.g. 7d').setRequired(false)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(false)),
  new SlashCommandBuilder().setName('kick').setDescription('Kick user with appeal bridge').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(false)),
  new SlashCommandBuilder().setName('timeout').setDescription('Timeout user with appeal bridge').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addStringOption(o=>o.setName('duration').setDescription('Duration e.g. 30m').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(false)),
  new SlashCommandBuilder().setName('warn').setDescription('Warn user with appeal bridge').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Set a persistent sticky message')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o=>o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption(o=>o.setName('message').setDescription('Message text').setRequired(true))
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`Donutt Guys Bot online as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Successfully registered slash commands.');
  } catch (e) { console.error('Error registering commands:', e); }
});

async function replyWithPunishmentEmbed(interaction, actionType, targetUser, reason, duration = null) {
  const embed = new EmbedBuilder()
    .setTitle(`🔨 Punishment Issued`)
    .setColor('Red')
    .addFields(
      { name: 'Target User', value: `${targetUser} (${targetUser.tag})`, inline: true },
      { name: 'Moderator', value: `${interaction.user} (${interaction.user.tag})`, inline: true },
      { name: 'Action', value: actionType, inline: true },
      { name: 'Reason', value: reason, inline: false }
    )
    .setTimestamp();
  
  if (duration) embed.addFields({ name: 'Duration / Expiration', value: duration, inline: true });
  return interaction.reply({ embeds: [embed] });
}

async function sendPunishmentDM(user, type, guild, reason, expire) {
  const embed = new EmbedBuilder()
    .setTitle(`⚠️ Action taken against you in ${guild.name}`)
    .setDescription(`**Punishment Type:** ${type}\n**Reason:** ${reason}\n**Expiration:** ${expire}\n\nYou can appeal this punishment by clicking the button below.`)
    .setColor('Red')
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`open_appeal_form_${guild.id}`).setLabel('Appeal Punishment').setStyle(ButtonStyle.Primary)
  );

  await user.send({ embeds: [embed], components: [row] }).catch(()=>{});
}

client.on('interactionCreate', async interaction => {
  try {
    // 1. SLASH COMMANDS
    if (interaction.isChatInputCommand()) {
      const { commandName, options } = interaction;
      const sub = options.getSubcommand(false);

      if (commandName === 'ticket') {
        if (sub === 'setup') {
          const chan = options.getChannel('channel');
          const guildSettings = getGuildSettings(interaction.guildId);
          
          const embed = new EmbedBuilder()
            .setTitle(`🎫 ${guildSettings.ticketPanelTitle}`)
            .setDescription(guildSettings.ticketPanelDesc)
            .setFooter({ text: guildSettings.ticketFooter })
            .setColor('Blurple');

          const menu = new StringSelectMenuBuilder()
            .setCustomId('ticket_dropdown')
            .setPlaceholder('Choose a support category...');
          
          guildSettings.ticketReasons.forEach((r, idx) => {
            menu.addOptions({ label: r, value: `ticket_opt_${idx}` });
          });

          await chan.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
          return interaction.reply({ content: `✅ Ticket panel deployed to ${chan}`, ephemeral: true });
        }
        else if (sub === 'close' || sub === 'delete') {
          if (!interaction.guild) return;
          if (!interaction.channel.name.startsWith('ticket-') && !interaction.channel.name.startsWith('appeal-')) {
            return interaction.reply({ content: 'This can only be used inside a ticket/appeal channel.', ephemeral: true });
          }
          await interaction.reply({ content: 'Closing channel in 3 seconds...' });
          
          // Cleanup appeal registry if channel is closed
          if (db.appeals[interaction.channel.id]) {
            delete db.appeals[interaction.channel.id];
            saveDb();
          }
          setTimeout(() => interaction.channel.delete().catch(()=>{}), 3000);
        }
      }

      else if (['ban', 'kick', 'timeout', 'warn'].includes(commandName)) {
        const user = options.getUser('user');
        const reason = options.getString('reason') || 'No reason provided';
        const member = await interaction.guild.members.fetch(user.id).catch(()=>{});

        if (commandName === 'ban') {
          const durationStr = options.getString('duration');
          let expireStr = durationStr ? `Expires in ${durationStr}` : 'Permanent';
          if (!member) return interaction.reply({ content: 'User not found in server.', ephemeral: true });
          await sendPunishmentDM(user, 'Ban', interaction.guild, reason, expireStr);
          await member.ban({ reason }).catch(e => console.error(e));
          return replyWithPunishmentEmbed(interaction, 'Ban', user, reason, expireStr);
        }
        if (commandName === 'kick') {
          if (!member) return interaction.reply({ content: 'User not found in server.', ephemeral: true });
          await sendPunishmentDM(user, 'Kick', interaction.guild, reason, 'Never');
          await member.kick(reason).catch(e => console.error(e));
          return replyWithPunishmentEmbed(interaction, 'Kick', user, reason);
        }
        if (commandName === 'timeout') {
          const durationStr = options.getString('duration');
          if (!member) return interaction.reply({ content: 'User not found in server.', ephemeral: true });
          let ms = durationStr.includes('h') ? parseInt(durationStr)*3600000 : parseInt(durationStr)*60000;
          await member.timeout(ms, reason).catch(e => console.error(e));
          await sendPunishmentDM(user, 'Timeout', interaction.guild, reason, durationStr);
          return replyWithPunishmentEmbed(interaction, 'Timeout', user, reason, durationStr);
        }
        if (commandName === 'warn') {
          if (!db.warnings[interaction.guildId]) db.warnings[interaction.guildId] = {};
          if (!db.warnings[interaction.guildId][user.id]) db.warnings[interaction.guildId][user.id] = [];
          db.warnings[interaction.guildId][user.id].push(reason);
          saveDb();
          await sendPunishmentDM(user, 'Warning', interaction.guild, reason, 'Active Record');
          return replyWithPunishmentEmbed(interaction, 'Warning', user, reason);
        }
      }
    }

    // 2. MODALS (Safe DM handling)
    else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('appeal_modal_')) {
        const targetGuildId = interaction.customId.replace('appeal_modal_', '');
        const guild = await client.guilds.fetch(targetGuildId).catch(() => null);
        
        if (!guild) {
          return interaction.reply({ content: 'Unable to reach the server. Please try again.', ephemeral: true });
        }

        const why = interaction.fields.getTextInputValue('appeal_why');
        const desc = interaction.fields.getTextInputValue('appeal_desc');
        
        // Create staff channel inside server
        const appealChan = await guild.channels.create({
          name: `appeal-${interaction.user.username}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
          ]
        });

        const appealEmbed = new EmbedBuilder()
          .setTitle('📋 Universal Punishment Appeal Received')
          .setColor('Orange')
          .addFields(
            { name: 'Appealing User', value: `${interaction.user} (${interaction.user.tag})`, inline: false },
            { name: 'Why Overturn?', value: why, inline: false },
            { name: 'Full Context', value: desc, inline: false }
          )
          .setFooter({ text: 'Type any message in this channel to send it directly to the user in DM.' })
          .setTimestamp();

        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('close_appeal_btn').setLabel('Close Appeal Ticket').setStyle(ButtonStyle.Danger)
        );

        await appealChan.send({ embeds: [appealEmbed], components: [closeRow] });
        
        // Save channel mapping for DM bridge
        db.appeals[appealChan.id] = { userId: interaction.user.id, guildId: guild.id };
        saveDb();

        await interaction.user.send(`**This DM is linked to ${guild.name}**\nText this bot to speak directly with an admin.`).catch(()=>{});
        return interaction.reply({ content: 'Your appeal has been securely submitted! Check your DMs to communicate with staff.', ephemeral: true });
      }
    }

    // 3. BUTTON INTERACTION
    else if (interaction.isButton()) {
      if (interaction.customId.startsWith('open_appeal_form_')) {
        const guildId = interaction.customId.replace('open_appeal_form_', '');
        const modal = new ModalBuilder().setCustomId(`appeal_modal_${guildId}`).setTitle('Punishment Appeal Form');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('appeal_why').setLabel('Why should this be overturned?').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('appeal_desc').setLabel('Provide full context').setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'close_appeal_btn') {
        await interaction.reply({ content: 'Closing channel in 2 seconds...' });
        if (db.appeals[interaction.channel.id]) {
          delete db.appeals[interaction.channel.id];
          saveDb();
        }
        setTimeout(() => interaction.channel.delete().catch(()=>{}), 2000);
      }
    }
  } catch (err) {
    console.error('Execution Error Encountered:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'An execution error occurred.', ephemeral: true }).catch(()=>{});
    }
  }
});

// 4. BI-DIRECTIONAL MESSAGE BRIDGE (DM <-> Channel)
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // USER DM -> STAFF CHANNEL BRIDGE
  if (!message.guild) {
    for (const [chanId, data] of Object.entries(db.appeals)) {
      if (data.userId === message.author.id) {
        const guild = await client.guilds.fetch(data.guildId).catch(() => null);
        if (!guild) continue;
        const channel = await guild.channels.fetch(chanId).catch(() => null);
        if (channel) {
          await channel.send(`**${message.author.username}** (Appealing User): ${message.content}`);
          await message.react('✅').catch(()=>{});
          return;
        }
      }
    }
  }

  // STAFF CHANNEL -> USER DM BRIDGE
  if (message.guild && db.appeals[message.channel.id]) {
    const data = db.appeals[message.channel.id];
    const user = await client.users.fetch(data.userId).catch(() => null);
    if (user) {
      await user.send(`**Staff Response (${message.author.username}):** ${message.content}`).catch(()=>{});
      await message.react('✅').catch(()=>{});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);