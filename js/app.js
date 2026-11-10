(function () {
  const products = window.PRODUCTS || [];
  const cats = window.CATEGORIES || [];
  const canon = (slug) => (slug === 'chain' ? 'chains' : slug);
  const money = (n) => 'R ' + Number(n).toLocaleString('en-ZA');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isForSale = (p) => p && typeof p.price === 'number' && Number.isFinite(p.price) && p.price > 0;
  const findProduct = (id) => products.find((p) => String(p.id) === String(id));

  const grid = document.getElementById('productGrid');
  const tabsEl = document.querySelector('.category-tabs');
  const emptyMsg = document.getElementById('catEmptyMsg');

  function frames(p) {
    return (p.angles && p.angles.length) ? p.angles : (p.image ? [p.image] : []);
  }
  function stockLabel(p) {
    if (!isForSale(p)) return 'Available once a price is set';
    if (p.stock === null || p.stock === undefined) return 'In stock';
    if (p.stock <= 0) return 'Sold out';
    return p.stock <= 10 ? 'Low stock — ' + p.stock + ' left' : 'In stock';
  }

  if (grid && tabsEl) {
    const present = new Set(products.map((p) => canon(p.category)));
    const tabCats = [];
    const seen = new Set();
    cats.forEach((c) => {
      const slug = canon(c.slug);
      if (seen.has(slug)) return;
      seen.add(slug);
      tabCats.push({ slug, label: c.label, badge: c.badge });
    });
    tabsEl.innerHTML = '<button class="cat-tab active" data-cat="all">All</button>' +
      tabCats.map((c) => `<button class="cat-tab" data-cat="${c.slug}"${present.has(c.slug) ? '' : ' data-empty="1"'}>${esc(c.label)}</button>`).join('');

    grid.innerHTML = products.map((p) => {
      const slug = canon(p.category);
      const badge = (tabCats.find((c) => c.slug === slug) || {}).badge || 'ITEM';
      const f = frames(p);
      const priced = isForSale(p);
      const soldOut = p.stock !== null && p.stock !== undefined && p.stock <= 0;
      const media = p.image
        ? `<img class="card-img" src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" data-open-viewer="${esc(p.id)}">`
        : `<div class="card-img" style="display:flex;align-items:center;justify-content:center"><div style="width:70%">${p.icon || ''}</div></div>`;
      const pvBadge = f.length
        ? `<button type="button" class="pv-badge" data-open-viewer="${esc(p.id)}" aria-label="Open viewer for ${esc(p.name)}">\u{1F504} ${f.length > 1 ? '360\u00B0' : '3D'}</button>`
        : '';
      const variantField = p.variants && p.variants.length
        ? `<label class="variant-label">Option<select class="variant-select" data-variant>${p.variants.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select></label>`
        : '';
      const buttonLabel = !priced ? 'Price coming soon' : soldOut ? 'Sold out' : 'Add to bag';
      return `
        <article class="card" data-category="${esc(slug)}">
          <div class="card-top"><span class="card-code mono">${esc(p.sku)}</span><span class="card-cat mono ${esc(slug)}">${esc(badge)}</span></div>
          <div class="card-viewer-open">${pvBadge}${media}</div>
          <h3>${esc(p.name)}</h3>
          <p class="card-desc">${esc(p.description || '')}</p>
          <div class="price${priced ? '' : ' soon'}">${priced ? money(p.price) : 'Price coming soon'}</div>
          <div class="stock">${stockLabel(p)}</div>
          ${variantField}
          <button class="add-btn" data-add="${esc(p.id)}" ${(soldOut || !priced) ? 'disabled' : ''}>${buttonLabel}</button>
        </article>`;
    }).join('');

    const liveCount = document.getElementById('liveCount');
    if (liveCount) liveCount.textContent = products.length;

    tabsEl.addEventListener('click', (e) => {
      const tab = e.target.closest('.cat-tab');
      if (!tab) return;
      tabsEl.querySelectorAll('.cat-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const cat = tab.dataset.cat;
      let visible = 0;
      grid.querySelectorAll('.card').forEach((card) => {
        const show = cat === 'all' || card.dataset.category === cat;
        card.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      grid.style.display = visible ? 'grid' : 'none';
      if (emptyMsg) emptyMsg.style.display = visible ? 'none' : 'block';
    });
  }

  const drawer = document.getElementById('drawer');
  if (drawer) {
    let cart = [];
    try { cart = JSON.parse(localStorage.getItem('pop_cart') || '[]'); } catch (e) { cart = []; }
    cart = cart.filter((item) => {
      const product = findProduct(item.id);
      if (!product || !isForSale(product)) return false;
      if (product.variants && product.variants.length && !product.variants.includes(item.variant)) return false;
      item.id = product.id;
      item.variant = item.variant || '';
      item.qty = Math.max(1, Math.min(10, Math.floor(Number(item.qty) || 1)));
      if (product.stock !== null && product.stock !== undefined) item.qty = Math.min(item.qty, product.stock);
      return item.qty > 0;
    });

    const overlay = document.getElementById('overlay');
    const drawerItems = document.getElementById('drawerItems');
    const subtotalEl = document.getElementById('subtotal');
    const countEl = document.getElementById('cartCount');
    const checkoutBtn = document.getElementById('checkoutBtn');
    const openDrawer = () => { drawer.classList.add('open'); overlay.classList.add('open'); };
    const closeDrawer = () => { drawer.classList.remove('open'); overlay.classList.remove('open'); };
    document.getElementById('cartOpenBtn').addEventListener('click', openDrawer);
    document.getElementById('drawerClose').addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);

    function saveCart() {
      try { localStorage.setItem('pop_cart', JSON.stringify(cart)); } catch (e) { /* private mode */ }
      document.dispatchEvent(new CustomEvent('pop:cart'));
    }
    function renderCart() {
      const count = cart.reduce((n, item) => n + item.qty, 0);
      if (countEl) countEl.textContent = count;
      const payable = cart.length > 0 && cart.every((item) => isForSale(findProduct(item.id)));
      if (checkoutBtn) checkoutBtn.disabled = !payable;
      if (!cart.length) {
        drawerItems.innerHTML = '<p class="drawer-empty">Your bag is empty.</p>';
        subtotalEl.textContent = 'R 0';
        return;
      }
      let sum = 0;
      drawerItems.innerHTML = cart.map((item) => {
        const product = findProduct(item.id);
        sum += product.price * item.qty;
        const variant = item.variant ? ` · ${esc(item.variant)}` : '';
        return `<div class="drawer-item"><div>
          <div class="drawer-item-name">${esc(product.name)}${variant}</div>
          <div class="drawer-item-price">${item.qty} &times; ${money(product.price)}</div>
          <button class="drawer-remove" data-remove="${esc(product.id)}" data-variant="${esc(item.variant)}">Remove</button>
        </div></div>`;
      }).join('');
      subtotalEl.textContent = money(sum);
    }
    document.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]');
      if (add && !add.disabled) {
        const product = findProduct(add.dataset.add);
        if (!product || !isForSale(product)) return;
        const card = add.closest('.card');
        const variant = card?.querySelector('[data-variant]')?.value || '';
        const line = cart.find((item) => String(item.id) === String(product.id) && (item.variant || '') === variant);
        const cap = product.stock === null || product.stock === undefined ? 10 : Math.min(10, product.stock);
        const next = (line ? line.qty : 0) + 1;
        if (next > cap) return;
        if (line) line.qty = next;
        else cart.push({ id: product.id, qty: 1, variant });
        saveCart();
        renderCart();
        openDrawer();
        add.textContent = 'Added \u2713';
        add.classList.add('added');
        setTimeout(() => { add.textContent = 'Add to bag'; add.classList.remove('added'); }, 1200);
      }
      const rem = e.target.closest('[data-remove]');
      if (rem) {
        cart = cart.filter((item) => !(String(item.id) === String(rem.dataset.remove) && (item.variant || '') === (rem.dataset.variant || '')));
        saveCart();
        renderCart();
      }
    });
    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', () => {
        if (checkoutBtn.disabled) return;
        window.location.href = 'checkout.html';
      });
    }
    renderCart();
    window.addEventListener('pageshow', renderCart);
  }

  const nav = document.getElementById('mainNav');
  const navToggle = document.getElementById('navToggle');
  if (nav && navToggle) navToggle.addEventListener('click', () => nav.classList.toggle('open'));

  const signup = document.getElementById('signupForm');
  if (signup) {
    signup.addEventListener('submit', (e) => {
      e.preventDefault();
      document.getElementById('signupMsg').classList.add('show');
      e.target.reset();
    });
  }

  const pvOverlay = document.getElementById('pvModalOverlay');
  const pvBody = document.getElementById('pvModalBody');
  if (pvOverlay && pvBody) {
    function openViewer(id) {
      const product = findProduct(id);
      if (!product) return;
      const f = frames(product);
      if (!f.length) return;
      document.getElementById('pvModalTitle').textContent = product.name;
      pvBody.innerHTML = '';
      const div = document.createElement('div');
      div.className = 'pv';
      div.setAttribute('data-images', JSON.stringify(f));
      div.setAttribute('data-alt', product.name);
      pvBody.appendChild(div);
      if (window.initProductViewers) window.initProductViewers();
      const hint = f.length > 1
        ? 'Drag the piece or use the slider to spin it.'
        : 'Drag the photo or use the slider to tilt it.';
      document.getElementById('pvModalNote').textContent = [product.description, hint].filter(Boolean).join(' ');
      pvOverlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    function closeViewer() {
      pvOverlay.classList.remove('open');
      document.body.style.overflow = '';
      pvBody.innerHTML = '';
    }
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-open-viewer]');
      if (trigger) { openViewer(trigger.dataset.openViewer); return; }
      if (e.target === pvOverlay) closeViewer();
    });
    const closeBtn = document.getElementById('pvModalClose');
    if (closeBtn) closeBtn.addEventListener('click', closeViewer);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeViewer();
        if (drawer) drawer.classList.remove('open');
        const overlay = document.getElementById('overlay');
        if (overlay) overlay.classList.remove('open');
      }
    });
  }
})();
