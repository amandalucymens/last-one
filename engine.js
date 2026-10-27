"use strict";
/* Game engine: pure rules, shared with the browser copy in public/index.html. */
  var D = ["red", "yellow", "green", "blue"],
    Ae = {
      stacking: !1,
      jumpIn: !1,
      sevenZero: !1,
      handSize: 7,
      drawUntilPlayable: !1,
      challengeWild4: !1,
      noPowerFinish: !1,
    };
  function ln(e) {
    let n = (e + 1831565813) | 0,
      t = Math.imul(n ^ (n >>> 15), 1 | n);
    return (
      (t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t),
      [((t ^ (t >>> 14)) >>> 0) / 4294967296, n]
    );
  }
  function ge(e, n) {
    let t = e.slice(),
      a = n;
    for (let r = t.length - 1; r > 0; r--) {
      let l;
      [l, a] = ln(a);
      let o = Math.floor(l * (r + 1));
      [t[r], t[o]] = [t[o], t[r]];
    }
    return [t, a];
  }
  var on = { red: "r", yellow: "y", green: "g", blue: "b" };
  function De() {
    let e = [];
    for (let n of D) {
      let t = on[n];
      e.push({ id: `${t}-0-a`, color: n, value: "0" });
      let a = [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "skip",
        "reverse",
        "draw2",
      ];
      for (let r of a)
        (e.push({ id: `${t}-${r}-a`, color: n, value: r }),
          e.push({ id: `${t}-${r}-b`, color: n, value: r }));
    }
    // wilds: 4 Wild, 8 Wild +4, 2 Wild +10, 1 Shuffle Hands, 2 Swap Hands, 3 Blank Wild (120 cards in all)
    for (let [v, k] of [["wild", 4], ["wild4", 8], ["wild10", 2], ["wildShuffle", 1], ["wildSwap", 2], ["wildBlank", 3]])
      for (let n = 0; n < k; n++) e.push({ id: `w-${v}-${n}`, color: null, value: v });
    return e;
  }
  function $(e) {
    return e.value.startsWith("wild");
  }
  var DRAWS = { draw2: 2, wild4: 4, wild10: 10 },
    BLANK_FX = ["draw2", "draw4", "skip", "swap", "dare"];
  function ie(e) {
    return /^[0-9]$/.test(e.value);
  }
  var Oe = 2,
    Re = 10;
  function He(e) {
    let n = { ...Ae, ...e.rules },
      t = e.players.length;
    if (t < Oe || t > Re) throw new Error(`A game needs ${Oe}-${Re} players`);
    if (new Set(e.players.map((c) => c.id)).size !== t)
      throw new Error("Player ids must be unique");
    if (n.handSize < 1 || n.handSize * t > 100)
      throw new Error(
        "Hand size does not fit in the deck for this many players",
      );
    let [a, r] = ge(De(), e.seed | 0),
      l = e.players.map((c) => ({
        id: c.id,
        name: c.name,
        hand: [],
        calledLastCard: !1,
      }));
    for (let c = 0; c < n.handSize; c++) for (let d of l) d.hand.push(a.pop());
    let o = gn(a, ie),
      [i] = a.splice(o, 1),
      s = (((e.firstPlayer ?? 0) % t) + t) % t;
    return {
      players: l,
      drawPile: a,
      discardPile: [i],
      currentColor: i.color,
      turn: s,
      direction: 1,
      pendingDraw: 0,
      drawnCardId: null,
      challenge: null,
      vulnerableId: null,
      phase: "playing",
      winnerId: null,
      rules: n,
      rngState: r,
      events: [{ kind: "start", firstPlayerId: l[s].id, topCard: i }],
      version: 0,
    };
  }
  function W(e) {
    return e.discardPile[e.discardPile.length - 1];
  }
  function V(e, n, t) {
    if (e.phase !== "playing") return !1;
    let a = e.players.findIndex((l) => l.id === n);
    if (a < 0) return !1;
    let r = W(e);
    return e.rules.noPowerFinish && e.players[a].hand.length === 1 && !ie(t)
      ? !1
      : a !== e.turn
        ? Ve(e, t)
        : e.drawnCardId && t.id !== e.drawnCardId
          ? !1
          : e.pendingDraw > 0
            ? e.rules.stacking
              ? e.rules.roulette?.type === "stackAny"
                ? t.value in DRAWS
                : r.value in DRAWS && t.value === r.value
              : !1
            : $(t)
              ? !0
              : t.color === e.currentColor || t.value === r.value;
  }
  function Ve(e, n) {
    if (!e.rules.jumpIn || e.pendingDraw > 0 || $(n)) return !1;
    let t = W(e);
    return !$(t) && n.color === t.color && n.value === t.value;
  }
  function Ye(e, n) {
    let t = e.players.find((a) => a.id === n);
    return t ? t.hand.filter((a) => V(e, n, a)).map((a) => a.id) : [];
  }
  function je(e, n, t) {
    let a = e.players.findIndex((i) => i.id === n);
    if (a < 0 || a !== e.turn || !e.rules.stacking || e.drawnCardId) return [];
    let r = e.players[a].hand,
      l = r.find((i) => i.id === t);
    if (!l || $(l)) return [];
    let o = r.filter((i) => i.id !== t && !$(i) && i.value === l.value);
    return [l, ...o].some((i) => V(e, n, i)) ? o.map((i) => i.id) : [];
  }
  function Ge(e, n) {
    if (e.phase !== "playing") return we("The game is over");
    let t = e.players.findIndex((l) => l.id === n.playerId);
    if (t < 0) return we("You are not in this game");
    let a = structuredClone(e),
      r;
    switch (n.type) {
      case "play":
        r = sn(a, t, n);
        break;
      case "draw":
        r = dn(a, t);
        break;
      case "pass":
        r = un(a, t);
        break;
      case "callLastCard":
        r = pn(a, t);
        break;
      case "catch":
        r = fn(a, t, n.targetId);
        break;
      case "challenge":
        r = cn(a, t);
        break;
      default:
        r = "Unknown action";
    }
    if (r) return we(r);
    for (let l of a.players) l.hand.length > 2 && (l.calledLastCard = !1);
    for (let k = 0; k < a.players.length && a.phase === "playing" && a.players[a.turn].skipNext; k++) {
      let sk = a.players[a.turn];
      sk.skipNext = !1;
      a.events.push({ kind: "skip", playerId: sk.id });
      a.turn = C(a, a.turn, 1);
    }
    return ((a.version = e.version + 1), { ok: !0, state: a });
  }
  function we(e) {
    return { ok: !1, error: e };
  }
  function sn(e, n, t) {
    let { cardId: a, color: r, swapWith: l } = t,
      o = e.players[n],
      i = o.hand.findIndex((h) => h.id === a);
    if (i < 0) return "That card is not in your hand";
    let s = o.hand[i],
      c = n !== e.turn,
      d = t.extraCardIds ?? [],
      f = [];
    if (d.length > 0) {
      if (!e.rules.stacking)
        return "Stacking is off";
      if (c) return "You can only jump in with one card";
      if (e.drawnCardId)
        return "Play the card you drew";
      if ($(s)) return "Wild cards are played one at a time";
      let h = new Set([a]);
      for (let S of d) {
        if (h.has(S)) return "Each card can only be played once";
        h.add(S);
        let q = o.hand.find((b) => b.id === S);
        if (!q) return "That card is not in your hand";
        if ($(q) || q.value !== s.value)
          return "Cards must show the same number";
        f.push(q);
      }
      let w = [s, ...f],
        P = w.find((S) => V(e, o.id, S));
      if (!P)
        return e.pendingDraw > 0
          ? `Stack a ${W(e).value === "wild4" ? "+4" : "+2"} or take ${e.pendingDraw}`
          : "None of those match the pile";
      ((s = P), (f = w.filter((S) => S !== P)));
    }
    if (c) {
      if (!Ve(e, s)) return "It's not your turn";
    } else if (!V(e, o.id, s))
      return e.drawnCardId && s.id !== e.drawnCardId
        ? "Play the card you drew, or pass"
        : e.pendingDraw > 0
          ? `Stack a ${W(e).value === "wild4" ? "+4" : "+2"} or take ${e.pendingDraw}`
          : "That card doesn't match";
    if ($(s) && (!r || !D.includes(r)))
      return "Choose a color for the wild card";
    let v = (e.rules.sevenZero && s.value === "7") || s.value === "wildSwap",
      L = -1;
    if (v && ((L = e.players.findIndex((h) => h.id === l)), L < 0 || L === n || e.players[L].out))
      return "Choose another player to swap hands with";
    let bl = null;
    if (s.value === "wildBlank") {
      let b = t.blank || {},
        ti = e.players.findIndex((h) => h.id === b.target);
      if (ti < 0 || ti === n || e.players[ti].out) return "Pick who your blank card hits";
      if (!BLANK_FX.includes(b.effect)) return "Pick what your blank card does";
      let dare = String(b.dare || "").replace(/\s+/g, " ").trim().slice(0, 60);
      if (b.effect === "dare" && !dare) return "Write a dare first";
      bl = { ti, effect: b.effect, dare };
    }
    let M = [s, ...f],
      I = M.length;
    if (e.rules.noPowerFinish && o.hand.length === I && !ie(s))
      return "Your last card must be a number";
    let R = e.currentColor;
    ((e.challenge = null),
      (e.vulnerableId = null),
      (e.drawnCardId = null),
      (o.hand = o.hand.filter((h) => !M.includes(h))),
      e.discardPile.push(...M));
    let H = M[I - 1];
    if (
      ((e.currentColor = H.color ?? r),
      (e.turn = n),
      e.events.push({
        kind: "play",
        playerId: o.id,
        card: H,
        color: e.currentColor,
        jumpIn: c,
        ...(I > 1 ? { cards: M } : {}),
      }),
      o.hand.length === 0 && finishPlayer(e, n))
    )
      return null;
    (o.hand.length === 1 &&
      !o.calledLastCard &&
      t.uno &&
      ((o.calledLastCard = !0),
      e.events.push({ kind: "callLastCard", playerId: o.id })),
      o.hand.length === 1 && !o.calledLastCard && (e.vulnerableId = o.id));
    let Ee = activeCount(e) + (o.out ? 1 : 0);
    switch (s.value) {
      case "skip": {
        if (e.rules.roulette?.type === "skipAll" && !o.out) {
          for (let h = 1; h < Ee; h++) e.events.push({ kind: "skip", playerId: e.players[C(e, n, h)].id });
          e.events.push({ kind: "roulette", playerId: o.id, effect: "skipAll" });
          e.turn = n;
          break;
        }
        for (let h = 1; h <= I; h++)
          e.events.push({ kind: "skip", playerId: e.players[C(e, n, h)].id });
        e.turn = C(e, n, I + 1);
        break;
      }
      case "reverse":
        for (let h = 0; h < I; h++)
          ((e.direction = e.direction === 1 ? -1 : 1),
            e.events.push({ kind: "reverse", direction: e.direction }));
        e.turn = Ee === 2 && !o.out ? n : C(e, n, 1);
        break;
      case "draw2":
      case "wild4":
      case "wild10": {
        let h = (DRAWS[s.value] + (e.rules.roulette?.type === "heavy" ? e.rules.roulette.extra : 0)) * I;
        e.rules.roulette?.type === "heavy" &&
          e.events.push({ kind: "roulette", playerId: o.id, effect: "heavy" });
        if (s.value === "wild4" && e.rules.roulette?.type === "drawColor" && e.pendingDraw === 0) {
          let w = C(e, n, 1),
            k = drawUntil(e, w, (c) => c.color === e.currentColor || $(c), 25);
          e.events.push({ kind: "roulette", playerId: o.id, targetId: e.players[w].id, effect: "drawColor", count: k });
          e.turn = C(e, n, 2);
        } else if (s.value === "wild4" && e.rules.challengeWild4 && !o.out) {
          ((e.pendingDraw += h),
            e.pendingDraw > h &&
              e.events.push({ kind: "stack", total: e.pendingDraw }));
          let w = o.hand.some((P) => P.color === R);
          ((e.challenge = { offenderId: o.id, color: R, guilty: w }),
            (e.turn = C(e, n, 1)));
        } else if (e.rules.stacking)
          ((e.pendingDraw += h),
            e.pendingDraw > h &&
              e.events.push({ kind: "stack", total: e.pendingDraw }),
            (e.turn = C(e, n, 1)),
            yn(e));
        else {
          let w = C(e, n, 1);
          (Y(e, w, h, !0), (e.turn = C(e, n, 2)));
        }
        break;
      }
      default:
        if (v && !o.out) {
          let h = e.players[L];
          (([o.hand, h.hand] = [h.hand, o.hand]),
            (o.calledLastCard = !1),
            (h.calledLastCard = !1),
            (e.vulnerableId = null),
            e.events.push({ kind: "swap", playerId: o.id, targetId: h.id }));
        } else if (e.rules.sevenZero && s.value === "0") {
          let h = e.players.map((w) => w.hand);
          e.players.forEach((w, P) => {
            w.out || (e.players[C(e, P, 1)].hand = h[P]);
          });
          for (let w of e.players) w.calledLastCard = !1;
          ((e.vulnerableId = null),
            e.events.push({ kind: "rotate", direction: e.direction }));
        }
        e.turn = C(e, n, 1);
        s.value === "wildShuffle" && shuffleAllHands(e, n);
        bl && applyBlank(e, n, bl);
        rouletteAfterNumber(e, n, s, I);
        rouletteAfterWild(e, n, s);
    }
    return null;
  }
  function rouletteAfterNumber(e, n, s, I) {
    let r = e.rules.roulette;
    if (!r || !ie(s) || e.phase !== "playing") return;
    let me = e.players[n];
    if (r.type === "curse" && s.value === r.value) {
      let t = C(e, n, 1);
      e.events.push({ kind: "roulette", playerId: me.id, targetId: e.players[t].id, effect: "curse" });
      Y(e, t, r.draw * I, !0);
    } else if (r.type === "bless" && s.value === r.value && !me.out) {
      e.turn = n;
      e.events.push({ kind: "roulette", playerId: me.id, effect: "bless" });
    } else if (r.type === "charged" && s.color === r.color) {
      let t = C(e, n, 1);
      e.events.push({ kind: "roulette", playerId: me.id, targetId: e.players[t].id, effect: "charged" });
      e.events.push({ kind: "skip", playerId: e.players[t].id });
      e.turn = C(e, n, 2);
    } else if (r.type === "discardAll" && s.value === r.value) {
      let drop = me.hand.filter((c) => c.color === s.color);
      if (drop.length) {
        me.hand = me.hand.filter((c) => c.color !== s.color);
        e.discardPile.splice(e.discardPile.length - 1, 0, ...drop);
        e.events.push({ kind: "roulette", playerId: me.id, effect: "discardAll", count: drop.length });
        if (me.hand.length === 0) finishPlayer(e, n);
        else if (me.hand.length === 1 && !me.calledLastCard) e.vulnerableId = me.id;
      }
    } else if (r.type === "gift" && s.value === r.value && me.hand.length > 1) {
      let t = C(e, n, 1),
        give = me.hand.slice().sort((a, b) => giftScore(b) - giftScore(a))[0];
      me.hand = me.hand.filter((c) => c !== give);
      e.players[t].hand.push(give);
      e.players[t].calledLastCard = !1;
      e.events.push({ kind: "roulette", playerId: me.id, targetId: e.players[t].id, effect: "gift" });
      me.hand.length === 1 && !me.calledLastCard && (e.vulnerableId = me.id);
    }
  }
  function rouletteAfterWild(e, n, s) {
    let r = e.rules.roulette;
    if (!r || r.type !== "shuffleHands" || s.value !== "wild" || e.phase !== "playing") return;
    shuffleAllHands(e, n, !0);
  }
  function shuffleAllHands(e, n, twist) {
    let all = e.players.flatMap((x) => x.hand),
      sh;
    [sh, e.rngState] = ge(all, e.rngState);
    e.players.forEach((x) => ((x.hand = []), (x.calledLastCard = !1)));
    let order = [];
    for (let i = 1; order.length < activeCount(e); i++) order.push(C(e, n, i));
    sh.forEach((c, i) => e.players[order[i % order.length]].hand.push(c));
    e.vulnerableId = null;
    e.events.push(twist ? { kind: "roulette", playerId: e.players[n].id, effect: "shuffle" } : { kind: "shuffleHands", playerId: e.players[n].id });
  }
  function applyBlank(e, n, b) {
    let me = e.players[n],
      t = e.players[b.ti];
    e.events.push({ kind: "blank", playerId: me.id, targetId: t.id, effect: b.effect, ...(b.dare ? { dare: b.dare } : {}) });
    if (b.effect === "draw2" || b.effect === "draw4") Y(e, b.ti, b.effect === "draw2" ? 2 : 4, !0);
    else if (b.effect === "skip") t.skipNext = !0;
    else if (b.effect === "swap" && !me.out) {
      [me.hand, t.hand] = [t.hand, me.hand];
      me.calledLastCard = t.calledLastCard = !1;
      e.vulnerableId = null;
      e.events.push({ kind: "swap", playerId: me.id, targetId: t.id });
    }
  }
  // draw one card at a time until test(card) passes; logs one combined draw
  function drawUntil(e, who, test, cap) {
    let mark = e.events.length,
      k = 0;
    for (; k < cap; ) {
      let [c] = Y(e, who, 1, !0);
      if (!c) break;
      k++;
      if (test(c)) break;
    }
    let kept = e.events.slice(mark).filter((x) => x.kind !== "draw");
    e.events.length = mark;
    e.events.push(...kept, { kind: "draw", playerId: e.players[who].id, count: k, penalty: !0 });
    return k;
  }
  function giftScore(c) {
    return c.value === "wild4" ? -3 : c.value === "wild" ? -2 : ie(c) ? Number(c.value) : -1;
  }
  function dn(e, n) {
    if (n !== e.turn) return "It's not your turn";
    if (e.drawnCardId) return "You already drew. Play that card or pass";
    if (((e.vulnerableId = null), e.pendingDraw > 0))
      return (
        Y(e, n, e.pendingDraw, !0),
        (e.pendingDraw = 0),
        (e.challenge = null),
        (e.turn = C(e, n, 1)),
        null
      );
    if (e.rules.roulette?.type === "launcher") {
      let x;
      [x, e.rngState] = ln(e.rngState);
      let k = [0, 1, 1, 2, 2, 3, 4][Math.floor(x * 7)];
      k && Y(e, n, k, !1);
      e.events.push({ kind: "roulette", playerId: e.players[n].id, effect: "launch", count: k });
      e.turn = C(e, n, 1);
      return null;
    }
    let t;
    for (
      let a = 0;
      a < 108 &&
      (([t] = Y(e, n, 1, !1)),
      !(!t || !e.rules.drawUntilPlayable || V(e, e.players[n].id, t)));
      a++
    );
    return (
      t && V(e, e.players[n].id, t)
        ? (e.drawnCardId = t.id)
        : (e.turn = C(e, n, 1)),
      null
    );
  }
  function cn(e, n) {
    let t = e.challenge;
    if (!t || n !== e.turn || e.pendingDraw === 0)
      return "There is no +4 to challenge";
    let a = e.players.findIndex((r) => r.id === t.offenderId);
    return (
      (e.challenge = null),
      (e.vulnerableId = null),
      e.events.push({
        kind: "challenge",
        playerId: e.players[n].id,
        targetId: t.offenderId,
        success: t.guilty,
      }),
      t.guilty
        ? (Y(e, a, e.pendingDraw, !0), (e.pendingDraw = 0))
        : (Y(e, n, e.pendingDraw + 2, !0),
          (e.pendingDraw = 0),
          (e.turn = C(e, n, 1))),
      null
    );
  }
  function un(e, n) {
    return n !== e.turn
      ? "It's not your turn"
      : e.drawnCardId
        ? ((e.vulnerableId = null),
          (e.drawnCardId = null),
          e.events.push({ kind: "pass", playerId: e.players[n].id }),
          (e.turn = C(e, n, 1)),
          null)
        : "Draw a card before passing";
  }
  function pn(e, n) {
    let t = e.players[n];
    if (t.out) return "You're already out";
    return t.hand.length > 2
      ? "Call it at 2 cards or fewer"
      : t.calledLastCard
        ? "You already called it"
        : t.hand.length === 2 && n !== e.turn
          ? "Call it on your turn"
          : ((t.calledLastCard = !0),
            e.vulnerableId === t.id && (e.vulnerableId = null),
            e.events.push({ kind: "callLastCard", playerId: t.id }),
            null);
  }
  var hn = 2;
  function fn(e, n, t) {
    let a = e.players.findIndex((r) => r.id === t);
    return a < 0
      ? "That player is not in this game"
      : a === n
        ? "You can't catch yourself"
        : e.vulnerableId !== t
          ? "Too late, or they called it"
          : ((e.vulnerableId = null),
            Y(e, a, hn, !0),
            e.events.push({
              kind: "caught",
              playerId: e.players[n].id,
              targetId: t,
            }),
            null);
  }
  function yn(e) {
    if (e.challenge) return;
    let n = e.players[e.turn];
    n.hand.some((t) => V(e, n.id, t)) ||
      (Y(e, e.turn, e.pendingDraw, !0),
      (e.pendingDraw = 0),
      (e.turn = C(e, e.turn, 1)));
  }
  function C(e, n, t) {
    let a = e.players.length,
      i = n;
    for (let s = 0; s < t; s++) {
      let g = 0;
      do i = (((i + e.direction) % a) + a) % a;
      while (e.players[i].out && ++g < a);
    }
    return i;
  }
  var activeCount = (e) => e.players.filter((x) => !x.out).length;
  // a player who empties their hand finishes in the next place; the round ends when one is left holding cards
  function finishPlayer(e, i) {
    let pl = e.players[i];
    if (pl.out) return e.phase === "finished";
    e.places = e.places || [];
    e.places.push(pl.id);
    pl.out = e.places.length;
    pl.calledLastCard = !1;
    pl.skipNext = !1;
    e.vulnerableId === pl.id && (e.vulnerableId = null);
    e.winnerId = e.winnerId || pl.id;
    e.events.push({ kind: "win", playerId: pl.id, place: pl.out });
    let left = e.players.filter((x) => !x.out);
    if (left.length <= 1) {
      e.phase = "finished";
      e.pendingDraw = 0;
      e.challenge = null;
      e.loserId = left[0]?.id ?? null;
      left[0] && e.events.push({ kind: "lose", playerId: left[0].id });
      return !0;
    }
    return !1;
  }
  function Y(e, n, t, a) {
    let r = e.players[n],
      l = [];
    for (let o = 0; o < t; o++) {
      e.drawPile.length === 0 && mn(e);
      let i = e.drawPile.pop();
      if (!i) break;
      l.push(i);
    }
    return (
      r.hand.push(...l),
      (r.calledLastCard = !1),
      e.vulnerableId === r.id && (e.vulnerableId = null),
      e.events.push({
        kind: "draw",
        playerId: r.id,
        count: l.length,
        penalty: a,
      }),
      l
    );
  }
  function mn(e) {
    if (e.discardPile.length <= 1) return;
    let n = e.discardPile.pop(),
      [t, a] = ge(e.discardPile, e.rngState);
    ((e.drawPile = t),
      (e.discardPile = [n]),
      (e.rngState = a),
      e.events.push({ kind: "reshuffle" }));
  }
  function gn(e, n) {
    for (let t = e.length - 1; t >= 0; t--) if (n(e[t])) return t;
    return -1;
  }
  function z(e, n, t = 20) {
    let a = e.players.find((i) => i.id === n);
    if (!a) throw new Error("Unknown player");
    let r = e.players[e.turn],
      l = r.id === n,
      o = Ye(e, n);
    return {
      you: { id: a.id, hand: a.hand.slice(), calledLastCard: a.calledLastCard },
      players: e.players.map((i) => ({
        id: i.id,
        name: i.name,
        cardCount: i.hand.length,
        calledLastCard: i.calledLastCard,
        out: i.out || 0,
      })),
      topCard: W(e),
      currentColor: e.currentColor,
      turnPlayerId: r.id,
      isYourTurn: l,
      direction: e.direction,
      pendingDraw: e.pendingDraw,
      drawPileCount: e.drawPile.length,
      drawnCardId: l ? e.drawnCardId : null,
      playableCardIds: o,
      companions: Object.fromEntries(
        a.hand
          .map((i) => [i.id, je(e, n, i.id)])
          .filter(([, i]) => i.length > 0),
      ),
      challenge:
        l && e.challenge && e.pendingDraw > 0
          ? { offenderId: e.challenge.offenderId, color: e.challenge.color }
          : null,
      vulnerableId: e.vulnerableId,
      phase: e.phase,
      winnerId: e.winnerId,
      loserId: e.loserId ?? null,
      places: e.places || [],
      rules: e.rules,
      recentEvents: e.events.slice(-t),
      version: e.version,
    };
  }
  function Be(e, n = {}) {
    let t = n.random ?? Math.random,
      a = e.you.id;
    if (e.phase !== "playing") return null;
    if (e.vulnerableId && e.vulnerableId !== a && t() < (n.catchChance ?? 0.6))
      return { type: "catch", playerId: a, targetId: e.vulnerableId };
    let r = e.you.hand;
    if (!e.isYourTurn) {
      let d = r.find((f) => e.playableCardIds.includes(f.id));
      return d && t() < (n.jumpInChance ?? 0.5) ? Ne(e, d, !1) : null;
    }
    if (
      r.length === 2 &&
      !e.you.calledLastCard &&
      e.playableCardIds.length > 0 &&
      t() < (n.callChance ?? 0.85)
    )
      return { type: "callLastCard", playerId: a };
    if (e.challenge && t() < (n.challengeChance ?? 0.3))
      return { type: "challenge", playerId: a };
    let l = r.filter((d) => e.playableCardIds.includes(d.id));
    if (l.length === 0)
      return e.drawnCardId
        ? { type: "pass", playerId: a }
        : { type: "draw", playerId: a };
    let o = (d) =>
        d.value === "wild10"
          ? -3
          : d.value === "wild4"
          ? -2
          : $(d)
            ? -1
            : /^[0-9]$/.test(d.value)
              ? Number(d.value) / 10
              : 2,
      i = l.slice().sort((d, f) => o(f) - o(d))[0],
      s = l.find((d) => d.value === "wild4");
    return (
      e.rules.challengeWild4 &&
        s &&
        i !== s &&
        e.pendingDraw === 0 &&
        t() < (n.bluffChance ?? 0.2) &&
        (i = s),
      Ne(e, i, t() < (n.callChance ?? 0.85))
    );
  }
  function Ne(e, n, t) {
    let a = e.you.id,
      r = { type: "play", playerId: a, cardId: n.id },
      l = e.companions[n.id] ?? [];
    if (
      (e.rules.noPowerFinish &&
        !/^[0-9]$/.test(n.value) &&
        l.length + 1 === e.you.hand.length &&
        (l = l.slice(0, -1)),
      l.length && (r.extraCardIds = l),
      e.you.hand.length - 1 - l.length === 1 && t && (r.uno = !0),
      $(n) && (r.color = wn(e.you.hand.filter((o) => o.id !== n.id))),
      (e.rules.sevenZero && n.value === "7") || n.value === "wildSwap" || n.value === "wildBlank")
    ) {
      let o = e.players.filter((i) => i.id !== a && !i.out).sort((i, s) => i.cardCount - s.cardCount)[0].id;
      n.value === "wildBlank" ? (r.blank = { target: o, effect: "draw4" }) : (r.swapWith = o);
    }
    return r;
  }
  function wn(e) {
    let n = new Map(D.map((t) => [t, 0]));
    for (let t of e) t.color && n.set(t.color, n.get(t.color) + 1);
    return [...n.entries()].sort((t, a) => a[1] - t[1])[0][0];
  }
module.exports = { He, Ge, z, Be, V, W };
