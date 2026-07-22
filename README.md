# Patterns in Light

A lightweight teaching website: write math equations, watch them become animated
light patterns on a 2D or 3D grid of pixels — live, on any phone or laptop.

Students create a pattern (2D or 3D, grid size of their choice — default
40×40 — with square, triangular, circle, or hexagonal cells in 2D) and type
plain-text expressions for the red, green, and blue intensity of every cell:

```
R = (1+sin(t))/2
G = (1+sin(10r - 3t))/2
B = (1+Re(e^(i*(5x + t))))/2
```

Each channel is a function of time `t` and the cell's coordinates, evaluated to
an intensity in `[0, 1]` (clamped) every animation frame.

## Available variables

| Dimension | Variables |
|---|---|
| 2D | `t`, `x`, `y` ∈ [-1, 1], polar `r` ∈ [0, √2], `theta` ∈ (-π, π] |
| 3D | `t`, `x`, `y`, `z` ∈ [-1, 1], spherical `r` (alias `rho`), `theta` (azimuth), `phi` (angle from +z) |

Cartesian and polar/spherical variables are all available at the same time and
can be mixed freely in one equation (e.g. `sin(5x + 3theta - t)`).

## Probing points

Tap a cell on a 2D grid (or type coordinates — they snap to the nearest grid
point) to highlight it; its position is shown in both cartesian and
polar/spherical form, and both sets of inputs are editable — type `x`/`y`/`z`
or `r`/`θ`/`φ` and the probe jumps to the nearest matching grid point. The panel next to the R/G/B equations then plots each
channel's raw value at that point from `t−5` to `t+5` seconds, with adjustable
min/max reference lines (default 0 and 1); values outside the lines stay
visible. `t` is editable too, so you can scrub to an exact moment. The Grid
button toggles cell-boundary lines (a bounding box in 3D).

## Sharing & the public gallery

Three ways to share:

- **Copy link** encodes everything in the URL — equations, grid size and cell
  shape, grid-lines toggle, probed point, and current time — so pasting the
  link restores the exact same view. No server involved.
- **Save on device** stores the pattern in the browser's localStorage.
- **Publish to gallery** posts the pattern (with a title and a brief
  description) to the public gallery on the home page, where anyone can open
  it, **♥ like** it, or **fork** it into an editable copy. Published forks
  show their lineage ("fork of …"). Likes are once-per-browser.

Standard math notation is supported via [math.js](https://mathjs.org): `sin`,
`cos`, `exp`, `e^x`, `sqrt`, `abs`, `atan2`, constants `pi`, `e`, and the
imaginary unit `i`. Complex numbers work throughout; use `Re(...)` or `Im(...)`
to map a complex value to a real intensity (a bare complex result uses its real
part).

## Gallery API

The Node server (`server.js`) serves the static app plus:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/patterns` | GET | list patterns (newest first, max 200) |
| `/api/patterns` | POST | publish `{name, description, config, forkOf?}` |
| `/api/patterns/:id/like` | POST | increment a pattern's likes |

Configs are re-validated and rebuilt server-side (bounded grid sizes, known
cell types, equation length caps) so only well-formed patterns are stored.

Storage: Postgres when `DATABASE_URL` is set (as on Render), otherwise a JSON
file in `data/` — local development needs no database and no `npm install`
(the `pg` package is only imported when a database is configured).

## Run locally

```
node server.js        # or: npm start
```

Then open http://localhost:3000. Gallery data lands in `data/patterns.json`
(gitignored).

## Deploy on Render

The repo's `render.yaml` blueprint provisions a Node **web service** plus a
**Postgres database**, wired together via `DATABASE_URL`:

1. Push this repo to GitHub (or GitLab).
2. On [render.com](https://render.com): **New → Blueprint**, pick the repo, and
   accept the defaults.

Every push to the default branch redeploys automatically. Two free-tier
caveats: the web service spins down after ~15 idle minutes (the first visitor
then waits ~30–60 s; the paid starter instance stays warm), and Render's free
Postgres databases expire after 30 days — upgrade the database to a paid plan
when the gallery matters.

## Project layout

```
public/
  index.html          three views: home (incl. gallery), wizard, editor
  style.css
  js/main.js          app shell, gallery, publish/like/fork, URL sharing
  js/math-engine.js   math.js wrapper: compile expressions, complex → [0,1]
  js/render2d.js      canvas cell-grid renderer (squares/tris/circles/hexes)
  js/render3d.js      three.js point-grid renderer (orbit/pinch to rotate)
server.js             web service: static files + gallery JSON API
render.yaml           Render blueprint: web service + Postgres
```
