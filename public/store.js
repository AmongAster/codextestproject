const messageEl = document.getElementById('message');
const authCardEl = document.getElementById('auth-card');
const accountCardEl = document.getElementById('account-card');
const cartPanelEl = document.getElementById('cart-panel');
const cartCountEl = document.getElementById('cart-count');

let token = localStorage.getItem('token') || '';
let currentUser = null;
let products = [];
let cart = JSON.parse(localStorage.getItem('cart') || '[]');

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

function persistCart() {
  localStorage.setItem('cart', JSON.stringify(cart));
  cartCountEl.textContent = String(cart.reduce((sum, item) => sum + item.quantity, 0));
}

function renderCart() {
  const list = document.getElementById('cart-list');
  const totalEl = document.getElementById('cart-total');
  list.innerHTML = '';

  let total = 0;
  cart.forEach((item) => {
    const li = document.createElement('li');
    const lineTotal = Number(item.price) * item.quantity;
    total += lineTotal;
    li.innerHTML = `${item.title} • x${item.quantity} • ${currency(lineTotal)} <button data-remove="${item.id}" class="secondary">Удалить</button>`;
    list.appendChild(li);
  });

  list.querySelectorAll('button[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-remove');
      cart = cart.filter((x) => x.id !== id);
      persistCart();
      renderCart();
    });
  });

  totalEl.textContent = currency(total);
}

function addToCart(product, quantity) {
  const existing = cart.find((x) => x.id === product.id);
  if (existing) existing.quantity += quantity;
  else cart.push({ id: product.id, title: product.title, price: Number(product.price), quantity });
  persistCart();
  renderCart();
  setMessage('Товар добавлен в корзину.');
}

function renderProducts(filter = '') {
  const grid = document.getElementById('products-grid');
  grid.innerHTML = '';

  const filtered = products.filter((p) => p.title.toLowerCase().includes(filter.toLowerCase()));
  filtered.forEach((product) => {
    const card = document.createElement('article');
    card.className = 'product-card';
    card.innerHTML = `
      <img src="${product.imageUrl || 'https://images.unsplash.com/photo-1556742502-ec7c0e9f34b1'}" alt="${product.title}" />
      <div class="product-content">
        <h3>${product.title}</h3>
        <p>${product.description || ''}</p>
        <div class="price">${currency(product.price)}</div>
        <small>Остаток: ${product.stock}</small>
        <div class="order-actions">
          <input type="number" min="1" value="1" />
          <button>В корзину</button>
        </div>
      </div>
    `;
    const qtyInput = card.querySelector('input');
    const addBtn = card.querySelector('button');
    addBtn.addEventListener('click', () => {
      const quantity = Number(qtyInput.value || 1);
      if (quantity <= 0) return;
      addToCart(product, quantity);
    });

    grid.appendChild(card);
  });
}

async function loadProducts() {
  products = await api('/api/products');
  renderProducts(document.getElementById('search-input').value);
}

async function loadMe() {
  if (!token) {
    currentUser = null;
    authCardEl.classList.remove('hidden');
    accountCardEl.classList.add('hidden');
    return;
  }

  try {
    currentUser = await api('/api/me');
    authCardEl.classList.add('hidden');
    accountCardEl.classList.remove('hidden');
    document.getElementById('me-line').textContent = `${currentUser.name} (${currentUser.email})`;
    await loadMyOrders();
  } catch {
    token = '';
    currentUser = null;
    localStorage.removeItem('token');
    authCardEl.classList.remove('hidden');
    accountCardEl.classList.add('hidden');
  }
}

async function loadMyOrders() {
  if (!token) return;
  const orders = await api('/api/orders/my');
  const list = document.getElementById('my-orders');
  list.innerHTML = '';
  orders.forEach((order) => {
    const li = document.createElement('li');
    li.textContent = `${order.id} • ${order.status} • ${currency(order.totalAmount)} • ${order.productTitle || order.productId}`;
    list.appendChild(li);
  });
}

async function checkoutCart() {
  if (!token) return setMessage('Войдите в аккаунт для оплаты.', true);
  if (!cart.length) return setMessage('Корзина пуста.', true);

  try {
    const result = await api('/api/orders/checkout', {
      method: 'POST',
      body: JSON.stringify({ items: cart, shippingAddress: 'Customer address' })
    });
    setMessage(`Создано заказов: ${result.ordersCreated}. Статус: ожидает оплаты.`);
    cart = [];
    persistCart();
    renderCart();
    await Promise.all([loadProducts(), loadMyOrders()]);
  } catch (error) {
    setMessage(error.message, true);
  }
}

function bindAuthForms() {
  document.getElementById('register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.target).entries());
    try {
      const data = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
      token = data.token;
      localStorage.setItem('token', token);
      event.target.reset();
      await loadMe();
      setMessage('Регистрация выполнена.');
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.target).entries());
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
      token = data.token;
      localStorage.setItem('token', token);
      event.target.reset();
      await loadMe();
      setMessage('Вход выполнен.');
    } catch (error) {
      setMessage(error.message, true);
    }
  });
}

document.getElementById('search-input').addEventListener('input', (e) => renderProducts(e.target.value));
document.getElementById('cart-open-btn').addEventListener('click', () => cartPanelEl.classList.toggle('hidden'));
document.getElementById('checkout-btn').addEventListener('click', checkoutCart);
document.getElementById('logout-btn').addEventListener('click', () => {
  token = '';
  currentUser = null;
  localStorage.removeItem('token');
  loadMe();
});

bindAuthForms();
persistCart();
renderCart();
loadProducts().catch((e) => setMessage(e.message, true));
loadMe().catch((e) => setMessage(e.message, true));
