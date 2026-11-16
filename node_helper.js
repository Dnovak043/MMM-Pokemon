/* MIT license. Server side: downloads missing Sprite Collab artwork into
 * sprites/ when the browser asks for it (config `autoDownload`). */
"use strict";
const path = require("node:path");
const NodeHelper = require("node_helper");
const { fetchSprite, folderOf, ID } = require("./lib/collab.js");

module.exports = NodeHelper.create({
  start() { this.queue = Promise.resolve(); },
  socketNotificationReceived(name, payload) {
    if (name !== "POKEMON_FETCH_SPRITES" || !payload || typeof payload.id !== "string" || !ID.test(payload.id)) return;
    const id = payload.id;
    // One download at a time; a failure only affects that sprite.
    this.queue = this.queue.then(() => fetchSprite(id, path.join(__dirname, "sprites")).then((result) => {
      if (!result.cached) console.log(`MMM-Pokemon: downloaded sprite ${id} (${result.saved} sheets)`);
      return true;
    }, (error) => { console.error(`MMM-Pokemon: could not download sprite ${id}: ${error.message}`); return false; }))
      .then((ok) => this.sendSocketNotification("POKEMON_SPRITES", { folder: folderOf(id), ok }));
  }
});
