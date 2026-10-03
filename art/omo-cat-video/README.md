# omo-cat video pack sources (sprite-gen 2.18)

The bundled omo-cat pack is cut from Grok Imagine clips with sprite-gen v2.18.0.
Every still here is original Omo art redrawn from `art/omo-cat/base.png`.

| Folder | Contents |
|---|---|
| `stills/` | Pose stills on a magenta key and the prompts that drew them (`sprite-gen gen --provider grok --ref art/omo-cat/base.png`) |
| `<state>/` | `prompt.txt`, `clip.mp4`, and the canvas, clip, frames and loop reports |
| `states.json` | Cycle folder, length (seconds), fps and playback count per runtime state |
| `build_apng.py` | Fits the cycles into the previous pack's cells and writes `public/packs/omo-cat/<state>.apng` |

## How each state was made

| State | Clip | Cut |
|---|---|---|
| idle | `video-set --states idle` from `stills/base-side-magenta.png` (pinned) | whole clip, 3 s |
| walk | `video-set --states walk --anchor motion-auto` | true period, 24 frames, played over 1.15 s |
| rocket | `video --image rocket --last-frame rocket` | true period, 22 frames |
| jet, fall-glide | `video --image X --last-frame X` | whole pinned clip, 3 s |
| fall-open, fall | `video --image freefall --last-frame glide` | whole clip, 0.55 s and 0.75 s |
| fall-land | `video --image land --last-frame stand` | whole clip, 0.45 s |
| edge | `video --image hang --last-frame sit` | whole clip, 2 s |

All clips are 720p, 24 fps, keyed with `video-frames --key magenta --decontam palette`.

## Timing contract with `src/main.ts`

- walk: 56 logical px per 0.75 s (`walkSpeed`). The planted foot of this walk travels about 80 logical px
  per cycle at the walk CSS width, so the 24-frame cycle plays over 1.15 s.
- fall-open switches to fall-glide after 550 ms; fall-land returns to idle after 450 ms.
- edge plays once and then holds the sitting pose for 4-8 s.

## Rebuild

Recreate the cycles (`video-frames` and `video-loop` on each `clip.mp4`; no new clip is needed), then

```bash
python art/omo-cat-video/build_apng.py --cycles <gen root> --reference-pack <previous pack dir> --out public/packs/omo-cat
```

The reference pack sets each state's cell and character box: this pack used the APNGs of commit `6d62077`
(`git show 6d62077:public/packs/omo-cat/<state>.apng`).

On Windows run sprite-gen as `.venv\Scripts\python.exe -m sprite_gen.cli`, set `PYTHONUTF8=1`,
and put libwebp's `img2webp` on `PATH`.
