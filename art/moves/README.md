# New moves: sleep, wake, stretch, wall climb, typing (sprite-gen 2.38)

OmO and Jabdori © Sisyphus Labs (OmO Native), used with permission — the art of `omo/` and `jabdori/`
here follows the same terms as `../omo-official-video/` and `../jabdori-video/`. `omo-cat/` is original Omo art.

| Sprite | What it is | Played |
|---|---|---|
| `sleep.apng` | Curled up asleep, breathing (3 s loop) | after the user has been away `90 s x activity` |
| `wake.apng` | Startled hop from the sleeping pose back to standing (1 s, once) | clicking a sleeping pet |
| `stretch.apng` | Big stretch and yawn (3 s, once) | sometimes while idle; typing wakes a sleeper with it |
| `climb.apng`, `climb-slide.apng` | Climbing a wall on the right in place, then sliding down (2 s loops) | reaching the side of the screen, `30% x stunts` |
| `typing.apng` | Tapping on a small laptop (2 s loop) | while the user types (key timing only) |

## Folders

| Path | Contents |
|---|---|
| `<pack>/stills/` | New pose stills on the chroma key and their prompts (`sprite-gen gen --provider grok`, refs: the pack's `base-side.png` and `stand.png`; Omo: `../omo-cat/base.png`). Backgrounds were flattened to one key colour (border-connected key pixels only) because `video-canvas` needs flat corners |
| `<pack>/<state>/` | `prompt.txt`, `clip.mp4` and `clip.report.json` |
| `<pack>/items.json` | Start/end still, canvas shape, clip length and cycle per state (`stand` is the pack's existing still) |
| `<pack>/build.json` | Measured head sizes, scales and cell sizes of the last build (the CSS widths in `src/style.css` come from here) |
| `tools/` | `build_moves.py` (cycles -> APNG) and the head metrics |

Clips: `video-canvas` (square: sleep, typing; tall: stretch, climb, climb-slide, wake with `--headroom 0.3`),
`video --image <start> --last-frame <end>`, `video-frames --key magenta --decontam palette`, and `video-loop --cycle pinned`
for the loops. Omo's climb-slide was re-shot with `--headroom 0.3` (the raised paws touched the top edge).

## Size

Every move is cut at the head size of the pack's rocket rides, so the character keeps one size:

- OmO: height of the glowing "O" eye ring; target = mean of rocket and jet.
- Jabdori: width of the white face; target = mean of rocket and jet. Side views where the face is foreshortened
  (climb, typing) use the floppy ear's area, calibrated face/ear on idle.
- Omo: ear tip to scarf top; target = idle (the scarf metric cannot see the rocket pose; idle already matches the rides).
- Sleep has closed eyes and a lying pose, so it takes the scale of the first frame of `wake` (the same still).

```bash
uv run --no-project --with scipy --with numpy --with pillow python art/moves/tools/build_moves.py \
  <pack> <gen dir with custom/<state>/{frames/keyed,loop/cycle}> . 
```

The builder also pulls magenta key that bled into warm edges (Omo's orange shoes) and drops near-clear key specks.
