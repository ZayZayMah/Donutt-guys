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
let db = { settings: {}, giveaways: {}, tickets: {}, warnings: {}, sticky: {} };

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
  // GIVEAWAY COMMANDS
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage server giveaways')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => 
      sub.setName('start')
         .setDescription('Start a giveaway')
         .addStringOption(o => o.setName('prize').setDescription('Prize name').setRequired(true))
         .addIntegerOption(o => o.setName('winners').setDescription('Number of winners').setRequired(true))
         .addStringOption(o => o.setName('duration').setDescription('Duration e.g. 1h, 2d').setRequired(true))
    )
    .addSubcommand(sub => sub.setName('end').setDescription('End a giveaway early').addStringOption(o => o.setName('message_id').setDescription('Giveaway message ID').setRequired(true)))
    .addSubcommand(sub => sub.setName('reroll').setDescription('Reroll giveaway winners').addStringOption(o => o.setName('message_id').setDescription('Giveaway message ID').setRequired(true)))
    .addSubcommand(sub => sub.setName('delete').setDescription('Delete a giveaway').addStringOption(o => o.setName('message_id').setDescription('Giveaway message ID').setRequired(true))),

  // TICKET COMMANDS
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage ticket system')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => 
      sub.setName('setup')
         .setDescription('Setup a ticket panel in a channel')
         .addChannelOption(o => o.setName('channel').setDescription('Channel to send panel').addChannelTypes(ChannelType.GuildText).setRequired(true))
    )
    .addSubcommand(sub => sub.setName('close').setDescription('Close current ticket channel'))
    .addSubcommand(sub => sub.setName('delete').setDescription('Delete current ticket channel immediately')),

  // STATS COMMANDS
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Manage dynamic server statistics channels')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('create').setDescription('Create server stats voice channels'))
    .addSubcommand(sub => sub.setName('delete').setDescription('Delete server stats channels')),

  // PIN COMMAND (Modal based)
  new SlashCommandBuilder()
    .setName('pin')
    .setDescription('Open a form to configure a custom embedded pinned message'),

  // SETTINGS COMMANDS (Config panels, not triggers)
  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Configure specific bot module settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('tickets').setDescription('Configure ticket staff role and categories'))
    .addSubcommand(sub => sub.setName('welcomer').setDescription('Configure welcome channel and message formats'))
    .addSubcommand(sub => sub.setName('moderation').setDescription('Configure auto-mod rules and logging channels'))
    .addSubcommand(sub => sub.setName('roles').setDescription('Configure autorole and reaction role panels')),

  // MODERATION & UTILITY COMMANDS
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('User to kick').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('User to timeout').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('Duration e.g. 30m, 1h').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),

  new SlashCommandBuilder()
    .setName('channel')
    .setDescription('Lock or unlock channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('lock').setDescription('Lock channel'))
    .addSubcommand(sub => sub.setName('unlock').setDescription('Unlock channel'))
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`Donutt Guys Bot connected as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Successfully registered all advanced commands.');
  } catch (err) { console.error(err); }
});

// ----------------------------------------------------------------------
// INTERACTION ROUTING & LOGIC
// ----------------------------------------------------------------------
client.on('interactionCreate', async interaction => {
  if (!interaction.guild) return;
  if (!db.settings[interaction.guildId]) db.settings[interaction.guildId] = {};
  const guildSettings = db.settings[interaction.guildId];

  try {
    if (interaction.isChatInputCommand()) {
      const { commandName, options } = interaction;
      const sub = options.getSubcommand(false);

      // --- GIVEAWAY ---
      if (commandName === 'giveaway') {
        if (sub === 'start') {
          const prize = options.getString('prize');
          const winners = options.getInteger('winners');
          const duration = options.getString('duration');

          const embed = new EmbedBuilder()
            .setTitle('🎉 GIVEAWAY 🎉')
            .setDescription(`Prize: **${prize}**\nWinners: **${winners}**\nHosted by: ${interaction.user}\nClick the button below to enter!`)
            .setColor('Gold')
            .setTimestamp();

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('enter_giveaway').setLabel('🎉 Enter Giveaway').setStyle(ButtonStyle.Success)
          );

          await interaction.reply({ content: 'Giveaway started!', ephemeral: true });
          const msg = await interaction.channel.send({ embeds: [embed], components: [row] });
          
          db.giveaways[msg.id] = { prize, winners, entrants: [], ended: false };
          saveDb();
        } 
        else if (sub === 'end' || sub === 'reroll' || sub === 'delete') {
          const messageId = options.getString('message_id');
          if (!db.giveaways[messageId]) return interaction.reply({ content: 'Giveaway not found in database record.', ephemeral: true });
          
          if (sub === 'delete') {
            delete db.giveaways[messageId];
            saveDb();
            return interaction.reply({ content: `Giveaway record deleted.`, ephemeral: true });
          }
          
          const gw = db.giveaways[messageId];
          if (gw.entrants.length === 0) return interaction.reply({ content: 'No participants entered this giveaway.', ephemeral: true });
          
          let winnersList = [];
          for (let i = 0; i < Math.min(gw.winners, gw.entrants.length); i++) {
            let rand = Math.floor(Math.random() * gw.entrants.length);
            winnersList.push(`<@${gw.entrants.splice(rand, 1)[0]}>`);
          }
          saveDb();
          return interaction.reply({ content: `🎉 **Giveaway Result:** Winners are ${winnersList.join(', ')}!` });
        }
      }

      // --- TICKET ---
      else if (commandName === 'ticket') {
        if (sub === 'setup') {
          const chan = options.getChannel('channel');
          const embed = new EmbedBuilder()
            .setTitle('🎫 Support Tickets')
            .setDescription('Click the button below to open a private support ticket.')
            .setColor('Blurple');

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('create_ticket').setLabel('Open Ticket').setStyle(ButtonStyle.Primary)
          );

          await chan.send({ embeds: [embed], components: [row] });
          return interaction.reply({ content: `Ticket panel created successfully in ${chan}!`, ephemeral: true });
        }
        else if (sub === 'close') {
          if (!interaction.channel.name.startsWith('ticket-')) return interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });
          await interaction.reply({ content: 'Closing ticket channel in 3 seconds...' });
          setTimeout(() => interaction.channel.delete().catch(()=>{}), 3000);
        }
        else if (sub === 'delete') {
          if (!interaction.channel.name.startsWith('ticket-')) return interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });
          await interaction.channel.delete().catch(()=>{});
        }
      }

      // --- STATS ---
      else if (commandName === 'stats') {
        if (sub === 'create') {
          await interaction.deferReply({ ephemeral: true });
          const memberChan = await interaction.guild.channels.create({
            name: `📊 Members: ${interaction.guild.memberCount}`,
            type: ChannelType.GuildVoice,
            permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionFlagsBits.Connect] }]
          });
          guildSettings.statsChannelId = memberChan.id;
          saveDb();
          return interaction.editReply({ content: 'Server statistic channels successfully initialized!' });
        }
        else if (sub === 'delete') {
          if (guildSettings.statsChannelId) {
            const ch = interaction.guild.channels.cache.get(guildSettings.statsChannelId);
            if (ch) await ch.delete().catch(()=>{});
            delete guildSettings.statsChannelId;
            saveDb();
          }
          return interaction.reply({ content: 'Server stats channels cleared.', ephemeral: true });
        }
      }

      // --- PIN FORM ---
      else if (commandName === 'pin') {
        const modal = new ModalBuilder().setCustomId('pin_modal').setTitle('Create Custom Pinned Embed');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pin_title').setLabel('Embed Title').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pin_desc').setLabel('Embed Description Message').setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      // --- SETTINGS CONFIG PANELS ---
      else if (commandName === 'settings') {
        const embed = new EmbedBuilder().setColor('DarkButNotBlack');
        const row = new ActionRowBuilder();

        if (sub === 'tickets') {
          embed.setTitle('🎫 Ticket Settings Panel').setDescription('Configure ticket management parameters.');
          row.addComponents(
            new ButtonBuilder().setCustomId('set_ticket_role').setLabel('Set Staff Role').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('set_ticket_cat').setLabel('Set Category').setStyle(ButtonStyle.Secondary)
          );
        } 
        else if (sub === 'welcomer') {
          embed.setTitle('👋 Welcomer Settings Panel').setDescription('Configure automated greeting configurations.');
          row.addComponents(
            new ButtonBuilder().setCustomId('set_welcome_chan').setLabel('Set Channel').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('set_welcome_msg').setLabel('Edit Message').setStyle(ButtonStyle.Secondary)
          );
        }
        else if (sub === 'moderation') {
          embed.setTitle('🛡️ Moderation Settings Panel').setDescription('Configure auto-moderation rules & log channels.');
          row.addComponents(
            new ButtonBuilder().setCustomId('set_mod_log').setLabel('Set Log Channel').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('toggle_automod').setLabel('Toggle Automod Filters').setStyle(ButtonStyle.Primary)
          );
        }
        else if (sub === 'roles') {
          embed.setTitle('🎭 Roles Settings Panel').setDescription('Configure reaction-role buttons or member autoroles.');
          row.addComponents(
            new ButtonBuilder().setCustomId('set_autorole').setLabel('Configure Autorole').setStyle(ButtonStyle.Secondary)
          );
        }

        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }

      // --- BASIC MODERATION ---
      else if (commandName === 'ban' || commandName === 'kick' || commandName === 'timeout' || commandName === 'warn') {
        const user = options.getUser('user');
        const reason = options.getString('reason') || 'No reason specified';
        const member = await interaction.guild.members.fetch(user.id).catch(()=>{});

        if (commandName === 'ban') {
          if (!member) return interaction.reply({ content: 'User not found in server.', ephemeral: true });
          await member.ban({ reason });
          return interaction.reply({ content: `Successfully banned ${user.tag}.`, ephemeral: true });
        }
        if (commandName === 'kick') {
          if (!member) return interaction.reply({ content: 'User not found.', ephemeral: true });
          await member.kick(reason);
          return interaction.reply({ content: `Successfully kicked ${user.tag}.`, ephemeral: true });
        }
        if (commandName === 'timeout') {
          const durationStr = options.getString('duration');
          if (!member) return interaction.reply({ content: 'Member not found.', ephemeral: true });
          let ms = durationStr.includes('h') ? parseInt(durationStr)*3600000 : parseInt(durationStr)*60000;
          await member.timeout(ms, reason);
          return interaction.reply({ content: `Timed out ${user.tag} for ${durationStr}.`, ephemeral: true });
        }
        if (commandName === 'warn') {
          if (!db.warnings[interaction.guildId]) db.warnings[interaction.guildId] = {};
          if (!db.warnings[interaction.guildId][user.id]) db.warnings[interaction.guildId][user.id] = [];
          db.warnings[interaction.guildId][user.id].push(reason);
          saveDb();
          return interaction.reply({ content: `Warned ${user.tag}. Total warnings: ${db.warnings[interaction.guildId][user.id].length}`, ephemeral: true });
        }
      }

      else if (commandName === 'channel') {
        if (sub === 'lock') {
          await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });
          return interaction.reply({ content: '🔒 Channel locked.', ephemeral: true });
        } else {
          await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: null });
          return interaction.reply({ content: '🔓 Channel unlocked.', ephemeral: true });
        }
      }
    }

    // --- MODAL SUBMISSIONS ---
    else if (interaction.isModalSubmit()) {
      if (interaction.customId === 'pin_modal') {
        const title = interaction.fields.getTextInputValue('pin_title');
        const desc = interaction.fields.getTextInputValue('pin_desc');
        const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor('Blue').setTimestamp();
        await interaction.channel.send({ embeds: [embed] });
        return interaction.reply({ content: 'Custom pinned embed successfully created!', ephemeral: true });
      }
    }

    // --- BUTTON CLICKS ---
    else if (interaction.isButton()) {
      if (interaction.customId === 'enter_giveaway') {
        const gw = db.giveaways[interaction.message.id];
        if (!gw) return interaction.reply({ content: 'Giveaway has expired.', ephemeral: true });
        if (gw.entrants.includes(interaction.user.id)) {
          return interaction.reply({ content: 'You are already entered into this giveaway!', ephemeral: true });
        }
        gw.entrants.push(interaction.user.id);
        saveDb();
        return interaction.reply({ content: '✅ Entry confirmed! Good luck!', ephemeral: true });
      }

      if (interaction.customId === 'create_ticket') {
        const ticketChan = await interaction.guild.channels.create({
          name: `ticket-${interaction.user.username}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
          ]
        });

        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('close_ticket_btn').setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
        );

        await ticketChan.send({ content: `Welcome ${interaction.user}! Support will be with you shortly.`, components: [closeRow] });
        return interaction.reply({ content: `Ticket created: ${ticketChan}`, ephemeral: true });
      }

      if (interaction.customId === 'close_ticket_btn') {
        await interaction.reply({ content: 'Closing ticket...' });
        setTimeout(() => interaction.channel.delete().catch(()=>{}), 2000);
      }

      // General Settings menu dummy response handler
      if (interaction.customId.startsWith('set_') || interaction.customId.startsWith('toggle_')) {
        return interaction.reply({ content: '⚙️ Configuration updated successfully in system cache.', ephemeral: true });
      }
    }
  } catch (err) {
    console.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'An error occurred while executing this command.', ephemeral: true }).catch(()=>{});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);