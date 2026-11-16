"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Sprites = require("../lib/pk-sprites.js");
const { Mon } = require("../lib/pk-engine.js");

const anim = (name, w, h, ticks, extra = "") => `<Anim><Name>${name}</Name><Index>0</Index><FrameWidth>${w}</FrameWidth><FrameHeight>${h}</FrameHeight>${extra}<Durations>${ticks.map((t) => `<Duration>${t}</Duration>`).join("")}</Durations></Anim>`;
/* Two invented creatures with different actions, frame sizes and frame counts. */
const creatures = {
  small: {
    xml: `<?xml version="1.0" ?><AnimData><ShadowSize>1</ShadowSize><Anims>
      ${anim("Walk", 32, 32, [6, 8, 6, 8])}${anim("Idle", 32, 40, [12, 8, 8, 8])}${anim("Sleep", 32, 24, [30, 35])}
      ${anim("Attack", 64, 64, [2, 2, 4, 2, 2], "<RushFrame>2</RushFrame>")}
      <Anim><Name>Shoot</Name><Index>3</Index><CopyOf>Attack</CopyOf></Anim>
      ${anim("Hop", 32, 88, [2, 1, 2, 3, 4, 4, 3, 2, 1, 2])}${anim("Wake", 40, 32, [8, 6, 14, 4, 10])}
      ${anim("Laying", 24, 24, [12])}${anim("EventSleep", 24, 24, [30, 35])}${anim("Head", 24, 40, [4])}
      </Anims></AnimData>`,
    rows: { Sleep: 1 }
  },
  large: {
    xml: `<AnimData><Anims>${anim("Walk", 48, 64, [4, 4, 4, 4, 4, 4, 4, 4])}${anim("Idle", 56, 64, [40, 2, 3, 3, 3, 2])}
      ${anim("Sleep", 48, 40, [30, 35, 30])}${anim("Twirl", 72, 72, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3])}
      ${anim("Missing", 32, 32, [5, 5])}</Anims></AnimData>`,
    rows: { Sleep: 1 }, absent: ["Missing"]
  }
};
function build(creature, skip) {
  const list = Sprites.parseAnimData(creature.xml), images = {};
  for (const entry of list) {
    if ((creature.absent || []).includes(entry.file)) continue;
    images[entry.file] = { url: `dir/${entry.file}-Anim.png`, width: entry.w * entry.ticks.length, height: entry.h * (creature.rows[entry.file] || 8) };
  }
  return { list, images, set: Sprites.pmd(list, images, skip) };
}

test("AnimData is parsed defensively and CopyOf resolves to its source sheet", () => {
  const list = Sprites.parseAnimData(creatures.small.xml);
  assert.deepEqual(list.map((a) => a.name), ["Walk", "Idle", "Sleep", "Attack", "Shoot", "Hop", "Wake", "Laying", "EventSleep", "Head"]);
  assert.deepEqual(list.find((a) => a.name === "Shoot"), { name: "Shoot", file: "Attack", w: 64, h: 64, ticks: [2, 2, 4, 2, 2] });
  assert.deepEqual(list.find((a) => a.name === "Idle"), { name: "Idle", file: "Idle", w: 32, h: 40, ticks: [12, 8, 8, 8] });
  for (const bad of [null, 5, "", "<AnimData/>", "<Anim><Name>../x</Name></Anim>",
    anim("Zero", 0, 32, [1]), anim("Huge", 4096, 32, [1]), anim("NoFrames", 32, 32, []), anim("Slow", 32, 32, [99999]),
    "<Anim><Name>A</Name><CopyOf>Nowhere</CopyOf></Anim>",
    "<Anim><Name>A</Name><CopyOf>B</CopyOf></Anim><Anim><Name>B</Name><CopyOf>A</CopyOf></Anim>"]) {
    assert.deepEqual(Sprites.parseAnimData(bad), []);
  }
  assert.equal(Sprites.parseAnimData(anim("Walk", 32, 32, [1]) + anim("Walk", 8, 8, [2]))[0].w, 32); // First definition wins.
});
test("PMD sets adapt to each creature's own actions, frame sizes and frame counts", () => {
  const small = build(creatures.small).set, large = build(creatures.large).set;
  assert.deepEqual(small.roles, { idle: "Idle", walk: "Walk", sleep: "Sleep", fidget: ["Attack", "Hop", "Head"], wake: "Wake", tired: "Laying", attack: [], victory: "Hop" });
  assert.deepEqual(large.roles, { idle: "Idle", walk: "Walk", sleep: "Sleep", fidget: ["Twirl"], attack: [] }); // The unloadable action is dropped.
  assert.equal(small.base, 32); assert.equal(large.base, 64);
  assert.equal(small.sheets.length, 9); // Shoot shares Attack's sheet.
  assert.equal(small.anims.Shoot.sheet, small.anims.Attack.sheet);
  // Every frame of every action is reachable, at its own duration.
  for (const set of [small, large]) {
    for (const [name, a] of Object.entries(set.anims)) {
      let t = 0;
      a.durations.forEach((seconds, i) => {
        for (const at of [t + 1e-6, t + seconds - 1e-6]) {
          const c = Sprites.cell(set, name, "E", at);
          assert.equal(c.index, i, `${name} frame ${i}`); assert.equal(c.x, i * a.w);
          assert.equal(c.y, a.rows === 8 ? 2 * a.h : 0);
          assert.ok(c.x + c.w <= set.sheets[c.sheet].width && c.y + c.h <= set.sheets[c.sheet].height);
        }
        t += seconds;
      });
      assert.ok(Math.abs(Sprites.total(a) - t) < 1e-9);
    }
  }
  assert.deepEqual(small.anims.Idle.durations, [12 / 60, 8 / 60, 8 / 60, 8 / 60]);
  assert.equal(large.anims.Walk.durations.length, 8); assert.equal(large.anims.Twirl.durations.length, 12);
  // Rows run S, SE, E, NE, N, NW, W, SW; single-row sheets ignore direction.
  Sprites.pmdRows.forEach((d, row) => assert.equal(Sprites.cell(small, "Walk", d, 0).y, row * 32));
  for (const d of Sprites.directions) assert.equal(Sprites.cell(small, "Sleep", d, 0).y, 0);
  // Short one-shots repeat whole passes to stay visible; long ones play exactly once.
  assert.ok(Math.abs(Sprites.playTime(small.anims.Head) - 9 * 4 / 60) < 1e-9);
  assert.ok(Math.abs(Sprites.playTime(small.anims.Hop) - 2 * 24 / 60) < 1e-9);
  assert.ok(Math.abs(Sprites.playTime(large.anims.Twirl) - 36 / 60) < 1e-9);
});
test("PMD sets need Walk and Idle, tolerate short sheets, missing naps and skipped actions", () => {
  const { list, images } = build(creatures.small);
  for (const required of ["Walk", "Idle"]) { const rest = { ...images }; delete rest[required]; assert.equal(Sprites.pmd(list, rest), null); }
  assert.equal(Sprites.pmd(list, {}), null); assert.equal(Sprites.pmd(null, null), null);
  const noSleep = { ...images }; delete noSleep.Sleep;
  assert.equal(Sprites.pmd(list, noSleep).roles.sleep, "EventSleep");
  delete noSleep.EventSleep;
  const laying = Sprites.pmd(list, noSleep).roles;
  assert.equal(laying.sleep, "Laying"); assert.equal(laying.tired, undefined);
  delete noSleep.Laying; assert.equal(Sprites.pmd(list, noSleep).roles.sleep, "Idle");
  const short = { ...images, Hop: { ...images.Hop, width: 32 * 7 + 5 } };
  assert.equal(Sprites.pmd(list, short).anims.Hop.durations.length, 7);
  assert.deepEqual(build(creatures.small, ["hop", "ATTACK"]).set.roles.fidget, ["Head"]);
  assert.deepEqual(build(creatures.small, ["Hop", "Attack", "Head", "Walk"]).set.roles.fidget, []);
});
test("a PMD creature idles, plays each of its own actions in full, walks, naps and wakes", () => {
  const values = [0.1, 0.9, 0.5, 0.3, 0.7]; let n = 0;
  const cat = new Mon({ scale: 1, idleMin: 1, idleMax: 1, sleepAfter: 20, sleepDuration: 2, speed: 200 }, () => values[n++ % values.length]);
  cat.resize(800, 600); cat.x = 300; cat.y = 300;
  const set = build(creatures.small).set;
  cat.setSprites(set);
  assert.equal(cat.size, 32); assert.equal(cat.direction, "S");
  const shown = new Map(), states = new Set();
  for (let i = 0; i < 60 * 120; i++) {
    cat.step(1 / 60); states.add(cat.state);
    const f = cat.frame();
    if (!shown.has(f.anim)) shown.set(f.anim, new Set());
    shown.get(f.anim).add(f.index);
    assert.ok(f.x + f.w <= set.sheets[f.sheet].width && f.y + f.h <= set.sheets[f.sheet].height);
    if (cat.state === "walk" || cat.state === "push") assert.equal(f.anim, "Walk");
    if (cat.state === "idle") assert.equal(f.anim, "Idle");
    if (cat.state === "sleep") assert.equal(f.anim, "Sleep");
  }
  assert.deepEqual([...states].sort(), ["fidget", "idle", "sleep", "tired", "wake", "walk"]);
  // Everything the creature has was used, and every frame of each was displayed.
  for (const name of ["Walk", "Idle", "Sleep", "Wake", "Laying", "Attack", "Hop", "Head"]) {
    assert.equal(shown.get(name)?.size, set.anims[name].durations.length, name);
  }
  assert.equal(shown.has("EventSleep"), false);
  // Swapping artwork mid-run keeps the body centred and the behavior alive.
  const centre = [cat.x + cat.size / 2, cat.y + cat.size / 2];
  cat.setSprites(build(creatures.large).set);
  assert.equal(cat.size, 64);
  if (cat.x > cat.minX && cat.x < cat.maxX && cat.y > cat.minY && cat.y < cat.maxY) assert.deepEqual([cat.x + 32, cat.y + 32], centre);
  for (let i = 0; i < 60 * 60; i++) { cat.step(1 / 60); assert.ok(["Walk", "Idle", "Sleep", "Twirl"].includes(cat.frame().anim)); }
  assert.equal(cat.setSprites(null), false); assert.equal(cat.setSprites({ roles: { idle: "x", walk: "y" }, anims: {} }), false);
  assert.equal(cat.sprites.format, "pmd");
});

test("hit frames become hit times, and the placeholder set is a silent 32px body", () => {
  const xml = anim("Walk", 32, 32, [4, 4]) + anim("Idle", 32, 32, [4]) + anim("Attack", 64, 64, [2, 2, 4, 2, 2], "<RushFrame>1</RushFrame><HitFrame>3</HitFrame>") +
    `<Anim><Name>Strike</Name><CopyOf>Attack</CopyOf></Anim>` + anim("Hurt", 48, 48, [2, 8]) + anim("Faint", 32, 32, [8, 8]) + anim("Odd", 32, 32, [2, 2], "<HitFrame>9</HitFrame>");
  const list = Sprites.parseAnimData(xml), images = {};
  for (const e of list) images[e.file] = { url: e.file, width: e.w * e.ticks.length, height: e.h * 8 };
  assert.equal(list.find((e) => e.name === "Attack").hit, 3); assert.equal(list.find((e) => e.name === "Strike").hit, 3);
  assert.equal(list.find((e) => e.name === "Odd").hit, undefined); // Out of range.
  const set = Sprites.pmd(list, images);
  assert.ok(Math.abs(set.anims.Attack.hit - 8 / 60) < 1e-9);
  assert.deepEqual(set.roles.attack, ["Attack"]); assert.equal(set.roles.hurt, "Hurt"); assert.equal(set.roles.faint, "Faint");
  const blank = Sprites.placeholder();
  assert.equal(blank.format, "placeholder"); assert.equal(blank.base, 32); assert.deepEqual(blank.roles.attack, []);
  for (const name of Object.keys(blank.anims)) assert.deepEqual(Sprites.cell(blank, name, "E", 0.3), { anim: name, index: name === "idle" || name === "sleep" ? 0 : 1, sheet: 0, x: 0, y: 0, w: 32, h: 32 });
});
