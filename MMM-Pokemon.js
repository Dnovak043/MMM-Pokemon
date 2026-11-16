/* global Module, PkEngine, PkController */
/* MIT license. Derived from MMM-Neko (c) 2026 Brian Wente. */
Module.register("MMM-Pokemon", {
  requiresVersion: "2.25.0",
  defaults: {
    party: ["pikachu", "charmander", "squirtle", "bulbasaur"], randomParty: 0, randomVariants: false, level: 50,
    mode: "wander", scale: 2, speed: 32, idleMin: 4, idleMax: 10, sleepAfter: 120, sleepDuration: 30,
    startPosition: { x: 0.5, y: 0.7 }, inset: 16, reducedMotion: "auto", avoid: [], avoidMargin: 4, skipActions: [],
    battles: true, battleRange: 24, battleCooldown: 30, faintTime: 8, battleSpeed: 1, moveDelay: 0.5, showText: true, showHp: true, autoDownload: true,
    nameSize: 0, hpBarWidth: 0, hpBarHeight: 0, textSize: 0, textBoxWidth: 0
  },
  getScripts() { return ["pk-sprites", "pk-engine", "pk-mechanics", "pk-battle", "pk-controller"].map((name) => this.file(`lib/${name}.js`)); },
  getStyles() { return [this.file("MMM-Pokemon.css")]; },
  start() {
    if (this.pk) this.pk.destroy();
    // Invalid settings fall back individually. Problems are logged, never drawn.
    this.config = PkEngine.validateConfig(this.config).config;
    this.pk = new PkController(this.config, window, { data: this.file("data"), sprites: this.file("sprites") },
      { requestSprites: (id) => this.sendSocketNotification("POKEMON_FETCH_SPRITES", { id }) });
  },
  socketNotificationReceived(name, payload) {
    if (name === "POKEMON_SPRITES" && this.pk && payload) this.pk.spritesReady(payload.folder, payload.ok);
  },
  getDom() { return this.pk.element; },
  notificationReceived(name, payload) { if (this.pk) this.pk.receive(name, payload); },
  suspend() { if (this.pk) this.pk.suspend(); },
  resume() { if (this.pk) this.pk.resume(); },
  stop() { if (this.pk) this.pk.destroy(); }
});
