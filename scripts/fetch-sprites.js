/* Download Sprite Collab artwork ahead of time (the module also does this by
 * itself when `autoDownload` is on).
 *
 *   node scripts/fetch-sprites.js pikachu 4 "mr. mime" 25/0/1
 *
 * Arguments are Pokémon names, Pokédex numbers, or Sprite Collab paths
 * (dex/form/shiny/gender). The artwork is not part of this module; see each
 * folder's credits.txt and the Sprite Collab terms before sharing it. */
"use strict";
const path = require("node:path");
const { fetchSprite } = require("../lib/collab.js");
const pokedex = require("../data/pokedex.json");

const toId = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, "");
const pad = (n) => String(n).padStart(4, "0");
const args = process.argv.slice(2);
if (!args.length) { console.error('Usage: node scripts/fetch-sprites.js <name | dex | dex/form/shiny> …'); process.exit(1); }
(async () => {
  let failed = 0;
  for (const arg of args) {
    let id;
    if (/^\d{1,4}(?:\/\d{1,4}){0,3}$/.test(arg)) id = arg.split("/").map(pad).join("/");
    else { const species = pokedex.species.find((s) => s.id === toId(arg)); if (species) id = pad(species.num); }
    if (!id) { console.error(`${arg}: unknown Pokémon`); failed++; continue; }
    try {
      const result = await fetchSprite(id, path.join(__dirname, "..", "sprites"), (text) => console.warn(`  ${text}`));
      console.log(`${arg}: ${result.cached ? "already in" : `saved ${result.saved} sheets to`} sprites/${result.folder}/`);
    } catch (error) { console.error(`${arg}: ${error.message}`); failed++; }
  }
  process.exit(failed ? 1 : 0);
})();
