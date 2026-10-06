# Character pack format

A pack is a folder (or a .zip of one) with one APNG per state and an optional `pack.json`.
Import it from **Settings › My character › Import a pack**. Imported and self-made packs
are stored in the app data folder (`%APPDATA%\dev.omopet.app\packs` on Windows,
`~/Library/Application Support/dev.omopet.app/packs` on macOS) and never uploaded.

| File | Needed | What it is |
|---|---|---|
| `idle.apng` | yes | Standing loop, facing right |
| `walk.apng` | no | Walk-in-place loop, facing right (otherwise idle + a CSS bounce) |
| `fall.apng` | no | Parachute loop (otherwise idle) |
| `fall-open.apng`, `fall-glide.apng`, `fall-land.apng` | no | Three-phase parachute, like omo-cat |
| `edge.apng`, `rocket.apng`, `jet.apng` | no | Climb-and-sit, rocket and jet stunts |
| `jet-climb.apng` | no | Diagonal climb shown while a jet ride climbs steeply (otherwise `jet.apng` plays for the whole ride); drawn in the rocket's tall cell |
| `play.apng` | for the band | Instrument loop; 3 s (or 1.5 s, 1 s) keeps it on the song's beat grid |
| `<state>.2.apng` … `.4.apng` | no | Variants picked at random |
| `pack.json` | no | Name and band role |

```json
{ "name": "Dotori", "emoji": "🌰", "instrument": "guitar", "stride": 64 }
```

- `instrument`: `vocal`, `guitar`, `bass`, `drums` or `keys`. The pack can take that slot in the band when it has `play.apng`.
- `stride`: logical px the walk covers per 0.75 s at 100% size, so the feet do not slide.

Cells: draw idle, walk and fall on a 192×256 cell with the feet 16 px above the bottom and the
body about 224 px tall; the pet shows that cell 176 px wide. `play.apng` keeps the same body
scale in a cell as wide as the instrument needs (up to 400 px).

Only use art you made or have the rights to.
