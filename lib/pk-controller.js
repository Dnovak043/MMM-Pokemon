/* MIT license. Derived from MMM-Neko (c) 2026 Brian Wente.
 * The browser side: loads the game data and each party member's artwork, runs
 * the arena on a timer, and draws sprites, HP bars, battle text and particles. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./pk-engine.js"), require("./pk-sprites.js"), require("./pk-battle.js"));
  else root.PkController = factory(root.PkEngine, root.PkSprites, root.PkBattle);
})(typeof globalThis !== "undefined" ? globalThis : this, function (Engine, Sprites, Battle) {
  "use strict";
  const toId = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, "");
  const pad = (n) => String(n).padStart(4, "0");
  return class Controller {
    /* `urls`: where data/ and sprites/ are served from. `hooks.requestSprites(id)` asks
     * the server side to download missing artwork; answer with spritesReady(). */
    constructor(config, env = window, urls = { data: "data", sprites: "sprites" }, hooks = {}) {
      this.env = env; this.doc = env.document; this.urls = urls; this.hooks = hooks;
      this.config = Engine.validateConfig(config).config;
      this.measured = -Infinity; this.sliding = false;
      this.timer = null; this.frame = null; this.disposers = []; this.destroyed = false;
      this.keys = new WeakMap(); this.nextKey = 0;
      this.paused = false; this.suspended = false; this.hidden = false;
      this.element = this.make("mmm-pokemon-overlay");
      this.element.setAttribute("aria-hidden", "true");
      this.pets = []; this.cats = []; this.dots = []; this.labels = []; this.data = null; this.species = null;
      this.arena = new Battle.Arena(this.cats, this.config);
      this.media = env.matchMedia("(prefers-reduced-motion: reduce)");
      this.listen(env, "resize", () => this.resize());
      this.listen(this.doc, "visibilitychange", () => this.sync());
      this.listen(env, "pagehide", () => this.stop());
      this.listen(env, "pageshow", () => this.sync());
      this.listen(env, "beforeunload", () => this.destroy());
      this.listen(this.media, "change", () => this.sync());
      // Passive capture observes events even when a module stops bubbling.
      this.listen(this.doc, "pointermove", (event) => {
        if (event.pointerType === "mouse") this.point(event, "mouse");
      });
      this.listen(this.doc, "pointerdown", (event) => {
        if (event.pointerType === "touch" && event.isPrimary !== false) this.point(event, "touch");
      });
      this.sync();
      this.loadData();
    }
    make(className, parent = null) {
      const element = this.doc.createElement("div");
      element.className = className;
      if (parent) parent.appendChild(element);
      return element;
    }
    /* ---- data and party ---- */
    loadData() {
      if (typeof this.env.fetch !== "function") return;
      const json = (name) => this.env.fetch(`${this.urls.data}/${name}.json`).then((response) => { if (!response.ok) throw new Error(name); return response.json(); });
      Promise.all([json("moves"), json("pokedex")]).then(([moves, pokedex]) => this.setData(moves, pokedex)).catch(() => {}); // Without data nothing is shown.
    }
    setData(moves, pokedex) {
      if (this.destroyed || this.data) return;
      this.data = { moves };
      this.species = new Map();
      for (const entry of pokedex.species) {
        const species = { ...entry, moves: entry.moves.map((index) => pokedex.moves[index]) };
        this.species.set(species.num, species); this.species.set(species.id, species);
      }
      this.arena.data = this.data;
      const members = this.config.party.map((entry) => this.resolve(entry)).filter(Boolean);
      members.forEach((member, index) => this.spawn(member, index, members.length));
      this.sync();
    }
    /* A config entry → species, level, moves and where its artwork lives. */
    resolve(entry) {
      const options = typeof entry === "object" ? entry : { pokemon: entry };
      const species = this.species.get(typeof options.pokemon === "number" ? options.pokemon : toId(options.pokemon));
      if (!species) { this.warn(`unknown Pokémon "${options.pokemon}"`); return null; }
      let moves = null;
      if (options.moves) {
        moves = options.moves.map(toId).filter((id) => { if (!this.data.moves[id]) this.warn(`unknown move "${id}" for ${species.name}`); return this.data.moves[id]; });
        if (!moves.length) moves = null;
      }
      // Sprite Collab folders: <dex>/<form>/<shiny>/<gender>, four digits each.
      const id = options.sprite ? options.sprite.split("/").map(pad).join("/") : options.shiny ? `${pad(species.num)}/0000/0001` : pad(species.num);
      return { species, level: options.level || this.config.level, moves, id, folder: id.replaceAll("/", "-") };
    }
    warn(text) { if (this.env.console) this.env.console.warn(`MMM-Pokemon: ${text}`); }
    spawn(member, index, count) {
      const cat = new Engine.Mon({ ...this.config, startPosition: { x: (index + 0.5) / count, y: this.config.startPosition.y } });
      Object.assign(cat, { species: member.species, name: member.species.name, level: member.level, fixedMoves: member.moves });
      const sprite = this.make("mmm-pokemon-sprite", this.element), shield = this.make("mmm-pokemon-shield", this.element);
      const hud = this.make("mmm-pokemon-hud", this.element), label = this.make("mmm-pokemon-name", hud), bar = this.make("mmm-pokemon-hp", hud), fill = this.make("mmm-pokemon-hp-fill", bar);
      for (const element of [sprite, shield, hud]) element.style.display = "none";
      const pet = { cat, member, sprite, shield, hud, label, bar, fill, barDrawn: {}, drawn: {}, hudDrawn: {}, fillDrawn: {}, shieldDrawn: {}, requested: false };
      this.pets.push(pet); this.arena.admit(cat);
      cat.resize(this.env.innerWidth, this.env.innerHeight);
      this.loadFolder(pet);
      return pet;
    }
    /* Decode one image; `done` receives its URL and pixel size, or null. */
    load(url, done) {
      const image = new this.env.Image();
      this.listen(image, "load", () => done({ url, width: image.naturalWidth, height: image.naturalHeight, element: image }));
      this.listen(image, "error", () => done(null));
      image.src = url;
    }
    /* AnimData.xml lists the actions this sprite has and their frame sizes and
     * timings; each action is its own sheet. */
    loadFolder(pet) {
      if (typeof this.env.fetch !== "function") return;
      const url = `${this.urls.sprites}/${pet.member.folder}`;
      this.env.fetch(`${url}/AnimData.xml`).then((response) => (response.ok ? response.text() : "")).then((xml) => {
        if (this.destroyed) return;
        const list = Sprites.parseAnimData(xml);
        const files = [...new Set(list.map((entry) => entry.file))], images = {};
        let pending = files.length;
        if (!pending) return this.missing(pet);
        for (const file of files) {
          this.load(`${url}/${file}-Anim.png`, (image) => {
            if (image) images[file] = image;
            if (--pending > 0 || this.destroyed) return;
            const walk = list.find((entry) => entry.name === "Walk"), sheet = walk && images[walk.file];
            const body = sheet ? this.visibleBody(sheet, walk.w, walk.h) : null;
            if (pet.cat.setSprites(Sprites.pmd(list, images, this.config.skipActions, body))) this.sync(); else this.missing(pet);
          });
        }
      }).catch(() => this.missing(pet));
    }
    /* Read the Walk sheet's pixels to find how much of each frame is really drawn on. */
    visibleBody(sheet, fw, fh) {
      try {
        const canvas = this.doc.createElement("canvas");
        if (typeof canvas.getContext !== "function") return null;
        canvas.width = sheet.width; canvas.height = sheet.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(sheet.element, 0, 0);
        return Sprites.bounds(context.getImageData(0, 0, sheet.width, sheet.height).data, sheet.width, sheet.height, fw, fh);
      } catch { return null; } // No canvas, or unreadable pixels: fall back to the frame size.
    }
    /* No usable artwork on disk: ask the server side to fetch it, once. */
    missing(pet) {
      if (this.destroyed || pet.requested || !this.config.autoDownload || typeof this.hooks.requestSprites !== "function") return;
      pet.requested = true;
      this.hooks.requestSprites(pet.member.id);
    }
    spritesReady(folder, ok) {
      if (this.destroyed || !ok) return;
      for (const pet of this.pets) if (pet.member.folder === folder && pet.cat.sprites.format !== "pmd") this.loadFolder(pet);
    }
    /* ---- input and layout ---- */
    listen(target, event, callback) {
      const options = { passive: true, capture: true };
      target.addEventListener(event, callback, options);
      this.disposers.push(() => target.removeEventListener(event, callback, options));
    }
    reduced() { return this.config.reducedMotion === "always" || (this.config.reducedMotion === "auto" && this.media.matches); }
    active() { return !this.destroyed && !this.paused && !this.suspended && !this.hidden && !this.doc.hidden && !this.reduced(); }
    point(event, kind) {
      if (this.active()) for (const cat of this.cats) cat.point(event.clientX, event.clientY, kind);
    }
    goToRegion(region) {
      const rect = this.regionRect(region);
      for (const cat of this.cats) cat.goToRegion(region, rect);
    }
    regionRect(region) {
      // Only validated built-in names reach the selector.
      const element = this.doc.querySelector(`.region.${region.replaceAll("_", ".")}`);
      return element ? element.getBoundingClientRect() : null;
    }
    visible(element) {
      for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
        const style = this.env.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      }
      return true;
    }
    /* Viewport rectangles of the modules to avoid. Plain module names select the
     * MagicMirror wrapper; anything else is used as a CSS selector from config.js. */
    measure() {
      const list = [];
      for (const entry of this.config.avoid) {
        let found;
        try { found = this.doc.querySelectorAll(/^[A-Za-z_][A-Za-z0-9_-]*$/.test(entry) ? `.module.${entry}` : entry); }
        catch { continue; } // An invalid selector avoids nothing.
        for (const element of found) {
          if (element === this.element || element.contains(this.element) || this.element.contains(element)) continue;
          const rect = element.getBoundingClientRect();
          if (!(rect.width > 0 && rect.height > 0) || rect.right <= 0 || rect.bottom <= 0 ||
              rect.left >= this.env.innerWidth || rect.top >= this.env.innerHeight || !this.visible(element)) continue;
          if (!this.keys.has(element)) this.keys.set(element, ++this.nextKey);
          list.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, key: this.keys.get(element) });
        }
      }
      return list;
    }
    resize() {
      for (const cat of this.cats) {
        cat.resize(this.env.innerWidth, this.env.innerHeight);
        if (cat.region) cat.goToRegion(cat.region, this.regionRect(cat.region));
      }
      this.render();
    }
    /* ---- drawing ---- */
    // Most ticks repeat the previous frame; only touch what changed.
    apply(style, cache, next) {
      for (const [key, value] of Object.entries(next)) {
        if (cache[key] !== value) { cache[key] = value; style[key] = value; }
      }
    }
    render() {
      const reduced = this.reduced();
      for (const pet of this.pets) this.draw(pet, reduced);
      this.drawText(reduced); this.drawFx(reduced);
      this.element.style.display = this.hidden ? "none" : "block";
    }
    draw(pet, reduced) {
      const cat = pet.cat, set = cat.sprites;
      if (set.format !== "pmd") { // Artwork not loaded (yet): nothing to show.
        this.apply(pet.sprite.style, pet.drawn, { display: "none" }); this.apply(pet.hud.style, pet.hudDrawn, { display: "none" }); this.apply(pet.shield.style, pet.shieldDrawn, { display: "none" });
        return;
      }
      const size = cat.size, scale = size / set.base, view = reduced ? { dx: 0, dy: 0, opacity: 1, scale: 1 } : cat.view;
      const frame = cat.frame(reduced), sheet = set.sheets[frame.sheet];
      // Actions use different frame sizes; every frame is placed so the visible body stays on the body box.
      const width = frame.w * scale, height = frame.h * scale, offset = set.offset || { x: 0, y: 0 };
      const x = Math.round(cat.x + (size - width) / 2 - offset.x * scale + view.dx), y = Math.round(cat.y + (size - height) / 2 - offset.y * scale + view.dy);
      this.apply(pet.sprite.style, pet.drawn, {
        display: "block", width: `${width}px`, height: `${height}px`,
        transform: `translate(${x}px, ${y}px)${view.scale !== 1 ? ` scale(${view.scale})` : ""}`,
        backgroundImage: `url("${sheet.url}")`,
        backgroundSize: `${sheet.width * scale}px ${sheet.height * scale}px`,
        backgroundPosition: `${-frame.x * scale}px ${-frame.y * scale}px`,
        opacity: String(Math.round(view.opacity * 100) / 100),
        filter: view.flash ? "brightness(4)" : view.glow ? `drop-shadow(0 0 ${Math.max(2, Math.round(size / 12))}px ${view.glow})` : "none",
        zIndex: String(Math.round(cat.y + size)) // Whoever stands lower on screen is in front.
      });
      const ring = size * 1.35;
      this.apply(pet.shield.style, pet.shieldDrawn, view.shield ? {
        display: "block", width: `${ring}px`, height: `${ring}px`, transform: `translate(${Math.round(cat.x + (size - ring) / 2)}px, ${Math.round(cat.y + (size - ring) / 2)}px)`
      } : { display: "none" });
      const battling = !reduced && this.config.showHp && (cat.state === "battle" || (cat.state === "faint" && cat.stateTime < 1.5));
      if (!battling) return void this.apply(pet.hud.style, pet.hudDrawn, { display: "none" });
      // Sized from settings, not the sprite, so every nameplate and bar looks the same.
      const unit = 32 * this.config.scale, ratio = cat.hp / cat.maxHp, wide = this.config.hpBarWidth || Math.max(48, unit);
      const font = this.config.nameSize || Math.max(9, Math.round(unit / 6)), thick = this.config.hpBarHeight || Math.max(3, Math.round(font / 2));
      this.apply(pet.hud.style, pet.hudDrawn, {
        display: "block", width: `${wide}px`, fontSize: `${font}px`,
        transform: `translate(${Math.round(cat.x + (size - wide) / 2)}px, ${Math.round(cat.y - font * 1.2 - thick - 8)}px)`
      });
      this.apply(pet.bar.style, pet.barDrawn, { height: `${thick}px` });
      const text = `${cat.name}${cat.ailment ? ` ${Battle.AILMENT_TAGS[cat.ailment]}` : ""}`;
      if (pet.hudDrawn.text !== text) { pet.hudDrawn.text = text; pet.label.textContent = text; }
      this.apply(pet.fill.style, pet.fillDrawn, { width: `${Math.round(ratio * 100)}%`, backgroundColor: ratio > 0.5 ? "#3c3" : ratio > 0.2 ? "#ec3" : "#e33" });
    }
    /* One line of battle text under each pair of fighters. */
    drawText(reduced) {
      const battles = reduced || !this.config.showText ? [] : this.arena.battles.filter((battle) => battle.text);
      while (this.labels.length < battles.length) this.labels.push({ element: this.make("mmm-pokemon-text", this.element), drawn: {} });
      this.labels.forEach((label, i) => {
        const battle = battles[i];
        if (!battle) return this.apply(label.element.style, label.drawn, { display: "none" });
        const [a, b] = battle.pair;
        const x = (a.x + a.size / 2 + b.x + b.size / 2) / 2, y = Math.max(a.y + a.size, b.y + b.size) + 12;
        // One box size for every battle, whatever the fighters' sizes.
        const unit = 32 * this.config.scale, font = this.config.textSize || Math.max(10, Math.round(unit / 5));
        const width = Math.min(this.env.innerWidth - 8, this.config.textBoxWidth || Math.max(180, unit * 5));
        // Below the fighters, or above them when there is no room.
        this.apply(label.element.style, label.drawn, {
          display: "block", width: `${width}px`, fontSize: `${font}px`,
          transform: `translate(${Math.round(Math.min(Math.max(4, x - width / 2), this.env.innerWidth - width - 4))}px, ${Math.round(y + font * 3 > this.env.innerHeight ? Math.max(4, Math.min(a.y, b.y) - font * 6 - 24) : y)}px)`
        });
        if (label.drawn.text !== battle.text) { label.drawn.text = battle.text; label.element.textContent = battle.text; }
      });
    }
    drawFx(reduced) {
      const particles = reduced ? [] : this.arena.fx.visible();
      while (this.dots.length < particles.length) this.dots.push({ element: this.make("mmm-pokemon-dot", this.element), shown: false, text: null });
      this.dots.forEach((dot, i) => {
        const p = particles[i], style = dot.element.style;
        if (!p) { if (dot.shown) { dot.shown = false; style.display = "none"; } return; }
        const size = Math.max(1, Math.round(p.size)), fade = Math.min(1, (1 - p.age / p.life) * 3);
        dot.shown = true;
        style.display = "block";
        style.transform = `translate(${Math.round(p.x - size / 2)}px, ${Math.round(p.y - size / 2)}px)`;
        style.opacity = String(Math.round(fade * 100) / 100);
        if (p.text) {
          style.width = "auto"; style.height = "auto"; style.background = "none"; style.border = "none"; style.borderRadius = "0";
          style.color = p.color; style.fontSize = `${size * 2}px`;
        } else {
          style.width = `${size}px`; style.height = `${size}px`;
          style.background = p.ring ? "none" : p.color; style.border = p.ring ? `${Math.max(1, Math.round(size / 10))}px solid ${p.color}` : "none";
          style.borderRadius = p.ring ? "50%" : "0";
        }
        if (dot.text !== p.text) { dot.text = p.text; dot.element.textContent = p.text || ""; }
      });
    }
    /* ---- clock ---- */
    stop() {
      if (this.timer !== null) this.env.clearTimeout(this.timer);
      if (this.frame !== null) this.env.cancelAnimationFrame(this.frame);
      this.timer = null; this.frame = null;
    }
    /* Redraw interval: the fastest any sprite on screen needs. */
    wait() { return this.cats.length ? Math.min(...this.cats.map((cat) => cat.sprites.tick)) : 250; }
    sync() {
      this.stop();
      if (this.destroyed) return;
      this.render();
      if (!this.active()) return;
      this.lastTime = this.env.performance.now();
      const tick = () => {
        this.timer = null; this.frame = null;
        if (!this.active()) return;
        const now = this.env.performance.now();
        // Fast-ticking artwork still measures layout at 20 Hz unless a module is sliding.
        if (this.config.avoid.length > 0 && (this.sliding || this.wait() >= 50 || now - this.measured >= 50)) {
          const obstacles = this.measure();
          this.measured = now; this.sliding = false;
          for (const cat of this.cats) this.sliding = cat.setObstacles(obstacles) || this.sliding;
        }
        const sliding = this.sliding;
        this.arena.step((now - this.lastTime) / 1000); this.lastTime = now;
        this.render();
        // Follow a sliding module frame by frame so its border visibly pushes the sprite.
        if (sliding && typeof this.env.requestAnimationFrame === "function") this.frame = this.env.requestAnimationFrame(tick);
        else this.timer = this.env.setTimeout(tick, this.wait());
      };
      this.timer = this.env.setTimeout(tick, this.wait());
    }
    suspend() { this.suspended = true; this.sync(); }
    resume() { this.suspended = false; this.sync(); }
    receive(name, payload) {
      if (this.destroyed) return false;
      const command = Engine.notification(name, payload);
      if (!command) return false;
      switch (command.action) {
        case "show": this.hidden = false; break;
        case "hide": this.hidden = true; break;
        case "pause": this.paused = true; break;
        case "resume": this.paused = false; break;
        case "mode": for (const cat of this.cats) cat.setMode(command.mode); break;
        case "region": this.goToRegion(command.region); break;
      }
      this.sync(); return true;
    }
    destroy() {
      this.stop(); this.disposers.splice(0).forEach((dispose) => dispose());
      this.element.remove(); this.destroyed = true;
    }
  };
});
