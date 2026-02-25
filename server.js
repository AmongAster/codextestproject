const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const PUBLIC_DIR = path.join(__dirname, 'public');

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'"
  });
  res.end(payload);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, originalHash] = String(storedHash || '').split(':');
  if (!salt || !originalHash) return false;
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(originalHash));
}

function createToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function getAuthUser(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const decoded = verifyToken(auth.slice(7));
  if (!decoded?.userId) return null;
  const rows = db.query(`SELECT id, name, email FROM users WHERE id = ${db.escapeSql(decoded.userId)} LIMIT 1`);
  return rows[0] || null;
}

function requireHttps(req, res) {
  const production = process.env.NODE_ENV === 'production';
  if (production && req.headers['x-forwarded-proto'] !== 'https') {
    json(res, 400, { error: 'HTTPS is required in production.' });
    return false;
  }
  return true;
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function sendStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^\.+/, '');
  const resolved = path.join(PUBLIC_DIR, filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(resolved, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(resolved);
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain', 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  });
}

function normalizeRow(key, row) {
  if (!row) return row;
  if (key === 'invoices' || key === 'expenses') return { ...row, amount: Number(row.amount || 0) };
  return row;
}

async function handler(req, res) {
  if (!requireHttps(req, res)) return;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const body = await parseBody(req).catch((error) => json(res, 400, { error: error.message }));
      if (!body || res.writableEnded) return;
      const { email, password, name } = body;
      if (!email || !password || !name) return json(res, 400, { error: 'name, email, password required' });

      const exists = db.query(`SELECT id FROM users WHERE email = ${db.escapeSql(email)} LIMIT 1`);
      if (exists.length) return json(res, 409, { error: 'Email already registered' });

      const user = { id: createId('usr'), name, email, passwordHash: hashPassword(password) };
      db.execute(`
        INSERT INTO users (id, name, email, password_hash)
        VALUES (${db.escapeSql(user.id)}, ${db.escapeSql(user.name)}, ${db.escapeSql(user.email)}, ${db.escapeSql(user.passwordHash)})
      `);
      const token = createToken({ userId: user.id, email: user.email });
      return json(res, 201, { token, user: { id: user.id, name: user.name, email: user.email } });
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const body = await parseBody(req).catch((error) => json(res, 400, { error: error.message }));
      if (!body || res.writableEnded) return;
      const { email, password } = body;
      const users = db.query(`
        SELECT id, name, email, password_hash
        FROM users
        WHERE email = ${db.escapeSql(email)}
        LIMIT 1
      `);
      const user = users[0];
      if (!user || !verifyPassword(password || '', user.password_hash)) return json(res, 401, { error: 'Invalid credentials' });
      const token = createToken({ userId: user.id, email: user.email });
      return json(res, 200, { token, user: { id: user.id, name: user.name, email: user.email } });
    }

    const user = getAuthUser(req);
    if (!user) return json(res, 401, { error: 'Unauthorized' });

    if (req.method === 'GET' && pathname === '/api/me') return json(res, 200, user);

    const collections = {
      '/api/clients': {
        table: 'clients',
        fields: ['name', 'email'],
        idPrefix: 'cli'
      },
      '/api/invoices': {
        table: 'invoices',
        fields: ['client_name', 'amount', 'status'],
        idPrefix: 'inv'
      },
      '/api/expenses': {
        table: 'expenses',
        fields: ['category', 'amount'],
        idPrefix: 'exp'
      }
    };

    for (const [route, cfg] of Object.entries(collections)) {
      if (pathname === route && req.method === 'GET') {
        const rows = db.query(`SELECT * FROM ${cfg.table} WHERE user_id = ${db.escapeSql(user.id)} ORDER BY created_at DESC`)
          .map((row) => normalizeRow(cfg.table, row))
          .map((row) => {
            const mapped = { ...row };
            if (mapped.user_id) {
              mapped.userId = mapped.user_id;
              delete mapped.user_id;
            }
            if (mapped.client_name) {
              mapped.clientName = mapped.client_name;
              delete mapped.client_name;
            }
            if (mapped.created_at) {
              mapped.createdAt = mapped.created_at;
              delete mapped.created_at;
            }
            return mapped;
          });
        return json(res, 200, rows);
      }

      if (pathname === route && req.method === 'POST') {
        const body = await parseBody(req).catch((error) => json(res, 400, { error: error.message }));
        if (!body || res.writableEnded) return;

        const id = createId(cfg.idPrefix);
        const payload = {
          clients: { name: body.name, email: body.email },
          invoices: { client_name: body.clientName, amount: Number(body.amount || 0), status: body.status || 'pending' },
          expenses: { category: body.category, amount: Number(body.amount || 0) }
        }[cfg.table];

        const columns = ['id', 'user_id', ...cfg.fields];
        const values = [id, user.id, ...cfg.fields.map((field) => payload[field])];
        db.execute(`INSERT INTO ${cfg.table} (${columns.join(', ')}) VALUES (${values.map(db.escapeSql).join(', ')})`);

        const created = db.query(`SELECT * FROM ${cfg.table} WHERE id = ${db.escapeSql(id)} LIMIT 1`)[0];
        const mapped = { ...created };
        if (mapped.user_id) { mapped.userId = mapped.user_id; delete mapped.user_id; }
        if (mapped.client_name) { mapped.clientName = mapped.client_name; delete mapped.client_name; }
        if (mapped.created_at) { mapped.createdAt = mapped.created_at; delete mapped.created_at; }
        if (mapped.amount !== undefined) mapped.amount = Number(mapped.amount);
        return json(res, 201, mapped);
      }

      if (pathname.startsWith(`${route}/`)) {
        const id = pathname.split('/').pop();
        const existing = db.query(`SELECT * FROM ${cfg.table} WHERE id = ${db.escapeSql(id)} AND user_id = ${db.escapeSql(user.id)} LIMIT 1`)[0];
        if (!existing) return json(res, 404, { error: `${cfg.table.slice(0, -1)} not found` });

        if (req.method === 'GET') {
          const mapped = { ...existing };
          if (mapped.user_id) { mapped.userId = mapped.user_id; delete mapped.user_id; }
          if (mapped.client_name) { mapped.clientName = mapped.client_name; delete mapped.client_name; }
          if (mapped.created_at) { mapped.createdAt = mapped.created_at; delete mapped.created_at; }
          if (mapped.amount !== undefined) mapped.amount = Number(mapped.amount);
          return json(res, 200, mapped);
        }

        if (req.method === 'PUT') {
          const body = await parseBody(req).catch((error) => json(res, 400, { error: error.message }));
          if (!body || res.writableEnded) return;

          const updates = {
            clients: { name: body.name ?? existing.name, email: body.email ?? existing.email },
            invoices: {
              client_name: body.clientName ?? existing.client_name,
              amount: body.amount !== undefined ? Number(body.amount) : Number(existing.amount),
              status: body.status ?? existing.status
            },
            expenses: {
              category: body.category ?? existing.category,
              amount: body.amount !== undefined ? Number(body.amount) : Number(existing.amount)
            }
          }[cfg.table];

          const setExpr = Object.entries(updates).map(([key, val]) => `${key} = ${db.escapeSql(val)}`).join(', ');
          db.execute(`UPDATE ${cfg.table} SET ${setExpr} WHERE id = ${db.escapeSql(id)} AND user_id = ${db.escapeSql(user.id)}`);
          const updated = db.query(`SELECT * FROM ${cfg.table} WHERE id = ${db.escapeSql(id)} LIMIT 1`)[0];
          const mapped = { ...updated };
          if (mapped.user_id) { mapped.userId = mapped.user_id; delete mapped.user_id; }
          if (mapped.client_name) { mapped.clientName = mapped.client_name; delete mapped.client_name; }
          if (mapped.created_at) { mapped.createdAt = mapped.created_at; delete mapped.created_at; }
          if (mapped.amount !== undefined) mapped.amount = Number(mapped.amount);
          return json(res, 200, mapped);
        }

        if (req.method === 'DELETE') {
          db.execute(`DELETE FROM ${cfg.table} WHERE id = ${db.escapeSql(id)} AND user_id = ${db.escapeSql(user.id)}`);
          const mapped = { ...existing };
          if (mapped.user_id) { mapped.userId = mapped.user_id; delete mapped.user_id; }
          if (mapped.client_name) { mapped.clientName = mapped.client_name; delete mapped.client_name; }
          if (mapped.created_at) { mapped.createdAt = mapped.created_at; delete mapped.created_at; }
          if (mapped.amount !== undefined) mapped.amount = Number(mapped.amount);
          return json(res, 200, mapped);
        }
      }
    }

    if (req.method === 'GET' && pathname === '/api/reports/summary') {
      const incomeRow = db.query(`SELECT COALESCE(SUM(amount), 0) AS totalIncome FROM invoices WHERE user_id = ${db.escapeSql(user.id)}`)[0];
      const expenseRow = db.query(`SELECT COALESCE(SUM(amount), 0) AS totalExpenses FROM expenses WHERE user_id = ${db.escapeSql(user.id)}`)[0];
      const outstandingRow = db.query(`
        SELECT COALESCE(SUM(amount), 0) AS outstandingInvoices
        FROM invoices
        WHERE user_id = ${db.escapeSql(user.id)} AND status <> 'paid'
      `)[0];
      const invoiceCountRow = db.query(`SELECT COUNT(*) AS invoiceCount FROM invoices WHERE user_id = ${db.escapeSql(user.id)}`)[0];
      const expenseCountRow = db.query(`SELECT COUNT(*) AS expenseCount FROM expenses WHERE user_id = ${db.escapeSql(user.id)}`)[0];

      const totalIncome = Number(incomeRow?.totalIncome || 0);
      const totalExpenses = Number(expenseRow?.totalExpenses || 0);
      const outstandingInvoices = Number(outstandingRow?.outstandingInvoices || 0);

      return json(res, 200, {
        totalIncome,
        totalExpenses,
        netProfit: totalIncome - totalExpenses,
        outstandingInvoices,
        invoiceCount: Number(invoiceCountRow?.invoiceCount || 0),
        expenseCount: Number(expenseCountRow?.expenseCount || 0)
      });
    }

    return json(res, 404, { error: 'API endpoint not found' });
  }

  return sendStatic(req, res, pathname);
}

db.initDatabase();

const server = http.createServer((req, res) => {
  handler(req, res).catch((error) => {
    json(res, 500, { error: error.message || 'Internal server error' });
  });
});

server.listen(PORT, () => {
  console.log(`Accounting app running on http://localhost:${PORT}`);
});
