// App shell: home / new-pattern wizard / live editor.

import { compileChannel, evalRaw, evalValue, makeTestScope } from './math-engine.js';
import { Renderer2D } from './render2d.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'pil_patterns';
const CHANNEL_COLORS = { r: '#ff7a7a', g: '#7aff9c', b: '#7ab8ff' };
const CELL_NAMES = { square: 'squares', tri: 'triangles', circle: 'circles', hex: 'hexagons' };

// ---------- built-in examples ----------

const EXAMPLES = [
  {
    name: 'Pulse',
    config: { dim: '2d', nx: 20, ny: 20, cellType: 'square',
      eqs: { r: '(1+sin(t))/2', g: '(1+sin(t+2))/2', b: '(1+sin(t+4))/2' } },
  },
  {
    name: 'Ripples',
    config: { dim: '2d', nx: 40, ny: 40, cellType: 'circle',
      eqs: { r: '(1+sin(10r - 3t))/2', g: '(1+sin(10r - 3t + 2))/2', b: '(1+cos(10r - 3t))/2' } },
  },
  {
    name: 'Spiral',
    config: { dim: '2d', nx: 40, ny: 40, cellType: 'hex',
      eqs: { r: '(1+sin(3theta + 12r - 2t))/2', g: '(1+sin(3theta + 12r - 2t + 2))/2', b: '(1+sin(3theta + 12r - 2t + 4))/2' } },
  },
  {
    // a helper variable defines a radius whose center wanders over time
    name: 'Wandering ripple',
    config: { dim: '2d', nx: 40, ny: 40, cellType: 'square',
      vars: [{ name: 'u', expr: 'sqrt((x - sin(t)/3)^2 + (y + sin(2.1t)/3)^2)' }],
      eqs: { r: '(1+sin(12u - 3t))/2', g: '(1+sin(12u - 3t + 2))/2', b: '(1+sin(12u - 3t + 4))/2' } },
  },
  {
    // ripples whose centers are moved off the origin: build your own
    // shifted radius with sqrt((x-a)^2 + (y-b)^2)
    name: 'Shifted origin',
    config: { dim: '2d', nx: 40, ny: 40, cellType: 'square',
      eqs: {
        r: '(1+sin(12*sqrt((x-0.5)^2 + (y-0.5)^2) - 3t))/2',
        g: '(1+sin(12*sqrt((x+0.5)^2 + (y+0.5)^2) - 3t))/2',
        b: '(1+sin(10r + 2t))/2',
      } },
  },
  {
    name: 'Complex waves',
    config: { dim: '2d', nx: 68, ny: 40, cellType: 'tri',
      eqs: { r: '(1+Re(e^(i*(4x + 4y + 2t))))/2', g: '(1+Im(e^(i*(4x - 4y + 2t))))/2', b: '(1+Re(e^(i*(8x*y + t))))/2' } },
  },
  {
    name: '3D shells',
    config: { dim: '3d', n: 12,
      eqs: { r: '(1+sin(6rho - 2t))/2', g: '(1+sin(6rho - 2t + 2))/2', b: '(1+cos(4phi + t))/2' } },
  },
  {
    name: '3D waves',
    config: { dim: '3d', n: 12,
      eqs: { r: '(1+sin(3x + 2t))/2', g: '(1+sin(3y + 2t))/2', b: '(1+sin(3z + 2t))/2' } },
  },
];

// ---------- state ----------

let renderer = null;
let compiled = { r: null, g: null, b: null };
let compiledVars = []; // [{name, code}] in definition order
let currentConfig = null;
let playing = true;
let tBase = 0;          // t value when the clock was last (re)started
let wallStart = 0;      // performance.now() at (re)start, ms
let rafId = 0;
let gridOn = false;
let probe = null;       // { cell: index (2D) | {i,j,k} (3D), base: coordinate scope copy }
let galleryOrigin = null; // { forkOf: id } when the open pattern came from the gallery

// ---------- views ----------

function showView(name) {
  for (const v of ['home', 'wizard', 'editor']) $(`view-${v}`).hidden = v !== name;
  if (name !== 'editor' && renderer) {
    cancelAnimationFrame(rafId);
    renderer.dispose();
    renderer = null;
  }
  if (name === 'home') {
    renderSavedList();
    loadGallery();
  }
}

// ---------- home ----------

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveSaved(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function describe(config) {
  if (config.dim === '3d') return `3D · ${config.n}³`;
  return `2D · ${config.nx}×${config.ny} · ${CELL_NAMES[config.cellType] || 'squares'}`;
}

function patternItem(name, config, onDelete) {
  const li = document.createElement('li');
  const label = document.createElement('span');
  label.className = 'p-name';
  label.innerHTML = `${name} <span class="p-meta">${describe(config)}</span>`;
  label.addEventListener('click', () => openEditor(structuredClone(config), name));
  li.appendChild(label);
  if (onDelete) {
    const del = document.createElement('button');
    del.className = 'delete';
    del.textContent = '✕';
    del.addEventListener('click', onDelete);
    li.appendChild(del);
  }
  return li;
}

function renderSavedList() {
  const examples = $('examples-list');
  examples.replaceChildren(...EXAMPLES.map((ex) => patternItem(ex.name, ex.config)));

  const saved = loadSaved();
  $('saved-empty').hidden = saved.length > 0;
  $('saved-list').replaceChildren(...saved.map((p, idx) =>
    patternItem(p.name, p.config, () => {
      const list = loadSaved();
      list.splice(idx, 1);
      saveSaved(list);
      renderSavedList();
    })));
}

// ---------- gallery (public, server-backed) ----------

let galleryData = [];
let gallerySort = 'new';
const liked = new Set((() => {
  try { return JSON.parse(localStorage.getItem('pil_liked')) || []; }
  catch { return []; }
})());

async function loadGallery() {
  $('gallery-status').textContent = 'Loading…';
  try {
    const res = await fetch('/api/patterns');
    if (!res.ok) throw new Error();
    galleryData = await res.json();
    renderGallery();
  } catch {
    $('gallery-status').textContent = 'Gallery unavailable — is the server running?';
    $('gallery-list').replaceChildren();
  }
}

function renderGallery() {
  const list = [...galleryData];
  if (gallerySort === 'top') list.sort((a, b) => b.likes - a.likes || b.id - a.id);
  $('gallery-status').textContent = list.length ? '' : 'Nothing published yet — be the first!';
  $('gallery-list').replaceChildren(...list.map(galleryItem));
}

// Gallery names/descriptions come from other users: build DOM with
// textContent only, never innerHTML.
function galleryItem(p) {
  const li = document.createElement('li');
  li.className = 'gallery-item';

  const info = document.createElement('div');
  info.className = 'g-info';
  const nameEl = document.createElement('span');
  nameEl.className = 'p-name';
  nameEl.textContent = p.name;
  nameEl.addEventListener('click', () => openFromGallery(p, false));
  const meta = document.createElement('span');
  meta.className = 'p-meta';
  meta.textContent = ' ' + describe(p.config)
    + (p.forkedFromName ? ` · fork of ${p.forkedFromName}` : '');
  const desc = document.createElement('div');
  desc.className = 'g-desc';
  desc.textContent = p.description || '';
  info.append(nameEl, meta, desc);

  const actions = document.createElement('div');
  actions.className = 'g-actions';
  const likeBtn = document.createElement('button');
  likeBtn.textContent = `♥ ${p.likes}`;
  likeBtn.disabled = liked.has(p.id);
  likeBtn.title = likeBtn.disabled ? 'Already liked' : 'Like this pattern';
  likeBtn.addEventListener('click', () => likePattern(p, likeBtn));
  const forkBtn = document.createElement('button');
  forkBtn.textContent = 'Fork';
  forkBtn.title = 'Open an editable copy';
  forkBtn.addEventListener('click', () => openFromGallery(p, true));
  actions.append(likeBtn, forkBtn);

  li.append(info, actions);
  return li;
}

function openFromGallery(p, asFork) {
  openEditor(structuredClone(p.config), asFork ? `${p.name} (fork)` : p.name, null,
    { forkOf: p.id, description: p.description || '' });
}

async function likePattern(p, btn) {
  if (liked.has(p.id)) return;
  btn.disabled = true;
  try {
    const res = await fetch(`/api/patterns/${p.id}/like`, { method: 'POST' });
    if (!res.ok) throw new Error();
    const { likes } = await res.json();
    p.likes = likes;
    liked.add(p.id);
    localStorage.setItem('pil_liked', JSON.stringify([...liked]));
    btn.textContent = `♥ ${likes}`;
    btn.title = 'Already liked';
  } catch {
    btn.disabled = false;
  }
}

// ---------- wizard ----------

function wizardDim() {
  return document.querySelector('input[name="dim"]:checked').value;
}

function syncWizard() {
  const is3d = wizardDim() === '3d';
  $('grid-2d').hidden = is3d;
  $('grid-3d').hidden = !is3d;
  $('cell-shape').hidden = is3d;
}

function clampInt(value, lo, hi, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function configFromWizard() {
  const dim = wizardDim();
  const eqs = { r: '(1+sin(t))/2', g: '(1+sin(t+2))/2', b: '(1+sin(t+4))/2' };
  if (dim === '2d') {
    const cellType = document.querySelector('input[name="cellType"]:checked').value;
    const choice = document.querySelector('input[name="grid2d"]:checked').value;
    // Shaped cells draw one path per cell each frame, so cap them lower
    // than squares (which render via fast ImageData scaling).
    const maxSide = cellType === 'square' ? 256 : 96;
    let nx, ny;
    if (choice === 'custom') {
      nx = clampInt($('custom-nx').value, 2, maxSide, 40);
      ny = clampInt($('custom-ny').value, 2, maxSide, 40);
    } else {
      nx = ny = Number(choice);
    }
    return { dim, nx, ny, cellType, eqs };
  }
  const choice = document.querySelector('input[name="grid3d"]:checked').value;
  const n = choice === 'custom' ? clampInt($('custom-n3').value, 2, 32, 12) : Number(choice);
  return { dim, n, eqs };
}

// ---------- editor ----------

// Cartesian and polar/spherical variables are all available at once and
// can be mixed freely in one equation.
const VAR_DOCS = {
  '2d': '<p><b>Variables:</b> <code>t</code> seconds; cartesian <code>x</code>, <code>y</code> ∈ [-1, 1]; polar <code>r</code> ∈ [0, √2], <code>theta</code> ∈ (-π, π]. Mix them freely in one equation.</p>',
  '3d': '<p><b>Variables:</b> <code>t</code> seconds; cartesian <code>x</code>, <code>y</code>, <code>z</code> ∈ [-1, 1]; spherical <code>r</code> (or <code>rho</code>) ∈ [0, √3], <code>theta</code> azimuth, <code>phi</code> from +z. Mix them freely in one equation.</p>',
};

function currentT() {
  return playing ? tBase + (performance.now() - wallStart) / 1000 : tBase;
}

function setT(value) {
  tBase = value;
  wallStart = performance.now();
}

function setPlaying(next) {
  if (next && !playing) wallStart = performance.now();
  else if (!next && playing) tBase = currentT();
  playing = next;
  $('btn-play').textContent = playing ? 'Pause' : 'Play';
}

function setGrid(next) {
  gridOn = next;
  const btn = $('btn-grid');
  btn.textContent = gridOn ? 'Grid: on' : 'Grid: off';
  btn.setAttribute('aria-pressed', String(gridOn));
}

function renderTex(el, tex) {
  if (window.katex) {
    try { window.katex.render(tex, el, { throwOnError: false }); return; }
    catch { /* fall through to plain text */ }
  }
  el.textContent = tex;
}

function recompile(channel) {
  const input = $(`eq-${channel}`);
  const errEl = $(`err-${channel}`);
  try {
    compiled[channel] = compileChannel(input.value, makeTestScope(compiledVars));
    currentConfig.eqs[channel] = input.value;
    errEl.textContent = '';
    renderTex($(`tex-${channel}`), compiled[channel].tex);
  } catch (err) {
    errEl.textContent = String(err.message || err);
  }
}

// ----- user-defined helper variables -----

const RESERVED = new Set(['t', 'x', 'y', 'z', 'r', 'theta', 'rho', 'phi', 'pi', 'e', 'i', 'E', 'PI', 'tau', 'Re', 'Im']);

function addVarRow(text = '') {
  const row = document.createElement('div');
  row.className = 'var-row';
  const input = document.createElement('input');
  input.value = text;
  input.placeholder = 'u = sqrt((x-1/2)^2 + y^2)';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(refreshEquations, 300);
  });
  const del = document.createElement('button');
  del.className = 'delete';
  del.textContent = '✕';
  del.title = 'Remove variable';
  del.addEventListener('click', () => {
    row.remove();
    refreshEquations();
  });
  const err = document.createElement('div');
  err.className = 'err';
  const tex = document.createElement('div');
  tex.className = 'tex';
  row.append(input, del, err, tex);
  $('vars-list').appendChild(row);
  return input;
}

// Recompile the variable definitions in order (each may use the ones
// above it), then the R/G/B channels that depend on them.
function refreshEquations() {
  compiledVars = [];
  const validVars = [];
  const seen = new Set();
  for (const row of $('vars-list').children) {
    const input = row.querySelector('input');
    const errEl = row.querySelector('.err');
    const texEl = row.querySelector('.tex');
    const text = input.value.trim();
    if (!text) { errEl.textContent = ''; texEl.textContent = ''; continue; }
    try {
      const m = text.match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/s);
      if (!m) throw new Error('write it as: name = expression');
      const [, name, expr] = m;
      if (RESERVED.has(name)) throw new Error(`“${name}” is a built-in variable`);
      if (seen.has(name)) throw new Error(`“${name}” is already defined`);
      const code = compileChannel(expr, makeTestScope(compiledVars));
      seen.add(name);
      compiledVars.push({ name, code });
      validVars.push({ name, expr });
      errEl.textContent = '';
      renderTex(texEl, `${name} = ${code.tex}`);
    } catch (err) {
      errEl.textContent = String(err.message || err);
    }
  }
  if (validVars.length) currentConfig.vars = validVars;
  else delete currentConfig.vars;
  compiled.vars = compiledVars;
  for (const c of ['r', 'g', 'b']) recompile(c);
}

// ----- probing -----

function setProbe(cell) {
  const scope = renderer.scopeFor(cell);
  probe = { cell, base: { ...scope } };
  // show the snapped point in both coordinate systems
  $('in-x').value = scope.x.toFixed(3);
  $('in-y').value = scope.y.toFixed(3);
  $('in-theta').value = scope.theta.toFixed(3);
  if (currentConfig.dim === '3d') {
    $('in-z').value = scope.z.toFixed(3);
    $('in-r').value = scope.rho.toFixed(3);
    $('in-phi').value = scope.phi.toFixed(3);
  } else {
    $('in-r').value = scope.r.toFixed(3);
  }
  $('plot-panel').hidden = false;
  $('btn-probe-clear').hidden = false;
}

function clearProbe() {
  probe = null;
  for (const id of ['in-x', 'in-y', 'in-z', 'in-r', 'in-theta', 'in-phi']) $(id).value = '';
  $('plot-panel').hidden = true;
  $('btn-probe-clear').hidden = true;
}

function readInput(id, fallback) {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : fallback;
}

// Probe from typed cartesian coordinates (snapped to the nearest grid point).
function probeFromCartesianInputs() {
  if (!renderer) return;
  const x = readInput('in-x', probe ? probe.base.x : 0);
  const y = readInput('in-y', probe ? probe.base.y : 0);
  if (currentConfig.dim === '2d') {
    setProbe(renderer.cellFromCoords(x, y));
  } else {
    const z = readInput('in-z', probe ? probe.base.z : 0);
    setProbe(renderer.cellFromCoords(x, y, z));
  }
}

// Probe from typed polar/spherical coordinates: convert to cartesian, snap.
function probeFromPolarInputs() {
  if (!renderer) return;
  const theta = readInput('in-theta', probe ? probe.base.theta : 0);
  if (currentConfig.dim === '2d') {
    const r = readInput('in-r', probe ? probe.base.r : 0.5);
    setProbe(renderer.cellFromCoords(r * Math.cos(theta), r * Math.sin(theta)));
  } else {
    const r = readInput('in-r', probe ? probe.base.rho : 0.5);
    const phi = readInput('in-phi', probe ? probe.base.phi : Math.PI / 2);
    setProbe(renderer.cellFromCoords(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi),
    ));
  }
}

// ----- probe plot: channel intensities over t-5 .. t+5 at the probed cell -----

const PLOT_SAMPLES = 121;
const PLOT_HALF_SPAN = 5; // seconds either side of "now"

function plotBound(id, fallback) {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : fallback;
}

function drawPlot(tNow) {
  const canvas = $('plot');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round((canvas.clientWidth || 300) * dpr);
  const h = Math.round((canvas.clientHeight || 150) * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#05070b';
  ctx.fillRect(0, 0, w, h);

  const minLine = plotBound('plot-min', 0);
  const maxLine = plotBound('plot-max', 1);

  // Sample each channel; the y-range grows to keep out-of-bounds values visible.
  const t0 = tNow - PLOT_HALF_SPAN;
  const scope = { ...probe.base };
  const series = {};
  let lo = Math.min(minLine, maxLine);
  let hi = Math.max(minLine, maxLine);
  for (const c of ['r', 'g', 'b']) {
    if (!compiled[c]) continue;
    const arr = new Array(PLOT_SAMPLES);
    for (let s = 0; s < PLOT_SAMPLES; s++) {
      scope.t = t0 + (2 * PLOT_HALF_SPAN * s) / (PLOT_SAMPLES - 1);
      for (const uv of compiledVars) scope[uv.name] = evalValue(uv.code, scope);
      const v = evalRaw(compiled[c], scope);
      arr[s] = v;
      if (v != null) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    series[c] = arr;
  }
  if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const X = (s) => (s / (PLOT_SAMPLES - 1)) * w;
  const Y = (v) => h - ((v - lo) / (hi - lo)) * h;

  // min/max reference lines
  ctx.strokeStyle = '#8a93a8';
  ctx.lineWidth = dpr;
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  for (const v of [minLine, maxLine]) {
    ctx.beginPath();
    ctx.moveTo(0, Y(v));
    ctx.lineTo(w, Y(v));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = '#8a93a8';
  ctx.font = `${10 * dpr}px ui-monospace, monospace`;
  ctx.fillText(String(maxLine), 4 * dpr, Y(maxLine) - 3 * dpr);
  ctx.fillText(String(minLine), 4 * dpr, Y(minLine) + 11 * dpr);

  // "now" marker down the center
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();

  // channel curves (gaps where the value is undefined)
  ctx.lineWidth = 1.5 * dpr;
  for (const c of ['r', 'g', 'b']) {
    if (!series[c]) continue;
    ctx.strokeStyle = CHANNEL_COLORS[c];
    ctx.beginPath();
    let pen = false;
    for (let s = 0; s < PLOT_SAMPLES; s++) {
      const v = series[c][s];
      if (v == null) { pen = false; continue; }
      if (pen) ctx.lineTo(X(s), Y(v));
      else { ctx.moveTo(X(s), Y(v)); pen = true; }
    }
    ctx.stroke();
  }

  // time axis labels
  ctx.fillStyle = '#8a93a8';
  ctx.fillText(`t-${PLOT_HALF_SPAN}`, 4 * dpr, h - 4 * dpr);
  const nowLabel = `t=${tNow.toFixed(1)}`;
  ctx.fillText(nowLabel, w / 2 - ctx.measureText(nowLabel).width / 2, h - 4 * dpr);
  const endLabel = `t+${PLOT_HALF_SPAN}`;
  ctx.fillText(endLabel, w - ctx.measureText(endLabel).width - 4 * dpr, h - 4 * dpr);
}

// ----- editor lifecycle -----

// view (optional): { grid: bool, probe: cell, t: number } — restores the
// exact state a shared link was copied in.
// origin (optional): { forkOf: id, description } — set when the pattern was
// opened from the public gallery, so publishing records the fork lineage.
async function openEditor(config, name = '', view = null, origin = null) {
  currentConfig = config;
  galleryOrigin = origin ? { forkOf: origin.forkOf } : null;
  showView('editor');
  $('pattern-name').value = name;
  $('pattern-desc').value = origin?.description || '';
  $('editor-msg').textContent = '';
  $('help-vars').innerHTML = VAR_DOCS[config.dim] || '';
  $('wrap-z').hidden = config.dim !== '3d';
  $('wrap-phi').hidden = config.dim !== '3d';
  clearProbe();
  setGrid(false);

  const canvas = $('canvas2d');
  const container = $('container3d');
  canvas.hidden = config.dim !== '2d';
  container.hidden = config.dim !== '3d';

  if (renderer) renderer.dispose();
  if (config.dim === '2d') {
    renderer = new Renderer2D(canvas, config.nx, config.ny, config.cellType || 'square');
  } else {
    const { Renderer3D } = await import('./render3d.js'); // load three.js only when needed
    renderer = new Renderer3D(container, config.n);
  }

  compiled = { r: null, g: null, b: null };
  for (const c of ['r', 'g', 'b']) $(`eq-${c}`).value = config.eqs[c];
  $('vars-list').replaceChildren();
  for (const v of config.vars || []) addVarRow(`${v.name} = ${v.expr}`);
  refreshEquations();

  setT(0);
  setPlaying(true);

  if (view) {
    setGrid(!!view.grid);
    if (view.probe != null) {
      try { setProbe(view.probe); } catch { /* cell from a mismatched grid */ }
    }
    if (Number.isFinite(view.t)) setT(view.t);
  }

  cancelAnimationFrame(rafId);
  const frame = () => {
    if (!renderer) return;
    const t = currentT();
    const tInput = $('in-t');
    if (document.activeElement !== tInput) tInput.value = t.toFixed(2);
    // Probe visuals (highlight, r/theta indicator, 3D marker) only draw
    // with the grid on; grid off shows nothing but the pattern itself.
    const opts = { grid: gridOn };
    if (gridOn && probe) {
      if (currentConfig.dim === '2d') opts.highlight = probe.cell;
      else opts.probe = probe.base;
    }
    renderer.draw(compiled, t, opts);
    if (probe) drawPlot(t);
    rafId = requestAnimationFrame(frame);
  };
  frame();
}

// ---------- sharing ----------

function shareHash() {
  const payload = {
    name: $('pattern-name').value.trim(),
    config: currentConfig,
    view: {
      grid: gridOn,
      probe: probe ? probe.cell : null,
      t: Number(currentT().toFixed(2)),
    },
  };
  return '#p=' + encodeURIComponent(JSON.stringify(payload));
}

function tryOpenFromHash() {
  const match = location.hash.match(/^#p=(.+)$/);
  if (!match) return false;
  try {
    const { name, config, view } = JSON.parse(decodeURIComponent(match[1]));
    if (config && (config.dim === '2d' || config.dim === '3d') && config.eqs) {
      openEditor(config, name || '', view || null);
      return true;
    }
  } catch { /* bad link — fall through to home */ }
  return false;
}

// ---------- wire up ----------

$('home-link').addEventListener('click', () => { location.hash = ''; showView('home'); });
$('btn-new').addEventListener('click', () => { syncWizard(); showView('wizard'); });
$('btn-wizard-back').addEventListener('click', () => showView('home'));
$('btn-editor-back').addEventListener('click', () => { location.hash = ''; showView('home'); });

for (const radio of document.querySelectorAll('input[name="dim"]')) {
  radio.addEventListener('change', syncWizard);
}
// Typing in a custom-size box selects its "Custom" radio.
$('custom-nx').addEventListener('input', () => { document.querySelector('input[name="grid2d"][value="custom"]').checked = true; });
$('custom-ny').addEventListener('input', () => { document.querySelector('input[name="grid2d"][value="custom"]').checked = true; });
$('custom-n3').addEventListener('input', () => { document.querySelector('input[name="grid3d"][value="custom"]').checked = true; });

$('btn-create').addEventListener('click', () => openEditor(configFromWizard()));

$('btn-play').addEventListener('click', () => setPlaying(!playing));
$('btn-reset-t').addEventListener('click', () => setT(0));
$('btn-grid').addEventListener('click', () => setGrid(!gridOn));
$('btn-probe-clear').addEventListener('click', clearProbe);

// Tap or drag on the 2D canvas to probe a grid cell.
{
  const canvas = $('canvas2d');
  // On touch, probe above the contact point so the thumb doesn't hide
  // the highlighted cell; clamped so top-edge touches still work.
  const TOUCH_OFFSET = 48; // CSS px
  const probeFromPointer = (ev) => {
    if (!renderer || !currentConfig || currentConfig.dim !== '2d') return;
    let y = ev.clientY;
    if (ev.pointerType === 'touch') {
      const rect = canvas.getBoundingClientRect();
      y = Math.max(rect.top + 1, y - TOUCH_OFFSET);
    }
    const cell = renderer.cellAt(ev.clientX, y);
    if (cell != null) setProbe(cell);
  };
  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    probeFromPointer(ev);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (ev.buttons) probeFromPointer(ev);
  });
}

// Editable time and probe coordinates (commit on Enter or blur).
$('in-t').addEventListener('change', (ev) => {
  const v = parseFloat(ev.target.value);
  if (Number.isFinite(v)) setT(v);
});
for (const id of ['in-x', 'in-y', 'in-z']) {
  $(id).addEventListener('change', probeFromCartesianInputs);
}
for (const id of ['in-r', 'in-theta', 'in-phi']) {
  $(id).addEventListener('change', probeFromPolarInputs);
}
for (const id of ['in-t', 'in-x', 'in-y', 'in-z', 'in-r', 'in-theta', 'in-phi']) {
  $(id).addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') ev.target.blur();
  });
}

let debounce = 0;
for (const c of ['r', 'g', 'b']) {
  $(`eq-${c}`).addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => recompile(c), 250);
  });
}

$('btn-add-var').addEventListener('click', () => addVarRow('').focus());

$('btn-save').addEventListener('click', () => {
  const name = $('pattern-name').value.trim() || 'Untitled';
  const list = loadSaved();
  const existing = list.findIndex((p) => p.name === name);
  const entry = { name, config: structuredClone(currentConfig) };
  if (existing >= 0) list[existing] = entry;
  else list.push(entry);
  saveSaved(list);
  $('editor-msg').textContent = `Saved “${name}” on this device.`;
});

$('btn-publish').addEventListener('click', async () => {
  const name = $('pattern-name').value.trim();
  if (!name) {
    $('editor-msg').textContent = 'Give your pattern a name before publishing.';
    $('pattern-name').focus();
    return;
  }
  const btn = $('btn-publish');
  btn.disabled = true;
  try {
    const res = await fetch('/api/patterns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description: $('pattern-desc').value.trim(),
        config: currentConfig,
        forkOf: galleryOrigin ? galleryOrigin.forkOf : null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `server said ${res.status}`);
    }
    $('editor-msg').textContent = `Published “${name}” to the public gallery!`;
  } catch (err) {
    $('editor-msg').textContent = `Could not publish: ${err.message || err}`;
  } finally {
    btn.disabled = false;
  }
});

for (const [id, sort] of [['sort-new', 'new'], ['sort-top', 'top']]) {
  $(id).addEventListener('click', () => {
    gallerySort = sort;
    $('sort-new').classList.toggle('active', sort === 'new');
    $('sort-top').classList.toggle('active', sort === 'top');
    renderGallery();
  });
}

$('btn-share').addEventListener('click', async () => {
  const url = location.origin + location.pathname + shareHash();
  try {
    await navigator.clipboard.writeText(url);
    $('editor-msg').textContent = 'Link copied — it restores this pattern, grid, probe, and time.';
  } catch {
    $('editor-msg').textContent = url; // clipboard blocked: show the link instead
  }
});

window.addEventListener('resize', () => renderer && renderer.resize());

// ---------- start ----------

if (!tryOpenFromHash()) showView('home');
