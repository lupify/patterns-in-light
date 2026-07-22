// 3D renderer: an n×n×n grid of points in [-1,1]^3 whose colors come
// from the R/G/B equations. Drag to orbit, pinch/scroll to zoom.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeScopes3D, evalIntensity } from './math-engine.js';

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
    for (let idx = 0; idx < scopes.length; idx++) {
      const scope = scopes[idx];
      scope.t = t;
      const p = idx * 3;
      colors[p] = fns.r ? evalIntensity(fns.r, scope) : 0;
      colors[p + 1] = fns.g ? evalIntensity(fns.g, scope) : 0;
      colors[p + 2] = fns.b ? evalIntensity(fns.b, scope) : 0;
    }
    this.points.geometry.attributes.color.needsUpdate = true;
    this.box.visible = !!opts.grid;
    if (opts.probe) {
      this.marker.position.set(opts.probe.x, opts.probe.y, opts.probe.z);
      this.marker.visible = true;
    } else {
      this.marker.visible = false;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
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
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
