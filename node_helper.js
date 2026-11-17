/* MIT license. Server side: downloads missing Sprite Collab artwork into
 * sprites/ when the browser asks for it (config `autoDownload`). While the
 * module is suspended the download in progress is aborted and the queue waits;
 * both carry on when the module resumes. */
"use strict";
const path = require("node:path");
const NodeHelper = require("node_helper");
const { fetchSprite, folderOf, ID } = require("./lib/collab.js");

module.exports = NodeHelper.create({
  start() { this.queue = Promise.resolve(); this.paused = false; this.waiting = []; this.aborter = null; },
  pause() {
    this.paused = true;
    if (this.aborter) this.aborter.abort();
  },
  unpause() {
    this.paused = false;
    this.waiting.splice(0).forEach((go) => go());
  },
  /* Resolves at once, or on unpause() while the module is suspended. */
  ready() { return this.paused ? new Promise((resolve) => { this.waiting.push(resolve); }) : Promise.resolve(); },
  /* Download one sprite. A download interrupted by a suspend starts again after the resume. */
  async download(id) {
    for (;;) {
      await this.ready();
      if (this.paused) continue; // Suspended again before the download could start.
      const aborter = this.aborter = new AbortController();
      try {
        const result = await fetchSprite(id, path.join(__dirname, "sprites"), undefined, aborter.signal);
        if (!result.cached) console.log(`MMM-Pokemon: downloaded sprite ${id} (${result.saved} sheets)`);
        return true;
      } catch (error) {
        if (aborter.signal.aborted) continue;
        console.error(`MMM-Pokemon: could not download sprite ${id}: ${error.message}`);
        return false;
      } finally { this.aborter = null; }
    }
  },
  socketNotificationReceived(name, payload) {
    if (name === "POKEMON_SUSPENDED") return this.pause();
    if (name === "POKEMON_RESUMED") return this.unpause();
    if (name !== "POKEMON_FETCH_SPRITES" || !payload || typeof payload.id !== "string" || !ID.test(payload.id)) return;
    const id = payload.id;
    this.unpause(); // Only a module that is showing asks for artwork.
    // One download at a time; a failure only affects that sprite.
    this.queue = this.queue.then(() => this.download(id))
      .then((ok) => this.sendSocketNotification("POKEMON_SPRITES", { folder: folderOf(id), ok }));
  }
});
