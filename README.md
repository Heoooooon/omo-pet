# omo-pet

**English** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

**Omo the cat and Jabdori the puppy live on your monitors.** An open-source desktop pet that uses
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
- 🎛️ **Settings GUI** — right-click → Settings: show or hide each character (Omo and Jabdori both come out on first launch) and tune size, speed, activity, and trick frequency live
- 🎭 **Character packs** — drop action APNGs into `public/packs/<name>/` to make a new character
- 🐾 **Summon friends** — add up to 3 friends, each with a slightly different personality (size, gait)
- 🔍 **Recognition overlay** — a per-monitor overlay shows which windows count as platforms
- ✋ **Drag / 💖 click reactions** — pick Omo up and they dangle; click and they send a heart

### Band mode and your own characters

- 🎸 **Band mode**: choose "Open band" in the tray or the right-click menu (it also happens now and then on its own). Omo (vocals) and four friends (Dalli on guitar, Bara on bass, Dochi on drums, Rupa on keys) walk in from the screen edges and gather on the taskbar line. They play a short original song on a small stage for about 20 s, then bow and walk off. The song is synthesized in the app. Sound starts off; turn it on with "Sound on" above the stage.
- 🧑‍🎨 **My character**: in Settings › My character, choose one picture. The app makes idle, walk, parachute and instrument sprites on your computer with **your own Grok login** (Codex CLI can do stills too). The result stays on your computer. Use only art you drew or have the rights to. Packs can also be imported from a folder or zip ([pack format](docs/pack-format.md)).

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

## Bring your own character

A pack is a folder of sprites at `public/packs/<pack>/<state>.apng`
(idle / walk / drag / react / fall / edge / rocket / jet, plus optional
`fall-open` / `fall-glide` / `fall-land` phases). Any missing action falls back
to idle, and variants (`<state>.2.apng` … `<state>.4.apng`) are picked at
random. Import your pack from **Settings › My character › Import a pack**
(folder or zip, see [pack format](docs/pack-format.md)); the release build
bundles only the original packs (`scripts/check-bundle.mjs` fails the build otherwise).

The Omo pack was made with [sprite-gen](https://github.com/aldegad/sprite-gen):
one still image (`art/omo-cat/base.png`) → one sprite-gen run per action
(`art/sprites/omo-<state>/`, request + prompt + raw row + frames) → APNG with
`ffmpeg`. The full recipe is in `.claude/skills/add-action/SKILL.md`.

## Project structure

```
src/main.ts              Behavior brain: state machine, window-platform physics,
                         multi-monitor crossing, Lanbeam handoff, pack loading
src/style.css            Per-state CSS motion and per-pack sprite sizes
src/settings.ts          Settings panel (packs, band pack license, My character)
src-tauri/               Tauri shell: transparent window, window list, Lanbeam bridge client
public/packs/omo-cat/    The bundled Omo pack (APNG per action)
art/                     Omo source still + sprite-gen run records
```

## Credits

- Based on **[hermes-pet](https://github.com/Heoooooon/hermes-pet)** (MIT) — the
  desktop-pet engine, window-platform physics, and multi-monitor/iPad features
- **Sprite generation** — [sprite-gen](https://github.com/aldegad/sprite-gen) (@aldegad)
- **Omo** is an original character by CMORE
- **Jabdori (잡도리)** © Sisyphus Labs (OmO Native), used with permission (잡도리 © Sisyphus Labs (OmO Native), 허락 받아 사용)

## License

[MIT](./LICENSE) — covers the code and the Omo artwork (`art/`,
`public/packs/omo-cat/`). Jabdori (`art/jabdori/`, `public/packs/jabdori/`) is not
MIT: it belongs to Sisyphus Labs and ships here with their permission, so do not reuse it
without asking them.
