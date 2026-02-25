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
    const timeout = setTimeout(() => reject(new Error('Server start timeout')), 8000);
    proc.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Accounting app running')) {
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
  const json = await response.json();
  return { status: response.status, body: json };
}

test('register, authenticate, and perform CRUD/report operations', async (t) => {
  if (!canRunMysqlTests) {
    t.skip('MySQL is not available in this environment.');
    return;
  }

  const unique = Date.now();
  const email = `tester${unique}@mail.com`;

  const register = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Tester', email, password: 'P@ssw0rd1' })
  });

  assert.equal(register.status, 201);
  assert.ok(register.body.token);

  const authHeader = { Authorization: `Bearer ${register.body.token}`, 'Content-Type': 'application/json' };

  const createClient = await request('/api/clients', {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({ name: 'ACME Corp', email: 'billing@acme.com' })
  });
  assert.equal(createClient.status, 201);

  const createInvoice = await request('/api/invoices', {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({ clientName: 'ACME Corp', amount: 5000, status: 'pending' })
  });
  assert.equal(createInvoice.status, 201);

  const createExpense = await request('/api/expenses', {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({ category: 'Software', amount: 700 })
  });
  assert.equal(createExpense.status, 201);

  const summary = await request('/api/reports/summary', { headers: authHeader });
  assert.equal(summary.status, 200);
  assert.equal(summary.body.totalIncome, 5000);
  assert.equal(summary.body.totalExpenses, 700);
  assert.equal(summary.body.netProfit, 4300);
});
