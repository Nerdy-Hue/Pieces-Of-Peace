/**
 * Pieces of Peace — product viewer widget.
 *
 * Two modes, chosen automatically from how many images a product has:
 *
 *  SPIN MODE (>=2 images): treats the images as frames shot evenly around the
 *  piece (a turntable sequence). Dragging or moving the slider scrubs through
 *  frames, so it looks like the object is really rotating. This is the "see
 *  every angle" experience — it needs a real photo sequence to look right.
 *
 *  TILT MODE (1 image): there is only one photo, so there is nothing to
 *  reveal on the sides. Dragging or moving the slider instead tilts/skews
 *  that single photo in 3D space (a parallax trick), so it still feels
 *  interactive — it just can't show a side that was never photographed.
 *
 * Usage: give a container this markup —
 *   <div class="pv" data-images='["url1.jpg","url2.jpg", ...]'></div>
 * then call initProductViewers() once the DOM is ready (auto-runs on load).
 */
(function () {
  function buildViewer(root) {
    let images = [];
    try { images = JSON.parse(root.getAttribute('data-images') || '[]'); } catch (e) { images = []; }
    images = images.filter(Boolean);
    if (images.length === 0) return;

    const spinMode = images.length >= 2;
    const frameCount = images.length;

    root.classList.add('pv-root', spinMode ? 'pv-spin' : 'pv-tilt');
    const safeSrc = String(images[0]).replace(/"/g, '%22');
    const safeAlt = String(root.getAttribute('data-alt') || 'Product photo').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    root.innerHTML = `
      <div class="pv-stage">
        <img class="pv-img" src="${safeSrc}" alt="${safeAlt}" draggable="false">
        <div class="pv-hint">${spinMode ? 'Drag to rotate' : 'Drag to tilt'}</div>
      </div>
      <div class="pv-controls">
        <button type="button" class="pv-btn pv-prev" aria-label="Rotate left">&#8249;</button>
        <input type="range" class="pv-slider" min="0" max="${spinMode ? frameCount - 1 : 100}" value="${spinMode ? 0 : 50}" aria-label="${spinMode ? 'Rotate product' : 'Tilt product'}">
        <button type="button" class="pv-btn pv-next" aria-label="Rotate right">&#8250;</button>
      </div>
    `;

    const img = root.querySelector('.pv-img');
    const slider = root.querySelector('.pv-slider');
    const stage = root.querySelector('.pv-stage');
    const hint = root.querySelector('.pv-hint');
    const prevBtn = root.querySelector('.pv-prev');
    const nextBtn = root.querySelector('.pv-next');

    let dragging = false;
    let startX = 0, startY = 0;
    let frame = 0;       // spin mode: current frame index
    let tiltX = 0, tiltY = 0; // tilt mode: degrees

    function hideHint() { hint.style.opacity = '0'; }

    function renderSpin() {
      frame = ((frame % frameCount) + frameCount) % frameCount;
      img.src = images[frame];
      slider.value = String(frame);
    }
    function renderTilt() {
      tiltY = Math.max(-25, Math.min(25, tiltY));
      tiltX = Math.max(-12, Math.min(12, tiltX));
      img.style.transform = `rotateY(${tiltY}deg) rotateX(${tiltX}deg) scale(1.02)`;
      const pct = ((tiltY + 25) / 50) * 100;
      slider.value = String(pct);
    }

    if (spinMode) renderSpin(); else renderTilt();

    // Drag (mouse + touch) directly on the image
    function pointerDown(x, y) {
      dragging = true; startX = x; startY = y; hideHint();
      stage.classList.add('pv-active');
    }
    function pointerMove(x, y) {
      if (!dragging) return;
      const dx = x - startX;
      const dy = y - startY;
      if (spinMode) {
        const framesPerPixel = frameCount / 260; // full sweep over ~260px drag
        const delta = Math.round(dx * framesPerPixel);
        if (delta !== 0) {
          frame -= delta;
          renderSpin();
          startX = x;
        }
      } else {
        tiltY = (dx / 3);
        tiltX = -(dy / 6);
        renderTilt();
      }
    }
    function pointerUp() { dragging = false; stage.classList.remove('pv-active'); }

    const ac = new AbortController();
    const signal = ac.signal;
    stage.addEventListener('mousedown', (e) => { pointerDown(e.clientX, e.clientY); e.preventDefault(); }, { signal });
    window.addEventListener('mousemove', (e) => pointerMove(e.clientX, e.clientY), { signal });
    window.addEventListener('mouseup', pointerUp, { signal });
    const mo = new MutationObserver(() => {
      if (!root.isConnected) { ac.abort(); mo.disconnect(); }
    });
    if (root.parentNode) mo.observe(document.body, { childList: true, subtree: true });

    stage.addEventListener('touchstart', (e) => {
      const t = e.touches[0]; pointerDown(t.clientX, t.clientY);
    }, { passive: true });
    stage.addEventListener('touchmove', (e) => {
      const t = e.touches[0]; pointerMove(t.clientX, t.clientY); e.preventDefault();
    }, { passive: false });
    stage.addEventListener('touchend', pointerUp);

    // Slider scrubber
    slider.addEventListener('input', () => {
      hideHint();
      if (spinMode) {
        frame = parseInt(slider.value, 10);
        renderSpin();
      } else {
        const pct = parseFloat(slider.value);
        tiltY = (pct / 100) * 50 - 25;
        renderTilt();
      }
    });

    // Prev/next step buttons (spin mode: one frame; tilt mode: nudge)
    prevBtn.addEventListener('click', () => {
      hideHint();
      if (spinMode) { frame -= 1; renderSpin(); } else { tiltY -= 5; renderTilt(); }
    });
    nextBtn.addEventListener('click', () => {
      hideHint();
      if (spinMode) { frame += 1; renderSpin(); } else { tiltY += 5; renderTilt(); }
    });

    // Keyboard, when the viewer has focus
    root.tabIndex = 0;
    root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { hideHint(); if (spinMode) { frame -= 1; renderSpin(); } else { tiltY -= 5; renderTilt(); } }
      if (e.key === 'ArrowRight') { hideHint(); if (spinMode) { frame += 1; renderSpin(); } else { tiltY += 5; renderTilt(); } }
    });

    // Preload remaining frames so the spin feels smooth after the first drag
    if (spinMode) {
      images.slice(1).forEach((src) => { const pre = new Image(); pre.src = src; });
    }
  }

  function initProductViewers() {
    document.querySelectorAll('.pv[data-images]:not(.pv-root)').forEach(buildViewer);
  }
  window.initProductViewers = initProductViewers;
  document.addEventListener('DOMContentLoaded', initProductViewers);
})();
