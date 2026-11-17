"use strict";
/* suspend() must leave nothing running: no timer, no listener, no load in the
 * browser and no download in the node helper. resume() starts it all again. */
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const vm = require("node:vm");
const Engine = require("../lib/pk-engine.js");
const Controller = require("../lib/pk-controller.js");
const { fs, path, fighterXml, sizes, environment } = require("./helpers.js");

const sprites = { "0025": fighterXml, "0007": fighterXml };
const quiet = { idleMin: 300, idleMax: 300, sleepAfter: 3600, reducedMotion: "never", party: ["pikachu", "squirtle"] };
const sheets = Object.keys(sizes(fighterXml)).length;

test("suspend stops the clock and removes every listener; resume restores both", async () => {
  const e = environment({ sprites }), c = new Controller(quiet, e.env);
  await e.settle(); e.tick(16);
  const listeners = e.records.size;
  assert.equal(e.timers.size, 1); assert.ok(listeners >= 8);

  c.suspend();
  assert.equal(e.timers.size, 0); assert.equal(e.frames.size, 0); assert.equal(e.records.size, 0); assert.equal(c.loads.size, 0);
  // Nothing can wake it: browser events have no listener, and ticking the clock runs nothing.
  const before = JSON.stringify(c.pets.map((p) => p.sprite.style)), x = c.cats.map((cat) => cat.x);
  e.env.innerWidth = 400; e.env.emit("resize"); e.doc.emit("visibilitychange"); e.env.emit("pageshow"); e.media.emit("change");
  e.doc.emit("pointermove", { pointerType: "mouse", clientX: 5, clientY: 5 });
  e.tick(1000); await e.settle();
  assert.equal(e.timers.size, 0); assert.equal(e.frames.size, 0);
  assert.equal(JSON.stringify(c.pets.map((p) => p.sprite.style)), before); assert.deepEqual(c.cats.map((cat) => cat.x), x);
  c.suspend(); assert.equal(e.records.size, 0); // Suspending twice is harmless.

  c.resume();
  assert.equal(e.timers.size, 1); assert.equal(e.records.size, listeners);
  assert.ok(c.cats.every((cat) => cat.x <= 400)); // Caught up with the resize it did not hear.
  c.resume(); assert.equal(e.timers.size, 1); assert.equal(e.records.size, listeners); // So is resuming twice.
  e.tick(16); assert.equal(e.timers.size, 1);
  c.destroy(); assert.equal(e.records.size, 0);
});

test("suspending while the game data loads aborts it; resume loads it again", async () => {
  const e = environment({ sprites }), c = new Controller(quiet, e.env);
  assert.equal(e.requests.length, 3); assert.ok(e.signals.length === 3 && e.signals.every((s) => !s.aborted));
  c.suspend();
  assert.ok(e.signals.every((s) => s.aborted));
  await e.settle();
  assert.equal(c.pets.length, 0); assert.equal(c.data, null); assert.equal(e.requests.length, 3); // The late answer was ignored.
  c.resume(); await e.settle();
  assert.equal(c.pets.length, 2); assert.deepEqual(c.cats.map((cat) => cat.sprites.format), ["pmd", "pmd"]);
  assert.equal(e.requests.filter((u) => u === "data/moves.json").length, 2);
  c.destroy();
});

test("suspending while artwork loads stops the images; resume loads them again", async () => {
  const e = environment({ sprites }), Image = e.env.Image, slow = [];
  // Images that never finish on their own: the downloads are still running when the module is suspended.
  e.env.Image = class extends Image { set src(url) { this.url = url; if (url) slow.push(this); } get src() { return this.url; } };
  const c = new Controller(quiet, e.env);
  await e.settle();
  assert.equal(slow.length, 2 * sheets); assert.equal(c.loads.size, 2 * sheets);
  const calls = e.requests.length;
  c.suspend();
  assert.equal(c.loads.size, 0); assert.equal(e.records.size, 0);
  assert.ok(slow.every((image) => image.src === "")); // Each download was told to stop.
  for (const image of slow) { image.naturalWidth = 256; image.naturalHeight = 256; image.emit("load"); } // A late answer changes nothing.
  await e.settle();
  assert.ok(c.cats.every((cat) => cat.sprites.format !== "pmd")); assert.equal(slow.length, 2 * sheets); assert.equal(e.requests.length, calls);
  e.env.Image = Image;
  c.resume(); await e.settle();
  assert.deepEqual(c.cats.map((cat) => cat.sprites.format), ["pmd", "pmd"]); assert.equal(e.requests.filter((u) => u === "data/moves.json").length, 1);
  assert.equal(c.loads.size, 0); assert.equal(c.pets[0].sprite.style.display, "block");
  c.destroy();
});

test("a suspended module asks for no downloads and ignores finished ones until it resumes", async () => {
  const e = environment({ sprites: {} }), asked = [], fetch = e.env.fetch, held = [];
  // Hold the answer to the first AnimData.xml request until after the module is suspended.
  e.env.fetch = (url, options) => (url.endsWith(".xml") && !held.length ? new Promise((resolve) => { held.push(() => resolve(fetch(url, options))); }) : fetch(url, options));
  const c = new Controller({ ...quiet, party: ["pikachu"] }, e.env, undefined, { requestSprites: (id) => asked.push(id) });
  await e.settle(); assert.equal(held.length, 1);
  c.suspend(); held[0](); await e.settle();
  assert.deepEqual(asked, []); // The missing artwork was never reported, so nothing was requested.
  const calls = e.requests.length;
  c.spritesReady("0025", true); await e.settle(); assert.equal(e.requests.length, calls);
  c.resume(); await e.settle();
  assert.deepEqual(asked, ["0025"]); assert.equal(e.requests.length, calls + 1);
  c.destroy();
});

test("commands received while suspended are remembered without drawing or measuring", async () => {
  const e = environment({ sprites }), c = new Controller(quiet, e.env);
  await e.settle();
  let measured = 0; e.doc.querySelector = () => { measured++; return null; };
  c.suspend();
  assert.equal(c.receive("POKEMON_SET_MODE", { mode: "mouse" }), true); assert.equal(c.receive("POKEMON_GO_TO_REGION", { region: "top_left" }), true);
  assert.equal(c.receive("POKEMON_HIDE"), true);
  assert.equal(e.timers.size, 0); assert.equal(measured, 0); assert.equal(c.element.style.display, "block"); // Not drawn yet.
  c.resume();
  assert.ok(c.cats.every((cat) => cat.region === "top_left")); assert.equal(measured, 2); // Measured once per sprite, on resume.
  assert.equal(c.element.style.display, "none"); assert.equal(e.timers.size, 0); // Still hidden by POKEMON_HIDE.
  c.receive("POKEMON_SHOW"); assert.equal(e.timers.size, 1);
  c.destroy();
});

test("the module tells the node helper when it is suspended and resumed", () => {
  const e = environment({ sprites }); let def; const sent = [];
  const context = { Module: { register: (name, d) => { def = d; } }, PkEngine: Engine, PkController: Controller, window: e.env };
  vm.runInNewContext(fs.readFileSync(require.resolve("../MMM-Pokemon.js"), "utf8"), context);
  const m = Object.assign(Object.create(def), { config: { ...def.defaults }, file: (p) => p, sendSocketNotification: (name) => sent.push(name) });
  m.start(); m.suspend(); assert.equal(m.pk.suspended, true); m.resume(); assert.equal(m.pk.suspended, false);
  assert.deepEqual(sent, ["POKEMON_SUSPENDED", "POKEMON_RESUMED"]);
  m.stop();
});

/* node_helper.js with MagicMirror's `node_helper` and the downloader replaced. */
function helper(fetchSprite) {
  const source = fs.readFileSync(require.resolve("../node_helper.js"), "utf8"), mod = { exports: {} }, sent = [];
  const fake = (name) => (name === "node_helper" ? { create: (def) => def } : name === "./lib/collab.js" ? { ...require("../lib/collab.js"), fetchSprite } : require(name));
  new Function("require", "module", "__dirname", source)(fake, mod, "/mm");
  const h = Object.assign(mod.exports, { sendSocketNotification: (name, payload) => sent.push([name, payload]) });
  h.start();
  return { h, sent };
}
const turn = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve)); };

test("the node helper aborts the download in progress on suspend, waits, and starts again on resume", async () => {
  const calls = [];
  // A download that only ends when the test finishes it, or when it is aborted.
  const { h, sent } = helper((id, root, log, signal) => new Promise((resolve, reject) => {
    const call = { id, signal, finish: () => resolve({ folder: id, saved: 1, cached: false }) };
    calls.push(call);
    signal.addEventListener("abort", () => reject(signal.reason));
  }));
  const log = console.log, error = console.error, errors = []; console.log = () => {}; console.error = (text) => errors.push(text);
  try {
    h.socketNotificationReceived("POKEMON_FETCH_SPRITES", { id: "0025" }); h.socketNotificationReceived("POKEMON_FETCH_SPRITES", { id: "0007" });
    await turn(); assert.deepEqual(calls.map((c) => c.id), ["0025"]);

    h.socketNotificationReceived("POKEMON_SUSPENDED"); await turn();
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(calls.length, 1); assert.deepEqual(sent, []); assert.deepEqual(errors, []); // Waiting: no retry, no report, no failure.

    h.socketNotificationReceived("POKEMON_RESUMED"); await turn();
    assert.deepEqual(calls.map((c) => c.id), ["0025", "0025"]); assert.equal(calls[1].signal.aborted, false); // The interrupted sprite starts again.
    calls[1].finish(); await turn();
    assert.deepEqual(calls.map((c) => c.id), ["0025", "0025", "0007"]);
    calls[2].finish(); await turn();
    assert.deepEqual(sent, [["POKEMON_SPRITES", { folder: "0025", ok: true }], ["POKEMON_SPRITES", { folder: "0007", ok: true }]]);

    // Suspended while idle: a later request is from a module that is showing, so the queue runs.
    h.socketNotificationReceived("POKEMON_SUSPENDED"); h.socketNotificationReceived("POKEMON_FETCH_SPRITES", { id: "0001" });
    await turn(); assert.equal(calls.length, 4); calls[3].finish(); await turn(); assert.equal(sent.length, 3);
  } finally { console.log = log; console.error = error; }
});

test("an aborted sprite download rejects and leaves the folder to be fetched again", async () => {
  const { fetchSprite } = require("../lib/collab.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pk-")), original = globalThis.fetch, aborter = new AbortController();
  let pngs = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.signal, aborter.signal);
    if (options.signal.aborted) throw options.signal.reason;
    if (url.endsWith("AnimData.xml")) return { ok: true, arrayBuffer: async () => Buffer.from(fighterXml) };
    if (++pngs === 3) { aborter.abort(); throw aborter.signal.reason; } // Suspended during the third sheet.
    return { ok: true, arrayBuffer: async () => Buffer.from("png") };
  };
  try {
    await assert.rejects(fetchSprite("0025", root, undefined, aborter.signal), { name: "AbortError" });
    assert.equal(pngs, 3); // It did not carry on to the remaining sheets.
    assert.equal(fs.existsSync(path.join(root, "0025", "AnimData.xml")), false); // So the next attempt is not treated as cached.
    globalThis.fetch = async (url) => ({ ok: true, arrayBuffer: async () => Buffer.from(url.endsWith(".xml") ? fighterXml : "x") });
    assert.deepEqual(await fetchSprite("0025", root), { folder: "0025", saved: sheets, cached: false });
  } finally { globalThis.fetch = original; fs.rmSync(root, { recursive: true, force: true }); }
});

test("unloadOnSuspend releases the elements, artwork, party and data; resume loads everything afresh", async () => {
  const e = environment({ sprites }), asked = [];
  const c = new Controller({ ...quiet, unloadOnSuspend: true }, e.env, undefined, { requestSprites: (id) => asked.push(id) });
  await e.settle(); e.tick(16);
  const root = c.element, old = c.pets, oldCats = c.cats, arena = c.arena;
  assert.equal(old.length, 2); assert.ok(old.every((pet) => pet.sprite.style.backgroundImage.startsWith("url(")));
  c.receive("POKEMON_PAUSE");

  c.suspend();
  assert.equal(e.timers.size, 0); assert.equal(e.records.size, 0);
  assert.ok(old.every((pet) => pet.sprite.removed && pet.shield.removed && pet.hud.removed && pet.sprite.style.backgroundImage === "none"));
  assert.equal(c.pets.length, 0); assert.equal(c.cats.length, 0); assert.equal(c.labels.length, 0); assert.equal(c.dots.length, 0);
  assert.equal(c.data, null); assert.equal(c.species, null); assert.equal(c.variants, null);
  assert.notEqual(c.arena, arena); assert.notEqual(c.cats, oldCats); assert.equal(c.arena.cats, c.cats); assert.equal(c.arena.battles.length, 0);
  assert.equal(c.element, root); assert.notEqual(root.removed, true); // The module's own wrapper stays for MagicMirror.
  const calls = e.requests.length; e.tick(1000); await e.settle(); assert.equal(e.requests.length, calls);

  c.resume(); await e.settle();
  assert.equal(e.requests.filter((u) => u === "data/moves.json").length, 2); assert.equal(e.requests.filter((u) => u === "sprites/0025/AnimData.xml").length, 2);
  assert.equal(c.pets.length, 2); assert.ok(c.pets.every((pet) => !old.includes(pet) && !pet.sprite.removed));
  assert.deepEqual(c.cats.map((cat) => cat.sprites.format), ["pmd", "pmd"]); assert.equal(c.arena.data, c.data);
  assert.equal(c.paused, true); assert.equal(e.timers.size, 0); // The pause command survived the unload.
  c.receive("POKEMON_RESUME"); assert.equal(e.timers.size, 1); e.tick(16); assert.equal(c.pets[0].sprite.style.display, "block");
  c.suspend(); c.resume(); await e.settle(); assert.equal(c.pets.length, 2); // And again.
  c.destroy();
});

test("without unloadOnSuspend the party and its artwork are kept across a suspend", async () => {
  const e = environment({ sprites }), c = new Controller(quiet, e.env);
  await e.settle();
  const pets = [...c.pets], data = c.data, calls = e.requests.length;
  c.suspend(); c.resume(); await e.settle();
  assert.deepEqual(c.pets, pets); assert.equal(c.data, data); assert.equal(e.requests.length, calls);
  assert.ok(pets.every((pet) => !pet.sprite.removed));
  assert.equal(Engine.validateConfig({ unloadOnSuspend: "yes" }).config.unloadOnSuspend, false); assert.equal(Engine.validateConfig({ unloadOnSuspend: true }).config.unloadOnSuspend, true);
  c.destroy();
});
