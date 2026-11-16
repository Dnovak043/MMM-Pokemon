"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../lib/pk-engine.js");
const B = require("../lib/pk-battle.js");
const { moves, data, species, pmd, plainXml, seeded } = require("./helpers.js");

/* Two loaded sprites `gap` pixels apart, with the arrival truce over. */
function pair(a, b, { gap = 10, options = {}, random = seeded(1), movesA = null, movesB = null, sets = [pmd(), pmd()] } = {}) {
  const config = { scale: 1, idleMin: 300, idleMax: 300, sleepAfter: 3600 };
  const mons = [a, b].map((id, i) => {
    const mon = new Engine.Mon(config, random); mon.resize(800, 600); mon.setSprites(sets[i]);
    Object.assign(mon, { species: species.get(id), name: species.get(id).name, fixedMoves: [movesA, movesB][i] });
    return mon;
  });
  mons[0].x = 300; mons[0].y = 300; mons[1].x = 300 + mons[0].size + gap; mons[1].y = 300;
  const arena = new B.Arena(mons, { data, ...options }, random);
  mons.forEach((mon) => { mon.cooldown = 0; });
  return { mons, arena };
}
const run = (arena, seconds, each = () => {}) => { for (let i = 0; i < seconds * 60; i++) { arena.step(1 / 60); each(); } };
const finish = (arena, each = () => {}) => { for (let i = 0; i < 60 * 400 && arena.battles.length; i++) { arena.step(1 / 60); each(); } assert.equal(arena.battles.length, 0, "battle should end"); };

test("moves are drawn with the best-matching action the sprite's own artwork has", () => {
  const full = { roles: { idle: "Idle", attack: ["Attack"] }, anims: Object.fromEntries(["Idle", "Attack", "Strike", "Kick", "Bite", "Shoot", "Charge", "Punch", "Slice", "Scratch", "Rotate", "Dance", "Sound", "Shock", "Withdraw", "Hop", "Sleep", "TailWhip", "Stomp", "MultiScratch", "FlapAround", "Gas", "Swell", "QuickStrike"].map((n) => [n, {}])) };
  const expect = { thunderpunch: "Punch", megakick: "Kick", bite: "Bite", crunch: "Bite", slash: "Slice", furyswipes: "MultiScratch", irontail: "TailWhip", rapidspin: "Rotate", swordsdance: "Dance",
    growl: "Sound", thunderbolt: "Shock", protect: "Withdraw", splash: "Hop", rest: "Sleep", earthquake: "Stomp", gust: "FlapAround", poisongas: "Gas", bulkup: "Swell", quickattack: "QuickStrike",
    tackle: "Attack", flamethrower: "Shoot", recover: "Charge" };
  for (const [id, action] of Object.entries(expect)) assert.equal(B.actionFor(moves[id], full), action, id);
  // A sprite with fewer actions falls back sensibly; one with none stays in Idle.
  const basic = pmd();
  assert.equal(B.actionFor(moves.thunderpunch, basic), "Attack"); assert.equal(B.actionFor(moves.megakick, basic), "Kick");
  assert.equal(B.actionFor(moves.flamethrower, basic), "Shoot"); assert.equal(B.actionFor(moves.swordsdance, basic), "Twirl"); assert.equal(B.actionFor(moves.splash, basic), "Hop");
  assert.equal(B.actionFor(moves.tackle, pmd(plainXml)), "Idle");
  for (const m of Object.values(moves)) { assert.ok(["contact", "quake", "shot", "beam", "bolt", "wave", "self", "aim"].includes(B.styleOf(m)), m.id); assert.ok(basic.anims[B.actionFor(m, basic)], m.id); }
  assert.deepEqual(["tackle", "earthquake", "shadowball", "flamethrower", "thunderbolt", "hypervoice", "swordsdance", "thunderwave", "growl"].map((id) => B.styleOf(moves[id])),
    ["contact", "quake", "shot", "beam", "bolt", "wave", "self", "aim", "wave"]);
  assert.equal(Object.keys(B.TYPE_COLORS).length, 18);
});

test("particles move, expire, respect delays and a hard limit", () => {
  const fx = new B.Fx(10, seeded(4));
  fx.stream({ x: 0, y: 0 }, { x: 100, y: 0 }, "#f00", { n: 2, duration: 0.5, stagger: 0.25, jitter: 0 });
  assert.equal(fx.visible().length, 1);
  fx.step(0.25); assert.equal(fx.particles[0].x, 50); fx.step(0.01); assert.equal(fx.visible().length, 2);
  fx.step(0.3); assert.equal(fx.particles.length, 1); fx.step(0.3); assert.equal(fx.particles.length, 0);
  fx.burst(5, 5, "#0f0", 30); assert.equal(fx.particles.length, 10); assert.equal(fx.add({}), null);
  for (let i = 0; i < 60; i++) fx.step(0.05); assert.equal(fx.particles.length, 0);
  fx.bolt({ x: 0, y: 0 }, { x: 60, y: 0 }, "#ff0"); fx.ring(1, 1, "#fff"); fx.rise(1, 1, "#fff", { n: 2, text: "▲" });
  assert.ok(fx.particles.some((p) => p.ring)); assert.ok(fx.particles.some((p) => p.text === "▲"));
});

test("battles start only by proximity: nothing draws sprites toward each other", () => {
  const far = pair("pikachu", "squirtle", { gap: 25 });
  run(far.arena, 3); assert.equal(far.arena.count, 0); assert.deepEqual(far.mons.map((m) => m.state), ["idle", "idle"]);
  far.mons[1].x -= 2; far.arena.step(1 / 60); assert.equal(far.arena.count, 1);
  // Wander targets are uniform over the screen whoever else is on it.
  const alone = new Engine.Mon({ scale: 1 }, seeded(11)), crowded = new Engine.Mon({ scale: 1 }, seeded(11));
  alone.resize(800, 600); crowded.resize(800, 600);
  const { mons, arena } = pair("pikachu", "squirtle", { gap: 300 }); arena.admit(crowded); crowded.cooldown = 0;
  for (let i = 0; i < 20; i++) assert.deepEqual(crowded.roam(), alone.roam());
  assert.equal(mons[0].target, null);
  // Not ready: no data, artwork not loaded, asleep, pushed, heading to a region, cooling down, or battles off.
  const noData = pair("pikachu", "squirtle", { options: { data: null } }); noData.arena.step(1 / 60); assert.equal(noData.arena.count, 0); assert.equal(noData.arena.enabled, false);
  const blank = pair("pikachu", "squirtle"); blank.mons[0].sprites = require("../lib/pk-sprites.js").placeholder(); blank.arena.step(1 / 60); assert.equal(blank.arena.count, 0);
  for (const state of ["sleep", "tired", "wake", "push", "faint"]) { const p = pair("pikachu", "squirtle"); p.mons[0].state = state; p.mons[0].down = 99; p.mons[0].pushHold = 99; p.arena.step(1 / 60); assert.equal(p.arena.count, 0, state); }
  const busy = pair("pikachu", "squirtle"); busy.mons[0].goToRegion("top_left"); busy.arena.step(1 / 60); assert.equal(busy.arena.count, 0);
  const truce = pair("pikachu", "squirtle"); truce.mons[1].cooldown = 1; truce.arena.step(0.25); assert.equal(truce.arena.count, 0); run(truce.arena, 1); assert.equal(truce.arena.count, 1);
  const off = pair("pikachu", "squirtle", { options: { battles: false } }); run(off.arena, 1); assert.equal(off.arena.count, 0);
  assert.equal(new B.Arena([new Engine.Mon({})], { data }).enabled, false);
});

test("a battle plays out in turns with the moves' effects shown on the sprites", () => {
  const { mons, arena } = pair("pikachu", "squirtle", { movesA: ["thunderbolt"], movesB: ["tackle"], random: () => 0.5 });
  const [pika, squirtle] = mons;
  arena.step(1 / 60);
  const battle = arena.battles[0];
  assert.deepEqual([pika.state, squirtle.state, pika.direction, squirtle.direction], ["battle", "battle", "E", "W"]);
  assert.deepEqual([pika.hp, pika.maxHp, squirtle.hp, squirtle.maxHp], [110, 110, 119, 119]);
  assert.match(battle.text, /Pikachu and Squirtle face off/);
  const log = [], seen = { bolt: false, hurt: false, lunge: 0, flash: false, texts: [] }; let lastText = "", both = 0;
  finish(arena, () => {
    if (battle.text !== lastText) { lastText = battle.text; seen.texts.push(lastText); }
    const acting = mons.filter((m) => m.state === "battle" && !["Idle", "Hurt"].includes(m.frame().anim));
    if (acting.length === 2) both++;
    if (pika.frame().anim === "Shoot" && arena.fx.particles.some((p) => p.color === B.TYPE_COLORS.electric)) seen.bolt = true;
    if (squirtle.frame().anim === "Hurt") seen.hurt = true;
    if (squirtle.frame().anim === "Attack") seen.lunge = Math.min(seen.lunge, squirtle.view.dx);
    seen.flash = seen.flash || squirtle.view.flash || pika.view.flash;
    log.push(squirtle.hp);
  });
  // One side acts at a time; the other reacts when the move lands.
  assert.equal(both, 0);
  assert.ok(seen.bolt, "Thunderbolt drawn with the Shoot action and electric particles");
  assert.ok(seen.hurt); assert.ok(seen.flash); assert.ok(seen.lunge < -3, "Tackle lunges toward the target"); 
  assert.deepEqual(seen.texts.slice(0, 4), ["Pikachu and Squirtle face off!", "Pikachu used Thunderbolt!", "It's super effective!", "Squirtle used Tackle!"]);
  assert.ok(seen.texts.includes("Squirtle fainted!"));
  // HP on screen only ever goes down, in steps, as hits land.
  for (let i = 1; i < log.length; i++) assert.ok(log[i] <= log[i - 1]);
  assert.equal(new Set(log).size, 3); // 119 → 23 → 0
  assert.equal(battle.winner, pika); assert.equal(battle.reason, "faint"); assert.equal(battle.phase, "over");
  assert.equal(squirtle.state, "faint"); assert.equal(squirtle.frame().anim, "Faint"); assert.equal(squirtle.hp, 0);
  assert.ok(["walk", "idle"].includes(pika.state)); assert.equal(pika.rival, null); assert.ok(pika.cooldown > 0);
  assert.deepEqual(pika.view, { dx: 0, dy: 0, opacity: 1, scale: 1, glow: null, flash: false, shield: false });
  // The loser gets up at full health after faintTime.
  run(arena, 9); assert.equal(squirtle.hp, squirtle.maxHp); assert.ok(["wake", "idle", "fidget", "walk"].includes(squirtle.state));
});

test("status, hiding, shields, stat changes and weather are visible while they last", () => {
  // Sleep: the target lies in its Sleep action with a status glow until it wakes.
  const nap = pair("bulbasaur", "snorlax", { movesA: ["sleeppowder", "growl"], movesB: ["splash"], random: () => 0.5 });
  nap.arena.step(1 / 60); const napBattle = nap.arena.battles[0];
  napBattle.fight.choose = (mon) => moves[mon === napBattle.fight.mons[0] ? (napBattle.fight.turn === 1 ? "sleeppowder" : "growl") : "splash"];
  let slept = false, zs = false, arrows = false;
  run(nap.arena, 12, () => {
    if (nap.mons[1].ailment === "slp") { slept = slept || (nap.mons[1].frame().anim === "Sleep" && nap.mons[1].view.glow === B.AILMENT_COLORS.slp); zs = zs || nap.arena.fx.particles.some((p) => p.text === "z"); }
    arrows = arrows || nap.arena.fx.particles.some((p) => p.text === "▼");
  });
  assert.ok(slept); assert.ok(zs); assert.ok(arrows);
  // Fly: the user rises out of sight, the foe's attack misses, then it comes back down to strike.
  const fly = pair("pidgeot", "snorlax", { movesA: ["fly"], movesB: ["tackle"], random: () => 0.5 });
  fly.arena.step(1 / 60); let hidden = false, back = false, dodged = false;
  run(fly.arena, 9, () => {
    const v = fly.mons[0].view;
    if (fly.mons[0].marks.hidden === "up" && v.opacity === 0 && v.dy < -fly.mons[0].size * 2) hidden = true;
    if (hidden && !fly.mons[0].marks.hidden && v.opacity === 1 && v.dy === 0) back = true;
    if (hidden && fly.arena.battles[0] && /avoided the attack/.test(fly.arena.battles[0].text)) dodged = true;
  });
  assert.ok(hidden); assert.ok(dodged); assert.ok(back);
  // Protect raises a shield for the turn; Substitute fades the user; Minimize shrinks it; rain falls.
  const guard = pair("pikachu", "snorlax", { movesA: ["protect"], movesB: ["tackle"], random: () => 0.5 });
  guard.arena.step(1 / 60); let shield = false; run(guard.arena, 4, () => { shield = shield || guard.mons[0].view.shield; }); assert.ok(shield);
  const sub = pair("pikachu", "magikarp", { movesA: ["substitute"], movesB: ["splash"], random: () => 0.5 });
  sub.arena.step(1 / 60); run(sub.arena, 4); assert.equal(sub.mons[0].view.opacity, 0.55); assert.ok(sub.mons[0].hp < sub.mons[0].maxHp);
  const mini = pair("chansey", "magikarp", { movesA: ["minimize"], movesB: ["splash"], random: () => 0.5 });
  mini.arena.step(1 / 60); run(mini.arena, 4); assert.equal(mini.mons[0].view.scale, 0.6);
  const rain = pair("squirtle", "magikarp", { movesA: ["raindance"], movesB: ["splash"], random: seeded(3) });
  rain.arena.step(1 / 60); let drops = false; run(rain.arena, 5, () => { drops = drops || (rain.arena.battles[0] && rain.arena.battles[0].weather === "rain" && rain.arena.fx.particles.some((p) => p.vy > 200)); }); assert.ok(drops);
  const burn = pair("gengar", "snorlax", { movesA: ["willowisp"], movesB: ["splash"], random: () => 0.5 });
  burn.arena.step(1 / 60); run(burn.arena, 4); assert.equal(burn.mons[1].ailment, "brn"); assert.equal(burn.mons[1].view.glow, B.AILMENT_COLORS.brn);
});

test("Transform borrows the other sprite's artwork, and fleeing ends the battle without a winner", () => {
  const small = pmd(), big = pmd(plainXml);
  const { mons, arena } = pair("ditto", "snorlax", { movesA: ["transform"], movesB: ["splash"], random: () => 0.5, sets: [small, big] });
  arena.step(1 / 60); const battle = arena.battles[0];
  run(arena, 4); assert.equal(mons[0].sprites, big); assert.ok(battle.original.has(mons[0]));
  mons[1].setMode("mouse"); arena.step(1 / 60); // Call it off.
  assert.equal(arena.battles.length, 0); assert.equal(mons[0].sprites, small);
  const tele = pair("abra", "snorlax", { movesA: ["teleport"], movesB: ["splash"], random: seeded(8) });
  tele.arena.step(1 / 60); const b = tele.arena.battles[0], from = [tele.mons[0].x, tele.mons[0].y];
  finish(tele.arena);
  assert.equal(b.reason, "flee"); assert.equal(b.winner, null); assert.equal(b.fled, tele.mons[0]);
  assert.notDeepEqual([tele.mons[0].x, tele.mons[0].y], from); assert.equal(tele.mons[0].view.opacity, 1);
  assert.deepEqual(tele.mons.map((m) => m.state), ["idle", "walk"]);
  const roar = pair("pidgey", "rattata", { movesA: ["whirlwind"], movesB: ["growl"], random: () => 0.5 });
  roar.arena.step(1 / 60); const rb = roar.arena.battles[0]; finish(roar.arena); assert.equal(rb.fled, roar.mons[1]);
});

test("interruptions and battle speed", () => {
  const moved = pair("pikachu", "squirtle"); moved.arena.step(1 / 60);
  assert.equal(moved.mons[0].point(10, 10, moved.mons[0].mode), false);
  assert.equal(moved.mons[0].goToRegion("top_left"), true); assert.equal(moved.mons[0].region, null);
  const shoved = pair("pikachu", "squirtle"); shoved.arena.step(1 / 60);
  shoved.mons[0].setObstacles([{ left: 290, top: 250, right: 320, bottom: 400, key: 1 }]); shoved.arena.step(1 / 60);
  assert.equal(shoved.mons[0].state, "push"); assert.equal(shoved.arena.battles.length, 0); assert.notEqual(shoved.mons[1].state, "battle");
  const time = (battleSpeed) => { const p = pair("pikachu", "squirtle", { movesA: ["thunderbolt"], movesB: ["tackle"], random: () => 0.5, options: { battleSpeed } }); let n = 0; p.arena.step(1 / 60); finish(p.arena, () => n++); return n / 60; };
  const normal = time(1), fast = time(2);
  assert.ok(normal > 4 && normal < 30, `${normal}s`); assert.ok(Math.abs(fast - normal / 2) < 0.6);
});

test("a full party keeps wandering, meeting and recovering, using its real learnsets", () => {
  const random = seeded(42), ids = ["pikachu", "charmander", "squirtle", "bulbasaur", "gengar", "snorlax"];
  const mons = ids.map((id, i) => {
    const mon = new Engine.Mon({ scale: 1, idleMin: 1, idleMax: 3, speed: 70, sleepAfter: 200, sleepDuration: 5, startPosition: { x: (i + 0.5) / ids.length, y: 0.5 } }, random);
    mon.resize(520, 320); mon.setSprites(pmd()); Object.assign(mon, { species: species.get(id), name: species.get(id).name }); return mon;
  });
  const arena = new B.Arena(mons, { data, battleCooldown: 8, faintTime: 4 }, random), states = new Set(), used = new Set(), seen = new Set();
  const stuck = mons.map(() => 0); let longest = 0, peak = 0;
  for (let i = 0; i < 60 * 60 * 12; i++) {
    arena.step(1 / 60); peak = Math.max(peak, arena.fx.particles.length);
    for (const battle of arena.battles) if (!seen.has(battle)) seen.add(battle);
    mons.forEach((mon, n) => {
      states.add(mon.state); stuck[n] = mon.state === "battle" ? stuck[n] + 1 : 0; longest = Math.max(longest, stuck[n]);
      assert.ok(Number.isFinite(mon.x + mon.y + mon.view.dx + mon.view.dy + mon.view.opacity));
      assert.ok(mon.sprites.anims[mon.frame().anim]);
      if (mon.state === "battle") assert.ok(mon.rival && mon.rival.rival === mon);
      if (!["battle", "faint"].includes(mon.state)) { assert.equal(mon.rival, null); assert.deepEqual(mon.view, { dx: 0, dy: 0, opacity: 1, scale: 1, glow: null, flash: false, shield: false }); }
    });
  }
  for (const battle of seen) for (const id of battle.used) used.add(id);
  assert.ok(arena.count >= 8, `battles: ${arena.count}`);
  assert.ok(used.size >= 25, `distinct moves: ${used.size}`);
  for (const id of used) assert.ok(ids.some((s) => species.get(s).moves.includes(id)) || moves[id].flags.includes("metronome") || id === "struggle", id);
  assert.ok(longest / 60 < 200, `longest battle ${longest / 60}s`); assert.ok(peak <= 180);
  for (const state of ["idle", "walk", "fidget", "battle", "faint", "wake"]) assert.ok(states.has(state), state);
});
