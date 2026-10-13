/* Side-by-side diff: files that changed in a version compared with the previous version (opened from the version panel).
   Left: changed files grouped in folders. Right: two code columns. Server side: services/diff_service.py (rows are computed there;
   this file only draws them). The code view is always left-to-right with Latin digits, like a normal diff tool. */

const DIFF_URL = document.body.dataset.diffUrl;
const DIFF_FILE_URL = document.body.dataset.diffFileUrl;
const diffDlg = $('diffDlg'), diffMsg = $('diffMsg'), diffBody = $('diffBody'), diffFiles = $('diffFiles');
const diffTable = $('diffTable'), diffScroll = $('diffScroll');
let diffToken = 0;  // ignores answers that arrive after another file/version was opened
let diffPrevName = '', diffCurName = '';
const diffRows = new Map();  // file path -> its row in the tree

const DIFF_BADGE = { added: '+', removed: '−', modified: '~' };
const DIFF_STATUS_FA = { added: 'فایل تازه', removed: 'حذف‌شده', modified: 'تغییر کرده', same: 'بدون تغییر' };
const latin = n => Number(n).toLocaleString('en-US');

// "+3  −2" as two colored pills
function setDiffStat(plus, minus) {
  const box = $('diffStat');
  box.replaceChildren();
  if (plus == null) return;
  [['add', `+${latin(plus)}`], ['del', `−${latin(minus)}`]].forEach(([k, t]) => {
    const sp = document.createElement('span');
    sp.className = 'pill ' + k; sp.textContent = t;
    box.append(sp);
  });
}

// header chips: [previous] → [this version]   +N new · ~N changed · −N removed
function drawDiffChips(prev, cur, files) {
  const box = $('diffChips');
  box.replaceChildren();
  const chip = (t, cls) => { const sp = document.createElement('span'); sp.className = cls; sp.textContent = t; return sp; };
  const grp = document.createElement('span');  // the version chips stay left-to-right: [previous] → [this version]
  grp.className = 'vgrp'; grp.dir = 'ltr';
  if (prev) grp.append(chip(prev, 'vchip'), chip('→', 'varrow'));
  grp.append(chip(cur, 'vchip cur'));
  box.append(grp);
  if (!files.length) return;
  const n = st => files.filter(f => f.status === st).length;
  [['add', 'added', 'تازه'], ['mod', 'modified', 'تغییرکرده'], ['del', 'removed', 'حذف‌شده']].forEach(([k, st, fa]) => {
    if (n(st)) box.append(chip(`${latin(n(st))} ${fa}`, 'pill ' + k));
  });
}

function sayDiff(text, cls = '') { diffMsg.textContent = text; diffMsg.className = cls; diffMsg.hidden = !text; }

function cell(cls, text) {
  const td = document.createElement('td');
  td.className = cls;
  if (text != null) td.textContent = text;
  return td;
}

function drawDiffRows(res) {
  diffTable.replaceChildren();
  // fixed column widths: narrow line-number columns, the two code columns share the rest equally
  const cg = document.createElement('colgroup');
  ['n', '', 'n', ''].forEach(c => { const col = document.createElement('col'); if (c) col.className = c; cg.append(col); });
  const hr = diffTable.createTHead().insertRow();
  [`قبل — ${diffPrevName}`, `بعد — ${diffCurName}`].forEach(t => {
    const th = document.createElement('th');
    th.colSpan = 2; th.textContent = t; th.title = t;
    hr.append(th);
  });
  diffTable.prepend(cg);

  const info = res.binary ? 'فایل باینری است و مقایسه‌ی متنی ندارد.'
    : res.too_large ? 'این فایل برای مقایسه خیلی بزرگ است.'
    : !res.rows.length ? 'تفاوتی نیست.' : '';
  if (res.rows && res.rows.length) setDiffStat(res.plus, res.minus); else setDiffStat();
  const body = diffTable.createTBody();
  if (info) {
    const td = body.insertRow().insertCell();
    td.colSpan = 4; td.className = 'dd-info'; td.textContent = info;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const r of res.rows) {
    const tr = document.createElement('tr');
    if (r[0] === 's') {
      tr.className = 'dd-skip';
      const td = document.createElement('td');
      td.colSpan = 4; td.textContent = `⋯ ${latin(r[1])} خط بدون تغییر`;
      tr.append(td);
    } else {
      const t = r[0];
      tr.className = 'dd-' + (t === '=' ? 'eq' : t === '~' ? 'chg' : t === '-' ? 'del' : 'add');
      tr.append(cell('n', r[1]), cell('t l', r[2]), cell('n', r[3]), cell('t r', r[4]));
    }
    frag.append(tr);
  }
  body.append(frag);
}

async function showDiffFile(cid, path) {
  const my = ++diffToken;
  diffRows.forEach((row, p) => row.classList.toggle('on', p === path));
  $('diffPath').textContent = path;
  $('diffIco').replaceChildren(ftIcon(false, path));
  setDiffStat();
  diffTable.replaceChildren();
  try {
    const res = await getJson(forCommit(DIFF_FILE_URL, cid) + '?path=' + encodeURIComponent(path));
    if (my !== diffToken) return;
    drawDiffRows(res);
    diffScroll.scrollTop = 0;
  } catch (err) {
    if (my === diffToken) sayDiff('خواندن تفاوت ممکن نشد: ' + err.message, 'err');
  }
}

// changed files grouped in folders (a chain of single-child folders is shown as one row: static/js/timeline)
function diffTreeItems(cid, node) {
  const out = [];
  for (const d of treeDirs(node)) {
    let cur = d, label = d.name;
    while (!cur.files.length && cur.dirs.size === 1) { cur = [...cur.dirs.values()][0]; label += '/' + cur.name; }
    const li = document.createElement('li'), row = document.createElement('div');
    const arrow = document.createElement('span'), name = document.createElement('span'), meta = document.createElement('span');
    li.className = 'dir'; row.className = 'row';
    arrow.className = 'arrow'; arrow.textContent = '▾';
    name.className = 'name'; name.textContent = label; name.title = cur.path;
    meta.className = 'meta'; meta.textContent = latin(treeCount(cur));
    row.append(arrow, ftIcon(true), name, meta);
    row.onclick = () => li.classList.toggle('closed');
    const ul = document.createElement('ul');
    ul.append(...diffTreeItems(cid, cur));
    li.append(row, ul);
    out.push(li);
  }
  for (const f of treeFiles(node)) {
    const it = f.item;
    const li = document.createElement('li'), row = document.createElement('div');
    const badge = document.createElement('i'), name = document.createElement('span');
    li.className = 'file ' + it.status; row.className = 'row'; row.title = it.path;
    badge.className = 'badge'; badge.textContent = DIFF_BADGE[it.status]; badge.title = DIFF_STATUS_FA[it.status];
    name.className = 'name'; name.textContent = f.name;
    row.append(badge, ftIcon(false, f.name), name);
    row.onclick = () => showDiffFile(cid, it.path);
    diffRows.set(it.path, row);
    li.append(row);
    out.push(li);
  }
  return out;
}

async function openDiff() {
  const c = byId(pop.dataset.id);
  if (!c) return;
  const my = ++diffToken;
  diffCurName = c.name;
  diffBody.hidden = true;
  $('diffTitle').textContent = `تفاوت نسخه‌ی ${c.name} با نسخه‌ی قبل`;
  $('diffNote').textContent = '';
  $('diffChips').replaceChildren();
  sayDiff('در حال خواندن…');
  diffDlg.hidden = false;
  try {
    if (!(await ensureSaved())) throw new Error('تایم‌لاین هنوز ذخیره نشده؛ دوباره امتحان کن');
    const s = await getJson(forCommit(DIFF_URL, c.id));
    if (my !== diffToken) return;
    diffPrevName = s.prev ? s.prev.name : '—';
    $('diffTitle').textContent = s.prev
      ? `تفاوت نسخه‌ی ${s.name} با نسخه‌ی ${s.prev.name}`
      : `فایل‌های نسخه‌ی ${s.name} (نسخه‌ی قبلی ندارد)`;
    $('diffNote').textContent = s.note ? `هدف این نسخه: ${s.note}` : 'برای این نسخه کامنتی نوشته نشده.';
    drawDiffChips(s.prev ? s.prev.name : '', s.name, s.files);
    if (!s.files.length) {
      sayDiff(s.prev ? 'هیچ فایلی نسبت به نسخه‌ی قبل تغییر نکرده است.' : 'این نسخه فایلی ندارد.');
      return;
    }
    sayDiff('');
    diffRows.clear();
    const tree = buildTree(s.files);
    diffFiles.replaceChildren(...diffTreeItems(c.id, tree));
    diffBody.hidden = false;
    showDiffFile(c.id, treeOrder(tree)[0].path);  // first file in the tree
  } catch (err) {
    if (my === diffToken) sayDiff('خواندن تفاوت ممکن نشد: ' + err.message, 'err');
  }
}

function closeDiff() {
  diffToken++;
  diffDlg.hidden = true;
}

$('btnDiff').onclick = openDiff;
$('diffClose').onclick = closeDiff;
diffDlg.addEventListener('mousedown', e => { if (e.target === diffDlg) closeDiff(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !diffDlg.hidden) closeDiff(); });
