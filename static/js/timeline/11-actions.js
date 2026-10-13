/* Extra actions under "files of this version": export as a folder (default path per project, or pick one with
   the Windows folder dialog) and run app.py straight from the stored files.
   Server side: services/versions_service.py (export_folder) and services/run_service.py. */

const EXPORT_DIR_URL = document.body.dataset.exportDirUrl;
const EXPORT_RUN_URL = document.body.dataset.exportRunUrl;
const RUN_START_URL = document.body.dataset.runStartUrl;
const RUN_URL = document.body.dataset.runUrl;
const RUN_STOP_URL = document.body.dataset.runStopUrl;
const PICK_FOLDER_URL = '/api/fs/pick';

async function postJson(url, body = {}) {
  const res = await fetch(url, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF, Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `خطا ${res.status}`);
    err.details = data.details || [];
    throw err;
  }
  return data;
}

async function getJson(url) {
  const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `خطا ${res.status}`);
  return data;
}

/* ---------- Buttons in the version panel (called by refreshFiles in 09-files.js) ---------- */
let runState = { running: false, cid: null };

function updateActions(info) {
  $('btnExportDir').disabled = !(info && info.count);
  $('btnDiff').disabled = !(info && info.count);  // 12-diff.js
  $('btnFiles').disabled = !(info && info.count); // 14-filemgr.js
  $('btnRun').hidden = !(info && info.has_app);  // app.py must be in the first layer of the version's files
  const pack = $('btnExportRun');  // zip to run app.py on the person's own computer
  pack.hidden = !(info && info.has_app);
  if (info && info.has_app) pack.href = forCommit(EXPORT_RUN_URL, pop.dataset.id);
  else pack.removeAttribute('href');
  if (info && info.has_app) refreshRunButton();
}

async function refreshRunButton() {
  try { runState = await getJson(RUN_URL); } catch (_) { return; }
  const here = runState.running && runState.cid === pop.dataset.id;
  $('btnRun').textContent = here ? 'app.py در حال اجراست…' : 'اجرای app.py';
}

/* ---------- Export as folder ---------- */
const exDlg = $('exDlg'), exPath = $('exPath'), exMsg = $('exMsg'), exGo = $('exGo');
const EXPORT_DIR_KEY = 'exportDir:' + location.pathname;  // last custom path of this project (this browser)
let exTarget = null, exDefault = '', exBusy = false;

function sayEx(text, cls = '') { exMsg.textContent = text; exMsg.className = cls; }

function openExport() {
  const c = byId(pop.dataset.id), info = lastInfo;
  if (!c || !info || !info.count) return;
  exTarget = c;
  exDefault = info.default_export_dir;
  let saved = '';
  try { saved = localStorage.getItem(EXPORT_DIR_KEY) || ''; } catch (_) { /* storage blocked */ }
  exPath.value = saved || exDefault;
  $('exTitle').textContent = `ذخیره‌ی نسخه‌ی ${c.name} به صورت پوشه`;
  $('exName').textContent = info.folder_name;
  sayEx('');
  exDlg.hidden = false;
  exGo.focus();
}

function closeExport() {
  if (exBusy) return;
  exDlg.hidden = true;
  exTarget = null;
}

async function doExport(overwrite = false) {
  if (exBusy || !exTarget) return;
  exBusy = true;
  exGo.disabled = true;
  sayEx('در حال ذخیره…');
  try {
    if (!(await ensureSaved())) throw new Error('تایم‌لاین هنوز ذخیره نشده؛ دوباره امتحان کن');
    const dest = exPath.value.trim();
    const custom = dest && dest !== exDefault;
    const r = await postJson(forCommit(EXPORT_DIR_URL, exTarget.id), { dest: custom ? dest : '', overwrite });
    try {
      if (custom) localStorage.setItem(EXPORT_DIR_KEY, dest); else localStorage.removeItem(EXPORT_DIR_KEY);
    } catch (_) { /* storage blocked */ }
    sayEx(`${faNum(r.count)} فایل ذخیره شد ✓ ${r.path}`, 'ok');
  } catch (err) {
    if (!overwrite && err.details && err.details.includes('exists')
        && confirm('پوشه‌ی مقصد از قبل هست؛ فایل‌های هم‌نام جایگزین می‌شوند و بقیه‌ی فایل‌ها دست نمی‌خورند. ادامه بدهم؟')) {
      exBusy = false;
      return await doExport(true);
    }
    sayEx('ذخیره نشد: ' + err.message, 'err');
  } finally {
    exBusy = false;
    exGo.disabled = false;
  }
}

$('btnExportDir').onclick = openExport;
exGo.onclick = () => doExport(false);
$('exDefault').onclick = () => { exPath.value = exDefault; };
$('exPick').onclick = async () => {  // native Windows dialog (opens on the server machine)
  const btn = $('exPick');
  btn.disabled = true;
  try {
    const { path } = await postJson(PICK_FOLDER_URL, { initial: exPath.value.trim() });
    if (path) exPath.value = path;  // empty = the user cancelled the dialog
  } catch (err) {
    sayEx(err.message, 'err');
  } finally {
    btn.disabled = false;
  }
};
exPath.addEventListener('keydown', e => { if (e.key === 'Enter') doExport(false); });
$('exClose').onclick = $('exCancel').onclick = closeExport;
exDlg.addEventListener('mousedown', e => { if (e.target === exDlg) closeExport(); });

/* ---------- Run app.py ---------- */
const runDlg = $('runDlg'), runInfo = $('runInfo'), runLink = $('runLink'), runLog = $('runLog'), runStop = $('runStop');
let runTimer = null, lastLog = null;

// every http(s) address in the app's output becomes a clickable link (0.0.0.0 / 127.0.0.1 are replaced by the host you are on)
const URL_RE = /https?:\/\/[^\s<>"'`()\[\]]+/g;

function linkHref(raw) {
  try {
    const u = new URL(raw);
    if (['0.0.0.0', '127.0.0.1', 'localhost'].includes(u.hostname)) u.hostname = location.hostname;  // the app runs on the server, not on this computer
    return u.href;
  } catch (_) { return null; }
}

function linkify(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?]+$/, '');  // trailing punctuation is not part of the address
    const href = linkHref(url);
    if (!href) continue;
    if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = url;
    out.push(a);
    last = m.index + url.length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

function renderRun(s) {
  runState = s;
  runInfo.className = '';
  if (!s.cid) {
    runInfo.textContent = 'برنامه‌ای در حال اجرا نیست.';
    runLink.hidden = true;
    runLog.textContent = '';
    lastLog = null;
    runStop.disabled = true;
    return;
  }
  runInfo.textContent = s.running
    ? `نسخه‌ی ${s.version} در حال اجراست (پورت ${s.port})`
    : `اجرا تمام شد (کد خروج ${s.exit_code}) — خروجی را ببین.`;
  runLink.hidden = !s.running;
  if (s.running) {  // the link uses the address you opened this page with (192.168.x.x or 127.0.0.1)
    const host = location.hostname.includes(':') ? `[${location.hostname}]` : location.hostname;
    runLink.href = runLink.textContent = `http://${host}:${s.port}`;
  }
  const log = s.log || '(هنوز خروجی‌ای نیست)';
  if (log !== lastLog) {  // redraw only when the output changed, so a click on a link is never lost
    const atEnd = runLog.scrollTop + runLog.clientHeight >= runLog.scrollHeight - 8;
    runLog.replaceChildren(...linkify(log));
    lastLog = log;
    if (atEnd) runLog.scrollTop = runLog.scrollHeight;
  }
  runStop.disabled = !s.running;
}

function openRunDlg() {
  runDlg.hidden = false;
  clearInterval(runTimer);
  runTimer = setInterval(async () => { try { renderRun(await getJson(RUN_URL)); } catch (_) { /* try again next tick */ } }, 1500);
}

function closeRunDlg() {
  runDlg.hidden = true;
  clearInterval(runTimer);
  refreshRunButton();
}

$('btnRun').onclick = async () => {
  const c = byId(pop.dataset.id);
  if (!c) return;
  const already = runState.running && runState.cid === c.id;
  runLog.textContent = '';
  lastLog = null;
  runLink.hidden = true;
  runInfo.className = '';
  runInfo.textContent = already ? '…' : 'در حال آماده‌سازی و اجرا…';
  runStop.disabled = true;
  openRunDlg();
  try {
    if (already) { renderRun(await getJson(RUN_URL)); return; }
    if (!(await ensureSaved())) throw new Error('تایم‌لاین هنوز ذخیره نشده؛ دوباره امتحان کن');
    renderRun(await postJson(forCommit(RUN_START_URL, c.id)));
  } catch (err) {
    runInfo.className = 'err';
    runInfo.textContent = 'اجرا نشد: ' + err.message;
  }
};

runStop.onclick = async () => {
  runStop.disabled = true;
  try { renderRun(await postJson(RUN_STOP_URL)); }
  catch (err) { runInfo.className = 'err'; runInfo.textContent = 'توقف ممکن نشد: ' + err.message; runStop.disabled = false; }
};
$('runClose').onclick = $('runDone').onclick = closeRunDlg;
runDlg.addEventListener('mousedown', e => { if (e.target === runDlg) closeRunDlg(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!exDlg.hidden) closeExport();
  if (!runDlg.hidden) closeRunDlg();
});
