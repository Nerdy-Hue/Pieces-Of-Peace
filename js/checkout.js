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

  const provinceSelect = document.getElementById('province');
  const PROVINCE_KEY = 'pop_province';
  const shippingConfig = () => window.SHIPPING || { estimate: '7 to 14 business days', zones: [], rates: [] };
  const quoteProvince = (province) => {
    const hit = (shippingConfig().rates || []).find((rate) => rate.province === province);
    return hit ? { fee: hit.fee, label: `${province} delivery` } : null;
  };
  const shippingNote = () => {
    const cfg = shippingConfig();
    const list = (cfg.zones || []).map((zone) => `${zone.provinces.join(', ')} R${zone.fee}`).join('; ');
    return `${list ? `Delivery is charged by province: ${list}. ` : 'Delivery is charged by province. '}Orders are dropshipped to your address, so delivery usually takes around ${cfg.estimate}. That timing is an estimate. You pay on PayFast. Card numbers stay on their site.`;
  };
  const savedProvince = () => { try { return localStorage.getItem(PROVINCE_KEY) || ''; } catch (e) { return ''; } };
  const rememberProvince = (value) => {
    try { localStorage.setItem(PROVINCE_KEY, value || ''); } catch (e) { /* private mode */ }
    document.dispatchEvent(new CustomEvent('pop:province'));
  };
  if (provinceSelect) {
    const saved = savedProvince();
    if ([...provinceSelect.options].some((option) => option.value === saved)) provinceSelect.value = saved;
    provinceSelect.addEventListener('change', () => rememberProvince(provinceSelect.value));
    document.addEventListener('pop:province', () => {
      const next = savedProvince();
      if (provinceSelect.value !== next) provinceSelect.value = next;
      render();
    });
  }

  function render() {
    const cart = readCart().filter((item) => forSale(findProduct(item.id)));
    if (!cart.length) {
      summary.innerHTML = '<p>Your bag is empty. <a href="index.html#shop">Back to the collection</a></p>';
      payBtn.disabled = true;
      return;
    }
    let sum = 0;
    const lines = cart.map((item) => {
      const product = findProduct(item.id);
      const line = product.price * item.qty;
      sum += line;
      const variant = item.variant ? `<div>${esc(item.variant)}</div>` : '';
      return `<div class="summary-line">
        <img src="${esc(product.image)}" alt="">
        <div><strong>${esc(product.name)}</strong>${variant}
          <div class="summary-desc">${esc(product.description || '')}</div>
          <div>${item.qty} &times; ${money(product.price)}</div>
          <button type="button" data-remove="${esc(product.id)}" data-variant="${esc(item.variant || '')}">Remove</button>
        </div>
        <strong>${money(line)}</strong>
      </div>`;
    }).join('');
    const quote = quoteProvince(provinceSelect ? provinceSelect.value : '');
    const shippingRow = quote
      ? `<div class="row"><span>${esc(quote.label)}</span><span>${money(quote.fee)}</span></div>`
      : '<div class="row"><span>Delivery</span><span>Choose a province</span></div>';
    summary.innerHTML = `${lines}
      <div class="row"><span>Subtotal</span><span>${money(sum)}</span></div>
      ${shippingRow}
      <div class="row total"><span>Total</span><span>${quote ? money(sum + quote.fee) : '—'}</span></div>
      <p class="summary-note">${esc(shippingNote())}</p>`;
    payBtn.disabled = !quote;
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
