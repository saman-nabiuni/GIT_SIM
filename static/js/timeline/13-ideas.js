/* Ideas / tasks side panel next to the timeline.
   Each idea is one row (checkbox + text). Enter starts the next idea below (the text after the cursor moves with it),
   Shift+Enter adds a line inside the idea, Backspace on an empty row deletes it.
   The list lives in the global `ideas` (02-state.js) and is saved inside timeline.json by 07-persist.js. */

const ideasPanel = $('ideas'), ideaList = $('ideaList'), ideaToggle = $('ideaToggle'), ideaClean = $('ideaClean');
const IDEAS_MAX = Number(ideasPanel.dataset.maxItems) || 500;
const IDEA_LEN = Number(ideasPanel.dataset.maxLen) || 2000;
const IDEAS_OPEN_KEY = 'ideasOpen';  // remembered per browser

const blankIdea = (text = '') => ({ id: rid(), text, done: false });
const lastIdea = () => ideas[ideas.length - 1];
const ideaRows = () => [...ideaList.querySelectorAll('.idea')];

function ensureTail() {  // there is always an empty row at the end, ready to type in
  if (!ideas.length || lastIdea().text.trim()) ideas.push(blankIdea());
}

function autosize(ta) {
  ta.style.height = 'auto';
  if (ta.scrollHeight) ta.style.height = ta.scrollHeight + 'px';  // 0 while the panel is closed
}

function buildRow(it) {
  const row = document.createElement('div');
  row.className = 'idea' + (it.done ? ' done' : '');
  row.dataset.id = it.id;
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = it.done; cb.title = 'انجام شد'; cb.setAttribute('aria-label', 'انجام شد');
  const ta = document.createElement('textarea');
  ta.rows = 1; ta.value = it.text; ta.dir = 'auto'; ta.maxLength = IDEA_LEN; ta.spellcheck = false;
  ta.placeholder = 'ایده یا تسک…'; ta.setAttribute('aria-label', 'ایده یا تسک');
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'x'; x.textContent = '×'; x.title = 'حذف'; x.setAttribute('aria-label', 'حذف');
  row.append(cb, ta, x);
  return row;
}

function updateCount() {
  const real = ideas.filter(i => i.text.trim()), done = real.filter(i => i.done).length;
  $('ideaCount').textContent = real.length ? `${faNum(done)}/${faNum(real.length)}` : '';
  ideaClean.disabled = !done;
}

function focusIdea(id, pos) {
  const ta = ideaList.querySelector(`.idea[data-id="${id}"] textarea`);
  if (!ta) return;
  ta.focus();
  const p = pos == null ? ta.value.length : pos;
  ta.setSelectionRange(p, p);
  ta.scrollIntoView({ block: 'nearest' });
}

function drawIdeas(focusId, pos) {
  ensureTail();
  ideaList.replaceChildren(...ideas.map(buildRow));
  ideaList.querySelectorAll('textarea').forEach(autosize);
  updateCount();
  if (focusId) focusIdea(focusId, pos);
}

const itemOf = el => {
  const row = el.closest('.idea');
  return row ? ideas.find(i => i.id === row.dataset.id) : null;
};

ideaList.addEventListener('input', e => {
  if (!e.target.matches('textarea')) return;
  const it = itemOf(e.target);
  if (!it) return;
  it.text = e.target.value;
  autosize(e.target);
  if (it === lastIdea() && it.text.trim()) {  // typing in the last row opens a new empty one below it
    ensureTail();
    ideaList.append(buildRow(lastIdea()));
  }
  updateCount();
  scheduleSave();
});

ideaList.addEventListener('change', e => {
  if (!e.target.matches('input[type="checkbox"]')) return;
  const it = itemOf(e.target);
  if (!it) return;
  it.done = e.target.checked;
  e.target.closest('.idea').classList.toggle('done', it.done);
  updateCount();
  scheduleSave();
});

ideaList.addEventListener('click', e => {
  const b = e.target.closest('button.x');
  const it = b && itemOf(b);
  if (!it) return;
  ideas = ideas.filter(i => i !== it);
  drawIdeas();
  scheduleSave();
});

ideaList.addEventListener('keydown', e => {
  const ta = e.target;
  if (!ta.matches('textarea') || e.isComposing) return;  // isComposing: Enter that confirms an IME word is not a new idea
  const it = itemOf(ta);
  if (!it) return;
  const i = ideas.indexOf(it);

  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    const before = ta.value.slice(0, ta.selectionStart), after = ta.value.slice(ta.selectionEnd);
    const next = ideas[i + 1];
    if (!after && next && !next.text.trim()) return focusIdea(next.id, 0);  // an empty row is already waiting below
    if (ideas.length > IDEAS_MAX) return;
    it.text = before;
    const n = blankIdea(after);
    ideas.splice(i + 1, 0, n);
    drawIdeas(n.id, 0);
    scheduleSave();
  } else if (e.key === 'Backspace' && !ta.value && ideas.length > 1) {
    e.preventDefault();
    const go = ideas[i - 1] || ideas[i + 1];
    ideas = ideas.filter(x => x !== it);
    drawIdeas(go.id);
    scheduleSave();
  } else if (e.key === 'ArrowUp' && !e.shiftKey && ta.selectionStart === 0 && ta.selectionEnd === 0 && ideas[i - 1]) {
    e.preventDefault();
    focusIdea(ideas[i - 1].id);
  } else if (e.key === 'ArrowDown' && !e.shiftKey && ta.selectionStart === ta.value.length && ideas[i + 1]) {
    e.preventDefault();
    focusIdea(ideas[i + 1].id, 0);
  }
});

ideaClean.onclick = () => {
  const n = ideas.filter(i => i.done).length;
  if (!n || !confirm(`${faNum(n)} ایده‌ی انجام‌شده حذف شود؟`)) return;
  ideas = ideas.filter(i => !i.done);
  drawIdeas();
  scheduleSave();
};

/* ---------- Open / close the panel (remembered in this browser) ---------- */
function setIdeasOpen(open, remember = true) {
  ideasPanel.classList.toggle('closed', !open);
  ideaToggle.setAttribute('aria-expanded', String(open));
  ideaToggle.textContent = open ? '▸' : '💡';
  ideaToggle.title = open ? 'بستن پنل' : 'باز کردن ایده‌ها و تسک‌ها';
  if (open) ideaList.querySelectorAll('textarea').forEach(autosize);
  if (!remember) return;
  try { localStorage.setItem(IDEAS_OPEN_KEY, open ? '1' : '0'); } catch (_) { /* storage blocked */ }
}

ideaToggle.onclick = () => setIdeasOpen(ideasPanel.classList.contains('closed'));

let startOpen = true;
try { startOpen = localStorage.getItem(IDEAS_OPEN_KEY) !== '0'; } catch (_) { /* storage blocked */ }
setIdeasOpen(startOpen, false);
drawIdeas();  // if the timeline loaded before this file, deserialize() already filled `ideas`
