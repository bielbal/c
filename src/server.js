require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const {
  Client, GatewayIntentBits, Events,
  PermissionsBitField, ChannelType, EmbedBuilder
} = require('discord.js');

const authRouter = require('./routes/auth');
const apiRouter = require('./routes/api');

// ── Discord Bot ──────────────────────────────────────────────────────────────
const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
  ],
});

bot.once(Events.ClientReady, () => {
  console.log(`✅ Bot online: ${bot.user.tag}`);
});

// ── Giveaway state (in-memory) ───────────────────────────────────────────────
const giveaways = new Map(); // messageId → Set<userId>

// ── Button Interactions ──────────────────────────────────────────────────────
bot.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

  const { customId, user, guild, member, message } = interaction;

  try {
    // ── CONFIRM ───────────────────────────────────────────────────────────
    if (customId.startsWith('confirm_')) {
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x57F287)
          .setDescription(`✅ **Confirmado** por ${user}`)
          .setTimestamp()],
        ephemeral: true,
      });

    // ── CANCEL ────────────────────────────────────────────────────────────
    } else if (customId.startsWith('cancel_')) {
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xED4245)
          .setDescription(`❌ **Cancelado** por ${user}`)
          .setTimestamp()],
        ephemeral: true,
      });

    // ── INFO ──────────────────────────────────────────────────────────────
    } else if (customId.startsWith('info_')) {
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setDescription(`ℹ️ Botão \`${customId}\` clicado por ${user}`)
          .setTimestamp()],
        ephemeral: true,
      });

    // ── ROLE ADD: role_add_ROLEID ─────────────────────────────────────────
    } else if (customId.startsWith('role_add_')) {
      const roleId = customId.replace('role_add_', '');
      const role = guild?.roles.cache.get(roleId);
      if (!role || !member) {
        return interaction.reply({ content: '❌ Cargo não encontrado.', ephemeral: true });
      }
      if (member.roles.cache.has(roleId)) {
        return interaction.reply({ content: `Você já tem o cargo **${role.name}**.`, ephemeral: true });
      }
      await member.roles.add(role);
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x57F287)
          .setDescription(`✅ Cargo **${role.name}** adicionado para ${user}!`)],
        ephemeral: true,
      });

    // ── ROLE REMOVE: role_remove_ROLEID ───────────────────────────────────
    } else if (customId.startsWith('role_remove_')) {
      const roleId = customId.replace('role_remove_', '');
      const role = guild?.roles.cache.get(roleId);
      if (!role || !member) {
        return interaction.reply({ content: '❌ Cargo não encontrado.', ephemeral: true });
      }
      if (!member.roles.cache.has(roleId)) {
        return interaction.reply({ content: `Você não tem o cargo **${role.name}**.`, ephemeral: true });
      }
      await member.roles.remove(role);
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xED4245)
          .setDescription(`✅ Cargo **${role.name}** removido de ${user}.`)],
        ephemeral: true,
      });

    // ── ROLE TOGGLE: role_toggle_ROLEID ───────────────────────────────────
    } else if (customId.startsWith('role_toggle_')) {
      const roleId = customId.replace('role_toggle_', '');
      const role = guild?.roles.cache.get(roleId);
      if (!role || !member) {
        return interaction.reply({ content: '❌ Cargo não encontrado.', ephemeral: true });
      }
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(role);
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`🔄 Cargo **${role.name}** removido.`)],
          ephemeral: true,
        });
      } else {
        await member.roles.add(role);
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`🔄 Cargo **${role.name}** adicionado!`)],
          ephemeral: true,
        });
      }

    // ── TICKET: ticket_open ───────────────────────────────────────────────
    } else if (customId === 'ticket_open') {
      if (!guild) return interaction.reply({ content: '❌ Erro de servidor.', ephemeral: true });

      const existing = guild.channels.cache.find(
        c => c.name === `ticket-${user.username.toLowerCase()}` && c.type === ChannelType.GuildText
      );
      if (existing) {
        return interaction.reply({
          content: `Você já tem um ticket aberto: ${existing}`,
          ephemeral: true,
        });
      }

      const category = guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes('ticket')
      );

      const channel = await guild.channels.create({
        name: `ticket-${user.username.toLowerCase()}`,
        type: ChannelType.GuildText,
        parent: category?.id,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        ],
      });

      await channel.send({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('🎫 Ticket Aberto')
          .setDescription(`Olá ${user}! Nossa equipe irá te atender em breve.\n\nDescreva seu problema abaixo.`)
          .setTimestamp()],
      });

      await interaction.reply({
        content: `✅ Ticket criado: ${channel}`,
        ephemeral: true,
      });

    // ── TICKET CLOSE: ticket_close ────────────────────────────────────────
    } else if (customId === 'ticket_close') {
      await interaction.reply({ content: '🔒 Fechando ticket em 5 segundos...', ephemeral: false });
      setTimeout(() => interaction.channel?.delete().catch(() => {}), 5000);

    // ── GIVEAWAY JOIN ─────────────────────────────────────────────────────
    } else if (customId === 'giveaway_join') {
      const msgId = message.id;
      if (!giveaways.has(msgId)) giveaways.set(msgId, new Set());
      const participants = giveaways.get(msgId);

      if (participants.has(user.id)) {
        return interaction.reply({ content: '🎉 Você já está participando!', ephemeral: true });
      }
      participants.add(user.id);

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xEB459E)
          .setDescription(`🎉 **${user.username}** entrou no sorteio!\n**${participants.size}** participante(s)`)],
        ephemeral: true,
      });

    // ── GIVEAWAY LIST ─────────────────────────────────────────────────────
    } else if (customId === 'giveaway_list') {
      const participants = giveaways.get(message.id);
      const count = participants?.size || 0;
      await interaction.reply({
        content: `👥 **${count}** participante(s) neste sorteio.`,
        ephemeral: true,
      });

    // ── DM USER: dm_USERID ────────────────────────────────────────────────
    } else if (customId.startsWith('dm_')) {
      const targetId = customId.replace('dm_', '');
      const target = await bot.users.fetch(targetId).catch(() => null);
      if (target) {
        await target.send(`📩 Você foi contactado por ${user.tag} via botão.`).catch(() => {});
      }
      await interaction.reply({ content: '📩 Mensagem enviada!', ephemeral: true });

    // ── DEFAULT ───────────────────────────────────────────────────────────
    } else {
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setDescription(`🔘 **${customId}** clicado por ${user}`)
          .setTimestamp()],
        ephemeral: true,
      });
    }

  } catch (err) {
    console.error('Interaction error:', err.message);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Erro ao processar ação.', ephemeral: true }).catch(() => {});
    }
  }
});

bot.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
  console.error('❌ Bot login failed:', err.message);
});

// ── Express App ──────────────────────────────────────────────────────────────
const app = express();

app.locals.bot = bot;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change_me_in_production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 86400000 },
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/auth', authRouter);
app.use('/api', apiRouter);

app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server: http://localhost:${PORT}`));
