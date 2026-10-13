/* File manager of a version: folder tree of the version's files + cut / copy / paste / rename / delete.
   Opened from the "ساختار و مدیریت فایل‌ها" button in the version panel (09-files.js has buildTree and the tree helpers).
   Server side: versions_service.edit_files -> POST .../versions/<cid>/files/edit. Only the version's file list changes
   (a version without files of its own first takes a snapshot of the inherited ones); other versions are never touched. */

const FILES_EDIT_URL = document.body.dataset.filesEditUrl;
const fmDlg = $('fmDlg'), fmTree = $('fmTree'), fmMsg = $('fmMsg'), fmNote = $('fmNote');
const fmSel = new Set();   // selected paths (a selected folder covers everything inside it)
const fmOpen = new Set();  // expanded folders
let fmCid = null, fmFiles = [], fmTarget = '', fmRenaming = null, fmBusy = false;
let fmClip = null;         // {op: 'cut' | 'copy', paths, cid}

const fmSize = n => n < 1024 ? `${latin(n)} B` : n < 1048576 ? `${latin(Math.round(n / 102.4) / 10)} KB` : `${latin(Math.round(n / 104857.6) / 10)} MB`;
const isoPath = p => `\u2066${p || '/'}\u2069`;  // keeps a path left-to-right inside Persian text

function sayFm(text, cls = '') { fmMsg.textContent = text; fmMsg.className = cls; }

const fmAncestors = p => { const out = []; for (let i = p.indexOf('/'); i > 0; i = p.indexOf('/', i + 1)) out.push(p.slice(0, i)); return out; };
const fmCovered = p => fmAncestors(p).some(a => fmSel.has(a));          // inside a selected folder
const fmDirSet = () => new Set(fmFiles.flatMap(f => fmAncestors(f.path)));
const fmUnder = (p, folder) => p === folder || p.startsWith(folder + '/');
const fmCount = paths => fmFiles.filter(f => paths.some(p => fmUnder(f.path, p))).length;
const fmReveal = p => fmAncestors(p).forEach(a => fmOpen.add(a));

/* ---------- Toolbar ---------- */
function fmUpdateBar() {
  const n = fmSel.size;
  $('fmCut').disabled = $('fmCopy').disabled = $('fmDelete').disabled = !n || fmBusy;
  $('fmRename').disabled = n !== 1 || fmBusy;
  $('fmPaste').disabled = !fmClip || fmBusy;
  // status chips: selection, clipboard, paste target
  const chip = (cls, label, value) => {
    const sp = document.createElement('span'), b = document.createElement('b');
    sp.className = 'chip2 ' + cls; b.textContent = value;
    sp.append(label + ' ', b);
    return sp;
  };
  const chips = [];
  if (n) chips.push(chip('sel', 'انتخاب‌شده:', latin(n)));
  if (fmClip) chips.push(chip('clip', fmClip.op === 'cut' ? 'کات‌شده:' : 'کپی‌شده:', latin(fmClip.paths.length)));
  chips.push(chip('dest', 'مقصد چسباندن:', isoPath(fmTarget)));
  $('fmInfo').replaceChildren(...chips);
}

/* ---------- Tree ---------- */
function fmRowEl(path, name, isDir, metaText) {
  const row = document.createElement('div');
  row.className = 'row' + (fmSel.has(path) || fmCovered(path) ? ' sel' : '') + (isDir && fmTarget === path ? ' target' : '');
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = fmSel.has(path) || fmCovered(path); cb.disabled = fmCovered(path);
  cb.setAttribute('aria-label', 'انتخاب ' + name);
  cb.onclick = e => { e.stopPropagation(); fmToggleSel(path, isDir); drawFm(); };
  const arrow = document.createElement('span');
  arrow.className = 'arrow'; arrow.textContent = isDir ? '▾' : '';
  const label = document.createElement('span');
  label.className = 'name'; label.title = path;
  if (fmRenaming === path) {
    const inp = document.createElement('input');
    inp.className = 'rn'; inp.value = name; inp.dir = 'ltr'; inp.spellcheck = false; inp.autocomplete = 'off';
    inp.onclick = e => e.stopPropagation();
    inp.onkeydown = e => {
      e.stopPropagation();  // Esc here only cancels the rename (it must not close the dialog)
      if (e.key === 'Enter') { const v = inp.value.trim(); fmRenaming = null; if (v && v !== name) fmApply('rename', { paths: [path], new_name: v }); else drawFm(); }
      else if (e.key === 'Escape') { fmRenaming = null; drawFm(); }
    };
    inp.onblur = () => { if (fmRenaming === path) { fmRenaming = null; drawFm(); } };
    label.replaceChildren(inp);
    setTimeout(() => { inp.focus(); inp.setSelectionRange(0, !isDir && name.lastIndexOf('.') > 0 ? name.lastIndexOf('.') : name.length); }, 0);
  } else label.textContent = name;
  const meta = document.createElement('span');
  meta.className = 'meta'; meta.textContent = metaText;
  row.append(arrow, cb, ftIcon(isDir, name), label, meta);
  if (isDir && fmTarget === path) { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'مقصد'; row.insertBefore(tag, meta); }
  return { row, arrow };
}

function fmItems(node) {
  const out = [];
  const cut = p => fmClip && fmClip.op === 'cut' && fmClip.cid === fmCid && fmClip.paths.some(c => fmUnder(p, c));
  for (const d of treeDirs(node)) {
    const li = document.createElement('li');
    li.className = 'dir' + (fmOpen.has(d.path) ? '' : ' closed') + (cut(d.path) ? ' cut' : '');
    const { row, arrow } = fmRowEl(d.path, d.name, true, `${latin(treeCount(d))} files · ${fmSize(treeSize(d))}`);
    arrow.onclick = e => { e.stopPropagation(); fmOpen.has(d.path) ? fmOpen.delete(d.path) : fmOpen.add(d.path); drawFm(); };
    row.onclick = () => { fmTarget = d.path; fmOpen.add(d.path); drawFm(); };  // the folder you click is the paste target
    const ul = document.createElement('ul');
    ul.append(...fmItems(d));
    li.append(row, ul);
    out.push(li);
  }
  for (const f of treeFiles(node)) {
    const li = document.createElement('li');
    li.className = 'file' + (cut(f.item.path) ? ' cut' : '');
    const { row } = fmRowEl(f.item.path, f.name, false, fmSize(f.item.size));
    row.onclick = () => { if (!fmCovered(f.item.path)) { fmToggleSel(f.item.path, false); drawFm(); } };
    li.append(row);
    out.push(li);
  }
  return out;
}

function fmToggleSel(path, isDir) {
  if (fmSel.has(path)) { fmSel.delete(path); return; }
  if (isDir) [...fmSel].forEach(p => { if (p.startsWith(path + '/')) fmSel.delete(p); });
  fmSel.add(path);
}

function drawFm() {
  const keep = fmTree.scrollTop;
  if (!fmFiles.length) {
    const li = document.createElement('li');
    li.className = 'empty'; li.textContent = 'این نسخه فایلی ندارد.';
    fmTree.replaceChildren(li);
    fmUpdateBar();
    return;
  }
  const rootLi = document.createElement('li');
  rootLi.className = 'dir';
  const root = document.createElement('div');
  root.className = 'row' + (fmTarget === '' ? ' target' : '');
  const name = document.createElement('span'), meta = document.createElement('span');
  name.className = 'name'; name.textContent = '/  root';
  meta.className = 'meta'; meta.textContent = `${latin(fmFiles.length)} files · ${fmSize(fmFiles.reduce((s, f) => s + f.size, 0))}`;
  root.append(ftIcon(true), name);
  if (fmTarget === '') { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'مقصد'; root.append(tag); }
  root.append(meta);
  root.onclick = () => { fmTarget = ''; drawFm(); };
  const ul = document.createElement('ul');
  ul.append(...fmItems(buildTree(fmFiles)));
  rootLi.append(root, ul);
  fmTree.replaceChildren(rootLi);
  fmTree.scrollTop = keep;
  fmUpdateBar();
}

/* ---------- Server calls ---------- */
function fmSetInfo(info) {
  fmFiles = info.files;
  fmNote.textContent = info.inherited_from
    ? `این نسخه هنوز فایل‌های خودش را ندارد و از نسخه‌ی ${info.inherited_from.name} به ارث رسیده؛ با اولین تغییر، فهرست فایل‌های مستقل خودش را می‌گیرد (نسخه‌ی ${info.inherited_from.name} تغییر نمی‌کند).`
    : '';
  const dirs = fmDirSet();
  [...fmOpen].forEach(p => { if (!dirs.has(p)) fmOpen.delete(p); });
  [...fmSel].forEach(p => { if (!fmFiles.some(f => fmUnder(f.path, p))) fmSel.delete(p); });
  if (fmTarget && !dirs.has(fmTarget)) fmTarget = '';
}

async function fmApply(op, extra = {}, overwrite = false) {
  if (fmBusy) return false;
  fmBusy = true; fmUpdateBar(); sayFm('…');
  try {
    if (!(await ensureSaved())) throw new Error('تایم‌لاین هنوز ذخیره نشده؛ دوباره امتحان کن');
    const r = await postJson(forCommit(FILES_EDIT_URL, fmCid), { op, overwrite, ...extra });
    fmSel.clear();
    if (op === 'rename') {  // keep the opened state of a renamed folder
      const old = extra.paths[0], neu = (old.includes('/') ? old.slice(0, old.lastIndexOf('/') + 1) : '') + extra.new_name;
      [...fmOpen].forEach(p => { if (fmUnder(p, old)) { fmOpen.delete(p); fmOpen.add(neu + p.slice(old.length)); } });
    }
    if (extra.dest !== undefined) { if (extra.dest) { fmOpen.add(extra.dest); fmReveal(extra.dest); } }
    fmSetInfo(r);
    sayFm({ rename: 'نام عوض شد', delete: 'حذف شد', copy: 'کپی شد', move: 'منتقل شد' }[op] + ` ✓ (${latin(r.affected)} فایل)`, 'ok');
    const c = byId(fmCid);
    if (c && pop.dataset.id === c.id) refreshFiles(c);  // summary in the panel
    return true;
  } catch (err) {
    if (!overwrite && err.details && err.details.includes('exists') && confirm(err.message + '\nجایگزین شوند؟')) {
      fmBusy = false;
      return await fmApply(op, extra, true);
    }
    sayFm(err.message, 'err');
    return false;
  } finally {
    fmBusy = false;
    drawFm();
  }
}

/* ---------- Actions ---------- */
function fmClipSet(op) {
  if (!fmSel.size) return;
  fmClip = { op, paths: [...fmSel], cid: fmCid };
  sayFm(`${latin(fmClip.paths.length)} مورد ${op === 'cut' ? 'برای انتقال' : 'برای کپی'} آماده شد؛ پوشه‌ی مقصد را انتخاب کن و «چسباندن» را بزن.`);
  drawFm();
}

async function fmPaste() {
  if (!fmClip || fmClip.cid !== fmCid) return;
  const clip = fmClip;
  const ok = await fmApply(clip.op === 'cut' ? 'move' : 'copy', { paths: clip.paths, dest: fmTarget });
  if (ok && clip.op === 'cut') { fmClip = null; drawFm(); }
}

function fmStartRename() {
  if (fmSel.size !== 1 || fmBusy) return;
  fmRenaming = [...fmSel][0];
  fmReveal(fmRenaming);
  drawFm();
}

function fmDelete() {
  if (!fmSel.size || fmBusy) return;
  const paths = [...fmSel], n = fmCount(paths);
  const what = paths.length === 1 ? `«${paths[0]}»` : `${latin(paths.length)} مورد`;
  if (!confirm(`${what} (${latin(n)} فایل) از همین نسخه حذف شود؟`)) return;
  if (fmClip) fmClip = null;
  fmApply('delete', { paths });
}

async function openFm() {
  const c = byId(pop.dataset.id);
  if (!c) return;
  if (fmClip && fmClip.cid !== c.id) fmClip = null;
  fmCid = c.id;
  fmSel.clear(); fmOpen.clear(); fmRenaming = null; fmTarget = ''; fmFiles = [];
  $('fmTitle').textContent = `ساختار و فایل‌های نسخه‌ی ${c.name}`;
  fmNote.textContent = '';
  sayFm('در حال خواندن…');
  fmTree.replaceChildren();
  fmUpdateBar();
  fmDlg.hidden = false;
  try {
    if (!(await ensureSaved())) throw new Error('تایم‌لاین هنوز ذخیره نشده؛ دوباره امتحان کن');
    const info = await getJson(forCommit(FILES_URL, c.id));
    if (fmCid !== c.id || fmDlg.hidden) return;
    fmFiles = info.files;
    if (info.count <= 80) fmDirSet().forEach(p => fmOpen.add(p));  // small projects: everything expanded; big ones start collapsed
    fmSetInfo(info);
    sayFm('');
    drawFm();
  } catch (err) {
    sayFm('خواندن فایل‌ها ممکن نشد: ' + err.message, 'err');
  }
}

function closeFm() {
  if (fmBusy) return;
  fmDlg.hidden = true;
  fmRenaming = null;
  fmCid = null;
}

$('btnFiles').onclick = openFm;
$('fmClose').onclick = closeFm;
$('fmCut').onclick = () => fmClipSet('cut');
$('fmCopy').onclick = () => fmClipSet('copy');
$('fmPaste').onclick = fmPaste;
$('fmRename').onclick = fmStartRename;
$('fmDelete').onclick = fmDelete;
fmDlg.addEventListener('mousedown', e => { if (e.target === fmDlg) closeFm(); });

// keyboard like a file explorer (e.code, so it also works with a Persian keyboard layout)
document.addEventListener('keydown', e => {
  if (fmDlg.hidden) return;
  if (e.key === 'Escape') { if (!fmRenaming) closeFm(); return; }
  const t = e.target;
  if (fmRenaming || (/^(INPUT|TEXTAREA)$/.test(t.tagName) && t.type !== 'checkbox')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === 'KeyX') { e.preventDefault(); fmClipSet('cut'); }
  else if (mod && e.code === 'KeyC') { e.preventDefault(); fmClipSet('copy'); }
  else if (mod && e.code === 'KeyV') { e.preventDefault(); fmPaste(); }
  else if (e.key === 'F2') { e.preventDefault(); fmStartRename(); }
  else if (e.key === 'Delete') { e.preventDefault(); fmDelete(); }
});
