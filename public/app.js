const messageEl = document.getElementById('message');
const authStateEl = document.getElementById('auth-state');
const authPanelEl = document.getElementById('auth-panel');
const customerPanelEl = document.getElementById('customer-panel');
const adminPanelEl = document.getElementById('admin-panel');

let token = localStorage.getItem('token') || '';
let currentUser = null;

function setMessage(text, isError = false) {
  messageEl.style.color = isError ? '#fca5a5' : '#86efac';
  messageEl.textContent = text;
}

function currency(value) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value || 0));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function logout() {
  token = '';
  currentUser = null;
  localStorage.removeItem('token');
  authPanelEl.classList.remove('hidden');
  customerPanelEl.classList.add('hidden');
  adminPanelEl.classList.add('hidden');
  authStateEl.textContent = 'Не авторизован';
}

async function loadProducts() {
  const products = await api('/api/products');
  const grid = document.getElementById('products-grid');
  grid.innerHTML = '';

  products.forEach((product) => {
    const card = document.createElement('article');
    card.className = 'product-card';
    card.innerHTML = `
      <img src="${product.imageUrl || 'https://images.unsplash.com/photo-1556742031-c6961e8560b0'}" alt="${product.title}" />
      <div class="content">
        <h3>${product.title}</h3>
        <p>${product.description || ''}</p>
        <strong>${currency(product.price)}</strong>
        <small>Остаток: ${product.stock}</small>
        <form class="inline" data-product-id="${product.id}">
          <input name="quantity" type="number" min="1" value="1" required />
          <button type="submit">Купить</button>
        </form>
      </div>
    `;

    const form = card.querySelector('form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!token) return setMessage('Сначала выполните вход.', true);

      const quantity = Number(new FormData(form).get('quantity') || 1);
      try {
        await api('/api/orders', {
          method: 'POST',
          body: JSON.stringify({ productId: product.id, quantity, shippingAddress: 'Default customer address' })
        });
        setMessage('Заказ создан.');
        await Promise.all([loadProducts(), loadCustomerOrders(), loadAdminData()]);
      } catch (error) {
        setMessage(error.message, true);
      }
    });

    grid.appendChild(card);
  });
}

function renderList(targetId, items, formatter) {
  const list = document.getElementById(targetId);
  list.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = formatter(item);
    list.appendChild(li);
  });
}

async function loadCustomerOrders() {
  if (!token || !currentUser) return;
  const orders = await api('/api/orders/my');
  renderList('customer-orders', orders, (o) => `${o.status.toUpperCase()} • ${o.productTitle || o.productId} • x${o.quantity} • ${currency(o.totalAmount)}`);
}

async function loadAdminData() {
  if (!currentUser || currentUser.role !== 'admin') return;

  const [summary, products, orders, invoices, expenses] = await Promise.all([
    api('/api/admin/summary'),
    api('/api/admin/products'),
    api('/api/admin/orders'),
    api('/api/admin/invoices'),
    api('/api/admin/expenses')
  ]);

  document.getElementById('admin-kpis').innerHTML = [
    ['Revenue', currency(summary.totalRevenue)],
    ['Expenses', currency(summary.totalExpenses)],
    ['Net', currency(summary.netProfit)],
    ['Orders', String(summary.ordersCount)],
    ['Invoices', String(summary.invoicesCount)],
    ['Clients', String(summary.clientsCount)]
  ].map(([k, v]) => `<article class="kpi"><strong>${k}</strong><br/>${v}</article>`).join('');

  renderList('admin-products', products, (p) => `${p.title} • ${currency(p.price)} • stock: ${p.stock}`);
  renderList('admin-orders', orders, (o) => `${o.id} • ${o.status} • ${currency(o.totalAmount)}`);
  renderList('admin-invoices', invoices, (i) => `${i.clientName} • ${currency(i.amount)} • ${i.status}`);
  renderList('admin-expenses', expenses, (e) => `${e.category} • ${currency(e.amount)}`);
}

function bindForm(formId, endpoint) {
  document.getElementById(formId).addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.target).entries());

    ['price', 'stock', 'amount'].forEach((field) => {
      if (payload[field] !== undefined && payload[field] !== '') payload[field] = Number(payload[field]);
    });

    try {
      const result = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      if (result.token) {
        token = result.token;
        localStorage.setItem('token', token);
        await bootstrap();
      } else {
        await Promise.all([loadProducts(), loadCustomerOrders(), loadAdminData()]);
      }
      event.target.reset();
      setMessage('Успешно сохранено.');
    } catch (error) {
      setMessage(error.message, true);
    }
  });
}

async function bootstrap() {
  await loadProducts();

  if (!token) return logout();

  try {
    currentUser = await api('/api/me');
    authPanelEl.classList.add('hidden');
    authStateEl.textContent = `${currentUser.name} (${currentUser.role})`;

    if (currentUser.role === 'admin') {
      adminPanelEl.classList.remove('hidden');
      customerPanelEl.classList.add('hidden');
      await loadAdminData();
    } else {
      customerPanelEl.classList.remove('hidden');
      adminPanelEl.classList.add('hidden');
      await loadCustomerOrders();
    }
  } catch {
    logout();
  }
}

bindForm('register-form', '/api/auth/register');
bindForm('login-form', '/api/auth/login');
bindForm('product-form', '/api/admin/products');
bindForm('invoice-form', '/api/admin/invoices');
bindForm('expense-form', '/api/admin/expenses');

document.getElementById('refresh-shop').addEventListener('click', () => loadProducts().catch((e) => setMessage(e.message, true)));
document.getElementById('refresh-orders').addEventListener('click', () => loadCustomerOrders().catch((e) => setMessage(e.message, true)));
document.getElementById('refresh-admin').addEventListener('click', () => loadAdminData().catch((e) => setMessage(e.message, true)));
authStateEl.addEventListener('dblclick', logout);

bootstrap();
