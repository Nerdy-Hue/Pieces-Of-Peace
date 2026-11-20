(function () {
  const params = new URLSearchParams(location.search);
  const id = params.get('order') || '';
  const slot = document.getElementById('orderState');
  try { localStorage.removeItem('pop_cart'); } catch (e) { /* ignore */ }
  if (!id || !slot) return;
  let tries = 0;
  async function poll() {
    tries += 1;
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(id)}/status`);
      if (response.ok) {
        const order = await response.json();
        if (order.status === 'paid') {
          slot.textContent = `Order ${order.id} is paid. We'll place it with the supplier and send tracking when it ships.`;
          return;
        }
        slot.textContent = `Order ${order.id} is ${order.status}. PayFast confirms payment on our side — this page updates once that arrives.`;
      }
    } catch (e) { /* keep the static message */ }
    if (tries < 5) setTimeout(poll, 2000);
  }
  poll();
})();
