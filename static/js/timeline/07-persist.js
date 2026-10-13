/* Save and load the timeline from the server (timeline.json in the project folder).
   Only the structure is saved; column and stack are rebuilt from the links by relayout() each time. */

const CSRF = document.querySelector('meta[name="csrf-token"]').content;
const TIMELINE_URL = document.body.dataset.timelineUrl;
const saveBadge = $('saveState');
const READONLY = document.body.dataset.readonly === '1';  // the admin looking at a team member's fork: nothing is ever saved

let persistEnabled = false;       // don't save until loading has succeeded (so nothing gets wiped)
let rev = 0, savedRev = 0;        // change counter and last saved counter
let saving = false, saveTimer = null;

function serialize() {
  return {
    version: 1,
    mode,
    ideas: ideas.filter(i => i.text.trim()).map(i => ({ text: i.text, done: !!i.done })),  // blank rows are not saved
    branches: branches.map(b => ({ name: b.name, shade: b.shade })),
    commits: commits.map(c => ({
      id: c.id, name: c.name,
      branch: branches.indexOf(c.branch),
      parent: c.parent ? c.parent.id : null,
      twin: c.twin ? c.twin.id : null,
      base: c.base, color: c.color,
      note: c.note || '',  // purpose of this version (comment)
    })),
  };
}

// throws if the data is invalid (and doesn't corrupt the previous state, since main.js calls initialState())
function deserialize(data) {
  const bad = msg => { throw new Error(msg); };
  if (!data || !Array.isArray(data.branches) || !Array.isArray(data.commits) || !data.branches.length || !data.commits.length)
    bad('ساختار فایل تایم‌لاین نامعتبر است');
  const hex = /^#[0-9a-fA-F]{6}$/;
  const bs = data.branches.map(b => ({ name: String(b.name), shade: Number.isFinite(b.shade) ? b.shade : 0 }));
  const byKey = new Map();
  const cs = data.commits.map(d => {
    if (!hex.test(d.base) || !hex.test(d.color) || !bs[d.branch]) bad('یکی از نسخه‌ها نامعتبر است');
    const c = { id: String(d.id), name: String(d.name), branch: bs[d.branch], parent: null, twin: null, col: 0, stack: String(d.id), base: d.base, color: d.color, note: typeof d.note === 'string' ? d.note : '' };
    byKey.set(c.id, c);
    return c;
  });
  data.commits.forEach((d, i) => {
    for (const key of ['parent', 'twin']) {
      if (d[key] == null) continue;
      cs[i][key] = byKey.get(d[key]) || bad('پیوند یک نسخه خراب است');
    }
  });
  ideas = Array.isArray(data.ideas)
    ? data.ideas.filter(i => i && typeof i.text === 'string').map(i => ({ id: rid(), text: i.text, done: i.done === true }))
    : [];
  branches = bs;
  commits = cs;
  mode = data.mode === 'int' ? 'int' : 'dec';
  freshId = null;
  relayout();
  if (typeof drawIdeas === 'function') drawIdeas();  // 13-ideas.js (it also draws by itself when it loads later)
}

function setSaveState(state, text) {
  saveBadge.dataset.state = state;
  saveBadge.textContent = text;
}

function showLoadError(text) {
  const box = $('loadError');
  box.textContent = text;
  box.hidden = false;
}

function scheduleSave() {
  if (!persistEnabled || READONLY) return;
  rev++;
  setSaveState('pending', 'تغییر ذخیره نشده…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(false), SAVE_DELAY_MS);
}

async function saveNow(flush) {
  if (!persistEnabled || READONLY || rev === savedRev) return;
  if (saving) return; // when the previous save finishes, it runs again if rev has moved ahead
  saving = true;
  const myRev = rev;
  setSaveState('saving', 'در حال ذخیره…');
  try {
    const body = JSON.stringify(serialize());
    const res = await fetch(TIMELINE_URL, {
      method: 'PUT',
      credentials: 'same-origin',
      keepalive: !!flush && body.length < 60000, // keepalive accepts a body of at most 64 KB
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
      body,
    });
    if (!res.ok) {
      const info = await res.json().catch(() => ({}));
      const fatal = [400, 401, 403, 404].includes(res.status);
      if (fatal) persistEnabled = false; // session expired or project deleted; retrying is pointless
      throw new Error(info.error || `خطا ${res.status}`);
    }
    savedRev = myRev;
    setSaveState('saved', 'ذخیره شد ✓');
  } catch (err) {
    setSaveState('error', persistEnabled ? 'ذخیره نشد؛ دوباره تلاش می‌شود' : 'ذخیره نشد: ' + err.message);
    if (persistEnabled) saveTimer = setTimeout(() => saveNow(false), 5000);
  } finally {
    saving = false;
    if (persistEnabled && rev !== savedRev && !saveTimer) scheduleSave();
  }
}

// when closing/switching the tab, send unsaved changes right now
function flushSave() {
  if (!persistEnabled || rev === savedRev) return;
  clearTimeout(saveTimer);
  saveNow(true);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
window.addEventListener('pagehide', flushSave);

// waits until all changes are on disk (a new version must be in timeline.json before upload/listing files)
async function ensureSaved() {
  if (!persistEnabled) return false;
  clearTimeout(saveTimer);
  for (let i = 0; i < 40 && (saving || rev !== savedRev); i++) {
    if (saving) await new Promise(r => setTimeout(r, 150));
    else await saveNow(false);
    if (!persistEnabled) return false;
  }
  return rev === savedRev && !saving;
}
