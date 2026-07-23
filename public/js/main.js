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

function setFullscreen(on) {
  $('stage').classList.toggle('fullscreen', on);
  $('btn-fullscreen').textContent = on ? '✕' : '⛶';
  $('btn-fullscreen').title = on ? 'Exit fullscreen' : 'Fullscreen';
  if (renderer) renderer.resize();
}

function showView(name) {
  if (name !== 'editor') setFullscreen(false);
  for (const v of ['home', 'wizard', 'editor']) $(`view-${v}`).hidden = v !== name;
  if (name !== 'editor' && renderer) {
    cancelAnimationFrame(rafId);
    renderer.dispose();
    renderer = null;
  }
  if (name === 'home') {
    renderSavedList();
    if (!$('tab-gallery').hidden) loadGallery();
  }
}

function setHomeTab(tab) {
  for (const b of document.querySelectorAll('#home-tabs button')) {
    b.classList.toggle('active', b.dataset.tab === tab);
  }
  for (const t of ['mine', 'examples', 'gallery']) $(`tab-${t}`).hidden = t !== tab;
  if (tab === 'gallery') loadGallery();
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
  likeBtn.classList.toggle('liked', liked.has(p.id));
  likeBtn.title = liked.has(p.id) ? 'Unlike' : 'Like this pattern';
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

// Toggles: like on first press, unlike on the next.
async function likePattern(p, btn) {
  const unlike = liked.has(p.id);
  btn.disabled = true;
  try {
    const res = await fetch(`/api/patterns/${p.id}/like`, { method: unlike ? 'DELETE' : 'POST' });
    if (!res.ok) throw new Error();
    const { likes } = await res.json();
    p.likes = likes;
    if (unlike) liked.delete(p.id);
    else liked.add(p.id);
    localStorage.setItem('pil_liked', JSON.stringify([...liked]));
    btn.textContent = `♥ ${likes}`;
    btn.classList.toggle('liked', !unlike);
    btn.title = unlike ? 'Like this pattern' : 'Unlike';
  } catch { /* leave the button as it was */ }
  finally {
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
  plotLo = plotHi = null; // new cell → fresh plot autoscale
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
  plotLo = plotHi = null;
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

const PLOT_SAMPLES = 200;
const PLOT_HALF_SPAN = 5; // seconds either side of "now"
let plotLo = null; // eased y-range so autoscaling doesn't twitch
let plotHi = null;

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

  // Sample on a fixed absolute time grid (not relative to tNow), so each
  // peak keeps its exact value from frame to frame and the curve slides
  // smoothly instead of shimmering.
  const span = 2 * PLOT_HALF_SPAN;
  const dt = span / PLOT_SAMPLES;
  const windowStart = tNow - PLOT_HALF_SPAN;
  const tStart = Math.floor(windowStart / dt) * dt;
  const count = PLOT_SAMPLES + 2; // cover both edges of the window
  const scope = { ...probe.base };
  const series = {};
  const times = new Array(count);
  let lo = Math.min(minLine, maxLine);
  let hi = Math.max(minLine, maxLine);
  for (const c of ['r', 'g', 'b']) {
    if (!compiled[c]) continue;
    const arr = new Array(count);
    for (let s = 0; s < count; s++) {
      const ts = tStart + s * dt;
      times[s] = ts;
      scope.t = ts;
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
  const rangePad = (hi - lo) * 0.08;
  lo -= rangePad;
  hi += rangePad;
  // ease the displayed range toward the target instead of jumping
  if (plotLo == null) { plotLo = lo; plotHi = hi; }
  else {
    plotLo += (lo - plotLo) * 0.2;
    plotHi += (hi - plotHi) * 0.2;
  }
  const X = (s) => ((times[s] - windowStart) / span) * w;
  const Y = (v) => h - ((v - plotLo) / (plotHi - plotLo)) * h;

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
    for (let s = 0; s < count; s++) {
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
  frameLoop();
}

function frameLoop() {
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
  rafId = requestAnimationFrame(frameLoop);
}

// ---------- clip export (video preferred, GIF fallback) ----------

const CLIP_SECONDS = 10;
const CLIP_SIZE = 720; // pattern area for video export
const GIF_SIZE = 720;  // pattern area for GIF export
const GIF_FPS = 10;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

// MathJax renders LaTeX to self-contained SVG (glyph paths, no fonts)
// that can be drawn onto a canvas. Loaded on demand at first export.
async function ensureMathJax() {
  if (window.MathJax && window.MathJax.tex2svg) return;
  window.MathJax = { svg: { fontCache: 'none' }, startup: { typeset: false } };
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-svg.js');
  await window.MathJax.startup.promise;
}

// gifenc encodes frame-by-frame (no big frame buffer), so high-res GIFs
// stay within memory limits. Loaded as an ES module on first use.
let gifenc = null;

async function ensureGifenc() {
  if (!gifenc) gifenc = await import('https://unpkg.com/gifenc@1.0.3/dist/gifenc.esm.js');
}

async function texToImage(tex) {
  const svg = window.MathJax.tex2svg(tex, { display: true }).querySelector('svg');
  svg.setAttribute('color', '#ffffff'); // paths use currentColor
  const scale = 16; // px per ex: render large, downscale for crispness
  svg.setAttribute('width', `${parseFloat(svg.getAttribute('width')) * scale}px`);
  svg.setAttribute('height', `${parseFloat(svg.getAttribute('height')) * scale}px`);
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('equation render failed'));
    img.src = 'data:image/svg+xml;charset=utf-8,'
      + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  });
  return img;
}

// One static canvas with every equation line, reused under all frames.
// Line height scales with the export width so the math stays legible.
async function renderClipFooter(lines, width) {
  const lineH = Math.round(width / 11);
  const pad = Math.round(width / 36);
  const gap = Math.round(lineH * 0.15);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = pad * 2 + lines.length * (lineH + gap) - gap;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = pad;
  for (const line of lines) {
    const img = await texToImage(line);
    const s = Math.min(lineH / img.height, (width - pad * 2) / img.width);
    ctx.drawImage(img, pad, y + (lineH - img.height * s) / 2, img.width * s, img.height * s);
    y += lineH + gap;
  }
  return canvas;
}

// Compose canvas (pattern on top, equations below) shared by both formats.
async function prepareCompose(width) {
  const lines = [];
  for (const c of ['r', 'g', 'b']) {
    if (compiled[c]) lines.push(`${c.toUpperCase()} = ${compiled[c].tex}`);
  }
  for (const v of compiledVars) lines.push(`${v.name} = ${v.code.tex}`);
  const footer = await renderClipFooter(lines, width);
  const compose = document.createElement('canvas');
  compose.width = width;
  compose.height = width + footer.height;
  return {
    compose,
    cctx: compose.getContext('2d'),
    footer,
    W: width,
    H: width + footer.height,
    src: currentConfig.dim === '2d' ? $('canvas2d') : renderer.renderer.domElement,
  };
}

function drawComposeFrame(setup, t) {
  renderer.draw(compiled, t, {}); // clean: no grid/overlays
  setup.cctx.fillStyle = '#000';
  setup.cctx.fillRect(0, 0, setup.W, setup.H);
  setup.cctx.drawImage(setup.src, 0, 0, setup.W, setup.W);
  setup.cctx.drawImage(setup.footer, 0, setup.W);
}

function saveBlob(blob, ext) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${$('pattern-name').value.trim() || 'pattern'}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  $('editor-msg').textContent =
    `Saved ${a.download} (${(blob.size / 1e6).toFixed(1)} MB).`;
}

function pickClipMime() {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
    .find((m) => MediaRecorder.isTypeSupported(m)) || null;
}

// Records in real time (10 s wall clock) via the browser's native encoder.
async function recordVideo(mime) {
  const msg = $('editor-msg');
  const setup = await prepareCompose(CLIP_SIZE);
  const stream = setup.compose.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve) => { rec.onstop = resolve; });
  const t0 = currentT();
  rec.start(1000);
  const start = performance.now();
  await new Promise((resolve) => {
    const step = () => {
      const elapsed = (performance.now() - start) / 1000;
      if (elapsed >= CLIP_SECONDS) { resolve(); return; }
      drawComposeFrame(setup, t0 + elapsed);
      msg.textContent = `Recording… ${elapsed.toFixed(1)} / ${CLIP_SECONDS}s`;
      requestAnimationFrame(step);
    };
    step();
  });
  rec.stop();
  await stopped;
  saveBlob(new Blob(chunks, { type: mime }), mime.includes('mp4') ? 'mp4' : 'webm');
}

// Each frame is drawn, quantized to a 256-color palette, and written to
// the GIF immediately — memory stays flat even at high resolution.
async function recordGif() {
  const msg = $('editor-msg');
  await ensureGifenc();
  const setup = await prepareCompose(GIF_SIZE);
  const { GIFEncoder, quantize, applyPalette } = gifenc;
  const gif = GIFEncoder();
  const frames = CLIP_SECONDS * GIF_FPS;
  const t0 = currentT();
  for (let f = 0; f < frames; f++) {
    drawComposeFrame(setup, t0 + f / GIF_FPS);
    const { data } = setup.cctx.getImageData(0, 0, setup.W, setup.H);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, setup.W, setup.H, { palette, delay: 1000 / GIF_FPS });
    msg.textContent = `Encoding GIF… ${f + 1}/${frames}`;
    await new Promise((r) => setTimeout(r)); // let the UI breathe
  }
  gif.finish();
  saveBlob(new Blob([gif.bytes()], { type: 'image/gif' }), 'gif');
}

// Shared wrapper: disables the export buttons, loads the math renderer,
// borrows the live canvas for capture, and always resumes the view.
async function runExport(job) {
  if (!renderer || !currentConfig) return;
  const buttons = [$('btn-gif'), $('btn-webm')];
  for (const b of buttons) b.disabled = true;
  const msg = $('editor-msg');
  try {
    msg.textContent = 'Rendering equations…';
    await ensureMathJax();
    cancelAnimationFrame(rafId);
    await job();
  } catch (err) {
    msg.textContent = `Export failed: ${err.message || err}`;
  } finally {
    for (const b of buttons) b.disabled = false;
    cancelAnimationFrame(rafId);
    if (renderer) frameLoop(); // resume the live view
  }
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

$('home-link').addEventListener('click', () => { location.hash = ''; showView('home'); setHomeTab('mine'); });
$('btn-home').addEventListener('click', () => { location.hash = ''; showView('home'); setHomeTab('mine'); });
$('btn-gallery').addEventListener('click', () => {
  location.hash = '';
  showView('home');
  setHomeTab('gallery');
});
for (const b of document.querySelectorAll('#home-tabs button')) {
  b.addEventListener('click', () => setHomeTab(b.dataset.tab));
}
$('btn-help').addEventListener('click', () => { $('help-modal').hidden = false; });
$('btn-help-close').addEventListener('click', () => { $('help-modal').hidden = true; });
$('help-modal').addEventListener('click', (ev) => {
  if (ev.target === $('help-modal')) $('help-modal').hidden = true; // tap outside closes
});
$('btn-fullscreen').addEventListener('click', () =>
  setFullscreen(!$('stage').classList.contains('fullscreen')));
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
$('btn-gif').addEventListener('click', () => runExport(recordGif));
$('btn-webm').addEventListener('click', () => runExport(async () => {
  const mime = pickClipMime();
  if (!mime) throw new Error('video recording not supported in this browser — try GIF');
  await recordVideo(mime);
}));
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

// Drag the plot (finger or mouse) to scrub time: pulling the curve to the
// right rewinds, pulling left advances — like sliding a timeline strip.
{
  const plot = $('plot');
  let dragging = false;
  let lastX = 0;
  plot.addEventListener('pointerdown', (ev) => {
    if (!probe) return;
    dragging = true;
    lastX = ev.clientX;
    plot.setPointerCapture(ev.pointerId);
  });
  plot.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const dx = ev.clientX - lastX;
    lastX = ev.clientX;
    const width = plot.clientWidth || 300;
    setT(currentT() - (dx * 2 * PLOT_HALF_SPAN) / width);
  });
  const stop = () => { dragging = false; };
  plot.addEventListener('pointerup', stop);
  plot.addEventListener('pointercancel', stop);
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
