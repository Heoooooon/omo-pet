# 크로아상쥐 (Croissant Mouse) — local fan pack, not bundled

**Fan art of '크로아상 행님', a community member's mascot. Not covered by the repository's MIT license and
not part of the app.** `scripts/check-bundle.mjs` only lets original and licensed packs ship, so this folder
holds the recipe only: prompts, timing and the build script. The reference image, stills, clips and APNGs stay
on the maker's computer, and the finished pack is added through **Settings › My character › Import a pack**.

Design: white mouse with pink ears, pink paws and a long pink tail, a gold monocle on its right eye with a
dotted chain, drawn in a simplified storybook pencil look that still reads at about 100 px. Like the reference,
it always carries a big croissant hugged in its arms (on its lap while typing, as a pillow while asleep, lifted
overhead in the stretch). The rides keep the first generation's giant croissant rocket (`rocket`, `jet`,
`jet-climb`, a chrome nozzle in its back end) — the owner liked it — so those three come from the first
generation's output (`"gen": "v1"` in `states.json`, `--cycles-v1`). The parachute is cream with
croissant-brown stripes. The To-Do tablet was left out: it is unreadable at pet size.

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
| walk | `video-set --states walk --anchor motion-auto` | 22 frames, 0.917 s |
| rocket, jet-climb, fall-glide | `video --image X --last-frame X` (canvas `tall --headroom 0.18` / `square` / `tall`) | pinned loop, 3 s |
| jet | same, still padded 10/25/25/10 % (left/top/right/bottom) so the flame stays in frame | Grok zooms in and back out at the ends: only source frames 10-59 (steady zoom) are used, 2 s |
| fall-open, fall | `video --image freefall --last-frame glide`, 2 s | whole clip in 0.55 s / 0.75 s |
| fall-land | `video --image land --last-frame stand`, 2 s | whole clip in 0.45 s |
| edge | `video --image hang --last-frame sit`, 3 s | whole clip in 2 s |
| sleep, typing | `video --image X --last-frame X`, square canvas, 3 s / 2 s | pinned loop |
| climb, climb-slide | `video --image climb|slide --last-frame` same, tall canvas, 2 s | pinned loop |
| wake | `video --image sleep --last-frame stand`, tall `--headroom 0.3`, 2 s | whole clip in 1 s |
| stretch | `video --image stand --last-frame stand`, tall, 3 s | whole clip, 3 s |

Stills of the second generation (everything but the rides) were drawn with `--ref <first base-side> --ref <reference image>`
and their key backgrounds flattened to one colour before `video-canvas` (border-connected key pixels only).
No loop used RIFE in-betweens (cut as filmed), so `video-loop-repair` (sprite-gen 2.39) had nothing to restore.

```bash
uv run --no-project --with pillow --with numpy --with scipy \
  python art/croissant-mouse/build_pack.py --cycles <gen root> --cycles-v1 <first gen root> --out <dir>/croissant-mouse --zip
```

## One size in every state

An imported pack gets the generic widths from `src/style.css` (176 px, the level jet 216 px), so the size is
baked into the cells: each frame is scaled until the inner ear (sqrt of the largest compact pink area) is
14.5 display px, which makes the standing mouse about 100 px tall. Clips the camera zooms through
(`fall-open`, `fall-glide`, `fall-land`) are measured per frame; `edge` is measured on its last quarter
because the raised arms hide the ear while it hangs. Cells are 2x for Retina. The walk stride (30) is the
measured backward slide of the planted foot.
