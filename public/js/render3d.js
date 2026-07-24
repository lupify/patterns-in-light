// 3D renderer: a grid of cells in [-1,1]^3 whose colors come from the
// R/G/B equations. Drag to orbit, pinch/scroll to zoom.
//
// shape:    'cube'  → the full n×n×n lattice
//           'sphere'→ only lattice points within radius 1
// cellType: 'circle'→ round points (billboards)
//           'block' → little cubes (instanced)
//           'hex'   → hexagonal prisms (instanced)

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeScopes3D, evalIntensity, evalValue } from './math-engine.js';

// A soft round sprite so 'circle' points render as discs, not squares.
function circleTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, '#fff');
  grd.addColorStop(0.65, '#fff');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  g.fill();
  return new THREE.CanvasTexture(c);
}

export class Renderer3D {
  constructor(container, n, opts = {}) {
    this.container = container;
    this.n = n;
    this.shape = ['cube', 'sphere', 'cube-shell', 'sphere-shell'].includes(opts.shape) ? opts.shape : 'cube';
    this.cellType = ['circle', 'square', 'block', 'hex'].includes(opts.cellType) ? opts.cellType : 'circle';

    // Full lattice is kept for coordinate probing; `idx` selects which
    // points are actually drawn: the full cube, the filled ball, or just
    // the outer layer for the hollow "shell" shapes.
    const { scopes, positions } = makeScopes3D(n);
    this.scopes = scopes;
    this.idx = [];
    const spacing = 2 / n;
    const shellMin = 1 - 1.5 * spacing; // rho band for the spherical shell
    for (let i = 0; i < scopes.length; i++) {
      const rho = scopes[i].rho;
      let keep = true;
      if (this.shape === 'sphere') keep = rho <= 1.0001;
      else if (this.shape === 'sphere-shell') keep = rho <= 1.0001 && rho >= shellMin;
      else if (this.shape === 'cube-shell') {
        const ii = i % n, jj = Math.floor(i / n) % n, kk = Math.floor(i / (n * n));
        keep = ii === 0 || ii === n - 1 || jj === 0 || jj === n - 1 || kk === 0 || kk === n - 1;
      }
      if (keep) this.idx.push(i);
    }
    this.count = this.idx.length;
    const sub = new Float32Array(this.count * 3);
    for (let j = 0; j < this.count; j++) {
      const i = this.idx[j];
      sub[j * 3] = positions[i * 3];
      sub[j * 3 + 1] = positions[i * 3 + 1];
      sub[j * 3 + 2] = positions[i * 3 + 2];
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.camera.position.set(2.4, 1.8, 2.4);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    // Build the cells for the chosen type. Sizes are ~half the lattice
    // spacing so there's clear space between individual cells.
    if (this.cellType === 'circle' || this.cellType === 'square') {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(sub, 3));
      this.colors = new Float32Array(this.count * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
      const matOpts = { size: spacing * 0.55, vertexColors: true, sizeAttenuation: true };
      if (this.cellType === 'circle') { // round sprite; 'square' uses the default square point
        this.tex = circleTexture();
        matOpts.map = this.tex;
        matOpts.alphaTest = 0.4;
        matOpts.transparent = true;
      }
      this.obj = new THREE.Points(geo, new THREE.PointsMaterial(matOpts));
      this.mode = 'points';
    } else {
      const geom = this.cellType === 'hex'
        ? new THREE.CylinderGeometry(spacing * 0.4, spacing * 0.4, spacing * 0.55, 6)
        : new THREE.BoxGeometry(spacing * 0.55, spacing * 0.55, spacing * 0.55);
      this.obj = new THREE.InstancedMesh(geom, new THREE.MeshBasicMaterial(), this.count);
      const dummy = new THREE.Object3D();
      for (let j = 0; j < this.count; j++) {
        dummy.position.set(sub[j * 3], sub[j * 3 + 1], sub[j * 3 + 2]);
        dummy.updateMatrix();
        this.obj.setMatrixAt(j, dummy.matrix);
      }
      this.obj.instanceMatrix.needsUpdate = true;
      this._color = new THREE.Color();
      this.mode = 'instanced';
    }
    this.scene.add(this.obj);

    // Boundary shown with the grid toggle: box for a cube, sphere for a ball.
    const lineMat = new THREE.LineBasicMaterial({ color: 0x777777, transparent: true, opacity: 0.6 });
    this.bound = new THREE.LineSegments(
      this.shape.startsWith('sphere')
        ? new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 16, 12))
        : new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)),
      lineMat,
    );
    this.bound.visible = false;
    this.scene.add(this.bound);

    // Marker showing the currently probed grid point
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(spacing * 0.7, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }),
    );
    this.marker.visible = false;
    this.scene.add(this.marker);

    // Axes shown with the grid toggle (x red, y green, z blue)
    this.axes = new THREE.AxesHelper(1.35);
    this.axes.visible = false;
    this.scene.add(this.axes);

    // Radius line from the origin to the probed point
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.originLine = new THREE.Line(lineGeom,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
    this.originLine.visible = false;
    this.scene.add(this.originLine);

    // Floating HTML label with the probed point's spherical coordinates
    this.label = document.createElement('div');
    this.label.className = 'label3d';
    container.appendChild(this.label);

    this.resize();
  }

  resize() {
    const size = this.container.clientWidth || 512;
    this.renderer.setSize(size, size);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
  }

  // opts: { grid: bool, probe: {x, y, z} | null }
  draw(fns, t, opts = {}) {
    const vars = fns.vars;
    for (let j = 0; j < this.count; j++) {
      const scope = this.scopes[this.idx[j]];
      scope.t = t;
      if (vars) for (const v of vars) scope[v.name] = evalValue(v.code, scope);
      const R = fns.r ? evalIntensity(fns.r, scope) : 0;
      const G = fns.g ? evalIntensity(fns.g, scope) : 0;
      const B = fns.b ? evalIntensity(fns.b, scope) : 0;
      if (this.mode === 'points') {
        const p = j * 3;
        this.colors[p] = R; this.colors[p + 1] = G; this.colors[p + 2] = B;
      } else {
        this._color.setRGB(R, G, B);
        this.obj.setColorAt(j, this._color);
      }
    }
    if (this.mode === 'points') this.obj.geometry.attributes.color.needsUpdate = true;
    else this.obj.instanceColor.needsUpdate = true;

    this.bound.visible = !!opts.grid;
    this.axes.visible = !!opts.grid;
    const p = opts.probe;
    if (p) {
      this.marker.position.set(p.x, p.y, p.z);
      this.marker.visible = true;
      const pos = this.originLine.geometry.attributes.position;
      pos.setXYZ(1, p.x, p.y, p.z);
      pos.needsUpdate = true;
      this.originLine.visible = true;
    } else {
      this.marker.visible = false;
      this.originLine.visible = false;
      this.label.textContent = '';
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (p) {
      // pin the coordinate label next to the marker's screen position
      const v = new THREE.Vector3(p.x, p.y, p.z).project(this.camera);
      const size = this.renderer.domElement.clientWidth;
      this.label.textContent =
        `r=${p.rho.toFixed(2)} θ=${p.theta.toFixed(2)} φ=${p.phi.toFixed(2)}`;
      this.label.style.transform =
        `translate(${((v.x + 1) / 2) * size + 10}px, ${((1 - v.y) / 2) * size - 22}px)`;
      this.label.style.visibility = v.z < 1 ? 'visible' : 'hidden'; // behind camera
    }
  }

  // Nearest lattice point to world coordinates (each ∈ [-1, 1]).
  cellFromCoords(x, y, z) {
    const n = this.n;
    const snap = (v) => Math.min(n - 1, Math.max(0, Math.round(((v + 1) * n) / 2 - 0.5)));
    return { i: snap(x), j: snap(y), k: snap(z) };
  }

  scopeFor(cell) {
    return this.scopes[(cell.k * this.n + cell.j) * this.n + cell.i];
  }

  dispose() {
    this.controls.dispose();
    this.obj.geometry.dispose();
    this.obj.material.dispose();
    if (this.tex) this.tex.dispose();
    this.bound.geometry.dispose();
    this.bound.material.dispose();
    this.marker.geometry.dispose();
    this.marker.material.dispose();
    this.axes.dispose();
    this.originLine.geometry.dispose();
    this.originLine.material.dispose();
    this.label.remove();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
