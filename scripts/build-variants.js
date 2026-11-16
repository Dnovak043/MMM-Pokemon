/* Rebuild data/variants.json: for every Pokédex number, the Sprite Collab
 * sprite paths (dex/form/shiny/gender) that currently have walking and idle
 * artwork. Read from the repository's tracker.json.
 *
 *   node scripts/build-variants.js [path-to-tracker.json]
 *
 * `randomParty` and `randomVariants` choose from this list, so run this again
 * to pick up sprites added to the repository later. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = "https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/tracker.json";
(async () => {
  const local = process.argv[2];
  const tracker = local ? JSON.parse(fs.readFileSync(local, "utf8")) : await (await fetch(SOURCE)).json();
  const variants = {};
  let total = 0;
  const walk = (node, parts, out) => {
    const files = node.sprite_files || {};
    if ("Walk" in files && "Idle" in files) out.push(parts.join("/"));
    for (const [key, child] of Object.entries(node.subgroups || {})) if (/^\d{4}$/.test(key)) walk(child, [...parts, key], out);
  };
  for (const [dex, node] of Object.entries(tracker)) {
    if (!/^\d{4}$/.test(dex) || Number(dex) < 1) continue;
    const out = [];
    walk(node, [dex], out);
    if (out.length) { variants[Number(dex)] = out; total += out.length; }
  }
  fs.writeFileSync(path.join(__dirname, "..", "data", "variants.json"), `${JSON.stringify(variants)}\n`);
  console.log(`${total} sprite variants for ${Object.keys(variants).length} Pokémon`);
})().catch((error) => { console.error(`Could not build the variant list: ${error.message}`); process.exit(1); });
