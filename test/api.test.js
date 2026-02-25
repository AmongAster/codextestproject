const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');

const PORT = 3301;
let server;
let canRunMysqlTests = true;

function checkMysqlCli() {
  try {
    execFileSync('mysql', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function waitForServer(proc) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server start timeout')), 10000);
    proc.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Accounting shop app running')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    proc.stderr.on('data', (chunk) => {
      if (chunk.toString().toLowerCase().includes('mysql command failed')) {
        clearTimeout(timeout);
        reject(new Error(chunk.toString()));
      }
    });
    proc.on('exit', (code) => reject(new Error(`Server exited ${code}`)));
  });
}

test.before(async () => {
  canRunMysqlTests = checkMysqlCli();
  if (!canRunMysqlTests) return;

  server = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', JWT_SECRET: 'test-secret' }
  });

  try {
    await waitForServer(server);
  } catch {
    canRunMysqlTests = false;
    if (server) server.kill();
  }
});

test.after(() => {
  if (server) server.kill();
});

async function request(path, options = {}) {
  const response = await fetch(`http://localhost:${PORT}${path}`, options);
  const body = await response.json();
  return { status: response.status, body };
}

test('customer checkout creates awaiting_payment order and admin can update status', async (t) => {
  if (!canRunMysqlTests) {
    t.skip('MySQL is not available in this environment.');
    return;
  }

  const email = `customer${Date.now()}@mail.com`;
  const register = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Customer', email, password: 'P@ssw0rd1' })
  });
  assert.equal(register.status, 201);

  const products = await request('/api/products');
  assert.equal(products.status, 200);
  assert.ok(products.body.length > 0);

  const checkout = await request('/api/orders/checkout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${register.body.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ id: products.body[0].id, quantity: 1 }], shippingAddress: 'test' })
  });
  assert.equal(checkout.status, 201);
  assert.equal(checkout.body.status, 'awaiting_payment');

  const myOrders = await request('/api/orders/my', { headers: { Authorization: `Bearer ${register.body.token}` } });
  assert.equal(myOrders.status, 200);
  assert.equal(myOrders.body[0].status, 'awaiting_payment');

  const adminLogin = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@ledgerpro.shop', password: 'Admin123!' })
  });
  assert.equal(adminLogin.status, 200);

  const orderId = myOrders.body[0].id;
  const update = await request(`/api/admin/orders/${orderId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${adminLogin.body.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'paid' })
  });
  assert.equal(update.status, 200);
  assert.equal(update.body.status, 'paid');
});
