/* MIT license. Derived from MMM-Neko (c) 2026 Brian Wente.
 * Movement and everyday behavior of one sprite; battles live in pk-battle.js. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./pk-sprites.js"));
  else root.PkEngine = factory(root.PkSprites);
})(typeof globalThis !== "undefined" ? globalThis : this, function (Sprites) {
  "use strict";
  const defaults = Object.freeze({
    party: Object.freeze(["pikachu", "charmander", "squirtle", "bulbasaur"]), level: 50,
    mode: "wander", scale: 2, speed: 32, idleMin: 4, idleMax: 10, sleepAfter: 120, sleepDuration: 30,
    startPosition: Object.freeze({ x: 0.5, y: 0.7 }), inset: 16, reducedMotion: "auto", avoid: Object.freeze([]), avoidMargin: 4,
    skipActions: Object.freeze([]), battles: true, battleRange: 24, battleCooldown: 30, faintTime: 8, battleSpeed: 1,
    showText: true, showHp: true, autoDownload: true
  });
  const modes = ["wander", "mouse", "touch"];
  const regions = Object.freeze({
    top_bar: [0.5, 0], top_left: [0, 0], top_center: [0.5, 0], top_right: [1, 0],
    upper_third: [0.5, 1 / 3], middle_center: [0.5, 0.5], lower_third: [0.5, 2 / 3],
    bottom_left: [0, 1], bottom_center: [0.5, 1], bottom_right: [1, 1], bottom_bar: [0.5, 1],
    fullscreen_above: [0.5, 0.5], fullscreen_below: [0.5, 0.5]
  });
  const finite = (n) => typeof n === "number" && Number.isFinite(n);
  const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const EPS = 0.01, MAX_OBSTACLES = 8, MAX_PARTY = 12, MAX_HP = 20;
  const compass = (dx, dy) => ["E", "SE", "S", "SW", "W", "NW", "N", "NE"][(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
  // Boxes are obstacles grown into sprite-origin space: the sprite overlaps when its origin is strictly inside.
  const inside = (p, box) => p.x > box.l + EPS && p.x < box.r - EPS && p.y > box.t + EPS && p.y < box.b - EPS;
  // Liang–Barsky against the open box, so travel along an edge or through a corner stays legal.
  function crosses(a, b, box) {
    const dx = b.x - a.x, dy = b.y - a.y;
    let t0 = 0, t1 = 1;
    for (const [p, q] of [[-dx, a.x - box.l - EPS], [dx, box.r - EPS - a.x], [-dy, a.y - box.t - EPS], [dy, box.b - EPS - a.y]]) {
      if (p === 0) { if (q <= 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return t0 < t1;
  }
  /* A party member: a Pokémon name, a Pokédex number, or { pokemon, moves?, level?, sprite?, shiny? }. */
  const named = (v) => (typeof v === "string" && /^[A-Za-z0-9 .'’:é♀♂-]{1,30}$/.test(v)) || (Number.isInteger(v) && v >= 1 && v <= 2000);
  function member(v) {
    if (named(v)) return true;
    if (!object(v) || !named(v.pokemon)) return false;
    return Object.keys(v).every((key) => ({
      pokemon: true,
      moves: Array.isArray(v.moves) && v.moves.length >= 1 && v.moves.length <= 4 && v.moves.every((m) => typeof m === "string" && /^[A-Za-z0-9 ,.'’-]{1,40}$/.test(m)),
      level: Number.isInteger(v.level) && v.level >= 1 && v.level <= 100,
      sprite: typeof v.sprite === "string" && /^\d{1,4}(?:\/\d{1,4}){0,3}$/.test(v.sprite),
      shiny: typeof v.shiny === "boolean"
    })[key] === true);
  }
  function validateConfig(input) {
    const source = object(input) ? input : {};
    const config = { ...defaults, startPosition: { ...defaults.startPosition }, avoid: [], skipActions: [], party: [...defaults.party] };
    const invalid = Object.keys(source).filter((key) => !Object.hasOwn(defaults, key));
    const rules = {
      mode: (v) => modes.includes(v),
      scale: (v) => Number.isInteger(v) && v >= 1 && v <= 4,
      speed: (v) => finite(v) && v >= 1 && v <= 200,
      idleMin: (v) => finite(v) && v >= 1 && v <= 300,
      idleMax: (v) => finite(v) && v >= 1 && v <= 300,
      sleepAfter: (v) => finite(v) && v >= 5 && v <= 3600,
      sleepDuration: (v) => finite(v) && v >= 1 && v <= 3600,
      inset: (v) => finite(v) && v >= 0 && v <= 500,
      reducedMotion: (v) => ["auto", "always", "never"].includes(v),
      avoid: (v) => Array.isArray(v) && v.length <= MAX_OBSTACLES &&
        v.every((entry) => typeof entry === "string" && entry.trim() !== "" && entry.length <= 200),
      avoidMargin: (v) => finite(v) && v >= 0 && v <= 100,
      skipActions: (v) => Array.isArray(v) && v.length <= 64 && v.every((entry) => typeof entry === "string" && /^[A-Za-z0-9_]{1,40}$/.test(entry)),
      party: (v) => Array.isArray(v) && v.length >= 1 && v.length <= MAX_PARTY && v.every(member),
      level: (v) => Number.isInteger(v) && v >= 1 && v <= 100,
      battleSpeed: (v) => finite(v) && v >= 0.25 && v <= 4,
      showText: (v) => typeof v === "boolean", showHp: (v) => typeof v === "boolean", autoDownload: (v) => typeof v === "boolean",
      battles: (v) => typeof v === "boolean",
      battleRange: (v) => finite(v) && v >= 0 && v <= 300,
      battleCooldown: (v) => finite(v) && v >= 0 && v <= 3600,
      faintTime: (v) => finite(v) && v >= 1 && v <= 600,
      startPosition: (v) => object(v) && Object.keys(v).length === 2 &&
        [v.x, v.y].every((n) => finite(n) && n >= 0 && n <= 1)
    };
    for (const [key, rule] of Object.entries(rules)) {
      if (!Object.hasOwn(source, key)) continue;
      if (rule(source[key])) config[key] = key === "startPosition" ? { ...source[key] } : Array.isArray(source[key]) ? source[key].map((entry) => (object(entry) ? { ...entry } : entry)) : source[key];
      else invalid.push(key);
    }
    if (config.idleMax < config.idleMin) {
      config.idleMin = defaults.idleMin;
      config.idleMax = defaults.idleMax;
      invalid.push("idleMin/idleMax");
    }
    return { config, invalid };
  }
  class Mon {
    constructor(config, random = Math.random) {
      this.config = validateConfig(config).config;
      this.random = random;
      this.mode = this.config.mode;
      this.x = 0; this.y = 0; this.age = 0; this.awake = 0;
      this.target = null;
      this.region = null;
      this.obstacles = []; this.version = 0; this.moving = false; this.pushHold = 0;
      this.sprites = Sprites.placeholder(); this.fidget = null; this.turned = false;
      // What the renderer adds on top of the plain frame: offsets, fades and glows from moves and conditions.
      this.view = { dx: 0, dy: 0, opacity: 1, scale: 1, glow: null, flash: false, shield: false };
      this.species = null; this.level = this.config.level; this.fixedMoves = null; this.ailment = null; this.marks = {}; this.name = "";
      this.hp = MAX_HP; this.maxHp = MAX_HP; this.rival = null; this.cooldown = 0; this.dueling = false; this.clamp = false;
      this.direction = this.sprites.facing; this.enter("idle");
      this.idleDuration = this.nextIdle();
      this.resize(0, 0);
    }
    /* Swap the artwork. Behavior carries on; the body keeps its centre. */
    setSprites(set) {
      if (!set || !set.roles || !set.anims[set.roles.idle] || !set.anims[set.roles.walk]) return false;
      const before = this.size;
      this.sprites = set; this.fidget = null;
      if (!this.turned) this.direction = set.facing;
      const after = Math.min(set.base * this.config.scale, this.width, this.height);
      this.x += (before - after) / 2; this.y += (before - after) / 2;
      this.resize(this.width, this.height);
      const time = this.stateTime;
      this.enter(this.state === "fidget" ? "idle" : this.state); this.stateTime = time;
      return true;
    }
    /* The action that draws `state`, or undefined when this artwork has none. */
    animFor(state) {
      const roles = this.sprites.roles;
      if (state === "walk" || state === "push") return roles.walk;
      if (state === "fidget") return this.fidget;
      return state === "idle" ? roles.idle : roles[state];
    }
    has(state) { return Boolean(this.sprites.anims[this.animFor(state)]); }
    /* A small action for the pause before the next walk. Formats with wall
     * scratches use the ones for the edges the sprite is standing next to. */
    pickFidget() {
      const roles = this.sprites.roles;
      let pool = [...roles.fidget];
      // With company, moves and reactions are kept for battles.
      if (this.dueling) pool = pool.filter((name) => !(roles.attack || []).includes(name) && name !== roles.hurt && name !== roles.faint);
      if (roles.wall) {
        if (this.y - this.minY < this.size) pool.push(roles.wall.N);
        if (this.maxY - this.y < this.size) pool.push(roles.wall.S);
        if (this.x - this.minX < this.size) pool.push(roles.wall.W);
        if (this.maxX - this.x < this.size) pool.push(roles.wall.E);
      }
      if (pool.length > 1) pool = pool.filter((name) => name !== this.fidget); // No immediate repeats.
      if (!pool.length) return null;
      return pool.length === 1 ? pool[0] : pool[Math.min(pool.length - 1, Math.floor(this.random() * pool.length))];
    }
    nextIdle() { return this.config.idleMin + this.random() * (this.config.idleMax - this.config.idleMin); }
    resize(width, height) {
      this.width = finite(width) ? Math.max(0, width) : 0;
      this.height = finite(height) ? Math.max(0, height) : 0;
      this.size = Math.min(this.sprites.base * this.config.scale, this.width, this.height);
      this.minX = Math.min(this.config.inset, (this.width - this.size) / 2);
      this.minY = Math.min(this.config.inset, (this.height - this.size) / 2);
      this.maxX = this.width - this.size - this.minX;
      this.maxY = this.height - this.size - this.minY;
      if (!this.positioned && this.width && this.height) {
        this.x = this.minX + (this.maxX - this.minX) * this.config.startPosition.x;
        this.y = this.minY + (this.maxY - this.minY) * this.config.startPosition.y;
        this.positioned = true;
      }
      this.x = clamp(this.x, this.minX, this.maxX);
      this.y = clamp(this.y, this.minY, this.maxY);
      if (this.target) this.target = this.bound(this.target.x, this.target.y);
      this.version++;
    }
    bound(x, y) { return { x: clamp(x, this.minX, this.maxX), y: clamp(y, this.minY, this.maxY) }; }
    enter(state) {
      this.state = state; this.stateTime = 0; this.clamp = false;
      this.anim = this.has(state) ? this.animFor(state) : this.sprites.roles.idle;
      this.hold = Sprites.playTime(this.sprites.anims[this.anim]); // Length of a one-shot action.
    }
    rest() { this.enter("idle"); this.idleDuration = this.nextIdle(); }
    /* Start towards a new target, pausing on an "alert" pose if the artwork has one. */
    depart() { if (this.state !== "walk" && this.state !== "alert") this.enter(this.has("alert") ? "alert" : "walk"); }
    /* ---- Battles: an Arena drives these; the sprite does nothing by itself while in "battle". */
    centre() { return { x: this.x + this.size / 2, y: this.y + this.size / 2 }; }
    ready() { return !this.rival && !this.region && this.cooldown <= 0 && this.positioned && this.species && this.sprites.format === "pmd" && ["idle", "walk", "fidget"].includes(this.state); }
    /* Hold an action: looping, or with `clamp` played once and frozen on its last frame. */
    pose(name, clamp = false) {
      this.state = "battle"; this.stateTime = 0; this.clamp = clamp;
      this.anim = this.sprites.anims[name] ? name : this.sprites.roles.idle;
    }
    face(other) {
      const a = this.centre(), b = other.centre();
      if (a.x !== b.x || a.y !== b.y) { this.direction = compass(b.x - a.x, b.y - a.y); this.turned = true; }
    }
    engage(rival) {
      this.rival = rival; this.target = null; this.region = null;
      this.face(rival); this.pose();
    }
    /* Back to ordinary life after a battle. */
    release(cooldown) {
      this.rival = null; this.cooldown = cooldown; this.ailment = null; this.marks = {};
      Object.assign(this.view, { dx: 0, dy: 0, opacity: 1, scale: 1, glow: null, flash: false, shield: false });
    }
    faint(seconds) {
      const roles = this.sprites.roles, name = this.sprites.anims[roles.faint] ? roles.faint : roles.sleep;
      this.state = "faint"; this.stateTime = 0; this.anim = name; this.clamp = name === roles.faint;
      this.down = seconds; this.target = null; this.hp = 0;
    }
    setMode(mode) {
      if (!modes.includes(mode)) return false;
      this.mode = mode; this.target = null; this.region = null;
      this.rest();
      return true;
    }
    point(x, y, kind) {
      if (this.region || kind !== this.mode || !finite(x) || !finite(y) || this.state === "battle" || this.state === "faint") return false;
      const target = this.clear(this.bound(x - this.size / 2, y - this.size / 2));
      if (Math.hypot(target.x - this.x, target.y - this.y) < 8) return false;
      this.target = target; this.awake = 0;
      this.depart();
      return true;
    }
    goToRegion(region, rect) {
      if (!Object.hasOwn(regions, region)) return false;
      if (this.state === "battle" || this.state === "faint") return true; // A valid command, but this one is busy.
      const [x, y] = regions[region];
      const hasRect = rect && [rect.left, rect.top, rect.width, rect.height].every(finite) && rect.width > 0 && rect.height > 0;
      this.target = this.clear(hasRect
        ? this.bound(rect.left + rect.width / 2 - this.size / 2, rect.top + rect.height / 2 - this.size / 2)
        : { x: this.minX + x * (this.maxX - this.minX), y: this.minY + y * (this.maxY - this.minY) });
      this.region = region; this.awake = 0;
      this.depart();
      return true;
    }
    /* Obstacles are viewport rectangles ({ left, top, right, bottom, key }) that the
     * sprite is pushed out of and then walks around. `key` links a rectangle to its
     * previous position so the edge that moved into the sprite does the pushing. */
    setObstacles(list) {
      const next = [];
      for (const o of Array.isArray(list) ? list : []) {
        if (next.length >= MAX_OBSTACLES) break;
        if (!object(o) || ![o.left, o.top, o.right, o.bottom].every(finite) || o.right <= o.left || o.bottom <= o.top) continue;
        const old = this.obstacles.find((entry) => o.key != null && entry.key === o.key);
        next.push({ left: o.left, top: o.top, right: o.right, bottom: o.bottom, key: o.key ?? null,
          prev: old ? { left: old.left, top: old.top, right: old.right, bottom: old.bottom } : null });
      }
      const same = (a, b) => a.key === b.key && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
      this.moving = next.length !== this.obstacles.length || next.some((o, i) => !same(o, this.obstacles[i]));
      this.obstacles = next;
      if (this.moving) this.version++;
      return this.moving;
    }
    grow(o, margin) { return { l: o.left - this.size - margin, r: o.right + margin, t: o.top - this.size - margin, b: o.bottom + margin }; }
    /* Nearest in-bounds point outside every obstacle, or null when boxed in. With
     * `swept`, an obstacle that moved onto the sprite pushes it ahead of that edge. */
    eject(point, margin, swept = false) {
      let p = { x: point.x, y: point.y };
      const fits = (e) => e.x >= this.minX - EPS && e.x <= this.maxX + EPS && e.y >= this.minY - EPS && e.y <= this.maxY + EPS;
      for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (const o of this.obstacles) {
          const box = this.grow(o, margin);
          if (!inside(p, box)) continue;
          const exits = [{ x: box.l, y: p.y, side: "W" }, { x: box.r, y: p.y, side: "E" },
            { x: p.x, y: box.t, side: "N" }, { x: p.x, y: box.b, side: "S" }].filter(fits);
          if (!exits.length) return null;
          let exit = null;
          if (swept && o.prev) {
            const was = this.grow(o.prev, margin);
            const travel = { W: was.l - box.l, E: box.r - was.r, N: was.t - box.t, S: box.b - was.b };
            const sides = [p.x <= was.l + EPS && "W", p.x >= was.r - EPS && "E", p.y <= was.t + EPS && "N", p.y >= was.b - EPS && "S"]
              .filter(Boolean).sort((a, b) => travel[b] - travel[a]);
            exit = exits.find((e) => e.side === sides[0]) || null;
          }
          const cost = (e) => Math.abs(e.x - p.x) + Math.abs(e.y - p.y);
          exit = exit || exits.reduce((a, b) => (cost(b) < cost(a) ? b : a));
          p = { x: exit.x, y: exit.y }; moved = true;
        }
        if (!moved) return p;
      }
      return this.obstacles.some((o) => inside(p, this.grow(o, margin))) ? null : p;
    }
    clear(point) { return (this.obstacles.length && this.eject(point, this.config.avoidMargin)) || point; }
    /* Shortest walk to `target` around the obstacles: a visibility graph over the
     * corners of the grown boxes. Null means the target cannot be reached. */
    plan(target) {
      if (!this.obstacles.length) return [target];
      const margin = this.config.avoidMargin;
      const start = this.eject(this, margin), goal = this.eject(target, margin);
      if (!start || !goal) return null;
      const boxes = this.obstacles.map((o) => this.grow(o, margin)), nodes = [start, goal];
      for (const box of boxes) for (const x of [box.l, box.r]) for (const y of [box.t, box.b]) {
        const p = { x, y };
        if (x >= this.minX && x <= this.maxX && y >= this.minY && y <= this.maxY && !boxes.some((b) => inside(p, b))) nodes.push(p);
      }
      const open = (a, b) => !boxes.some((box) => crosses(a, b, box));
      const cost = nodes.map(() => Infinity), from = nodes.map(() => 0), done = nodes.map(() => false);
      cost[0] = 0;
      for (;;) {
        let u = -1;
        for (let i = 0; i < nodes.length; i++) if (!done[i] && cost[i] < Infinity && (u < 0 || cost[i] < cost[u])) u = i;
        if (u < 0) return null;
        if (u === 1) break;
        done[u] = true;
        for (let v = 1; v < nodes.length; v++) {
          if (done[v] || !open(nodes[u], nodes[v])) continue;
          const total = cost[u] + Math.hypot(nodes[v].x - nodes[u].x, nodes[v].y - nodes[u].y);
          if (total < cost[v]) { cost[v] = total; from[v] = u; }
        }
      }
      const path = [];
      for (let i = 1; i !== 0; i = from[i]) path.unshift(nodes[i]);
      if (start.x !== this.x || start.y !== this.y) path.unshift(start);
      return path;
    }
    route() {
      if (this.routeTarget !== this.target || this.routeVersion !== this.version) {
        this.routeTarget = this.target; this.routeVersion = this.version;
        this.path = this.plan(this.target);
      }
      return this.path;
    }
    roam() {
      for (let i = 0; i < 12; i++) {
        const p = { x: this.minX + this.random() * (this.maxX - this.minX), y: this.minY + this.random() * (this.maxY - this.minY) };
        if (!this.obstacles.length) return p;
        if (!this.obstacles.some((o) => inside(p, this.grow(o, this.config.avoidMargin))) && this.plan(p)) return p;
      }
      return null;
    }
    shove() {
      const free = this.eject(this, 0, true);
      if (!free || (free.x === this.x && free.y === this.y)) return;
      this.direction = compass(free.x - this.x, free.y - this.y); this.turned = true;
      this.x = free.x; this.y = free.y; this.version++;
      if (this.state === "walk" || this.state === "alert") return; // Keep heading for the target by a new route.
      if (this.state === "sleep") this.awake = 0;
      if (this.state !== "push") this.enter("push");
      this.pushHold = 0.3;
    }
    step(seconds) {
      if (!finite(seconds) || seconds <= 0) return;
      const dt = Math.min(seconds, 0.25); // Never jump after a stalled frame.
      this.age += dt; this.stateTime += dt;
      if (this.obstacles.length) this.shove();
      if (this.state === "battle") return;
      if (this.state === "faint") {
        if (this.stateTime >= this.down) { this.hp = this.maxHp; this.awake = 0; this.view.opacity = 1; if (this.has("wake")) this.enter("wake"); else this.rest(); }
        return;
      }
      if (this.state !== "sleep") this.awake += dt;
      if (!this.region && !["sleep", "tired", "push"].includes(this.state) && this.awake >= this.config.sleepAfter) {
        this.target = null; this.enter(this.has("tired") ? "tired" : "sleep");
      }
      if (this.state === "sleep") {
        if (this.stateTime >= this.config.sleepDuration) {
          this.awake = 0;
          if (this.has("wake")) this.enter("wake"); else this.rest();
        }
      } else if (this.state === "tired") {
        if (this.stateTime >= this.hold) this.enter("sleep");
      } else if (this.state === "wake") {
        if (this.stateTime >= this.hold) this.rest();
      } else if (this.state === "alert") {
        if (this.stateTime >= this.hold) { if (this.target) this.enter("walk"); else this.rest(); }
      } else if (this.state === "push") {
        this.pushHold -= dt;
        if (this.pushHold <= 0) { this.rest(); }
      } else if (this.state === "walk" && this.target) {
        const path = this.route(), goal = path && path[0];
        if (!goal) { // Walled off: give up and try somewhere else later.
          this.target = null; this.region = null;
          this.rest();
          return;
        }
        const dx = goal.x - this.x, dy = goal.y - this.y;
        const distance = Math.hypot(dx, dy), step = this.config.speed * dt;
        if (distance > 0) { this.direction = compass(dx, dy); this.turned = true; }
        if (distance > step) { this.x += dx / distance * step; this.y += dy / distance * step; }
        else {
          this.x = goal.x; this.y = goal.y; path.shift();
          if (!path.length) {
            this.target = null;
            if (this.region) this.awake = 0;
            this.region = null;
            this.rest();
          }
        }
      } else if (this.state === "idle" && this.stateTime >= this.idleDuration) {
        this.fidget = this.pickFidget();
        if (this.fidget) this.enter("fidget"); else this.wander();
      } else if (this.state === "fidget" && this.stateTime >= this.hold) {
        this.wander();
      }
    }
    wander() {
      this.target = this.roam();
      if (this.target) this.enter("walk"); else this.rest();
    }
    /* The sheet rectangle to draw now: { anim, index, sheet, x, y, w, h }. */
    frame(reduced = false) {
      if (reduced) return Sprites.cell(this.sprites, this.sprites.roles.sleep, this.direction, 0);
      const time = this.clamp ? Math.min(this.stateTime, Sprites.total(this.sprites.anims[this.anim]) - 1e-6) : this.stateTime;
      return Sprites.cell(this.sprites, this.anim, this.direction, time);
    }
  }
  function notification(name, payload) {
    const actions = { POKEMON_SHOW: "show", POKEMON_HIDE: "hide", POKEMON_PAUSE: "pause", POKEMON_RESUME: "resume" };
    if (Object.hasOwn(actions, name)) return payload == null ? { action: actions[name] } : null;
    if (name === "POKEMON_SET_MODE" && object(payload) && Object.keys(payload).length === 1 && modes.includes(payload.mode)) {
      return { action: "mode", mode: payload.mode };
    }
    if (name === "POKEMON_GO_TO_REGION" && object(payload) && Object.keys(payload).length === 1 &&
        typeof payload.region === "string" && Object.hasOwn(regions, payload.region)) {
      return { action: "region", region: payload.region };
    }
    return null;
  }
  return { defaults, modes, regions, validateConfig, Mon, compass, notification };
});
