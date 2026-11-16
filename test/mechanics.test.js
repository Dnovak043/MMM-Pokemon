"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../lib/pk-mechanics.js");
const { moves, pokedex, data, species, seeded, duel, texts } = require("./helpers.js");

const find = (events, e, extra = {}) => events.filter((ev) => ev.e === e && Object.entries(extra).every(([k, v]) => ev[k] === v));
const said = (events, pattern) => texts(events).some((t) => pattern.test(t));

test("the data covers every species and move, and learnsets only reference real moves", () => {
  assert.equal(pokedex.species.length, 1025);
  assert.deepEqual(pokedex.species.map((s) => s.num), Array.from({ length: 1025 }, (_, i) => i + 1));
  const ids = Object.keys(moves);
  assert.ok(ids.length >= 900);
  assert.deepEqual(pokedex.moves, [...ids].sort());
  for (const m of Object.values(moves)) {
    assert.ok(M.TYPES.includes(m.type), m.id); assert.ok(["physical", "special", "status"].includes(m.category), m.id);
    assert.ok(m.pp >= 1 && typeof m.name === "string" && Array.isArray(m.flags), m.id);
    assert.ok(m.accuracy === true || (m.accuracy >= 1 && m.accuracy <= 100), m.id);
  }
  const learnable = new Set();
  for (const s of pokedex.species) {
    assert.ok(s.moves.length > 0, s.name); assert.equal(s.stats.length, 6); assert.ok(s.types.length >= 1 && s.types.every((t) => M.TYPES.includes(t)));
    for (const i of s.moves) { assert.ok(pokedex.moves[i], `${s.name} ${i}`); learnable.add(pokedex.moves[i]); }
  }
  assert.ok(learnable.size >= 740);
  // Moves that could only ever fail here (they need a held item, an ability or a partner) are not included at all.
  for (const id of ["trick", "fling", "naturalgift", "skillswap", "roleplay", "followme", "helpinghand", "batonpass", "healingwish", "aromaticmist", "holdhands"]) {
    assert.equal(moves[id], undefined, id); assert.ok(!pokedex.moves.includes(id), id);
  }
  assert.equal(ids.filter((id) => moves[id].target === "adjacentAlly").length, 0);
  const pikachu = species.get("pikachu");
  for (const id of ["thunderbolt", "quickattack", "thundershock", "surf", "voltTackle".toLowerCase(), "irontail"]) assert.ok(pikachu.moves.includes(id), id);
  assert.ok(species.get("charizard").moves.includes("ember")); // Kept through evolution.
  assert.deepEqual([species.get(1).name, species.get(1025).name, species.get("mrmime").num], ["Bulbasaur", "Pecharunt", 122]);
});

test("stats, type matchups and move selection follow the games", () => {
  const pika = M.createMon(species.get("pikachu"), 50, ["thunderbolt"], data);
  assert.deepEqual([pika.maxHp, pika.stats.atk, pika.stats.spe], [110, 75, 110]);
  assert.equal(M.createMon(species.get("shedinja"), 100, ["scratch"], data).maxHp, 1);
  assert.equal(M.createMon(species.get("mewtwo"), 100, ["psychic"], data).maxHp, 353);
  const f = duel("pikachu", ["thunderbolt"], "dragonite", ["tackle"]), [, dragonite] = f.mons;
  assert.equal(f.effectiveness("ice", dragonite), 4); assert.equal(f.effectiveness("ground", dragonite), 0);
  assert.equal(f.effectiveness("fire", dragonite), 0.5); assert.equal(f.effectiveness("electric", dragonite), 1);
  assert.equal(f.effectiveness("ghost", M.createMon(species.get("snorlax"), 50, [], data)), 0);
  assert.equal(f.effectiveness("fighting", M.createMon(species.get("tyranitar"), 50, [], data)), 4);
  for (let seed = 1; seed < 40; seed++) {
    const s = pokedex.species[(seed * 53) % 1025], full = species.get(s.num), picked = M.pickMoves(full, data, seeded(seed));
    assert.ok(picked.length >= 1 && picked.length <= 4); assert.equal(new Set(picked).size, picked.length);
    assert.ok(picked.every((id) => full.moves.includes(id)));
    if (full.moves.filter((id) => moves[id].category !== "status").length >= 2) assert.ok(picked.filter((id) => moves[id].category !== "status").length >= 2, full.name);
  }
  assert.deepEqual(M.pickMoves(species.get("pikachu"), data, seeded(5)), M.pickMoves(species.get("pikachu"), data, seeded(5)));
});

test("a turn: priority, then speed; damage with STAB and effectiveness; immunities", () => {
  const f = duel("pikachu", ["thunderbolt"], "squirtle", ["tackle"]), [pika, squirtle] = f.mons;
  let ev = f.round();
  assert.deepEqual(find(ev, "use").map((e) => e.who), [0, 1]); // Pikachu is faster.
  const hit = find(ev, "hit", { who: 0 })[0];
  assert.equal(hit.eff, 2); assert.equal(hit.hp, squirtle.hp); assert.equal(hit.dmg, squirtle.maxHp - squirtle.hp);
  assert.ok(said(ev, /super effective/)); assert.ok(texts(ev).includes("Pikachu used Thunderbolt!"));
  // 90 power, Sp. Atk 70 vs Sp. Def 84, ×0.93 roll, ×1.5 STAB, ×2.
  assert.equal(hit.dmg, Math.floor(Math.floor(Math.floor((Math.floor(Math.floor(22 * 90 * 70 / 84) / 50) + 2) * 0.93) * 1.5) * 2));
  assert.equal(pika.moves[0].pp, 14);
  // Priority beats speed; speed is reversed in Trick Room.
  ev = duel("snorlax", ["quickattack"], "pikachu", ["tackle"]).round();
  assert.deepEqual(find(ev, "use").map((e) => e.who), [0, 1]);
  const room = duel("snorlax", ["growl"], "pikachu", ["trickroom", "growl"], { plan: { 2: ["growl", "growl"] } });
  room.round(); assert.deepEqual(find(room.round(), "use").map((e) => e.who), [0, 1]);
  // Immunities, for attacks and for status moves that respect them.
  ev = duel("pikachu", ["thunderbolt"], "sandshrew", ["splash"]).round();
  assert.equal(find(ev, "hit").length, 0); assert.ok(said(ev, /doesn't affect Sandshrew/));
  assert.ok(said(duel("pikachu", ["thunderwave"], "sandshrew", ["splash"]).round(), /doesn't affect Sandshrew/));
  assert.ok(said(duel("gengar", ["willowisp"], "charmander", ["splash"]).round(), /doesn't affect Charmander/));
  assert.ok(said(duel("bulbasaur", ["sleeppowder"], "oddish", ["splash"]).round(), /doesn't affect Oddish/));
  assert.ok(said(duel("snorlax", ["earthquake"], "pidgey", ["splash"]).round(), /doesn't affect Pidgey/));
});

test("status conditions do what they do in the games", () => {
  const burn = duel("gengar", ["willowisp", "splash"], "machop", ["tackle"], { plan: { 2: ["splash", "tackle"], 3: ["splash", "tackle"] } }), [gengar, machop] = burn.mons;
  let ev = burn.round();
  assert.equal(machop.status, "brn"); assert.equal(find(ev, "status", { target: 1, status: "brn" }).length, 1);
  assert.equal(find(ev, "hp", { reason: "brn" })[0].delta, -Math.floor(machop.maxHp / 16));
  const healthy = duel("gengar", ["splash"], "machop", ["knockoff"]).round(), burned = duel("gengar", ["willowisp"], "machop", ["knockoff"], { rng: () => 0.5 });
  burned.mons[1].status = "brn";
  const full = find(healthy, "hit")[0].dmg, halved = find(burned.round(), "hit")[0].dmg;
  assert.ok(Math.abs(halved - full / 2) <= 1, `${halved} vs ${full}`);
  // Badly poisoned grows every turn.
  const tox = duel("gengar", ["toxic", "splash"], "snorlax", ["splash"], { plan: { 2: ["splash", "splash"], 3: ["splash", "splash"] } }), snorlax = tox.mons[1];
  const lost = [tox.round(), tox.round(), tox.round()].map((e) => -find(e, "hp", { reason: "psn" })[0].delta);
  assert.deepEqual(lost, [1, 2, 3].map((n) => Math.floor(snorlax.maxHp * n / 16)));
  // Sleep stops moves for its duration, then the sleeper wakes and acts.
  const nap = duel("bulbasaur", ["sleeppowder", "splash"], "squirtle", ["tackle"], { plan: { 2: ["splash", "tackle"], 3: ["splash", "tackle"], 4: ["splash", "tackle"] } });
  ev = nap.round(); assert.equal(nap.mons[1].status, "slp"); assert.equal(find(ev, "use", { who: 1 }).length, 0);
  ev = nap.round(); assert.ok(said(ev, /fast asleep/)); assert.equal(find(ev, "use", { who: 1 }).length, 0);
  ev = nap.round(); assert.ok(said(ev, /Squirtle woke up/)); assert.equal(find(ev, "use", { who: 1 }).length, 1);
  // Paralysis halves speed and sometimes stops a move; freeze thaws on a lucky roll or a fire hit.
  const par = duel("pikachu", ["thunderwave", "splash"], "jolteon", ["splash"]); par.mons[1].types = ["normal"];
  par.round(); assert.equal(par.mons[1].status, "par"); assert.equal(par.speed(par.mons[1]), Math.floor(par.mons[1].stats.spe) * 0.5);
  const stuck = duel("pikachu", ["splash"], "eevee", ["tackle"], { rng: () => 0.1 }); stuck.mons[1].status = "par";
  assert.ok(said(stuck.round(), /can't move/));
  const ice = duel("charmander", ["ember"], "eevee", ["tackle"]); ice.mons[1].status = "frz";
  ev = ice.round(); assert.ok(said(ev, /thawed out/)); assert.equal(ice.mons[1].status, null);
  // One major status at a time; Safeguard and type immunity block them.
  const two = duel("gengar", ["toxic"], "machop", ["splash"]); two.mons[1].status = "brn"; two.round(); assert.equal(two.mons[1].status, "brn");
  assert.equal(gengar.status, null);
});

test("stat stages, critical hits, accuracy and multi-hit moves", () => {
  const plain = find(duel("machop", ["tackle"], "snorlax", ["splash"]).round(), "hit")[0].dmg;
  const sd = duel("machop", ["swordsdance", "tackle"], "snorlax", ["splash"], { plan: { 2: ["tackle", "splash"] } });
  let ev = sd.round(); assert.equal(sd.mons[0].boosts.atk, 2); assert.equal(find(ev, "boost", { stat: "atk", n: 2 }).length, 1); assert.ok(said(ev, /Attack rose sharply/));
  const boosted = find(sd.round(), "hit")[0].dmg; assert.ok(Math.abs(boosted - plain * 2) <= 2);
  const cap = duel("machop", ["swordsdance"], "snorlax", ["splash"]); cap.round(); cap.round(); cap.round();
  ev = cap.round(); assert.equal(cap.mons[0].boosts.atk, 6); assert.ok(said(ev, /won't go any higher/)); assert.ok(said(ev, /But it failed/));
  const growl = duel("eevee", ["growl"], "machop", ["splash"]); growl.round(); assert.equal(growl.mons[1].boosts.atk, -1);
  const mist = duel("eevee", ["growl"], "machop", ["mist"]); mist.mons[1].stats.spe = 999; assert.ok(said(mist.round(), /protected by the mist/));
  // A guaranteed critical hit ignores the target's Defense boosts.
  const crit = duel("machop", ["stormthrow"], "snorlax", ["splash"]); crit.mons[1].boosts.def = 6;
  ev = crit.round(); assert.equal(find(ev, "hit")[0].crit, true); assert.ok(said(ev, /critical hit/));
  assert.ok(find(ev, "hit")[0].dmg > plain);
  // Accuracy rolls, never-miss moves, and evasion.
  const miss = duel("machop", ["dynamicpunch"], "snorlax", ["splash"], { rng: () => 0.6 });
  ev = miss.round(); assert.equal(find(ev, "miss").length, 1); assert.equal(find(ev, "hit").length, 0); assert.ok(said(ev, /attack missed/));
  assert.equal(find(duel("machop", ["aerialace"], "snorlax", ["splash"], { rng: () => 0.999 }).round(), "hit").length, 1);
  const evade = duel("machop", ["tackle"], "snorlax", ["splash"], { rng: () => 0.6 }); evade.mons[1].boosts.evasion = 6;
  assert.equal(find(evade.round(), "miss").length, 1);
  const crash = duel("machop", ["highjumpkick"], "gengar", ["splash"]);
  ev = crash.round(); assert.ok(said(ev, /crashed/)); assert.equal(crash.mons[0].hp, crash.mons[0].maxHp - Math.floor(crash.mons[0].maxHp / 2));
  // Multi-hit moves land two to five separate hits and report the count.
  for (const [roll, expected] of [[0.1, 2], [0.5, 3], [0.75, 4], [0.9, 5]]) {
    let n = 0; const fs = duel("meowth", ["furyswipes"], "snorlax", ["splash"], { rng: () => (n++ === 3 ? roll : 0.5) });
    ev = fs.round(); assert.equal(find(ev, "hit").length, expected); assert.ok(said(ev, new RegExp(`Hit ${expected} times`)));
  }
  assert.equal(find(duel("machop", ["doublekick"], "snorlax", ["splash"]).round(), "hit").length, 2);
});

test("two-turn moves, protection, recharging and locked-in moves", () => {
  const fly = duel("pidgeot", ["fly"], "snorlax", ["tackle"]);
  let ev = fly.round();
  assert.deepEqual(find(ev, "charge").map((e) => [e.who, e.hide]), [[0, "up"]]); assert.ok(said(ev, /flew up high/));
  assert.equal(find(ev, "hit").length, 0); assert.equal(find(ev, "miss", { who: 1 }).length, 1); assert.ok(said(ev, /avoided the attack/));
  ev = fly.round(); assert.equal(find(ev, "reveal", { who: 0 }).length, 1); assert.equal(find(ev, "hit", { who: 0 }).length, 1);
  assert.equal(fly.mons[0].moves[0].pp, 14); // One use, one PP.
  const quake = duel("diglett", ["dig"], "snorlax", ["earthquake"]); ev = quake.round();
  assert.equal(find(ev, "charge")[0].hide, "down"); assert.equal(find(ev, "hit", { who: 1 }).length, 1); // Earthquake reaches underground.
  const solar = duel("bulbasaur", ["sunnyday", "solarbeam"], "snorlax", ["splash"], { plan: { 2: ["solarbeam", "splash"] } });
  solar.round(); ev = solar.round(); assert.equal(find(ev, "hit", { who: 0 }).length, 1); assert.equal(find(ev, "charge")[0].hide, null); // No wait in sunshine.
  // Protect blocks, and rarely works twice in a row.
  const guard = duel("pikachu", ["protect"], "snorlax", ["tackle"]);
  ev = guard.round(); assert.equal(find(ev, "block", { target: 0 }).length, 1); assert.equal(find(ev, "hit").length, 0); assert.equal(find(ev, "volatile", { name: "protect", on: true }).length, 1);
  assert.equal(find(ev, "volatile", { name: "protect", on: false }).length, 1);
  ev = guard.round(); assert.ok(said(ev, /But it failed/)); assert.equal(find(ev, "hit", { who: 1 }).length, 1);
  assert.equal(find(duel("pikachu", ["protect"], "snorlax", ["feint"]).round(), "hit").length, 1);
  // Hyper Beam costs the next turn.
  const beam = duel("snorlax", ["hyperbeam"], "blissey", ["splash"]); beam.round();
  ev = beam.round(); assert.ok(said(ev, /must recharge/)); assert.equal(find(ev, "use", { who: 0 }).length, 0);
  assert.equal(find(beam.round(), "use", { who: 0 }).length, 1);
  // Outrage locks the user in for two or three turns, then confuses it.
  const rage = duel("dratini", ["outrage", "splash"], "steelix", ["splash"], { plan: { 2: ["splash", "splash"], 3: ["splash", "splash"] } });
  rage.round(); ev = rage.round(); assert.equal(find(ev, "use", { who: 0, move: "outrage" }).length, 1);
  ev = rage.round(); assert.ok(said(ev, /confused due to fatigue/)); assert.ok(rage.mons[0].v.confusion); assert.equal(rage.mons[0].moves[0].pp, 9);
});

test("draining, recoil, healing, fixed damage and one-hit KOs", () => {
  const drain = duel("bulbasaur", ["gigadrain"], "squirtle", ["tackle"]); drain.mons[0].hp = 20; drain.mons[1].stats.spe = 1;
  let ev = drain.round(); const dealt = find(ev, "hit", { who: 0 })[0].dmg;
  assert.equal(find(ev, "hp", { target: 0, reason: "drain" })[0].delta, Math.floor(dealt / 2));
  const edge = duel("snorlax", ["doubleedge"], "blissey", ["splash"]); ev = edge.round();
  assert.equal(find(ev, "hp", { target: 0, reason: "recoil" })[0].delta, -Math.round(find(ev, "hit")[0].dmg * 33 / 100));
  const heal = duel("blissey", ["softboiled"], "machop", ["splash"]); heal.mons[0].hp = 10;
  ev = heal.round(); assert.equal(find(ev, "hp", { reason: "heal" })[0].delta, Math.floor(heal.mons[0].maxHp / 2));
  assert.ok(said(duel("blissey", ["softboiled"], "machop", ["splash"]).round(), /But it failed/)); // Already healthy.
  assert.equal(find(duel("machop", ["seismictoss"], "snorlax", ["splash"]).round(), "hit")[0].dmg, 50);
  assert.equal(find(duel("pikachu", ["sonicboom"], "snorlax", ["splash"]).round(), "hit")[0].dmg, 20);
  const fang = duel("rattata", ["superfang"], "snorlax", ["splash"]); ev = fang.round(); assert.equal(find(ev, "hit")[0].dmg, Math.floor(fang.mons[1].maxHp / 2));
  const ko = duel("lapras", ["sheercold"], "snorlax", ["splash"], { rng: () => 0.2 }); ev = ko.round();
  assert.ok(said(ev, /one-hit KO/)); assert.equal(ko.mons[1].hp, 0); assert.equal(ko.winner, ko.mons[0]);
  assert.equal(find(duel("lapras", ["sheercold"], "snorlax", ["splash"], { level: 40, levelB: 50, rng: () => 0.01 }).round(), "hit").length, 0);
  const counter = duel("snorlax", ["counter"], "machop", ["tackle"]); counter.mons[1].stats.spe = 999; ev = counter.round();
  assert.equal(find(ev, "hit", { who: 0 })[0].dmg, find(ev, "hit", { who: 1 })[0].dmg * 2);
  const rest = duel("snorlax", ["rest"], "machop", ["splash"]); rest.mons[0].hp = 5; rest.round();
  assert.equal(rest.mons[0].hp, rest.mons[0].maxHp); assert.equal(rest.mons[0].status, "slp");
  rest.round(); rest.round(); assert.ok(said(rest.round(), /woke up/));
  const boom = duel("voltorb", ["explosion"], "snorlax", ["splash"]); ev = boom.round();
  assert.equal(boom.mons[0].hp, 0); assert.equal(find(ev, "hit", { who: 0 }).length, 1); assert.equal(find(ev, "faint", { target: 0 }).length, 1);
  assert.equal(boom.over, true); assert.equal(boom.winner, boom.mons[1]);
});

test("weather, terrain, screens and lingering conditions", () => {
  const dry = find(duel("squirtle", ["watergun"], "snorlax", ["splash"]).round(), "hit")[0].dmg;
  const rain = duel("squirtle", ["raindance", "watergun"], "snorlax", ["splash"], { plan: { 2: ["watergun", "splash"] } });
  let ev = rain.round(); assert.deepEqual(find(ev, "weather").map((e) => e.weather), ["rain"]); assert.ok(said(ev, /started to rain/));
  assert.ok(Math.abs(find(rain.round(), "hit")[0].dmg - dry * 1.5) <= 2);
  rain.plan = null; rain.choose = () => moves.splash; rain.round(); rain.round();
  ev = rain.round(); assert.equal(rain.weather, null); assert.deepEqual(find(ev, "weather").map((e) => e.weather), [null]);
  const sand = duel("geodude", ["sandstorm"], "pikachu", ["splash"]); ev = sand.round();
  assert.deepEqual(find(ev, "hp", { reason: "weather" }).map((e) => e.target), [1]); // Rock types are spared.
  const wall = duel("abra", ["reflect", "splash"], "machop", ["tackle"], { plan: { 2: ["splash", "tackle"] } });
  const open = find(duel("abra", ["splash"], "machop", ["tackle"]).round(), "hit")[0].dmg;
  wall.round(); assert.ok(Math.abs(find(wall.round(), "hit")[0].dmg - open / 2) <= 1);
  const terrain = duel("pikachu", ["electricterrain"], "bulbasaur", ["sleeppowder"]); ev = terrain.round();
  assert.equal(find(ev, "terrain")[0].terrain, "electric"); assert.ok(said(ev, /protected by the terrain/)); assert.equal(terrain.mons[0].status, null);
  // Leech Seed, Substitute, binding moves, Curse, Perish Song.
  const seed = duel("bulbasaur", ["leechseed", "splash"], "squirtle", ["splash"], { plan: { 2: ["splash", "splash"] } }); seed.mons[0].hp = 30;
  ev = seed.round(); const sapped = find(ev, "hp", { target: 1, reason: "leech" })[0];
  assert.equal(sapped.delta, -Math.floor(seed.mons[1].maxHp / 8)); assert.equal(find(ev, "hp", { target: 0, reason: "drain" })[0].delta, -sapped.delta);
  assert.ok(said(duel("bulbasaur", ["leechseed"], "oddish", ["splash"]).round(), /doesn't affect/));
  const sub = duel("pikachu", ["substitute", "splash"], "snorlax", ["tackle", "toxic"], { plan: { 2: ["splash", "toxic"] } }); ev = sub.round();
  assert.equal(find(ev, "hp", { target: 0, reason: "cost" })[0].delta, -Math.floor(sub.mons[0].maxHp / 4));
  assert.equal(find(ev, "hit", { who: 1 })[0].sub, true); assert.equal(sub.mons[0].hp, sub.mons[0].maxHp - Math.floor(sub.mons[0].maxHp / 4));
  const wrap = duel("ekans", ["wrap", "splash"], "snorlax", ["splash"], { plan: { 2: ["splash", "splash"] } }); wrap.round();
  assert.equal(find(wrap.round(), "hp", { reason: "trap" })[0].delta, -Math.floor(wrap.mons[1].maxHp / 8));
  const curse = duel("gengar", ["curse"], "snorlax", ["splash"]); ev = curse.round();
  assert.equal(curse.mons[0].hp, curse.mons[0].maxHp - Math.floor(curse.mons[0].maxHp / 2)); assert.equal(find(ev, "hp", { target: 1, reason: "curse" }).length, 1);
  const song = duel("lapras", ["perishsong", "splash"], "snorlax", ["splash"]); song.choose = (mon) => moves[song.turn === 1 && mon === song.mons[0] ? "perishsong" : "splash"];
  for (let i = 0; i < 4 && !song.over; i++) song.round();
  assert.equal(song.over, true); assert.equal(song.winner, null); assert.equal(song.reason, "faint");
});

test("moves with their own rules: fleeing, copying, calling and trading blows", () => {
  let ev = duel("pidgey", ["whirlwind"], "rattata", ["tackle"]).round();
  assert.deepEqual(find(ev, "end").map((e) => [e.reason, e.who, e.winner]), [["flee", 1, null]]); assert.ok(said(ev, /blown away/));
  assert.ok(said(duel("pidgey", ["whirlwind"], "rattata", ["tackle"], { level: 20, levelB: 30 }).round(), /But it failed/));
  const tele = duel("abra", ["teleport"], "rattata", ["tackle"]); ev = tele.round();
  assert.equal(tele.reason, "flee"); assert.equal(find(ev, "end")[0].who, 0);
  const held = duel("abra", ["teleport"], "zubat", ["meanlook"]); held.mons[1].stats.spe = 999; assert.ok(said(held.round(), /But it failed/));
  const ditto = duel("ditto", ["transform"], "charizard", ["splash"]); ev = ditto.round();
  assert.equal(find(ev, "transform", { who: 0, target: 1 }).length, 1);
  assert.deepEqual(ditto.mons[0].types, ["fire", "flying"]); assert.deepEqual(ditto.mons[0].moves.map((s) => [s.id, s.pp]), [["splash", 5]]);
  assert.equal(ditto.mons[0].stats.atk, ditto.mons[1].stats.atk);
  const met = duel("clefairy", ["metronome"], "snorlax", ["splash"], { rng: seeded(3) }); ev = met.round();
  const called = texts(ev).filter((t) => /^Clefairy used /.test(t)).map((t) => /used (.+)!$/.exec(t)[1]); assert.equal(called[0], "Metronome");
  assert.ok(called.length >= 2 && Object.values(moves).find((m) => m.name === called[1]).flags.includes("metronome")); assert.equal(met.mons[0].moves[0].pp, 9);
  const mirror = duel("snorlax", ["mirrormove"], "pikachu", ["thundershock"]); mirror.mons[1].stats.spe = 999;
  assert.deepEqual(find(mirror.round(), "use", { who: 0 }).map((e) => e.move), ["mirrormove", "thundershock"]);
  const bond = duel("gengar", ["destinybond"], "snorlax", ["crunch"]); bond.mons[0].hp = 1; ev = bond.round();
  assert.ok(said(ev, /took its attacker down/)); assert.equal(bond.winner, null);
  const split = duel("chansey", ["painsplit"], "pikachu", ["splash"]); split.mons[0].hp = 10; split.round();
  assert.equal(split.mons[0].hp, Math.floor((10 + split.mons[1].maxHp) / 2));
  const drum = duel("snorlax", ["bellydrum"], "pikachu", ["splash"]); drum.round(); assert.equal(drum.mons[0].boosts.atk, 6); assert.equal(drum.mons[0].hp, drum.mons[0].maxHp - Math.floor(drum.mons[0].maxHp / 2));
  const soak = duel("psyduck", ["soak"], "charmander", ["splash"]); ev = soak.round(); assert.deepEqual(soak.mons[1].types, ["water"]); assert.equal(find(ev, "types").length, 1);
  const fake = duel("meowth", ["fakeout"], "snorlax", ["tackle"]); ev = fake.round(); assert.ok(said(ev, /flinched/));
  ev = fake.round(); assert.ok(said(ev, /But it failed/)); // Only on the first turn out.
  const sucker = duel("snorlax", ["suckerpunch"], "pikachu", ["growl"]); assert.ok(said(sucker.round(), /But it failed/));
  assert.deepEqual(M.createMon(species.get("clefairy"), 50, ["followme", "trick", "pound"], data).moves.map((slot) => slot.id), ["pound"]); // Removed moves cannot be given.
  assert.ok(said(duel("magikarp", ["splash"], "snorlax", ["splash"]).round(), /nothing happened/));
  const dream = duel("gengar", ["dreameater"], "snorlax", ["splash"]); assert.ok(said(dream.round(), /But it failed/));
  const spite = duel("gastly", ["spite"], "snorlax", ["hyperbeam", "splash"]); spite.mons[1].moves[0].pp = 3; spite.mons[1].lastMove = "hyperbeam";
  ev = spite.round(); assert.ok(said(ev, /has no PP left for Hyper Beam/)); assert.equal(spite.mons[1].moves[0].pp, 0);
  // With no PP left anywhere, Struggle.
  const tired = duel("magikarp", ["tackle"], "snorlax", ["splash"]); tired.choose = M.Fight.prototype.choose.bind(tired); tired.mons[0].moves[0].pp = 0;
  ev = tired.round(); assert.equal(find(ev, "use", { who: 0 })[0].move, "struggle"); assert.equal(find(ev, "hp", { target: 0, reason: "recoil" }).length, 1);
});

test("the built-in opponent picks sensible moves", () => {
  const f = duel("pikachu", ["thunderbolt", "thunderwave", "growl", "quickattack"], "sandshrew", ["tackle"], { rng: seeded(9) });
  const counts = {}; for (let i = 0; i < 400; i++) { const id = M.Fight.prototype.choose.call(f, f.mons[0]).id; counts[id] = (counts[id] || 0) + 1; }
  assert.ok(counts.quickattack > counts.thunderbolt * 4, JSON.stringify(counts)); // Electric moves cannot touch Ground.
  assert.ok(counts.growl > (counts.thunderwave || 0));
  f.mons[0].v.taunt = { turns: 3 }; assert.ok(["thunderbolt", "quickattack"].includes(M.Fight.prototype.choose.call(f, f.mons[0]).id));
  f.mons[0].v = { encore: { id: "growl", turns: 3 } }; assert.equal(M.Fight.prototype.choose.call(f, f.mons[0]).id, "growl");
});

test("every move in the game can be used, by either side, without breaking the battle", () => {
  const rng = seeded(2026), ids = Object.keys(moves), used = new Set(), announced = new Set(), kinds = {};
  const pick = () => species.get(1 + Math.floor(rng() * 1025));
  let fights = 0, turns = 0;
  for (let rep = 0; rep < 2; rep++) for (const id of ids) {
    const a = pick(), b = pick(), other = ids[Math.floor(rng() * ids.length)];
    const f = new M.Fight(M.createMon(a, 50, [id, other], data), M.createMon(b, 50, rep ? [id, "tackle"] : M.pickMoves(b, data, rng), data), data, rng);
    if (rep === 0) { let first = true; const choose = f.choose.bind(f); f.choose = (mon) => (first && mon === f.mons[0] ? (first = false, moves[id]) : choose(mon)); }
    while (!f.over) {
      const events = f.round();
      for (const ev of events) {
        kinds[ev.e] = true;
        if (ev.e === "use") used.add(ev.move);
        if (ev.e === "text") { assert.ok(!/undefined|NaN|\[object|null/.test(ev.text), `${id}: ${ev.text}`); const m = /used (.+)!$/.exec(ev.text); if (m) announced.add(m[1]); }
        for (const key of ["hp", "dmg", "delta"]) if (key in ev) assert.ok(Number.isInteger(ev[key]), `${id}: ${key} in ${ev.e}`);
        for (const key of ["who", "target"]) if (ev[key] !== undefined && ev[key] !== null) assert.ok(ev[key] === 0 || ev[key] === 1, `${id}: ${key}`);
      }
      for (const mon of f.mons) {
        assert.ok(Number.isInteger(mon.hp) && mon.hp >= 0 && mon.hp <= mon.maxHp, `${id}: HP ${mon.hp}`);
        for (const s of M.BOOSTS) assert.ok(Math.abs(mon.boosts[s]) <= 6, `${id}: ${s}`);
        for (const slot of mon.moves) assert.ok(slot.pp >= 0, `${id}: PP`);
      }
      assert.ok(f.turn <= f.maxTurns, `${id}: battle did not end`);
    }
    assert.ok(["faint", "flee", "draw"].includes(f.reason)); fights++; turns += f.turn;
  }
  // Every single move was announced ("X used Y!") at least once.
  const names = new Set(ids.map((id) => moves[id].name));
  assert.deepEqual([...names].filter((name) => !announced.has(name)), []);
  assert.ok(used.size > ids.length * 0.9);
  for (const kind of ["text", "use", "charge", "reveal", "hit", "miss", "block", "hp", "status", "volatile", "boost", "weather", "terrain", "field", "side", "types", "faint", "end"]) assert.ok(kinds[kind], kind);
  assert.ok(turns / fights > 2 && turns / fights < 15);
});

test("the variant list names real Pokémon and well-formed Sprite Collab paths", () => {
  const variants = require("../data/variants.json"), nums = new Set(pokedex.species.map((s) => s.num));
  assert.ok(Object.keys(variants).length > 900);
  for (const [num, ids] of Object.entries(variants)) {
    assert.ok(nums.has(Number(num)), num); assert.ok(ids.length >= 1); assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) { assert.match(id, /^\d{4}(?:\/\d{4}){0,3}$/); assert.equal(Number(id.slice(0, 4)), Number(num)); }
  }
  assert.ok(variants[25].includes("0025") && variants[25].includes("0025/0000/0001"));
});

test("coverage is reported honestly", () => {
  const tally = {}; for (const m of Object.values(moves)) { const c = M.coverage(m); tally[c] = (tally[c] || 0) + 1; }
  assert.deepEqual(Object.keys(tally).sort(), ["custom", "data", "data+simplified"]);
  assert.ok(tally.data + tally.custom > 650);
  assert.equal(M.coverage(moves.thunderbolt), "data"); assert.equal(M.coverage(moves.transform), "custom");
});
