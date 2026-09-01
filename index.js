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
    .setName('giveaway')
    .setDescription('Advanced Giveaway management suite')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('start').setDescription('Start giveaway').addStringOption(o=>o.setName('prize').setDescription('Prize').setRequired(true)).addIntegerOption(o=>o.setName('winners').setDescription('Winners').setRequired(true)).addStringOption(o=>o.setName('duration').setDescription('Duration e.g. 1h').setRequired(true)))
    .addSubcommand(sub => sub.setName('end').setDescription('End giveaway').addStringOption(o=>o.setName('message_id').setDescription('ID').setRequired(true)))
    .addSubcommand(sub => sub.setName('delete').setDescription('Delete giveaway record').addStringOption(o=>o.setName('message_id').setDescription('ID').setRequired(true))),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Enterprise Ticket system suite')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('setup').setDescription('Open private ticket configuration dashboard and deploy panel').addChannelOption(o=>o.setName('channel').setDescription('Target channel to deploy public panel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub.setName('close').setDescription('Close ticket channel'))
    .addSubcommand(sub => sub.setName('delete').setDescription('Delete ticket channel')),

  new SlashCommandBuilder().setName('ban').setDescription('Ban user with universal appeal notice').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addStringOption(o=>o.setName('duration').setDescription('Duration e.g. 7d').setRequired(false)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(false)),
  new SlashCommandBuilder().setName('kick').setDescription('Kick user with appeal bridge').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(false)),
  new SlashCommandBuilder().setName('timeout').setDescription('Timeout user with appeal bridge').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addStringOption(o=>o.setName('duration').setDescription('Duration e.g. 30m').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(false)),
  new SlashCommandBuilder().setName('warn').setDescription('Warn user with auto-escalation and appeal bridge').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Set a persistent sticky message at the bottom of a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o=>o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption(o=>o.setName('message').setDescription('Multiline message text').setRequired(true))
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`Donutt Guys Bot online as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Successfully registered commands.');
  } catch (e) { console.error(e); }
});

function buildTicketPanel(settings) {
  const embed = new EmbedBuilder()
    .setTitle(`🎫 ${settings.ticketPanelTitle}`)
    .setDescription(settings.ticketPanelDesc)
    .setFooter({ text: settings.ticketFooter })
    .setColor('Blurple');

  if (settings.ticketType === 'dropdown') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('ticket_dropdown')
      .setPlaceholder('Choose a support category...');
    settings.ticketReasons.forEach((r, idx) => {
      menu.addOptions({ label: r, value: `ticket_opt_${idx}` });
    });
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
  } else {
    const row = new ActionRowBuilder();
    settings.ticketReasons.slice(0, 5).forEach((r, idx) => {
      row.addComponents(new ButtonBuilder().setCustomId(`ticket_btn_${idx}`).setLabel(r).setStyle(ButtonStyle.Primary));
    });
    return { embeds: [embed], components: [row] };
  }
}

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
  
  if (duration) {
    embed.addFields({ name: 'Duration / Expiration', value: duration, inline: true });
  }

  return interaction.reply({ embeds: [embed] });
}

async function sendPunishmentDM(user, type, guild, reason, expire) {
  const embed = new EmbedBuilder()
    .setTitle(`⚠️ Action taken against you in ${guild.name}`)
    .setDescription(`**Punishment Type:** ${type}\n**Reason:** ${reason}\n**Expiration:** ${expire}\n\nYou can appeal this punishment securely via the button below.`)
    .setColor('Red')
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`open_appeal_form_${guild.id}`).setLabel('Appeal Punishment').setStyle(ButtonStyle.Primary)
  );

  await user.send({ embeds: [embed], components: [row] }).catch(()=>{});
}

async function createSupportTicket(interaction, formReason) {
  const ticketChan = await interaction.guild.channels.create({
    name: `ticket-${interaction.user.username}`,
    type: ChannelType.GuildText,
    permissionOverwrites: [
      { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
    ]
  });

  const embed = new EmbedBuilder()
    .setTitle('🎫 Support Ticket Opened')
    .setColor('Green')
    .addFields(
      { name: 'Requested By', value: `${interaction.user} (${interaction.user.tag})`, inline: false },
      { name: 'Category / Reason', value: formReason, inline: false },
      { name: 'Claimed By', value: 'Unclaimed', inline: false }
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim Ticket').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('close_ticket_btn').setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
  );

  await ticketChan.send({ content: `Welcome ${interaction.user}! Staff will assist you shortly.`, embeds: [embed], components: [row] });
  return interaction.reply({ content: `Your support ticket has been opened: ${ticketChan}`, ephemeral: true });
}

client.on('interactionCreate', async interaction => {
  const guildSettings = interaction.guild ? getGuildSettings(interaction.guildId) : null;

  try {
    if (interaction.isChatInputCommand()) {
      const { commandName, options } = interaction;
      const sub = options.getSubcommand(false);

      if (commandName === 'ticket') {
        if (sub === 'setup') {
          const chan = options.getChannel('channel');
          db.tickets[interaction.user.id] = { targetChannelId: chan.id };
          saveDb();

          const embed = new EmbedBuilder()
            .setTitle('⚙️ Ticket Panel Setup Dashboard')
            .setDescription(`Configuring panel for target channel: ${chan}\n\nUse the buttons below to customize your ticket panel properties or add/remove options. Once you are done, click **Deploy Panel**!`)
            .setColor('DarkButNotBlack');

          const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cfg_t_title').setLabel('Edit Title').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cfg_t_desc').setLabel('Edit Description').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cfg_t_footer').setLabel('Edit Footer').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cfg_t_type').setLabel('Toggle Style (Menu/Buttons)').setStyle(ButtonStyle.Primary)
          );

          const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cfg_t_add_opt').setLabel('Add Option').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('cfg_t_reset_opt').setLabel('Reset Options').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('cfg_t_deploy').setLabel('🚀 Deploy Panel').setStyle(ButtonStyle.Success)
          );

          return interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
        }
        else if (sub === 'close' || sub === 'delete') {
          if (!interaction.guild) return;
          if (!interaction.channel.name.startsWith('ticket-') && !interaction.channel.name.startsWith('appeal-')) {
            return interaction.reply({ content: 'Not a valid ticket channel.', ephemeral: true });
          }
          await interaction.reply({ content: 'Closing channel in 3 seconds...' });
          setTimeout(() => interaction.channel.delete().catch(()=>{}), 3000);
        }
      }

      else if (commandName === 'ban' || commandName === 'kick' || commandName === 'timeout' || commandName === 'warn') {
        const user = options.getUser('user');
        const reason = options.getString('reason') || 'No reason provided';
        const member = await interaction.guild.members.fetch(user.id).catch(()=>{});

        if (commandName === 'ban') {
          const durationStr = options.getString('duration');
          let expireStr = durationStr ? `Expires in ${durationStr}` : 'Permanent';
          if (!member) return interaction.reply({ content: 'User not found in server.', ephemeral: true });
          try { await sendPunishmentDM(user, 'Ban', interaction.guild, reason, expireStr); } catch(e){}
          try { await member.ban({ reason }); } catch(err) {
            return interaction.reply({ content: `❌ Failed to ban user (Missing permissions).`, ephemeral: true });
          }
          return replyWithPunishmentEmbed(interaction, 'Ban', user, reason, expireStr);
        }
        if (commandName === 'kick') {
          if (!member) return interaction.reply({ content: 'User not found in server.', ephemeral: true });
          try { await sendPunishmentDM(user, 'Kick', interaction.guild, reason, 'Never'); } catch(e){}
          try { await member.kick(reason); } catch(err) {
            return interaction.reply({ content: `❌ Failed to kick user.`, ephemeral: true });
          }
          return replyWithPunishmentEmbed(interaction, 'Kick', user, reason);
        }
        if (commandName === 'timeout') {
          const durationStr = options.getString('duration');
          if (!member) return interaction.reply({ content: 'User not found in server.', ephemeral: true });
          let ms = durationStr.includes('h') ? parseInt(durationStr)*3600000 : parseInt(durationStr)*60000;
          let expireStr = new Date(Date.now() + ms).toUTCString();
          try { await member.timeout(ms, reason); } catch(err) {
            return interaction.reply({ content: `❌ Failed to timeout user.`, ephemeral: true });
          }
          try { await sendPunishmentDM(user, 'Timeout', interaction.guild, reason, expireStr); } catch(e){}
          return replyWithPunishmentEmbed(interaction, 'Timeout', user, reason, durationStr);
        }
        if (commandName === 'warn') {
          if (!db.warnings[interaction.guildId]) db.warnings[interaction.guildId] = {};
          if (!db.warnings[interaction.guildId][user.id]) db.warnings[interaction.guildId][user.id] = [];
          db.warnings[interaction.guildId][user.id].push(reason);
          let count = db.warnings[interaction.guildId][user.id].length;
          saveDb();
          try { await sendPunishmentDM(user, `Warning #${count}`, interaction.guild, reason, 'Active Record'); } catch(e){}
          return replyWithPunishmentEmbed(interaction, `Warning (#${count})`, user, reason);
        }
      }
    }

    // --- MODAL SUBMISSIONS ---
    else if (interaction.isModalSubmit()) {
      if (interaction.customId === 'modal_t_title') {
        guildSettings.ticketPanelTitle = interaction.fields.getTextInputValue('val');
        saveDb();
        return interaction.reply({ content: '✅ Ticket title updated!', ephemeral: true });
      }
      if (interaction.customId === 'modal_t_desc') {
        guildSettings.ticketPanelDesc = interaction.fields.getTextInputValue('val');
        saveDb();
        return interaction.reply({ content: '✅ Ticket description updated!', ephemeral: true });
      }
      if (interaction.customId === 'modal_t_footer') {
        guildSettings.ticketFooter = interaction.fields.getTextInputValue('val');
        saveDb();
        return interaction.reply({ content: '✅ Ticket footer updated!', ephemeral: true });
      }
      if (interaction.customId === 'modal_t_add_opt') {
        const newOpt = interaction.fields.getTextInputValue('val');
        guildSettings.ticketReasons.push(newOpt);
        saveDb();
        return interaction.reply({ content: `✅ Added option: "**${newOpt}**"`, ephemeral: true });
      }
      if (interaction.customId.startsWith('appeal_modal_')) {
        const targetGuildId = interaction.customId.replace('appeal_modal_', '');
        const guild = client.guilds.cache.get(targetGuildId) || await client.guilds.fetch(targetGuildId).catch(() => null);
        
        if (!guild) return interaction.reply({ content: 'Error submitting appeal: Shared server context not found.', ephemeral: true });

        const why = interaction.fields.getTextInputValue('appeal_why');
        const desc = interaction.fields.getTextInputValue('appeal_desc');
        
        // Staff channel creation: Punished user cannot view
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
          .setTimestamp();

        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('close_appeal_btn').setLabel('Close Appeal Ticket').setStyle(ButtonStyle.Danger)
        );

        await appealChan.send({ embeds: [appealEmbed], components: [closeRow] });
        db.appeals[appealChan.id] = { userId: interaction.user.id, guildId: guild.id };
        saveDb();

        await interaction.user.send(`**This DM is linked to ${guild.name}**\nText this bot to speak to an admin`).catch(()=>{});
        return interaction.reply({ content: 'Your appeal has been securely submitted! Check your DMs to communicate with staff.', ephemeral: true });
      }
    }

    // --- SELECT MENUS ---
    else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'ticket_dropdown') {
        const indexVal = parseInt(interaction.values[0].replace('ticket_opt_', ''));
        const reasonText = guildSettings.ticketReasons[indexVal] || 'General Support';
        await createSupportTicket(interaction, reasonText);
      }
    }

    // --- BUTTONS ---
    else if (interaction.isButton()) {
      if (interaction.customId === 'cfg_t_title') {
        const modal = new ModalBuilder().setCustomId('modal_t_title').setTitle('Edit Panel Title');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('val').setLabel('New Title').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }
      if (interaction.customId === 'cfg_t_desc') {
        const modal = new ModalBuilder().setCustomId('modal_t_desc').setTitle('Edit Panel Description');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('val').setLabel('New Description').setStyle(TextInputStyle.Paragraph).setRequired(true)));
        return interaction.showModal(modal);
      }
      if (interaction.customId === 'cfg_t_footer') {
        const modal = new ModalBuilder().setCustomId('modal_t_footer').setTitle('Edit Panel Footer');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('val').setLabel('New Footer Text').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }
      if (interaction.customId === 'cfg_t_type') {
        guildSettings.ticketType = guildSettings.ticketType === 'dropdown' ? 'buttons' : 'dropdown';
        saveDb();
        return interaction.reply({ content: `🔄 Switched ticket panel interaction style to: **${guildSettings.ticketType}**`, ephemeral: true });
      }
      if (interaction.customId === 'cfg_t_add_opt') {
        const modal = new ModalBuilder().setCustomId('modal_t_add_opt').setTitle('Add Ticket Option');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('val').setLabel('Option Name (e.g. Bug Report)').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }
      if (interaction.customId === 'cfg_t_reset_opt') {
        guildSettings.ticketReasons = ['General Support', 'Bug Report', 'Billing Inquiry'];
        saveDb();
        return interaction.reply({ content: '🔄 Reset ticket options back to defaults.', ephemeral: true });
      }
      if (interaction.customId === 'cfg_t_deploy') {
        const setupData = db.tickets[interaction.user.id];
        if (!setupData) return interaction.reply({ content: 'Session expired. Run `/ticket setup` again.', ephemeral: true });
        const targetChan = interaction.guild.channels.cache.get(setupData.targetChannelId);
        if (!targetChan) return interaction.reply({ content: 'Target channel could not be found.', ephemeral: true });

        const panelPayload = buildTicketPanel(guildSettings);
        await targetChan.send(panelPayload);
        return interaction.reply({ content: `🚀 Successfully deployed ticket panel into ${targetChan}!`, ephemeral: true });
      }

      if (interaction.customId.startsWith('ticket_btn_')) {
        const indexVal = parseInt(interaction.customId.replace('ticket_btn_', ''));
        const reasonText = guildSettings.ticketReasons[indexVal] || 'General Support';
        await createSupportTicket(interaction, reasonText);
      }

      if (interaction.customId === 'claim_ticket') {
        const message = interaction.message;
        const embed = EmbedBuilder.from(message.embeds[0]);
        embed.spliceFields(2, 1, { name: 'Claimed By', value: `${interaction.user} (${interaction.user.tag})`, inline: false });
        
        const claimedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('claimed_btn').setLabel(`Claimed by ${interaction.user.username}`).setStyle(ButtonStyle.Success).setDisabled(true),
          new ButtonBuilder().setCustomId('close_ticket_btn').setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
        );

        await interaction.update({ embeds: [embed], components: [claimedRow] });
        await interaction.followUp({ content: `✅ Ticket claimed by ${interaction.user}.`, ephemeral: true });
        return;
      }

      if (interaction.customId.startsWith('open_appeal_form_')) {
        const guildId = interaction.customId.replace('open_appeal_form_', '');
        const modal = new ModalBuilder().setCustomId(`appeal_modal_${guildId}`).setTitle('Punishment Appeal Form');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('appeal_why').setLabel('Why should this be overturned?').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('appeal_desc').setLabel('Provide full context').setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'close_ticket_btn' || interaction.customId === 'close_appeal_btn') {
        if (!interaction.guild) return;
        await interaction.reply({ content: 'Closing channel in 2 seconds...' });
        setTimeout(() => interaction.channel.delete().catch(()=>{}), 2000);
      }
    }
  } catch (err) {
    console.error('Interaction Execution Error:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'An execution error occurred.', ephemeral: true }).catch(()=>{});
    }
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // Sticky Message Handling
  if (message.guild && db.sticky[message.guildId]?.[message.channel.id]) {
    setTimeout(async () => {
      try {
        const stickyText = db.sticky[message.guildId][message.channel.id];
        const fetched = await message.channel.messages.fetch({ limit: 5 });
        const lastSticky = fetched.find(m => m.author.id === client.user.id && m.content.includes(stickyText));
        if (lastSticky) await lastSticky.delete().catch(()=>{});
        await message.channel.send(`📌 **Sticky Message:**\n${stickyText}`);
      } catch (e) {}
    }, 1500);
  }

  // User DM -> Staff Ticket Channel Bridge
  if (!message.guild && db.appeals) {
    for (const [chanId, data] of Object.entries(db.appeals)) {
      if (data.userId === message.author.id) {
        const guild = client.guilds.cache.get(data.guildId);
        const channel = guild?.channels.cache.get(chanId);
        if (channel) {
          await channel.send(`**${message.author.username}** (Appealing User): ${message.content}`);
          await message.react('✅').catch(()=>{});
          return;
        }
      }
    }
  }

  // Staff Ticket Channel -> User DM Bridge
  if (message.guild && db.appeals[message.channel.id]) {
    const data = db.appeals[message.channel.id];
    const user = await client.users.fetch(data.userId).catch(()=>{});
    if (user) {
      await user.send(`**Staff Response (${message.author.username}):** ${message.content}`).catch(()=>{});
      await message.react('✅').catch(()=>{});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);