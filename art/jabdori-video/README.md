# Jabdori pack sources (sprite-gen 2.18; rocket, jet and jet-climb redone with 2.38)

**Jabdori (잡도리) © Sisyphus Labs (OmO Native), 허락 받아 사용 / used with permission.**
This character is not covered by the repository's MIT license. Do not reuse the art in this folder or in
`public/packs/jabdori/` without permission from Sisyphus Labs.

The pack follows the official mascot (white puppy, dark-gray floppy ears, curl tuft, collar with a gray hex tag,
dark tail, no outfit) and is drawn in the same style as Omo. It was made with the same pipeline as
`art/omo-cat-video/` and fits into the same cells, so the omo-cat CSS sizes apply unchanged.

| Folder | Contents |
|---|---|
| `stills/` | Pose stills on a magenta key and their prompts (`sprite-gen gen --provider grok --ref stills/base-side.png --ref <official art crop>`). `rocket.png`, `jet.png` and `jet-climb.png` are the retro-SF rocket concept stills (gpt-image via the p2d `gen_image.mjs` fallback, edited from the earlier rocket/jet stills; prompts in `stills/*.prompt.txt`) |
| `<state>/` | `prompt.txt`, `clip.mp4`, and the canvas, clip and loop reports |
| `custom-items.json` | Start/end still, canvas shape, clip length and cycle mode per custom clip |
| `states.json` | Cycle folder, length, fps and playback count per runtime state (read by `../omo-cat-video/build_apng.py --spec`) |

## How each state was made

| State | Clip | Cut |
|---|---|---|
| idle | `video-set --states idle` from `stills/base-side.png` | whole pinned clip, 3 s |
| walk | `video-set --states walk --anchor motion-auto`, then `video-cycle-align --length 24` (RIFE 16 -> 24 frames) | 24 frames over 1.07 s |
| rocket, jet, jet-climb | `video --image X --last-frame X` (sprite-gen 2.38, still `stills/X-green.png`, canvas `tall --headroom 0.18` / `wide` / `square`; jet-climb's still has 22 % more room left and below so the flame tip stays in frame) | whole pinned clip, 3 s; `fit: height` and `defringe`; jet-climb is fitted into the rocket cell (`ref: rocket`) |
| fall-glide | `video --image glide --last-frame glide` | whole pinned clip, 3 s |
| fall-open, fall | `video --image freefall --last-frame glide` | 0.55 s and 0.75 s; source frames 24-26 skipped (canopy blurred into the key) |
| fall-land | `video --image land --last-frame stand` | 0.45 s |
| edge | `video --image hang --last-frame sit` | 2 s |

All clips are 720p, 24 fps, keyed with `video-frames --key magenta --decontam palette`, except rocket, jet and jet-climb:
their violet flame edge is close to the magenta key and was keyed away, so their stills are moved onto a green key
(`stills/*-green.png`, the concept still matted by hue) and keyed with `video-frames --key green --spill auto --decontam palette`.

## Rocket stunt (retro-SF rocket, 2026-10-06)

The three ride states share one vehicle: a riveted silver rocket with a red stripe, two portholes and red fins,
the puppy in pushed-up goggles and a red scarf, a white -> orange -> violet flame with smoke and star dust.
`rocket` launches straight up, `jet` flies level to the right, and `jet-climb` (new, optional) climbs at about
45 degrees. The app shows `jet-climb` while a jet ride climbs steeply (`src/jet-sprite.ts`, > 20 degrees) and
falls back to `jet` in packs that do not ship it. Grok Imagine likes to zoom or raise a launching rocket: the
kept rocket clip was picked from several takes by the smallest per-frame head-width drift, with the prompt
asking the body to hold still and only the flame, smoke, ears, tail and scarf to move.

## Walk timing

The app walks every 56-px-stride pack at 56 logical px per 0.75 s. The planted foot of this walk travels
about 7% less per cycle than Omo's (measured on the bundled APNGs at the 220 px walk width), so the cycle
plays over 1.07 s instead of Omo's 1.15 s.

## Rebuild

```bash
python art/omo-cat-video/build_apng.py --cycles <gen root> --reference-pack public/packs/omo-cat \
  --spec art/jabdori-video/states.json --out public/packs/jabdori
```
