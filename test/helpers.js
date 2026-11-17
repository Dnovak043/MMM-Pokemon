"use strict";
/* Shared fixtures: an invented sprite (no third-party artwork is shipped or
 * needed), the bundled game data, and a fake browser environment. */
const fs = require("node:fs");
const path = require("node:path");
const Sprites = require("../lib/pk-sprites.js");
const Mechanics = require("../lib/pk-mechanics.js");

const moves = require("../data/moves.json"), pokedex = require("../data/pokedex.json");
const data = { moves };
const species = new Map();
for (const entry of pokedex.species) { const s = { ...entry, moves: entry.moves.map((i) => pokedex.moves[i]) }; species.set(s.id, s); species.set(s.num, s); }

const anim = (name, w, h, ticks, extra = "") => `<Anim><Name>${name}</Name><FrameWidth>${w}</FrameWidth><FrameHeight>${h}</FrameHeight>${extra}<Durations>${ticks.map((t) => `<Duration>${t}</Duration>`).join("")}</Durations></Anim>`;
const core = anim("Walk", 32, 32, [6, 8, 6, 8]) + anim("Idle", 32, 40, [12, 8, 8, 8]) + anim("Sleep", 32, 24, [30, 35]);
const fighterXml = `<AnimData><Anims>${core}${anim("Attack", 64, 64, [2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 2], "<HitFrame>6</HitFrame>")}
  ${anim("Kick", 56, 56, [2, 6, 2, 4, 2, 2], "<HitFrame>3</HitFrame>")}${anim("Shoot", 48, 48, [2, 2, 4, 6, 2, 2], "<HitFrame>3</HitFrame>")}
  ${anim("Charge", 32, 40, [2, 2, 2, 2, 2, 2, 2, 2, 2, 2])}${anim("Hurt", 48, 56, [2, 8])}${anim("Faint", 32, 32, [8, 12, 4, 10])}
  ${anim("Pose", 32, 40, [12, 2, 8])}${anim("Wake", 40, 32, [8, 6, 14])}${anim("Twirl", 32, 32, [3, 3, 3])}${anim("Hop", 32, 88, [2, 1, 2, 3, 4, 4, 3, 2, 1, 2], "<HitFrame>9</HitFrame>")}</Anims></AnimData>`;
const plainXml = `<AnimData><Anims>${core}</Anims></AnimData>`;
const sizes = (xml, missing = []) => {
  const out = {};
  for (const entry of Sprites.parseAnimData(xml)) if (!missing.includes(entry.file)) out[entry.file] = { width: entry.w * entry.ticks.length, height: entry.h * (entry.file === "Sleep" ? 1 : 8) };
  return out;
};
function pmd(xml = fighterXml, skip = []) {
  const images = {};
  for (const [file, size] of Object.entries(sizes(xml))) images[file] = { url: `${file}-Anim.png`, ...size };
  return Sprites.pmd(Sprites.parseAnimData(xml), images, skip);
}
function seeded(seed = 1) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
/* A fight whose moves are scripted: `plan` maps a round number to [moveA, moveB];
 * otherwise each side uses its first listed move. rng defaults to a steady 0.5. */
function duel(a, aMoves, b, bMoves, { level = 50, levelB = level, rng = () => 0.5, plan = {} } = {}) {
  const fight = new Mechanics.Fight(Mechanics.createMon(species.get(a), level, aMoves, data), Mechanics.createMon(species.get(b), levelB, bMoves, data), data, rng);
  fight.choose = (mon) => { const i = fight.idx(mon), id = (plan[fight.turn] || [])[i] || [aMoves, bMoves][i][0]; return moves[id]; };
  return fight;
}
const texts = (events) => events.filter((e) => e.e === "text").map((e) => e.text);

/* Fake browser. `sprites` maps a folder name to its AnimData XML; images load
 * automatically with the sizes that XML implies. */
function environment({ sprites = {}, serveData = true, missing = [], variants = require("../data/variants.json") } = {}) {
  const records = new Set(), images = [], timers = new Map(), frames = new Map(), made = [], requests = [], warnings = [], selectors = [], signals = [];
  class Target {
    addEventListener(name, fn, options) { records.add({ target: this, name, fn, options }); }
    removeEventListener(name, fn) { for (const r of records) if (r.target === this && r.name === name && r.fn === fn) records.delete(r); }
    emit(name, event = {}) { for (const r of [...records]) if (r.target === this && r.name === name) r.fn(event); }
  }
  class Image extends Target {
    constructor() { super(); images.push(this); }
    set src(url) {
      this.url = url;
      const match = /sprites\/([^/]+)\/([A-Za-z0-9_]+)-Anim\.png$/.exec(url), xml = match && sprites[match[1]];
      const size = xml && sizes(xml, missing)[match[2]];
      queueMicrotask(() => { if (size) { this.naturalWidth = size.width; this.naturalHeight = size.height; this.emit("load"); } else this.emit("error"); });
    }
    get src() { return this.url; }
  }
  const env = new Target(), doc = new Target(), media = new Target();
  let time = 0, next = 0;
  doc.querySelector = () => null; doc.querySelectorAll = (selector) => { selectors.push(selector); return env.elements[selector] || []; };
  doc.createElement = () => { const el = { style: {}, children: [], attrs: {}, contains: () => false, setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); c.parent = this; }, remove() { this.removed = true; } }; made.push(el); return el; };
  const respond = (body, json) => Promise.resolve(body === undefined ? { ok: false, text: () => Promise.resolve(""), json: () => Promise.reject(new Error("404")) }
    : { ok: true, text: () => Promise.resolve(body), json: () => Promise.resolve(json) });
  Object.assign(env, { Image, document: doc, innerWidth: 1000, innerHeight: 600, elements: {}, performance: { now: () => time }, matchMedia: () => media,
    console: { warn: (text) => warnings.push(text) }, getComputedStyle: (node) => node.css || {},
    setTimeout: (fn) => { timers.set(++next, fn); return next; }, clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (fn) => { frames.set(++next, fn); return next; }, cancelAnimationFrame: (id) => frames.delete(id),
    AbortController,
    fetch: (url, options) => {
      requests.push(url); if (options && options.signal) signals.push(options.signal);
      if (url === "data/moves.json") return serveData ? respond("", moves) : respond();
      if (url === "data/pokedex.json") return serveData ? respond("", pokedex) : respond();
      if (url === "data/variants.json") return serveData && variants ? respond("", variants) : respond();
      const match = /^sprites\/([^/]+)\/AnimData\.xml$/.exec(url);
      return respond(match ? sprites[match[1]] : undefined);
    } });
  const tick = (ms = 16) => { time += ms; const pending = [...timers.values(), ...frames.values()]; timers.clear(); frames.clear(); pending.forEach((fn) => fn()); };
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve)); };
  return { env, doc, media, images, timers, frames, records, made, requests, warnings, selectors, signals, tick, settle };
}
module.exports = { fs, path, moves, pokedex, data, species, anim, fighterXml, plainXml, sizes, pmd, seeded, duel, texts, environment };
