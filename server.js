"use strict";
/*
 * Last One game server.
 * - Serves the single-page game (public/index.html) at "/" and at every game link "/g/<id>".
 * - Runs each game on the server: the browser only sends moves, so hands stay hidden and
 *   nobody's tab has to stay open. Computer players and turn timers run here too.
 * - Relays voice-chat signalling between browsers (the audio itself goes browser to browser).
 * Games live in memory: a restart or redeploy ends games in progress (links keep working).
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const E = require("./engine");
const R = require("./rules");

const PORT = Number(process.env.PORT) || 3000;
const INDEX_PATH = path.join(__dirname, "public", "index.html");
// player avatars and whether each shows a woman (f) or a man (m); keys match public/index.html
const ICON_G = { blue: "f", red: "m", gele: "f", green: "m", orange: "f", teal: "m", purple: "f", jersey: "m", queen: "f", bucket: "m", bantu: "f", white: "m", buns: "f", durag: "m", locs: "f", twists: "m", bun: "f", brown: "m", dj: "f", grad: "m" };
const ICONS = Object.keys(ICON_G);
const BOTS = [
  { name: "Ama", g: "f" },
  { name: "Kofi", g: "m" },
  { name: "Esi", g: "f" },
  { name: "Kwame", g: "m" },
  { name: "Akosua", g: "f" },
  { name: "Yaw", g: "m" },
  { name: "Efua", g: "f" },
  { name: "Kojo", g: "m" },
];
const SPEEDS = { relaxed: 1700, normal: 1150, fast: 700 };
const MAX_SEATS = 6;
const AWAY_TURN_MS = 15000; // a disconnected player's turn is played for them after this
const LOBBY_DROP_MS = 20000; // a disconnected player leaves the lobby after this
const HOST_HANDOVER_MS = 12000;
const ROOM_IDLE_MS = 30 * 60 * 1000;
const ID_RE = /^[a-z0-9]{6,16}$/;
const DEFAULT_RULES = { stacking: true, jumpIn: true, drawUntilPlayable: false, challengeWild4: false, noPowerFinish: false, handSize: 7, sevenZero: false };

// a YouTube or YouTube Music playlist/video link -> what the players' embedded player needs
function parseYT(raw) {
  try {
    const url = new URL(String(raw || "").trim());
    const host = url.hostname.replace(/^(www|m|music)\./, "");
    if (!/^(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(host)) return null;
    const ok = (x) => /^[\w-]{6,64}$/.test(x || "");
    const list = url.searchParams.get("list");
    const v = host === "youtu.be" ? url.pathname.slice(1).split("/")[0] : url.searchParams.get("v") || (url.pathname.match(/^\/(shorts|embed|live)\/([\w-]{11})/) || [])[2];
    const base = { index: 0, startedAt: Date.now(), playing: true, pausedPos: 0 };
    if (ok(list)) return { kind: "list", id: list, ...base };
    if (/^[\w-]{11}$/.test(v || "")) return { kind: "video", id: v, ...base };
  } catch (e) {}
  return null;
}

function iceServers() {
  const list = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  if (process.env.TURN_URLS)
    list.push({
      urls: process.env.TURN_URLS.split(",").map((s) => s.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME || "",
      credential: process.env.TURN_CREDENTIAL || "",
    });
  return list;
}

/* ---------------- HTTP ---------------- */
let indexCache = null;
function indexHtml() {
  if (!indexCache || process.env.NODE_ENV !== "production") indexCache = fs.readFileSync(INDEX_PATH);
  return indexCache;
}
const spinHits = new Map(); // ip -> [timestamps], light rate limit for solo spins
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const send = (code, type, body, extra = {}) => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-cache", ...extra });
    res.end(body);
  };
  try {
    if (req.method !== "GET" && req.method !== "HEAD") return send(405, "text/plain", "Method not allowed");
    if (p === "/" || /^\/g\/[a-z0-9]{6,16}\/?$/.test(p)) return send(200, "text/html; charset=utf-8", indexHtml());
    if (p === "/healthz") return send(200, "text/plain", "ok");
    if (p === "/config") return send(200, "application/json", JSON.stringify({ iceServers: iceServers() }));
    if (p === "/api/spin") {
      const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;
      const now = Date.now();
      const hits = (spinHits.get(ip) || []).filter((t) => now - t < 60000);
      hits.push(now);
      spinHits.set(ip, hits);
      const recent = String(url.searchParams.get("recent") || "").split("|").slice(0, 6);
      const rule = hits.length > 10 ? R.pickFallback(recent) : await R.spinRule(recent);
      return send(200, "application/json", JSON.stringify(rule));
    }
    if (p.startsWith("/g/")) return send(302, "text/plain", "", { location: "/" });
    send(404, "text/plain", "Not found");
  } catch (e) {
    console.error(e);
    send(500, "text/plain", "Server error");
  }
});

/* ---------------- Rooms ---------------- */
const rooms = new Map();
const rid = (n = 8) => {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (const b of crypto.randomBytes(n)) s += a[b % a.length];
  return s;
};

function getRoom(id) {
  let r = rooms.get(id);
  if (!r) {
    r = {
      id,
      hostId: null,
      members: new Map(), // pid -> member
      tokens: new Map(), // secret token -> pid
      order: [], // seat order (pids)
      rules: { ...DEFAULT_RULES },
      timer: 0,
      speed: "normal",
      rule: null,
      votes: {},
      recent: [],
      spinning: false,
      status: "lobby",
      state: null,
      ruleInPlay: null,
      round: 0,
      botTimer: null,
      turnTimer: null,
      turnStart: 0,
      deadline: 0,
      emptySince: Date.now(),
      hostAwaySince: 0,
      music: null,
      stats: {}, // pid -> {name, icon, wins, losses, played}: the table's leaderboard
      held: false,
    };
    rooms.set(id, r);
  }
  return r;
}

const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 14) || "Player";
const online = (m) => m.bot || m.conns.size > 0;
const humans = (room) => room.order.map((id) => room.members.get(id)).filter((m) => m && !m.bot);

function freeIcon(room, want, exceptPid, gender) {
  const taken = new Set(room.order.filter((id) => id !== exceptPid).map((id) => room.members.get(id)?.icon));
  if (ICONS.includes(want) && !taken.has(want)) return want;
  const open = ICONS.filter((i) => !taken.has(i) && (!gender || ICON_G[i] === gender));
  return open[crypto.randomInt(Math.max(open.length, 1))] || ICONS.find((i) => !taken.has(i)) || ICONS[0];
}

function cleanSettings(s) {
  if (!s || typeof s !== "object") return null;
  const r = s.rules || {};
  return {
    rules: {
      stacking: !!r.stacking,
      jumpIn: !!r.jumpIn,
      drawUntilPlayable: !!r.drawUntilPlayable,
      challengeWild4: !!r.challengeWild4,
      noPowerFinish: !!r.noPowerFinish,
      handSize: [5, 7, 10].includes(Number(r.handSize)) ? Number(r.handSize) : 7,
      sevenZero: false,
    },
    timer: [0, 15, 30, 60].includes(Number(s.timer)) ? Number(s.timer) : 0,
    speed: SPEEDS[s.speed] ? s.speed : "normal",
  };
}

function publicRoom(room) {
  const inGame = new Set(room.state ? room.state.players.map((p) => p.id) : []);
  return {
    id: room.id,
    hostId: room.hostId,
    status: room.status,
    round: room.round,
    seats: room.order.map((id) => {
      const m = room.members.get(id);
      return { pid: id, name: m.name, icon: m.icon, bot: m.bot, online: online(m), mic: !!m.mic, sess: m.sess, inGame: inGame.has(id) };
    }),
    rules: room.rules,
    timer: room.timer,
    speed: room.speed,
    rule: room.rule,
    ruleInPlay: room.ruleInPlay,
    votes: room.votes,
    spinning: room.spinning,
    music: room.music,
    stats: room.stats,
    now: Date.now(),
  };
}

function sanitized(state, pid) {
  const s = JSON.parse(JSON.stringify(state));
  for (const pl of s.players) if (pl.id !== pid) pl.hand = pl.hand.map((_, i) => ({ id: `h-${pl.id}-${i}`, color: null, value: "x" }));
  s.drawPile = new Array(s.drawPile.length).fill(0);
  if (s.challenge) s.challenge.guilty = false;
  s.rngState = 0;
  return s;
}

function sendTo(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcastRoom(room) {
  const msg = { t: "room", room: publicRoom(room) };
  for (const m of room.members.values()) for (const ws of m.conns) sendTo(ws, msg);
}
function sendState(room, m) {
  if (!room.state || !room.state.players.some((p) => p.id === m.pid)) return;
  const msLeft = room.deadline ? Math.max(0, room.deadline - Date.now()) : 0;
  const msg = { t: "state", round: room.round, state: sanitized(room.state, m.pid), msLeft };
  for (const ws of m.conns) sendTo(ws, msg);
}
function broadcastState(room) {
  for (const m of room.members.values()) if (!m.bot) sendState(room, m);
}

/* ---------------- Game flow ---------------- */
function deal(room) {
  const seats = room.order.map((id) => room.members.get(id)).filter(Boolean);
  if (seats.length < 2 || room.status === "playing") return;
  clearTimers(room);
  room.ruleInPlay = room.rule;
  room.state = E.He({
    players: seats.map((m) => ({ id: m.pid, name: m.name })),
    rules: R.applyRule(room.rules, room.rule),
    seed: crypto.randomInt(2 ** 31),
    firstPlayer: crypto.randomInt(seats.length),
  });
  room.status = "playing";
  room.evSeen = room.state.events.length;
  room.held = false;
  room.round++;
  room.turnStart = Date.now();
  armTurnTimer(room);
  broadcastRoom(room);
  broadcastState(room);
  scheduleBots(room, 1200);
}

function currentPid(room) {
  return room.state.players[room.state.turn].id;
}

function apply(room, pid, action) {
  if (room.status !== "playing" || !room.state) return "There's no game running";
  const before = currentPid(room);
  const r = E.Ge(room.state, { ...action, playerId: pid });
  if (!r.ok) return r.error;
  room.state = r.state;
  afterChange(room, before, pid, action.type);
  return null;
}

function afterChange(room, before, actor, type) {
  const s = room.state;
  if (s.phase === "finished") {
    room.status = "finished";
    clearTimers(room);
    for (const pl of s.players) {
      const mb = room.members.get(pl.id);
      const st = (room.stats[pl.id] ||= { name: pl.name, icon: mb?.icon || "blue", wins: 0, losses: 0, played: 0 });
      st.name = mb?.name || st.name;
      st.icon = mb?.icon || st.icon;
      st.played++;
      if (pl.id === s.winnerId) st.wins++;
      if (pl.id === s.loserId) st.losses++;
    }
    broadcastState(room);
    broadcastRoom(room);
    return;
  }
  const now = currentPid(room);
  if (now !== before || (type === "play" && now === actor)) (room.turnStart = Date.now()), (room.held = false);
  // give everyone a moment to take in a swap or shuffle before play moves on
  const recent = s.events.slice(room.evSeen || 0);
  room.evSeen = s.events.length;
  const big = recent.some((e) => e.kind === "swap" || e.kind === "shuffleHands" || (e.kind === "roulette" && e.effect === "shuffle"));
  if (big) room.turnStart += 1800;
  armTurnTimer(room);
  broadcastState(room);
  scheduleBots(room, big ? 1800 : 0);
}

function clearTimers(room) {
  clearTimeout(room.botTimer);
  clearTimeout(room.turnTimer);
  room.botTimer = room.turnTimer = null;
  room.deadline = 0;
}

function turnLimit(room) {
  const m = room.members.get(currentPid(room));
  if (!m || m.bot) return 0;
  const t = room.timer * 1000;
  const away = m.left ? 1500 : m.conns.size === 0 ? AWAY_TURN_MS : 0;
  return t && away ? Math.min(t, away) : t || away;
}

function armTurnTimer(room) {
  clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.deadline = 0;
  if (room.status !== "playing") return;
  const lim = turnLimit(room);
  if (!lim) return;
  room.deadline = room.turnStart + lim;
  room.turnTimer = setTimeout(() => expireTurn(room), Math.max(50, room.deadline - Date.now()));
}

function expireTurn(room) {
  if (room.status !== "playing") return;
  const pid = currentPid(room);
  const m = room.members.get(pid);
  if (!m) return;
  const before = pid;
  let s = room.state;
  const tryAct = (a) => {
    const r = E.Ge(s, { ...a, playerId: pid });
    if (r.ok) s = r.state;
    return r.ok;
  };
  if (m.left || m.conns.size === 0) {
    // play their turn the way a computer player would
    for (let i = 0; i < 4 && s.phase === "playing" && s.players[s.turn].id === pid; i++) {
      const a = E.Be(E.z(s, pid), { catchChance: 0, jumpInChance: 0, bluffChance: 0 });
      if (!a || !tryAct(a)) {
        if (!(E.z(s, pid).drawnCardId ? tryAct({ type: "pass" }) : tryAct({ type: "draw" }))) break;
      }
    }
  } else {
    // turn timer ran out: draw automatically and move on
    if (E.z(s, pid).drawnCardId) tryAct({ type: "pass" });
    else {
      tryAct({ type: "draw" });
      if (s.phase === "playing" && s.players[s.turn].id === pid && E.z(s, pid).drawnCardId) tryAct({ type: "pass" });
    }
    for (const ws of m.conns) sendTo(ws, { t: "toast", msg: "Time's up" });
  }
  room.state = s;
  room.turnStart = Date.now();
  afterChange(room, before, pid, "timeout");
}

function scheduleBots(room, extra = 0) {
  clearTimeout(room.botTimer);
  room.botTimer = null;
  if (room.status !== "playing") return;
  const bots = room.state.players.filter((p) => room.members.get(p.id)?.bot);
  if (!bots.length) return;
  let delay = SPEEDS[room.speed] || SPEEDS.normal;
  const v = room.state.vulnerableId && room.members.get(room.state.vulnerableId);
  if (v && !v.bot) delay = Math.max(2200, delay);
  room.botTimer = setTimeout(() => botTick(room), delay + extra);
}

function botTick(room) {
  if (room.status !== "playing") return;
  const ids = room.state.players.map((p) => p.id).filter((id) => room.members.get(id)?.bot);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  for (const id of ids) {
    const a = E.Be(E.z(room.state, id), { jumpInChance: 0.3, catchChance: 0.45 });
    if (!a) continue;
    const err = apply(room, id, a);
    if (!err) return;
    console.warn("bot move rejected:", id, a.type, err);
  }
  // never let a computer player's turn stall: draw, or pass after drawing
  const cur = currentPid(room);
  if (room.members.get(cur)?.bot) {
    if (apply(room, cur, { type: "draw" }) && apply(room, cur, { type: "pass" })) scheduleBots(room, 400);
  }
}

/* ---------------- Messages ---------------- */
const ACTION_FIELDS = ["type", "cardId", "color", "swapWith", "extraCardIds", "uno", "targetId", "blank"];
const GAME_ACTIONS = new Set(["play", "draw", "pass", "callLastCard", "catch", "challenge"]);

function handle(ws, msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.t === "ping") return sendTo(ws, { t: "pong" });
  if (msg.t === "hello") return hello(ws, msg);
  const room = ws.room;
  const m = room && room.members.get(ws.pid);
  if (!m) return;
  const isHost = room.hostId === m.pid;
  const err = (text) => sendTo(ws, { t: "error", msg: text });

  switch (msg.t) {
    case "profile":
      m.name = cleanName(msg.name);
      m.icon = freeIcon(room, msg.icon, m.pid);
      return broadcastRoom(room);
    case "mic":
      m.mic = !!msg.on;
      return broadcastRoom(room);
    case "signal": {
      const to = room.members.get(msg.to);
      if (!to || to.bot) return;
      // during a round, players and the waiting room are kept apart
      if (room.status !== "lobby" && room.state) {
        const seated = (x) => room.state.players.some((p) => p.id === x);
        if (seated(m.pid) !== seated(to.pid)) return;
      }
      for (const c of to.conns) sendTo(c, { t: "signal", from: m.pid, data: msg.data });
      return;
    }
    case "act": {
      if (!msg.a || !GAME_ACTIONS.has(msg.a.type)) return;
      const a = {};
      for (const k of ACTION_FIELDS) if (msg.a[k] !== undefined) a[k] = msg.a[k];
      if (a.extraCardIds && !Array.isArray(a.extraCardIds)) delete a.extraCardIds;
      if (a.blank) {
        const b = a.blank;
        a.blank = typeof b === "object" && b ? { target: String(b.target || ""), effect: String(b.effect || ""), dare: String(b.dare || "").slice(0, 60) } : undefined;
      }
      const e = apply(room, m.pid, a);
      if (e) {
        err(e);
        sendState(room, m);
      }
      return;
    }
    case "hold": {
      // a player picking a Blank Wild's target or typing a dare gets 30 more seconds, once per turn
      if (room.status !== "playing" || currentPid(room) !== m.pid || room.held || !room.timer) return;
      room.held = true;
      room.turnStart += 30000;
      armTurnTimer(room);
      return sendState(room, m);
    }
    case "vote":
      if (room.status === "playing" || !room.rule) return;
      room.votes = { ...room.votes, [m.pid]: !!msg.keep };
      return broadcastRoom(room);
    case "leave":
      return leave(room, m);
  }

  if (!isHost) return err("Only the host can do that");
  switch (msg.t) {
    case "settings": {
      if (room.status === "playing") return;
      const s = cleanSettings(msg);
      if (s) Object.assign(room, s);
      return broadcastRoom(room);
    }
    case "addBot": {
      if (room.status === "playing" || room.order.length >= MAX_SEATS) return;
      let i = 0;
      while (room.members.has("bot" + i)) i++;
      const used = new Set(room.order.map((id) => room.members.get(id).name));
      const pid = "bot" + i;
      const free = BOTS.filter((b) => !used.has(b.name));
      const bot = free[crypto.randomInt(Math.max(free.length, 1))] || { name: "Bot " + (i + 1), g: i % 2 ? "m" : "f" };
      room.members.set(pid, { pid, name: bot.name, icon: freeIcon(room, null, null, bot.g), bot: true, conns: new Set(), mic: false, sess: 0 });
      room.order.push(pid);
      return broadcastRoom(room);
    }
    case "kick": {
      const t = room.members.get(msg.pid);
      if (room.status === "playing" || !t || t.pid === m.pid) return;
      if (!t.bot) for (const c of t.conns) sendTo(c, { t: "kicked" });
      removeMember(room, t);
      return broadcastRoom(room);
    }
    case "music": {
      const mu = parseYT(msg.url);
      if (!mu) return err("That isn't a YouTube link");
      room.music = mu;
      return broadcastRoom(room);
    }
    case "musicCtl": {
      const mu = room.music;
      if (!mu) return;
      const now = Date.now();
      if (msg.action === "clear") room.music = null;
      else if (msg.action === "pause" && mu.playing) Object.assign(mu, { pausedPos: (now - mu.startedAt) / 1000, playing: false });
      else if (msg.action === "play" && !mu.playing) Object.assign(mu, { startedAt: now - mu.pausedPos * 1000, playing: true });
      else if (msg.action === "next") Object.assign(mu, { index: mu.index + 1, startedAt: now, playing: true, pausedPos: 0 });
      else if (msg.action === "track" && Number.isInteger(msg.index) && msg.index >= 0 && msg.index < 5000) Object.assign(mu, { index: msg.index, startedAt: now });
      else return;
      return broadcastRoom(room);
    }
    case "spin":
      if (room.status === "playing" || room.spinning) return;
      room.spinning = true;
      broadcastRoom(room);
      R.spinRule(room.recent).then((rule) => {
        room.spinning = false;
        room.rule = rule;
        room.recent = [rule.name, ...room.recent].slice(0, 6);
        room.votes = {};
        broadcastRoom(room);
      });
      return;
    case "clearRule":
      if (room.status === "playing") return;
      room.rule = null;
      room.votes = {};
      return broadcastRoom(room);
    case "deal":
      if (room.order.length < 2) return err("You need at least 2 players");
      return deal(room);
    case "lobby":
      if (room.status !== "finished") return;
      room.status = "lobby";
      room.state = null;
      room.votes = {};
      clearTimers(room);
      return broadcastRoom(room);
  }
}

function hello(ws, msg) {
  const id = String(msg.room || "");
  if (!ID_RE.test(id)) return sendTo(ws, { t: "error", msg: "That game link isn't valid", fatal: true });
  const token = String(msg.token || "");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return sendTo(ws, { t: "error", msg: "Couldn't identify this browser", fatal: true });
  const room = getRoom(id);
  if (ws.room) return;
  let pid = room.tokens.get(token);
  let m = pid && room.members.get(pid);
  if (!m) {
    if (room.order.length >= MAX_SEATS && room.status !== "playing")
      return sendTo(ws, { t: "error", msg: "This game is full (6 players).", fatal: true });
    const first = room.order.length === 0;
    if (first) {
      const s = cleanSettings(msg.settings);
      if (s) Object.assign(room, s);
      const mu = msg.settings && parseYT(msg.settings.music);
      if (mu) room.music = mu;
    }
    pid = "p" + rid(10);
    room.tokens.set(token, pid);
    m = { pid, name: cleanName(msg.name), icon: freeIcon(room, msg.icon), bot: false, conns: new Set(), mic: false, sess: 0, left: false };
    room.members.set(pid, m);
    room.order.push(pid);
    if (!room.hostId || !room.members.get(room.hostId) || room.members.get(room.hostId).bot) room.hostId = pid;
  } else {
    m.name = cleanName(msg.name || m.name);
    m.icon = freeIcon(room, msg.icon || m.icon, pid);
    m.left = false;
  }
  clearTimeout(m.dropTimer);
  ws.room = room;
  ws.pid = pid;
  m.conns.add(ws);
  m.sess++;
  m.mic = false;
  room.emptySince = 0;
  sendTo(ws, { t: "welcome", pid, iceServers: iceServers() });
  broadcastRoom(room);
  sendState(room, m);
  if (room.status === "playing" && currentPid(room) === pid) armTurnTimer(room);
}

function removeMember(room, m) {
  clearTimeout(m.dropTimer);
  for (const [tok, id] of room.tokens) if (id === m.pid) room.tokens.delete(tok);
  room.members.delete(m.pid);
  room.order = room.order.filter((id) => id !== m.pid);
  delete room.votes[m.pid];
  if (room.hostId === m.pid) pickHost(room);
}

function pickHost(room) {
  const h = humans(room).find((x) => x.conns.size > 0) || humans(room)[0];
  room.hostId = h ? h.pid : null;
  room.hostAwaySince = 0;
}

function leave(room, m) {
  for (const c of m.conns) c.room = null;
  m.conns.clear();
  m.mic = false;
  if (room.status === "playing" && room.state.players.some((p) => p.id === m.pid)) {
    m.left = true; // their seat is played for them until the round ends
    if (room.hostId === m.pid) pickHost(room);
    if (currentPid(room) === m.pid) armTurnTimer(room);
  } else removeMember(room, m);
  broadcastRoom(room);
}

function onClose(ws) {
  const room = ws.room;
  if (!room) return;
  const m = room.members.get(ws.pid);
  if (!m) return;
  m.conns.delete(ws);
  if (m.conns.size) return;
  m.mic = false;
  if (room.status !== "playing" || !room.state.players.some((p) => p.id === m.pid))
    m.dropTimer = setTimeout(() => {
      if (m.conns.size === 0 && room.members.get(m.pid) === m && room.status !== "playing") {
        removeMember(room, m);
        broadcastRoom(room);
      }
    }, LOBBY_DROP_MS);
  if (room.status === "playing" && currentPid(room) === m.pid) armTurnTimer(room);
  if (!humans(room).some((x) => x.conns.size)) room.emptySince = Date.now();
  broadcastRoom(room);
}

/* housekeeping: hand over a host who has gone away, and forget empty games */
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.emptySince && now - room.emptySince > ROOM_IDLE_MS) {
      clearTimers(room);
      rooms.delete(id);
      continue;
    }
    const host = room.members.get(room.hostId);
    if (host && host.conns.size === 0) {
      room.hostAwaySince ||= now;
      if (now - room.hostAwaySince > HOST_HANDOVER_MS && humans(room).some((x) => x.conns.size)) {
        pickHost(room);
        broadcastRoom(room);
      }
    } else room.hostAwaySince = 0;
  }
  for (const [ip, hits] of spinHits) if (!hits.some((t) => now - t < 60000)) spinHits.delete(ip);
}, 4000);

/* ---------------- WebSocket ---------------- */
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });
wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }
    try {
      handle(ws, msg);
    } catch (e) {
      console.error("handler error", e);
    }
  });
  ws.on("close", () => onClose(ws));
});
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log(`Last One is running on http://localhost:${PORT}`));
