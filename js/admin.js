(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const loginPanel = document.getElementById('loginForm');
  const ordersPanel = document.getElementById('ordersPanel');
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');
  const list = document.getElementById('orderList');
  const statusFilter = document.getElementById('statusFilter');
  const TOKEN_KEY = 'pop_admin_token';

  function token() { return sessionStorage.getItem(TOKEN_KEY) || ''; }
  function headers(json) {
    const h = { 'x-pop-request': '1', authorization: `Bearer ${token()}` };
    if (json) h['content-type'] = 'application/json';
    return h;
  }
  function safeUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch (e) { /* not a url */ }
    return '';
  }
  function address(customer) {
    const a = customer.address || {};
    return [a.line1, a.line2, a.suburb, a.city, a.province, a.postalCode].filter(Boolean).join(', ');
  }

  function showLogin(message) {
    loginPanel.hidden = false;
    ordersPanel.hidden = true;
    if (message) {
      loginError.textContent = message;
      loginError.classList.add('show');
    }
  }

  async function loadOrders() {
    const status = statusFilter.value || 'paid';
    const response = await fetch(`/api/admin/orders?status=${encodeURIComponent(status)}`, { headers: headers(false) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { sessionStorage.removeItem(TOKEN_KEY); showLogin('Sign in again.'); return; }
    if (!response.ok) {
      loginPanel.hidden = true;
      ordersPanel.hidden = false;
      list.textContent = data.error || 'Could not load orders.';
      return;
    }
    loginPanel.hidden = true;
    ordersPanel.hidden = false;
    if (!data.orders.length) {
      list.innerHTML = '<p>No orders in this view yet.</p>';
      return;
    }
    list.innerHTML = data.orders.map((order) => {
      const items = (order.items || []).map((item) => {
        const link = safeUrl(item.temuUrl);
        const temu = link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(link)}</a>` : 'Temu link not set';
        return `<li><strong>${esc(item.qty)} × ${esc(item.name)}</strong>${item.variant ? ` · ${esc(item.variant)}` : ''}<br>
          ${temu}<br>
          SKU ${esc(item.supplierSku || 'not set')} · ${esc(item.supplierNotes || 'no notes')} · supplier cost ${item.temuCost == null ? 'not set' : esc(item.temuCost)}</li>`;
      }).join('');
      const alert = order.alertSentAt ? 'Owner email sent.' : `Owner email not sent${order.alertError ? `: ${esc(order.alertError)}` : '.'}`;
      return `<article class="admin-order" data-id="${esc(order.id)}">
        <div class="order-head"><h2>${esc(order.id)}</h2>
          <span class="pill ${esc(order.status)}">${esc(order.status)}</span>
          ${order.fulfilled ? '<span class="pill done">Fulfilled on Temu</span>' : ''}
        </div>
        <p class="admin-meta">${esc(order.customer.name)} · ${esc(order.customer.email)} · ${esc(order.customer.phone)}</p>
        <p class="admin-meta">${esc(address(order.customer))}</p>
        <p class="admin-meta">Paid ${esc(order.amount)} ZAR · PayFast payment id ${esc(order.pfPaymentId || '—')} · ${esc(alert)}</p>
        <ul class="admin-items">${items}</ul>
        <form class="admin-actions">
          <label><input type="checkbox" name="fulfilled" ${order.fulfilled ? 'checked' : ''}> Fulfilled on Temu</label>
          <input type="text" name="temuOrderNumber" value="${esc(order.temuOrderNumber || '')}" placeholder="Temu order number" maxlength="64">
          <button type="submit">Save</button>
        </form>
      </article>`;
    }).join('');
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.remove('show');
    const password = new FormData(loginForm).get('password');
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pop-request': '1' },
      body: JSON.stringify({ password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      loginError.textContent = data.error || 'Could not sign in.';
      loginError.classList.add('show');
      return;
    }
    sessionStorage.setItem(TOKEN_KEY, data.token);
    loginForm.reset();
    loadOrders();
  });

  statusFilter.addEventListener('change', loadOrders);
  document.getElementById('logoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem(TOKEN_KEY);
    showLogin('');
  });
  document.getElementById('csvBtn').addEventListener('click', async () => {
    const status = statusFilter.value || 'paid';
    const response = await fetch(`/api/admin/orders.csv?status=${encodeURIComponent(status)}`, { headers: headers(false) });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pieces-of-peace-orders.csv';
    a.click();
    URL.revokeObjectURL(url);
  });
  list.addEventListener('submit', async (e) => {
    const form = e.target.closest('form');
    if (!form) return;
    e.preventDefault();
    const article = form.closest('.admin-order');
    const response = await fetch(`/api/admin/orders/${article.dataset.id}`, {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({
        fulfilled: form.fulfilled.checked,
        temuOrderNumber: form.temuOrderNumber.value,
      }),
    });
    if (response.status === 401) { sessionStorage.removeItem(TOKEN_KEY); showLogin('Sign in again.'); return; }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      alert(data.error || 'Could not save.');
      return;
    }
    loadOrders();
  });

  if (token()) loadOrders();
  else showLogin('');
})();
