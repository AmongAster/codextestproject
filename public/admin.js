const messageEl = document.getElementById('admin-message');
const authCardEl = document.getElementById('admin-auth-card');
const appEl = document.getElementById('admin-app');
let token = localStorage.getItem('token') || '';

function setMessage(msg, isError = false) {
  messageEl.style.color = isError ? '#b91c1c' : '#166534';
  messageEl.textContent = msg;
}

function currency(value) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
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

function bindForm(formId, endpoint) {
  document.getElementById(formId).addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.target).entries());
    ['amount', 'price', 'stock'].forEach((k) => {
      if (payload[k] !== undefined && payload[k] !== '') payload[k] = Number(payload[k]);
    });
    try {
      await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      event.target.reset();
      setMessage('Сохранено');
      await loadAdmin();
    } catch (error) {
      setMessage(error.message, true);
    }
  });
}

function renderSimpleList(targetId, items, formatter) {
  const list = document.getElementById(targetId);
  list.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = formatter(item);
    list.appendChild(li);
  });
}

function renderOrders(orders) {
  const list = document.getElementById('admin-orders');
  list.innerHTML = '';
  orders.forEach((order) => {
    const li = document.createElement('li');
    li.className = 'order-row';
    li.innerHTML = `
      <div>${order.id} • user: ${order.userId} • ${currency(order.totalAmount)}</div>
      <div class="order-actions">
        <select>
          <option value="awaiting_payment" ${order.status === 'awaiting_payment' ? 'selected' : ''}>awaiting_payment</option>
          <option value="paid" ${order.status === 'paid' ? 'selected' : ''}>paid</option>
          <option value="processing" ${order.status === 'processing' ? 'selected' : ''}>processing</option>
          <option value="shipped" ${order.status === 'shipped' ? 'selected' : ''}>shipped</option>
          <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>cancelled</option>
        </select>
        <button>Изменить</button>
      </div>
    `;
    const select = li.querySelector('select');
    li.querySelector('button').addEventListener('click', async () => {
      try {
        await api(`/api/admin/orders/${order.id}`, {
          method: 'PUT',
          body: JSON.stringify({ status: select.value })
        });
        setMessage(`Статус ${order.id} обновлен`);
        await loadAdmin();
      } catch (error) {
        setMessage(error.message, true);
      }
    });
    list.appendChild(li);
  });
}

async function loadAdmin() {
  const me = await api('/api/me');
  if (me.role !== 'admin') throw new Error('Нужна роль администратора');

  authCardEl.classList.add('hidden');
  appEl.classList.remove('hidden');

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

  renderOrders(orders);
  renderSimpleList('admin-products', products, (p) => `${p.title} • ${currency(p.price)} • stock ${p.stock}`);
  renderSimpleList('admin-invoices', invoices, (i) => `${i.clientName} • ${currency(i.amount)} • ${i.status}`);
  renderSimpleList('admin-expenses', expenses, (e) => `${e.category} • ${currency(e.amount)}`);
}

bindForm('product-form', '/api/admin/products');
bindForm('invoice-form', '/api/admin/invoices');
bindForm('expense-form', '/api/admin/expenses');

document.getElementById('admin-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target).entries());
  try {
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
    token = result.token;
    localStorage.setItem('token', token);
    await loadAdmin();
    setMessage('Успешный вход в админку');
  } catch (error) {
    setMessage(error.message, true);
  }
});

loadAdmin().catch(() => {
  authCardEl.classList.remove('hidden');
  appEl.classList.add('hidden');
});
