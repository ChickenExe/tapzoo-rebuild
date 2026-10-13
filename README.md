# Tap Zoo (desktop rebuild)

A from-scratch Mac/Windows rebuild of **Tap Zoo 2.5.7** (Pocket Gems, 2010–11). It runs on the
original game's art and data tables, taken from your own copy of the IPA.

The original app can't run on a Mac. Its executable is 32-bit ARM only (armv6/armv7) and
FairPlay-encrypted, and its servers are gone. This project leaves that executable alone and
rebuilds the game around the unencrypted resources.

> **Fan preservation project, not affiliated with or endorsed by Pocket Gems.** This repository
> contains only original code. It includes none of Tap Zoo's art, sounds or data: you need your
> own copy of the game's IPA, which the extractor converts locally on your machine.

## Setup

```bash
npm install
npm approve-scripts electron        # lets Electron download its runtime
npm run extract -- ~/Desktop/Tap_Zoo_2.5.7_ios_3.0.ipa
```

`extract` writes the converted assets to `public/game/` and the app icon to `build/icon.png`.
Both are git-ignored because they are Pocket Gems' content.

## Play

```bash
npm start            # build and open in Electron
npm run dev          # browser dev server on http://localhost:5199
npm run dist:mac     # release/Tap Zoo-<v>-arm64.dmg
npm run dist:win     # release/Tap Zoo Setup <v>.exe (x64) + zip
```

Controls: drag to pan, scroll or pinch to zoom, tap habitats to collect coins, **R** rotates
while placing, **G** shows the tile grid, **Esc** cancels. Saves are kept in Electron's local
storage.

## What came from the IPA

| Original | Format | Used for |
| --- | --- | --- |
| `*.png` | Apple "CgBI" PNG (BGRA, premultiplied, raw deflate, some Adam7) | Converted to standard PNG |
| `*ATLAS.dat` + `*ATLAS.png` | `u16 version, u16 count`, entries `[offset, parts, w, h(, group, frame)]`, parts `[x, y, w, h, dx, dy]` + name | Sprite sheets and habitat animations |
| `*.csv` | header row, type row, `!@#checksum` trailer, CR line endings | Catalog, prices, timers, XP curve, land costs, daily bonus |
| `CompositeFloorTypes.csv` + `mNN.csv` | piece aliases with x-flip; pieces at tile coordinates | Island terrain for all 79 land sizes |
| `mNN.walk` / `mNN.place` | `i,j` per line | Buildable and walkable tiles |
| `tzl.caf` | CAF, IMA4 ADPCM | Theme music (decoded to WAV) |

The projection is OpenGL-style y-up: tile `(i, j)` has its bottom corner at
`((i − j)·31.2, −(i + j)·15.6)`, and each 5×5 terrain piece is anchored at the bottom corner of its
diamond.

## What's in the game

The feature set follows the original's class and method names. They survived in the binary's
unencrypted symbol table (about 660 classes and 6,900 methods), even though the code itself is encrypted.

- **Store:** all 235 animals plus every building, tree, decoration, path, river, hedge and ranger.
  Locked items appear once a goal unlocks them.
- **Habitats:** one per species. Buy a pair (`maxToPurchase` = 2), then breed up to `maxToBreed` (4).
- **Nursery** (`BreedingPanel`): nests bought with `BreedingSlotCosts`. Eggs take `feedingTimes`
  (in minutes or hours, per `feedingTimesUnit`). A finished egg left past `marginForError` hours goes
  rotten and the animal gets sick. You can revive it for `reviveCost` stars, or pay prorated
  `expediteBreedCost` stars to finish an egg early.
- **Crossbreeding** (`CrossBreedingPanel`): pick a first and second animal. All 88 recipes from
  `CrossBreedingCombinations.csv` are included, with the result shown as "?" until you discover it.
  Results go to your inventory to place.
- **Goals:** all 307 achievements in Tutorial, Achievements2/3, Sidegrades and Sprout, using the
  original requirement/reward grammar. That covers the tutorial, the Platypus, Rescue Animals
  (dock and boat) and Creation Station storylines, unlocks, and gifted and removed map objects.
- **Zoo Grades** (`GradeRequirements.csv`) and **ticket price**: visitors per day drive gate revenue,
  which you collect by tapping the gate.
- **Also:** the bonus bar, trash and trash cans, rangers who auto-collect, upgrades (sidegrades) with
  "!" marks, land expansion through all 79 maps, the daily bonus and level-up rewards.
- **Neighbor:** visit Sally, the demo zoo bundled in `hugeZoo.db`.
- **Utilities:** save export and import, and desktop notifications when eggs hatch.

## Quality of life

- **Collect All:** the coin button by the toolbar (or Space) collects every ready habitat, tree,
  shop and the gate. Its number shows how many things are ready.
- **"While you were away":** after 10+ minutes away, a summary of what's ready, hatched or sick,
  ticket money and trash.
- **Notifications:** an in-game message, plus a desktop notification when the window is in the
  background, whenever an egg hatches or goes sick.
- **Toolbar badges:** Nursery and Cross-Breeding show ready (green), sick (red) and free nests.
- **Hover tooltips:** hovering a habitat shows its animals, the coins due and when, and egg status.
- **Hover to clean:** trash cleans itself as the mouse passes over it.
- **Settings:** music volume, interface size, and optional countdowns under habitats.
- **Daily backups:** a dated copy of the zoo is written to `backups/` in the save folder; the last
  14 days are kept and can be restored from Save / Load.
- **One copy at a time:** opening Tap Zoo again focuses the running window instead of starting a
  second copy on the same save.

## Expansion animals

`src/content/expansion.ts` adds 151 animals that were never in Tap Zoo:

- **100 store animals** across levels 1–50 and every habitat class. 15 of them cost stars.
- **51 crossbreed-only hybrids**, each with its own recipe, mixing original and new animals.

Their stats come from curves fitted to the original `AnimalObjectTypes.csv` (price and coins per
hour by level, breeding time and XP), with a stable per-animal variation. Hybrids pay 1.6× a store
animal of their tier, and mythic ones (Kirin, Kraken, Leviathan…) pay 2.4×. A hybrid's tier comes from
its parents. Crossbreed-only parents are estimated from their breeding time, since the CSV lists them all at level 1.

## Missing art and custom art

About 200 animals and many decorations were downloaded from Pocket Gems' servers and never shipped
in the IPA. They show as blank labelled squares. To give an item art, drop a PNG named exactly after
the item (for example `public/custom-art/Liger.png`) and rebuild. The image is drawn bottom-centred on the
item's footprint, like the original sprites.

## Design choices (not recoverable from the data)

These rules lived in the encrypted binary or on the servers, so they're reimplemented here:

- **Shops and facilities** pay hourly, scaled by their CSV `value`.
- **Ticket sales:** a zoo day lasts 1 hour. Visitors per day depend on animals, level, overall grade
  and how the ticket price compares to a fair price.
- **Grades** compare your zoo's value with that level's `GradeRequirements` row, on a 0–10 scale.
  The ranger grade wants one ranger per 4 habitats.
- **Bonus bar:** fills from collections; pays 100 × level + 50 coins, up to 5 times a day.
- **Trash** appears every 4 minutes; each trash can lowers the cap.
- **Rangers** each auto-collect one ready habitat roughly every 20 seconds.
- **Neighbor help** pays 20 + 15 × your level, 5 times a day.
- **Goal timing:** `ComeBack:n` waits n hours, and `LogIn:n` counts distinct days played.
- **Offline goals:** social requirements (email, SMS, Facebook, friends) count as done so storylines
  keep moving. `GetVisitors:n` means n × 100 visitors a day.
- **Not ported:** buying stars with real money (IAP), Facebook, and Pocket Gems' servers. Stars come
  from level-ups and goal rewards.
