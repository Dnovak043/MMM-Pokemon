/* MIT license. Battles as seen on screen.
 *
 * pk-mechanics.js decides what happens in a turn and returns a list of events;
 * `Battle` here plays those events back over time on two sprites: the action a
 * move is drawn with, lunges and projectiles, hit flashes, status conditions,
 * stat arrows, weather, hiding during Fly or Dig, Transform, fainting.
 * `Fx` is a tiny particle model the renderer draws as coloured squares.
 * `Arena` owns the sprites and starts a battle when two free ones meet. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./pk-sprites.js"), require("./pk-engine.js"), require("./pk-mechanics.js"));
  else root.PkBattle = factory(root.PkSprites, root.PkEngine, root.PkMechanics);
})(typeof globalThis !== "undefined" ? globalThis : this, function (Sprites, Engine, Mechanics) {
  "use strict";
  const TYPE_COLORS = {
    normal: "#c8c8a8", fighting: "#d0503c", flying: "#a8b8f8", poison: "#b060c8", ground: "#e0c068", rock: "#b8a038", bug: "#a8b820", ghost: "#8068b0",
    steel: "#c0c0d8", fire: "#f88030", water: "#5898f8", grass: "#70c850", electric: "#f8d030", psychic: "#f85888", ice: "#98d8d8", dragon: "#7038f8",
    dark: "#786058", fairy: "#f0a0c8"
  };
  const AILMENT_COLORS = { brn: "#f86020", psn: "#a040c0", tox: "#a040c0", par: "#f8d030", frz: "#90e0f8", slp: "#b0b0c8" };
  const AILMENT_TAGS = { brn: "BRN", psn: "PSN", tox: "PSN", par: "PAR", frz: "FRZ", slp: "SLP" };
  const WEATHER_COLORS = { rain: "#78a8f8", sun: "#f8e060", sand: "#d8c078", snow: "#f0f8ff" };
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  /* ---- Particles ---------------------------------------------------------- */
  class Fx {
    constructor(limit = 180, random = Math.random) { this.particles = []; this.limit = limit; this.random = random; }
    add(p) {
      if (this.particles.length >= this.limit) return null;
      const particle = { x: 0, y: 0, vx: 0, vy: 0, ay: 0, life: 0.5, age: 0, delay: 0, size: 3, grow: 0, color: "#fff", ring: false, text: null, ...p };
      this.particles.push(particle);
      return particle;
    }
    step(dt) {
      for (const p of this.particles) {
        if (p.delay > 0) { p.delay -= dt; continue; }
        p.age += dt; p.vy += p.ay * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.size = Math.max(0, p.size + p.grow * dt);
      }
      this.particles = this.particles.filter((p) => p.age < p.life);
    }
    visible() { return this.particles.filter((p) => p.delay <= 0); }
    spread(n) { return (this.random() - 0.5) * 2 * n; }
    /* Fragments flying outward from a point. */
    burst(x, y, color, n, speed = 70, size = 3, delay = 0) {
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2 + this.spread(0.4), v = speed * (0.5 + this.random() * 0.7);
        this.add({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v, life: 0.3 + this.random() * 0.15, size, color, grow: -size * 1.5, delay });
      }
    }
    /* `n` particles travelling from one point to another, the first arriving after `duration` seconds. */
    stream(from, to, color, { n = 4, duration = 0.3, stagger = 0.04, jitter = 3, size = 4, delay = 0 } = {}) {
      const time = Math.max(0.08, duration);
      for (let i = 0; i < n; i++) {
        const ox = this.spread(jitter), oy = this.spread(jitter);
        this.add({ x: from.x + ox, y: from.y + oy, vx: (to.x - from.x) / time, vy: (to.y - from.y) / time, life: time, size, color, delay: delay + i * stagger });
      }
    }
    /* A jagged flash along a line. */
    bolt(from, to, color, delay = 0, size = 3) {
      const steps = Math.max(4, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / (size * 3)));
      const nx = -(to.y - from.y), ny = to.x - from.x, len = Math.hypot(nx, ny) || 1;
      for (let i = 0; i <= steps; i++) {
        const k = i / steps, off = i === 0 || i === steps ? 0 : this.spread(size * 2.5);
        this.add({ x: from.x + (to.x - from.x) * k + nx / len * off, y: from.y + (to.y - from.y) * k + ny / len * off, life: 0.16, size, color, delay: delay + this.random() * 0.03 });
      }
    }
    /* Expanding outline, for sound and shields. */
    ring(x, y, color, { size = 6, grow = 80, life = 0.4, delay = 0, vx = 0, vy = 0 } = {}) { this.add({ x, y, vx, vy, color, size, grow, life, delay, ring: true }); }
    /* Things drifting up (or down, with negative `speed`) around a point. */
    rise(x, y, color, { n = 4, speed = 40, width = 10, size = 3, text = null, life = 0.6, stagger = 0.07 } = {}) {
      for (let i = 0; i < n; i++) this.add({ x: x + this.spread(width), y: y + this.spread(4), vy: -speed * (0.8 + this.random() * 0.4), life, size, color, text, delay: i * stagger });
    }
  }

  /* ---- How a move looks ---------------------------------------------------- */
  /* The broad visual family of a move. */
  function styleOf(move) {
    const id = move.id, has = (flag) => move.flags.includes(flag);
    if (move.category === "status") return ["self", "allySide", "allyTeam", "adjacentAllyOrSelf", "allies", "all"].includes(move.target) ? "self" : has("sound") ? "wave" : "aim";
    if (/quake|magnitude|bulldoze|tremor|fissure|earthpower|landswrath|precipiceblades|stompingtantrum|highhorsepower|thousand/.test(id)) return "quake";
    if (has("contact")) return "contact";
    if (has("sound")) return "wave";
    if (move.type === "electric") return "bolt";
    if (/beam|ray|cannon|pump|blast|pulse|thrower|laser|breath|gun|burst|storm|wind|hurricane|blizzard|surf|flood|stream|overheat|spout|eruption|hydro|fire|flame|water|psychic|wave/.test(id)) return "beam";
    return "shot";
  }
  const ACTIONS = [
    [/punch|hammerarm|uppercut|thrust|poundy?|jab/, ["Punch", "Uppercut", "Jab", "Strike"]],
    [/bite|fang|crunch|jaw/, ["Bite"]],
    [/kick|blazekick|stomp/, ["Kick", "Stomp"]],
    [/furyswipes|furyattack|barrage|cometpunch|doubleslap|armthrust|bulletseed|pinmissile|rockblast|iciclespear|multi|populationbomb|tailslap/, ["MultiScratch", "MultiStrike", "Double"]],
    [/slash|cut$|claw|scratch|slice|blade|razor|cleave|scissor|furycutter|leafage|axe/, ["Slice", "Scratch", "Swing", "Chop"]],
    [/tail/, ["TailWhip", "Swing"]],
    [/slap/, ["Slap", "Strike"]],
    [/chop|brickbreak/, ["Chop", "Strike"]],
    [/lick/, ["Lick"]],
    [/slam|press|takedown|doubleedge|tackle|headbutt|ram|bash|crash|giga/, ["Slam", "Attack"]],
    [/spin|roll|gyro|twirl|whirl|twister|vortex|drill/, ["Rotate", "Twirl"]],
    [/dance|charm|attract|captivate|flatter|swagger|kiss/, ["Dance", "Twirl", "Appeal"]],
    [/^sing$|song$|voice|aria|lullaby|bell$/, ["Sing", "Sound"]],
    [/roar|growl|howl|snarl|uproar|screech|supersonic|chatter|boom|clang|overdrive|snore|metalsound|round|echo/, ["Rumble", "Sound", "Sing"]],
    [/gust|whirlwind|hurricane|tailwind|defog|airslash|aircutter|roost|featherdance|wingattack|fly|bravebird|aeroblast/, ["FlapAround", "Hover"]],
    [/gas|smog|smokescreen|haze|mist|spore|powder|sludge|toxic|acid|venom|belch/, ["Gas", "Emit"]],
    [/thunder|shock|spark|volt|discharge|charge$|electr|zap/, ["Shock", "Emit"]],
    [/withdraw|harden|protect|detect|defense|barrier|endure|guard|armor|shelter|shield|bunker|obstruct|bulwark/, ["Withdraw"]],
    [/yawn/, ["Yawn", "DeepBreath"]],
    [/rest$|sleeptalk/, ["Sleep", "Laying"]],
    [/hop|bounce|splash|jump|celebrate|happyhour/, ["Hop"]],
    [/^dig$|dive/, ["DigIn", "Sink", "Hop"]],
    [/swallow|stuffcheeks|pluck|bugbite|leech|absorb|drain|eat/, ["Eat", "Bite"]],
    [/bulkup|growth|stockpile|workup|calmmind|meditate|focusenergy|nastyplot|swordsdance|dragondance|agility|amnesia|cosmicpower|coil|shellsmash|quiverdance/, ["Swell", "Charge", "Pose", "DeepBreath"]],
    [/bellydrum|rearup|rage|thrash|outrage|tantrum|shake/, ["RearUp", "Shake"]],
    [/quickattack|extremespeed|aquajet|iceshard|shadowsneak|accelerock|suckerpunch|feint|fakeout|firstimpression|jetpunch/, ["QuickStrike"]],
    [/teleport|transform|substitute|minimize|doubleteam/, ["Double", "Charge", "Rotate"]]
  ];
  const FALLBACK = {
    contact: ["Attack", "Strike", "Slam", "Jab", "Scratch", "Bite", "Kick"], quake: ["Stomp", "Slam", "Attack"],
    shot: ["Shoot", "SpAttack", "Emit", "Swing", "Charge", "Attack"], beam: ["Shoot", "SpAttack", "Emit", "Charge", "Attack"],
    bolt: ["Shock", "Shoot", "SpAttack", "Emit", "Charge", "Attack"], wave: ["Sound", "Sing", "Rumble", "Shoot", "Charge", "Attack"],
    self: ["Charge", "Pose", "Swell", "DeepBreath", "Nod", "Rotate"], aim: ["Shoot", "Emit", "Appeal", "Charge", "Nod", "Attack"]
  };
  /* The action in this sprite's own artwork that best suits a move. */
  function actionFor(move, sprites, style = styleOf(move)) {
    const names = [];
    for (const [pattern, list] of ACTIONS) if (pattern.test(move.id)) names.push(...list);
    if (move.flags.includes("punch")) names.push("Punch", "Jab", "Strike");
    if (move.flags.includes("bite")) names.push("Bite");
    if (move.flags.includes("slicing")) names.push("Slice", "Scratch", "Swing");
    if (move.flags.includes("dance")) names.push("Dance", "Twirl");
    names.push(...FALLBACK[style], ...(sprites.roles.attack || []));
    return names.find((name) => sprites.anims[name]) || sprites.roles.idle;
  }

  /* ---- One battle ----------------------------------------------------------- */
  class Battle {
    constructor(a, b, arena) {
      this.arena = arena; this.pair = [a, b]; this.data = arena.data; this.fx = arena.fx; this.random = arena.random;
      const build = (mon) => Mechanics.createMon(mon.species, mon.level, mon.fixedMoves || Mechanics.pickMoves(mon.species, this.data, this.random), this.data);
      this.fight = new Mechanics.Fight(build(a), build(b), this.data, this.random);
      this.pair.forEach((mon, i) => { mon.maxHp = this.fight.mons[i].maxHp; mon.hp = mon.maxHp; mon.ailment = null; mon.marks = {}; });
      a.engage(b); b.engage(a);
      this.unit = Math.max(1, Math.min(a.size, b.size) / 32); // Particle scale.
      this.clock = 0; this.waitUntil = 0.9; this.queue = []; this.tweens = []; this.restores = []; this.timers = [0, 0, 0];
      this.text = `${a.name} and ${b.name} face off!`; this.weather = null; this.terrain = null;
      this.finished = false; this.winner = null; this.fled = null; this.original = new Map(); this.downed = new Set();
      this.phase = "battle"; this.turns = 0; this.used = [];
    }
    /* ---- helpers ---- */
    tween(seconds, apply) { this.tweens.push({ start: this.clock, len: Math.max(0.01, seconds), apply }); }
    later(seconds, fn) { this.restores.push({ at: this.clock + seconds, fn }); }
    head(mon) { return { x: mon.x + mon.size / 2, y: mon.y - mon.size * 0.15 }; }
    /* The pose a fighter rests in between actions, and the standing look of its conditions. */
    settle(mon) {
      if (mon.state !== "battle") return;
      if (mon.ailment === "slp") mon.pose(mon.sprites.roles.sleep);
      else mon.pose(undefined, mon.ailment === "frz"); // A frozen sprite holds still.
    }
    refresh(mon) {
      const marks = mon.marks, view = mon.view;
      view.shield = Boolean(marks.protect);
      view.scale = marks.minimize ? 0.6 : 1;
      view.glow = AILMENT_COLORS[mon.ailment] || (marks.curse ? "#6030a0" : marks.leechseed ? "#50b040" : marks.confusion ? "#f0e060" : null);
      if (!marks.hidden) view.opacity = marks.substitute ? 0.55 : 1;
    }
    shake(mon, seconds = 0.3, amount = 2) {
      const reach = amount * this.unit;
      this.tween(seconds, (k) => { mon.view.dx = k < 1 ? Math.sin(k * Math.PI * 8) * reach * (1 - k) : 0; });
    }
    flash(mon) { this.tween(0.24, (k) => { mon.view.flash = k < 1 && Math.floor(k * 4) % 2 === 0; }); }
    /* ---- playback ---- */
    step(dt) {
      for (const mon of this.pair) {
        if (mon.state !== "battle" && !(mon.state === "faint" && this.downed.has(mon))) return this.end(); // Taken away by a command or a sliding module.
      }
      this.clock += dt * this.arena.options.battleSpeed;
      this.tweens = this.tweens.filter((t) => { const k = clamp((this.clock - t.start) / t.len, 0, 1); t.apply(k); return k < 1; });
      this.restores = this.restores.filter((r) => { if (this.clock < r.at) return true; r.fn(); return false; });
      this.ambient(dt);
      while (this.clock >= this.waitUntil) {
        if (!this.queue.length) {
          if (this.finished) return this.end();
          this.queue = this.fight.round().slice(); this.turns = this.fight.turn;
        }
        const event = this.queue.shift();
        this.waitUntil = this.clock + this.play(event, this.queue[0]);
      }
      return true;
    }
    play(ev, next) {
      const [a, b] = this.pair, fx = this.fx, u = this.unit;
      const who = ev.who === undefined || ev.who === null ? null : this.pair[ev.who];
      const target = ev.target === undefined || ev.target === null ? null : this.pair[ev.target];
      switch (ev.e) {
        case "act": return this.arena.options.moveDelay; // The pause before each Pokémon's move.
        case "text": this.text = ev.text; return !next ? 0.7 : ["use", "charge"].includes(next.e) ? 0.3 : next.e === "text" ? 0.85 : 0.5;
        case "use": return this.playUse(who, target, this.data.moves[ev.move]);
        case "charge": {
          const move = this.data.moves[ev.move];
          who.pose(["DigIn", "Charge", "Swell", "DeepBreath", "Pose"].find((name) => (name !== "DigIn" || ev.hide === "down") && who.sprites.anims[name]));
          fx.rise(who.centre().x, who.y + who.size, TYPE_COLORS[move.type], { n: 6, width: who.size / 3, size: 3 * u });
          if (ev.hide) {
            who.marks.hidden = ev.hide;
            const dy = ev.hide === "up" ? -who.size * 3 : ev.hide === "down" ? who.size * 0.45 : 0;
            this.tween(0.45, (k) => { who.view.dy = dy * k; who.view.opacity = 1 - k; });
          }
          return 0.7;
        }
        case "reveal": {
          if (!who.marks.hidden) return 0;
          delete who.marks.hidden;
          const from = who.view.dy, to = who.marks.substitute ? 0.55 : 1;
          this.tween(0.2, (k) => { who.view.dy = from * (1 - k); who.view.opacity = to * k; });
          return 0.2;
        }
        case "hit": {
          const move = this.data.moves[ev.move], color = TYPE_COLORS[move.type] || "#fff", at = target.centre();
          target.hp = ev.hp;
          if (ev.sub) { fx.burst(at.x, at.y, "#a8d8a8", 5, 50 * u, 3 * u); return 0.35; }
          fx.burst(at.x, at.y, color, ev.eff > 1 ? 14 : ev.eff < 1 ? 5 : 8, (ev.eff > 1 ? 110 : 75) * u, (ev.crit ? 5 : 3.5) * u);
          if (ev.crit) fx.ring(at.x, at.y, "#fff", { size: 4 * u, grow: 140 * u, life: 0.25 });
          this.flash(target); this.shake(target, 0.3, ev.eff > 1 ? 3 : 2);
          const hurt = target.sprites.roles.hurt;
          if (hurt && target.sprites.anims[hurt] && target.state === "battle" && ev.dmg > 0) { target.pose(hurt); this.later(0.42, () => this.settle(target)); }
          return next && next.e === "hit" ? 0.28 : 0.5;
        }
        case "miss": {
          const side = target.centre().x >= who.centre().x ? 1 : -1;
          this.tween(0.4, (k) => { target.view.dx = Math.sin(k * Math.PI) * target.size * 0.35 * side; });
          return 0.45;
        }
        case "block": { const at = target.centre(); fx.ring(at.x, at.y, "#a0f0c0", { size: target.size * 0.7, grow: 40 * u, life: 0.35 }); return 0.4; }
        case "hp": return this.playHp(target, ev);
        case "status": {
          target.ailment = ev.status; this.refresh(target); this.settle(target);
          const at = target.centre(); fx.burst(at.x, at.y, AILMENT_COLORS[ev.status] || "#f8f8f8", 8, 55 * u, 3 * u);
          return 0.45;
        }
        case "volatile": {
          if (ev.on) target.marks[ev.name] = true; else delete target.marks[ev.name];
          this.refresh(target);
          const at = target.centre();
          if (ev.name === "protect" && ev.on) fx.ring(at.x, at.y, "#a0f0c0", { size: target.size * 0.5, grow: 50 * u, life: 0.4 });
          else if (ev.name === "substitute") fx.burst(at.x, at.y, "#a8d8a8", 8, 60 * u, 3 * u);
          else if (ev.on) fx.rise(at.x, at.y, { leechseed: "#50b040", curse: "#6030a0", confusion: "#f0e060", attract: "#f870a0", taunt: "#e04040", yawn: "#c0c0e0" }[ev.name] || "#d0d0d0", { n: 4, size: 3 * u, width: target.size / 3 });
          return 0.3;
        }
        case "boost": {
          const up = ev.n > 0, at = target.centre();
          fx.rise(at.x, up ? target.y + target.size : target.y, up ? "#f8a030" : "#5080f8", { n: 3 + Math.abs(ev.n), speed: (up ? 55 : -55) * u, width: target.size / 3, size: 4 * u, text: up ? "▲" : "▼", life: 0.55 });
          return 0.4;
        }
        case "weather": this.weather = ev.weather; return 0.3;
        case "terrain": this.terrain = ev.terrain; return 0.3;
        case "field": case "side": return 0.15;
        case "types": { const at = target.centre(); fx.burst(at.x, at.y, TYPE_COLORS[ev.types[0]] || "#fff", 10, 60 * u, 3 * u); return 0.3; }
        case "transform": {
          if (!this.original.has(who)) this.original.set(who, who.sprites);
          const at = who.centre(); fx.burst(at.x, at.y, "#f0f0f0", 12, 80 * u, 4 * u); this.flash(who);
          who.setSprites(target.sprites); who.face(target);
          return 0.6;
        }
        case "faint": {
          target.hp = 0; target.ailment = null; target.marks = {}; this.refresh(target); target.view.dy = 0; target.view.dx = 0;
          this.downed.add(target); target.faint(this.arena.options.faintTime);
          if (!target.sprites.anims[target.sprites.roles.faint]) this.tween(0.6, (k) => { target.view.opacity = 1 - 0.5 * k; });
          return 1;
        }
        case "end": {
          this.finished = true; this.reason = ev.reason;
          this.winner = ev.winner === null ? null : this.pair[ev.winner];
          if (ev.reason === "faint" && this.winner && this.winner.state === "battle") {
            const victory = this.winner.sprites.anims[this.winner.sprites.roles.victory];
            this.winner.pose(this.winner.sprites.roles.victory);
            return Math.max(1.2, victory ? Sprites.total(victory) : 0);
          }
          if (ev.reason === "flee" && who) {
            this.fled = who;
            const at = who.centre(); fx.burst(at.x, at.y, "#f0f0f0", 10, 90 * u, 3 * u);
            this.tween(0.35, (k) => { who.view.opacity = 1 - k; });
            return 0.7;
          }
          for (const mon of [a, b]) this.settle(mon);
          return 0.9;
        }
        default: return 0;
      }
    }
    /* A move being used: the user's action plus whatever travels to the target. */
    playUse(user, target, move) {
      const fx = this.fx, u = this.unit, style = styleOf(move), color = TYPE_COLORS[move.type] || "#fff";
      if (style !== "self") user.face(target);
      const action = actionFor(move, user.sprites, style);
      user.pose(action);
      const anim = user.sprites.anims[user.anim], length = Math.max(0.45, Sprites.total(anim));
      const hit = clamp(anim.hit === undefined ? length * 0.5 : anim.hit, 0.15, length);
      const from = user.centre(), to = target.centre(), gap = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      this.used.push(move.id);
      if (style === "contact") {
        // Close the distance so the blow visibly lands, then step back.
        const reach = Math.max(0, gap - (user.size + target.size) * 0.35), peak = hit / length;
        const vx = (to.x - from.x) / gap * reach, vy = (to.y - from.y) / gap * reach;
        this.tween(length, (k) => { const s = k >= 1 ? 0 : k < peak ? k / peak : 1 - (k - peak) / (1 - peak); user.view.dx = vx * s; user.view.dy = vy * s; });
      } else if (style === "shot") fx.stream(from, to, color, { n: 3, duration: hit, stagger: 0.05, size: 5 * u, jitter: 2 * u });
      else if (style === "beam") fx.stream(from, to, color, { n: 16, duration: Math.min(hit, 0.25), stagger: Math.max(0.012, (length - 0.1) / 16), size: 4 * u, jitter: 3 * u });
      else if (style === "bolt") { fx.bolt(from, to, color, hit, 3 * u); fx.bolt(from, to, "#fff", hit + 0.06, 2 * u); }
      else if (style === "wave") for (let i = 0; i < 3; i++) fx.ring(from.x, from.y, color, { size: 5 * u, grow: 50 * u, life: hit + 0.1, delay: i * 0.09, vx: (to.x - from.x) / (hit + 0.1), vy: (to.y - from.y) / (hit + 0.1) });
      else if (style === "quake") {
        this.later(hit, () => { for (const mon of this.pair) this.shake(mon, 0.45, 3); });
        fx.burst(to.x, target.y + target.size, color, 10, 70 * u, 3 * u, hit);
      } else if (style === "aim") fx.stream(from, to, color, { n: 5, duration: hit, stagger: 0.06, size: 3 * u, jitter: 5 * u });
      else fx.rise(from.x, user.y + user.size, color, { n: 8, speed: 60 * u, width: user.size / 2.5, size: 3 * u });
      this.later(length, () => { if (user.state === "battle" && user.anim === action) this.settle(user); });
      return hit + 0.02;
    }
    playHp(target, ev) {
      const fx = this.fx, u = this.unit, at = target.centre(), other = this.pair.find((mon) => mon !== target);
      target.hp = ev.hp;
      const flames = (color) => fx.rise(at.x, at.y, color, { n: 6, speed: 45 * u, width: target.size / 3, size: 3 * u });
      switch (ev.reason) {
        case "heal": fx.rise(at.x, target.y + target.size, "#60e070", { n: 6, speed: 50 * u, width: target.size / 3, size: 4 * u, text: "+" }); break;
        case "drain": fx.stream(other.centre(), at, "#60e070", { n: 6, duration: 0.3, stagger: 0.04, size: 3 * u, jitter: 4 * u }); break;
        case "leech": fx.stream(at, other.centre(), "#50b040", { n: 6, duration: 0.3, stagger: 0.04, size: 3 * u, jitter: 4 * u }); this.flash(target); break;
        case "brn": flames("#f86020"); this.flash(target); break;
        case "psn": flames("#a040c0"); this.flash(target); break;
        case "weather": flames(WEATHER_COLORS[this.weather] || "#d8c078"); this.shake(target, 0.25, 1); break;
        case "curse": flames("#6030a0"); this.flash(target); break;
        default: this.shake(target, 0.3, 2); this.flash(target); // recoil, cost, confusion, trap
      }
      return 0.45;
    }
    /* Conditions that keep showing between actions. */
    ambient(dt) {
      const fx = this.fx, u = this.unit;
      this.pair.forEach((mon, i) => {
        if (mon.state !== "battle" || mon.marks.hidden) return;
        if ((this.timers[i] -= dt) > 0) return;
        const head = this.head(mon), at = mon.centre();
        this.timers[i] = 0.3;
        if (mon.ailment === "brn") fx.add({ x: at.x + fx.spread(mon.size / 4), y: at.y, vy: -30 * u, life: 0.5, size: 3 * u, grow: -4 * u, color: fx.random() < 0.5 ? "#f86020" : "#f8c030" });
        else if (mon.ailment === "psn" || mon.ailment === "tox") fx.add({ x: at.x + fx.spread(mon.size / 4), y: head.y + mon.size * 0.2, vy: -18 * u, life: 0.7, size: 3 * u, color: "#a040c0", ring: true });
        else if (mon.ailment === "par") { fx.add({ x: at.x + fx.spread(mon.size / 3), y: at.y + fx.spread(mon.size / 3), life: 0.12, size: 3 * u, color: "#f8e040" }); mon.view.dx = fx.spread(u); }
        else if (mon.ailment === "slp") { fx.add({ x: head.x + mon.size * 0.2, y: head.y, vx: 8 * u, vy: -16 * u, life: 1, size: 7 * u, color: "#e8e8f8", text: "z" }); this.timers[i] = 0.8; }
        else if (mon.ailment === "frz") fx.add({ x: at.x + fx.spread(mon.size / 3), y: at.y + fx.spread(mon.size / 3), life: 0.3, size: 2 * u, color: "#e0f8ff" });
        if (mon.marks.confusion) { const angle = this.clock * 6; fx.add({ x: head.x + Math.cos(angle) * mon.size * 0.3, y: head.y + Math.sin(angle) * mon.size * 0.1, life: 0.3, size: 5 * u, color: "#f8e040", text: "✦" }); }
        if (mon.marks.leechseed && fx.random() < 0.3) fx.add({ x: at.x + fx.spread(mon.size / 3), y: at.y, vy: -12 * u, life: 0.5, size: 2 * u, color: "#50b040" });
        if (mon.marks.attract && fx.random() < 0.3) fx.add({ x: head.x, y: head.y, vy: -14 * u, life: 0.7, size: 6 * u, color: "#f870a0", text: "♥" });
      });
      if (!this.weather && !this.terrain) return;
      if ((this.timers[2] -= dt) > 0) return;
      this.timers[2] = 0.05;
      const [a, b] = this.pair, pad = Math.max(a.size, b.size);
      const left = Math.min(a.x, b.x) - pad, right = Math.max(a.x + a.size, b.x + b.size) + pad, top = Math.min(a.y, b.y) - pad, bottom = Math.max(a.y + a.size, b.y + b.size) + pad / 2;
      const x = left + fx.random() * (right - left);
      if (this.weather === "rain") fx.add({ x, y: top, vx: -30 * u, vy: 260 * u, life: (bottom - top) / (260 * u), size: 2 * u, color: WEATHER_COLORS.rain });
      else if (this.weather === "snow") fx.add({ x, y: top, vx: fx.spread(10 * u), vy: 50 * u, life: (bottom - top) / (50 * u), size: 2.5 * u, color: WEATHER_COLORS.snow });
      else if (this.weather === "sand") fx.add({ x: left, y: top + fx.random() * (bottom - top), vx: 220 * u, vy: fx.spread(20 * u), life: (right - left) / (220 * u), size: 2 * u, color: WEATHER_COLORS.sand });
      else if (this.weather === "sun" && fx.random() < 0.4) fx.add({ x, y: top + fx.random() * (bottom - top) * 0.6, life: 0.35, size: 3 * u, grow: 6 * u, color: WEATHER_COLORS.sun });
      if (this.terrain && fx.random() < 0.5) fx.add({ x, y: bottom - fx.random() * pad / 2, vy: -10 * u, life: 0.5, size: 2 * u, color: { electric: "#f8d030", grassy: "#70c850", misty: "#f0a0c8", psychic: "#f85888" }[this.terrain] });
    }
    end() {
      for (const mon of this.pair) {
        if (this.original.has(mon)) mon.setSprites(this.original.get(mon));
        const fighting = mon.state === "battle";
        mon.release(this.arena.options.battleCooldown);
        if (!fighting) continue;
        if (mon === this.fled) { const spot = mon.roam(); if (spot) { mon.x = spot.x; mon.y = spot.y; } mon.rest(); } // Reappears somewhere else.
        else mon.wander(); // Walk it off.
      }
      this.phase = "over"; this.text = "";
      return false;
    }
  }

  /* ---- Everyone on screen ---------------------------------------------------- */
  class Arena {
    constructor(mons, options = {}, random = Math.random) {
      this.cats = mons; this.random = random; this.battles = []; this.count = 0; this.data = options.data || null;
      const d = Engine.defaults;
      this.options = { battles: d.battles, battleRange: d.battleRange, battleCooldown: d.battleCooldown, faintTime: d.faintTime, battleSpeed: d.battleSpeed, moveDelay: d.moveDelay, ...options };
      this.fx = new Fx(180, random);
      for (const mon of mons) this.admit(mon);
    }
    get enabled() { return Boolean(this.options.battles && this.data && this.cats.length > 1); }
    /* A short truce on arrival lets everyone spread out first. */
    admit(mon) { mon.dueling = this.options.battles; mon.cooldown = Math.min(5, this.options.battleCooldown); if (!this.cats.includes(mon)) this.cats.push(mon); }
    step(seconds) {
      if (!(typeof seconds === "number" && Number.isFinite(seconds)) || seconds <= 0) return;
      const dt = Math.min(seconds, 0.25);
      for (const mon of this.cats) {
        mon.step(dt);
        if (mon.cooldown > 0 && !mon.rival) mon.cooldown -= dt;
      }
      this.battles = this.battles.filter((battle) => battle.step(dt));
      this.fx.step(dt);
      if (!this.enabled) return;
      for (let i = 0; i < this.cats.length; i++) for (let j = i + 1; j < this.cats.length; j++) {
        const a = this.cats[i], b = this.cats[j];
        if (!a.ready() || !b.ready()) continue;
        const p = a.centre(), q = b.centre();
        if (Math.hypot(q.x - p.x, q.y - p.y) > (a.size + b.size) / 2 + this.options.battleRange) continue;
        this.battles.push(new Battle(a, b, this)); this.count++;
      }
    }
  }
  return { TYPE_COLORS, AILMENT_COLORS, AILMENT_TAGS, Fx, styleOf, actionFor, Battle, Arena };
});
