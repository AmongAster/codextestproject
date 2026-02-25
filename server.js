const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const port = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me-admin-token';
const STORE_PATH = path.join(__dirname, 'data', 'store.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

function readStore() {
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function weightedPick(items) {
  const totalWeight = items.reduce((sum, item) => sum + Number(item.weight || 1), 0);
  let random = Math.random() * totalWeight;
  for (const item of items) {
    random -= Number(item.weight || 1);
    if (random <= 0) {
      return item;
    }
  }
  return items[items.length - 1];
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.socket.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath === '/' ? 'index.html' : safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return true;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml'
  };

  const contentType = contentTypes[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'GET' && pathname === '/api/cases') {
      const store = readStore();
      sendJson(res, 200, store.cases);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/battle/spin') {
      const body = await readRequestBody(req);
      const store = readStore();
      const selectedCase = store.cases.find((c) => c.id === body.caseId);

      if (!selectedCase) {
        sendJson(res, 404, { error: 'Case not found' });
        return;
      }

      const winningItem = weightedPick(selectedCase.items);
      const reel = Array.from({ length: 35 }).map(() => weightedPick(selectedCase.items));
      reel[31] = winningItem;

      sendJson(res, 200, {
        caseId: body.caseId,
        reel,
        winnerIndex: 31,
        winner: winningItem
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/admin/items') {
      const token = req.headers['x-admin-token'];
      if (token !== ADMIN_TOKEN) {
        sendJson(res, 401, { error: 'Invalid admin token' });
        return;
      }

      const body = await readRequestBody(req);
      const { caseId, item } = body;
      if (!caseId || !item || !item.name || !item.rarity || !item.value) {
        sendJson(res, 400, { error: 'Missing required payload fields' });
        return;
      }

      const store = readStore();
      const selectedCase = store.cases.find((c) => c.id === caseId);
      if (!selectedCase) {
        sendJson(res, 404, { error: 'Case not found' });
        return;
      }

      const idBase = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const newItem = {
        id: `${idBase}-${Date.now()}`,
        name: item.name,
        rarity: item.rarity,
        value: Number(item.value),
        weight: Number(item.weight || 1),
        image: item.image || ''
      };

      selectedCase.items.push(newItem);
      writeStore(store);
      sendJson(res, 201, newItem);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/payment/create-intent') {
      const body = await readRequestBody(req);
      const amountUsd = Number(body.amountUsd || 0);
      if (!amountUsd || amountUsd <= 0) {
        sendJson(res, 400, { error: 'Amount must be greater than 0' });
        return;
      }

      let ethPriceUsd = null;
      try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
        if (response.ok) {
          const payload = await response.json();
          ethPriceUsd = payload?.ethereum?.usd || null;
        }
      } catch (error) {
        ethPriceUsd = null;
      }

      const intentId = `intent_${Date.now()}`;
      sendJson(res, 200, {
        intentId,
        amountUsd,
        provider: 'DemoPay',
        checkoutUrl: `https://payments.example.com/checkout/${intentId}`,
        cryptoEstimate: ethPriceUsd ? `${(amountUsd / ethPriceUsd).toFixed(5)} ETH` : 'unavailable'
      });
      return;
    }

    serveStatic(req, res, pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Server error' });
  }
});

server.listen(port, () => {
  console.log(`Case battle app running at http://localhost:${port}`);
});
