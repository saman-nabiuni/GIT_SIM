/* Version names and colors: parse/nextMinor/nextMajor/defaultNext, colorFor and shades. */
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
