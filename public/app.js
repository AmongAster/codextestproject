const messageEl = document.getElementById('message');
const dashboardEl = document.getElementById('dashboard');
const authCardEl = document.getElementById('auth-card');

let token = localStorage.getItem('token') || '';

function setMessage(message, error = false) {
  messageEl.style.color = error ? '#b91c1c' : '#166534';
  messageEl.textContent = message;
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
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount || 0));
}

function listItems(targetId, items, formatter) {
  const list = document.getElementById(targetId);
  list.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = formatter(item);
    list.appendChild(li);
  });
}

async function refreshDashboard() {
  const [clients, invoices, expenses, summary] = await Promise.all([
    api('/api/clients'),
    api('/api/invoices'),
    api('/api/expenses'),
    api('/api/reports/summary')
  ]);

  document.getElementById('summary').innerHTML = [
    ['Income', formatCurrency(summary.totalIncome)],
    ['Expenses', formatCurrency(summary.totalExpenses)],
    ['Net Profit', formatCurrency(summary.netProfit)],
    ['Outstanding', formatCurrency(summary.outstandingInvoices)]
  ]
    .map(([label, value]) => `<article class="kpi"><strong>${label}</strong><br />${value}</article>`)
    .join('');

  listItems('client-list', clients, (c) => `${c.name} (${c.email})`);
  listItems('invoice-list', invoices, (i) => `${i.clientName}: ${formatCurrency(i.amount)} [${i.status}]`);
  listItems('expense-list', expenses, (e) => `${e.category}: ${formatCurrency(e.amount)}`);
}

async function bootstrapAuthenticatedView() {
  try {
    await api('/api/me');
    authCardEl.classList.add('hidden');
    dashboardEl.classList.remove('hidden');
    await refreshDashboard();
    setMessage('Authenticated. Dashboard loaded.');
  } catch {
    token = '';
    localStorage.removeItem('token');
    authCardEl.classList.remove('hidden');
    dashboardEl.classList.add('hidden');
  }
}

function registerFormHandler(formId, endpoint) {
  document.getElementById(formId).addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = Object.fromEntries(new FormData(event.target).entries());
    try {
      const result = await api(endpoint, { method: 'POST', body: JSON.stringify(formData) });
      if (result.token) {
        token = result.token;
        localStorage.setItem('token', token);
        await bootstrapAuthenticatedView();
      } else {
        await refreshDashboard();
      }
      event.target.reset();
      setMessage('Saved successfully.');
    } catch (error) {
      setMessage(error.message, true);
    }
  });
}

registerFormHandler('register-form', '/api/auth/register');
registerFormHandler('login-form', '/api/auth/login');
registerFormHandler('client-form', '/api/clients');
registerFormHandler('invoice-form', '/api/invoices');
registerFormHandler('expense-form', '/api/expenses');

bootstrapAuthenticatedView();
