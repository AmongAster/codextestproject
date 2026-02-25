const caseGrid = document.getElementById('caseGrid');
const spinBtn = document.getElementById('spinBtn');
const selectedCaseLabel = document.getElementById('selectedCaseLabel');
const roller = document.getElementById('roller');
const winner = document.getElementById('winner');
const adminCase = document.getElementById('adminCase');
const adminForm = document.getElementById('adminForm');
const adminStatus = document.getElementById('adminStatus');
const paymentForm = document.getElementById('paymentForm');
const paymentResult = document.getElementById('paymentResult');

let caseList = [];
let selectedCaseId = null;

function itemHtml(item) {
  return `<div class="roller-item ${item.rarity}"><strong>${item.name}</strong><br/><small>${item.rarity.toUpperCase()} • $${Number(item.value).toFixed(2)}</small></div>`;
}

async function loadCases() {
  const response = await fetch('/api/cases');
  caseList = await response.json();

  caseGrid.innerHTML = '';
  adminCase.innerHTML = '';

  caseList.forEach((gameCase, idx) => {
    const card = document.createElement('button');
    card.className = `case-card ${idx === 0 ? 'active' : ''}`;
    card.innerHTML = `<h3>${gameCase.name}</h3><p>Price: $${gameCase.price.toFixed(2)}</p><p>${gameCase.items.length} items</p>`;
    card.onclick = () => selectCase(gameCase.id);
    caseGrid.appendChild(card);

    const opt = document.createElement('option');
    opt.value = gameCase.id;
    opt.textContent = gameCase.name;
    adminCase.appendChild(opt);
  });

  if (caseList.length > 0) {
    selectCase(caseList[0].id);
  }
}

function selectCase(caseId) {
  selectedCaseId = caseId;
  spinBtn.disabled = false;
  const selected = caseList.find((c) => c.id === caseId);
  selectedCaseLabel.textContent = `Selected: ${selected.name} ($${selected.price.toFixed(2)})`;

  document.querySelectorAll('.case-card').forEach((card, idx) => {
    card.classList.toggle('active', caseList[idx].id === caseId);
  });
}

spinBtn.addEventListener('click', async () => {
  spinBtn.disabled = true;
  winner.textContent = 'Rolling...';
  roller.style.transition = 'none';
  roller.style.transform = 'translateX(0px)';

  const response = await fetch('/api/battle/spin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseId: selectedCaseId })
  });
  const result = await response.json();

  roller.innerHTML = result.reel.map(itemHtml).join('');

  requestAnimationFrame(() => {
    const itemWidth = 136;
    const target = (result.winnerIndex * itemWidth) - (roller.parentElement.clientWidth / 2) + (itemWidth / 2);
    roller.style.transition = 'transform 4.2s cubic-bezier(.13,.8,.15,1)';
    roller.style.transform = `translateX(${-target}px)`;
  });

  setTimeout(() => {
    winner.textContent = `Winner: ${result.winner.name} (${result.winner.rarity}) - $${Number(result.winner.value).toFixed(2)}`;
    spinBtn.disabled = false;
  }, 4300);
});

adminForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  adminStatus.textContent = 'Saving item...';

  const payload = {
    caseId: document.getElementById('adminCase').value,
    item: {
      name: document.getElementById('itemName').value,
      rarity: document.getElementById('itemRarity').value,
      value: Number(document.getElementById('itemValue').value),
      weight: Number(document.getElementById('itemWeight').value || 1),
      image: document.getElementById('itemImage').value
    }
  };

  const response = await fetch('/api/admin/items', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': document.getElementById('adminToken').value
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json();
  if (!response.ok) {
    adminStatus.textContent = `Error: ${body.error}`;
    return;
  }

  adminStatus.textContent = `Added: ${body.name}`;
  adminForm.reset();
  await loadCases();
});

paymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  paymentResult.textContent = 'Creating payment intent...';

  const response = await fetch('/api/payment/create-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amountUsd: Number(document.getElementById('paymentAmount').value) })
  });

  const body = await response.json();
  paymentResult.textContent = JSON.stringify(body, null, 2);
});

loadCases();
