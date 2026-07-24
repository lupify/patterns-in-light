// "Vision" tab: how eyes and instruments each see a slice of light.
// Biological eyes/organs first (zoomed into the visible band), then the
// non-biological detectors on the full electromagnetic spectrum, with a
// magnifier connector and guide lines tying the two together.
//
// All class names are sv- prefixed and ids sv-* so nothing collides with
// the pattern editor. Rendered once, on first visit to the tab.

// ---------- wavelength → colour ----------
function visRGB(wl) {
  let r = 0, g = 0, b = 0;
  if (wl >= 380 && wl < 440) { r = -(wl - 440) / 60; g = 0; b = 1; }
  else if (wl < 490) { r = 0; g = (wl - 440) / 50; b = 1; }
  else if (wl < 510) { r = 0; g = 1; b = -(wl - 510) / 20; }
  else if (wl < 580) { r = (wl - 510) / 70; g = 1; b = 0; }
  else if (wl < 645) { r = 1; g = -(wl - 645) / 65; b = 0; }
  else if (wl <= 750) { r = 1; g = 0; b = 0; }
  let f = 1;
  if (wl < 420) f = 0.3 + 0.7 * (wl - 380) / 40;
  else if (wl > 700) f = 0.3 + 0.7 * (750 - wl) / 50;
  const adj = (v) => Math.round(255 * Math.pow(Math.max(0, v) * f, 0.8));
  return [adj(r), adj(g), adj(b)];
}
function nmColor(wl) {
  if (wl >= 380 && wl <= 750) { const [r, g, b] = visRGB(wl); return `rgb(${r},${g},${b})`; }
  if (wl < 380) { // UV: violet fading to dark
    const t = Math.max(0, (wl - 200) / 180);
    return `rgb(${Math.round(60 + 80 * t)},${Math.round(10 + 20 * t)},${Math.round(90 + 120 * t)})`;
  }
  const t = Math.max(0, Math.min(1, (wl - 750) / 450)); // IR: deep red → near-black
  return `rgb(${Math.round(150 * (1 - t) + 30 * t)},${Math.round(20 * (1 - t))},${Math.round(20 * (1 - t))})`;
}
function nmGradient(lo, hi, step = 6) {
  const stops = [];
  for (let w = lo; w <= hi; w += step) stops.push(`${nmColor(w)} ${(((w - lo) / (hi - lo)) * 100).toFixed(1)}%`);
  return `linear-gradient(90deg, ${stops.join(',')})`;
}

// ---------- scales ----------
const A_LEFT = Math.log10(1e3), A_RIGHT = Math.log10(1e-12), A_SPAN = A_LEFT - A_RIGHT;
// Short wavelength on the LEFT, long on the RIGHT — matches the nm axis of
// the biological panel: 0 at 1e-12 m (gamma, left) → 1 at 1e3 m (radio, right).
const aFrac = (m) => (Math.log10(m) - A_RIGHT) / A_SPAN;
const B_LO = 280, B_HI = 760, bFrac = (nm) => (nm - B_LO) / (B_HI - B_LO);
const mColor = (m) => nmColor(m * 1e9);
function mGradient(lo, hi) {
  const stops = []; const l0 = Math.log10(hi), l1 = Math.log10(lo), n = 12;
  for (let i = 0; i <= n; i++) {
    const m = Math.pow(10, l0 + (l1 - l0) * i / n);
    const p = (aFrac(hi) === aFrac(lo)) ? 0 : ((aFrac(m) - aFrac(lo)) / (aFrac(hi) - aFrac(lo))) * 100;
    stops.push(`${mColor(m)} ${p.toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(',')})`;
}

// ---------- data ----------
const coneColors = ['#4a7cff', '#39d353', '#ff5a5a', '#c39bff', '#ffb14a', '#4ad6d6'];

// Biological eyes & organs (nm). cones = distinct photoreceptor types.
// Humans first; isHuman drives the gold label.
const animals = [
  { name: 'Human (normal)', tag: 'trichromat', min: 380, max: 700, cones: '3', conesN: 3, note: 'Typical human colour vision: three cones (blue, green, red) blend into every colour we know.', human: true, isHuman: true },
  { name: 'Human (tetrachromat)', tag: 'rare 4th cone', min: 380, max: 700, cones: '4', conesN: 4, note: 'A rare extra cone gives finer discrimination among reds and oranges.', isHuman: true },
  { name: 'Human (colour-blind)', tag: 'dichromat', min: 400, max: 700, cones: '2', conesN: 2, note: 'A missing or shifted cone (e.g. red–green colour blindness) collapses part of colour space.', isHuman: true },
  { name: 'Mantis shrimp', min: 300, max: 720, cones: '12–16', conesN: 16, note: 'Up to 16 photoreceptor types spanning UV to deep red — the most of any known animal.' },
  { name: 'Bird', tag: 'e.g. songbird', min: 300, max: 700, cones: '4', conesN: 4, note: 'Tetrachromat with UV vision and coloured oil-droplet filters; sees plumage patterns invisible to us.' },
  { name: 'Butterfly', tag: 'Papilio', min: 300, max: 700, cones: '6–9', conesN: 6, note: 'Some butterflies have six or more receptor classes, rich in the UV and violet.' },
  { name: 'Goldfish', min: 340, max: 700, cones: '4', conesN: 4, note: 'Tetrachromat — sees ultraviolet as well as our red-to-violet range.' },
  { name: 'Bee', min: 300, max: 650, cones: '3', conesN: 3, note: 'Trichromat shifted into the UV: sees ultraviolet nectar guides but is blind to red.' },
  { name: 'Jumping spider', min: 330, max: 600, cones: '4', conesN: 4, note: 'Principal eyes combine UV and green receptors with a layered retina for colour and depth.' },
  { name: 'Reindeer', min: 320, max: 700, cones: '3', conesN: 3, note: 'A UV-transmitting eye reveals lichen and predators against Arctic snow.' },
  { name: 'Dog', min: 430, max: 620, cones: '2', conesN: 2, note: 'Dichromat — sees blues and yellows but confuses red and green, like red–green colour blindness.' },
  { name: 'Cat', min: 450, max: 650, cones: '2', conesN: 2, note: 'Dichromat with a narrower range; built for dim light and motion more than colour.' },
  { name: 'Pit viper', tag: 'heat pits', min: 5000, max: 30000, cones: 'IR organ', conesN: 0, note: 'Not eyes — heat-sensing pit organs image warm prey in the infrared, far beyond our sight.', ir: true },
];

// Non-biological detectors (metres). Human eye first for comparison.
const sensors = [
  { name: 'Human eye', tag: 'for comparison', min: 3.8e-7, max: 7e-7, note: 'Our entire visible world is this hair-thin slice of the spectrum.', human: true, isHuman: true },
  { name: 'Fermi', tag: 'gamma ray', min: 8e-16, max: 8e-12, note: 'Catches the most energetic light in the universe from black holes and cosmic cataclysms.' },
  { name: 'Chandra', tag: 'X-ray', min: 1.2e-10, max: 1.2e-8, note: 'X-ray observatory imaging million-degree gas around black holes and exploded stars.' },
  { name: 'Hubble', tag: 'UV–near IR', min: 1.15e-7, max: 2.5e-6, note: 'Sees a little past both edges of human vision, into ultraviolet and near-infrared.' },
  { name: 'JWST', tag: 'infrared', min: 6e-7, max: 2.85e-5, note: 'James Webb Space Telescope — orange light through mid-infrared, peering at the first galaxies.' },
  { name: 'Thermal camera', tag: 'LWIR', min: 8e-6, max: 1.4e-5, note: '"Heat vision" — detects long-wave infrared radiated by warm bodies, day or night.' },
  { name: 'Spitzer', tag: 'infrared', min: 3e-6, max: 1.6e-4, note: 'Retired NASA infrared telescope; saw warm dust and distant galaxies through cosmic haze.' },
  { name: 'ALMA', tag: 'millimetre array', min: 3.2e-4, max: 3.6e-3, note: '66 antennas in the Atacama desert imaging cold dust and molecular clouds where stars are born.' },
  { name: 'Radio telescope', tag: 'e.g. Green Bank', min: 3e-3, max: 2.6, note: 'Giant dishes tuned to metre-to-millimetre radio waves from cold gas, pulsars and the early universe.' },
];
const bands = [
  { name: 'Radio', at: 1e1 }, { name: 'Microwave', at: 1e-2 }, { name: 'Infrared', at: 1e-4 },
  { name: 'Visible', at: 5.5e-7 }, { name: 'Ultraviolet', at: 5e-8 }, { name: 'X-ray', at: 1e-9 }, { name: 'Gamma', at: 1e-11 },
];

// ---------- helpers ----------
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

function fmtM(m) {
  if (m >= 1) return m.toFixed(m < 10 ? 1 : 0) + ' m';
  if (m >= 1e-3) return (m * 1e3).toPrecision(2) + ' mm';
  if (m >= 1e-6) return (m * 1e6).toPrecision(2) + ' µm';
  if (m >= 1e-9) return (m * 1e9).toPrecision(2) + ' nm';
  if (m >= 1e-12) return (m * 1e12).toPrecision(2) + ' pm';
  return (m * 1e15).toPrecision(2) + ' fm';
}
function bandFor(mid) {
  if (mid > 1e-1) return 'radio'; if (mid > 1e-3) return 'microwave'; if (mid > 7e-7) return 'infrared';
  if (mid > 3.8e-7) return 'visible'; if (mid > 1e-8) return 'ultraviolet'; if (mid > 1e-11) return 'X-ray'; return 'gamma';
}

let tip = null;
function bindTip(node, html) {
  node.addEventListener('pointerenter', (e) => { tip.innerHTML = html; tip.style.opacity = 1; moveTip(e); });
  node.addEventListener('pointermove', moveTip);
  node.addEventListener('pointerleave', () => { tip.style.opacity = 0; });
  function moveTip(e) {
    const pad = 14; const r = tip.getBoundingClientRect();
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + r.width > innerWidth) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight) y = e.clientY - r.height - pad;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
}
function coneCell(a) {
  const cell = el('div', 'sv-cones');
  cell.appendChild(el('span', 'sv-conechip', a.cones));
  if (a.conesN && a.conesN <= 6) {
    const dots = el('span', 'sv-conedots');
    for (let i = 0; i < a.conesN; i++) { const d = document.createElement('i'); d.style.background = coneColors[i % coneColors.length]; dots.appendChild(d); }
    cell.appendChild(dots);
  }
  return cell;
}
// A vertical guide-line overlay aligned to the track column of a panel.
function guides(lines) {
  const g = el('div', 'sv-guides');
  for (const ln of lines) {
    if (ln.band) {
      const b = el('div', 'sv-gband');
      b.style.left = (ln.from * 100) + '%';
      b.style.width = ((ln.to - ln.from) * 100) + '%';
      g.appendChild(b);
    } else {
      const v = el('div', 'sv-gline' + (ln.gold ? ' gold' : ''));
      v.style.left = (ln.at * 100) + '%';
      if (ln.label) { const lb = el('span', 'sv-glabel', ln.label); v.appendChild(lb); }
      g.appendChild(v);
    }
  }
  return g;
}

// ---------- render ----------
let done = false;
export function renderSpectrum() {
  if (done) return;
  done = true;
  const root = document.getElementById('spectrum-viz');

  tip = el('div', null); tip.id = 'sv-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip);

  root.appendChild(el('p', 'sv-sub',
    'Every eye and every instrument catches only part of the light around us. '
    + 'Below are <b>biological eyes and organs</b>, zoomed into the thin band of visible light — then the '
    + '<b>telescopes and detectors</b> we built to reach the rest of the spectrum. The gold lines mark the '
    + 'human visible range so you can line everything up against what we can see.'));

  // ===== Panel 1: biological =====
  const s1 = el('section', 'sv-section');
  s1.appendChild(el('h2', null, 'Biological eyes &amp; organs'));
  s1.appendChild(el('p', 'sv-note', 'Wavelength in nanometres (280–760 nm). Bars are painted in the true colour of that light; '
    + '<span style="color:#c39bff">UV</span> and <span style="color:#e07a7a">infrared</span> edges are invisible to us. Cone types = colour receptors.'));

  // spectral ruler that the rows line up against
  const rulerRow1 = el('div', 'sv-row');
  rulerRow1.appendChild(el('div'));
  const ruler1 = el('div', 'sv-ruler'); ruler1.style.background = nmGradient(B_LO, B_HI);
  rulerRow1.appendChild(ruler1);
  rulerRow1.appendChild(el('div', 'sv-colhead', 'Cone types'));
  s1.appendChild(rulerRow1);

  const plot1 = el('div', 'sv-plot');
  const rows1 = el('div', 'sv-rows');
  animals.forEach((a) => {
    const row = el('div', 'sv-row');
    const lab = el('div', 'sv-rowlabel' + (a.isHuman ? ' human' : ''));
    lab.innerHTML = `<b>${a.name}</b>${a.tag ? `<span class="sv-tag">${a.tag}</span>` : ''}`;
    const track = el('div', 'sv-track');
    if (a.ir) {
      // pit viper's IR range is off this scale — show an arrow to the edge
      const bar = el('div', 'sv-bar sv-offscale');
      bar.style.left = '96%'; bar.style.right = '0';
      bar.innerHTML = '<span>IR →</span>';
      bindTip(bar, `<div class="t-name">${a.name}</div><div class="t-range">5–30 µm (infrared)</div><div class="t-note">${a.note}</div>`);
      track.appendChild(bar);
    } else {
      const bar = el('div', 'sv-bar');
      bar.style.left = (bFrac(a.min) * 100) + '%';
      bar.style.width = ((bFrac(a.max) - bFrac(a.min)) * 100) + '%';
      bar.style.background = nmGradient(a.min, a.max);
      if (a.human) bar.style.boxShadow = 'inset 0 0 0 1.5px var(--sv-gold), 0 1px 3px rgba(0,0,0,.5)';
      bindTip(bar, `<div class="t-name">${a.name}</div><div class="t-range">${a.min}–${a.max} nm &middot; ${a.cones} cone types</div><div class="t-note">${a.note}</div>`);
      track.appendChild(bar);
    }
    row.append(lab, track, coneCell(a));
    rows1.appendChild(row);
  });
  plot1.appendChild(rows1);
  plot1.appendChild(guides([
    { at: bFrac(380), gold: true }, { at: bFrac(700), gold: true },
  ]));
  s1.appendChild(plot1);

  // nm axis
  const axis1 = el('div', 'sv-row');
  axis1.appendChild(el('div'));
  const ax1 = el('div', 'sv-axis');
  [280, 350, 400, 450, 500, 550, 600, 650, 700, 760].forEach((nm) => {
    const t = el('div', 'sv-tick', `${nm}<span class="u">nm</span>`); t.style.left = (bFrac(nm) * 100) + '%'; ax1.appendChild(t);
  });
  axis1.appendChild(ax1);
  axis1.appendChild(el('div'));
  s1.appendChild(axis1);
  root.appendChild(s1);

  // ===== connector (bio panel above = the visible sliver below) =====
  const conn = el('div', 'sv-conn');
  const connInner = el('div');
  const xShort = aFrac(3.8e-7) * 1000, xLong = aFrac(7e-7) * 1000; // short=left, long=right
  connInner.innerHTML = `<svg viewBox="0 0 1000 30" preserveAspectRatio="none">
    <path d="M0 0 L1000 0 L${xLong.toFixed(1)} 30 L${xShort.toFixed(1)} 30 Z" fill="rgba(255,210,74,0.10)" stroke="rgba(255,210,74,0.45)" stroke-width="1"/></svg>`;
  conn.appendChild(connInner);
  root.appendChild(conn);

  // ===== Panel 2: detectors on the full spectrum =====
  const s2 = el('section', 'sv-section');
  s2.appendChild(el('h2', null, 'Telescopes &amp; detectors'));
  s2.appendChild(el('p', 'sv-note', 'The whole electromagnetic spectrum — wavelength in metres, logarithmic. '
    + 'The gold stripe is the visible band from the panel above: everything living eyes see fits inside it.'));

  const bandRow = el('div', 'sv-row');
  bandRow.appendChild(el('div'));
  const bandBox = el('div', 'sv-bandlabels');
  // sort by position and alternate two levels so crowded labels (X-ray,
  // Ultraviolet, Visible) never overlap
  [...bands].sort((a, b) => aFrac(a.at) - aFrac(b.at)).forEach((b, i) => {
    const sp = el('span', 'sv-b' + (i % 2 ? ' lvl2' : ''), b.name);
    sp.style.left = (aFrac(b.at) * 100) + '%';
    if (b.name === 'Visible') sp.style.color = 'var(--sv-gold)';
    bandBox.appendChild(sp);
  });
  bandRow.appendChild(bandBox);
  bandRow.appendChild(el('div'));
  s2.appendChild(bandRow);

  // compressing wave — densely sampled, bounded chirp (no aliasing)
  const waveRow = el('div', 'sv-row');
  waveRow.appendChild(el('div'));
  const waveWrap = el('div');
  const NW = 2000; let d = 'M0 22';
  for (let x = 0; x <= NW; x += 0.5) {
    const u = 1 - x / NW; // dense (short wavelength) on the LEFT
    const phase = 2 * Math.PI * (2 * u + 33 * u * u * u); // 35 → 2 cycles across
    const amp = 13 * (1 - 0.12 * u);
    d += ` L${x.toFixed(1)} ${(22 - amp * Math.sin(phase)).toFixed(2)}`;
  }
  waveWrap.innerHTML = `<svg class="sv-wave" viewBox="0 0 2000 44" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="#8b93ab" stroke-width="1.1"/></svg>`;
  waveRow.appendChild(waveWrap);
  waveRow.appendChild(el('div'));
  s2.appendChild(waveRow);

  // log axis
  const axisRow = el('div', 'sv-row');
  axisRow.appendChild(el('div'));
  const ax2 = el('div', 'sv-axis top');
  for (let e = 3; e >= -12; e -= 3) {
    const m = Math.pow(10, e);
    const t = el('div', 'sv-tick', `10<sup>${e}</sup><span class="u">${e === 0 ? '1 m' : e === 3 ? 'km' : ''}</span>`);
    t.style.left = (aFrac(m) * 100) + '%'; ax2.appendChild(t);
  }
  axisRow.appendChild(ax2);
  axisRow.appendChild(el('div'));
  s2.appendChild(axisRow);

  const plot2 = el('div', 'sv-plot');
  const rows2 = el('div', 'sv-rows');
  sensors.forEach((s) => {
    const row = el('div', 'sv-row');
    const lab = el('div', 'sv-rowlabel' + (s.isHuman ? ' human' : ''));
    lab.innerHTML = `<b>${s.name}</b>${s.tag ? `<span class="sv-tag">${s.tag}</span>` : ''}`;
    const track = el('div', 'sv-track');
    const bar = el('div', 'sv-bar');
    const clamp = (v) => Math.max(0, Math.min(100, v));
    const L = clamp(aFrac(s.max) * 100), R = clamp(aFrac(s.min) * 100);
    bar.style.left = Math.min(L, R) + '%';
    bar.style.width = Math.max(0.8, Math.abs(R - L)) + '%';
    bar.style.background = mGradient(s.min, s.max);
    if (s.human) bar.style.boxShadow = 'inset 0 0 0 1.5px var(--sv-gold), 0 0 10px rgba(255,210,74,0.5)';
    bindTip(bar, `<div class="t-name">${s.name}</div><div class="t-range">${fmtM(s.min)} – ${fmtM(s.max)}</div><div class="t-note">${s.note}</div>`);
    track.appendChild(bar);
    const det = el('div', 'sv-cones'); det.style.fontSize = '0.72rem'; det.style.color = 'var(--ink-3, #6f7890)';
    det.textContent = bandFor(Math.sqrt(s.min * s.max));
    row.append(lab, track, det);
    rows2.appendChild(row);
  });
  plot2.appendChild(rows2);
  plot2.appendChild(guides([
    { band: true, from: aFrac(3.8e-7), to: aFrac(7e-7) },
    { at: aFrac(3.8e-7), gold: true, label: 'visible' }, { at: aFrac(7e-7), gold: true },
  ]));
  s2.appendChild(plot2);
  root.appendChild(s2);

  // caption + table
  root.appendChild(el('p', 'sv-caption',
    'Ranges are approximate and vary by individual, study, and definition of “detectable.” Animal vision is measured by '
    + 'photoreceptor sensitivity; detector ranges are design bandpasses. Cone counts are distinct photoreceptor <i>types</i>, '
    + 'not total cells — mantis shrimp have 12–16 but discriminate colour differently than we do. Tetrachromat humans (a rare '
    + 'fourth cone) and reindeer (UV-transmitting eyes) show even “human” vision isn’t one fixed window. Figures rounded for teaching.'));

  const tbl = el('details', 'sv-tabler');
  tbl.appendChild(el('summary', null, 'View all data as a table'));
  const t1 = ['<table><thead><tr><th>Eye / organ</th><th>Range</th><th>Cone types</th></tr></thead><tbody>'];
  animals.forEach((a) => t1.push(`<tr><td>${a.name}</td><td class="num">${a.ir ? '5–30 µm' : a.min + '–' + a.max + ' nm'}</td><td class="num">${a.cones}</td></tr>`));
  t1.push('</tbody></table>');
  const t2 = ['<table><thead><tr><th>Detector</th><th>Shortest λ</th><th>Longest λ</th><th>Band</th></tr></thead><tbody>'];
  sensors.forEach((s) => t2.push(`<tr><td>${s.name}</td><td class="num">${fmtM(s.min)}</td><td class="num">${fmtM(s.max)}</td><td>${bandFor(Math.sqrt(s.min * s.max))}</td></tr>`));
  t2.push('</tbody></table>');
  const wrap = el('div');
  wrap.innerHTML = '<h3>Biological eyes &amp; organs</h3>' + t1.join('') + '<h3>Telescopes &amp; detectors</h3>' + t2.join('');
  tbl.appendChild(wrap);
  root.appendChild(tbl);
}
