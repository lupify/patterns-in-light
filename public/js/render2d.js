// 2D renderer: evaluates the R/G/B equations on a grid of cells and draws
// them on a canvas. Cell shapes: squares (fast ImageData path), triangles,
// circles, or hexagons (Path2D per cell).
//
// Cells are built in normalized layout space (u right, v down, both [0,1])
// and mapped to world coordinates x, y ∈ [-1, 1] (y up) for the equations.

import { evalIntensity } from './math-engine.js';

const SQRT3 = Math.sqrt(3);

function buildCells(nx, ny, type) {
  const cells = []; // { u, v, poly: [[u,v],...] } or { u, v, ellipse: {ru, rv} }
  if (type === 'square' || type === 'circle') {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const u = (i + 0.5) / nx;
        const v = (j + 0.5) / ny;
        if (type === 'circle') {
          cells.push({ u, v, ellipse: { ru: 0.46 / nx, rv: 0.46 / ny } });
        } else {
          cells.push({ u, v, poly: [[i / nx, j / ny], [(i + 1) / nx, j / ny], [(i + 1) / nx, (j + 1) / ny], [i / nx, (j + 1) / ny]] });
        }
      }
    }
  } else if (type === 'hex') {
    // Pointy-top hexagons, odd rows offset half a cell. Uniform scale keeps
    // the hexagons regular; the grid is centered, letterboxed if needed.
    const W = SQRT3 * (nx + 0.5);
    const H = 1.5 * ny + 0.5;
    const s = 1 / Math.max(W, H);
    const ox = (1 - W * s) / 2;
    const oy = (1 - H * s) / 2;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const cx = SQRT3 * (i + 0.5 + (j % 2) * 0.5);
        const cy = 1 + 1.5 * j;
        const poly = [];
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k + Math.PI / 6;
          poly.push([ox + (cx + Math.cos(a)) * s, oy + (cy + Math.sin(a)) * s]);
        }
        cells.push({ u: ox + cx * s, v: oy + cy * s, poly });
      }
    }
  } else { // 'tri': alternating up/down triangles, nx per row
    // Uniform scale keeps the triangles equilateral; the grid is centered,
    // letterboxed if needed. nx ≈ √3·ny fills the square (e.g. 68×40).
    const h = SQRT3 / 2;
    const W = (nx + 1) / 2;
    const H = ny * h;
    const s = 1 / Math.max(W, H);
    const ox = (1 - W * s) / 2;
    const oy = (1 - H * s) / 2;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x0 = i / 2;
        const up = (i + j) % 2 === 0; // apex toward the top of the canvas
        const yT = j * h;
        const yB = (j + 1) * h;
        const poly = up
          ? [[x0, yB], [x0 + 1, yB], [x0 + 0.5, yT]]
          : [[x0, yT], [x0 + 1, yT], [x0 + 0.5, yB]];
        cells.push({
          u: ox + (x0 + 0.5) * s,
          v: oy + (yT + (up ? (2 * h) / 3 : h / 3)) * s, // centroid
          poly: poly.map(([X, Y]) => [ox + X * s, oy + Y * s]),
        });
      }
    }
  }
  return cells;
}

export class Renderer2D {
  constructor(canvas, nx, ny, cellType = 'square') {
    this.canvas = canvas;
    this.nx = nx;
    this.ny = ny;
    this.cellType = cellType;
    this.ctx = canvas.getContext('2d');
    this.cells = buildCells(nx, ny, cellType);
    this.scopes = this.cells.map((c) => {
      const x = 2 * c.u - 1;
      const y = 1 - 2 * c.v;
      return { t: 0, x, y, r: Math.hypot(x, y), theta: Math.atan2(y, x) };
    });

    // Squares render at grid resolution and scale up — much faster,
    // and it keeps large custom grids viable.
    this.fast = cellType === 'square';
    if (this.fast) {
      this.off = document.createElement('canvas');
      this.off.width = nx;
      this.off.height = ny;
      this.offCtx = this.off.getContext('2d');
      this.image = this.offCtx.createImageData(nx, ny);
    }
    this.resize();
  }

  resize() {
    const size = this.canvas.clientWidth || 512;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = size * this.dpr;
    this.canvas.height = size * this.dpr;
    if (!this.fast) this.buildPaths();
  }

  buildPaths() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.paths = this.cells.map((c) => {
      const p = new Path2D();
      if (c.ellipse) {
        p.ellipse(c.u * W, c.v * H, c.ellipse.ru * W, c.ellipse.rv * H, 0, 0, 2 * Math.PI);
      } else {
        c.poly.forEach(([u, v], k) => (k ? p.lineTo(u * W, v * H) : p.moveTo(u * W, v * H)));
        p.closePath();
      }
      return p;
    });
  }

  // fns = {r, g, b} compiled expressions (any may be null → channel off)
  // opts: { grid: bool, highlight: cell index | null }
  draw(fns, t, opts = {}) {
    if (this.fast) this.drawFast(fns, t, opts);
    else this.drawPaths(fns, t, opts);
  }

  drawFast(fns, t, opts) {
    const { nx, ny, scopes, image, ctx } = this;
    const data = image.data;
    for (let idx = 0; idx < scopes.length; idx++) {
      const scope = scopes[idx];
      scope.t = t;
      const p = idx * 4;
      data[p] = fns.r ? evalIntensity(fns.r, scope) * 255 : 0;
      data[p + 1] = fns.g ? evalIntensity(fns.g, scope) * 255 : 0;
      data[p + 2] = fns.b ? evalIntensity(fns.b, scope) * 255 : 0;
      data[p + 3] = 255;
    }
    this.offCtx.putImageData(image, 0, 0);
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, 0, 0, nx, ny, 0, 0, W, H);

    if (opts.grid) {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = Math.max(1, this.dpr);
      ctx.beginPath();
      for (let i = 0; i <= nx; i++) {
        const px = Math.round((i * W) / nx) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, H);
      }
      for (let j = 0; j <= ny; j++) {
        const py = Math.round((j * H) / ny) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(W, py);
      }
      ctx.stroke();
    }

    if (opts.highlight != null) {
      // black halo + white inner outline stays visible on any cell color
      const i = opts.highlight % nx;
      const j = Math.floor(opts.highlight / nx);
      const cw = W / nx;
      const ch = H / ny;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 4 * this.dpr;
      ctx.strokeRect(i * cw, j * ch, cw, ch);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 * this.dpr;
      ctx.strokeRect(i * cw, j * ch, cw, ch);
    }
  }

  drawPaths(fns, t, opts) {
    const { ctx, scopes, paths } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (let idx = 0; idx < scopes.length; idx++) {
      const scope = scopes[idx];
      scope.t = t;
      const R = fns.r ? (evalIntensity(fns.r, scope) * 255) | 0 : 0;
      const G = fns.g ? (evalIntensity(fns.g, scope) * 255) | 0 : 0;
      const B = fns.b ? (evalIntensity(fns.b, scope) * 255) | 0 : 0;
      ctx.fillStyle = `rgb(${R},${G},${B})`;
      ctx.fill(paths[idx]);
    }
    if (opts.grid) {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = Math.max(1, this.dpr);
      for (const p of paths) ctx.stroke(p);
    }
    if (opts.highlight != null) {
      const p = paths[opts.highlight];
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 4 * this.dpr;
      ctx.stroke(p);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 * this.dpr;
      ctx.stroke(p);
    }
  }

  // Index of the cell under a pointer event, or null if outside the canvas.
  cellAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const fu = (clientX - rect.left) / rect.width;
    const fv = (clientY - rect.top) / rect.height;
    if (fu < 0 || fu >= 1 || fv < 0 || fv >= 1) return null;
    if (this.fast) return Math.floor(fv * this.ny) * this.nx + Math.floor(fu * this.nx);
    const px = fu * this.canvas.width;
    const py = fv * this.canvas.height;
    for (let idx = 0; idx < this.paths.length; idx++) {
      if (this.ctx.isPointInPath(this.paths[idx], px, py)) return idx;
    }
    return this.nearest(fu, fv); // e.g. the gap between circles
  }

  nearest(fu, fv) {
    let best = 0;
    let bd = Infinity;
    for (let idx = 0; idx < this.cells.length; idx++) {
      const c = this.cells[idx];
      const d = (c.u - fu) ** 2 + (c.v - fv) ** 2;
      if (d < bd) { bd = d; best = idx; }
    }
    return best;
  }

  // Index of the cell nearest to world coordinates (x, y ∈ [-1, 1]).
  cellFromCoords(x, y) {
    return this.nearest((x + 1) / 2, (1 - y) / 2);
  }

  scopeFor(idx) {
    return this.scopes[idx];
  }

  dispose() {}
}
