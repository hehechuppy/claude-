const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
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
  res.status(200).send('🤖 Gemini Bot is running ✅');
});

app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Try multiple models (newest first)
const MODEL_PRIORITY = [
  'gemini-2.0-flash',
];

let selectedModel = null;

// Test model availability
async function findAvailableModel() {
  for (const modelName of MODEL_PRIORITY) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      await model.generateContent('test');
      selectedModel = modelName;
      console.log(`✅ Using model: ${modelName}`);
      return modelName;
    } catch (error) {
      console.log(`⚠️ Model ${modelName} not available: ${error.message.split('\n')[0]}`);
      continue;
    }
  }

  // Fallback
  selectedModel = 'gemini-2.0-flash';
  console.log(`⚠️ Using fallback model: ${selectedModel}`);
  return selectedModel;
}

// Store conversation history per user
const conversationHistory = new Map();
const MAX_HISTORY = 20;

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
client.once('clientReady', async () => {
  console.log(`✅ Bot online as ${client.user.tag}`);

  // Find available model
  const model = await findAvailableModel();
  console.log(`🚀 Gemini API connected with model: ${model}`);
  console.log(`💾 Free tier: 15 requests/minute`);

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
      await message.reply('nói đi em! 😊');
      return;
    }

    // Get or create conversation history
    const userId = message.author.id;
    if (!conversationHistory.has(userId)) {
      conversationHistory.set(userId, []);
    }

    const history = conversationHistory.get(userId);

    // Add user message to history (Gemini format)
    history.push({
      role: 'user',
      parts: [{ text: userMessage }],
    });

    // Keep only last N messages
    if (history.length > MAX_HISTORY) {
      history.shift();
    }

    // Call Gemini
    console.log(`📨 ${message.author.username}: "${userMessage}"`);

    const model = genAI.getGenerativeModel({ model: selectedModel });
    const chat = model.startChat({
      history: history.slice(0, -1),
      generationConfig: {
        maxOutputTokens: 1024,
      },
    });

    const result = await chat.sendMessage(userMessage);
    const assistantMessage = result.response.text();

    // Add to history
    history.push({
      role: 'model',
      parts: [{ text: assistantMessage }],
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

    if (error.message.includes('API key') || error.message.includes('401')) {
      errorMsg = '❌ Error: Invalid API key. Check your `.env` file.';
    } else if (error.message.includes('rate_limit') || error.message.includes('429')) {
      errorMsg = '⏳ nạp tiền đi hết hạn rồi: 15 requests/min. Please wait.';
    } else if (error.message.includes('quota') || error.message.includes('RESOURCE_EXHAUSTED')) {
      errorMsg = '⏳ Daily quota exceeded. Please try again tomorrow.';
    } else if (error.message.includes('timeout')) {
      errorMsg = '⏳ Request timed out. Please try again.';
    } else if (error.message.includes('no longer available')) {
      errorMsg = '❌ Model no longer available. Admin is fixing...';
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
      .setColor('#4285F4')
      .setTitle('🤖 Gemini Bot Help')
      .setDescription('Discord bot powered by Google Gemini')
      .addFields(
        {
          name: '💬 Chat',
          value: 'Mention bot or DM: `@Gemini [message]`\nBot remembers conversation history!',
          inline: false,
        },
        {
          name: '📌 Powered By',
          value: 'Google Gemini\nFree tier: 15 requests/minute',
          inline: false,
        },
        {
          name: '⚡ Features',
          value: '✅ Fast responses\n✅ Remembers conversations\n✅ Error handling',
          inline: false,
        }
      )
      .setFooter({ text: 'Gemini Bot v1.0' });

    await message.reply({ embeds: [helpEmbed] });
  }
});

// Clear history command
client.on('messageCreate', async (message) => {
  if (message.content.toLowerCase() === '/clear') {
    const userId = message.author.id;
    conversationHistory.delete(userId);
    await message.reply('✅ Conversation history cleared!');
  }
});

// Periodic cleanup
setInterval(() => {
  if (conversationHistory.size > 100) {
    const firstKey = conversationHistory.keys().next().value;
    conversationHistory.delete(firstKey);
    console.log('🧹 Cleaned up old conversation history');
  }
}, 60 * 60 * 1000);

// Login
client.login(process.env.DISCORD_TOKEN);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Bot shutting down...');
  client.destroy();
  process.exit(0);
});
