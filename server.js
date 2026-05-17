const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

// SUPABASE
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// GEMINI
async function askGemini(message) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: message }] }]
      })
    }
  );

  const data = await res.json();

  return (
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "No response"
  );
}

// HEALTH CHECK (IMPORTANT FOR DEPLOYMENT)
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "nexora-ai" });
});

// CHAT ENDPOINT
app.post("/chat", async (req, res) => {
  const { message, user_id } = req.body;

  try {
    // save user message
    await supabase.from("messages").insert([
      {
        user_id,
        role: "user",
        content: message
      }
    ]);

    // AI response
    const reply = await askGemini(message);

    // save bot response
    await supabase.from("messages").insert([
      {
        user_id,
        role: "assistant",
        content: reply
      }
    ]);

    res.json({ reply });

  } catch (err) {
    console.log(err);
    res.status(500).json({ reply: "Server error" });
  }
});

// HISTORY
app.get("/history/:user_id", async (req, res) => {
  const { user_id } = req.params;

  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("user_id", user_id)
    .order("created_at", { ascending: true });

  res.json(data);
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Nexora backend running");
