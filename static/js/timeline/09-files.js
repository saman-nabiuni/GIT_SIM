/* Files of each version: summary in the node popup, upload dialog (file/folder, multiple additions) and zip export.
   Server-side logic: services/versions_service.py (an unchanged file is not stored again; deletion is manual). */

const FILES_URL = document.body.dataset.filesUrl;
const UPLOAD_URL = document.body.dataset.uploadUrl;
const EXPORT_URL = document.body.dataset.exportUrl;
const IGNORED = new Set(JSON.parse(document.body.dataset.ignored || '[]'));
const MAX_FILE = Number(document.body.dataset.maxFileMb) * 1024 * 1024;
const MAX_TOTAL = Number(document.body.dataset.maxUploadMb) * 1024 * 1024;
const forCommit = (url, cid) => url.replace('__CID__', encodeURIComponent(cid));

const faNum = n => Number(n).toLocaleString('fa-IR');
function fmtSize(n) {
  if (n < 1024) return `${faNum(n)} B`;
  if (n < 1024 * 1024) return `${faNum(Math.round(n / 102.4) / 10)} KB`;
  return `${faNum(Math.round(n / 104857.6) / 10)} MB`;
}

/* ---------- Folder tree helpers (used by 12-diff.js and 14-filemgr.js) ---------- */
// flat list -> {name, path, dirs: Map, files: [{name, item}]}; `item` is the original entry
function buildTree(items, pathOf = it => it.path) {
  const root = { name: '', path: '', dirs: new Map(), files: [] };
  for (const it of items) {
    const parts = pathOf(it).split('/');
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur.dirs.has(parts[i])) cur.dirs.set(parts[i], { name: parts[i], path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [] });
      cur = cur.dirs.get(parts[i]);
    }
    cur.files.push({ name: parts[parts.length - 1], item: it });
  }
  return root;
}
const treeCmp = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true });
const treeDirs = n => [...n.dirs.values()].sort(treeCmp);   // folders first, then files, both A-Z
const treeFiles = n => n.files.slice().sort(treeCmp);
function treeCount(n) { let c = n.files.length; n.dirs.forEach(d => { c += treeCount(d); }); return c; }
function treeSize(n) { let c = n.files.reduce((s, f) => s + (f.item.size || 0), 0); n.dirs.forEach(d => { c += treeSize(d); }); return c; }
function treeOrder(n, out = []) { treeDirs(n).forEach(d => treeOrder(d, out)); treeFiles(n).forEach(f => out.push(f.item)); return out; }  // files in display order

// icon span for a tree row: folder (amber) or file (colored by extension); the markup is fixed, only the class depends on the name
const ICON_FOLDER = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4l2 2.5h7A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>';
const ICON_FILE = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 3h8l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path fill="none" stroke="#0d0b1f" stroke-opacity=".5" stroke-width="1.6" d="M14 3v5h5"/></svg>';
function ftIcon(isDir, name = '') {
  const span = document.createElement('span');
  const ext = isDir ? '' : (name.includes('.') ? name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') : '');
  span.className = 'ico ' + (isDir ? 'folder' : 'file' + (ext ? ' e-' + ext : ''));
  span.innerHTML = isDir ? ICON_FOLDER : ICON_FILE;
  return span;
}

/* ---------- Summary in the version panel ---------- */
let lastInfo = null; // latest file summary of the opened node

async function refreshFiles(c) {
  const sum = $('fileSummary'), box = $('fileDetails'), exp = $('btnExport');
  sum.textContent = '…';
  box.hidden = true;
  exp.removeAttribute('href');
  exp.setAttribute('aria-disabled', 'true');
  lastInfo = null;
  updateActions(null); // 11-actions.js
  try {
    if (!(await ensureSaved())) throw new Error('تایم‌لاین ذخیره نشده');
    const res = await fetch(forCommit(FILES_URL, c.id), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const info = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(info.error || `خطا ${res.status}`);
    if (pop.dataset.id !== c.id) return; // another node was opened in the meantime
    lastInfo = info;
    updateActions(info);
    if (!info.count) {
      sum.textContent = 'هنوز فایلی ندارد.';
      return;
    }
    sum.textContent = `${faNum(info.count)} فایل · ${fmtSize(info.total_size)}` +
      (info.inherited_from ? ` · از نسخه‌ی ${info.inherited_from.name} به ارث رسیده` : '');
    $('fileList').replaceChildren(...info.files.map(f => {
      const li = document.createElement('li');
      const a = document.createElement('span'), b = document.createElement('span');
      a.textContent = f.path; b.textContent = fmtSize(f.size);
      li.append(a, b);
      return li;
    }));
    box.hidden = false;
    box.open = false;
    exp.href = forCommit(EXPORT_URL, c.id);
    exp.setAttribute('aria-disabled', 'false');
  } catch (err) {
    if (pop.dataset.id === c.id) sum.textContent = 'خواندن فایل‌ها ممکن نشد: ' + err.message;
  }
}

/* ---------- Upload dialog ---------- */
const dlg = $('upDlg'), upList = $('upList'), upMsg = $('upMsg'), upGo = $('upGo');
const staged = new Map(); // path key (lowercase) → {path, file}
let upTarget = null, uploading = false;

function say(text, cls = '') { upMsg.textContent = text; upMsg.className = cls; }

function openUpload() {
  const c = byId(pop.dataset.id);
  if (!c) return;
  upTarget = c;
  staged.clear();
  $('upTitle').textContent = `آپلود فایل به نسخه‌ی ${c.name}`;
  const info = lastInfo;
  $('upBase').textContent = !info || !info.count
    ? 'این نسخه (و نسخه‌های قبلش) فایلی ندارد؛ هر چه آپلود کنی فایل‌های اولِ پروژه می‌شود.'
    : info.own
      ? 'فایل‌های فعلی این نسخه می‌مانند؛ فایل تغییرکرده جایگزین می‌شود، فایل تازه اضافه می‌شود و بقیه دست نمی‌خورد.'
      : `این نسخه با فایل‌های نسخه‌ی ${info.inherited_from.name} شروع می‌کند؛ فایل تغییرکرده جایگزین می‌شود، فایل تازه (با همان پوشه‌بندی) اضافه می‌شود و فایل بدون تغییر دوباره ذخیره نمی‌شود.`;
  say('');
  drawStaged();
  dlg.hidden = false;
  upGo.focus();
}

function closeUpload() {
  if (uploading) return;
  dlg.hidden = true;
  upTarget = null;
  staged.clear();
}

function drawStaged() {
  const items = [...staged.values()];
  upList.replaceChildren(...items.slice(0, 150).map(it => {
    const li = document.createElement('li');
    const p = document.createElement('span'), z = document.createElement('span'), x = document.createElement('button');
    p.className = 'p'; p.textContent = it.path; p.title = it.path;
    z.className = 'z'; z.textContent = fmtSize(it.file.size);
    x.type = 'button'; x.textContent = '×'; x.title = 'برداشتن'; x.dataset.key = it.path.toLowerCase();
    li.append(p, z, x);
    return li;
  }));
  if (items.length > 150) {
    const li = document.createElement('li');
    li.textContent = `… و ${faNum(items.length - 150)} فایل دیگر`;
    upList.append(li);
  }
  const total = items.reduce((s, it) => s + it.file.size, 0);
  upGo.disabled = !items.length || uploading;
  upGo.textContent = items.length ? `آپلود ${faNum(items.length)} فایل (${fmtSize(total)})` : 'آپلود';
}

// input: [{file, path, dir}]; dir means it came from inside a folder (for the "folder = root" option)
function addStaged(entries) {
  const root = $('rootMode').checked;
  let skipped = 0, big = 0;
  for (const { file, path, dir } of entries) {
    let p = path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (dir && root) p = p.split('/').slice(1).join('/');
    if (!p) continue;
    const parts = p.split('/');
    if (parts.slice(0, -1).some(s => IGNORED.has(s)) || IGNORED.has(parts[parts.length - 1])) { skipped++; continue; }
    if (file.size > MAX_FILE) { big++; continue; }
    staged.set(p.toLowerCase(), { path: p, file }); // duplicate path = the last one wins
  }
  const notes = [];
  if (skipped) notes.push(`${faNum(skipped)} فایل از پوشه‌های نادیده‌گرفته‌شده (مثل .git و node_modules) رد شد`);
  if (big) notes.push(`${faNum(big)} فایل بزرگ‌تر از ${faNum(MAX_FILE / 1048576)} مگابایت رد شد`);
  say(notes.join('؛ '), notes.length ? 'err' : '');
  drawStaged();
}

$('pickFiles').onclick = () => $('fileIn').click();
$('pickDir').onclick = () => $('dirIn').click();
$('fileIn').onchange = e => {
  addStaged([...e.target.files].map(f => ({ file: f, path: f.name, dir: false })));
  e.target.value = '';
};
$('dirIn').onchange = e => {
  addStaged([...e.target.files].map(f => ({ file: f, path: f.webkitRelativePath || f.name, dir: true })));
  e.target.value = '';
};

// drag and drop (files and folders, multiple)
async function walk(entry, dir, out) {
  if (entry.isFile) {
    const file = await new Promise((ok, no) => entry.file(ok, no));
    out.push({ file, path: entry.fullPath, dir });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((ok, no) => reader.readEntries(ok, no));
      if (!batch.length) break;
      for (const child of batch) await walk(child, true, out);
    }
  }
}
const drop = $('drop');
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('over')));
drop.addEventListener('drop', async e => {
  e.preventDefault();
  const entries = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean); // must be captured before any await
  const out = [];
  try {
    for (const en of entries) await walk(en, en.isDirectory, out);
  } catch (err) {
    return say('خواندن پوشه ممکن نشد: ' + err.message, 'err');
  }
  addStaged(out);
});
drop.onclick = () => $('fileIn').click();

upList.addEventListener('click', e => {
  const b = e.target.closest('button[data-key]');
  if (b) { staged.delete(b.dataset.key); drawStaged(); }
});
$('upClear').onclick = () => { staged.clear(); say(''); drawStaged(); };
$('upClose').onclick = closeUpload;
dlg.addEventListener('mousedown', e => { if (e.target === dlg) closeUpload(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !dlg.hidden) closeUpload(); });
$('btnUpload').onclick = openUpload;

function send(cid, items) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    items.forEach(it => fd.append('files', it.file, 'f')); // the real name is in paths (the browser drops the path from the file name)
    fd.append('paths', JSON.stringify(items.map(it => it.path)));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', forCommit(UPLOAD_URL, cid));
    xhr.setRequestHeader('X-CSRF-Token', CSRF);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) upGo.textContent = `در حال آپلود… ${faNum(Math.round(e.loaded / e.total * 100))}٪`;
    };
    xhr.onerror = () => reject(new Error('ارتباط با سرور قطع شد'));
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch (_) { /* non-JSON response */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `خطا ${xhr.status}`));
    };
    xhr.send(fd);
  });
}

upGo.onclick = async () => {
  const items = [...staged.values()];
  if (!items.length || uploading || !upTarget) return;
  if (items.reduce((s, it) => s + it.file.size, 0) > MAX_TOTAL) {
    return say(`حجم کل از ${faNum(MAX_TOTAL / 1048576)} مگابایت بیشتر است؛ در چند نوبت آپلود کن.`, 'err');
  }
  uploading = true;
  upGo.disabled = true;
  say('');
  try {
    if (!(await ensureSaved())) throw new Error('تایم‌لاین هنوز ذخیره نشده؛ دوباره امتحان کن');
    const r = await send(upTarget.id, items);
    const parts = [];
    if (r.added.length) parts.push(`${faNum(r.added.length)} فایل اضافه شد`);
    if (r.modified.length) parts.push(`${faNum(r.modified.length)} فایل جایگزین شد`);
    if (r.unchanged) parts.push(`${faNum(r.unchanged)} فایل بدون تغییر بود (دوباره ذخیره نشد)`);
    if (r.ignored) parts.push(`${faNum(r.ignored)} فایل نادیده گرفته شد`);
    say(`انجام شد ✓ ${parts.join('؛ ')}. جمع فایل‌های نسخه: ${faNum(r.total)}`, 'ok');
    staged.clear();
    if (pop.dataset.id === upTarget.id) refreshFiles(upTarget);  // update the panel summary
  } catch (err) {
    say('آپلود نشد: ' + err.message, 'err');
  } finally {
    uploading = false;
    drawStaged();
  }
};
