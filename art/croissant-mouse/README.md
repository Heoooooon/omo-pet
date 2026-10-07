# 크로아상쥐 (Croissant Mouse) — local fan pack, not bundled

**Fan art of '크로아상 행님', a community member's mascot. Not covered by the repository's MIT license and
not part of the app.** `scripts/check-bundle.mjs` only lets original and licensed packs ship, so this folder
holds the recipe only: prompts, timing and the build script. The reference image, stills, clips and APNGs stay
on the maker's computer, and the finished pack is added through **Settings › My character › Import a pack**.

Design: white mouse with pink ears, pink paws and a long pink tail, a gold monocle on its right eye with a
dotted chain, drawn in a simplified storybook pencil look that still reads at about 100 px. The giant croissant
from the reference is the ride for `rocket`, `jet` and `jet-climb` (a chrome nozzle in its back end); the
parachute is cream with croissant-brown stripes. The To-Do tablet was left out: it is unreadable at pet size.

| File | What it is |
|---|---|
| `stills/*.prompt.txt` | Pose stills (`sprite-gen gen --provider grok --ref stills/base-side.png --ref <reference image>`; `base-side` itself from the reference only), green key background |
| `custom-items.json` | Start/end still, canvas shape, clip length, cycle and prompt per custom clip |
| `states.json` | Source folder, length, fps and playback count per runtime state |
| `build_pack.py` | Turns the sprite-gen cycles into the pack folder (and zip) |
| `pack.json` | Name, emoji and walk stride copied into the pack |

## Making the pack

sprite-gen 2.38, Grok Imagine video on a grok.com login (`GROK_HOME`), every clip keyed on green
(`--key green --spill auto --decontam palette`), 720p, 24 fps.

| State | Clip | Cut |
|---|---|---|
| idle | `video-set --states idle` from `stills/base-side.png` | pinned loop, 3 s |
| walk | `video-set --states walk --anchor motion-auto` (frames re-run with `--allow-edge-contact`, loop `--cycle periodic`) | 33 frames, 1.375 s |
| rocket, jet-climb, fall-glide | `video --image X --last-frame X` (canvas `tall --headroom 0.18` / `square` / `tall`) | pinned loop, 3 s |
| jet | same, still padded 10/25/25/10 % (left/top/right/bottom) so the flame stays in frame | Grok zooms in and back out at the ends: only source frames 10-59 (steady zoom) are used, 2 s |
| fall-open, fall | `video --image freefall --last-frame glide`, 2 s | whole clip in 0.55 s / 0.75 s |
| fall-land | `video --image land --last-frame stand`, 2 s | whole clip in 0.45 s |
| edge | `video --image hang --last-frame sit`, 3 s | whole clip in 2 s |

```bash
uv run --no-project --with pillow --with numpy --with scipy \
  python art/croissant-mouse/build_pack.py --cycles <gen root> --out <dir>/croissant-mouse --zip
```

## One size in every state

An imported pack gets the generic widths from `src/style.css` (176 px, the level jet 216 px), so the size is
baked into the cells: each frame is scaled until the inner ear (sqrt of the largest compact pink area) is
14.5 display px, which makes the standing mouse about 100 px tall. Clips the camera zooms through
(`fall-open`, `fall-glide`, `fall-land`) are measured per frame; `edge` is measured on its last quarter
because the raised arms hide the ear while it hangs. Cells are 2x for Retina. The walk stride (26) is the
measured backward slide of the planted foot.
