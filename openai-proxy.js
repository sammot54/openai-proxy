const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // npm install node-fetch@2
require('dotenv').config();

const app = express();
app.use(express.json());

// Allow any origin for dev/testing (restrict for production by setting ALLOWED_ORIGIN env var)
app.use(cors());

// Environment variables
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const APP_SECRET = process.env.APP_SECRET || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";

if (!OPENAI_KEY) {
  console.error('❌ OPENAI_API_KEY is not set!');
  process.exit(1);
}

// Simple rate limiting
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const clients = {};

function isRateLimited(ip) {
  const now = Date.now();
  if (!clients[ip]) clients[ip] = [];
  clients[ip] = clients[ip].filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  if (clients[ip].length >= RATE_LIMIT_MAX) return true;
  clients[ip].push(now);
  return false;
}

app.post('/vent', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;

  // Require app secret header for safety
  if (APP_SECRET) {
    const appSecretHeader = req.get('X-App-Secret');
    if (appSecretHeader !== APP_SECRET) {
      return res.status(401).json({ reply: "Unauthorized." });
    }
  }

  if (isRateLimited(ip)) {
    return res.status(429).json({ reply: "Too many requests. Please slow down." });
  }

  const { systemPrompt, userText } = req.body;
  if (!systemPrompt || !userText) {
    return res.status(400).json({ reply: "Missing systemPrompt or userText." });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText }
        ],
        max_tokens: 180,
        temperature: 0.95
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI API error:", response.status, errText);
      return res.status(500).json({ reply: "AI backend error: " + errText });
    }

    const data = await response.json();
    const aiReply = data.choices?.[0]?.message?.content;
    if (!aiReply) {
      console.error("No reply from OpenAI. Full response:", JSON.stringify(data));
      return res.status(500).json({ reply: "AI gave no response." });
    }

    res.json({ reply: aiReply.trim() });
  } catch (err) {
    console.error("Proxy server error:", err);
    res.status(500).json({ reply: "Server error: " + err.message });
  }
});

// Make sure to use the port Render provides (PORT env), or 10000 by default
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}!`));
