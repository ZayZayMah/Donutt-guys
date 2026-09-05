require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const Database = require("better-sqlite3");

// ============================================================
// CONFIG
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Missing DISCORD_TOKEN, CLIENT_ID or GUILD_ID in .env");
  process.exit(1);
}

// ============================================================
// CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ============================================================
// DATABASE
// ============================================================

const db = new Database("tickets.db");

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    guild_id TEXT PRIMARY KEY,
    moderator_role_id TEXT,
    ticket_category_id TEXT,
    log_channel_id TEXT,
    panel_channel_id TEXT,
    panel_message_id TEXT
  );

  CREATE TABLE IF NOT EXISTS ticket_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    emoji TEXT,
    description TEXT,
    questions TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tickets (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type_id INTEGER,
    claimed_by TEXT,
    closed INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`);

// ============================================================
// DATABASE HELPERS
// ============================================================

function getSettings(guildId) {
  return db
    .prepare("SELECT * FROM settings WHERE guild_id = ?")
    .get(guildId);
}

function createSettings(guildId) {
  db.prepare(`
    INSERT OR IGNORE INTO settings (guild_id)
    VALUES (?)
  `).run(guildId);

  return getSettings(guildId);
}

function updateSetting(guildId, column, value) {
  createSettings(guildId);

  const allowed = [
    "moderator_role_id",
    "ticket_category_id",
    "log_channel_id",
    "panel_channel_id",
    "panel_message_id"
  ];

  if (!allowed.includes(column)) {
    throw new Error("Invalid setting.");
  }

  db.prepare(`
    UPDATE settings
    SET ${column} = ?
    WHERE guild_id = ?
  `).run(value, guildId);
}

function getTicket(channelId) {
  return db
    .prepare("SELECT * FROM tickets WHERE channel_id = ?")
    .get(channelId);
}

function getTicketType(id) {
  return db
    .prepare("SELECT * FROM ticket_types WHERE id = ?")
    .get(id);
}

function getTicketTypes(guildId) {
  return db
    .prepare(`
      SELECT *
      FROM ticket_types
      WHERE guild_id = ?
      ORDER BY id ASC
    `)
    .all(guildId);
}

// ============================================================
// PERMISSIONS
// ============================================================

function isModerator(interaction) {
  const settings = getSettings(interaction.guild.id);

  if (!settings?.moderator_role_id) {
    return interaction.member.permissions.has(
      PermissionsBitField.Flags.ManageChannels
    );
  }

  return interaction.member.roles.cache.has(
    settings.moderator_role_id
  );
}

function canManageTicket(interaction) {
  return (
    isModerator(interaction) ||
    interaction.member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  );
}

// ============================================================
// EMBEDS
// ============================================================

function ticketPanelEmbed() {
  return new EmbedBuilder()
    .setTitle("🎫 Support Tickets")
    .setDescription(
      "Select a button below to create a ticket.\n\n" +
      "Please choose the option that best matches your request."
    )
    .setFooter({
      text: "Ticket System"
    })
    .setTimestamp();
}

function ticketEmbed(ticket, type, user) {
  return new EmbedBuilder()
    .setTitle(`${type?.emoji || "🎫"} ${type?.name || "Ticket"}`)
    .setDescription(
      `Welcome ${user}!\n\n` +
      `**Ticket Type:** ${type?.name || "Unknown"}\n` +
      `**Created By:** ${user}\n` +
      `**Status:** ${ticket.closed ? "🔒 Closed" : "🟢 Open"}\n` +
      `**Claimed By:** ${
        ticket.claimed_by ? `<@${ticket.claimed_by}>` : "Nobody"
      }`
    )
    .setTimestamp();
}

// ============================================================
// TICKET CONTROLS
// ============================================================

function ticketControls() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket:claim")
      .setLabel("Claim")
      .setEmoji("🙋")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("ticket:close")
      .setLabel("Close")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("ticket:reopen")
      .setLabel("Reopen")
      .setEmoji("🔓")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("ticket:delete")
      .setLabel("Delete")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
  );
}

// ============================================================
// TRANSCRIPT
// ============================================================

async function createTranscript(channel) {
  let messages = [];
  let lastId;

  while (true) {
    const options = {
      limit: 100
    };

    if (lastId) {
      options.before = lastId;
    }

    const batch = await channel.messages.fetch(options);

    if (!batch.size) break;

    messages.push(...batch.values());

    lastId = batch.last().id;

    if (batch.size < 100) break;
  }

  messages.reverse();

  let output = "";

  output += `Ticket Transcript\n`;
  output += `Channel: #${channel.name}\n`;
  output += `Created: ${new Date().toISOString()}\n`;
  output += `====================================\n\n`;

  for (const message of messages) {
    const date = new Date(message.createdTimestamp).toISOString();

    output += `[${date}] ${message.author.tag}:\n`;
    output += `${message.content || "[No text content]"}\n`;

    if (message.attachments.size) {
      for (const attachment of message.attachments.values()) {
        output += `Attachment: ${attachment.url}\n`;
      }
    }

    output += "\n";
  }

  return output;
}

// ============================================================
// COMMANDS
// ============================================================

const commands = [
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Ticket commands")

    .addSubcommand(sub =>
      sub
        .setName("setup")
        .setDescription("Create a ticket panel")
    )

    .addSubcommand(sub =>
      sub
        .setName("close")
        .setDescription("Close the current ticket")
    )

    .addSubcommand(sub =>
      sub
        .setName("reopen")
        .setDescription("Reopen the current ticket")
    )

    .addSubcommand(sub =>
      sub
        .setName("claim")
        .setDescription("Claim the current ticket")
    )

    .addSubcommand(sub =>
      sub
        .setName("delete")
        .setDescription("Delete the current ticket")
    ),

  new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Configure the ticket system")

    .addSubcommand(sub =>
      sub
        .setName("ticket")
        .setDescription("Open the ticket settings")
    )
].map(command => command.toJSON());

// ============================================================
// REGISTER COMMANDS
// ============================================================

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    {
      body: commands
    }
  );

  console.log("Slash commands registered.");
}

// ============================================================
// CREATE TICKET
// ============================================================

async function createTicket(interaction, type) {
  const guild = interaction.guild;
  const user = interaction.user;

  const existing = db
    .prepare(`
      SELECT *
      FROM tickets
      WHERE guild_id = ?
      AND user_id = ?
      AND closed = 0
    `)
    .get(guild.id, user.id);

  if (existing) {
    return interaction.reply({
      content: `You already have an open ticket: <#${existing.channel_id}>`,
      ephemeral: true
    });
  }

  const settings = getSettings(guild.id);

  if (!settings?.ticket_category_id) {
    return interaction.reply({
      content:
        "The ticket category has not been configured yet. An administrator needs to configure the bot first.",
      ephemeral: true
    });
  }

  const category = guild.channels.cache.get(
    settings.ticket_category_id
  );

  if (!category) {
    return interaction.reply({
      content: "The configured ticket category no longer exists.",
      ephemeral: true
    });
  }

  const channelName =
    `ticket-${user.username}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 20) +
    `-${Math.floor(Math.random() * 9999)}`;

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category.id,

    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [
          PermissionsBitField.Flags.ViewChannel
        ]
      },

      {
        id: user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles
        ]
      }
    ]
  });

  if (settings.moderator_role_id) {
    await channel.permissionOverwrites.create(
      settings.moderator_role_id,
      {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        ManageMessages: true
      }
    );
  }

  db.prepare(`
    INSERT INTO tickets (
      channel_id,
      guild_id,
      user_id,
      type_id,
      claimed_by,
      closed,
      created_at
    )
    VALUES (?, ?, ?, ?, NULL, 0, ?)
  `).run(
    channel.id,
    guild.id,
    user.id,
    type.id,
    Date.now()
  );

  const ticket = getTicket(channel.id);

  const embed = ticketEmbed(
    ticket,
    type,
    user
  );

  await channel.send({
    content: `${user}`,
    embeds: [embed],
    components: [ticketControls()]
  });

  await interaction.reply({
    content: `Your ticket has been created: ${channel}`,
    ephemeral: true
  });
}

// ============================================================
// MODAL FOR TICKET QUESTIONS
// ============================================================

async function showTicketModal(interaction, type) {
  const questions = JSON.parse(type.questions || "[]");

  if (!questions.length) {
    return createTicket(interaction, type);
  }

  const modal = new ModalBuilder()
    .setCustomId(`ticketmodal:${type.id}`)
    .setTitle(type.name.slice(0, 45));

  for (let i = 0; i < Math.min(questions.length, 5); i++) {
    const question = questions[i];

    const input = new TextInputBuilder()
      .setCustomId(`question_${i}`)
      .setLabel(question.slice(0, 45))
      .setPlaceholder("Enter your answer...")
      .setRequired(true)
      .setStyle(TextInputStyle.Paragraph);

    modal.addComponents(
      new ActionRowBuilder().addComponents(input)
    );
  }

  await interaction.showModal(modal);
}

// ============================================================
// HANDLE BUTTONS
// ============================================================

async function handleButton(interaction) {
  const id = interaction.customId;

  // Ticket type buttons
  if (id.startsWith("tickettype:")) {
    const typeId = Number(
      id.split(":")[1]
    );

    const type = getTicketType(typeId);

    if (!type) {
      return interaction.reply({
        content: "That ticket type no longer exists.",
        ephemeral: true
      });
    }

    return showTicketModal(
      interaction,
      type
    );
  }

  // Claim
  if (id === "ticket:claim") {
    if (!canManageTicket(interaction)) {
      return interaction.reply({
        content: "You do not have permission to claim tickets.",
        ephemeral: true
      });
    }

    const ticket = getTicket(interaction.channel.id);

    if (!ticket) {
      return interaction.reply({
        content: "This channel is not a ticket.",
        ephemeral: true
      });
    }

    if (ticket.closed) {
      return interaction.reply({
        content: "This ticket is closed. Reopen it first.",
        ephemeral: true
      });
    }

    db.prepare(`
      UPDATE tickets
      SET claimed_by = ?
      WHERE channel_id = ?
    `).run(
      interaction.user.id,
      interaction.channel.id
    );

    await interaction.reply(
      `🙋 This ticket is now being handled by ${interaction.user}.`
    );

    return;
  }

  // Close
  if (id === "ticket:close") {
    if (!canManageTicket(interaction)) {
      return interaction.reply({
        content: "You do not have permission to close tickets.",
        ephemeral: true
      });
    }

    const ticket = getTicket(interaction.channel.id);

    if (!ticket) {
      return interaction.reply({
        content: "This channel is not a ticket.",
        ephemeral: true
      });
    }

    if (ticket.closed) {
      return interaction.reply({
        content: "This ticket is already closed.",
        ephemeral: true
      });
    }

    const settings = getSettings(
      interaction.guild.id
    );

    await interaction.channel.permissionOverwrites.edit(
      ticket.user_id,
      {
        SendMessages: false
      }
    );

    if (settings?.moderator_role_id) {
      await interaction.channel.permissionOverwrites.edit(
        settings.moderator_role_id,
        {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          ManageMessages: true
        }
      );
    }

    db.prepare(`
      UPDATE tickets
      SET closed = 1
      WHERE channel_id = ?
    `).run(interaction.channel.id);

    await interaction.reply(
      "🔒 This ticket has been closed. Only moderators can send messages now."
    );

    return;
  }

  // Reopen
  if (id === "ticket:reopen") {
    if (!canManageTicket(interaction)) {
      return interaction.reply({
        content: "You do not have permission to reopen tickets.",
        ephemeral: true
      });
    }

    const ticket = getTicket(interaction.channel.id);

    if (!ticket) {
      return interaction.reply({
        content: "This channel is not a ticket.",
        ephemeral: true
      });
    }

    await interaction.channel.permissionOverwrites.edit(
      ticket.user_id,
      {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true
      }
    );

    db.prepare(`
      UPDATE tickets
      SET closed = 0
      WHERE channel_id = ?
    `).run(interaction.channel.id);

    await interaction.reply(
      "🔓 This ticket has been reopened."
    );

    return;
  }

  // Delete
  if (id === "ticket:delete") {
    if (!canManageTicket(interaction)) {
      return interaction.reply({
        content: "You do not have permission to delete tickets.",
        ephemeral: true
      });
    }

    const ticket = getTicket(
      interaction.channel.id
    );

    if (!ticket) {
      return interaction.reply({
        content: "This channel is not a ticket.",
        ephemeral: true
      });
    }

    await interaction.deferReply({
      ephemeral: true
    });

    let transcript;

    try {
      transcript = await createTranscript(
        interaction.channel
      );
    } catch (error) {
      console.error(error);
      transcript = "Unable to create transcript.";
    }

    const settings = getSettings(
      interaction.guild.id
    );

    // Send transcript to log channel if configured
    if (settings?.log_channel_id) {
      const logChannel =
        interaction.guild.channels.cache.get(
          settings.log_channel_id
        );

      if (logChannel) {
        const chunks = [];

        for (let i = 0; i < transcript.length; i += 1900) {
          chunks.push(
            transcript.slice(i, i + 1900)
          );
        }

        const embed = new EmbedBuilder()
          .setTitle("🗑️ Ticket Deleted")
          .setDescription(
            `**Channel:** ${interaction.channel.name}\n` +
            `**Created By:** <@${ticket.user_id}>\n` +
            `**Deleted By:** ${interaction.user}`
          )
          .setTimestamp();

        await logChannel.send({
          embeds: [embed]
        });

        for (const chunk of chunks.slice(0, 10)) {
          await logChannel.send({
            content: `\`\`\`\n${chunk}\n\`\`\``
          });
        }
      }
    }

    db.prepare(`
      DELETE FROM tickets
      WHERE channel_id = ?
    `).run(interaction.channel.id);

    await interaction.editReply({
      content: "Transcript created. Deleting ticket..."
    });

    setTimeout(async () => {
      try {
        await interaction.channel.delete(
          "Ticket deleted"
        );
      } catch (error) {
        console.error(error);
      }
    }, 1500);

    return;
  }
}

// ============================================================
// HANDLE MODALS
// ============================================================

async function handleModal(interaction) {
  if (!interaction.customId.startsWith("ticketmodal:")) {
    return;
  }

  const typeId = Number(
    interaction.customId.split(":")[1]
  );

  const type = getTicketType(typeId);

  if (!type) {
    return interaction.reply({
      content: "That ticket type no longer exists.",
      ephemeral: true
    });
  }

  const questions = JSON.parse(
    type.questions || "[]"
  );

  const answers = [];

  for (let i = 0; i < questions.length; i++) {
    const answer =
      interaction.fields.getTextInputValue(
        `question_${i}`
      );

    answers.push({
      question: questions[i],
      answer
    });
  }

  await createTicket(
    interaction,
    type
  );

  // Wait for channel to appear in DB
  const ticket = db
    .prepare(`
      SELECT *
      FROM tickets
      WHERE user_id = ?
      AND guild_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(
      interaction.user.id,
      interaction.guild.id
    );

  if (!ticket) return;

  const channel =
    interaction.guild.channels.cache.get(
      ticket.channel_id
    );

  if (!channel) return;

  const answerEmbed = new EmbedBuilder()
    .setTitle("📝 Ticket Information")
    .setDescription(
      answers
        .map(
          item =>
            `**${item.question}**\n${item.answer}`
        )
        .join("\n\n")
    )
    .setTimestamp();

  await channel.send({
    embeds: [answerEmbed]
  });
}

// ============================================================
// SETTINGS PANEL
// ============================================================

function settingsEmbed(guild) {
  const settings =
    getSettings(guild.id);

  const types =
    getTicketTypes(guild.id);

  return new EmbedBuilder()
    .setTitle("⚙️ Ticket Settings")
    .setDescription(
      `**Moderator Role:** ${
        settings?.moderator_role_id
          ? `<@&${settings.moderator_role_id}>`
          : "Not configured"
      }\n\n` +

      `**Ticket Category:** ${
        settings?.ticket_category_id
          ? `<#${settings.ticket_category_id}>`
          : "Not configured"
      }\n\n` +

      `**Log Channel:** ${
        settings?.log_channel_id
          ? `<#${settings.log_channel_id}>`
          : "Not configured"
      }\n\n` +

      `**Ticket Types:** ${types.length}`
    )
    .setFooter({
      text: "Use the buttons below to configure the system."
    });
}

function settingsButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("settings:moderator")
        .setLabel("Moderator Role")
        .setEmoji("🛡️")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("settings:category")
        .setLabel("Ticket Category")
        .setEmoji("📁")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("settings:logs")
        .setLabel("Log Channel")
        .setEmoji("📜")
        .setStyle(ButtonStyle.Primary)
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("settings:addtype")
        .setLabel("Add Ticket Type")
        .setEmoji("➕")
        .setStyle(ButtonStyle.Success)
    )
  ];
}

// ============================================================
// SETTINGS BUTTONS
// ============================================================

async function handleSettingsButton(interaction) {
  if (!interaction.customId.startsWith("settings:")) {
    return false;
  }

  if (
    !interaction.member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  ) {
    await interaction.reply({
      content: "Only administrators can change ticket settings.",
      ephemeral: true
    });

    return true;
  }

  const action =
    interaction.customId.split(":")[1];

  if (action === "moderator") {
    const modal = new ModalBuilder()
      .setCustomId("settingsmodal:moderator")
      .setTitle("Moderator Role");

    const input = new TextInputBuilder()
      .setCustomId("role")
      .setLabel("Moderator Role ID")
      .setPlaceholder("Enter the Discord role ID")
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    modal.addComponents(
      new ActionRowBuilder().addComponents(input)
    );

    await interaction.showModal(modal);

    return true;
  }

  if (action === "category") {
    const modal = new ModalBuilder()
      .setCustomId("settingsmodal:category")
      .setTitle("Ticket Category");

    const input = new TextInputBuilder()
      .setCustomId("category")
      .setLabel("Category Channel ID")
      .setPlaceholder("Enter the category ID")
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    modal.addComponents(
      new ActionRowBuilder().addComponents(input)
    );

    await interaction.showModal(modal);

    return true;
  }

  if (action === "logs") {
    const modal = new ModalBuilder()
      .setCustomId("settingsmodal:logs")
      .setTitle("Transcript Log Channel");

    const input = new TextInputBuilder()
      .setCustomId("channel")
      .setLabel("Log Channel ID")
      .setPlaceholder("Enter the channel ID")
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    modal.addComponents(
      new ActionRowBuilder().addComponents(input)
    );

    await interaction.showModal(modal);

    return true;
  }

  if (action === "addtype") {
    const modal = new ModalBuilder()
      .setCustomId("settingsmodal:addtype")
      .setTitle("Add Ticket Type");

    const name = new TextInputBuilder()
      .setCustomId("name")
      .setLabel("Ticket Type Name")
      .setPlaceholder("e.g. Support")
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    const emoji = new TextInputBuilder()
      .setCustomId("emoji")
      .setLabel("Emoji")
      .setPlaceholder("🎫")
      .setRequired(false)
      .setStyle(TextInputStyle.Short);

    const description = new TextInputBuilder()
      .setCustomId("description")
      .setLabel("Description")
      .setPlaceholder("What is this ticket type for?")
      .setRequired(false)
      .setStyle(TextInputStyle.Paragraph);

    const questions = new TextInputBuilder()
      .setCustomId("questions")
      .setLabel("Questions")
      .setPlaceholder("Question 1 | Question 2 | Question 3")
      .setRequired(false)
      .setStyle(TextInputStyle.Paragraph);

    modal.addComponents(
      new ActionRowBuilder().addComponents(name),
      new ActionRowBuilder().addComponents(emoji),
      new ActionRowBuilder().addComponents(description),
      new ActionRowBuilder().addComponents(questions)
    );

    await interaction.showModal(modal);

    return true;
  }

  return true;
}

// ============================================================
// SETTINGS MODALS
// ============================================================

async function handleSettingsModal(interaction) {
  if (!interaction.customId.startsWith("settingsmodal:")) {
    return false;
  }

  if (
    !interaction.member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  ) {
    await interaction.reply({
      content: "Only administrators can change settings.",
      ephemeral: true
    });

    return true;
  }

  const action =
    interaction.customId.split(":")[1];

  if (action === "moderator") {
    const roleId =
      interaction.fields.getTextInputValue("role")
        .trim();

    const role =
      interaction.guild.roles.cache.get(roleId);

    if (!role) {
      await interaction.reply({
        content: "I could not find that role.",
        ephemeral: true
      });

      return true;
    }

    updateSetting(
      interaction.guild.id,
      "moderator_role_id",
      roleId
    );

    await interaction.reply({
      content: `Moderator role set to ${role}.`,
      ephemeral: true
    });

    return true;
  }

  if (action === "category") {
    const categoryId =
      interaction.fields.getTextInputValue("category")
        .trim();

    const category =
      interaction.guild.channels.cache.get(
        categoryId
      );

    if (
      !category ||
      category.type !== ChannelType.GuildCategory
    ) {
      await interaction.reply({
        content: "That is not a valid category.",
        ephemeral: true
      });

      return true;
    }

    updateSetting(
      interaction.guild.id,
      "ticket_category_id",
      categoryId
    );

    await interaction.reply({
      content: `Ticket category set to ${category}.`,
      ephemeral: true
    });

    return true;
  }

  if (action === "logs") {
    const channelId =
      interaction.fields.getTextInputValue("channel")
        .trim();

    const channel =
      interaction.guild.channels.cache.get(
        channelId
      );

    if (!channel) {
      await interaction.reply({
        content: "I could not find that channel.",
        ephemeral: true
      });

      return true;
    }

    updateSetting(
      interaction.guild.id,
      "log_channel_id",
      channelId
    );

    await interaction.reply({
      content: `Transcript log channel set to ${channel}.`,
      ephemeral: true
    });

    return true;
  }

  if (action === "addtype") {
    const name =
      interaction.fields
        .getTextInputValue("name")
        .trim();

    const emoji =
      interaction.fields
        .getTextInputValue("emoji")
        .trim();

    const description =
      interaction.fields
        .getTextInputValue("description")
        .trim();

    const questionText =
      interaction.fields
        .getTextInputValue("questions")
        .trim();

    const questions = questionText
      ? questionText
          .split("|")
          .map(q => q.trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];

    db.prepare(`
      INSERT INTO ticket_types (
        guild_id,
        name,
        emoji,
        description,
        questions
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(
      interaction.guild.id,
      name,
      emoji || "🎫",
      description,
      JSON.stringify(questions)
    );

    await interaction.reply({
      content:
        `Ticket type **${name}** created successfully.\n` +
        `Questions: ${questions.length}/5`,
      ephemeral: true
    });

    return true;
  }

  return true;
}

// ============================================================
// TICKET SETUP
// ============================================================

async function setupTicketPanel(interaction) {
  if (
    !interaction.member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  ) {
    return interaction.reply({
      content: "Only administrators can set up the ticket panel.",
      ephemeral: true
    });
  }

  const types =
    getTicketTypes(interaction.guild.id);

  if (!types.length) {
    return interaction.reply({
      content:
        "You need to create at least one ticket type first.\n\n" +
        "Run `/settings ticket` and use **Add Ticket Type**.",
      ephemeral: true
    });
  }

  const menuButtons = [];

  for (const type of types.slice(0, 5)) {
    menuButtons.push(
      new ButtonBuilder()
        .setCustomId(`tickettype:${type.id}`)
        .setLabel(type.name.slice(0, 80))
        .setEmoji(type.emoji || "🎫")
        .setStyle(ButtonStyle.Primary)
    );
  }

  const rows = [];

  for (let i = 0; i < menuButtons.length; i += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        menuButtons.slice(i, i + 5)
      )
    );
  }

  const message =
    await interaction.channel.send({
      embeds: [ticketPanelEmbed()],
      components: rows
    });

  updateSetting(
    interaction.guild.id,
    "panel_channel_id",
    interaction.channel.id
  );

  updateSetting(
    interaction.guild.id,
    "panel_message_id",
    message.id
  );

  await interaction.reply({
    content: "Ticket panel created.",
    ephemeral: true
  });
}

// ============================================================
// MESSAGE COMMANDS
// ============================================================

async function handleCommand(interaction) {
  if (interaction.commandName === "ticket") {
    const subcommand =
      interaction.options.getSubcommand();

    if (subcommand === "setup") {
      return setupTicketPanel(interaction);
    }

    const ticket =
      getTicket(interaction.channel.id);

    if (!ticket) {
      return interaction.reply({
        content: "This channel is not a ticket.",
        ephemeral: true
      });
    }

    if (subcommand === "claim") {
      if (!canManageTicket(interaction)) {
        return interaction.reply({
          content: "You do not have permission to claim tickets.",
          ephemeral: true
        });
      }

      db.prepare(`
        UPDATE tickets
        SET claimed_by = ?
        WHERE channel_id = ?
      `).run(
        interaction.user.id,
        interaction.channel.id
      );

      return interaction.reply(
        `🙋 ${interaction.user} is now handling this ticket.`
      );
    }

    if (subcommand === "close") {
      if (!canManageTicket(interaction)) {
        return interaction.reply({
          content: "You do not have permission to close tickets.",
          ephemeral: true
        });
      }

      await interaction.channel.permissionOverwrites.edit(
        ticket.user_id,
        {
          SendMessages: false
        }
      );

      db.prepare(`
        UPDATE tickets
        SET closed = 1
        WHERE channel_id = ?
      `).run(interaction.channel.id);

      return interaction.reply(
        "🔒 Ticket closed."
      );
    }

    if (subcommand === "reopen") {
      if (!canManageTicket(interaction)) {
        return interaction.reply({
          content: "You do not have permission to reopen tickets.",
          ephemeral: true
        });
      }

      await interaction.channel.permissionOverwrites.edit(
        ticket.user_id,
        {
          SendMessages: true
        }
      );

      db.prepare(`
        UPDATE tickets
        SET closed = 0
        WHERE channel_id = ?
      `).run(interaction.channel.id);

      return interaction.reply(
        "🔓 Ticket reopened."
      );
    }

    if (subcommand === "delete") {
      if (!canManageTicket(interaction)) {
        return interaction.reply({
          content: "You do not have permission to delete tickets.",
          ephemeral: true
        });
      }

      let transcript;

      try {
        transcript =
          await createTranscript(
            interaction.channel
          );
      } catch {
        transcript =
          "Transcript could not be created.";
      }

      const settings =
        getSettings(interaction.guild.id);

      if (settings?.log_channel_id) {
        const logChannel =
          interaction.guild.channels.cache.get(
            settings.log_channel_id
          );

        if (logChannel) {
          await logChannel.send({
            content:
              `🗑️ Ticket deleted by ${interaction.user}\n` +
              `Created by: <@${ticket.user_id}>\n\n` +
              "```text\n" +
              transcript.slice(0, 1800) +
              "\n```"
          });
        }
      }

      db.prepare(`
        DELETE FROM tickets
        WHERE channel_id = ?
      `).run(interaction.channel.id);

      await interaction.reply(
        "🗑️ Ticket deleted."
      );

      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 1000);

      return;
    }
  }

  if (
    interaction.commandName === "settings" &&
    interaction.options.getSubcommand() === "ticket"
  ) {
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.Administrator
      )
    ) {
      return interaction.reply({
        content: "Only administrators can access ticket settings.",
        ephemeral: true
      });
    }

    createSettings(interaction.guild.id);

    return interaction.reply({
      embeds: [
        settingsEmbed(interaction.guild)
      ],
      components: settingsButtons(),
      ephemeral: true
    });
  }
}

// ============================================================
// INTERACTION HANDLER
// ============================================================

client.on(
  "interactionCreate",
  async interaction => {
    try {
      if (interaction.isChatInputCommand()) {
        return handleCommand(interaction);
      }

      if (interaction.isButton()) {
        if (
          interaction.customId.startsWith("settings:")
        ) {
          return handleSettingsButton(
            interaction
          );
        }

        return handleButton(interaction);
      }

      if (interaction.isModalSubmit()) {
        if (
          interaction.customId.startsWith(
            "settingsmodal:"
          )
        ) {
          return handleSettingsModal(
            interaction
          );
        }

        return handleModal(interaction);
      }
    } catch (error) {
      console.error("Interaction error:", error);

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content:
            "Something went wrong while processing that action.",
          ephemeral: true
        }).catch(() => {});
      } else {
        await interaction.reply({
          content:
            "Something went wrong while processing that action.",
          ephemeral: true
        }).catch(() => {});
      }
    }
  }
);

// ============================================================
// READY
// ============================================================

client.once("ready", async () => {
  console.log(
    `Logged in as ${client.user.tag}`
  );

  try {
    await registerCommands();
  } catch (error) {
    console.error(
      "Failed to register commands:",
      error
    );
  }
});

// ============================================================
// LOGIN
// ============================================================

client.login(TOKEN);