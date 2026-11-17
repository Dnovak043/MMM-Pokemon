/* MIT license. Node only: download one sprite from the PMD Sprite Collab
 * repository into sprites/<folder>/. Used by node_helper.js and the CLI. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { parseAnimData } = require("./pk-sprites.js");

const SOURCE = "https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/sprite";
const ID = /^\d{4}(?:\/\d{4}){0,3}$/;
const folderOf = (id) => id.replaceAll("/", "-");

/* `id` is the sprite's path under sprite/ in the repository: "0025", or
 * "0025/0000/0001" for a form/shiny/gender variant. Resolves to
 * { folder, saved, cached }; rejects when the sprite cannot be fetched.
 * Aborting `signal` stops the download; the folder is then left incomplete and
 * the next call starts it again. */
async function fetchSprite(id, root, log = () => {}, signal = undefined) {
  if (!ID.test(id)) throw new Error(`invalid sprite id "${id}"`);
  const target = path.join(root, folderOf(id));
  if (["AnimData.xml", "Walk-Anim.png", "Idle-Anim.png"].every((file) => fs.existsSync(path.join(target, file)))) return { folder: folderOf(id), saved: 0, cached: true };
  const get = async (file) => {
    const response = await fetch(`${SOURCE}/${file}`, signal ? { signal } : undefined);
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const xml = await get(`${id}/AnimData.xml`);
  const files = [...new Set(parseAnimData(xml.toString("utf8")).map((action) => action.file))];
  if (!files.includes("Walk") || !files.includes("Idle")) throw new Error(`${id}: no Walk/Idle actions`);
  fs.mkdirSync(target, { recursive: true });
  let saved = 0;
  for (const file of files) {
    try { fs.writeFileSync(path.join(target, `${file}-Anim.png`), await get(`${id}/${file}-Anim.png`)); saved++; }
    catch (error) { if (signal && signal.aborted) throw error; log(`skipped ${error.message}`); }
  }
  // Credits live with the base form; keep them next to the artwork.
  const parts = id.split("/");
  for (let depth = parts.length; depth >= 1; depth--) {
    try { fs.writeFileSync(path.join(target, "credits.txt"), await get(`${parts.slice(0, depth).join("/")}/credits.txt`)); break; }
    catch (error) { if (signal && signal.aborted) throw error; /* otherwise try the parent form */ }
  }
  fs.writeFileSync(path.join(target, "AnimData.xml"), xml); // Last, so a partial download is retried.
  return { folder: folderOf(id), saved, cached: false };
}
module.exports = { fetchSprite, folderOf, ID };
