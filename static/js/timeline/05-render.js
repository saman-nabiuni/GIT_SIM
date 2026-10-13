/* SVG drawing: L-shaped connectors, nodes, labels and the branch list. */
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
