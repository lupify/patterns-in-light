// 3D renderer: an n×n×n grid of points in [-1,1]^3 whose colors come
// from the R/G/B equations. Drag to orbit, pinch/scroll to zoom.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeScopes3D, evalIntensity, evalValue } from './math-engine.js';

export class Renderer3D {
  constructor(container, n) {
    this.container = container;
    this.n = n;

    const { scopes, positions } = makeScopes3D(n);
    this.scopes = scopes;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.camera.position.set(2.4, 1.8, 2.4);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.colors = new Float32Array(scopes.length * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    const material = new THREE.PointsMaterial({
      size: 1.6 / n,
      vertexColors: true,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geometry, material);
    this.scene.add(this.points);

    // Boundary wireframe (the "grid" toggle in 3D)
    this.box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)),
      new THREE.LineBasicMaterial({ color: 0x777777 }),
    );
    this.box.visible = false;
    this.scene.add(this.box);

    // Marker showing the currently probed grid point
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1.4 / n, 12, 8),
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
    const { scopes, colors } = this;
    const vars = fns.vars;
    for (let idx = 0; idx < scopes.length; idx++) {
      const scope = scopes[idx];
      scope.t = t;
      if (vars) for (const v of vars) scope[v.name] = evalValue(v.code, scope);
      const p = idx * 3;
      colors[p] = fns.r ? evalIntensity(fns.r, scope) : 0;
      colors[p + 1] = fns.g ? evalIntensity(fns.g, scope) : 0;
      colors[p + 2] = fns.b ? evalIntensity(fns.b, scope) : 0;
    }
    this.points.geometry.attributes.color.needsUpdate = true;
    this.box.visible = !!opts.grid;
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

  // Nearest grid point to world coordinates (each ∈ [-1, 1]).
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
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.box.geometry.dispose();
    this.box.material.dispose();
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
