# OmO pack sources (sprite-gen 2.18)

**OmO © Sisyphus Labs (OmO Native), 허락 받아 사용 / used with permission.**
This character is not covered by the repository's MIT license. Do not reuse the art in this folder or in
`public/packs/omo/` without permission from Sisyphus Labs.

The pack follows the official OmO from the OMO Native announcement art (black hood with cat ears, glossy black
visor with the glowing lime-green "OmO" face, black hooded jacket with lime cuffs and zipper, crossbody strap,
black sneakers with lime soles and purple accents). Nothing was added to the outfit; the parachute and rockets are
the same props every pack uses. It is drawn in the same style as Omo, made with the same pipeline as
`art/omo-cat-video/` and fits into the same cells, so the omo-cat CSS sizes apply unchanged.

| Folder | Contents |
|---|---|
| `stills/` | Pose stills on a magenta key and their prompts (`sprite-gen gen --provider grok --ref stills/base-side.png --ref <official art crop>`; the base used `--ref <official art crop> --ref art/omo-cat/base.png`) |
| `<state>/` | `prompt.txt`, `clip.mp4`, and the canvas, clip and loop reports |
| `custom-items.json` | Start/end still, canvas shape, clip length and cycle mode per custom clip |
| `states.json` | Cycle folder, length, fps, playback count and skipped frames per runtime state (read by `../omo-cat-video/build_apng.py --spec`) |

## How each state was made

| State | Clip | Cut |
|---|---|---|
| idle | `video-set --states idle` from `stills/base-side.png` | whole pinned clip, 3 s |
| walk | `video-set --states walk --anchor motion-auto` (24-frame cycle, `video-cycle-align --length 24` kept it as is) | 24 frames over 1.15 s |
| rocket, jet | `video --image X --last-frame X` | whole pinned clip, 3 s; `fit: height` and `defringe` |
| fall-glide | `video --image glide --last-frame glide` | whole pinned clip, 3 s |
| fall-open, fall | `video --image freefall --last-frame glide` | 0.55 s and 0.75 s; source frames 17-31 skipped (the canopy overshoots above the final pose and would be clipped by the cell) |
| fall-land | `video --image land --last-frame stand` | 0.45 s |
| edge | `video --image hang --last-frame sit` | 2 s; a detached ground shadow was erased from cycle frames 26-31 and frames 32-33 (shadow touching the body) are skipped |

All clips are 720p, 24 fps, keyed with `video-frames --key magenta --decontam palette`.

## Walk timing

The app walks every 56-px-stride pack at 56 logical px per 0.75 s. The foot band of this walk travels the same
distance per cycle as Omo's (measured on the bundled APNGs), so the cycle keeps Omo's 1.15 s.

## Rebuild

```bash
python art/omo-cat-video/build_apng.py --cycles <gen root> --reference-pack public/packs/omo-cat \
  --spec art/omo-official-video/states.json --out public/packs/omo
```
