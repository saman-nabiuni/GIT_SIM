
const GLOW = false;
document.documentElement.classList.toggle('glow', GLOW);

const PALETTE = ['#ff2e93', '#26e8ff', '#b6ff3b', '#ffb020', '#9b6bff', '#ff6b4a', '#2effb0', '#ff5de0'];
const STEP = 96, LANE = 78, PADX = 60, PADY = 56;

const $ = id => document.getElementById(id);
const svg = $('timeline'), stage = $('stage'), pop = $('pop'), legend = $('legend');

let branches = [], commits = [], freshId = null, activeId = null, mode = 'dec';
let doomed = null;  // nodes that the current delete will remove (for preview)
let merging = null; // nodes that the current merge moves onto main (for preview)

const rid = () => Math.random().toString(16).slice(2, 9);
const byId = id => commits.find(c => c.id === id);
const laneOf = b => branches.indexOf(b);
const tipOf = b => [...commits].reverse().find(c => c.branch === b);
const esc = s => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const uniq = a => [...new Set(a)];

/* Node coordinates in world space (before zoom and pan) */
const X = c => PADX + c.col * STEP;
const Y = c => PADY + laneOf(c.branch) * LANE;

/* View state: zoom and pan */
const view = { k: 1, x: 0, y: 0 };
const MINK = 0.25, MAXK = 3;
let worldW = 0, worldH = 0;

/* ---------- Version names ---------- */
const parse = n => {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(n);
  return m ? { maj: +m[1], min: m[2] === undefined ? null : +m[2] } : null;
};
const nextMinor = n => { const p = parse(n); return p ? `${p.maj}.${(p.min ?? 0) + 1}` : n + '.1'; };
const nextMajor = n => { const p = parse(n); return p ? String(p.maj + 1) : n + '.1'; };
const defaultNext = n => (mode === 'int' ? nextMajor(n) : nextMinor(n));

/* A node's color comes from the first number in its name; with no number it takes the previous node's color */
function colorFor(name, fallback) {
  const m = /^(\d+)/.exec(name);
  if (!m) return fallback || PALETTE[0];
  const n = PALETTE.length;
  return PALETTE[(((+m[1] - 1) % n) + n) % n];
}

/* ---------- Shades: lighter/darker variants of the same color ---------- */
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// k=0 the color itself, 1 lighter, 2 darker, 3 even lighter, 4 even darker, ...
function shadeOf(hex, k) {
  if (!k) return hex;
  const [h, s, l] = hexToHsl(hex);
  const step = Math.ceil(k / 2) * 15;
  const nl = Math.min(86, Math.max(30, l + (k % 2 ? step : -step)));
  return hslToHex(h, s, nl);
}

function addCommit(branch, name, parent, twin) {
  const id = rid();
  let base, color;
  if (!parent && twin && name === twin.name) {
    // same-name parallel node: exactly the same color as the original node
    base = twin.base;
    color = twin.color;
  } else {
    // later nodes: the family color, with this branch's own shade
    base = colorFor(name, (parent || twin)?.base);
    color = shadeOf(base, branch.shade);
  }
  const c = {
    id, name, branch, parent, twin,
    col: parent ? parent.col + 1 : twin ? twin.col : 0,
    stack: !parent && twin ? twin.stack : id,
    base, color,
  };
  commits.push(c);
  freshId = id;
  return c;
}

/* ---------- Drawing ---------- */
// L-shaped connector: goes straight down first, then turns right with a rounded corner
function elbow(a, b) {
  const ax = X(a), ay = Y(a), bx = X(b), by = Y(b);
  if (ax === bx || ay === by) return `M${ax} ${ay} L${bx} ${by}`;
  const r = Math.min(20, Math.abs(bx - ax), Math.abs(by - ay));
  const sy = by > ay ? 1 : -1, sx = bx > ax ? 1 : -1;
  return `M${ax} ${ay} L${ax} ${by - sy * r} Q${ax} ${by} ${ax + sx * r} ${by} L${bx} ${by}`;
}

function render() {
  const W = PADX * 2 + Math.max(...commits.map(c => c.col)) * STEP + 140;
  const H = PADY * 2 + (branches.length - 1) * LANE;
  worldW = W;
  worldH = H;

  let defs = '', s = '', gi = 0;

  branches.forEach((b, i) => {
    const y = PADY + i * LANE;
    s += `<line class="guide" x1="20" x2="${W - 20}" y1="${y}" y2="${y}"/>`;
  });

  // if two nodes differ in color, the line between them becomes a gradient (e.g. 1.9 to 2)
  function link(a, b) {
    let stroke = b.color;
    if (a.color !== b.color) {
      const id = 'g' + gi++;
      defs += `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${X(a)}" y1="${Y(a)}" x2="${X(b)}" y2="${Y(b)}">` +
        `<stop offset="0" stop-color="${a.color}"/><stop offset="1" stop-color="${b.color}"/></linearGradient>`;
      stroke = `url(#${id})`;
    }
    s += `<path class="link" style="--c:${b.color}" stroke="${stroke}" d="${elbow(a, b)}"/>`;
  }
  commits.forEach(c => { const from = c.parent || c.twin; if (from) link(from, c); });

  commits.forEach(c => {
    const cls = 'node' + (c.id === freshId ? ' fresh' : '') + (c.id === activeId ? ' active' : '') + (doomed && doomed.has(c) ? ' doomed' : '') + (merging && merging.has(c) ? ' merging' : '');
    s += `<g class="${cls}" data-id="${c.id}" style="--c:${c.color}">
      <circle class="hit" cx="${X(c)}" cy="${Y(c)}" r="22"/>
      <circle class="core" cx="${X(c)}" cy="${Y(c)}" r="11"/>
      <text x="${X(c) + 15}" y="${Y(c) + 28}">${esc(c.name)}</text>
    </g>`;
  });

  branches.forEach(b => {
    const t = tipOf(b);
    s += `<text class="blabel" x="${X(t) + 24}" y="${Y(t) + 4}" fill="${t.color}">${esc(b.name)}</text>`;
  });

  svg.innerHTML = `<g id="world" transform="${viewTransform()}"><defs>${defs}</defs>${s}</g>`;
  freshId = null;

  legend.innerHTML = branches
    .map(b => `<span class="chip" style="--c:${tipOf(b).color}"><i></i>${esc(b.name)}</span>`)
    .join('');
}

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

const dismissPop = () => { if (!pop.hidden) closePop(); };

stage.addEventListener('wheel', e => {
  e.preventDefault();
  dismissPop();
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
      dismissPop();
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
    dismissPop();
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

const zoomBtn = f => () => { dismissPop(); zoomAt(f, stage.clientWidth / 2, stage.clientHeight / 2); };
$('zIn').onclick = zoomBtn(1.25);
$('zOut').onclick = zoomBtn(1 / 1.25);
$('zFit').onclick = () => { dismissPop(); fitView(); };

/* ---------- Node click popup ---------- */
function fillChips(box, input, values, disabled) {
  box.innerHTML = values
    .map(v => `<button type="button" data-v="${esc(v)}"${disabled ? ' disabled' : ''}>${esc(v)}</button>`)
    .join('');
  box.onclick = e => {
    const b = e.target.closest('button');
    if (b && !b.disabled) { input.value = b.dataset.v; input.focus(); }
  };
}

function openPop(c) {
  activeId = c.id;
  doomed = merging = null;
  render();
  pop.dataset.id = c.id;
  pop.style.setProperty('--c', c.color);
  $('pTitle').textContent = `${c.name} · ${c.branch.name}`;
  $('pHash').textContent = c.id;

  const isTip = tipOf(c.branch) === c;
  $('nName').value = defaultNext(c.name);
  $('nName').disabled = $('btnNext').disabled = !isTip;
  $('hint').textContent = isTip ? '' : 'این نسخه آخر شاخه نیست؛ از اینجا فقط می‌شود شاخه موازی ساخت.';
  fillChips($('chipsNext'), $('nName'), uniq([nextMinor(c.name), nextMajor(c.name)]), !isTip);

  $('pNodeName').value = defaultNext(c.name); // the first node of a parallel branch is one version ahead (2.2 → 2.3)
  fillChips($('chipsPar'), $('pNodeName'), uniq([defaultNext(c.name), nextMinor(c.name), nextMajor(c.name), c.name]), false);
  $('bName').value = '';
  $('bName').placeholder = `branch-${branches.length}`;

  const onMain = c.branch === branches[0];
  $('secMerge').hidden = onMain;
  if (!onMain) {
    const plan = planMerge(c);
    $('btnMerge').classList.remove('armed');
    $('btnMerge').textContent = `مرج تا این نسخه در main (${plan.path.length} نسخه)`;
    $('mergeHint').textContent = plan.dupe
      ? `نام این نسخه‌ها روی main تکراری است، پس بعد از مرج عوض می‌شوند: ${plan.path.map((p, i) => `${p.name}→${plan.newNames[i]}`).join('، ')}`
      : '';
  }

  const dead = subtree(c), isRoot = !c.parent && !c.twin;
  $('btnDel').classList.remove('armed');
  $('btnDel').disabled = isRoot;
  $('btnDel').textContent = isRoot ? 'نسخه‌ی اول قابل حذف نیست'
    : dead.size > 1 ? `حذف این نسخه و ${dead.size - 1} نسخه‌ی بعدی` : 'حذف این نسخه';

  pop.hidden = false;
  const r = svg.querySelector(`[data-id="${c.id}"]`).getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  const top = r.bottom + 12 + h > innerHeight ? r.top - h - 12 : r.bottom + 12;
  pop.style.left = left + 'px';
  pop.style.top = Math.max(8, top) + 'px';
}

function closePop() {
  pop.hidden = true;
  activeId = null;
  doomed = merging = null;
  render();
}

// the node itself + everything branched from it or after it (chained)
function subtree(c) {
  const out = new Set([c]);
  for (let grew = true; grew;) {
    grew = false;
    commits.forEach(x => {
      if (!out.has(x) && (out.has(x.parent) || out.has(x.twin))) { out.add(x); grew = true; }
    });
  }
  return out;
}

// first click: arm and preview the nodes that will be deleted; second click: delete
function doDelete() {
  const c = byId(pop.dataset.id);
  if (!c || (!c.parent && !c.twin)) return;
  const dead = subtree(c), btn = $('btnDel');
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed');
    btn.textContent = `مطمئنی؟ ${dead.size} نسخه حذف می‌شود`;
    doomed = dead;
    render();
    return;
  }
  commits = commits.filter(x => !dead.has(x));
  branches = branches.filter(b => commits.some(x => x.branch === b)); // an empty branch is removed too
  closePop();
}

/* ---------- Merge ---------- */
// nodes that must move onto main: from the last non-main node up to their first ancestor, in chronological order
function planMerge(n) {
  const mainB = branches[0];
  const path = [];
  for (let c = n; c && c.branch !== mainB;) {
    path.unshift(c);
    c = c.parent || (c.twin && byId(c.stack)); // a same-name parallel node resolves to the original node at that point
  }
  const tip = tipOf(mainB);
  const used = new Set(commits.filter(x => x.branch === mainB).map(x => x.name));
  const dupe = path.some(p => used.has(p.name));
  const newNames = [];
  if (dupe) { // names collide on main: renumber starting after the end of main
    let prev = tip.name;
    path.forEach(() => { prev = defaultNext(prev); newNames.push(prev); });
  } else path.forEach(p => newNames.push(p.name));
  return { path, tip, dupe, newNames };
}

// recompute every node's column and stack from the links
function relayout() {
  const col = new Map();
  const colOf = c => {
    if (!col.has(c)) col.set(c, c.parent ? colOf(c.parent) + 1 : c.twin ? colOf(c.twin) : 0);
    return col.get(c);
  };
  const stackOf = c => (c.parent ? c.id : c.twin ? stackOf(c.twin) : c.id);
  commits.forEach(c => { c.col = colOf(c); });
  commits.forEach(c => { c.stack = stackOf(c); });
}

// first click: preview the nodes that move onto main; second click: merge
function doMerge() {
  const c = byId(pop.dataset.id);
  if (!c || c.branch === branches[0]) return;
  const plan = planMerge(c), btn = $('btnMerge');
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed');
    btn.textContent = `مطمئنی؟ ${plan.path.length} نسخه می‌رود روی main`;
    merging = new Set(plan.path);
    render();
    return;
  }
  let prev = plan.tip;
  plan.path.forEach((p, i) => {
    p.name = plan.newNames[i];
    p.parent = prev; p.twin = null; p.branch = branches[0];
    p.base = colorFor(p.name, prev.base);
    p.color = p.base; // main has shade 0 = pure color
    prev = p;
  });
  // moved nodes go to the end of the list so they become the last nodes of main
  commits = [...commits.filter(x => !plan.path.includes(x)), ...plan.path];
  relayout();
  // parallel branches split from these nodes stay in place; only an empty branch is removed
  branches = branches.filter(b => commits.some(x => x.branch === b));
  reveal(prev);
  closePop();
}

function doNext() {
  const c = byId(pop.dataset.id);
  if (tipOf(c.branch) !== c) return;
  const n = addCommit(c.branch, $('nName').value.trim() || defaultNext(c.name), c, null);
  reveal(n);
  closePop();
}

function doBranch() {
  const c = byId(pop.dataset.id);
  const name = $('pNodeName').value.trim() || defaultNext(c.name);
  const sameName = name === c.name; // only if the name is exactly the same, a same-column parallel node is created
  const bname = $('bName').value.trim() || `branch-${branches.length}`;
  // lowest same-name node at this point; the new branch sits right below it
  const low = commits.filter(x => x.stack === c.stack)
    .reduce((a, x) => (laneOf(x.branch) > laneOf(a.branch) ? x : a));
  // each new branch from this point gets a new shade (main branch shade 0 = pure color)
  const family = uniq(commits.filter(x => x.stack === c.stack).map(x => x.branch));
  const b = { name: bname, shade: Math.max(...family.map(x => x.shade)) + 1 };
  branches.splice(laneOf(low.branch) + 1, 0, b);
  const n = sameName
    ? addCommit(b, name, null, low)   // same-name node, below this node
    : addCommit(b, name, c, null);    // next version, one column ahead and attached to this node
  reveal(n);
  closePop();
}

svg.addEventListener('click', e => {
  const g = e.target.closest('[data-id]');
  if (!g) return closePop();
  e.stopPropagation();
  openPop(byId(g.dataset.id));
});
document.addEventListener('click', e => { if (!pop.hidden && !pop.contains(e.target)) closePop(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) closePop(); });

$('btnNext').onclick = doNext;
$('btnBranch').onclick = doBranch;
$('btnDel').onclick = doDelete;
$('btnMerge').onclick = doMerge;
$('nName').addEventListener('keydown', e => { if (e.key === 'Enter') doNext(); });
[$('pNodeName'), $('bName')].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') doBranch(); }));

[['modeDec', 'dec'], ['modeInt', 'int']].forEach(([id, m]) => {
  $(id).onclick = () => {
    mode = m;
    $('modeDec').setAttribute('aria-pressed', m === 'dec');
    $('modeInt').setAttribute('aria-pressed', m === 'int');
  };
});

/* Start: main branch with version 1 */
const main = { name: 'main', shade: 0 };
branches.push(main);
addCommit(main, '1', null, null);
render();
fitView();