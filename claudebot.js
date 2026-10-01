const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Express server for health check
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.status(200).send('🤖 Claude Bot is running ✅');
});

app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

// Initialize Claude
const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

// Store conversation history per user
const conversationHistory = new Map();
const MAX_HISTORY = 20; // Keep last 20 messages

// Helper: Delay
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Format message for Discord
const formatResponse = (text, maxLength = 2000) => {
  if (text.length <= maxLength) return [text];
  
  const chunks = [];
  let current = '';
  const lines = text.split('\n');
  
  for (const line of lines) {
    if ((current + line).length > maxLength) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  
  if (current) chunks.push(current);
  return chunks;
};

// Initialize bot
client.once('clientReady', () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  console.log(`🚀 Claude API connected`);
  console.log(`💾 Model: claude-3-5-sonnet-20241022`);
  console.log(`📊 Free tier: 100K tokens/month`);
  
  client.user.setActivity('messages | /help', { type: 'LISTENING' });
});

// Main message handler
client.on('messageCreate', async (message) => {
  // Ignore bots and webhooks
  if (message.author.bot || message.webhookId) return;

  // Only respond to mentions or DMs
  const isMentioned = message.mentions.has(client.user);
  const isDM = message.channel.isDMBased();
  
  if (!isMentioned && !isDM) return;

  try {
    // Show typing indicator
    await message.channel.sendTyping();
    await wait(500);

    // Get user message
    let userMessage = message.content.replace(/^<@!?\d+>\s*/, '').trim();

    if (!userMessage) {
      await message.reply('Please say something! 😊');
      return;
    }

    // Get or create conversation history
    const userId = message.author.id;
    if (!conversationHistory.has(userId)) {
      conversationHistory.set(userId, []);
    }

    const history = conversationHistory.get(userId);

    // Add user message to history
    history.push({
      role: 'user',
      content: userMessage,
    });

    // Keep only last N messages
    if (history.length > MAX_HISTORY) {
      history.shift();
    }

    // Call Claude
    console.log(`📨 ${message.author.username}: "${userMessage}"`);
    
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: history,
      system: 'You are a helpful Discord bot assistant. Keep responses concise and friendly. Use markdown formatting when appropriate.',
    });

    const assistantMessage = response.content[0].text;

    // Add to history
    history.push({
      role: 'assistant',
      content: assistantMessage,
    });

    // Send response(s)
    const chunks = formatResponse(assistantMessage);
    
    for (const chunk of chunks) {
      await message.reply(chunk);
      if (chunks.length > 1) await wait(300);
    }

    console.log(`✅ Reply sent to ${message.author.username}`);

  } catch (error) {
    console.error('❌ Error:', error.message);

    let errorMsg = '❌ An error occurred. Please try again later.';

    if (error.message.includes('401') || error.message.includes('authentication')) {
      errorMsg = '❌ Error: Invalid API key. Check your `.env` file.';
    } else if (error.message.includes('rate_limit')) {
      errorMsg = '⏳ Rate limited! Please wait a moment before trying again.';
    } else if (error.message.includes('overloaded')) {
      errorMsg = '⏳ Claude is overloaded. Please try again in a moment.';
    } else if (error.message.includes('timeout')) {
      errorMsg = '⏳ Request timed out. Please try again.';
    }

    try {
      await message.reply(errorMsg);
    } catch (replyError) {
      console.error('Failed to send error message:', replyError.message);
    }
  }
});

// Help command
client.on('messageCreate', async (message) => {
  if (message.content.toLowerCase() === '/help' || message.content.toLowerCase().includes('/help')) {
    const helpEmbed = new EmbedBuilder()
      .setColor('#FF6B35')
      .setTitle('🤖 Claude Bot Help')
      .setDescription('How to use this Discord bot with Claude AI')
      .addFields(
        {
          name: '💬 Chat',
          value: 'Mention bot or DM: `@Claude [message]`\nBot remembers conversation history!',
          inline: false,
        },
        {
          name: '📌 Powered By',
          value: 'Claude 3.5 Sonnet (Anthropic)\n100K tokens/month free tier',
          inline: false,
        },
        {
          name: '⚡ Features',
          value: '✅ Free (100K tokens/month)\n✅ Remembers conversations\n✅ Markdown support\n✅ Error handling',
          inline: false,
        },
        {
          name: '🔗 Links',
          value: '[Anthropic](https://www.anthropic.com) | [Claude Docs](https://docs.anthropic.com)',
          inline: false,
        }
      )
      .setFooter({ text: 'Claude Bot v1.0 | Type /help for this message' });

    await message.reply({ embeds: [helpEmbed] });
  }
});

// Clear history command (optional)
client.on('messageCreate', async (message) => {
  if (message.content.toLowerCase() === '/clear') {
    const userId = message.author.id;
    conversationHistory.delete(userId);
    await message.reply('✅ Conversation history cleared!');
  }
});

// Periodic cleanup (remove old histories)
setInterval(() => {
  if (conversationHistory.size > 100) {
    const firstKey = conversationHistory.keys().next().value;
    conversationHistory.delete(firstKey);
    console.log('🧹 Cleaned up old conversation history');
  }
}, 60 * 60 * 1000); // Every hour

// Login
client.login(process.env.DISCORD_TOKEN);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Bot shutting down...');
  client.destroy();
  process.exit(0);
});
