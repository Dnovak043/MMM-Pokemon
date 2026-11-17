# MMM-Pokemon

Pokémon sprites that wander across your MagicMirror², nap, fidget — and, when
two of them happen to cross paths, battle each other in turns with their real
moves.

- **Any of the 1,025 species**, by name or Pokédex number, drawn with the
  community sprites from [PMD Sprite Collab](https://sprites.pmdcollab.org/).
- **Real movesets.** Each Pokémon draws four moves from its actual learnset
  (903 moves are included), or uses the ones you list.
- **Game-style battles.** Level-based stats, type effectiveness, STAB, critical
  hits, accuracy, priority and Speed order, PP, status conditions, stat stages,
  weather, terrain, screens, two-turn moves, recoil, draining, multi-hit moves …
- **Moves you can see.** Each move is played with the best-matching action in
  that sprite's own artwork, plus lunges, type-coloured projectiles and hit
  flashes, HP bars, status tags and glows, stat arrows, shields, and more.

Battles are never staged: nothing steers sprites toward each other. Everyone
picks random spots to walk to, and a battle starts only when two free sprites
come within `battleRange` pixels on their own. On a large screen with a small
party that is an occasional event; set `battles: false` for none at all.

This is a separate module from MMM-Neko (it grew out of it) and does not need it.

## Install

```sh
cd ~/MagicMirror/modules
# copy or clone this folder here as MMM-Pokemon
```

There is nothing to `npm install` for normal use. Node 20+ is required (it
ships with current MagicMirror²).

```javascript
{
  module: "MMM-Pokemon",
  position: "fullscreen_above",
  config: {
    party: ["pikachu", "charmander", "squirtle", "bulbasaur"]
  }
}
```

### Artwork

No sprite artwork is bundled. With `autoDownload: true` (the default), the
first time a Pokémon is in your `party` the module's server side downloads its
sheets from the [Sprite Collab repository](https://github.com/PMDCollab/SpriteCollab)
into `sprites/<dex>/` and it appears a few seconds later. Later starts use the
local copy and need no network.

To fetch ahead of time, or with `autoDownload: false`:

```sh
node scripts/fetch-sprites.js pikachu 4 "mr. mime" 25/0/1
```

A Pokémon whose artwork is missing or incomplete is simply not shown. Each
folder keeps the sprite's `credits.txt`; see [Credits](#credits-and-licences).

## The party

Each `party` entry is a name, a Pokédex number, or an object:

```javascript
party: [
  "snorlax",
  94,                                                   // Gengar
  { pokemon: "pikachu", moves: ["Thunderbolt", "Quick Attack", "Iron Tail", "Thunder Wave"] },
  { pokemon: "eevee", level: 30 },
  { pokemon: "charizard", shiny: true },
  { pokemon: "vulpix", sprite: "37/1" }                 // Sprite Collab form folder (Alolan)
]
```

| Key | Meaning |
| --- | --- |
| `pokemon` | Name (`"Mr. Mime"`, `"farfetch'd"`) or Pokédex number, 1–1025 |
| `moves` | One to four move names to always use (unknown or left-out moves are skipped with a console warning). Omit for four random learnset moves, re-drawn every battle |
| `level` | 1–100 for this Pokémon; defaults to the module's `level` |
| `shiny` | Use the shiny sprite |
| `sprite` | A Sprite Collab path `dex/form/shiny/gender` for a specific form's artwork |

Species data (types, base stats, learnset) is that of the base form; `sprite`
and `shiny` only change the artwork.

### Random parties

```javascript
config: {
  randomParty: 6,        // six random Pokémon, re-drawn every time the mirror loads
  randomVariants: true   // each with a random available sprite: a form, a shiny, a gender variant …
}
```

- `randomParty: N` replaces `party` with N different Pokémon chosen from those
  that have artwork in Sprite Collab (979 of the 1,025 at the time of writing).
  Nobody repeats until all of them have been used.
- `randomVariants: true` gives every member — random or listed in `party` —
  one of the sprites that exist for it, chosen evenly: the regular one, the
  shiny, a female variant, an alternate form, and so on (for Pikachu:
  `25`, `25/0/1`, `25/0/0/2`, `25/6`, …). Entries with their own `sprite` or
  `shiny` keep it. Only the artwork changes; types, stats and moves stay those
  of the base form.

Which sprites exist comes from `data/variants.json`, a snapshot of the Sprite
Collab tracker. Run `node scripts/build-variants.js` to refresh it when new
sprites have been added to the repository. Each new sprite is downloaded the
first time it is drawn, so random parties need `autoDownload` (or a
well-stocked `sprites/` folder) and a network connection for newcomers.

## Battles

1. Two sprites that meet stop and face each other. HP is calculated from base
   stats at their level, as in the games, and both start at full health.
2. Each turn both pick a move. Priority, then Speed, decides who goes first.
   One acts — its action plays, the move travels or the user lunges — and the
   other reacts on the hit frame; then the second acts.
3. End-of-turn effects apply (burn, poison, Leech Seed, weather, …).
4. This repeats until one faints. The loser plays its `Faint` action and stays
   down for `faintTime` seconds, then gets up healed. The winner poses and
   walks on. Both are left alone for `battleCooldown` seconds.

Battles can also end without a winner: Teleport and Roar/Whirlwind end them the
way they end a wild battle, both sides can faint together, and a fight still
undecided after 40 turns is called off.

### What moves do to the sprites

| In the battle | On screen |
| --- | --- |
| Any move | The user plays the closest action its artwork has: punches use `Punch`/`Strike`, kicks `Kick`, bites `Bite`, slashes `Slice`/`Scratch`, beams and shots `Shoot`, sound moves `Sound`/`Sing`, dances `Dance`/`Twirl`, spins `Rotate`, defensive moves `Withdraw`, self-boosts `Charge`/`Swell`, and so on, falling back to `Attack`/`Shoot`/`Charge` |
| Contact move | The user lunges at the target and steps back |
| Ranged move | Type-coloured particles: shots, dense beams, jagged electric bolts, travelling sound rings; ground moves shake both fighters |
| Hit | Target flashes, shakes and plays `Hurt`; bigger burst when super effective, a ring on a critical hit; the HP bar drains |
| Miss | The target sidesteps |
| Burn, poison, paralysis, freeze, sleep | Tag next to the name (`BRN`, `PSN`, `PAR`, `FRZ`, `SLP`), a coloured glow, and rising flames / bubbles / sparks / “z”s. Sleepers lie in their `Sleep` action; frozen sprites hold still |
| Confusion, Leech Seed, Curse, Attract | Circling stars, green motes and glow, purple glow, hearts |
| Stat changes | Orange ▲ or blue ▼ arrows, one more per stage |
| Protect and its variants | A shield ring for the turn |
| Fly, Bounce / Dig, Dive / Phantom Force | The user rises out of view / sinks / vanishes for a turn, then strikes |
| Substitute, Minimize | The user turns translucent / shrinks |
| Transform | The user takes on the opponent's artwork (and its types, stats and moves) until the battle ends |
| Healing, draining, recoil | Green “+”, a stream between the fighters, a shake |
| Rain, sun, sandstorm, snow, terrains | Weather particles around the pair while it lasts |
| Teleport | The user disappears and turns up elsewhere on screen |

A line of text under the pair says what is happening (`showText`).

### How complete the moves are

All 903 moves can be used and all are covered by tests that run each one in
battle. In detail:

- **About 700** behave as in the games: everything expressible as data (power,
  accuracy, type, priority, secondary effects, stat changes, drain, recoil,
  multi-hit, weather, screens, …) plus about 180 with their own rules, such as
  Counter, Transform, Metronome, Rest, Substitute, Perish Song, Belly Drum,
  weight- and HP-based power, or Fake Out.
- **About 200** have an extra game rule that is simplified: their core effect
  (damage, status, stat change) works, but a nuance tied to something this
  little world lacks, or a rarely relevant special case, is left out.

Left out: 48 moves that can only do something with a held item, an ability or a
partner Pokémon (Trick, Fling, Skill Swap, Follow Me, Helping Hand, Baton Pass,
…). None of those exist here, so these moves could only ever fail; they are not
in the data, are never drawn from a learnset, and cannot be listed under
`moves`. The list is at the top of `scripts/build-data.js`.

Not modelled: abilities, held items, natures/EVs, switching, Mega Evolution,
Dynamax, Terastallization. Z-Moves and Max Moves are in the data but no
Pokémon learns them, so they only appear if you list them under `moves`.

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `party` | four starters | One or more entries, see above. There is no upper limit; very large parties cost more CPU and crowd the screen |
| `randomParty` | `0` | A number of Pokémon to pick at random on every load, instead of `party`. See [Random parties](#random-parties) |
| `randomVariants` | `false` | `true` gives each member a random one of its available sprites (forms, shiny, gender) |
| `level` | `50` | 1–100, for members without their own |
| `battles` | `true` | Whether sprites battle when they meet |
| `battleRange` | `24` | 0–300 pixels between two sprites at which a battle starts, measured between what is visibly drawn of each (not its padded frame), so large Pokémon must come as close as small ones |
| `battleCooldown` | `30` | 0–3600 seconds a sprite is left alone after a battle |
| `faintTime` | `8` | 1–600 seconds the loser stays down |
| `battleSpeed` | `1` | 0.25–4; 2 plays battles twice as fast |
| `moveDelay` | `0.5` | 0–10 seconds of pause before each Pokémon's move in a battle |
| `showText` | `true` | Battle text line |
| `showHp` | `true` | Names and HP bars during battles |
| `nameSize` | `0` | Nameplate text size in pixels (6–64); `0` = automatic from `scale` |
| `hpBarWidth` | `0` | Health bar width in pixels (16–600); `0` = automatic |
| `hpBarHeight` | `0` | Health bar thickness in pixels (2–60); `0` = automatic (half the name size) |
| `textSize` | `0` | Battle text size in pixels (6–96); `0` = automatic |
| `textBoxWidth` | `0` | Battle text box width in pixels (80–2000); `0` = automatic. The box grows taller to fit its text |
| `autoDownload` | `true` | Fetch missing artwork from Sprite Collab |
| `skipActions` | `[]` | Action names (e.g. `["Hop"]`) never to play as a fidget between walks |
| `mode` | `"wander"` | `"wander"`, `"mouse"` or `"touch"` (follow the pointer) |
| `scale` | `2` | Integer 1–4 enlargement of the artwork |
| `speed` | `32` | Walking speed, 1–200 pixels per second |
| `idleMin` / `idleMax` | `4` / `10` | Seconds of idling between walks |
| `sleepAfter` / `sleepDuration` | `120` / `30` | Seconds awake before a nap, and its length |
| `startPosition` | `{ x: 0.5, y: 0.7 }` | Only `y` is used with more than one sprite; they start spread across the width |
| `inset` | `16` | Pixels kept clear at the screen edges |
| `avoid` / `avoidMargin` | `[]` / `4` | Module names or CSS selectors to walk around, and the gap to keep |
| `reducedMotion` | `"auto"` | `"auto"`, `"always"`, `"never"`. With reduced motion the sprites rest in place and do not battle |

Invalid values fall back to their defaults individually.

## Notifications

`POKEMON_SHOW`, `POKEMON_HIDE`, `POKEMON_PAUSE`, `POKEMON_RESUME`,
`POKEMON_SET_MODE` (`{ mode }`) and `POKEMON_GO_TO_REGION` (`{ region }`, a
MagicMirror region name such as `"top_left"`). Sprites in a battle finish it
before following pointer or region commands.

### When MagicMirror hides the module

`module.hide()` calls `suspend()`, which stops the module completely: the
animation timer, every window and document listener, any artwork still loading
in the browser, and the sprite download in the node helper. Nothing runs until
`module.show()` calls `resume()`, which picks everything up where it stopped.
Commands received while suspended are remembered and applied on resume.

## Development

```sh
npm install
npm run check                 # lint + tests
npm install --no-save esbuild && npm run build:data   # regenerate moves and species from Pokémon Showdown
npm run build:variants        # refresh the list of available sprite variants
```

`lib/pk-mechanics.js` is the battle rules (pure, no DOM); `lib/pk-battle.js`
plays its events back on sprites; `lib/pk-engine.js` is movement;
`lib/pk-sprites.js` reads Sprite Collab `AnimData.xml`; `lib/pk-controller.js`
draws.

## Credits and licences

- Code: MIT (see `LICENSE`). Movement, obstacle avoidance and the module shell
  derive from MMM-Neko by Brian Wente.
- `data/moves.json` and `data/pokedex.json` are generated from the data files of
  [Pokémon Showdown](https://github.com/smogon/pokemon-showdown) (MIT). Only
  plain data is taken; move behavior is implemented here.
- `data/variants.json` lists which sprite paths exist, read from the Sprite
  Collab tracker; it contains no artwork.
- Sprites are **not** included. They are downloaded on request from PMD Sprite
  Collab and remain subject to their contributors' credits (`credits.txt` in
  each folder) and that project's terms; check them before redistributing.
- Pokémon and Pokémon character names are trademarks of Nintendo, Creatures
  Inc. and GAME FREAK inc. This is an unofficial fan project, not affiliated
  with or endorsed by them.
