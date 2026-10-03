# Band packs (sprite-gen 2.18 + Grok Imagine)

Original characters for band mode, drawn in Omo's style:

| Pack | Character | Instrument |
|---|---|---|
| `omo-cat` | Omo, charcoal kitten in a mint scarf | vocals (`play.apng` added) |
| `dalli` | Dalli, chestnut otter in a blue bandana | guitar |
| `bara` | Bara, caramel capybara in a lavender beanie | bass |
| `dochi` | Dochi, cocoa-spined hedgehog in a yellow sweatband | drums |
| `rupa` | Rupa, pink axolotl in round glasses | keyboard |

`stills/` holds every pose still with the prompt that drew it, after the cutout described below.

## How they were made

1. **Side stills**: `sprite-gen gen --provider grok --ref art/omo-cat/base.png --ref art/omo-cat-video/stills/stand.png --facing right`,
   with Omo's two stills as style references (`stills/<name>-side.prompt.txt`).
2. **Instrument stills**: the same with the character's side still plus `omo-vocal.png` (for the three-quarter view) as references,
   instrument in hand (`stills/<name>-play.prompt.txt`).
3. **Cutout**: Grok returns an off-key background and a corner watermark. The background is flood-filled from the border,
   edge pixels are un-mixed, and only the main subject is kept; then the subject is re-seated on pure `#FF00FF`
   (Rupa on `#00FF00`, since a pink axolotl keys badly on magenta).
4. **Idle / walk**: `sprite-gen video-set --base side=<still> --states idle` and `--states walk --anchor motion-auto`
   (720p, `--decontam palette`).
5. **Play loops**: `video-canvas` then `video --image X --last-frame X --duration 3` (pinned 3 s = two bars of the
   160 BPM song), `video-frames --decontam palette`, `video-loop --cycle pinned`. Prompts are in `play-prompts.json`.
6. **APNG**: `python art/band/build_band_apng.py --cycles <gen root> --out public/packs` fits the cycles into
   omo-cat's idle cell (192×256, body 224 px, feet 16 px above the bottom), pins walk frames to one ground line
   and body centre, and writes shared-palette APNGs at 24 fps (`states.json` lists the cycle folders).

The song the band plays is synthesized at runtime (`src/band-music.ts`); there are no audio files.
