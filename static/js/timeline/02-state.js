/* App state (global variables) and small helpers. No logic here. */
const $ = id => document.getElementById(id);
const svg = $('timeline'), stage = $('stage'), pop = $('pop'), legend = $('legend');

let branches = [], commits = [], freshId = null, activeId = null, mode = 'dec';
let ideas = [];     // notes of the side panel: [{id, text, done}] (saved inside timeline.json)
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
let worldW = 0, worldH = 0;
