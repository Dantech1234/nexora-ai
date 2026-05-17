const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

// ======================
// SUPABASE SETUP
// ======================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ======================
// GEMINI AI FUNCTION
// ======================
async function askGemini(message) {
  console.log("[AI] Request received");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: message }],
          },
        ],
      }),
    }
  );

  const data = await res.json();

  const reply =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "No response from AI";

  console.log("[AI] Response generated");

  return reply;
}

// ======================
// HEALTH CHECK
// ======================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "nexora-ai",
  });
});

// ======================
// CREATE OR GET CONVERSATION
// ======================
async function getOrCreateConversation(user_id, conversation_id, message) {
  if (conversation_id) return conversation_id;

  const { data, error } = await supabase
    .from("conversations")
    .insert([
      {
        user_id,
        title: message.slice(0, 40),
      },
    ])
    .select();

  if (error) throw error;

  return data[0].id;
}

// ======================
// CHAT ROUTE (NORMAL)
// ======================
app.post("/chat", async (req, res) => {
  const { message, user_id, conversation_id } = req.body;

  console.log("[CHAT] Incoming request");

  if (!message || !user_id) {
    return res.status(400).json({
      reply: "Missing message or user_id",
    });
  }

  try {
    const activeConversationId = await getOrCreateConversation(
      user_id,
      conversation_id,
      message
    );

    console.log("[DB] Saving user message...");
    await supabase.from("messages").insert([
      {
        user_id,
        conversation_id: activeConversationId,
        role: "user",
        content: message,
      },
    ]);

    console.log("[AI] Calling Gemini...");
    const reply = await askGemini(message);

    console.log("[DB] Saving AI response...");
    await supabase.from("messages").insert([
      {
        user_id,
        conversation_id: activeConversationId,
        role: "assistant",
        content: reply,
      },
    ]);

    res.json({
      reply,
      conversation_id: activeConversationId,
    });

  } catch (err) {
    console.error("[CHAT ERROR]", err);

    res.status(500).json({
      reply: "Server error",
    });
  }
});

// ======================
// CHAT STREAM ROUTE
// ======================
app.post("/chat-stream", async (req, res) => {
  const { message, user_id, conversation_id } = req.body;

  console.log("[STREAM] Request received");

  if (!message || !user_id) {
    return res.status(400).json({ error: "Missing message or user_id" });
  }

  try {
    const activeConversationId = await getOrCreateConversation(
      user_id,
      conversation_id,
      message
    );

    const reply = await askGemini(message);

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    const words = reply.split(" ");

    for (let i = 0; i < words.length; i++) {
      res.write(words[i] + " ");
      await new Promise((r) => setTimeout(r, 20));
    }

    res.end();

    console.log("[STREAM] Completed");

  } catch (err) {
    console.error("[STREAM ERROR]", err);
    res.end("Error generating response");
  }
});

// ======================
// HISTORY (ALL MESSAGES)
// ======================
app.get("/history/:user_id", async (req, res) => {
  const { user_id } = req.params;

  console.log("[HISTORY] Fetching user:", user_id);

  try {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("user_id", user_id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.json(data);

  } catch (err) {
    console.error("[HISTORY ERROR]", err);
    res.status(500).json([]);
  }
});

// ======================
// START SERVER
// ======================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Nexora backend running on port ${PORT}`);
