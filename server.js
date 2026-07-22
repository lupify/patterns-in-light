// Web service: serves the static app plus a small JSON API backing the
// public gallery. Storage: Postgres when DATABASE_URL is set (Render),
// otherwise a JSON file in ./data so local dev needs no database.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'public');

// ---------- storage backends ----------

async function makePgStore(url) {
  const { default: pg } = await import('pg'); // only needed when a DB is configured
  const pool = new pg.Pool({
    connectionString: url,
    ssl: url.includes('.render.com') ? { rejectUnauthorized: false } : undefined,
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS patterns (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      config JSONB NOT NULL,
      likes INTEGER NOT NULL DEFAULT 0,
      forked_from INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  const toApi = (r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    config: r.config,
    likes: r.likes,
    forkedFrom: r.forked_from,
    forkedFromName: r.forked_from_name ?? null,
    createdAt: r.created_at,
  });
  return {
    async list() {
      const res = await pool.query(`
        SELECT p.*, f.name AS forked_from_name
        FROM patterns p LEFT JOIN patterns f ON f.id = p.forked_from
        ORDER BY p.id DESC LIMIT 200`);
      return res.rows.map(toApi);
    },
    async exists(id) {
      const res = await pool.query('SELECT 1 FROM patterns WHERE id = $1', [id]);
      return res.rowCount > 0;
    },
    async create({ name, description, config, forkOf }) {
      const res = await pool.query(
        `INSERT INTO patterns (name, description, config, forked_from)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [name, description, JSON.stringify(config), forkOf],
      );
      return toApi(res.rows[0]);
    },
    async like(id) {
      const res = await pool.query(
        'UPDATE patterns SET likes = likes + 1 WHERE id = $1 RETURNING likes', [id]);
      return res.rowCount ? res.rows[0].likes : null;
    },
  };
}

function makeFileStore(file) {
  let data = { nextId: 1, patterns: [] };
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* fresh store */ }
  let writing = Promise.resolve(); // serialize writes
  const persist = () => {
    writing = writing.then(() =>
      fsp.mkdir(path.dirname(file), { recursive: true })
        .then(() => fsp.writeFile(file, JSON.stringify(data, null, 2))));
    return writing;
  };
  const toApi = (p) => ({
    ...p,
    forkedFromName: p.forkedFrom
      ? data.patterns.find((q) => q.id === p.forkedFrom)?.name ?? null
      : null,
  });
  return {
    async list() {
      return [...data.patterns].sort((a, b) => b.id - a.id).map(toApi);
    },
    async exists(id) {
      return data.patterns.some((p) => p.id === id);
    },
    async create({ name, description, config, forkOf }) {
      const p = {
        id: data.nextId++, name, description, config,
        likes: 0, forkedFrom: forkOf, createdAt: new Date().toISOString(),
      };
      data.patterns.push(p);
      await persist();
      return toApi(p);
    },
    async like(id) {
      const p = data.patterns.find((q) => q.id === id);
      if (!p) return null;
      p.likes++;
      await persist();
      return p.likes;
    },
  };
}

const store = process.env.DATABASE_URL
  ? await makePgStore(process.env.DATABASE_URL)
  : makeFileStore(path.join(here, 'data', 'patterns.json'));

// ---------- validation ----------

const CELL_TYPES = ['square', 'tri', 'circle', 'hex'];

// Rebuild the config from scratch so only known, bounded fields are stored.
function sanitizeConfig(c) {
  if (!c || typeof c !== 'object') return null;
  const eq = (s) => (typeof s === 'string' && s.trim() && s.length <= 400 ? s : null);
  const r = eq(c.eqs?.r);
  const g = eq(c.eqs?.g);
  const b = eq(c.eqs?.b);
  if (!r || !g || !b) return null;
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (c.dim === '2d') {
    if (!int(c.nx, 2, 256) || !int(c.ny, 2, 256)) return null;
    const cellType = CELL_TYPES.includes(c.cellType) ? c.cellType : 'square';
    return { dim: '2d', nx: c.nx, ny: c.ny, cellType, eqs: { r, g, b } };
  }
  if (c.dim === '3d') {
    if (!int(c.n, 2, 32)) return null;
    return { dim: '3d', n: c.n, eqs: { r, g, b } };
  }
  return null;
}

// ---------- http plumbing ----------

function readJson(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/patterns' && req.method === 'GET') {
    sendJson(res, 200, await store.list());
    return;
  }
  if (pathname === '/api/patterns' && req.method === 'POST') {
    let body;
    try { body = await readJson(req); }
    catch (err) { sendJson(res, 400, { error: String(err.message) }); return; }
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 400) : '';
    const config = sanitizeConfig(body.config);
    if (!name) { sendJson(res, 400, { error: 'name is required' }); return; }
    if (!config) { sendJson(res, 400, { error: 'invalid pattern config' }); return; }
    let forkOf = Number.isInteger(body.forkOf) ? body.forkOf : null;
    if (forkOf != null && !(await store.exists(forkOf))) forkOf = null;
    sendJson(res, 201, await store.create({ name, description, config, forkOf }));
    return;
  }
  const like = pathname.match(/^\/api\/patterns\/(\d+)\/like$/);
  if (like && req.method === 'POST') {
    const likes = await store.like(Number(like[1]));
    if (likes == null) sendJson(res, 404, { error: 'no such pattern' });
    else sendJson(res, 200, { likes });
    return;
  }
  sendJson(res, 404, { error: 'not found' });
}

// ---------- static files ----------

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function handleStatic(res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(root, pathname));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(file, (err, fileData) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(fileData);
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  try {
    if (pathname.startsWith('/api/')) await handleApi(req, res, pathname);
    else handleStatic(res, pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: 'server error' });
  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(
  `Patterns in Light running at http://localhost:${port} ` +
  `(storage: ${process.env.DATABASE_URL ? 'postgres' : 'local file'})`));
