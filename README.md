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

## Sharing

**Copy link** encodes everything in the URL — the equations, grid size and cell
shape, grid-lines toggle, probed point, and current time — so pasting the link
restores the exact same view. Saving stores the pattern in the browser's
localStorage instead.

Standard math notation is supported via [math.js](https://mathjs.org): `sin`,
`cos`, `exp`, `e^x`, `sqrt`, `abs`, `atan2`, constants `pi`, `e`, and the
imaginary unit `i`. Complex numbers work throughout; use `Re(...)` or `Im(...)`
to map a complex value to a real intensity (a bare complex result uses its real
part).

Patterns can be saved on-device (localStorage) and shared as URLs (the whole
pattern is encoded in the link — great for sharing solutions with a class).

## Run locally

No dependencies to install:

```
node server.js        # or: npm start
```

Then open http://localhost:3000. (Any static file server pointed at `public/`
also works.)

## Deploy on Render

The repo includes a `render.yaml` blueprint that deploys `public/` as a free
static site:

1. Push this repo to GitHub (or GitLab).
2. On [render.com](https://render.com): **New → Blueprint**, pick the repo, and
   accept the defaults — Render reads `render.yaml` and publishes the site.

Or without the blueprint: **New → Static Site**, pick the repo, leave the build
command empty, and set the publish directory to `public`.

Every push to the default branch redeploys automatically.

## Project layout

```
public/
  index.html          three views: home, new-pattern wizard, editor
  style.css
  js/main.js          app shell, saving, URL sharing, examples
  js/math-engine.js   math.js wrapper: compile expressions, complex → [0,1]
  js/render2d.js      canvas pixel-grid renderer
  js/render3d.js      three.js point-grid renderer (orbit/pinch to rotate)
server.js             zero-dependency static server for local dev
render.yaml           Render static-site blueprint
```
