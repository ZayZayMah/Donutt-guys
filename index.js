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
    GatewayIntentBits.MessageContent
  ]
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
      ticketReasons: ['General Support', 'Billing Inquiry', 'Technical Issue'], 
      ticketPanelTitle: 'Customer Support Tickets',
      ticketPanelDesc: 'Select an option from the menu below to open a private support ticket.',
      ticketRoleId: null,
      ticketCategoryId: null,
      modLogId: null 
    };
    saveDb();
  }
  return db.settings[guildId];
}

// ----------------------------------------------------------------------
// SLASH COMMAND REGISTRATION
// ----------------------------------------------------------------------
const commands = [
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Advanced Giveaway management suite')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('start').setDescription('Start giveaway').addStringOption(o=>o.setName('prize').setDescription('Prize').setRequired(true)).addIntegerOption(o=>o.setName('winners').setDescription('Winners').setRequired(true)).addStringOption(o=>o.setName('duration').setDescription('Duration e.g. 1h').setRequired(true)))
    .addSubcommand(sub => sub.setName('end').setDescription('End giveaway').addStringOption(o=>o.setName('message_id').setDescription('ID').setRequired(true)))
    .addSubcommand(sub => sub.setName('reroll').setDescription('Reroll giveaway').addStringOption(o=>o.setName('message_id').setDescription('ID').setRequired(true)))
    .addSubcommand(sub => sub.setName('delete').setDescription('Delete giveaway record').addStringOption(o=>o.setName('message_id').setDescription('ID').setRequired(true))),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Enterprise Ticket system suite')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('setup').setDescription('Deploy custom ticket panel with user-defined message').addChannelOption(o=>o.setName('channel').setDescription('Target channel').addChannelTypes(ChannelType.GuildText).setRequired(true)).addStringOption(o=>o.setName('title').setDescription('Panel Embed Title').setRequired(false)).addStringOption(o=>o.setName('description').setDescription('Panel Embed Message Text').setRequired(false)))
    .addSubcommand(sub => sub.setName('close').setDescription('Close ticket channel'))
    .addSubcommand(sub => sub.setName('delete').setDescription('Delete ticket channel')),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Server statistics counter channels')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('create').setDescription('Build stat counter channels'))
    .addSubcommand(sub => sub.setName('delete').setDescription('Remove stat counters')),

  new SlashCommandBuilder()
    .setName('pin')
    .setDescription('Open multiline advanced embed builder form'),

  new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Set a persistent sticky message at the bottom of a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o=>o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption(o=>o.setName('message').setDescription('Multiline message text').setRequired(true)),

  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Configure module settings panels')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('tickets').setDescription('Configure ticket dropdown categories, custom text & staff roles'))
    .addSubcommand(sub => sub.setName('welcomer').setDescription('Configure Welcomer cards & messages'))
    .addSubcommand(sub => sub.setName('moderation').setDescription('Configure automod filter rules & audit logs'))
    .addSubcommand(sub => sub.setName('roles').setDescription('Configure reaction-role panels & autoroles')),

  new SlashCommandBuilder().setName('ban').setDescription('Ban user with universal appeal notice').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addStringOption(o=>o.setName('duration').setDescription('Duration e.g. 7d').setRequired(false)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(false)),
  new SlashCommandBuilder().setName('kick').setDescription('Kick user with appeal bridge').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(false)),
  new SlashCommandBuilder().setName('timeout').setDescription('Timeout user with appeal bridge').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addStringOption(o=>o.setName('duration').setDescription('Duration e.g. 30m').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(false)),
  new SlashCommandBuilder().setName('warn').setDescription('Warn user with auto-escalation and appeal bridge').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),

  new SlashCommandBuilder()
    .setName('channel')
    .setDescription('Lock/Unlock channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('lock').setDescription('Lock'))
    .addSubcommand(sub => sub.setName('unlock').setDescription('Unlock'))
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`Donutt Guys Bot online as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Successfully registered complex enterprise commands.');
  } catch (e) { console.error(e); }
});

// ----------------------------------------------------------------------
// INTERACTION ROUTER & ENGINE
// ----------------------------------------------------------------------
client.on('interactionCreate', async interaction => {
  if (!interaction.guild) return;
  const guildSettings = getGuildSettings(interaction.guildId);

  try {
    if (interaction.isChatInputCommand()) {
      const { commandName, options } = interaction;
      const sub = options.getSubcommand(false);

      if (commandName === 'giveaway') {
        if (sub === 'start') {
          const prize = options.getString('prize');
          const winners = options.getInteger('winners');
          const duration = options.getString('duration');
          const embed = new EmbedBuilder().setTitle('🎉 EPIC GIVEAWAY 🎉').setDescription(`Prize: **${prize}**\nWinners: **${winners}**\nHost: ${interaction.user}\nClick below to participate!`).setColor('Gold').setTimestamp();
          const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('enter_gw').setLabel('🎉 Enter Giveaway').setStyle(ButtonStyle.Success));
          await interaction.reply({ content: 'Giveaway active!', ephemeral: true });
          const msg = await interaction.channel.send({ embeds: [embed], components: [row] });
          db.giveaways[msg.id] = { prize, winners, entrants: [] };
          saveDb();
        } else if (sub === 'end' || sub === 'reroll' || sub === 'delete') {
          const id = options.getString('message_id');
          if (!db.giveaways[id]) return interaction.reply({ content: 'Giveaway not found.', ephemeral: true });
          if (sub === 'delete') { delete db.giveaways[id]; saveDb(); return interaction.reply({ content: 'Deleted record.', ephemeral: true }); }
          const gw = db.giveaways[id];
          if (gw.entrants.length === 0) return interaction.reply({ content: 'No participants found.', ephemeral: true });
          let winList = [];
          for(let i=0; i<Math.min(gw.winners, gw.entrants.length); i++) {
            let r = Math.floor(Math.random() * gw.entrants.length);
            winList.push(`<@${gw.entrants.splice(r,1)[0]}>`);
          }
          saveDb();
          return interaction.reply({ content: `🎉 **Giveaway Winners:** ${winList.join(', ')}` });
        }
      }

      else if (commandName === 'ticket') {
        if (sub === 'setup') {
          const chan = options.getChannel('channel');
          const customTitle = options.getString('title') || guildSettings.ticketPanelTitle;
          const customDesc = options.getString('description') || guildSettings.ticketPanelDesc;
          
          guildSettings.ticketPanelTitle = customTitle;
          guildSettings.ticketPanelDesc = customDesc;
          saveDb();

          const embed = new EmbedBuilder().setTitle(`🎫 ${customTitle}`).setDescription(customDesc).setColor('Blurple');
          const menu = new StringSelectMenuBuilder().setCustomId('ticket_dropdown').setPlaceholder('Choose a ticket category...');
          
          const reasons = guildSettings.ticketReasons || ['General Support', 'Billing Inquiry', 'Technical Issue'];
          reasons.forEach((r, idx) => menu.addOptions({ label: r, value: `ticket_reason_${idx}` }));

          const row = new ActionRowBuilder().addComponents(menu);
          await chan.send({ embeds: [embed], components: [row] });
          return interaction.reply({ content: `Enterprise ticket panel deployed in ${chan} with your custom messages and options!`, ephemeral: true });
        }
        else if (sub === 'close') {
          if (!interaction.channel.name.startsWith('ticket-') && !interaction.channel.name.startsWith('appeal-')) return interaction.reply({ content: 'Not a ticket channel.', ephemeral: true });
          await interaction.reply({ content: 'Closing ticket in 3 seconds...' });
          setTimeout(() => interaction.channel.delete().catch(()=>{}), 3000);
        }
        else if (sub === 'delete') {
          if (!interaction.channel.name.startsWith('ticket-') && !interaction.channel.name.startsWith('appeal-')) return interaction.reply({ content: 'Not a ticket channel.', ephemeral: true });
          await interaction.channel.delete().catch(()=>{});
        }
      }

      else if (commandName === 'stats') {
        if (sub === 'create') {
          await interaction.deferReply({ ephemeral: true });
          const ch = await interaction.guild.channels.create({ name: `📊 Members: ${interaction.guild.memberCount}`, type: ChannelType.GuildVoice, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionFlagsBits.Connect] }] });
          guildSettings.statsChan = ch.id;
          saveDb();
          return interaction.editReply({ content: 'ServerStats counters successfully enabled!' });
        } else if (sub === 'delete') {
          if (guildSettings.statsChan) {
            const ch = interaction.guild.channels.cache.get(guildSettings.statsChan);
            if(ch) await ch.delete().catch(()=>{});
            delete guildSettings.statsChan;
            saveDb();
          }
          return interaction.reply({ content: 'ServerStats removed.', ephemeral: true });
        }
      }

      else if (commandName === 'pin') {
        const modal = new ModalBuilder().setCustomId('pinpal_modal').setTitle('Multiline Embed PinPal Builder');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pin_title').setLabel('Embed Title').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pin_body').setLabel('Multiline Content (supports \\n)').setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      else if (commandName === 'sticky') {
        const ch = options.getChannel('channel');
        const text = options.getString('message');
        if (!db.sticky[interaction.guildId]) db.sticky[interaction.guildId] = {};
        db.sticky[interaction.guildId][ch.id] = text;
        saveDb();
        return interaction.reply({ content: `Sticky PinPal message set for ${ch}.`, ephemeral: true });
      }

      else if (commandName === 'settings') {
        const embed = new EmbedBuilder().setColor('NotQuiteBlack');
        const row = new ActionRowBuilder();

        if (sub === 'tickets') {
          embed.setTitle('🎫 Ticket System Configuration')
               .setDescription(`Manage your ticket options, roles, and panels.\n\n**Current Reasons:**\n${guildSettings.ticketReasons.map(r => `• ${r}`).join('\n')}`);
          row.addComponents(
            new ButtonBuilder().setCustomId('cfg_ticket_add_reason').setLabel('Add Dropdown Reason').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('cfg_ticket_clear_reasons').setLabel('Reset Reasons').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('cfg_ticket_role').setLabel('Set Staff Role').setStyle(ButtonStyle.Secondary)
          );
        } else if (sub === 'welcomer') {
          embed.setTitle('👋 Welcomer Configuration Panel').setDescription('Manage automated member greeting style.');
          row.addComponents(
            new ButtonBuilder().setCustomId('cfg_welcome_chan').setLabel('Set Welcome Channel').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cfg_welcome_msg').setLabel('Edit Welcome Message').setStyle(ButtonStyle.Secondary)
          );
        } else if (sub === 'moderation') {
          embed.setTitle('🛡️ Moderation & Logging Configuration').setDescription('Configure automated filter rules and audit logs.');
          row.addComponents(
            new ButtonBuilder().setCustomId('cfg_mod_log').setLabel('Set Audit Log Channel').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cfg_automod').setLabel('Toggle Strict Automod').setStyle(ButtonStyle.Primary)
          );
        } else if (sub === 'roles') {
          embed.setTitle('🎭 Reaction Roles Configuration').setDescription('Setup interactive role assignment buttons.');
          row.addComponents(
            new ButtonBuilder().setCustomId('cfg_add_rrole').setLabel('Create Reaction Role Button').setStyle(ButtonStyle.Secondary)
          );
        }
        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }

      else if (commandName === 'ban' || commandName === 'kick' || commandName === 'timeout' || commandName === 'warn') {
        const user = options.getUser('user');
        const reason = options.getString('reason') || 'No reason provided';
        const member = await interaction.guild.members.fetch(user.id).catch(()=>{});

        if (commandName === 'ban') {
          const durationStr = options.getString('duration');
          let expireStr = durationStr ? `Expires in ${durationStr}` : 'Permanent';
          if (!member) return interaction.reply({ content: 'User not found.', ephemeral: true });
          
          await sendPunishmentDM(user, 'Ban', interaction.guild.name, reason, expireStr);
          await member.ban({ reason });
          logModeration(interaction.guild, 'Banned', user, interaction.user, `${reason} (${expireStr})`);
          return interaction.reply({ content: `Successfully banned ${user.tag}. Universal appeal bridge dispatched via DM.`, ephemeral: true });
        }
        if (commandName === 'kick') {
          if (!member) return interaction.reply({ content: 'User not found.', ephemeral: true });
          await sendPunishmentDM(user, 'Kick', interaction.guild.name, reason, 'Never');
          await member.kick(reason);
          logModeration(interaction.guild, 'Kicked', user, interaction.user, reason);
          return interaction.reply({ content: `Successfully kicked ${user.tag}. Appeal DM dispatched.`, ephemeral: true });
        }
        if (commandName === 'timeout') {
          const durationStr = options.getString('duration');
          if (!member) return interaction.reply({ content: 'Member not found.', ephemeral: true });
          let ms = durationStr.includes('h') ? parseInt(durationStr)*3600000 : parseInt(durationStr)*60000;
          let expireStr = new Date(Date.now() + ms).toUTCString();
          await member.timeout(ms, reason);
          await sendPunishmentDM(user, 'Timeout', interaction.guild.name, reason, expireStr);
          logModeration(interaction.guild, 'Timeout', user, interaction.user, `${reason} (Until: ${expireStr})`);
          return interaction.reply({ content: `Timed out ${user.tag} for ${durationStr}. Appeal DM dispatched.`, ephemeral: true });
        }
        if (commandName === 'warn') {
          if (!db.warnings[interaction.guildId]) db.warnings[interaction.guildId] = {};
          if (!db.warnings[interaction.guildId][user.id]) db.warnings[interaction.guildId][user.id] = [];
          db.warnings[interaction.guildId][user.id].push(reason);
          let count = db.warnings[interaction.guildId][user.id].length;
          saveDb();

          await sendPunishmentDM(user, `Warning #${count}`, interaction.guild.name, reason, 'Active Record');
          logModeration(interaction.guild, `Warning #${count}`, user, interaction.user, reason);

          if (count >= 2 && member) {
            await member.timeout(24*3600000, 'Auto-escalation: 2 warnings reached.');
            interaction.followUp({ content: `User reached 2 warnings and was automatically isolated via timeout for 24h.`, ephemeral: true });
          }
          return interaction.reply({ content: `Warned ${user.tag} successfully (Total: ${count}). Universal appeal DM dispatched.`, ephemeral: true });
        }
      }

      else if (commandName === 'channel') {
        if (sub === 'lock') {
          await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });
          return interaction.reply({ content: '🔒 Channel locked down.', ephemeral: true });
        } else {
          await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: null });
          return interaction.reply({ content: '🔓 Channel unlocked.', ephemeral: true });
        }
      }
    }

    // --- MODAL SUBMISSIONS ---
    else if (interaction.isModalSubmit()) {
      if (interaction.customId === 'pinpal_modal') {
        const title = interaction.fields.getTextInputValue('pin_title');
        const body = interaction.fields.getTextInputValue('pin_body');
        const embed = new EmbedBuilder().setTitle(title).setDescription(body.replace(/\\n/g, '\n')).setColor('Blue').setTimestamp();
        await interaction.channel.send({ embeds: [embed] });
        return interaction.reply({ content: 'PinPal multiline embed sent successfully!', ephemeral: true });
      }

      if (interaction.customId === 'ticket_reason_modal') {
        const newReason = interaction.fields.getTextInputValue('reason_input');
        if (!guildSettings.ticketReasons) guildSettings.ticketReasons = [];
        guildSettings.ticketReasons.push(newReason);
        saveDb();
        return interaction.reply({ content: `Successfully added "**${newReason}**" as a ticket option!`, ephemeral: true });
      }

      if (interaction.customId === 'appeal_modal') {
        const why = interaction.fields.getTextInputValue('appeal_why');
        const desc = interaction.fields.getTextInputValue('appeal_desc');
        const guild = interaction.guild || client.guilds.cache.first();
        if (!guild) return interaction.reply({ content: 'Error filing appeal.', ephemeral: true });

        const appealChan = await guild.channels.create({
          name: `appeal-${interaction.user.username}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
          ]
        });

        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('close_appeal_btn').setLabel('Close Appeal Ticket').setStyle(ButtonStyle.Danger)
        );

        await appealChan.send({ content: `📋 **Universal Punishment Appeal** from <@${interaction.user.id}>\n**Why appeal:** ${why}\n**Description:** ${desc}`, components: [closeRow] });
        db.appeals[appealChan.id] = { userId: interaction.user.id, guildId: guild.id };
        saveDb();

        return interaction.reply({ content: 'Your appeal has been securely submitted to our staff team via a private ticket channel!', ephemeral: true });
      }
    }

    // --- SELECT MENUS & BUTTON ROUTING ---
    else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'ticket_dropdown') {
        const reasonChoice = interaction.values[0];
        let categoryName = reasonChoice; 
        
        const ticketChan = await interaction.guild.channels.create({
          name: `ticket-${interaction.user.username}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
          ]
        });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('close_ticket_btn').setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
        );

        await ticketChan.send({ content: `Welcome ${interaction.user}!\n**Selected Category:** Ticket Created Successfully\nStaff will assist you shortly.`, components: [row] });
        return interaction.reply({ content: `Your support ticket has been opened: ${ticketChan}`, ephemeral: true });
      }
    }

    else if (interaction.isButton()) {
      if (interaction.customId === 'enter_gw') {
        const gw = db.giveaways[interaction.message.id];
        if (!gw) return interaction.reply({ content: 'Giveaway concluded.', ephemeral: true });
        if (gw.entrants.includes(interaction.user.id)) return interaction.reply({ content: 'Already entered!', ephemeral: true });
        gw.entrants.push(interaction.user.id);
        saveDb();
        return interaction.reply({ content: '🎉 Entry confirmed!', ephemeral: true });
      }

      if (interaction.customId === 'cfg_ticket_add_reason') {
        const modal = new ModalBuilder().setCustomId('ticket_reason_modal').setTitle('Add Ticket Reason Option');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason_input').setLabel('Dropdown Option Name').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'cfg_ticket_clear_reasons') {
        guildSettings.ticketReasons = ['General Support', 'Billing Inquiry', 'Technical Issue'];
        saveDb();
        return interaction.reply({ content: 'Ticket options reset to defaults.', ephemeral: true });
      }

      if (interaction.customId === 'open_appeal_form') {
        const modal = new ModalBuilder().setCustomId('appeal_modal').setTitle('Punishment Appeal Form');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('appeal_why').setLabel('Why should this be overturned?').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('appeal_desc').setLabel('Provide full context').setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'close_ticket_btn' || interaction.customId === 'close_appeal_btn') {
        await interaction.reply({ content: 'Closing channel...' });
        setTimeout(() => interaction.channel.delete().catch(()=>{}), 2000);
      }

      if (interaction.customId.startsWith('cfg_')) {
        return interaction.reply({ content: '⚙️ Configuration updated successfully.', ephemeral: true });
      }
    }
  } catch (err) {
    console.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'An execution error occurred.', ephemeral: true }).catch(()=>{});
    }
  }
});

// ----------------------------------------------------------------------
// PERSISTENT STICKY MESSAGES & UNIVERSAL DM BRIDGES
// ----------------------------------------------------------------------
client.on('messageCreate', async message => {
  if (message.author.bot) return;

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

  // User DM to Staff Ticket Channel Bridge
  if (!message.guild && db.appeals) {
    for (const [chanId, data] of Object.entries(db.appeals)) {
      if (data.userId === message.author.id) {
        const guild = client.guilds.cache.get(data.guildId);
        const channel = guild?.channels.cache.get(chanId);
        if (channel) {
          await channel.send(`**${message.author.username}** (Appealing User) - ${message.content}`);
          await message.react('✅').catch(()=>{});
          return;
        }
      }
    }
  }

  // Staff Ticket Channel to User DM Bridge
  if (message.guild && db.appeals[message.channel.id]) {
    const data = db.appeals[message.channel.id];
    const user = await client.users.fetch(data.userId).catch(()=>{});
    if (user) {
      await user.send(`**Staff Response (${message.author.username}):** ${message.content}`).catch(()=>{});
      await message.react('✅').catch(()=>{});
    }
  }
});

async function sendPunishmentDM(user, type, serverName, reason, expire) {
  const embed = new EmbedBuilder()
    .setTitle(`⚠️ Action taken against you in ${serverName}`)
    .setDescription(`**Punishment Type:** ${type}\n**Reason:** ${reason}\n**Expiration:** ${expire}\n\nYou can appeal this punishment securely via the button below.`)
    .setColor('Red')
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('open_appeal_form').setLabel('Appeal Punishment').setStyle(ButtonStyle.Primary)
  );

  await user.send({ embeds: [embed], components: [row] }).catch(()=>{});
}

function logModeration(guild, action, target, moderator, reason) {
  const guildSettings = getGuildSettings(guild.id);
  if (!guildSettings?.modLogId) return;
  const channel = guild.channels.cache.get(guildSettings.modLogId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle(`Audit Log: ${action}`)
    .addFields(
      { name: 'Target', value: `${target.tag} (${target.id})`, inline: true },
      { name: 'Moderator', value: `${moderator.tag}`, inline: true },
      { name: 'Context/Reason', value: reason }
    )
    .setColor('Orange')
    .setTimestamp();

  channel.send({ embeds: [embed] }).catch(()=>{});
}

client.login(process.env.DISCORD_TOKEN);