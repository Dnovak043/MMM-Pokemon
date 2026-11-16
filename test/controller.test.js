"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const vm = require("node:vm");
const Engine = require("../lib/pk-engine.js");
const Controller = require("../lib/pk-controller.js");
const { fs, path, anim, fighterXml, plainXml, sizes, seeded, environment } = require("./helpers.js");

const sprites = { "0025": fighterXml, "0007": fighterXml, "0004": fighterXml, "0001": fighterXml, "0132": plainXml, "0025-0000-0001": fighterXml };
const quiet = { idleMin: 300, idleMax: 300, sleepAfter: 3600, reducedMotion: "never" };

test("nothing is shown until data and artwork have loaded; then each member appears with its own sprite", async () => {
  const e = environment({ sprites });
  const c = new Controller({ ...quiet, party: ["Pikachu", 7, { pokemon: "charmander", level: 30, moves: ["Ember", "not-a-move", "Scratch"] }] }, e.env);
  assert.equal(c.pets.length, 0); assert.deepEqual(e.requests, ["data/moves.json", "data/pokedex.json", "data/variants.json"]);
  await e.settle();
  assert.deepEqual(c.pets.map((p) => [p.cat.name, p.cat.level, p.member.folder, p.cat.fixedMoves]), [["Pikachu", 50, "0025", null], ["Squirtle", 50, "0007", null], ["Charmander", 30, "0004", ["ember", "scratch"]]]);
  assert.match(e.warnings.join("\n"), /unknown move "notamove" for Charmander/);
  assert.deepEqual(c.cats.map((cat) => cat.sprites.format), ["pmd", "pmd", "pmd"]);
  assert.equal(c.arena.data, c.data); assert.equal(c.arena.enabled, true); assert.equal(c.arena.cats, c.cats);
  const xs = c.cats.map((cat) => cat.x); assert.ok(xs[0] < xs[1] && xs[1] < xs[2] && xs[1] - xs[0] > 200); // Spread out, not stacked.
  // Idle: 32 × 40 at scale 2, facing the viewer, centred on a 64px body.
  const s = c.pets[0].sprite.style, cat = c.cat = c.cats[0];
  assert.equal(s.display, "block"); assert.equal(s.backgroundImage, 'url("sprites/0025/Idle-Anim.png")');
  assert.deepEqual([s.width, s.height, s.backgroundSize, s.backgroundPosition, s.opacity, s.filter], ["64px", "80px", "256px 640px", "0px 0px", "1", "none"]);
  assert.equal(s.transform, `translate(${Math.round(cat.x)}px, ${Math.round(cat.y - 8)}px)`);
  assert.ok(c.pets.every((p) => p.hud.style.display === "none" && p.shield.style.display === "none"));
  assert.ok(e.requests.includes("sprites/0025/AnimData.xml")); assert.equal(e.images.length, 3 * Object.keys(sizes(fighterXml)).length);
  e.tick(16); assert.equal(e.timers.size, 1);
  c.destroy(); assert.equal(e.timers.size, 0); assert.equal(e.records.size, 0); assert.equal(c.element.removed, true);
});

test("unknown names are skipped, variants map to Sprite Collab folders, and missing data shows nothing", async () => {
  const e = environment({ sprites });
  const c = new Controller({ ...quiet, party: ["missingno", { pokemon: "pikachu", shiny: true }, { pokemon: 132, sprite: "132" }, "Mr. Mime"] }, e.env);
  await e.settle();
  assert.deepEqual(c.pets.map((p) => [p.cat.name, p.member.id, p.member.folder]), [["Pikachu", "0025/0000/0001", "0025-0000-0001"], ["Ditto", "0132", "0132"], ["Mr. Mime", "0122", "0122"]]);
  assert.match(e.warnings[0], /unknown Pokémon "missingno"/);
  assert.deepEqual(c.cats.map((cat) => cat.sprites.format), ["pmd", "pmd", "placeholder"]);
  assert.equal(c.pets[2].sprite.style.display, "none"); // No artwork, no placeholder drawn.
  c.destroy();
  const offline = environment({ sprites, serveData: false }), d = new Controller({ ...quiet }, offline.env);
  await offline.settle(); assert.equal(d.pets.length, 0); assert.equal(d.arena.enabled, false); offline.tick(250); d.destroy();
  const none = environment(); delete none.env.fetch; const n = new Controller({}, none.env); assert.equal(n.pets.length, 0); n.destroy();
});

test("missing artwork is requested once from the server side and loaded when it arrives", async () => {
  const available = {}, e = environment({ sprites: available }), asked = [];
  const c = new Controller({ ...quiet, party: ["pikachu", "pikachu", "squirtle"] }, e.env, { data: "data", sprites: "sprites" }, { requestSprites: (id) => asked.push(id) });
  await e.settle();
  assert.deepEqual(asked, ["0025", "0025", "0007"]); assert.ok(c.cats.every((cat) => cat.sprites.format === "placeholder"));
  c.spritesReady("0007", false); await e.settle(); assert.equal(c.cats[2].sprites.format, "placeholder"); // A failed download changes nothing.
  available["0025"] = fighterXml; c.spritesReady("0025", true); await e.settle();
  assert.deepEqual(c.cats.map((cat) => cat.sprites.format), ["pmd", "pmd", "placeholder"]);
  c.spritesReady("0025", true); await e.settle(); assert.deepEqual(asked, ["0025", "0025", "0007"]); // Never asked twice.
  c.destroy();
  const manual = environment({ sprites: {} }), again = [];
  const m = new Controller({ ...quiet, party: ["pikachu"], autoDownload: false }, manual.env, undefined, { requestSprites: (id) => again.push(id) });
  await manual.settle(); assert.deepEqual(again, []); m.destroy();
  // A folder whose Walk sheet is broken counts as missing.
  const broken = environment({ sprites, missing: ["Walk"] }), b2 = [];
  const b = new Controller({ ...quiet, party: ["pikachu"] }, broken.env, undefined, { requestSprites: (id) => b2.push(id) });
  await broken.settle(); assert.deepEqual(b2, ["0025"]); b.destroy();
});

test("a battle is drawn with names, HP bars, status tags, text, particles and sprite effects", async () => {
  const e = environment({ sprites });
  const c = new Controller({ ...quiet, party: [{ pokemon: "pikachu", moves: ["thunderwave", "thunderbolt"] }, { pokemon: "squirtle", moves: ["tackle"] }], battleCooldown: 0 }, e.env);
  await e.settle();
  const [a, b] = c.pets;
  c.cats.forEach((cat) => { cat.cooldown = 0; }); b.cat.x = a.cat.x + 80; b.cat.y = a.cat.y;
  e.tick(16);
  assert.equal(c.arena.battles.length, 1);
  const battle = c.arena.battles[0]; battle.fight.rng = battle.random = () => 0.5;
  battle.fight.choose = (mon) => c.data.moves[mon === battle.fight.mons[0] ? (battle.fight.turn === 1 ? "thunderwave" : "thunderbolt") : "tackle"];
  assert.deepEqual([a.hud.style.display, b.hud.style.display], ["block", "block"]);
  assert.equal(a.label.textContent, "Pikachu"); assert.equal(a.fill.style.width, "100%"); assert.equal(a.hud.style.width, "64px");
  const label = () => c.labels[0].element;
  assert.equal(label().style.display, "block"); assert.equal(label().textContent, "Pikachu and Squirtle face off!");
  const seen = { tag: false, glow: false, dots: 0, flash: false, low: false, texts: new Set(), shifted: false };
  for (let i = 0; i < 4000 && c.arena.battles.length; i++) {
    e.tick(16);
    seen.texts.add(label().textContent);
    if (b.label.textContent === "Squirtle PAR") seen.tag = true;
    if (/drop-shadow\(0 0 5px #f8d030\)/.test(b.sprite.style.filter)) seen.glow = true;
    if (b.sprite.style.filter === "brightness(4)") seen.flash = true;
    seen.dots = Math.max(seen.dots, c.dots.filter((d) => d.shown).length);
    if (b.fill.style.backgroundColor === "#e33") seen.low = true;
    if (a.cat.frame().anim === "Idle" && b.cat.frame().anim === "Attack" && b.cat.view.dx < -5) seen.shifted = /translate\((-?\d+)px/.exec(b.sprite.style.transform)[1] < Math.round(b.cat.x + (64 - 128) / 2) - 4;
  }
  assert.equal(c.arena.battles.length, 0);
  assert.ok(seen.tag && seen.glow, "paralysis tag and glow"); assert.ok(seen.flash); assert.ok(seen.dots > 5); assert.ok(seen.low); assert.ok(seen.shifted, "lunge offsets the drawn sprite");
  for (const text of ["Pikachu used Thunder Wave!", "Squirtle is paralyzed! It may be unable to move!", "Pikachu used Thunderbolt!", "It's super effective!", "Squirtle fainted!"]) assert.ok(seen.texts.has(text), text);
  assert.equal(label().style.display, "none"); assert.equal(a.hud.style.display, "none"); assert.equal(b.fill.style.width, "0%");
  for (let i = 0; i < 200; i++) e.tick(16);
  assert.equal(b.hud.style.display, "none"); assert.ok(c.dots.every((d) => !d.shown && d.element.style.display === "none"));
  c.destroy();
  // Text and HP bars can be switched off.
  const plain = environment({ sprites }), p = new Controller({ ...quiet, party: ["pikachu", "squirtle"], showText: false, showHp: false }, plain.env);
  await plain.settle(); p.cats.forEach((cat) => { cat.cooldown = 0; }); p.cats[1].x = p.cats[0].x + 80; p.cats[1].y = p.cats[0].y;
  for (let i = 0; i < 60; i++) plain.tick(16);
  assert.equal(p.arena.battles.length, 1); assert.equal(p.labels.length, 0); assert.ok(p.pets.every((pet) => pet.hud.style.display === "none")); p.destroy();
});

test("nameplates, HP bars and text boxes are the same size whatever the sprites' sizes", async () => {
  const bigXml = anim("Walk", 48, 72, [4, 4, 4, 4]) + anim("Idle", 56, 72, [20, 4]) + anim("Sleep", 48, 40, [30, 30]);
  const e = environment({ sprites: { "0025": fighterXml, "0007": fighterXml, "0143": `<AnimData><Anims>${bigXml}</Anims></AnimData>`, "0094": `<AnimData><Anims>${bigXml}</Anims></AnimData>` } });
  const c = new Controller({ ...quiet, party: ["pikachu", "squirtle", "snorlax", "gengar"], battleCooldown: 0 }, e.env);
  await e.settle();
  assert.deepEqual(c.cats.map((cat) => cat.size), [64, 64, 144, 144]);
  c.cats.forEach((cat, i) => { cat.cooldown = 0; cat.x = i < 2 ? 100 + i * 80 : 500 + (i - 2) * 160; cat.y = i < 2 ? 100 : 300; });
  e.tick(16); e.tick(16);
  assert.equal(c.arena.battles.length, 2);
  const huds = c.pets.map((p) => [p.hud.style.display, p.hud.style.width, p.hud.style.fontSize]);
  assert.deepEqual(huds, Array.from({ length: 4 }, () => ["block", "64px", "11px"]));
  const boxes = c.labels.map((l) => [l.element.style.display, l.element.style.width, l.element.style.fontSize]);
  assert.deepEqual(boxes, [["block", "320px", "13px"], ["block", "320px", "13px"]]);
  // Still centred on each sprite, large or small.
  c.pets.forEach((p) => assert.equal(/translate\((-?\d+)px/.exec(p.hud.style.transform)[1], String(Math.round(p.cat.x + (p.cat.size - 64) / 2))));
  c.destroy();
  const scaled = environment({ sprites: { "0025": fighterXml, "0007": fighterXml } }), s3 = new Controller({ ...quiet, scale: 3, party: ["pikachu", "squirtle"] }, scaled.env);
  await scaled.settle(); s3.cats.forEach((cat) => { cat.cooldown = 0; }); s3.cats[1].x = s3.cats[0].x + 110; s3.cats[1].y = s3.cats[0].y;
  scaled.tick(16); scaled.tick(16);
  assert.deepEqual([s3.pets[0].hud.style.width, s3.pets[0].hud.style.fontSize, s3.labels[0].element.style.width, s3.labels[0].element.style.fontSize], ["96px", "16px", "480px", "19px"]);
  s3.destroy();
  // Each size can be set outright.
  const custom = environment({ sprites: { "0025": fighterXml, "0007": fighterXml } });
  const k = new Controller({ ...quiet, party: ["pikachu", "squirtle"], nameSize: 20, hpBarWidth: 150, hpBarHeight: 12, textSize: 28, textBoxWidth: 640 }, custom.env);
  await custom.settle(); k.cats.forEach((cat) => { cat.cooldown = 0; }); k.cats[1].x = k.cats[0].x + 80; k.cats[1].y = k.cats[0].y;
  custom.tick(16); custom.tick(16);
  const hud = k.pets[0].hud.style, box = k.labels[0].element.style;
  assert.deepEqual([hud.width, hud.fontSize, k.pets[0].bar.style.height, box.width, box.fontSize], ["150px", "20px", "12px", "640px", "28px"]);
  assert.equal(/translate\((-?\d+)px/.exec(hud.transform)[1], String(Math.round(k.cats[0].x + (64 - 150) / 2)));
  k.destroy();
});

test("large sprites take up only the space they are drawn in: body, battle distance and nameplate", async () => {
  // 88 × 112 walk frames whose artwork fills just the top 82 × 61, as Sprite Collab sheets for big Pokémon do.
  const bigXml = `<AnimData><Anims>${anim("Walk", 88, 112, [4, 4])}${anim("Idle", 88, 112, [20, 4])}${anim("Sleep", 64, 48, [30, 30])}${anim("Attack", 96, 120, [2, 2, 4, 2], "<HitFrame>2</HitFrame>")}</Anims></AnimData>`;
  const withCanvas = (e) => {
    const plain = e.doc.createElement;
    e.doc.createElement = (tag) => (tag !== "canvas" ? plain(tag) : { getContext: () => ({
      drawImage(image) { this.image = image; },
      getImageData(x, y, w, h) { const data = new Uint8ClampedArray(w * h * 4); for (let py = 2; py < 63; py++) for (let px = 3; px < 85; px++) data[(py * w + px) * 4 + 3] = 255; return { data }; }
    }) });
  };
  const e = environment({ sprites: { "0095": bigXml, "0130": bigXml } }); withCanvas(e);
  const c = new Controller({ ...quiet, party: ["onix", "gyarados"], battleCooldown: 0 }, e.env);
  await e.settle();
  const [a, b] = c.cats;
  assert.equal(a.sprites.base, 82); assert.deepEqual(a.sprites.offset, { x: 0, y: -23.5 }); assert.equal(a.size, 164); // Not 224.
  // The 176 × 224 frame is placed so its drawn part sits exactly on the 164px body box.
  const frameX = /translate\((-?\d+)px, (-?\d+)px\)/.exec(c.pets[0].sprite.style.transform).slice(1).map(Number);
  assert.deepEqual(frameX, [Math.round(a.x + (164 - 176) / 2), Math.round(a.y + (164 - 224) / 2 + 47)]);
  assert.ok(Math.abs(frameX[1] + 4 - (a.y + (164 - 122) / 2)) <= 1, "artwork is vertically centred on the body");
  // A battle needs the bodies within battleRange of each other: 164 + 24 between centres, not 224 + 24.
  c.cats.forEach((cat) => { cat.cooldown = 0; cat.y = 300; }); a.x = 100; b.x = 100 + 164 + 30;
  e.tick(16); e.tick(16); assert.equal(c.arena.battles.length, 0);
  b.x = 100 + 164 + 20; e.tick(16); e.tick(16); assert.equal(c.arena.battles.length, 1);
  const hudY = Number(/translate\(-?\d+px, (-?\d+)px\)/.exec(c.pets[0].hud.style.transform)[1]);
  assert.ok(hudY < a.y && hudY > a.y - 164 * 0.25 - 40, "nameplate sits just above the drawn sprite");
  c.destroy();
  // Without a canvas the frame size is used, as before.
  const e2 = environment({ sprites: { "0095": bigXml } }), c2 = new Controller({ ...quiet, party: ["onix"] }, e2.env);
  await e2.settle(); assert.equal(c2.cats[0].size, 224); c2.destroy();
});

test("randomParty draws distinct Pokémon that have artwork; randomVariants draws one of their available sprites", async () => {
  const variants = require("../data/variants.json"), asked = [], hooks = (seed) => ({ random: seeded(seed), requestSprites: (id) => asked.push(id) });
  // A random party replaces `party`: the right number, no repeats, base sprites only.
  const e = environment(), c = new Controller({ ...quiet, party: ["mew"], randomParty: 30 }, e.env, undefined, hooks(5));
  await e.settle();
  assert.equal(c.pets.length, 30); assert.equal(new Set(c.pets.map((p) => p.member.species.num)).size, 30);
  for (const p of c.pets) { assert.equal(p.member.id, String(p.member.species.num).padStart(4, "0")); assert.ok(variants[p.member.species.num].includes(p.member.id)); }
  assert.ok(!c.pets.some((p) => p.cat.name === "Mew") || c.pets.length === 30);
  assert.deepEqual(asked, c.pets.map((p) => p.member.id)); // Each is then downloaded the usual way.
  c.destroy();
  // Different loads give different parties; the same random source gives the same one.
  const party = async (seed, config = {}) => { const env = environment(), k = new Controller({ ...quiet, randomParty: 8, autoDownload: false, ...config }, env.env, undefined, { random: seeded(seed) }); await env.settle(); const ids = k.pets.map((p) => p.member.id); k.destroy(); return ids; };
  assert.deepEqual(await party(1), await party(1)); assert.notDeepEqual(await party(1), await party(2));
  // With randomVariants each member gets any sprite path that exists for it, base included.
  const mixed = await party(7, { randomParty: 200, randomVariants: true });
  assert.equal(mixed.length, 200); assert.equal(new Set(mixed.map((id) => id.slice(0, 4))).size, 200);
  for (const id of mixed) assert.ok(variants[Number(id.slice(0, 4))].includes(id), id);
  assert.ok(mixed.some((id) => id.length > 4) && mixed.some((id) => id.length === 4)); assert.ok(mixed.some((id) => /^\d{4}\/0000\/0001$/.test(id)), "some are shiny");
  // More than exist: everyone appears before anyone repeats.
  const all = Object.keys(variants).length, many = await party(3, { randomParty: all + 5, randomVariants: true });
  assert.equal(many.length, all + 5); assert.equal(new Set(many.slice(0, all).map((id) => id.slice(0, 4))).size, all);
  // randomVariants also applies to a listed party, except where a sprite or shiny is given.
  const picks = new Set();
  for (let seed = 1; seed <= 25; seed++) {
    const env = environment(), k = new Controller({ ...quiet, randomVariants: true, autoDownload: false, party: ["pikachu", { pokemon: "pikachu", sprite: "25/6" }, { pokemon: "pikachu", shiny: true }] }, env.env, undefined, { random: seeded(seed) });
    await env.settle(); const ids = k.pets.map((p) => p.member.id); k.destroy();
    assert.ok(variants[25].includes(ids[0])); picks.add(ids[0]); assert.deepEqual(ids.slice(1), ["0025/0006", "0025/0000/0001"]);
  }
  assert.ok(picks.size >= 4, [...picks].join(" "));
  // Without the variant list, random parties still work (any species, base sprite) and randomVariants does nothing.
  const bare = environment({ variants: null }), b = new Controller({ ...quiet, randomParty: 5, randomVariants: true, autoDownload: false }, bare.env, undefined, { random: seeded(4) });
  await bare.settle(); assert.equal(b.pets.length, 5); assert.ok(b.pets.every((p) => p.member.id.length === 4)); b.destroy();
});

test("a party can be any size", async () => {
  const e = environment({ sprites: { "0025": fighterXml } });
  const c = new Controller({ ...quiet, party: new Array(40).fill("pikachu"), battles: false }, e.env);
  await e.settle();
  assert.equal(c.pets.length, 40); assert.ok(c.cats.every((cat) => cat.sprites.format === "pmd"));
  assert.equal(new Set(c.cats.map((cat) => Math.round(cat.x))).size, 40); // Spread across the width.
  for (let i = 0; i < 20; i++) e.tick(16);
  c.destroy();
});

test("commands, visibility, reduced motion and avoided modules", async () => {
  const e = environment({ sprites });
  const panel = { getBoundingClientRect: () => ({ left: 100, top: 100, right: 300, bottom: 200, width: 200, height: 100 }), contains: () => false, nodeType: 1, css: {} };
  e.env.elements[".module.clock"] = [panel];
  const c = new Controller({ ...quiet, party: ["pikachu", "squirtle"], avoid: ["clock"] }, e.env);
  await e.settle(); e.tick(16);
  assert.ok(e.selectors.includes(".module.clock")); assert.equal(c.cats[0].obstacles.length, 1);
  assert.equal(c.receive("POKEMON_SET_MODE", { mode: "mouse" }), true); assert.ok(c.cats.every((cat) => cat.mode === "mouse"));
  e.doc.emit("pointermove", { pointerType: "mouse", clientX: 500, clientY: 400 }); assert.ok(c.cats.every((cat) => cat.target));
  assert.equal(c.receive("POKEMON_GO_TO_REGION", { region: "top_left" }), true); assert.ok(c.cats.every((cat) => cat.region === "top_left"));
  assert.equal(c.receive("POKEMON_HIDE"), true); assert.equal(c.element.style.display, "none"); assert.equal(e.timers.size, 0);
  assert.equal(c.receive("POKEMON_SHOW"), true); assert.equal(c.element.style.display, "block"); assert.equal(e.timers.size, 1);
  c.receive("POKEMON_PAUSE"); assert.equal(e.timers.size, 0); c.receive("POKEMON_RESUME"); assert.equal(e.timers.size, 1);
  assert.equal(c.receive("NEKO_HIDE"), false); assert.equal(c.receive("POKEMON_SET_MODE", { mode: "x" }), false);
  c.suspend(); assert.equal(e.timers.size, 0); c.resume(); assert.equal(e.timers.size, 1);
  e.env.innerWidth = 400; e.env.emit("resize"); assert.ok(c.cats.every((cat) => cat.x <= 400));
  e.media.matches = true; c.config.reducedMotion = "auto"; e.media.emit("change"); assert.equal(e.timers.size, 0);
  assert.equal(c.pets[0].sprite.style.backgroundImage, 'url("sprites/0025/Sleep-Anim.png")'); // A still, resting sprite.
  c.destroy(); assert.equal(c.receive("POKEMON_SHOW"), false);
});

test("the module wires configuration, data URLs and the download request to the controller", async () => {
  const e = environment({ sprites: {} }); let registered; const sent = [];
  const urls = []; e.env.fetch = ((inner) => (url) => { urls.push(url); return inner(url.replace(/^m\//, "")); })(e.env.fetch);
  const context = { Module: { register: (name, def) => { registered = { name, def }; } }, PkEngine: Engine, PkController: Controller, window: e.env };
  vm.runInNewContext(fs.readFileSync(require.resolve("../MMM-Pokemon.js"), "utf8"), context);
  assert.equal(registered.name, "MMM-Pokemon");
  assert.deepEqual(JSON.parse(JSON.stringify(registered.def.defaults)), JSON.parse(JSON.stringify(Engine.defaults)));
  const m = Object.assign(Object.create(registered.def), { config: { ...registered.def.defaults, party: ["eevee"], scale: 99 }, file: (p) => `m/${p}`, sendSocketNotification: (name, payload) => sent.push([name, payload]) });
  assert.deepEqual([...m.getScripts()], ["pk-sprites", "pk-engine", "pk-mechanics", "pk-battle", "pk-controller"].map((n) => `m/lib/${n}.js`)); assert.deepEqual([...m.getStyles()], ["m/MMM-Pokemon.css"]);
  m.start(); assert.equal(m.config.scale, 2); assert.equal(m.getDom(), m.pk.element);
  await e.settle();
  assert.deepEqual(urls.slice(0, 4), ["m/data/moves.json", "m/data/pokedex.json", "m/data/variants.json", "m/sprites/0133/AnimData.xml"]);
  assert.equal(JSON.stringify(sent), JSON.stringify([["POKEMON_FETCH_SPRITES", { id: "0133" }]]));
  m.socketNotificationReceived("OTHER", {}); m.socketNotificationReceived("POKEMON_SPRITES", { folder: "0133", ok: true }); await e.settle();
  assert.equal(urls.filter((u) => u === "m/sprites/0133/AnimData.xml").length, 2);
  m.notificationReceived("POKEMON_HIDE"); assert.equal(m.pk.hidden, true);
  m.suspend(); m.resume(); const first = m.pk; m.start(); assert.equal(first.destroyed, true); m.stop(); assert.equal(m.pk.destroyed, true);
});

test("the sprite downloader validates ids, saves a folder, reuses it, and fails cleanly", async () => {
  const { fetchSprite, folderOf, ID } = require("../lib/collab.js");
  for (const good of ["0025", "0025/0000/0001", "0003/0001/0000/0002"]) assert.ok(ID.test(good));
  for (const bad of ["25", "../0025", "0025/..", "0025/0000/0001/0002/0003", "0025/", "abcd", ""]) assert.ok(!ID.test(bad), bad);
  assert.equal(folderOf("0025/0000/0001"), "0025-0000-0001");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pk-")), original = globalThis.fetch, asked = [];
  const png = Buffer.from("png");
  globalThis.fetch = async (url) => {
    asked.push(url.replace(/^.*\/sprite\//, ""));
    const file = url.split("/").pop(), body = file === "AnimData.xml" ? Buffer.from(fighterXml) : file === "credits.txt" && !url.includes("/0000/") ? Buffer.from("credits") : /^(?!Kick)[A-Za-z]+-Anim\.png$/.test(file) ? png : null;
    return body ? { ok: true, arrayBuffer: async () => body } : { ok: false, status: 404 };
  };
  try {
    await assert.rejects(fetchSprite("../etc", root), /invalid sprite id/);
    const skipped = [], result = await fetchSprite("0025/0000/0001", root, (t) => skipped.push(t));
    const count = Object.keys(sizes(fighterXml)).length;
    assert.deepEqual(result, { folder: "0025-0000-0001", saved: count - 1, cached: false }); assert.match(skipped[0], /Kick-Anim\.png: HTTP 404/);
    const dir = path.join(root, "0025-0000-0001");
    assert.equal(fs.readFileSync(path.join(dir, "credits.txt"), "utf8"), "credits"); // Found on the base form.
    assert.ok(fs.existsSync(path.join(dir, "Walk-Anim.png"))); assert.equal(fs.readFileSync(path.join(dir, "AnimData.xml"), "utf8"), fighterXml);
    assert.ok(asked.every((p) => p.startsWith("0025")));
    const before = asked.length; assert.deepEqual(await fetchSprite("0025/0000/0001", root), { folder: "0025-0000-0001", saved: 0, cached: true }); assert.equal(asked.length, before);
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    await assert.rejects(fetchSprite("0999", root), /AnimData\.xml: HTTP 404/); assert.equal(fs.existsSync(path.join(root, "0999")), false);
  } finally { globalThis.fetch = original; fs.rmSync(root, { recursive: true, force: true }); }
});
