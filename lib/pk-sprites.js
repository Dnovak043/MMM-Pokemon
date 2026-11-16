/* MIT license. Derived from MMM-Neko (c) 2026 Brian Wente. */
/* PMD Sprite Collab artwork → a "sprite set" the engine and renderer share:
 *
 *   { format, base, tick, facing, sheets: [{ url, width, height }],
 *     anims: { Name: { sheet, w, h, rows, cols, durations: [seconds], hit?, minTime } },
 *     roles: { idle, walk, sleep, tired?, wake?, fidget: [names], attack: [names], hurt?, faint?, victory? } }
 *
 * `base` is the body size in sheet pixels, `tick` the redraw interval in ms. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PkSprites = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const directions = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];

  /* ---- Placeholder: an invisible 32px body used until a sprite's artwork has loaded. */
  const blankFrames = { idle: 1, groom: 2, sleep: 2 };
  function placeholder() {
    const anim = (count, seconds, extra) => ({ sheet: 0, w: 32, h: 32, cells: Array.from({ length: count }, () => [0, 0]), durations: Array.from({ length: count }, () => seconds), ...extra });
    return {
      format: "placeholder", base: 32, tick: 50, facing: "S", sheets: [{ url: "", width: 32, height: 32 }],
      anims: { idle: anim(blankFrames.idle, 1), groom: anim(blankFrames.groom, 0.25, { minTime: 2 }), sleep: anim(blankFrames.sleep, 1), walk: anim(2, 0.25) },
      roles: { idle: "idle", walk: "walk", sleep: "sleep", fidget: ["groom"], attack: [] }
    };
  }

  /* ---- PMD Sprite Collab: AnimData.xml plus one <Name>-Anim.png per action - */
  // Sheet rows run counter-clockwise from "facing the viewer".
  const pmdRows = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"];
  const TICK = 1 / 60; // AnimData durations count 60 Hz game frames.
  const MAX_ANIMS = 160, MAX_FRAMES = 256;
  /* Read the animation list. Only the handful of fields used here are trusted,
   * and each is range-checked; anything malformed is skipped. `file` is the
   * action whose sheet holds the frames, which differs from `name` for CopyOf. */
  function parseAnimData(xml) {
    if (typeof xml !== "string") return [];
    const raw = new Map();
    const tag = (body, name) => { const m = new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`).exec(body); return m ? m[1] : null; };
    for (const match of xml.matchAll(/<Anim>([\s\S]*?)<\/Anim>/g)) {
      if (raw.size >= MAX_ANIMS) break;
      const body = match[1], name = tag(body, "Name");
      if (!name || !/^[A-Za-z0-9_]{1,40}$/.test(name) || raw.has(name)) continue;
      const copyOf = tag(body, "CopyOf");
      if (copyOf) { raw.set(name, { copyOf }); continue; }
      const w = Number(tag(body, "FrameWidth")), h = Number(tag(body, "FrameHeight"));
      const ticks = [...body.matchAll(/<Duration>\s*(\d+)\s*<\/Duration>/g)].map((m) => Number(m[1]));
      const sized = (n) => Number.isInteger(n) && n >= 1 && n <= 1024;
      if (!sized(w) || !sized(h) || !ticks.length || ticks.length > MAX_FRAMES || ticks.some((t) => t < 1 || t > 6000)) continue;
      // Moves mark the frame on which they connect.
      const hit = Number(tag(body, "HitFrame") ?? NaN);
      raw.set(name, Number.isInteger(hit) && hit >= 0 && hit < ticks.length ? { w, h, ticks, hit } : { w, h, ticks });
    }
    const list = [];
    for (const [name, entry] of raw) {
      const source = entry.copyOf ? raw.get(entry.copyOf) : entry;
      if (!source || source.copyOf) continue; // Dangling or chained copies are not used by the format.
      const item = { name, file: entry.copyOf || name, w: source.w, h: source.h, ticks: source.ticks };
      if (source.hit !== undefined) item.hit = source.hit;
      list.push(item);
    }
    return list;
  }
  /* Build a set from parsed AnimData and the sheets that actually loaded:
   * `images` maps an action's file name to { url, width, height }.
   *
   * Walk, Idle and Sleep exist for every sprite and drive the matching states.
   * Wake and Laying, when present, bracket a nap. Every other action the sprite
   * happens to have becomes a "fidget" that is played, in full, between idling
   * and the next walk, so each Pokémon shows whatever it was drawn with. */
  function pmd(list, images, skip = []) {
    const skipped = new Set(skip.map((name) => String(name).toLowerCase()));
    const sheets = [], sheetOf = new Map(), anims = {}, byFile = new Map();
    for (const entry of Array.isArray(list) ? list : []) {
      const image = images && images[entry.file];
      if (!image) continue;
      // Use every frame the action has; a short sheet (bad export) is trimmed rather than misread.
      const cols = Math.min(entry.ticks.length, Math.floor(image.width / entry.w));
      const rows = Math.floor(image.height / entry.h);
      if (cols < 1 || rows < 1) continue;
      if (!sheetOf.has(entry.file)) { sheetOf.set(entry.file, sheets.length); sheets.push({ url: image.url, width: image.width, height: image.height }); }
      anims[entry.name] = { sheet: sheetOf.get(entry.file), w: entry.w, h: entry.h, rows: rows >= 8 ? 8 : 1, cols,
        durations: entry.ticks.slice(0, cols).map((t) => t * TICK), minTime: 0.6 };
      // Seconds into the action at which a move lands.
      if (entry.hit < cols) anims[entry.name].hit = entry.ticks.slice(0, entry.hit).reduce((sum, t) => sum + t, 0) * TICK;
      if (!byFile.has(entry.file) || entry.name === entry.file) byFile.set(entry.file, entry.name);
    }
    if (!anims.Walk || !anims.Idle) return null;
    const first = (...names) => names.find((name) => anims[name]);
    const roles = { idle: "Idle", walk: "Walk", sleep: first("Sleep", "EventSleep", "Laying", "Idle"), fidget: [] };
    if (anims.Wake) roles.wake = "Wake";
    if (anims.Laying && roles.sleep !== "Laying") { roles.tired = "Laying"; anims.Laying.minTime = 1; }
    const reserved = new Set(["Walk", "Idle", "Sleep", "EventSleep", "Laying", "Wake"]);
    // One entry per distinct sheet, so an action aliased under two names is not picked twice as often.
    for (const name of new Set(byFile.values())) {
      if (!reserved.has(name) && !skipped.has(name.toLowerCase()) && !Object.values(roles).includes(name)) roles.fidget.push(name);
    }
    // Battles: every action drawn with a hit frame is a move this sprite can use.
    const unique = [...new Set(byFile.values())];
    roles.attack = unique.filter((name) => anims[name].hit !== undefined && !reserved.has(name) && !skipped.has(name.toLowerCase()));
    for (const [role, names] of [["hurt", ["Hurt", "Pain", "Cringe"]], ["faint", ["Faint"]], ["victory", ["Pose", "Hop"]]]) {
      const name = first(...names);
      if (name) roles[role] = name;
    }
    const base = Math.min(128, Math.max(16, anims.Walk.w, anims.Walk.h));
    return { format: "pmd", base, tick: 16, facing: "S", sheets, anims, roles };
  }

  /* ---- Playback ---------------------------------------------------------- */
  const total = (anim) => anim.durations.reduce((sum, seconds) => sum + seconds, 0);
  /* Seconds a one-shot action is held: whole passes, so every frame is shown,
   * repeated until very short actions have lasted at least `minTime`. */
  function playTime(anim) {
    const length = total(anim);
    return length * Math.max(1, Math.ceil((anim.minTime || 0) / length - 1e-9));
  }
  /* The rectangle of `name` to draw `time` seconds into the action. */
  function cell(set, name, direction, time) {
    const anim = set.anims[name];
    let t = time % total(anim), index = 0;
    while (index < anim.durations.length - 1 && t >= anim.durations[index]) t -= anim.durations[index++];
    let x, y;
    if (anim.cells) {
      const cells = Array.isArray(anim.cells) ? anim.cells : anim.cells[direction] || Object.values(anim.cells)[0];
      [x, y] = cells[index % cells.length];
    } else {
      x = index * anim.w; y = (anim.rows === 8 ? Math.max(0, pmdRows.indexOf(direction)) : 0) * anim.h;
    }
    return { anim: name, index, sheet: anim.sheet, x, y, w: anim.w, h: anim.h };
  }
  return { directions, placeholder, pmdRows, parseAnimData, pmd, total, playTime, cell };
});
