// 0-ai.js — one place for the AI calls, so every check shares a single budget.
const { SETTINGS } = require("./config");

let used = 0;
const usage = () => used;
const budgetLeft = () => used < SETTINGS.MAX_AI_CALLS;

async function askJson(prompt) {
  if (!process.env.GEMINI_KEY || !budgetLeft()) return null;
  used++;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${SETTINGS.GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0 } }) });
    const t = (await res.json())?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const m = t.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

module.exports = { askJson, usage, budgetLeft };
