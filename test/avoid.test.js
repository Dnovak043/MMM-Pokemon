"use strict";
const BASE = { scale: 1, sleepAfter: 60 }; // The sizes and timings these scenarios were written for.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Mon, validateConfig } = require("../lib/pk-engine.js");

const rect = (left, top, right, bottom, key = 1) => ({ left, top, right, bottom, key });
const overlaps = (cat, o, margin = 0) => cat.x + cat.size > o.left - margin + 0.02 && cat.x < o.right + margin - 0.02 &&
  cat.y + cat.size > o.top - margin + 0.02 && cat.y < o.bottom + margin - 0.02;
function place(cat, x, y) { cat.x = x; cat.y = y; }

test("avoid options validate strictly and are copied", () => {
  const list = ["MMM-Drawer"], result = validateConfig({ avoid: list, avoidMargin: 0 });
  assert.deepEqual(result.config.avoid, list); assert.notEqual(result.config.avoid, list);
  assert.equal(result.config.avoidMargin, 0);
  for (const avoid of ["MMM-Drawer", [""], [" "], [1], [null], Array(9).fill("a"), ["x".repeat(201)], {}]) {
    assert.deepEqual(validateConfig({ avoid }).config.avoid, []);
    assert.deepEqual(validateConfig({ avoid }).invalid, ["avoid"]);
  }
  for (const avoidMargin of [-1, 101, NaN, "4"]) assert.equal(validateConfig({ avoidMargin }).config.avoidMargin, 4);
});

test("a sliding panel pushes an idle sprite ahead of its leading border", () => {
  for (const [from, direction] of [["right", "W"], ["left", "E"], ["bottom", "N"], ["top", "S"]]) {
    const cat = new Mon({ ...BASE,  idleMin: 300, idleMax: 300, sleepAfter: 3600 }); cat.resize(1000, 600);
    place(cat, ...{ right: [800, 300], left: [168, 300], bottom: [500, 450], top: [500, 118] }[from]);
    const start = { x: cat.x, y: cat.y };
    let panel, touched = 0;
    for (let i = 0; i <= 40; i++) { // 10px per frame, far faster than the sprite walks.
      const d = i * 10;
      panel = { right: rect(1000 - d, 0, 1400 - d, 600), left: rect(d - 400, 0, d, 600),
        bottom: rect(0, 600 - d, 1000, 1000 - d), top: rect(0, d - 400, 1000, d) }[from];
      cat.setObstacles([panel]); cat.step(1 / 60);
      assert.ok(!overlaps(cat, panel), `${from} frame ${i}`);
      if (cat.state === "push") {
        touched++; assert.equal(cat.direction, direction);
        // The sprite rides exactly on the moving border.
        const gap = { right: panel.left - cat.x - cat.size, left: cat.x - panel.right,
          bottom: panel.top - cat.y - cat.size, top: cat.y - panel.bottom }[from];
        assert.ok(Math.abs(gap) < 0.001);
      }
    }
    assert.ok(touched > 5);
    // Only the pushed axis changed.
    if (direction === "W" || direction === "E") assert.equal(cat.y, start.y); else assert.equal(cat.x, start.x);
    assert.equal(cat.frame().anim, "walk");
    for (let i = 0; i < 30; i++) { cat.setObstacles([panel]); cat.step(1 / 60); }
    assert.equal(cat.state, "idle"); // Settles once the panel stops.
  }
});

test("a sprite squeezed against the screen edge slips out sideways; a full cover leaves it alone", () => {
  const cat = new Mon({ ...BASE,  idleMin: 300, idleMax: 300, sleepAfter: 3600 }); cat.resize(1000, 600);
  place(cat, 600, 300);
  for (let d = 0; d <= 1000; d += 10) { // A 300px-tall drawer crossing the whole screen from the left.
    const panel = rect(d - 1000, 200, d, 500);
    cat.setObstacles([panel]); cat.step(1 / 60);
    assert.ok(!overlaps(cat, panel));
    assert.ok(cat.x >= cat.minX && cat.x <= cat.maxX && cat.y >= cat.minY && cat.y <= cat.maxY);
  }
  assert.ok(cat.y + cat.size <= 200.001 || cat.y >= 499.999);
  const before = [cat.x, cat.y];
  cat.setObstacles([rect(0, 0, 1000, 600, 2)]); cat.step(0.05);
  assert.deepEqual([cat.x, cat.y], before);
});

test("a pushed sleeper wakes, and a walking sprite keeps its target", () => {
  const sleeper = new Mon({ ...BASE,  sleepAfter: 5, sleepDuration: 3600 }); sleeper.resize(1000, 600);
  for (let i = 0; i < 200 && sleeper.state !== "sleep"; i++) sleeper.step(0.05);
  assert.equal(sleeper.state, "sleep");
  sleeper.setObstacles([rect(sleeper.x + 10, 0, 1000, 600)]); sleeper.step(0.05);
  assert.equal(sleeper.state, "push"); assert.equal(sleeper.awake < 1, true);
  const walker = new Mon({ ...BASE,  mode: "mouse", speed: 100 }); walker.resize(1000, 600); place(walker, 500, 300);
  assert.ok(walker.point(116, 116, "mouse"));
  walker.setObstacles([rect(510, 0, 1000, 600)]); walker.step(0.05);
  assert.equal(walker.state, "walk"); assert.deepEqual(walker.target, { x: 100, y: 100 });
  for (let i = 0; i < 400 && walker.state === "walk"; i++) walker.step(0.05);
  assert.deepEqual([walker.x, walker.y], [100, 100]);
});

test("wandering never crosses or lands on an avoided module", () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cat = new Mon({ ...BASE,  idleMin: 1, idleMax: 1, speed: 200, sleepAfter: 3600, avoidMargin: 6 }, random);
  cat.resize(1000, 600); place(cat, 50, 500);
  const blocks = [rect(300, 150, 700, 450, 1), rect(0, 0, 220, 90, 2)];
  cat.setObstacles(blocks);
  let walks = 0, state = cat.state;
  for (let i = 0; i < 40000; i++) {
    cat.step(0.05);
    for (const block of blocks) assert.ok(!overlaps(cat, block, 5.9), `step ${i} at ${cat.x},${cat.y}`);
    if (cat.state === "walk" && state !== "walk") walks++;
    state = cat.state;
  }
  assert.ok(walks > 100);
});

test("targets route around a module, leave its footprint, and unreachable ones are dropped", () => {
  const cat = new Mon({ ...BASE,  mode: "touch", speed: 200, avoidMargin: 4 }); cat.resize(1000, 600);
  const block = rect(400, 100, 600, 500);
  place(cat, 100, 300); cat.setObstacles([block]);
  assert.ok(cat.point(916, 316, "touch"));
  let travelled = 0;
  for (let i = 0; i < 400 && cat.state === "walk"; i++) {
    const from = [cat.x, cat.y]; cat.step(0.05);
    travelled += Math.hypot(cat.x - from[0], cat.y - from[1]);
    assert.ok(!overlaps(cat, block, 3.9));
  }
  assert.deepEqual([cat.x, cat.y], [900, 300]);
  assert.ok(travelled > 800 && travelled < 1100); // A detour, but the short one.
  // A touch on the module itself resolves to the nearest free spot beside it.
  assert.ok(cat.point(590, 300, "touch"));
  assert.deepEqual(cat.target, { x: 604, y: 284 });
  // A region target inside the module is moved out as well.
  cat.goToRegion("middle_center");
  assert.ok(!overlaps({ ...cat.target, size: cat.size }, block, 3.9));
  // A bar across the whole screen cannot be passed: the sprite gives up and stays put.
  const wall = rect(400, 0, 600, 600, 9);
  place(cat, 900, 300); cat.setMode("touch"); cat.setObstacles([wall]);
  assert.ok(cat.point(116, 316, "touch")); cat.step(0.05);
  assert.equal(cat.state, "idle"); assert.equal(cat.target, null);
  assert.deepEqual([cat.x, cat.y], [900, 300]);
  // Removing the obstacle restores direct walking.
  cat.setObstacles([]); assert.ok(cat.point(116, 316, "touch"));
  for (let i = 0; i < 400 && cat.state === "walk"; i++) cat.step(0.05);
  assert.deepEqual([cat.x, cat.y], [100, 300]);
});

test("obstacle lists ignore malformed rectangles and cap their size", () => {
  const cat = new Mon({ ...BASE, }); cat.resize(1000, 600);
  for (const list of [null, "x", [null, 1, {}, rect(5, 5, 5, 9), rect(0, 9, 9, 0), { left: NaN, top: 0, right: 1, bottom: 1 }]]) {
    assert.equal(cat.setObstacles(list), false); assert.deepEqual(cat.obstacles, []);
  }
  assert.equal(cat.setObstacles(Array.from({ length: 20 }, (_, i) => rect(i, 0, i + 1, 1, i))), true);
  assert.equal(cat.obstacles.length, 8);
  assert.equal(cat.setObstacles(cat.obstacles.map((o) => ({ ...o }))), false);
});

