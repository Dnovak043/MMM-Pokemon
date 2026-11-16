/* Rebuild data/moves.json and data/pokedex.json from Pokémon Showdown's data
 * files (https://github.com/smogon/pokemon-showdown, MIT).
 *
 *   npm install --no-save esbuild && node scripts/build-data.js [folder-with-ts-files]
 *
 * Only plain data is kept. Showdown's per-move callback functions are not
 * copied; lib/pk-mechanics.js implements move behavior itself and the names of
 * the dropped callbacks are recorded in `fn` so tests can report coverage. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const esbuild = require("esbuild");

const SOURCE = "https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data";
const local = process.argv[2];
async function load(name) {
  const text = local ? fs.readFileSync(path.join(local, `${name}.ts`), "utf8") : await (await fetch(`${SOURCE}/${name}.ts`)).text();
  const { code } = esbuild.transformSync(text, { loader: "ts", format: "cjs" });
  const sandbox = { module: { exports: {} } }; sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(code, sandbox);
  return Object.values(sandbox.module.exports)[0];
}
const KEEP = ["num", "name", "type", "category", "basePower", "accuracy", "pp", "priority", "target", "critRatio", "multihit", "drain", "recoil",
  "heal", "status", "volatileStatus", "boosts", "weather", "terrain", "sideCondition", "pseudoWeather", "selfdestruct", "ohko", "damage",
  "forceSwitch", "selfSwitch", "willCrit", "ignoreDefensive", "ignoreEvasion", "ignoreImmunity", "overrideOffensiveStat", "overrideDefensiveStat",
  "overrideOffensivePokemon", "breaksProtect", "stallingMove", "sleepUsage", "thawsTarget", "hasCrashDamage", "mindBlownRecoil", "struggleRecoil",
  "selfBoost", "multiaccuracy", "isZ", "isMax", "slotCondition", "smartTarget", "hasSheerForce"];
/* Moves that can only do something with a held item, an ability or a partner
 * Pokémon. None of those exist in this module, so these are left out entirely
 * (as is anything that targets an adjacent ally). */
const NEEDS_ITEM = ["naturalgift", "fling", "recycle", "belch", "stuffcheeks", "teatime", "bestow", "trick", "switcheroo", "poltergeist", "embargo", "magicroom", "corrosivegas"];
const NEEDS_ABILITY = ["skillswap", "roleplay", "entrainment", "gastroacid", "worryseed", "simplebeam", "doodle"];
const NEEDS_PARTNER = ["helpinghand", "followme", "ragepowder", "spotlight", "allyswitch", "afteryou", "quash", "instruct", "aromaticmist", "coaching", "magneticflux", "gearup", "decorate", "dragoncheer", "healingwish", "lunardance", "revivalblessing", "batonpass", "shedtail", "assist", "mefirst", "snatch", "magiccoat", "craftyshield", "quickguard", "wideguard", "matblock"];
const EXCLUDED = new Set([...NEEDS_ITEM, ...NEEDS_ABILITY, ...NEEDS_PARTNER]);
const plain = (value) => JSON.parse(JSON.stringify(value, (key, v) => (typeof v === "function" ? undefined : v)));
function effect(source) {
  if (!source || typeof source !== "object") return undefined;
  const out = {};
  for (const key of ["chance", "status", "volatileStatus", "boosts", "sideCondition", "pseudoWeather"]) if (source[key] !== undefined) out[key] = plain(source[key]);
  if (source.self) out.self = effect(source.self);
  return Object.keys(out).length ? out : undefined;
}
(async () => {
  const [Moves, Pokedex, Learnsets] = [await load("moves"), await load("pokedex"), await load("learnsets")];
  const moves = {};
  for (const [id, source] of Object.entries(Moves)) {
    if (["CAP", "Custom"].includes(source.isNonstandard)) continue; // Fan-made entries.
    if (EXCLUDED.has(id) || source.target === "adjacentAlly") continue;
    const move = { id };
    for (const key of KEEP) if (source[key] !== undefined && typeof source[key] !== "function") move[key] = plain(source[key]);
    move.flags = Object.keys(source.flags || {});
    const secondaries = (source.secondaries || (source.secondary ? [source.secondary] : [])).map(effect).filter(Boolean);
    if (secondaries.length) move.secondaries = secondaries;
    if (source.self) move.self = effect(source.self);
    if (source.isNonstandard) move.nonstandard = source.isNonstandard;
    const fn = [];
    const walk = (object, prefix) => { for (const [key, v] of Object.entries(object)) { if (typeof v === "function") fn.push(prefix + key); else if (v && typeof v === "object" && ["condition", "self", "secondary"].includes(key)) walk(v, `${key}.`); } };
    walk(source, "");
    if (fn.length) move.fn = fn;
    moves[id] = move;
  }
  const toId = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, "");
  const learnset = (id, seen = new Set()) => {
    const out = new Set(Object.keys((Learnsets[id] && Learnsets[id].learnset) || {}));
    const prevo = Pokedex[id] && Pokedex[id].prevo && toId(Pokedex[id].prevo);
    if (prevo && !seen.has(prevo)) { seen.add(prevo); for (const move of learnset(prevo, seen)) out.add(move); } // Moves kept through evolution.
    return out;
  };
  const pokedex = [];
  for (const [id, s] of Object.entries(Pokedex)) {
    if (s.num < 1 || s.forme || s.baseSpecies || ["CAP", "Custom"].includes(s.isNonstandard)) continue; // Base forms of real species.
    const known = [...learnset(id)].filter((move) => moves[move]).sort();
    pokedex.push({ num: s.num, id, name: s.name, types: s.types.map((t) => t.toLowerCase()), stats: Object.values(s.baseStats), kg: s.weightkg, moves: known });
  }
  pokedex.sort((a, b) => a.num - b.num);
  for (const move of Object.values(moves)) { move.type = move.type.toLowerCase(); move.category = move.category.toLowerCase(); }
  const out = path.join(__dirname, "..", "data");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "moves.json"), `${JSON.stringify(moves)}\n`);
  // Learnsets are stored as indexes into the sorted list of move ids to keep the file small.
  const ids = Object.keys(moves).sort(), index = new Map(ids.map((id, i) => [id, i]));
  for (const species of pokedex) species.moves = species.moves.map((id) => index.get(id));
  fs.writeFileSync(path.join(out, "pokedex.json"), `${JSON.stringify({ moves: ids, species: pokedex })}\n`);
  const learnable = new Set(pokedex.flatMap((p) => p.moves));
  // (indexes at this point)
  console.log(`${Object.keys(moves).length} moves (${learnable.size} learnable), ${pokedex.length} species`);
})();
