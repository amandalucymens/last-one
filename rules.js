"use strict";
/* Rule Roulette: the twist kit the engine can enforce, built-in twists, and optional AI twists. */

const COLORS = ["red", "yellow", "green", "blue"];
const TOGGLES = ["sevenZero", "jumpIn", "stacking", "drawUntilPlayable", "noPowerFinish", "challengeWild4"];

const FALLBACK = [
  { name: "Seven Penalty", effect: { type: "curse", value: "7", draw: 1 } },
  { name: "Threes Go Again", effect: { type: "bless", value: "3" } },
  { name: "Blue Skips", effect: { type: "charged", color: "blue" } },
  { name: "Fives Pass a Card", effect: { type: "gift", value: "5" } },
  { name: "Heavier Penalties", effect: { type: "heavy", extra: 1 } },
  { name: "Seven-Zero Swap", effect: { type: "toggle", rule: "sevenZero" } },
  { name: "Zeros Go Again", effect: { type: "bless", value: "0" } },
  { name: "Red Skips", effect: { type: "charged", color: "red" } },
  { name: "Double Nine Penalty", effect: { type: "curse", value: "9", draw: 2 } },
  { name: "Jump-In On", effect: { type: "toggle", rule: "jumpIn" } },
  { name: "Twos Pass a Card", effect: { type: "gift", value: "2" } },
  { name: "Green Skips", effect: { type: "charged", color: "green" } },
];

function cleanRule(r) {
  if (!r || typeof r !== "object" || !r.effect || typeof r.effect !== "object") return null;
  const ef = r.effect;
  const digit = (v) => (/^[0-9]$/.test(String(v)) ? String(v) : null);
  let out = null;
  if (ef.type === "curse" && digit(ef.value)) out = { type: "curse", value: digit(ef.value), draw: Number(ef.draw) === 2 ? 2 : 1 };
  else if (ef.type === "bless" && digit(ef.value)) out = { type: "bless", value: digit(ef.value) };
  else if (ef.type === "gift" && digit(ef.value)) out = { type: "gift", value: digit(ef.value) };
  else if (ef.type === "charged" && COLORS.includes(ef.color)) out = { type: "charged", color: ef.color };
  else if (ef.type === "heavy") out = { type: "heavy", extra: Number(ef.extra) === 2 ? 2 : 1 };
  else if (ef.type === "toggle" && TOGGLES.includes(ef.rule)) out = { type: "toggle", rule: ef.rule };
  if (!out) return null;
  const name = String(r.name || "").replace(/\s+/g, " ").trim().slice(0, 28) || "Mystery Rule";
  return { name, pitch: "", effect: out, ai: !!r.ai };
}

function applyRule(rules, rule) {
  const out = { ...rules, roulette: rule && rule.effect ? rule.effect : null };
  if (rule && rule.effect && rule.effect.type === "toggle") out[rule.effect.rule] = true;
  return out;
}

function pickFallback(recent = []) {
  const pool = FALLBACK.filter((r) => !recent.includes(r.name));
  const r = pool[Math.floor(Math.random() * pool.length)] || FALLBACK[0];
  return { ...r, pitch: "", ai: false };
}

const PROMPT = (recent) => `You invent one twist rule for a round of a color-matching card game (like crazy eights). Cards are red, yellow, green or blue numbers 0-9, plus skip, reverse, +2, wild and wild +4.
Pick exactly ONE effect from this kit, which is all the game can enforce:
- {"type":"curse","value":"0"-"9","draw":1 or 2}: playing that number makes the next player draw cards.
- {"type":"bless","value":"0"-"9"}: playing that number gives the player another turn.
- {"type":"charged","color":"red"|"yellow"|"green"|"blue"}: number cards of that color also skip the next player.
- {"type":"gift","value":"0"-"9"}: playing that number hands the player's highest number card to the next player.
- {"type":"heavy","extra":1 or 2}: every +2 and +4 adds that many extra cards.
- {"type":"toggle","rule":"sevenZero"|"jumpIn"|"stacking"|"drawUntilPlayable"|"noPowerFinish"|"challengeWild4"}: switches on a classic house rule.
Name it plainly so a player knows what it does at a glance: 2-4 words, no themes, puns or invented words (good: "Sevens Go Again", "Blue Skips", "Heavier Penalties"). Avoid repeating these recent rules: ${recent.join(", ") || "none"}.
Reply with JSON only: {"name": string, "effect": {...}}`;

/* Uses OpenAI when OPENAI_API_KEY is set; otherwise, or on any failure, a built-in twist. */
async function spinRule(recent = []) {
  const key = process.env.OPENAI_API_KEY;
  if (key) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          response_format: { type: "json_object" },
          temperature: 1,
          messages: [{ role: "user", content: PROMPT(recent) }],
        }),
      });
      clearTimeout(t);
      if (res.ok) {
        const data = await res.json();
        const r = cleanRule({ ...JSON.parse(data.choices[0].message.content), ai: true });
        if (r && !recent.includes(r.name)) return r;
      } else console.warn("OpenAI spin failed:", res.status);
    } catch (e) {
      console.warn("OpenAI spin error:", e.message);
    }
  }
  return pickFallback(recent);
}

module.exports = { cleanRule, applyRule, spinRule, pickFallback };
