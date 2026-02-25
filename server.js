const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const initialData = {
  users: [],
  clients: [],
  invoices: [],
  expenses: []
};

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
  }
}

function loadData() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

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
      if (body.length > 1e6) {
        reject(new Error('Payload too large'));
      }
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
  const [salt, originalHash] = storedHash.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(originalHash));
}

function createToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function getAuthUser(req, data) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.replace('Bearer ', '');
  const decoded = verifyToken(token);
  if (!decoded) return null;
  return data.users.find((user) => user.id === decoded.userId) || null;
}

function requireHttps(req, res) {
  const production = process.env.NODE_ENV === 'production';
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (production && forwardedProto !== 'https') {
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
    const types = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css'
    };

    res.writeHead(200, {
      'Content-Type': types[ext] || 'text/plain',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(content);
  });
}

async function handler(req, res) {
  if (!requireHttps(req, res)) return;

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const data = loadData();

  if (pathname.startsWith('/api/')) {
    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const body = await parseBody(req).catch((error) => json(res, 400, { error: error.message }));
      if (!body || res.writableEnded) return;

      const { email, password, name } = body;
      if (!email || !password || !name) return json(res, 400, { error: 'name, email, password required' });
      if (data.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
        return json(res, 409, { error: 'Email already registered' });
      }

      const user = {
        id: createId('usr'),
        name,
        email,
        passwordHash: hashPassword(password)
      };
      data.users.push(user);
      saveData(data);
      const token = createToken({ userId: user.id, email: user.email });
      return json(res, 201, { token, user: { id: user.id, name: user.name, email: user.email } });
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const body = await parseBody(req).catch((error) => json(res, 400, { error: error.message }));
      if (!body || res.writableEnded) return;

      const { email, password } = body;
      const user = data.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
      if (!user || !verifyPassword(password || '', user.passwordHash)) {
        return json(res, 401, { error: 'Invalid credentials' });
      }

      const token = createToken({ userId: user.id, email: user.email });
      return json(res, 200, { token, user: { id: user.id, name: user.name, email: user.email } });
    }

    const user = getAuthUser(req, data);
    if (!user) return json(res, 401, { error: 'Unauthorized' });

    if (req.method === 'GET' && pathname === '/api/me') {
      return json(res, 200, { id: user.id, name: user.name, email: user.email });
    }

    const collections = {
      '/api/clients': 'clients',
      '/api/invoices': 'invoices',
      '/api/expenses': 'expenses'
    };

    for (const [route, key] of Object.entries(collections)) {
      if (pathname === route && req.method === 'GET') {
        return json(res, 200, data[key].filter((item) => item.userId === user.id));
      }
      if (pathname === route && req.method === 'POST') {
        const body = await parseBody(req).catch((error) => json(res, 400, { error: error.message }));
        if (!body || res.writableEnded) return;
        const record = { ...body, id: createId(key.slice(0, 3)), userId: user.id, createdAt: new Date().toISOString() };
        data[key].push(record);
        saveData(data);
        return json(res, 201, record);
      }
      if (pathname.startsWith(`${route}/`)) {
        const id = pathname.split('/').pop();
        const idx = data[key].findIndex((item) => item.id === id && item.userId === user.id);
        if (idx === -1) return json(res, 404, { error: `${key.slice(0, -1)} not found` });

        if (req.method === 'GET') {
          return json(res, 200, data[key][idx]);
        }
        if (req.method === 'PUT') {
          const body = await parseBody(req).catch((error) => json(res, 400, { error: error.message }));
          if (!body || res.writableEnded) return;
          data[key][idx] = { ...data[key][idx], ...body, id, userId: user.id };
          saveData(data);
          return json(res, 200, data[key][idx]);
        }
        if (req.method === 'DELETE') {
          const deleted = data[key].splice(idx, 1)[0];
          saveData(data);
          return json(res, 200, deleted);
        }
      }
    }

    if (req.method === 'GET' && pathname === '/api/reports/summary') {
      const invoices = data.invoices.filter((i) => i.userId === user.id);
      const expenses = data.expenses.filter((e) => e.userId === user.id);

      const totalIncome = invoices.reduce((sum, i) => sum + Number(i.amount || 0), 0);
      const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      const outstanding = invoices
        .filter((i) => i.status !== 'paid')
        .reduce((sum, i) => sum + Number(i.amount || 0), 0);

      return json(res, 200, {
        totalIncome,
        totalExpenses,
        netProfit: totalIncome - totalExpenses,
        outstandingInvoices: outstanding,
        invoiceCount: invoices.length,
        expenseCount: expenses.length
      });
    }

    return json(res, 404, { error: 'API endpoint not found' });
  }

  return sendStatic(req, res, pathname);
}

const server = http.createServer((req, res) => {
  handler(req, res).catch((error) => {
    json(res, 500, { error: error.message || 'Internal server error' });
  });
});

server.listen(PORT, () => {
  console.log(`Accounting app running on http://localhost:${PORT}`);
});
