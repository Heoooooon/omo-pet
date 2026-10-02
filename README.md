# omo-pet

**English** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

**Omo the cat lives on your monitors.** An open-source desktop pet that uses
your app windows as platforms — Omo walks on them, rockets off to other
monitors, floats back down on a parachute, and can even hop over to your iPad.

Built with [Tauri 2](https://tauri.app) (a transparent, frameless,
always-on-top window) and vanilla TypeScript. omo-pet is a fork of
[hermes-pet](https://github.com/Heoooooon/hermes-pet) with a new default
character and support for local character packs.

## Preview

<p align="center">
  <img src="docs/media/demo.gif" width="560" alt="Omo the cat walking, riding a rocket and a jet, parachuting down, and climbing up to sit">
</p>
<p align="center"><sub>🚶 Walk → 🚀 rocket → ✈️ jet → 🪂 parachute → climb and sit (Omo pack sprites)</sub></p>

Every action is an APNG sprite (they play right here):

| idle | walk | rocket | jet | parachute | climb & sit |
| :-: | :-: | :-: | :-: | :-: | :-: |
| <img src="public/packs/omo-cat/idle.apng" width="72"> | <img src="public/packs/omo-cat/walk.apng" width="72"> | <img src="public/packs/omo-cat/rocket.apng" width="72"> | <img src="public/packs/omo-cat/jet.apng" width="96"> | <img src="public/packs/omo-cat/fall.apng" width="72"> | <img src="public/packs/omo-cat/edge.apng" width="72"> |

## Features

- 🚶 **Walks on windows** — treats the top edge of real app windows as platforms, climbs up and walks along them, and rides along when a window moves
- 🪂 **Parachute** — floats down when the platform disappears or Omo drops from somewhere high
- 🚀 **Rocket & jet** — vertical rocket launches and sideways jet dashes
- 🖥️ **Multi-monitor** — crosses between monitors with different scale factors (Retina + external), side by side or stacked vertically
- 📱 **iPad handoff** — if the Lanbeam agent (a separate project) is running, Omo hops over to your iPad at the screen edge (optional; everything works without it)
- 🎛️ **Settings GUI** — right-click → Settings: switch characters and tune size, speed, activity, and trick frequency live
- 🎭 **Character packs** — drop action APNGs into `public/packs/<name>/` to make a new character
- 🐾 **Summon friends** — add up to 3 friends, each with a slightly different personality (size, gait)
- 🔍 **Recognition overlay** — a per-monitor overlay shows which windows count as platforms
- ✋ **Drag / 💖 click reactions** — pick Omo up and they dangle; click and they send a heart

## Getting started

Requirements: [Node.js](https://nodejs.org) 18+ and the [Rust](https://rustup.rs) toolchain.

```bash
npm install
npm run tauri dev     # run in development mode
npm run tauri build   # build a release app
```

- Controls: drag to move · click for a reaction · **right-click** for the menu (Friend+ / Settings / Recognition overlay / Quit)
- UI language: **Settings → Language** switches between English and Korean and saves your choice; English is the default unless your system language is Korean.
- Window detection uses public APIs only — no extra permissions needed
  (macOS `CGWindowListCopyWindowInfo` / Windows `EnumWindows` + DWM).
- macOS is the primary target. The Windows build is experimental (window
  detection compiles but is untested on real hardware); see the
  [hermes-pet README](https://github.com/Heoooooon/hermes-pet#getting-started)
  for Windows build steps — they are the same here.

## Fan-made Chiikawa packs (built on your computer)

You can turn the official LINE animated-sticker previews of the Chiikawa cast
into local character packs. With `--generate`, every action Omo has (walk,
rocket, jet, parachute, ledge, landing, …) is drawn for each character too:

```bash
node scripts/make-chiikawa-pack.mjs                                # sticker-only packs (quick)
node scripts/make-chiikawa-pack.mjs --generate                     # every action, all 7 characters
node scripts/make-chiikawa-pack.mjs --chars usagi,momonga --generate
node scripts/make-chiikawa-pack.mjs --chars usagi --generate --regen walk,jet  # redraw some actions
node scripts/make-chiikawa-pack.mjs --remove                       # delete them again
```

| Pack (`--chars`) | From the official stickers | Drawn with `--generate` |
|---|---|---|
| `chiikawa` | idle, react | everything else |
| `hachiware` | — | all actions |
| `usagi` | idle (2), react, drag | everything else |
| `momonga` | idle, react, drag | everything else |
| `kurimanju` | — | all actions |
| `yoroi` (Yoroi-san) | react | everything else |
| `yusangyun` (Muchauman) | — | all actions |

The script downloads the sticker images from LINE STORE to your computer,
erases the floating effect text, scales every action to the same body size,
and writes `public/packs/<character>/` plus `public/packs/local.json`. Then
pick the character in Settings. Only stickers that show the character alone
and in full body are used; without `--generate`, actions without a sticker
fall back to the idle sprite, and characters without a full-body sticker are
skipped. The script needs `ffmpeg`. `--generate` also needs a
[sprite-gen](https://github.com/aldegad/sprite-gen) checkout
(`SPRITE_GEN_DIR`, with its `.venv` installed) and a logged-in `codex` CLI
(it uses your ChatGPT subscription — no API key, no per-call charge). It draws
from the character's own stickers and official goods photos, takes about a
minute per action, and caches the frames in `.cache/chiikawa/gen/`.

> **Fan-made, unofficial, non-commercial.** This project is not affiliated with
> or endorsed by the Chiikawa rights holders. **No Chiikawa artwork is included
> in this repository** — the images are downloaded on each user's own computer
> for personal use, and `public/packs/*` is git-ignored. Please don't commit or
> redistribute the generated packs. Chiikawa © nagano / chiikawa committee.

## Bring your own character

A pack is a folder of sprites at `public/packs/<pack>/<state>.apng`
(idle / walk / drag / react / fall / edge / rocket / jet, plus optional
`fall-open` / `fall-glide` / `fall-land` phases). Any missing action falls back
to idle, and variants (`<state>.2.apng` … `<state>.4.apng`) are picked at
random. List your pack in `public/packs/local.json` to show it in Settings:

```json
[{ "id": "my-pack", "name": "My pack", "emoji": "🦊" }]
```

The Omo pack was made with [sprite-gen](https://github.com/aldegad/sprite-gen):
one still image (`art/omo-cat/base.png`) → one sprite-gen run per action
(`art/sprites/omo-<state>/`, request + prompt + raw row + frames) → APNG with
`ffmpeg`. The full recipe is in `.claude/skills/add-action/SKILL.md`.

## Project structure

```
src/main.ts              Behavior brain: state machine, window-platform physics,
                         multi-monitor crossing, Lanbeam handoff, pack loading
src/style.css            Per-state CSS motion and per-pack sprite sizes
src/settings.ts          Settings panel (packs from packs.json + local.json)
src-tauri/               Tauri shell: transparent window, window list, Lanbeam bridge client
public/packs/omo-cat/    The bundled Omo pack (APNG per action)
scripts/                 make-chiikawa-pack.mjs (local fan-made packs)
art/                     Omo source still + sprite-gen run records
```

## Credits

- Based on **[hermes-pet](https://github.com/Heoooooon/hermes-pet)** (MIT) — the
  desktop-pet engine, window-platform physics, and multi-monitor/iPad features
- **Sprite generation** — [sprite-gen](https://github.com/aldegad/sprite-gen) (@aldegad)
- **Omo** is an original character by CMORE
- Chiikawa © nagano / chiikawa committee (fan-made local packs only; not included)

## License

[MIT](./LICENSE) — covers the code and the Omo artwork (`art/`,
`public/packs/omo-cat/`). Characters you build locally with the Chiikawa script
belong to their rights holders and are not covered.
