# Web overlay (experimental)

The desktop pet, walking over a web page instead of the screen. One fixed layer
on top of the page; only the character's drawn pixels take the mouse, so the page
underneath keeps working.

```sh
npm ci
npm run build:overlay        # -> dist-overlay/ (overlay.js, overlay.css, packs/)
```

Serve `dist-overlay/` from the page's own origin (e.g. under `/omopet/`) and add
two tags to the page's `<head>`. A CSP of `script-src 'self'; style-src 'self'` is
enough: there is no inline script or style.

```html
<link rel="stylesheet" href="/omopet/overlay.css">
<script src="/omopet/overlay.js" defer></script>
```

Optional `data-*` on the script tag:

| attribute | default | meaning |
|---|---|---|
| `data-pack` | `omo` | first character (`omo`, `omo-cat`, `jabdori`) |
| `data-avoid` | `[data-ui="composer"], [data-omopet-avoid]` | elements the pet never covers; she may stand on top of them |
| `data-platforms` | `[data-omopet-platform]` | elements whose top edge she can land on |
| `data-size` | `0.75` (`0.55` under 600px) | scale against the desktop pet |
| `data-desktop` | `http://127.0.0.1:47838` | the desktop app's handoff listener; `off` keeps her in the page |

What she does: walk, sit on the corner at the viewport edge, rocket up and
parachute down, jet across the page. Click her for hearts, drag to carry her,
right-click (long-press on touch) to pick a character or hide her until the next
page load. The choice is kept in `localStorage`. With
`prefers-reduced-motion: reduce` she stands still.

## Handoff to the desktop app

When the desktop app runs on the same computer, she does not stop at the side of
the page: she walks on out and the desktop pet appears at that spot on screen,
same character, same direction, and carries on. Walk or drop the desktop pet back
into that browser page and the tab takes her again. Without the app she sits on
the corner as before.

- The app listens on `127.0.0.1:47838` only. It answers only `Origin`
  `https://kakao.cmore.dev`, `http://localhost[:port]` and `http://127.0.0.1[:port]`,
  and only `Host` `127.0.0.1:47838` / `localhost:47838`. Others get 403. Add another
  page in `ALLOWED_ORIGINS` (`src-tauri/src/web_handoff.rs`).
- The page's CSP must allow it: `connect-src 'self' http://127.0.0.1:47838`.
- On an https page Chrome may ask for local network access first (not yet tried
  on the live page).
- Screen position comes from `window.screenX/Y` and the outer/inner window size
  (page zoom included), so it holds across displays and Retina scales; a DevTools
  pane docked to the side throws it off.

Only the packs the app may ship go into the bundle: Omo (`omo-cat`, ours), OmO and
Jabdori (Sisyphus Labs, by permission; see `scripts/check-bundle.mjs`).
