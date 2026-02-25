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

function toCamelRow(row) {
  const mapped = { ...row };
  Object.keys(mapped).forEach((key) => {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (camelKey !== key) {
      mapped[camelKey] = mapped[key];
      delete mapped[key];
    }
  });
  if (mapped.amount !== undefined) mapped.amount = Number(mapped.amount);
  if (mapped.price !== undefined) mapped.price = Number(mapped.price);
  if (mapped.totalAmount !== undefined) mapped.totalAmount = Number(mapped.totalAmount);
  if (mapped.stock !== undefined) mapped.stock = Number(mapped.stock);
  if (mapped.isActive !== undefined) mapped.isActive = Number(mapped.isActive) === 1;
  if (mapped.quantity !== undefined) mapped.quantity = Number(mapped.quantity);
  return mapped;
}

function requireHttps(req, res) {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
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

function getAuthUser(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const decoded = verifyToken(auth.slice(7));
  if (!decoded?.userId) return null;
  const rows = db.query(`SELECT id, name, email, role FROM users WHERE id = ${db.escapeSql(decoded.userId)} LIMIT 1`);
  return rows[0] ? toCamelRow(rows[0]) : null;
}

function requireAuth(req, res) {
  const user = getAuthUser(req);
  if (!user) {
    json(res, 401, { error: 'Unauthorized' });
    return null;
  }
  return user;
}

function requireAdmin(user, res) {
  if (!user || user.role !== 'admin') {
    json(res, 403, { error: 'Admin access required' });
    return false;
  }
  return true;
}

function seedDemoData() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@ledgerpro.shop';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';

  const existingAdmin = db.query(`SELECT id FROM users WHERE role='admin' LIMIT 1`);
  if (!existingAdmin.length) {
    db.execute(`
      INSERT INTO users (id, name, email, password_hash, role)
      VALUES (
        ${db.escapeSql(createId('usr'))},
        ${db.escapeSql('Administrator')},
        ${db.escapeSql(adminEmail)},
        ${db.escapeSql(hashPassword(adminPassword))},
        'admin'
      )
    `);
  }

  const productsCount = db.query('SELECT COUNT(*) AS total FROM products')[0];
  if (Number(productsCount?.total || 0) === 0) {
    const demoProducts = [
      ['prod_1', 'Wireless Business Headset', 'Comfort headset for video calls and customer support.', 'Electronics', 129.0, 30, 'https://images.unsplash.com/photo-1585298723682-7115561c51b7'],
      ['prod_2', 'Portable Label Printer', 'Compact printer for invoices and warehouse labels.', 'Office', 89.0, 50, 'https://images.unsplash.com/photo-1588508065123-287b28e013da'],
      ['prod_3', 'Financial Planner Notebook', 'Premium planner for budgeting and finance notes.', 'Stationery', 24.0, 120, 'https://images.unsplash.com/photo-1517842645767-c639042777db']
    ];

    demoProducts.forEach((p) => {
      db.execute(`
        INSERT INTO products (id, title, description, category, price, stock, image_url, is_active)
        VALUES (${p.map(db.escapeSql).join(', ')}, 1)
      `);
    });
  }
}

async function handleAuth(req, res, pathname) {
  if (req.method === 'POST' && pathname === '/api/auth/register') {
    const body = await parseBody(req).catch((error) => json(res, 400, { error: error.message }));
    if (!body || res.writableEnded) return true;

    const { email, password, name } = body;
    if (!email || !password || !name) {
      json(res, 400, { error: 'name, email, password required' });
      return true;
    }

    const exists = db.query(`SELECT id FROM users WHERE email = ${db.escapeSql(email)} LIMIT 1`);
    if (exists.length) {
      json(res, 409, { error: 'Email already registered' });
      return true;
    }

    const user = { id: createId('usr'), email, name, role: 'customer' };
    db.execute(`
      INSERT INTO users (id, name, email, password_hash, role)
      VALUES (
        ${db.escapeSql(user.id)},
        ${db.escapeSql(user.name)},
        ${db.escapeSql(user.email)},
        ${db.escapeSql(hashPassword(password))},
        'customer'
      )
    `);

    const token = createToken({ userId: user.id, email: user.email, role: user.role });
    json(res, 201, { token, user });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const body = await parseBody(req).catch((error) => json(res, 400, { error: error.message }));
    if (!body || res.writableEnded) return true;

    const users = db.query(`
      SELECT id, name, email, role, password_hash
      FROM users
      WHERE email = ${db.escapeSql(body.email)}
      LIMIT 1
    `);
    const user = users[0];

    if (!user || !verifyPassword(body.password || '', user.password_hash)) {
      json(res, 401, { error: 'Invalid credentials' });
      return true;
    }

    const safeUser = toCamelRow({ id: user.id, name: user.name, email: user.email, role: user.role });
    const token = createToken({ userId: safeUser.id, email: safeUser.email, role: safeUser.role });
    json(res, 200, { token, user: safeUser });
    return true;
  }

  return false;
}

function fetchSummaryForAdmin() {
  const incomeRow = db.query('SELECT COALESCE(SUM(total_amount), 0) AS totalRevenue FROM orders WHERE status <> "cancelled"')[0];
  const expenseRow = db.query('SELECT COALESCE(SUM(amount), 0) AS totalExpenses FROM expenses')[0];
  const ordersCountRow = db.query('SELECT COUNT(*) AS ordersCount FROM orders')[0];
  const invoicesCountRow = db.query('SELECT COUNT(*) AS invoicesCount FROM invoices')[0];
  const clientsCountRow = db.query('SELECT COUNT(*) AS clientsCount FROM clients')[0];

  const totalRevenue = Number(incomeRow?.totalRevenue || 0);
  const totalExpenses = Number(expenseRow?.totalExpenses || 0);

  return {
    totalRevenue,
    totalExpenses,
    netProfit: totalRevenue - totalExpenses,
    ordersCount: Number(ordersCountRow?.ordersCount || 0),
    invoicesCount: Number(invoicesCountRow?.invoicesCount || 0),
    clientsCount: Number(clientsCountRow?.clientsCount || 0)
  };
}

async function handler(req, res) {
  if (!requireHttps(req, res)) return;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) return sendStatic(req, res, pathname);

  const authHandled = await handleAuth(req, res, pathname);
  if (authHandled) return;

  if (req.method === 'GET' && pathname === '/api/products') {
    const products = db.query('SELECT * FROM products WHERE is_active = 1 ORDER BY created_at DESC').map(toCamelRow);
    return json(res, 200, products);
  }

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET' && pathname === '/api/me') return json(res, 200, user);

  if (req.method === 'GET' && pathname === '/api/orders/my') {
    const orders = db.query(`
      SELECT o.*, p.title AS product_title
      FROM orders o
      JOIN products p ON p.id = o.product_id
      WHERE o.user_id = ${db.escapeSql(user.id)}
      ORDER BY o.created_at DESC
    `).map(toCamelRow);
    return json(res, 200, orders);
  }

  if (req.method === 'POST' && pathname === '/api/orders/checkout') {
    const body = await parseBody(req).catch((error) => json(res, 400, { error: error.message }));
    if (!body || res.writableEnded) return;

    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return json(res, 400, { error: 'Cart is empty' });

    let ordersCreated = 0;
    for (const item of items) {
      const qty = Number(item.quantity || 0);
      if (!item.id || qty <= 0) continue;

      const product = db.query(`SELECT * FROM products WHERE id = ${db.escapeSql(item.id)} AND is_active = 1 LIMIT 1`)[0];
      if (!product) continue;
      if (Number(product.stock) < qty) continue;

      const totalAmount = Number(product.price) * qty;
      const orderId = createId('ord');

      db.execute(`
        INSERT INTO orders (id, user_id, product_id, quantity, total_amount, status, shipping_address)
        VALUES (
          ${db.escapeSql(orderId)},
          ${db.escapeSql(user.id)},
          ${db.escapeSql(product.id)},
          ${db.escapeSql(qty)},
          ${db.escapeSql(totalAmount)},
          'awaiting_payment',
          ${db.escapeSql(body.shippingAddress || '')}
        )
      `);
      db.execute(`UPDATE products SET stock = stock - ${db.escapeSql(qty)} WHERE id = ${db.escapeSql(product.id)}`);
      ordersCreated += 1;
    }

    return json(res, 201, { ordersCreated, status: 'awaiting_payment' });
  }

  if (pathname.startsWith('/api/admin/')) {
    if (!requireAdmin(user, res)) return;

    if (req.method === 'GET' && pathname === '/api/admin/summary') {
      return json(res, 200, fetchSummaryForAdmin());
    }

    const resources = {
      products: { fields: ['title', 'description', 'category', 'price', 'stock', 'image_url', 'is_active'], idPrefix: 'prd' },
      clients: { fields: ['user_id', 'name', 'email'], idPrefix: 'cli' },
      invoices: { fields: ['user_id', 'client_name', 'amount', 'status'], idPrefix: 'inv' },
      expenses: { fields: ['user_id', 'category', 'amount'], idPrefix: 'exp' },
      orders: { fields: ['user_id', 'product_id', 'quantity', 'total_amount', 'status', 'shipping_address'], idPrefix: 'ord' }
    };

    const parts = pathname.split('/').filter(Boolean);
    const resource = parts[2];
    const id = parts[3];
    const cfg = resources[resource];
    if (!cfg) return json(res, 404, { error: 'Admin endpoint not found' });

    if (req.method === 'GET' && !id) {
      const rows = db.query(`SELECT * FROM ${resource} ORDER BY created_at DESC`).map(toCamelRow);
      return json(res, 200, rows);
    }

    if (req.method === 'POST' && !id) {
      const body = await parseBody(req).catch((error) => json(res, 400, { error: error.message }));
      if (!body || res.writableEnded) return;

      const payload = {
        ...body,
        user_id: body.userId,
        client_name: body.clientName,
        product_id: body.productId,
        total_amount: body.totalAmount,
        shipping_address: body.shippingAddress,
        image_url: body.imageUrl,
        is_active: body.isActive === false ? 0 : 1
      };

      const newId = createId(cfg.idPrefix);
      const columns = ['id', ...cfg.fields];
      const values = [newId, ...cfg.fields.map((field) => payload[field])];
      db.execute(`INSERT INTO ${resource} (${columns.join(', ')}) VALUES (${values.map(db.escapeSql).join(', ')})`);
      const created = db.query(`SELECT * FROM ${resource} WHERE id = ${db.escapeSql(newId)} LIMIT 1`)[0];
      return json(res, 201, toCamelRow(created));
    }

    if (!id) return json(res, 400, { error: 'Resource id required' });

    const existing = db.query(`SELECT * FROM ${resource} WHERE id = ${db.escapeSql(id)} LIMIT 1`)[0];
    if (!existing) return json(res, 404, { error: 'Record not found' });

    if (req.method === 'GET') return json(res, 200, toCamelRow(existing));

    if (req.method === 'PUT') {
      const body = await parseBody(req).catch((error) => json(res, 400, { error: error.message }));
      if (!body || res.writableEnded) return;

      const updates = { ...existing, ...body };
      updates.user_id = body.userId ?? updates.user_id;
      updates.client_name = body.clientName ?? updates.client_name;
      updates.product_id = body.productId ?? updates.product_id;
      updates.total_amount = body.totalAmount ?? updates.total_amount;
      updates.shipping_address = body.shippingAddress ?? updates.shipping_address;
      updates.image_url = body.imageUrl ?? updates.image_url;
      if (body.isActive !== undefined) updates.is_active = body.isActive ? 1 : 0;

      const setExpr = cfg.fields.map((field) => `${field} = ${db.escapeSql(updates[field])}`).join(', ');
      db.execute(`UPDATE ${resource} SET ${setExpr} WHERE id = ${db.escapeSql(id)}`);
      const updated = db.query(`SELECT * FROM ${resource} WHERE id = ${db.escapeSql(id)} LIMIT 1`)[0];
      return json(res, 200, toCamelRow(updated));
    }

    if (req.method === 'DELETE') {
      db.execute(`DELETE FROM ${resource} WHERE id = ${db.escapeSql(id)}`);
      return json(res, 200, toCamelRow(existing));
    }

    return json(res, 405, { error: 'Method not allowed' });
  }

  return json(res, 404, { error: 'API endpoint not found' });
}

db.initDatabase();
seedDemoData();

const server = http.createServer((req, res) => {
  handler(req, res).catch((error) => {
    json(res, 500, { error: error.message || 'Internal server error' });
  });
});

server.listen(PORT, () => {
  console.log(`Accounting shop app running on http://localhost:${PORT}`);
});
