// Wraps math.js: compiles equation text into fast evaluators and maps
// results (including complex numbers) to a clamped [0,1] intensity.

const math = window.math;

// Re(z) / Im(z) aliases so students can write Re(e^(i*x)) etc.
math.import({ Re: math.re, Im: math.im }, { silent: true });

// A representative scope used to catch runtime errors (undefined symbols,
// wrong argument counts) at compile time rather than mid-animation.
const TEST_SCOPE = { t: 0.5, x: 0.3, y: 0.3, z: 0.3, r: 0.42, rho: 0.52, theta: 0.78, phi: 0.95 };

// Test scope extended with the user's helper variables ({name, code} list),
// evaluated in order so later definitions can use earlier ones.
export function makeTestScope(vars) {
  const scope = { ...TEST_SCOPE };
  if (vars) for (const v of vars) scope[v.name] = evalValue(v.code, scope);
  return scope;
}

// Compile an expression. Throws with a readable message if it doesn't
// parse or references unknown variables. The returned code carries a
// `.tex` property with the expression's LaTeX form.
export function compileChannel(text, testScope = { ...TEST_SCOPE }) {
  if (!text || !text.trim()) throw new Error('empty expression');
  const node = math.parse(text);
  const code = node.compile();
  code.evaluate(testScope); // throws on undefined symbols etc.
  code.tex = node.toTex();
  return code;
}

// Evaluate to the raw math.js value (numbers, Complex, ...) — used for
// helper variables so complex intermediates survive until Re/Im.
export function evalValue(code, scope) {
  try { return code.evaluate(scope); }
  catch { return NaN; }
}

// Evaluate a compiled expression against a scope ({t, x, y, ...}) and
// return the raw (unclamped) real value, or null if it can't be made
// into a finite number. Complex results fall back to their real part.
export function evalRaw(code, scope) {
  let v;
  try {
    v = code.evaluate(scope);
  } catch {
    return null;
  }
  if (v != null && typeof v === 'object') {
    if (typeof v.re === 'number') v = v.re; // math.js Complex
    else if (typeof v.toNumber === 'function') v = v.toNumber();
    else return null;
  }
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// Same, but clamped to a [0,1] intensity for rendering.
export function evalIntensity(code, scope) {
  const v = evalRaw(code, scope);
  if (v == null) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Precompute the coordinate scope for every 2D grid cell.
// x, y span [-1, 1]; polar r/theta are always provided too so students
// can freely mix coordinate systems.
export function makeScopes2D(nx, ny) {
  const scopes = new Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    // j = 0 is the top row of the image; flip so +y points up
    const y = 1 - (2 * (j + 0.5)) / ny;
    for (let i = 0; i < nx; i++) {
      const x = -1 + (2 * (i + 0.5)) / nx;
      scopes[j * nx + i] = {
        t: 0,
        x,
        y,
        r: Math.hypot(x, y),
        theta: Math.atan2(y, x),
      };
    }
  }
  return scopes;
}

// Precompute scopes for every 3D grid point (n per side, cube [-1,1]^3).
// Spherical coordinates: rho = distance from origin, theta = azimuth in
// the x-y plane, phi = angle from the +z axis.
export function makeScopes3D(n) {
  const scopes = new Array(n * n * n);
  const positions = new Float32Array(n * n * n * 3);
  let idx = 0;
  for (let k = 0; k < n; k++) {
    const z = -1 + (2 * (k + 0.5)) / n;
    for (let j = 0; j < n; j++) {
      const y = -1 + (2 * (j + 0.5)) / n;
      for (let i = 0; i < n; i++) {
        const x = -1 + (2 * (i + 0.5)) / n;
        const rho = Math.hypot(x, y, z);
        scopes[idx] = {
          t: 0,
          x,
          y,
          z,
          r: rho, // both names work for the radial distance
          rho,
          theta: Math.atan2(y, x),
          phi: rho === 0 ? 0 : Math.acos(z / rho),
        };
        positions[idx * 3] = x;
        positions[idx * 3 + 1] = y;
        positions[idx * 3 + 2] = z;
        idx++;
      }
    }
  }
  return { scopes, positions };
}
