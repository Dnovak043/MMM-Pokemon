/* MIT license. Battle rules: a pure, deterministic-given-rng model of a
 * one-on-one battle. It knows nothing about sprites or time; `Fight.round()`
 * resolves one full turn and returns a list of events for the presentation
 * layer to play back:
 *
 *   act · text · use · charge · reveal · hit · miss · block · hp · status · volatile
 *   boost · weather · terrain · field · side · types · transform · faint · end
 *
 * Moves are driven by the data in data/moves.json (type, power, accuracy,
 * priority, flags, secondary effects, stat changes, weather, …). Moves whose
 * behavior is not expressible as data are implemented in the POWER, DAMAGE,
 * BEFORE, AFTER and STATUS tables below. There are no abilities, held items or
 * partners, so the moves that only work with one are left out of the data. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PkMechanics = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const TYPES = ["normal", "fighting", "flying", "poison", "ground", "rock", "bug", "ghost", "steel", "fire", "water", "grass", "electric", "psychic", "ice", "dragon", "dark", "fairy"];
  // Attacking type → one character per defending type, in TYPES order: 0 none, - half, . normal, + double.
  const CHART = {
    normal: ".....-.0-.........", fighting: "+.--.+-0+....-+.+-", flying: ".+...-+.-..+-.....", poison: "...---.-0..+.....+",
    ground: "..0+.+-.++.-+.....", rock: ".-+.-.+.-+....+...", bug: ".---...---.+.+..+-", ghost: "0......+.....+..-.",
    steel: ".....+..---.-.+..+", fire: ".....-+.+--+..+-..", water: "....++...+--...-..", grass: "..--++-.--+-...-..",
    electric: "..+.0.....+--..-..", psychic: ".+.+....-....-..0.", ice: "..+.+...---+..-+..", dragon: "........-......+.0",
    dark: ".-.....+.....+..--", fairy: ".+.-....--.....++."
  };
  const FACTOR = { 0: 0, "-": 0.5, ".": 1, "+": 2 };
  const BOOSTS = ["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"];
  const STAT_NAMES = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "accuracy", evasion: "evasiveness" };
  const STATUS_TEXT = { par: "is paralyzed! It may be unable to move!", slp: "fell asleep!", frz: "was frozen solid!", brn: "was burned!", psn: "was poisoned!", tox: "was badly poisoned!" };
  const STATUS_IMMUNE = { par: ["electric"], brn: ["fire"], psn: ["poison", "steel"], tox: ["poison", "steel"], frz: ["ice"] };
  const WEATHER = { raindance: "rain", sunnyday: "sun", sandstorm: "sand", hail: "snow", snowscape: "snow" };
  const WEATHER_TEXT = { rain: "It started to rain!", sun: "The sunlight turned harsh!", sand: "A sandstorm kicked up!", snow: "It started to snow!" };
  const TERRAIN = { electricterrain: "electric", grassyterrain: "grassy", mistyterrain: "misty", psychicterrain: "psychic" };
  // Two-turn moves that take the user out of reach, how they look, and what can still hit them (×2 where marked).
  const HIDE = { fly: "up", bounce: "up", skydrop: "up", dig: "down", dive: "down", phantomforce: "gone", shadowforce: "gone" };
  const REACH = {
    up: { gust: 2, twister: 2, thunder: 1, hurricane: 1, skyuppercut: 1, smackdown: 1, thousandarrows: 1 },
    dig: { earthquake: 2, magnitude: 2, fissure: 1 }, dive: { surf: 2, whirlpool: 2 }
  };
  const PROTECTS = ["protect", "banefulbunker", "burningbulwark", "kingsshield", "maxguard", "obstruct", "silktrap", "spikyshield"];
  const SELF_TARGETS = ["self", "allySide", "allyTeam", "adjacentAllyOrSelf", "allies"];
  const weightPower = (kg) => (kg < 10 ? 20 : kg < 25 ? 40 : kg < 50 ? 60 : kg < 100 ? 80 : kg < 200 ? 100 : 120);

  /* Variable base power: (ctx) → power. ctx = { f: fight, u: user, t: target, m: move, hit: index }. */
  const POWER = {
    lowkick: (c) => weightPower(c.t.kg), grassknot: (c) => weightPower(c.t.kg),
    heavyslam: (c) => { const r = c.u.kg / c.t.kg; return r >= 5 ? 120 : r >= 4 ? 100 : r >= 3 ? 80 : r >= 2 ? 60 : 40; },
    gyroball: (c) => Math.min(150, Math.floor(25 * c.f.speed(c.t) / c.f.speed(c.u)) + 1),
    electroball: (c) => { const r = c.f.speed(c.u) / c.f.speed(c.t); return r >= 4 ? 150 : r >= 3 ? 120 : r >= 2 ? 80 : r >= 1 ? 60 : 40; },
    flail: (c) => { const r = Math.floor(48 * c.u.hp / c.u.maxHp); return r < 2 ? 200 : r < 5 ? 150 : r < 10 ? 100 : r < 17 ? 80 : r < 33 ? 40 : 20; },
    eruption: (c) => Math.max(1, Math.floor(150 * c.u.hp / c.u.maxHp)),
    crushgrip: (c) => Math.max(1, Math.floor(120 * c.t.hp / c.t.maxHp)),
    hardpress: (c) => Math.max(1, Math.floor(100 * c.t.hp / c.t.maxHp)),
    return: () => 102, pikapapow: () => 102, veeveevolley: () => 102,
    trumpcard: (c) => [200, 80, 60, 50, 40][Math.min(4, (c.u.moves.find((s) => s.id === "trumpcard") || { pp: 4 }).pp)],
    punishment: (c) => Math.min(200, 60 + 20 * BOOSTS.reduce((n, s) => n + Math.max(0, c.t.boosts[s]), 0)),
    storedpower: (c) => 20 + 20 * BOOSTS.reduce((n, s) => n + Math.max(0, c.u.boosts[s]), 0),
    magnitude: (c) => { const r = c.f.rand(100), i = r < 5 ? 0 : r < 15 ? 1 : r < 35 ? 2 : r < 65 ? 3 : r < 85 ? 4 : r < 95 ? 5 : 6; c.f.say(`Magnitude ${i + 4}!`); return [10, 30, 50, 70, 90, 110, 150][i]; },
    present: (c) => { if (c.u.gift === undefined) { const r = c.f.rand(10); c.u.gift = r < 4 ? 40 : r < 7 ? 80 : r < 8 ? 120 : 0; } return c.u.gift; },
    spitup: (c) => 100 * ((c.u.v.stockpile || {}).n || 0),
    beatup: (c) => Math.floor(c.u.stats.atk / 10) + 5,
    furycutter: (c) => Math.min(160, 40 * 2 ** Math.min(2, c.u.chain || 0)),
    rollout: (c) => 30 * (c.u.v.defensecurl ? 2 : 1),
    ragefist: (c) => Math.min(350, 50 + 50 * c.u.timesHit),
    triplekick: (c) => 10 * (c.hit + 1), tripleaxel: (c) => 20 * (c.hit + 1),
    hex: (c) => (c.t.status ? 130 : 65), infernalparade: (c) => (c.t.status ? 120 : 60),
    venoshock: (c) => (["psn", "tox"].includes(c.t.status) ? 130 : 65), barbbarrage: (c) => (["psn", "tox"].includes(c.t.status) ? 120 : 60),
    brine: (c) => (c.t.hp * 2 <= c.t.maxHp ? 130 : 65),
    facade: (c) => (["brn", "par", "psn", "tox"].includes(c.u.status) ? 140 : 70),
    acrobatics: () => 110, knockoff: () => 65,
    wakeupslap: (c) => (c.t.status === "slp" ? 140 : 70), smellingsalts: (c) => (c.t.status === "par" ? 140 : 70),
    weatherball: (c) => (c.f.weather ? 100 : 50), terrainpulse: (c) => (c.f.terrain && c.f.grounded(c.u) ? 100 : 50),
    solarbeam: (c) => (["rain", "sand", "snow"].includes(c.f.weather) ? 60 : 120), solarblade: (c) => (["rain", "sand", "snow"].includes(c.f.weather) ? 62 : 125),
    boltbeak: (c) => (c.t.moved ? 85 : 170),
    payback: (c) => (c.t.moved ? 100 : 50), avalanche: (c) => (c.u.hurt ? 120 : 60), assurance: (c) => (c.t.hurt ? 120 : 60),
    risingvoltage: (c) => (c.f.terrain === "electric" && c.f.grounded(c.t) ? 140 : 70),
    expandingforce: (c) => (c.f.terrain === "psychic" && c.f.grounded(c.u) ? 120 : 80),
    mistyexplosion: (c) => (c.f.terrain === "misty" && c.f.grounded(c.u) ? 150 : 100),
    gravapple: (c) => (c.f.field.gravity ? 120 : 80), psyblade: (c) => (c.f.terrain === "electric" ? 120 : 80),
    hiddenpower: () => 60, lastrespects: () => 50
  };
  for (const [alias, of] of Object.entries({ heatcrash: "heavyslam", reversal: "flail", waterspout: "eruption", dragonenergy: "eruption", wringout: "crushgrip",
    frustration: "return", powertrip: "storedpower", iceball: "rollout", fishiousrend: "boltbeak", revenge: "avalanche" })) POWER[alias] = POWER[of];

  /* Fixed damage: (ctx) → HP, or null to fail. */
  const DAMAGE = {
    superfang: (c) => Math.max(1, Math.floor(c.t.hp / 2)), naturesmadness: (c) => Math.max(1, Math.floor(c.t.hp / 2)), ruination: (c) => Math.max(1, Math.floor(c.t.hp / 2)),
    guardianofalola: (c) => Math.max(1, Math.floor(c.t.hp * 3 / 4)),
    psywave: (c) => Math.max(1, Math.floor(c.u.level * (50 + c.f.rand(101)) / 100)),
    endeavor: (c) => (c.t.hp > c.u.hp ? c.t.hp - c.u.hp : null),
    finalgambit: (c) => { const hp = c.u.hp; c.u.hp = 0; c.f.push({ e: "hp", target: c.f.idx(c.u), hp: 0, delta: -hp, reason: "cost" }); return hp; },
    counter: (c) => (c.u.hurt && c.u.hurt.category === "physical" ? c.u.hurt.dmg * 2 : null),
    mirrorcoat: (c) => (c.u.hurt && c.u.hurt.category === "special" ? c.u.hurt.dmg * 2 : null),
    metalburst: (c) => (c.u.hurt ? Math.floor(c.u.hurt.dmg * 1.5) : null), comeuppance: (c) => (c.u.hurt ? Math.floor(c.u.hurt.dmg * 1.5) : null)
  };

  /* Move type overrides. */
  const TYPE = {
    weatherball: (c) => ({ rain: "water", sun: "fire", sand: "rock", snow: "ice" })[c.f.weather],
    terrainpulse: (c) => ({ electric: "electric", grassy: "grass", misty: "fairy", psychic: "psychic" })[c.f.terrain],
    revelationdance: (c) => c.u.types[0], ragingbull: (c) => c.u.types[1], ivycudgel: (c) => c.u.types[1],
    hiddenpower: (c) => TYPES[1 + (c.u.name.length * 7 + c.u.stats.spe) % 17], judgment: (c) => c.u.types[0], multiattack: (c) => c.u.types[0]
  };

  /* Conditions checked before a move executes: return a string to fail with that text ("" = "But it failed!"). */
  const BEFORE = {
    fakeout: (c) => (c.u.turns > 1 ? "" : null), firstimpression: (c) => (c.u.turns > 1 ? "" : null),
    suckerpunch: (c) => (c.t.moved || !c.t.choice || c.t.choice.category === "status" ? "" : null),
    thunderclap: (c) => (c.t.moved || !c.t.choice || c.t.choice.category === "status" ? "" : null),
    focuspunch: (c) => (c.u.hurt ? `${c.u.name} lost its focus and couldn't move!` : null),
    dreameater: (c) => (c.t.status === "slp" ? null : ""), snore: (c) => (c.u.status === "slp" ? null : ""),
    lastresort: (c) => (c.u.moves.length > 1 && c.u.moves.every((s) => s.id === "lastresort" || s.used) ? null : ""),
    burnup: (c) => (c.u.types.includes("fire") ? null : ""), doubleshock: (c) => (c.u.types.includes("electric") ? null : ""),
    spitup: (c) => (c.u.v.stockpile ? null : ""), swallow: (c) => (c.u.v.stockpile ? null : ""),
    steelroller: (c) => (c.f.terrain ? null : ""), aurawheel: (c) => (c.u.id === "morpeko" ? null : ""),
    hyperspacefury: (c) => (c.u.id === "hoopa" ? null : ""), darkvoid: (c) => (c.u.id === "darkrai" ? null : ""),
    synchronoise: (c) => (c.t.types.some((t) => c.u.types.includes(t)) ? null : ""),
    synchronoise_: null
  };
  delete BEFORE.synchronoise_;

  /* Extra effects after a damaging move connects. */
  const AFTER = {
    rapidspin: (c) => c.f.free(c.u), mortalspin: (c) => c.f.free(c.u),
    brickbreak: (c) => c.f.breakScreens(c.t), psychicfangs: (c) => c.f.breakScreens(c.t), ragingbull: (c) => c.f.breakScreens(c.t),
    wakeupslap: (c) => { if (c.t.status === "slp") c.f.cure(c.t); }, smellingsalts: (c) => { if (c.t.status === "par") c.f.cure(c.t); },
    sparklingaria: (c) => { if (c.t.status === "brn") c.f.cure(c.t); },
    clearsmog: (c) => { c.f.resetBoosts(c.t); c.f.say(`${c.t.name}'s stat changes were removed!`); },
    burnup: (c) => c.f.retype(c.u, c.u.types.filter((t) => t !== "fire"), `${c.u.name} burned itself out!`),
    doubleshock: (c) => c.f.retype(c.u, c.u.types.filter((t) => t !== "electric"), `${c.u.name} used up all its electricity!`),
    payday: (c) => c.f.say("Coins were scattered everywhere!"), makeitrain: (c) => c.f.say("Coins were scattered everywhere!"),
    spectralthief: (c) => { for (const s of BOOSTS) if (c.t.boosts[s] > 0) { c.u.boosts[s] = Math.min(6, c.u.boosts[s] + c.t.boosts[s]); c.t.boosts[s] = 0; } },
    furycutter: (c) => { c.u.chain = (c.u.chain || 0) + 1; },
    icespinner: (c) => c.f.setTerrain(null), steelroller: (c) => c.f.setTerrain(null),
    smackdown: (c) => { if (c.t.v.twoturn && HIDE[c.t.v.twoturn.id] === "up") { delete c.t.v.twoturn; c.f.push({ e: "reveal", who: c.f.idx(c.t) }); } },
    eeriespell: (c) => c.f.drainPp(c.t, 3), gmaxdepletion: (c) => c.f.drainPp(c.t, 2),
    chloroblast: (c) => c.f.lose(c.u, Math.ceil(c.u.maxHp / 2), "recoil"),
    coreenforcer: () => {}, pluck: () => {}, bugbite: () => {}, incinerate: () => {}, thief: () => {}, covet: () => {}
  };

  /* Status moves with bespoke behavior: return false to fail ("But it failed!"). */
  const swap = (c, stats) => { for (const s of stats) [c.u.boosts[s], c.t.boosts[s]] = [c.t.boosts[s], c.u.boosts[s]]; };
  const average = (c, stats) => { for (const s of stats) c.u.stats[s] = c.t.stats[s] = Math.floor((c.u.stats[s] + c.t.stats[s]) / 2); };
  const STATUS = {
    splash: (c) => c.f.say("But nothing happened!"), celebrate: (c) => c.f.say(`Congratulations, ${c.u.name}!`), happyhour: (c) => c.f.say("Everyone is caught up in the happy atmosphere!"),
    rest: (c) => {
      if (c.u.hp >= c.u.maxHp || c.u.status === "slp") return false;
      c.u.status = "slp"; c.u.statusTurns = 2; c.f.push({ e: "status", target: c.f.idx(c.u), status: "slp" });
      c.f.say(`${c.u.name} slept and became healthy!`); c.f.heal(c.u, c.u.maxHp);
    },
    bellydrum: (c) => { if (c.u.hp * 2 <= c.u.maxHp || c.u.boosts.atk >= 6) return false; c.f.lose(c.u, Math.floor(c.u.maxHp / 2), "cost"); c.u.boosts.atk = 6; c.f.push({ e: "boost", target: c.f.idx(c.u), stat: "atk", n: 6 }); c.f.say(`${c.u.name} cut its own HP and maximized its Attack!`); },
    filletaway: (c) => { if (c.u.hp * 2 <= c.u.maxHp) return false; c.f.lose(c.u, Math.floor(c.u.maxHp / 2), "cost"); c.f.boost(c.u, { atk: 2, spa: 2, spe: 2 }); },
    clangoroussoul: (c) => { if (c.u.hp * 3 <= c.u.maxHp) return false; c.f.lose(c.u, Math.floor(c.u.maxHp / 3), "cost"); c.f.boost(c.u, { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }); },
    painsplit: (c) => { const each = Math.floor((c.u.hp + c.t.hp) / 2); for (const mon of [c.u, c.t]) { const to = Math.min(mon.maxHp, each), delta = to - mon.hp; mon.hp = to; c.f.push({ e: "hp", target: c.f.idx(mon), hp: to, delta, reason: delta > 0 ? "heal" : "cost" }); } c.f.say("The battlers shared their pain!"); },
    transform: (c) => {
      if (c.u.v.transformed || c.t.v.transformed || c.t.v.substitute) return false;
      c.u.v.transformed = true; c.u.types = [...c.t.types]; c.u.stats = { ...c.t.stats }; c.u.boosts = { ...c.t.boosts }; c.u.kg = c.t.kg;
      c.u.moves = c.t.moves.map((s) => ({ id: s.id, pp: 5, max: 5 }));
      c.f.push({ e: "transform", who: c.f.idx(c.u), target: c.f.idx(c.t) }); c.f.say(`${c.u.name} transformed into ${c.t.name}!`);
    },
    metronome: (c) => { const pool = Object.values(c.f.moves).filter((m) => m.flags.includes("metronome")); c.f.say("Waggling a finger let it use…"); c.f.call(c.u, c.t, pool[c.f.rand(pool.length)]); },
    mirrormove: (c) => { const m = c.f.moves[c.t.lastMove]; if (!m || !m.flags.includes("mirror")) return false; c.f.call(c.u, c.t, m); },
    copycat: (c) => { const m = c.f.moves[c.f.lastMove]; if (!m || m.flags.includes("failcopycat")) return false; c.f.call(c.u, c.t, m); },
    sleeptalk: (c) => { if (c.u.status !== "slp") return false; const pool = c.u.moves.map((s) => c.f.moves[s.id]).filter((m) => !m.flags.includes("nosleeptalk") && m.id !== "sleeptalk"); if (!pool.length) return false; c.f.call(c.u, c.t, pool[c.f.rand(pool.length)]); },
    naturepower: (c) => c.f.call(c.u, c.t, c.f.moves[{ electric: "thunderbolt", grassy: "energyball", misty: "moonblast", psychic: "psychic" }[c.f.terrain] || "triattack"]),
    mimic: (c) => c.f.learn(c), sketch: (c) => c.f.learn(c),
    teleport: (c) => { if (c.u.v.trapped || c.u.v.partiallytrapped || c.u.v.ingrain || c.f.field.fairylock) return false; c.f.finish(null, "flee", c.u, `${c.u.name} teleported away!`); },
    haze: (c) => { c.f.resetBoosts(c.u); c.f.resetBoosts(c.t); c.f.say("All stat changes were eliminated!"); },
    psychup: (c) => { c.u.boosts = { ...c.t.boosts }; c.f.say(`${c.u.name} copied ${c.t.name}'s stat changes!`); },
    heartswap: (c) => { swap(c, BOOSTS); c.f.say(`${c.u.name} switched stat changes with its target!`); },
    powerswap: (c) => { swap(c, ["atk", "spa"]); c.f.say(`${c.u.name} switched all changes to its Attack and Sp. Atk with its target!`); },
    guardswap: (c) => { swap(c, ["def", "spd"]); c.f.say(`${c.u.name} switched all changes to its Defense and Sp. Def with its target!`); },
    speedswap: (c) => { [c.u.stats.spe, c.t.stats.spe] = [c.t.stats.spe, c.u.stats.spe]; c.f.say(`${c.u.name} switched Speed with its target!`); },
    powersplit: (c) => { average(c, ["atk", "spa"]); c.f.say(`${c.u.name} shared its power with the target!`); },
    guardsplit: (c) => { average(c, ["def", "spd"]); c.f.say(`${c.u.name} shared its guard with the target!`); },
    topsyturvy: (c) => { if (BOOSTS.every((s) => !c.t.boosts[s])) return false; for (const s of BOOSTS) c.t.boosts[s] = -c.t.boosts[s] || 0; c.f.say(`${c.t.name}'s stat changes were all reversed!`); },
    curse: (c) => {
      if (!c.u.types.includes("ghost")) return c.f.boost(c.u, { spe: -1, atk: 1, def: 1 });
      if (c.t.v.curse) return false;
      c.f.lose(c.u, Math.floor(c.u.maxHp / 2), "cost"); c.t.v.curse = {}; c.f.push({ e: "volatile", target: c.f.idx(c.t), name: "curse", on: true });
      c.f.say(`${c.u.name} cut its own HP and put a curse on ${c.t.name}!`);
    },
    perishsong: (c) => { let any = false; for (const mon of [c.u, c.t]) if (!mon.v.perish) { mon.v.perish = { n: 4 }; any = true; } if (!any) return false; c.f.say("All Pokémon that heard the song will faint in three turns!"); },
    healbell: (c) => c.f.cure(c.u) || c.f.say("A bell chimed!"), aromatherapy: (c) => c.f.cure(c.u) || c.f.say("A soothing aroma wafted through the area!"),
    refresh: (c) => { if (!["brn", "par", "psn", "tox"].includes(c.u.status)) return false; c.f.cure(c.u); },
    takeheart: (c) => { c.f.cure(c.u); c.f.boost(c.u, { spa: 1, spd: 1 }); },
    lunarblessing: (c) => { const had = c.u.status; c.f.cure(c.u); if (!c.f.heal(c.u, c.u.maxHp / 4) && !had) return false; },
    junglehealing: (c) => { const had = c.u.status; c.f.cure(c.u); if (!c.f.heal(c.u, c.u.maxHp / 4) && !had) return false; },
    purify: (c) => { if (!c.t.status) return false; c.f.cure(c.t); c.f.heal(c.u, c.u.maxHp / 2); },
    psychoshift: (c) => { const s = c.u.status; if (!s || c.t.status || !c.f.inflict(c.t, s, c.u)) return false; c.f.cure(c.u); },
    strengthsap: (c) => { if (c.t.boosts.atk <= -6) return false; c.f.heal(c.u, c.f.stat(c.t, "atk")); c.f.boost(c.t, { atk: -1 }, c.u); },
    swallow: (c) => { const n = c.u.v.stockpile.n; c.f.unstock(c.u); if (!c.f.heal(c.u, c.u.maxHp * [0.25, 0.5, 1][n - 1])) return false; },
    synthesis: (c) => c.f.heal(c.u, c.u.maxHp * (c.f.weather === "sun" ? 2 / 3 : c.f.weather ? 1 / 4 : 1 / 2)) > 0,
    shoreup: (c) => c.f.heal(c.u, c.u.maxHp * (c.f.weather === "sand" ? 2 / 3 : 1 / 2)) > 0,
    wish: (c) => { if (c.u.wish) return false; c.u.wish = { turns: 2, hp: Math.floor(c.u.maxHp / 2) }; c.f.say(`${c.u.name} made a wish!`); },
    acupressure: (c) => { const open = BOOSTS.filter((s) => c.u.boosts[s] < 6); if (!open.length) return false; c.f.boost(c.u, { [open[c.f.rand(open.length)]]: 2 }); },
    spite: (c) => { if (!c.t.lastMove || !c.f.drainPp(c.t, 4)) return false; },
    conversion: (c) => c.f.retype(c.u, [c.f.moves[c.u.moves[0].id].type], `${c.u.name} transformed into the ${c.f.moves[c.u.moves[0].id].type} type!`),
    conversion2: (c) => { const last = c.f.moves[c.t.lastMove]; if (!last) return false; const pick = TYPES.filter((t) => FACTOR[CHART[last.type][TYPES.indexOf(t)]] < 1); if (!pick.length) return false; const type = pick[c.f.rand(pick.length)]; c.f.retype(c.u, [type], `${c.u.name} transformed into the ${type} type!`); },
    soak: (c) => c.f.retype(c.t, ["water"], `${c.t.name} transformed into the water type!`),
    magicpowder: (c) => c.f.retype(c.t, ["psychic"], `${c.t.name} transformed into the psychic type!`),
    camouflage: (c) => c.f.retype(c.u, [{ electric: "electric", grassy: "grass", misty: "fairy", psychic: "psychic" }[c.f.terrain] || "normal"], `${c.u.name} blended in with its surroundings!`),
    reflecttype: (c) => c.f.retype(c.u, [...c.t.types], `${c.u.name}'s type became the same as ${c.t.name}'s!`),
    trickortreat: (c) => (c.t.types.includes("ghost") ? false : c.f.retype(c.t, [...c.t.types, "ghost"], `Ghost type was added to ${c.t.name}!`)),
    forestscurse: (c) => (c.t.types.includes("grass") ? false : c.f.retype(c.t, [...c.t.types, "grass"], `Grass type was added to ${c.t.name}!`)),
    defog: (c) => { c.f.boost(c.t, { evasion: -1 }, c.u); c.f.breakScreens(c.t); for (const mon of [c.u, c.t]) for (const k of ["spikes", "toxicspikes", "stealthrock", "stickyweb", "mist", "safeguard"]) delete mon.side[k]; c.f.setTerrain(null); },
    tidyup: (c) => { for (const mon of [c.u, c.t]) { for (const k of ["spikes", "toxicspikes", "stealthrock", "stickyweb"]) delete mon.side[k]; if (mon.v.substitute) c.f.drop(mon, "substitute"); } c.f.say("Tidying up complete!"); c.f.boost(c.u, { atk: 1, spe: 1 }); },
    courtchange: (c) => { [c.u.side, c.t.side] = [c.t.side, c.u.side]; c.f.say(`${c.u.name} swapped the battle effects affecting each side of the field!`); },
    futuresight: (c) => c.f.foresee(c), doomdesire: (c) => c.f.foresee(c),
    stockpile: (c) => { const s = c.u.v.stockpile || (c.u.v.stockpile = { n: 0, def: 0, spd: 0 }); if (s.n >= 3) return false; s.n++; c.f.say(`${c.u.name} stockpiled ${s.n}!`); for (const k of ["def", "spd"]) if (c.u.boosts[k] < 6) { s[k]++; c.f.boost(c.u, { [k]: 1 }); } },
    memento: (c) => { c.f.boost(c.t, { atk: -2, spa: -2 }, c.u); c.f.lose(c.u, c.u.hp, "cost"); },
    grudge: (c) => { c.u.v.grudge = {}; c.f.say(`${c.u.name} wants its target to bear a grudge!`); },
    lockon: (c) => { c.u.v.lockon = { turns: 2 }; c.f.say(`${c.u.name} took aim at ${c.t.name}!`); },
    powertrick: (c) => { [c.u.stats.atk, c.u.stats.def] = [c.u.stats.def, c.u.stats.atk]; c.f.say(`${c.u.name} switched its Attack and Defense!`); },
    meanlook: (c) => { if (c.t.v.trapped) return false; c.t.v.trapped = {}; c.f.say(`${c.t.name} can no longer escape!`); },
    psychoshift_: () => {}
  };
  delete STATUS.psychoshift_;
  for (const [alias, of] of Object.entries({ mindreader: "lockon", block: "meanlook", spiderweb: "meanlook", moonlight: "synthesis", morningsun: "synthesis" })) STATUS[alias] = STATUS[of];

  const VOLATILE_TEXT = {
    confusion: "became confused!", leechseed: "was seeded!", attract: "fell in love!", taunt: "fell for the taunt!", torment: "was subjected to torment!",
    nightmare: "began having a nightmare!", yawn: "grew drowsy!", focusenergy: "is getting pumped!", ingrain: "planted its roots!",
    aquaring: "surrounded itself with a veil of water!", magnetrise: "levitated with electromagnetism!", telekinesis: "was hurled into the air!",
    smackdown: "fell straight down!", foresight: "was identified!", miracleeye: "was identified!", endure: "braced itself!", destinybond: "is hoping to take its attacker down with it!",
    healblock: "was prevented from healing!", embargo: "can't use items anymore!", imprison: "sealed any moves its target shares with it!", charge: "began charging power!",
    laserfocus: "concentrated intensely!", noretreat: "can no longer escape because it used No Retreat!", octolock: "can no longer escape because of Octolock!",
    tarshot: "became weaker to fire!", saltcure: "is being salt cured!", syrupbomb: "got covered in sticky candy syrup!", minimize: "", defensecurl: "", rage: "", glaiverush: "",
    roost: "", uproar: "caused an uproar!", bide: "is storing energy!", powder: "is covered in powder!", electrify: "'s moves have been electrified!"
  };

  function createMon(species, level, moveIds, data) {
    const [hp, atk, def, spa, spd, spe] = species.stats;
    const stat = (base) => Math.floor((2 * base + 31) * level / 100) + 5;
    const maxHp = species.id === "shedinja" ? 1 : Math.floor((2 * hp + 31) * level / 100) + level + 10;
    const boosts = {}; for (const s of BOOSTS) boosts[s] = 0;
    return {
      name: species.name, id: species.id, types: [...species.types], level, kg: species.kg || 10,
      stats: { atk: stat(atk), def: stat(def), spa: stat(spa), spd: stat(spd), spe: stat(spe) }, maxHp, hp: maxHp,
      moves: [...new Set(moveIds)].filter((id) => data.moves[id]).slice(0, 4).map((id) => ({ id, pp: data.moves[id].pp, max: data.moves[id].pp })),
      boosts, status: null, statusTurns: 0, v: {}, side: {}, lastMove: null, hurt: null, moved: false, choice: null, timesHit: 0, stall: 0, turns: 0, fainted: false
    };
  }
  /* Four moves from the species' learnset, at least two of which deal damage where it has them. */
  function pickMoves(species, data, rng = Math.random, count = 4) {
    const pool = species.moves.filter((id) => data.moves[id]);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const attacks = pool.filter((id) => data.moves[id].category !== "status" && (data.moves[id].basePower > 0 || POWER[id] || data.moves[id].damage)).slice(0, 2);
    const rest = pool.filter((id) => !attacks.includes(id)).slice(0, count - attacks.length);
    const picked = [...attacks, ...rest];
    return picked.length ? picked : ["struggle"];
  }

  class Fight {
    constructor(a, b, data, rng = Math.random) {
      this.mons = [a, b]; this.data = data; this.moves = data.moves; this.rng = rng;
      this.turn = 0; this.weather = null; this.weatherTurns = 0; this.terrain = null; this.terrainTurns = 0;
      this.field = {}; this.future = [null, null]; this.lastMove = null;
      this.over = false; this.winner = null; this.reason = null; this.events = []; this.maxTurns = 40;
    }
    /* ---- helpers ---- */
    rand(n) { return Math.min(n - 1, Math.floor(this.rng() * n)); }
    chance(percent) { return this.rng() * 100 < percent; }
    push(event) { this.events.push(event); }
    say(text) { this.events.push({ e: "text", text }); }
    idx(mon) { return this.mons.indexOf(mon); }
    foe(mon) { return this.mons[1 - this.idx(mon)]; }
    grounded(mon) {
      if (this.field.gravity || mon.v.ingrain || mon.v.smackdown) return true;
      return !(mon.types.includes("flying") && !mon.v.roost) && !mon.v.magnetrise && !mon.v.telekinesis;
    }
    stat(mon, name, boost = mon.boosts[name]) {
      let key = name;
      if (this.field.wonderroom && (name === "def" || name === "spd")) key = name === "def" ? "spd" : "def";
      return Math.max(1, Math.floor(mon.stats[key] * (boost >= 0 ? (2 + boost) / 2 : 2 / (2 - boost))));
    }
    speed(mon) { return Math.max(1, this.stat(mon, "spe") * (mon.status === "par" ? 0.5 : 1) * (mon.side.tailwind ? 2 : 1)); }
    typeOf(user, target, move) {
      const custom = TYPE[move.id] && TYPE[move.id]({ f: this, u: user, t: target, m: move });
      let type = custom || move.type;
      if (type === "normal" && (this.field.iondeluge || user.v.electrify)) type = "electric";
      return type;
    }
    effectiveness(type, target, move = {}) {
      let total = 1;
      for (const t of target.types) {
        if (t === "flying" && target.v.roost) continue;
        let f = FACTOR[CHART[type][TYPES.indexOf(t)]];
        if (type === "ground" && t === "flying" && (this.grounded(target) || move.id === "thousandarrows")) f = 1;
        if (t === "ghost" && target.v.foresight && (type === "normal" || type === "fighting")) f = 1;
        if (t === "dark" && target.v.miracleeye && type === "psychic") f = 1;
        if (move.id === "freezedry" && t === "water") f = 2;
        total *= f;
      }
      if (move.id === "flyingpress") total *= target.types.reduce((n, t) => n * FACTOR[CHART.flying[TYPES.indexOf(t)]], 1);
      if (type === "ground" && !this.grounded(target) && move.id !== "thousandarrows") total = 0;
      if (type === "fire" && target.v.tarshot) total *= 2;
      return total;
    }
    lose(mon, amount, reason) {
      amount = Math.max(1, Math.min(mon.hp, Math.floor(amount)));
      if (mon.hp <= 0) return 0;
      mon.hp -= amount; this.push({ e: "hp", target: this.idx(mon), hp: mon.hp, delta: -amount, reason });
      return amount;
    }
    heal(mon, amount, reason = "heal") {
      amount = Math.max(1, Math.floor(amount));
      if (mon.hp <= 0 || mon.hp >= mon.maxHp || mon.v.healblock) return 0;
      amount = Math.min(amount, mon.maxHp - mon.hp); mon.hp += amount;
      this.push({ e: "hp", target: this.idx(mon), hp: mon.hp, delta: amount, reason });
      return amount;
    }
    boost(mon, changes, by = mon) {
      let any = false;
      for (const [stat, n] of Object.entries(changes)) {
        if (!n || mon.hp <= 0) continue;
        if (n < 0 && by !== mon && mon.side.mist) { this.say(`${mon.name} is protected by the mist!`); continue; }
        const to = Math.max(-6, Math.min(6, mon.boosts[stat] + n)), delta = to - mon.boosts[stat];
        if (!delta) { this.say(`${mon.name}'s ${STAT_NAMES[stat]} won't go any ${n > 0 ? "higher" : "lower"}!`); continue; }
        mon.boosts[stat] = to; any = true;
        this.push({ e: "boost", target: this.idx(mon), stat, n: delta });
        const size = Math.abs(delta);
        this.say(`${mon.name}'s ${STAT_NAMES[stat]} ${delta > 0 ? (size > 2 ? "rose drastically" : size > 1 ? "rose sharply" : "rose") : (size > 2 ? "severely fell" : size > 1 ? "harshly fell" : "fell")}!`);
      }
      return any;
    }
    resetBoosts(mon) { for (const s of BOOSTS) mon.boosts[s] = 0; }
    /* Give `mon` a major status condition; false if it cannot take hold. */
    inflict(mon, status, by, quiet = false) {
      const fail = (text) => { if (!quiet && text) this.say(text); return false; };
      if (mon.hp <= 0) return false;
      if (mon.status) return fail(mon.status === status ? `${mon.name} is already ${{ par: "paralyzed", slp: "asleep", frz: "frozen", brn: "burned", psn: "poisoned", tox: "poisoned" }[status]}!` : "But it failed!");
      if ((STATUS_IMMUNE[status] || []).some((t) => mon.types.includes(t))) return fail(`It doesn't affect ${mon.name}…`);
      if (mon.side.safeguard && by !== mon) return fail(`${mon.name} is protected by Safeguard!`);
      if (this.grounded(mon) && (this.terrain === "misty" || (this.terrain === "electric" && status === "slp"))) return fail(`${mon.name} is protected by the terrain!`);
      if (status === "slp" && this.mons.some((m) => m.v.uproar)) return fail("But the uproar kept it awake!");
      if (status === "frz" && this.weather === "sun") return fail("But it failed!");
      mon.status = status; mon.statusTurns = status === "slp" ? 1 + this.rand(3) : 0;
      this.push({ e: "status", target: this.idx(mon), status }); this.say(`${mon.name} ${STATUS_TEXT[status]}`);
      if (status === "slp") delete mon.v.bide;
      return true;
    }
    cure(mon) {
      if (!mon.status) return false;
      const was = mon.status; mon.status = null; mon.statusTurns = 0; delete mon.v.nightmare;
      this.push({ e: "status", target: this.idx(mon), status: null });
      this.say(`${mon.name} ${{ par: "was cured of paralysis", slp: "woke up", frz: "thawed out", brn: "was healed of its burn", psn: "was cured of its poisoning", tox: "was cured of its poisoning" }[was]}!`);
      return true;
    }
    drop(mon, name) { if (mon.v[name]) { delete mon.v[name]; this.push({ e: "volatile", target: this.idx(mon), name, on: false }); } }
    free(mon) { for (const name of ["leechseed", "partiallytrapped"]) this.drop(mon, name); for (const k of ["spikes", "toxicspikes", "stealthrock", "stickyweb"]) delete mon.side[k]; }
    breakScreens(mon) { for (const k of ["reflect", "lightscreen", "auroraveil"]) if (mon.side[k]) { delete mon.side[k]; this.push({ e: "side", who: this.idx(mon), name: k, on: false }); this.say("It shattered the barrier!"); } }
    retype(mon, types, text) { if (!types.length) types = ["normal"]; mon.types = types; this.push({ e: "types", target: this.idx(mon), types }); if (text) this.say(text); }
    unstock(mon) { const s = mon.v.stockpile; if (!s) return; mon.boosts.def -= s.def; mon.boosts.spd -= s.spd; delete mon.v.stockpile; this.say(`${mon.name}'s stockpiled effect wore off!`); }
    drainPp(mon, n) { const slot = mon.moves.find((s) => s.id === mon.lastMove); if (!slot || !slot.pp) return false; slot.pp = Math.max(0, slot.pp - n); this.say(`It reduced the PP of ${mon.name}'s ${this.moves[slot.id].name}!`); return true; }
    learn(c) { const m = this.moves[c.t.lastMove], slot = c.u.moves.find((s) => s.id === c.m.id); if (!m || !slot || m.flags.includes("failmimic") || c.u.moves.some((s) => s.id === m.id)) return false; slot.id = m.id; slot.pp = slot.max = Math.min(5, m.pp); this.say(`${c.u.name} learned ${m.name}!`); return true; }
    foresee(c) { const i = this.idx(c.t); if (this.future[i]) return false; this.future[i] = { turns: 3, move: c.m, user: c.u }; this.say(c.m.id === "doomdesire" ? `${c.u.name} chose Doom Desire as its destiny!` : `${c.u.name} foresaw an attack!`); return true; }
    setWeather(weather) {
      if (this.weather === weather) return false;
      this.weather = weather; this.weatherTurns = weather ? 5 : 0; this.push({ e: "weather", weather });
      if (weather) this.say(WEATHER_TEXT[weather]);
      return true;
    }
    setTerrain(terrain) {
      if (this.terrain === terrain) return false;
      this.terrain = terrain; this.terrainTurns = terrain ? 5 : 0; this.push({ e: "terrain", terrain });
      this.say(terrain ? `${terrain[0].toUpperCase()}${terrain.slice(1)} terrain covered the battlefield!` : "The terrain returned to normal!");
      return true;
    }
    finish(winner, reason, who, text) {
      if (this.over) return;
      if (text) this.say(text);
      this.over = true; this.winner = winner; this.reason = reason;
      this.push({ e: "end", winner: winner ? this.idx(winner) : null, reason, who: who ? this.idx(who) : null });
    }
    checkFaint() {
      for (const mon of this.mons) {
        if (mon.hp > 0 || mon.fainted) continue;
        mon.fainted = true; mon.hp = 0;
        this.say(`${mon.name} fainted!`); this.push({ e: "faint", target: this.idx(mon) });
      }
      if (this.over) return true;
      const [a, b] = this.mons;
      if (a.fainted || b.fainted) this.finish(a.fainted && b.fainted ? null : a.fainted ? b : a, "faint");
      return this.over;
    }

    /* ---- choosing ---- */
    usable(mon) {
      const foe = this.foe(mon);
      return mon.moves.filter((slot) => {
        const m = this.moves[slot.id];
        if (slot.pp <= 0 || (mon.v.disable && mon.v.disable.id === slot.id)) return false;
        if (mon.v.taunt && m.category === "status") return false;
        if (mon.v.torment && mon.lastMove === slot.id) return false;
        if (mon.v.healblock && m.flags.includes("heal")) return false;
        if (mon.v.imprisoned && foe.moves.some((s) => s.id === slot.id)) return false;
        return true;
      });
    }
    /* A simple opponent: prefers attacks that work, avoids status moves that obviously cannot. */
    choose(mon) {
      const foe = this.foe(mon), options = this.usable(mon);
      if (mon.v.encore) { const slot = options.find((s) => s.id === mon.v.encore.id); if (slot) return this.moves[slot.id]; }
      if (!options.length) return this.moves.struggle;
      const weights = options.map((slot) => {
        const m = this.moves[slot.id];
        if (mon.status === "slp") return m.sleepUsage ? 20 : 1;
        if (m.sleepUsage || (BEFORE[m.id] && BEFORE[m.id]({ f: this, u: mon, t: foe, m }) !== null && !["suckerpunch", "thunderclap", "focuspunch"].includes(m.id))) return 0.1;
        if (m.category !== "status") { const eff = this.effectiveness(this.typeOf(mon, foe, m), foe, m); return eff === 0 ? 0.1 : 2 + eff; }
        if (m.status && (foe.status || (STATUS_IMMUNE[m.status] || []).some((t) => foe.types.includes(t)))) return 0.1;
        if (m.weather && this.weather === WEATHER[m.weather.toLowerCase()]) return 0.1;
        if (m.heal && SELF_TARGETS.includes(m.target)) return mon.hp < mon.maxHp * 0.6 ? 3 : 0.1;
        if (m.id === "rest") return mon.hp < mon.maxHp * 0.4 ? 3 : 0.1;
        if (m.boosts && SELF_TARGETS.includes(m.target) && Object.entries(m.boosts).every(([s, n]) => n > 0 && mon.boosts[s] >= 6)) return 0.1;
        if (m.stallingMove) return mon.stall ? 0.2 : 1;
        return 1.5;
      });
      let roll = this.rng() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < options.length; i++) { roll -= weights[i]; if (roll <= 0) return this.moves[options[i].id]; }
      return this.moves[options[options.length - 1].id];
    }

    /* ---- one full turn ---- */
    round() {
      this.events = [];
      if (this.over) return this.events;
      this.turn++;
      const plans = this.mons.map((mon) => {
        mon.moved = false; mon.hurt = null; mon.turns++;
        let move, forced = true;
        if (mon.v.mustrecharge) move = null;
        else if (mon.v.twoturn) move = this.moves[mon.v.twoturn.id];
        else if (mon.v.lockedmove) move = this.moves[mon.v.lockedmove.id];
        else if (mon.v.uproar) move = this.moves.uproar;
        else if (mon.v.bide) move = this.moves.bide;
        else { move = this.choose(mon); forced = false; }
        mon.choice = move;
        let priority = move ? move.priority : 0;
        if (move && move.id === "grassyglide" && this.terrain === "grassy" && this.grounded(mon)) priority++;
        return { mon, move, forced, priority, speed: this.speed(mon), tie: this.rng() };
      });
      plans.sort((p, q) => q.priority - p.priority || (this.field.trickroom ? p.speed - q.speed : q.speed - p.speed) || p.tie - q.tie);
      for (const plan of plans) {
        if (this.over) break;
        if (plan.mon.hp > 0) this.act(plan.mon, this.foe(plan.mon), plan.move, plan.forced);
        plan.mon.moved = true;
        this.checkFaint();
      }
      if (!this.over) { this.residual(); this.checkFaint(); }
      if (!this.over && this.turn >= this.maxTurns) this.finish(null, "draw", null, "Both Pokémon are too tired to continue!");
      return this.events;
    }
    /* Everything that can stop a Pokémon before its move. */
    act(user, foe, move, forced) {
      this.push({ e: "act", who: this.idx(user) }); // One side's turn begins.
      delete user.v.destinybond; delete user.v.grudge;
      const stop = (text) => { this.say(text); delete user.v.twoturn; delete user.v.lockedmove; delete user.v.bide; delete user.v.uproar; user.chain = 0; if (user.v.hidden) { delete user.v.hidden; this.push({ e: "reveal", who: this.idx(user) }); } };
      if (user.v.mustrecharge) { delete user.v.mustrecharge; return this.say(`${user.name} must recharge!`); }
      if (user.status === "slp") {
        if (user.statusTurns <= 0) this.cure(user);
        else { user.statusTurns--; if (!move.sleepUsage) return stop(`${user.name} is fast asleep.`); this.say(`${user.name} is fast asleep.`); }
      }
      if (user.status === "frz") {
        if (move.flags.includes("defrost") || this.chance(20)) this.cure(user);
        else return stop(`${user.name} is frozen solid!`);
      }
      if (user.v.flinch) return stop(`${user.name} flinched and couldn't move!`);
      if (user.v.confusion) {
        if (--user.v.confusion.turns <= 0) { this.drop(user, "confusion"); this.say(`${user.name} snapped out of its confusion!`); }
        else {
          this.say(`${user.name} is confused!`);
          if (this.chance(33)) {
            stop("It hurt itself in its confusion!");
            const dmg = Math.floor(Math.floor(Math.floor(2 * user.level / 5 + 2) * 40 * this.stat(user, "atk") / this.stat(user, "def")) / 50) + 2;
            return void this.lose(user, dmg, "confusion");
          }
        }
      }
      if (user.status === "par" && this.chance(25)) return stop(`${user.name} is paralyzed! It can't move!`);
      if (user.v.attract && this.chance(50)) return stop(`${user.name} is immobilized by love!`);
      if (user.v.taunt && move.category === "status") return stop(`${user.name} can't use ${move.name} after the taunt!`);
      if (user.v.bide) {
        if (--user.v.bide.turns > 0) return this.say(`${user.name} is storing energy!`);
        const stored = user.v.bide.dmg; delete user.v.bide;
        this.say(`${user.name} unleashed its energy!`);
        if (!stored) return this.say("But it failed!");
        this.push({ e: "use", who: this.idx(user), target: this.idx(foe), move: "bide" });
        return void this.strike(user, foe, move, stored * 2, 1, false, 0);
      }
      this.useMove(user, foe, move, forced);
    }
    /* Use a move another move called for (Metronome, Sleep Talk, …). */
    call(user, foe, move) { this.useMove(user, foe, move, true, true); }
    useMove(user, foe, move, forced = false, called = false) {
      const ui = this.idx(user), ti = this.idx(foe), c = { f: this, u: user, t: foe, m: move, hit: 0 };
      const slot = user.moves.find((s) => s.id === move.id);
      const resuming = Boolean(user.v.twoturn);
      if (slot && !forced && !called) {
        if (slot.pp <= 0) return this.say(`${user.name} has no PP left for ${move.name}!`); // Drained since it was chosen.
        slot.pp--; slot.used = true;
      }
      if (!move.stallingMove) user.stall = 0;
      if (move.id !== "furycutter") user.chain = 0;
      user.lastMove = move.id; this.lastMove = move.id;
      this.say(`${user.name} used ${move.name}!`);
      const fail = (text) => { this.say(text || "But it failed!"); user.failed = true; if (user.v.lockedmove) delete user.v.lockedmove; };
      user.failed = false;
      if (BEFORE[move.id] && !resuming) { const text = BEFORE[move.id](c); if (text !== null) return fail(text); }
      if (move.flags.includes("charge") && !resuming) {
        const instant = (["solarbeam", "solarblade"].includes(move.id) && this.weather === "sun") || (move.id === "electroshot" && this.weather === "rain");
        this.push({ e: "charge", who: ui, move: move.id, hide: instant ? null : HIDE[move.id] || null });
        this.say(`${user.name} ${HIDE[move.id] === "up" ? "flew up high" : HIDE[move.id] === "down" ? (move.id === "dig" ? "burrowed its way under the ground" : "hid underwater") : HIDE[move.id] ? "vanished instantly" : "is gathering power"}!`);
        if (move.id === "skullbash") this.boost(user, { def: 1 });
        if (move.id === "meteorbeam" || move.id === "electroshot") this.boost(user, { spa: 1 });
        if (!instant) { user.v.twoturn = { id: move.id }; if (HIDE[move.id]) user.v.hidden = HIDE[move.id]; return; }
      }
      if (resuming) { delete user.v.twoturn; if (user.v.hidden) { delete user.v.hidden; this.push({ e: "reveal", who: ui }); } }
      this.push({ e: "use", who: ui, target: ti, move: move.id });
      if (move.id === "bide") { user.v.bide = { turns: 2, dmg: 0 }; return this.say(`${user.name} is storing energy!`); }
      if (move.category === "status") this.statusMove(c, fail);
      else this.damagingMove(c, fail);
      if (this.over) return;
      // Commitments the move leaves its user with.
      const self = move.self || {};
      if (self.volatileStatus === "mustrecharge" && !user.failed) user.v.mustrecharge = {};
      if (self.volatileStatus === "lockedmove" && !user.failed) {
        const lock = user.v.lockedmove || (user.v.lockedmove = { id: move.id, turns: 2 + this.rand(2) });
        if (--lock.turns <= 0) { delete user.v.lockedmove; if (user.hp > 0 && !user.v.confusion) { this.say(`${user.name} became confused due to fatigue!`); this.affect(user, "confusion", user, move, true); } }
      }
      if (self.volatileStatus === "uproar" && !user.failed) { const u = user.v.uproar || (user.v.uproar = { turns: 3 }); if (--u.turns <= 0) { delete user.v.uproar; this.say(`${user.name} calmed down.`); } }
      if (self.volatileStatus === "rage") user.v.rage = {};
      if (self.volatileStatus === "glaiverush") user.v.glaiverush = { turns: 2 };
      if (self.volatileStatus === "roost") user.v.roost = {};
    }

    /* ---- damaging moves ---- */
    crit(user, foe, move) {
      if (move.willCrit || user.v.laserfocus) return true;
      const stage = Math.min(4, (move.critRatio || 1) + (user.v.focusenergy ? 2 : 0) + (user.v.dragoncheer ? 1 : 0));
      return this.rng() < [0, 1 / 24, 1 / 8, 1 / 2, 1][stage];
    }
    /* Standard damage formula. Returns { dmg, crit, eff }. */
    calc(user, foe, move, hit = 0, type = this.typeOf(user, foe, move)) {
      const c = { f: this, u: user, t: foe, m: move, hit };
      const power = POWER[move.id] ? POWER[move.id](c) : move.basePower;
      const eff = this.effectiveness(type, foe, move);
      if (!power) return { dmg: 0, crit: false, eff };
      const physical = move.category === "physical", crit = this.crit(user, foe, move);
      const attacker = move.overrideOffensivePokemon === "target" ? foe : user;
      const aStat = move.overrideOffensiveStat || (physical ? "atk" : "spa"), dStat = move.overrideDefensiveStat || (physical ? "def" : "spd");
      let A = this.stat(attacker, aStat, crit ? Math.max(0, attacker.boosts[aStat]) : attacker.boosts[aStat]);
      let D = this.stat(foe, dStat, move.ignoreDefensive ? 0 : crit ? Math.min(0, foe.boosts[dStat]) : foe.boosts[dStat]);
      if (this.weather === "sand" && foe.types.includes("rock") && dStat === "spd") D = Math.floor(D * 1.5);
      if (this.weather === "snow" && foe.types.includes("ice") && dStat === "def") D = Math.floor(D * 1.5);
      let dmg = Math.floor(Math.floor(Math.floor(2 * user.level / 5 + 2) * power * A / D) / 50) + 2;
      const mods = [];
      if (this.weather === "rain") mods.push(type === "water" ? 1.5 : type === "fire" ? 0.5 : 1);
      if (this.weather === "sun") mods.push(type === "fire" ? 1.5 : type === "water" ? 0.5 : 1);
      if (crit) mods.push(1.5);
      mods.push((85 + this.rand(16)) / 100);
      if (user.types.includes(type)) mods.push(1.5);
      mods.push(eff);
      if (physical && user.status === "brn" && move.id !== "facade") mods.push(0.5);
      const side = foe.side;
      if (!crit && !["brickbreak", "psychicfangs", "ragingbull"].includes(move.id) && (side.auroraveil || (physical ? side.reflect : side.lightscreen))) mods.push(0.5);
      if (this.grounded(user) && ((this.terrain === "electric" && type === "electric") || (this.terrain === "grassy" && type === "grass") || (this.terrain === "psychic" && type === "psychic"))) mods.push(1.3);
      if (this.terrain === "misty" && type === "dragon" && this.grounded(foe)) mods.push(0.5);
      if (this.terrain === "grassy" && ["earthquake", "bulldoze", "magnitude"].includes(move.id) && this.grounded(foe)) mods.push(0.5);
      if (user.v.charge && type === "electric") mods.push(2);
      if ((this.field.mudsport && type === "electric") || (this.field.watersport && type === "fire")) mods.push(1 / 3);
      if (foe.v.minimize && move.flags.includes("minimize")) mods.push(2);
      if (foe.v.glaiverush) mods.push(2);
      const hidden = foe.v.twoturn && foe.v.hidden && REACH[foe.v.hidden === "up" ? "up" : foe.v.twoturn.id];
      if (hidden && hidden[move.id] === 2) mods.push(2);
      for (const m of mods) dmg = Math.floor(dmg * m);
      return { dmg: eff ? Math.max(1, dmg) : 0, crit, eff };
    }
    accuracy(user, foe, move) {
      if (user.v.lockon) return true;
      if (foe.v.minimize && move.flags.includes("minimize")) return true;
      if (foe.v.telekinesis && !move.ohko) return true;
      let acc = move.accuracy;
      if (move.ohko) { if (foe.level > user.level) return false; return this.chance(30 + user.level - foe.level); }
      if (["thunder", "hurricane", "bleakwindstorm", "wildboltstorm", "sandsearstorm"].includes(move.id)) acc = this.weather === "rain" ? true : this.weather === "sun" ? 50 : acc;
      if (move.id === "blizzard" && this.weather === "snow") acc = true;
      if (acc === true) return true;
      const stage = Math.max(-6, Math.min(6, user.boosts.accuracy - (move.ignoreEvasion || foe.v.foresight || foe.v.miracleeye ? Math.min(0, foe.boosts.evasion) : foe.boosts.evasion)));
      acc *= stage >= 0 ? (3 + stage) / 3 : 3 / (3 - stage);
      if (this.field.gravity) acc *= 5 / 3;
      return this.chance(acc);
    }
    /* Can `move` reach `foe` right now? Emits the reason when it cannot. */
    blocked(c, fail) {
      const { u: user, t: foe, m: move } = c;
      const crash = () => { if (move.hasCrashDamage && user.hp > 0) { this.say(`${user.name} kept going and crashed!`); this.lose(user, user.maxHp / 2, "recoil"); } };
      if (foe.hp <= 0) { fail("But there was no target…"); return true; }
      if (foe.v.protect && move.flags.includes("protect") && !move.breaksProtect) {
        this.push({ e: "block", target: this.idx(foe) }); this.say(`${foe.name} protected itself!`); user.failed = true;
        if (move.flags.includes("contact")) {
          const kind = foe.v.protect.kind;
          if (kind === "spikyshield") this.lose(user, user.maxHp / 8, "recoil");
          if (kind === "banefulbunker") this.inflict(user, "psn", foe, true);
          if (kind === "burningbulwark") this.inflict(user, "brn", foe, true);
          if (kind === "kingsshield") this.boost(user, { atk: -1 }, foe);
          if (kind === "obstruct") this.boost(user, { def: -2 }, foe);
          if (kind === "silktrap") this.boost(user, { spe: -1 }, foe);
        }
        crash(); return true;
      }
      if (move.breaksProtect && foe.v.protect) { this.drop(foe, "protect"); this.say(`It broke through ${foe.name}'s protection!`); }
      if (foe.v.hidden && !user.v.lockon) {
        const reach = REACH[foe.v.hidden === "up" ? "up" : foe.v.twoturn ? foe.v.twoturn.id : ""] || {};
        if (!reach[move.id]) { this.push({ e: "miss", who: this.idx(user), target: this.idx(foe), move: move.id }); this.say(`${foe.name} avoided the attack!`); user.failed = true; crash(); return true; }
      }
      if (move.priority > 0 && this.terrain === "psychic" && this.grounded(foe) && move.category !== "status") { fail(`${foe.name} is protected by the Psychic Terrain!`); return true; }
      if (move.flags.includes("powder") && foe.types.includes("grass")) { fail(`It doesn't affect ${foe.name}…`); return true; }
      if (move.category !== "status" || move.ignoreImmunity === false) {
        if (this.effectiveness(this.typeOf(user, foe, move), foe, move) === 0 && !move.ignoreImmunity) { fail(`It doesn't affect ${foe.name}…`); crash(); return true; }
      }
      if (!this.accuracy(user, foe, move)) {
        this.push({ e: "miss", who: this.idx(user), target: this.idx(foe), move: move.id }); this.say(`${user.name}'s attack missed!`); user.failed = true; crash(); return true;
      }
      return false;
    }
    /* Apply one hit's damage to the target (or its substitute). Returns the HP actually removed. */
    strike(user, foe, move, dmg, eff, crit, n) {
      const ui = this.idx(user), ti = this.idx(foe);
      if (foe.v.substitute && !move.flags.includes("bypasssub")) {
        foe.v.substitute.hp -= dmg;
        this.push({ e: "hit", who: ui, target: ti, move: move.id, dmg: 0, hp: foe.hp, eff, crit, sub: true, n });
        if (foe.v.substitute.hp <= 0) { this.drop(foe, "substitute"); this.say(`${foe.name}'s substitute faded!`); }
        else this.say(`The substitute took damage for ${foe.name}!`);
        return 0;
      }
      dmg = Math.min(dmg, foe.hp);
      if (dmg >= foe.hp && (foe.v.endure || ["falseswipe", "holdback"].includes(move.id))) { dmg = foe.hp - 1; if (foe.v.endure) this.say(`${foe.name} endured the hit!`); }
      foe.hp -= dmg; foe.timesHit++;
      foe.hurt = { dmg, category: move.category };
      if (foe.v.bide) foe.v.bide.dmg += dmg;
      this.push({ e: "hit", who: ui, target: ti, move: move.id, dmg, hp: foe.hp, eff, crit, sub: false, n });
      if (crit) this.say("A critical hit!");
      if (foe.v.rage && foe.hp > 0) this.boost(foe, { atk: 1 });
      return dmg;
    }
    damagingMove(c, fail) {
      const { u: user, t: foe, m: move } = c;
      if (move.selfdestruct === "always") this.lose(user, user.hp, "cost");
      if (move.mindBlownRecoil) this.lose(user, Math.ceil(user.maxHp / 2), "cost");
      if (this.blocked(c, fail)) return;
      const type = this.typeOf(user, foe, move);
      if (type === "fire" && foe.status === "frz") this.cure(foe);
      let hits = 1;
      if (Array.isArray(move.multihit)) { const r = this.rand(20); hits = move.multihit[1] === 5 ? (r < 7 ? 2 : r < 14 ? 3 : r < 17 ? 4 : 5) : move.multihit[0] + this.rand(move.multihit[1] - move.multihit[0] + 1); }
      else if (move.multihit) hits = move.multihit;
      let total = 0, landed = 0, eff = 1, immune = false;
      for (let n = 0; n < hits && foe.hp > 0; n++) {
        if (n > 0 && move.multiaccuracy && !this.accuracy(user, foe, move)) break;
        c.hit = n;
        let dmg, crit = false;
        if (move.ohko) { dmg = foe.hp; eff = 1; this.say("It's a one-hit KO!"); }
        else if (move.damage === "level") dmg = user.level;
        else if (typeof move.damage === "number") dmg = move.damage;
        else if (DAMAGE[move.id]) { dmg = DAMAGE[move.id](c); if (dmg === null) return fail(); }
        else {
          if (move.id === "present") { user.gift = undefined; if (POWER.present(c) === 0) { if (!this.heal(foe, foe.maxHp / 4)) this.say("But it had no effect!"); return; } }
          ({ dmg, crit, eff } = this.calc(user, foe, move, n, type));
          if (!dmg) { immune = true; break; }
        }
        total += this.strike(user, foe, move, dmg, eff, crit, n); landed++;
      }
      if (immune || !landed) return fail(`It doesn't affect ${foe.name}…`);
      if (eff > 1 && !move.ohko) this.say("It's super effective!"); else if (eff < 1) this.say("It's not very effective…");
      if (hits > 1) this.say(`Hit ${landed} time${landed > 1 ? "s" : ""}!`);
      // What the user gets back, or pays.
      if (move.drain && total) { this.heal(user, Math.max(1, total * move.drain[0] / move.drain[1]), "drain"); this.say(`${foe.name} had its energy drained!`); }
      if (move.recoil && total && user.hp > 0) { this.lose(user, Math.max(1, Math.round(total * move.recoil[0] / move.recoil[1])), "recoil"); this.say(`${user.name} was damaged by the recoil!`); }
      if (move.struggleRecoil && user.hp > 0) { this.lose(user, Math.max(1, Math.round(user.maxHp / 4)), "recoil"); this.say(`${user.name} was damaged by the recoil!`); }
      if (move.selfdestruct === "ifHit") this.lose(user, user.hp, "cost");
      if (foe.hp <= 0 && foe.v.destinybond && user.hp > 0) { this.say(`${foe.name} took its attacker down with it!`); this.lose(user, user.hp, "cost"); }
      if (foe.hp <= 0 && foe.v.grudge) { const slot = user.moves.find((s) => s.id === move.id); if (slot) { slot.pp = 0; this.say(`${user.name}'s ${move.name} lost all its PP due to the grudge!`); } }
      const sub = foe.v.substitute && !move.flags.includes("bypasssub");
      if (foe.hp > 0 && !sub) {
        for (const s of move.secondaries || []) {
          if (s.chance && !this.chance(s.chance)) continue;
          if (s.status) this.inflict(foe, s.status, user, true);
          if (s.volatileStatus) this.affect(foe, s.volatileStatus, user, move, true);
          if (s.boosts) this.boost(foe, s.boosts, user);
          if (s.self && s.self.boosts && user.hp > 0) this.boost(user, s.self.boosts);
        }
        if (move.volatileStatus && !SELF_TARGETS.includes(move.target)) this.affect(foe, move.volatileStatus, user, move, true);
        if (move.thawsTarget && foe.status === "frz") this.cure(foe);
      } else for (const s of move.secondaries || []) if (s.self && s.self.boosts && user.hp > 0 && (!s.chance || this.chance(s.chance))) this.boost(user, s.self.boosts);
      if (move.self && move.self.boosts && user.hp > 0) this.boost(user, move.self.boosts);
      if (move.sideCondition && !foe.side[move.sideCondition]) foe.side[move.sideCondition] = { turns: 99 };
      if (AFTER[move.id]) AFTER[move.id](c);
      if (move.forceSwitch && foe.hp > 0 && user.hp > 0 && !foe.v.ingrain) this.finish(null, "flee", foe, `${foe.name} was sent flying!`);
      if (move.selfSwitch && foe.hp > 0 && user.hp > 0 && move.id !== "teleport") this.say(`${user.name} has nobody to switch with!`);
    }

    /* ---- status moves ---- */
    /* Start a volatile condition on `mon`; false if it does not take. */
    affect(mon, name, by, move, quiet = false) {
      const say = (text) => { if (text) this.say(`${mon.name} ${text}`); }, fail = () => false;
      const v = mon.v, on = (data = {}) => { v[name] = data; this.push({ e: "volatile", target: this.idx(mon), name, on: true }); if (!quiet || VOLATILE_TEXT[name]) say(VOLATILE_TEXT[name]); return true; };
      if (mon.hp <= 0) return false;
      if (PROTECTS.includes(name)) {
        const foe = this.foe(mon);
        if (foe.moved || !this.chance(100 / 3 ** mon.stall)) { mon.stall = 0; return false; }
        mon.stall++; v.protect = { kind: name }; this.push({ e: "volatile", target: this.idx(mon), name: "protect", on: true }); say("protected itself!"); return true;
      }
      switch (name) {
        case "flinch": if (mon.moved) return false; v.flinch = {}; return true;
        case "confusion": if (v.confusion || (mon.side.safeguard && by !== mon) || (this.terrain === "misty" && this.grounded(mon))) return fail(); return on({ turns: 2 + this.rand(4) });
        case "attract": case "torment": case "foresight": case "miracleeye": case "tarshot": case "saltcure": case "imprison": case "focusenergy": case "ingrain":
        case "aquaring": case "smackdown": case "minimize": case "defensecurl": case "charge": case "laserfocus": case "noretreat": case "octolock": case "powder": case "electrify":
          if (v[name]) return fail();
          if (name === "noretreat" || name === "octolock") v.trapped = {};
          if (name === "smackdown") { delete v.magnetrise; delete v.telekinesis; }
          if (name === "imprison") this.foe(mon).v.imprisoned = {};
          return on();
        case "leechseed": if (v.leechseed || mon.types.includes("grass")) { if (!quiet) this.say(`It doesn't affect ${mon.name}…`); return true; } return on();
        case "partiallytrapped": if (v.partiallytrapped) return fail(); v.partiallytrapped = { turns: 4 + this.rand(2), move: move.name }; this.push({ e: "volatile", target: this.idx(mon), name, on: true }); this.say(`${mon.name} was trapped by ${move.name}!`); return true;
        case "nightmare": if (v.nightmare || mon.status !== "slp") return fail(); return on();
        case "taunt": if (v.taunt) return fail(); return on({ turns: 3 });
        case "healblock": if (v.healblock) return fail(); return on({ turns: 5 });
        case "embargo": return fail();
        case "magnetrise": if (v.magnetrise || v.ingrain || v.smackdown) return fail(); return on({ turns: 5 });
        case "telekinesis": if (v.telekinesis || v.ingrain || v.smackdown) return fail(); return on({ turns: 3 });
        case "syrupbomb": if (v.syrupbomb) return fail(); return on({ turns: 3 });
        case "encore": { const last = this.moves[mon.lastMove]; if (v.encore || !last || last.flags.includes("failencore") || !mon.moves.some((s) => s.id === last.id && s.pp > 0)) return fail(); v.encore = { id: last.id, turns: 3 }; this.push({ e: "volatile", target: this.idx(mon), name, on: true }); say("received an encore!"); return true; }
        case "disable": { const last = this.moves[mon.lastMove]; if (v.disable || !last || !mon.moves.some((s) => s.id === last.id)) return fail(); v.disable = { id: last.id, turns: 4 }; this.push({ e: "volatile", target: this.idx(mon), name, on: true }); this.say(`${mon.name}'s ${last.name} was disabled!`); return true; }
        case "yawn": if (v.yawn || mon.status || (mon.side.safeguard && by !== mon)) return fail(); return on({ turns: 2 });
        case "endure": { const foe = this.foe(mon); if (foe.moved || !this.chance(100 / 3 ** mon.stall)) { mon.stall = 0; return false; } mon.stall++; return on(); }
        case "substitute": { const cost = Math.floor(mon.maxHp / 4); if (v.substitute || mon.hp <= cost || cost < 1) return fail(); this.lose(mon, cost, "cost"); v.substitute = { hp: cost }; this.push({ e: "volatile", target: this.idx(mon), name, on: true }); say("put in a substitute!"); return true; }
        case "curse": case "destinybond": return on();
        case "stockpile": return STATUS.stockpile({ f: this, u: mon }) !== false;
        case "powertrick": return STATUS.powertrick({ f: this, u: mon }) !== false;
        case "rage": case "glaiverush": case "roost": case "mustrecharge": case "lockedmove": case "uproar": return true; // Handled with the move itself.
        case "sparklingaria": return true;
        default: return fail(); // Conditions that need a partner, an item or an ability.
      }
    }
    statusMove(c, fail) {
      const { u: user, t: foe, m: move } = c;
      const onSelf = SELF_TARGETS.includes(move.target), fieldwide = ["all", "foeSide"].includes(move.target) || move.weather || move.terrain || move.pseudoWeather;
      const target = onSelf ? user : foe;
      if (!onSelf && !fieldwide) {
        if (this.blocked(c, fail)) return;
        if (foe.v.substitute && !move.flags.includes("bypasssub") && !["curse", "transform", "painsplit"].includes(move.id) && move.id !== "haze") return fail();
      }
      if (STATUS[move.id]) { if (STATUS[move.id](c) === false) fail(); return; }
      let did = false;
      if (move.forceSwitch) {
        if (foe.v.ingrain || foe.level > user.level || foe.hp <= 0) return fail();
        return this.finish(null, "flee", foe, `${foe.name} was blown away!`);
      }
      if (move.boosts) did = this.boost(target, move.boosts, user) || did;
      if (move.status) did = this.inflict(target, move.status, user) || did;
      if (move.volatileStatus) { const ok = this.affect(target, move.volatileStatus, user, move); did = ok || did; }
      if (move.heal) { const ok = this.heal(target, target.maxHp * move.heal[0] / move.heal[1]); if (ok) this.say(`${target.name} regained health!`); did = ok > 0 || did; }
      if (move.weather) did = this.setWeather(WEATHER[move.weather.toLowerCase()]) || did;
      if (move.terrain) did = this.setTerrain(TERRAIN[move.terrain]) || did;
      if (move.pseudoWeather) {
        const name = move.pseudoWeather;
        if (this.field[name] && name === "trickroom") { delete this.field[name]; this.push({ e: "field", name, on: false }); this.say("The twisted dimensions returned to normal!"); did = true; }
        else if (!this.field[name]) { this.field[name] = { turns: name === "fairylock" ? 2 : 5 }; this.push({ e: "field", name, on: true }); this.say({ trickroom: `${user.name} twisted the dimensions!`, gravity: "Gravity intensified!", wonderroom: "It created a bizarre area in which Defense and Sp. Def stats are swapped!", mudsport: "Electricity's power was weakened!", watersport: "Fire's power was weakened!", iondeluge: "A deluge of ions showers the battlefield!", fairylock: "No one will be able to run away during the next turn!" }[name] || "The battlefield changed!"); did = true; }
      }
      if (move.sideCondition) {
        const side = ["foeSide", "normal"].includes(move.target) ? foe : user, name = move.sideCondition;
        if (!side.side[name] && !(name === "auroraveil" && this.weather !== "snow")) {
          side.side[name] = { turns: name === "tailwind" ? 4 : 5 }; this.push({ e: "side", who: this.idx(side), name, on: true }); did = true;
          this.say({ reflect: "Reflect made the team stronger against physical moves!", lightscreen: "Light Screen made the team stronger against special moves!", auroraveil: "Aurora Veil made the team stronger against physical and special moves!",
            safeguard: `${side.name} cloaked itself in a mystical veil!`, mist: `${side.name} became shrouded in mist!`, tailwind: "The Tailwind blew from behind!", luckychant: "Lucky Chant shielded the team from critical hits!",
            spikes: "Spikes were scattered on the ground!", toxicspikes: "Poison spikes were scattered on the ground!", stealthrock: "Pointed stones float in the air!", stickyweb: "A sticky web has been laid out!" }[name] || "The battlefield changed!");
        }
      }
      if (move.self && move.self.boosts) did = this.boost(user, move.self.boosts) || did;
      if (move.selfdestruct && did) this.lose(user, user.hp, "cost");
      if (!did) fail();
    }

    /* ---- end of turn ---- */
    residual() {
      const tickDown = (bag, name, onEnd) => { if (bag[name] && bag[name].turns !== undefined && --bag[name].turns <= 0) { delete bag[name]; onEnd(); } };
      if (this.weather) {
        if (--this.weatherTurns <= 0) { this.say({ rain: "The rain stopped.", sun: "The harsh sunlight faded.", sand: "The sandstorm subsided.", snow: "The snow stopped." }[this.weather]); this.weather = null; this.push({ e: "weather", weather: null }); }
        else if (this.weather === "sand") for (const mon of this.mons) if (mon.hp > 0 && !mon.v.hidden && !mon.types.some((t) => ["rock", "ground", "steel"].includes(t))) { this.say(`${mon.name} is buffeted by the sandstorm!`); this.lose(mon, mon.maxHp / 16, "weather"); }
      }
      if (this.terrain && --this.terrainTurns <= 0) this.setTerrain(null);
      for (const name of Object.keys(this.field)) tickDown(this.field, name, () => { this.push({ e: "field", name, on: false }); this.say({ trickroom: "The twisted dimensions returned to normal!", gravity: "Gravity returned to normal!" }[name] || "The battlefield returned to normal."); });
      this.mons.forEach((mon, i) => {
        const foe = this.mons[1 - i], v = mon.v;
        if (mon.hp <= 0) return;
        if (this.terrain === "grassy" && this.grounded(mon)) this.heal(mon, mon.maxHp / 16);
        if (mon.wish && --mon.wish.turns <= 0) { const hp = mon.wish.hp; mon.wish = null; if (this.heal(mon, hp)) this.say(`${mon.name}'s wish came true!`); }
        const future = this.future[i];
        if (future && --future.turns <= 0) {
          this.future[i] = null; this.say(`${mon.name} took the ${future.move.name} attack!`);
          const { dmg, eff, crit } = this.calc(future.user, mon, future.move);
          if (dmg) this.strike(future.user, mon, future.move, dmg, eff, crit, 0); else this.say(`It doesn't affect ${mon.name}…`);
        }
        if (v.ingrain) this.heal(mon, mon.maxHp / 16);
        if (v.aquaring) this.heal(mon, mon.maxHp / 16);
        if (v.leechseed && mon.hp > 0 && foe.hp > 0) { const took = this.lose(mon, mon.maxHp / 8, "leech"); this.heal(foe, took, "drain"); this.say(`${mon.name}'s health is sapped by Leech Seed!`); }
        if (mon.hp > 0 && mon.status === "brn") { this.lose(mon, mon.maxHp / 16, "brn"); this.say(`${mon.name} was hurt by its burn!`); }
        if (mon.hp > 0 && mon.status === "psn") { this.lose(mon, mon.maxHp / 8, "psn"); this.say(`${mon.name} was hurt by poison!`); }
        if (mon.hp > 0 && mon.status === "tox") { mon.statusTurns = Math.min(15, mon.statusTurns + 1); this.lose(mon, mon.maxHp * mon.statusTurns / 16, "psn"); this.say(`${mon.name} was hurt by poison!`); }
        if (mon.hp > 0 && v.nightmare) { if (mon.status === "slp") { this.lose(mon, mon.maxHp / 4, "curse"); this.say(`${mon.name} is locked in a nightmare!`); } else delete v.nightmare; }
        if (mon.hp > 0 && v.curse) { this.lose(mon, mon.maxHp / 4, "curse"); this.say(`${mon.name} is afflicted by the curse!`); }
        if (mon.hp > 0 && v.partiallytrapped) {
          if (--v.partiallytrapped.turns <= 0) { const name = v.partiallytrapped.move; this.drop(mon, "partiallytrapped"); this.say(`${mon.name} was freed from ${name}!`); }
          else { this.lose(mon, mon.maxHp / 8, "trap"); this.say(`${mon.name} is hurt by ${v.partiallytrapped.move}!`); }
        }
        if (mon.hp > 0 && v.saltcure) { this.lose(mon, mon.maxHp / (mon.types.some((t) => t === "water" || t === "steel") ? 4 : 8), "trap"); this.say(`${mon.name} is being salt cured!`); }
        if (mon.hp > 0 && v.octolock) this.boost(mon, { def: -1, spd: -1 }, foe);
        if (mon.hp > 0 && v.syrupbomb) this.boost(mon, { spe: -1 }, foe);
        if (mon.hp > 0 && v.yawn && --v.yawn.turns <= 0) { delete v.yawn; this.inflict(mon, "slp", foe, true); }
        if (mon.hp > 0 && v.perish) { v.perish.n--; this.say(`${mon.name}'s perish count fell to ${v.perish.n}.`); if (v.perish.n <= 0) this.lose(mon, mon.hp, "cost"); }
        for (const name of ["taunt", "encore", "disable", "healblock", "magnetrise", "telekinesis", "syrupbomb", "lockon", "glaiverush"]) tickDown(v, name, () => { this.push({ e: "volatile", target: i, name, on: false }); if (["taunt", "encore", "disable"].includes(name)) this.say(`${mon.name}'s ${name} ${name === "disable" ? "is no longer in effect" : "ended"}!`); });
        for (const name of Object.keys(mon.side)) tickDown(mon.side, name, () => { this.push({ e: "side", who: i, name, on: false }); this.say({ reflect: "Reflect wore off!", lightscreen: "Light Screen wore off!", auroraveil: "Aurora Veil wore off!", safeguard: "Safeguard wore off!", mist: "The mist faded!", tailwind: "The Tailwind petered out!" }[name] || `${name} wore off!`); });
        if (v.protect) this.drop(mon, "protect");
        for (const name of ["flinch", "endure", "roost", "powder", "electrify"]) delete v[name];
        if (v.laserfocus && v.laserfocus.used) delete v.laserfocus; else if (v.laserfocus) v.laserfocus.used = true;
        if (v.charge && mon.lastMove !== "charge") delete v.charge;
      });
    }
  }
  /* How fully each move is modelled, for honest reporting. */
  function coverage(move) {
    if (POWER[move.id] || DAMAGE[move.id] || TYPE[move.id] || BEFORE[move.id] || AFTER[move.id] || STATUS[move.id]) return "custom";
    return move.fn ? "data+simplified" : "data";
  }
  return { TYPES, CHART, BOOSTS, HIDE, createMon, pickMoves, Fight, coverage };
});
