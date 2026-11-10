(function () {
  const products = window.PRODUCTS || [];
  const money = (n) => 'R ' + Number(n).toLocaleString('en-ZA');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const findProduct = (id) => products.find((p) => String(p.id) === String(id));
  const forSale = (p) => p && typeof p.price === 'number' && Number.isFinite(p.price) && p.price > 0;

  const summary = document.getElementById('orderSummary');
  const errorBox = document.getElementById('checkoutError');
  const payBtn = document.getElementById('payBtn');
  const form = document.getElementById('checkoutForm');
  if (!summary || !form) return;

  function readCart() {
    try { return JSON.parse(localStorage.getItem('pop_cart') || '[]'); } catch (e) { return []; }
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add('show');
  }
  function clearError() {
    errorBox.textContent = '';
    errorBox.classList.remove('show');
  }

  function render() {
    const cart = readCart().filter((item) => forSale(findProduct(item.id)));
    if (!cart.length) {
      summary.innerHTML = '<p>Your bag is empty. <a href="index.html#shop">Back to the collection</a></p>';
      payBtn.disabled = true;
      return;
    }
    let sum = 0;
    summary.innerHTML = cart.map((item) => {
      const product = findProduct(item.id);
      const line = product.price * item.qty;
      sum += line;
      const variant = item.variant ? `<div>${esc(item.variant)}</div>` : '';
      return `<div class="summary-line">
        <img src="${esc(product.image)}" alt="">
        <div><strong>${esc(product.name)}</strong>${variant}
          <div>${item.qty} &times; ${money(product.price)}</div>
          <button type="button" data-remove="${esc(product.id)}" data-variant="${esc(item.variant || '')}">Remove</button>
        </div>
        <strong>${money(line)}</strong>
      </div>`;
    }).join('') + `<div class="row total"><span>Total</span><span>${money(sum)}</span></div>
      <p class="pay-note">No delivery fee is added here. PayFast takes the card payment. We never see the card number.</p>`;
    payBtn.disabled = false;
  }

  document.addEventListener('pop:cart', render);
  render();

  const PAYFAST_HOSTS = new Set(['sandbox.payfast.co.za', 'www.payfast.co.za']);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const cart = readCart().filter((item) => forSale(findProduct(item.id)));
    if (!cart.length) {
      showError('Your bag is empty.');
      return;
    }
    const data = new FormData(form);
    const payload = {
      company: data.get('company') || '',
      customer: {
        name: data.get('name'),
        email: data.get('email'),
        phone: data.get('phone'),
        address: {
          line1: data.get('line1'),
          line2: data.get('line2'),
          suburb: data.get('suburb'),
          city: data.get('city'),
          province: data.get('province'),
          postalCode: data.get('postalCode'),
        },
      },
      items: cart.map((item) => ({ id: item.id, qty: item.qty, variant: item.variant || '' })),
    };
    payBtn.disabled = true;
    payBtn.textContent = 'Contacting PayFast…';
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pop-request': '1' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        showError(result.error || 'Checkout could not start.');
        payBtn.disabled = false;
        payBtn.textContent = 'Continue to PayFast';
        return;
      }
      const action = new URL(result.processUrl);
      if (action.protocol !== 'https:' || !PAYFAST_HOSTS.has(action.hostname)) {
        showError('The payment page address was not recognised.');
        payBtn.disabled = false;
        payBtn.textContent = 'Continue to PayFast';
        return;
      }
      const redirect = document.createElement('form');
      redirect.method = 'POST';
      redirect.action = result.processUrl;
      for (const pair of result.fields) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = pair[0];
        input.value = pair[1];
        redirect.appendChild(input);
      }
      document.body.appendChild(redirect);
      redirect.submit();
    } catch (err) {
      showError('Checkout could not start. Check your connection and try again.');
      payBtn.disabled = false;
      payBtn.textContent = 'Continue to PayFast';
    }
  });
})();
