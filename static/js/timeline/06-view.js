/* Zoom and pan (drag, scroll, two fingers) and the zoom buttons. */
/* ---------- Zoom and pan ---------- */
const viewTransform = () => `translate(${view.x} ${view.y}) scale(${view.k})`;

function applyView() {
  const w = svg.querySelector('#world');
  if (w) w.setAttribute('transform', viewTransform());
  // the background dots move along with zoom and pan
  const g = 24 * view.k;
  stage.style.backgroundSize = `${g}px ${g}px`;
  stage.style.backgroundPosition = `${view.x}px ${view.y}px`;
}

function fitView() {
  const sw = stage.clientWidth, sh = stage.clientHeight;
  view.k = Math.max(MINK, Math.min(1, sw / worldW, sh / worldH));
  view.x = (sw - worldW * view.k) / 2;
  view.y = (sh - worldH * view.k) / 2;
  applyView();
}

// zoom around point (cx, cy), relative to the stage's top-left corner
function zoomAt(f, cx, cy) {
  const k = Math.min(MAXK, Math.max(MINK, view.k * f));
  const r = k / view.k;
  view.x = cx - (cx - view.x) * r;
  view.y = cy - (cy - view.y) * r;
  view.k = k;
  applyView();
}

// if a new node falls out of view, slide the view slightly so it shows
function reveal(c) {
  const sw = stage.clientWidth, sh = stage.clientHeight, m = 60, right = 170;
  const px = X(c) * view.k + view.x, py = Y(c) * view.k + view.y;
  if (px < m) view.x += m - px; else if (px > sw - right) view.x -= px - (sw - right);
  if (py < m) view.y += m - py; else if (py > sh - m) view.y -= py - (sh - m);
}

stage.addEventListener('wheel', e => {
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

const pts = new Map();   // active pointers (mouse or fingers)
let moved = false;       // was it dragged this time? (so a click isn't counted after a drag)

stage.addEventListener('pointerdown', e => {
  if (e.target.closest('#zoomctl')) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  moved = false;
});

stage.addEventListener('pointermove', e => {
  const p = pts.get(e.pointerId);
  if (!p) return;
  if (pts.size === 1) {
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!moved && Math.hypot(dx, dy) < 5) return;
    if (!moved) {
      moved = true;
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('panning');
    }
    p.x = e.clientX; p.y = e.clientY;
    view.x += dx; view.y += dy;
    applyView();
  } else {
    // two fingers: zoom by finger distance, pan by their midpoint
    const [a, b] = [...pts.values()];
    const d0 = Math.hypot(a.x - b.x, a.y - b.y);
    const m0x = (a.x + b.x) / 2, m0y = (a.y + b.y) / 2;
    p.x = e.clientX; p.y = e.clientY;
    const d1 = Math.hypot(a.x - b.x, a.y - b.y);
    const m1x = (a.x + b.x) / 2, m1y = (a.y + b.y) / 2;
    moved = true;
    const r = stage.getBoundingClientRect();
    view.x += m1x - m0x; view.y += m1y - m0y;
    if (d0 > 0) zoomAt(d1 / d0, m1x - r.left, m1y - r.top);
    else applyView();
  }
});

const endPointer = e => {
  pts.delete(e.pointerId);
  if (!pts.size) stage.classList.remove('panning');
};
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

// after a drag, ignore the click the browser sends
stage.addEventListener('click', e => {
  if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
}, true);

const zoomBtn = f => () => { zoomAt(f, stage.clientWidth / 2, stage.clientHeight / 2); };
$('zIn').onclick = zoomBtn(1.25);
$('zOut').onclick = zoomBtn(1 / 1.25);
$('zFit').onclick = () => { fitView(); };
