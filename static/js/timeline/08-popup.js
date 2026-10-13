/* Version panel (fixed column on the right): shows the clicked node and has the create-version, branch, merge and delete buttons.
   The panel stays open while you pan/zoom or use dialogs; it changes when you click another node, and closes with × or Esc. */
function fillChips(box, input, values, disabled) {
  box.innerHTML = values
    .map(v => `<button type="button" data-v="${esc(v)}"${disabled ? ' disabled' : ''}>${esc(v)}</button>`)
    .join('');
  box.onclick = e => {
    const b = e.target.closest('button');
    if (b && !b.disabled) { input.value = b.dataset.v; input.focus(); }
  };
}

const dialogOpen = () => ['upDlg', 'exDlg', 'diffDlg', 'runDlg', 'fmDlg'].some(id => $(id) && !$(id).hidden);

// merge + delete buttons (also used to disarm them)
function drawDanger(c) {
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
}

// the first click on merge/delete only arms it; clicking anywhere else cancels
function disarm() {
  const c = byId(pop.dataset.id);
  if (!c) return;
  doomed = merging = null;
  drawDanger(c);
  render();
}

function openPop(c) {
  activeId = c.id;
  doomed = merging = null;
  render();
  pop.dataset.id = c.id;
  pop.style.setProperty('--c', c.color);
  $('popEmpty').hidden = true;
  $('popBody').hidden = false;
  $('pTitle').textContent = `${c.name} · ${c.branch.name}`;
  $('pHash').textContent = c.id;
  $('pNote').value = c.note || '';

  const isTip = tipOf(c.branch) === c;
  $('nName').value = defaultNext(c.name);
  $('nName').disabled = $('btnNext').disabled = !isTip;
  $('hint').textContent = isTip ? '' : 'این نسخه آخر شاخه نیست؛ از اینجا فقط می‌شود شاخه موازی ساخت.';
  fillChips($('chipsNext'), $('nName'), uniq([nextMinor(c.name), nextMajor(c.name)]), !isTip);

  $('pNodeName').value = defaultNext(c.name); // the first node of a parallel branch is one version ahead (2.2 → 2.3)
  fillChips($('chipsPar'), $('pNodeName'), uniq([defaultNext(c.name), nextMinor(c.name), nextMajor(c.name), c.name]), false);
  $('bName').value = '';
  $('bName').placeholder = `branch-${branches.length}`;

  drawDanger(c);
  pop.scrollTop = 0;
  refreshFiles(c); // summary of this version's files (09-files.js)
}

// deselect: the panel goes back to its empty state
function closePop() {
  pop.dataset.id = '';
  $('popBody').hidden = true;
  $('popEmpty').hidden = false;
  activeId = null;
  doomed = merging = null;
  render();
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
  removeNodes(dead);
  closePop();
  scheduleSave();
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
  const last = applyMerge(plan);
  reveal(last);
  scheduleSave();
  openPop(last);
}

function doNext() {
  const c = byId(pop.dataset.id);
  if (tipOf(c.branch) !== c) return;
  const n = addCommit(c.branch, $('nName').value.trim() || defaultNext(c.name), c, null);
  reveal(n);
  scheduleSave();
  openPop(n);
}

function doBranch() {
  const c = byId(pop.dataset.id);
  const name = $('pNodeName').value.trim() || defaultNext(c.name);
  const bname = $('bName').value.trim() || `branch-${branches.length}`;
  const n = createBranch(c, name, bname);
  reveal(n);
  scheduleSave();
  openPop(n);
}

function setMode(m) {
  mode = m;
  $('modeDec').setAttribute('aria-pressed', m === 'dec');
  $('modeInt').setAttribute('aria-pressed', m === 'int');
}

// click on a node = show it in the panel; a click on empty space does nothing (the panel stays)
svg.addEventListener('click', e => {
  const g = e.target.closest('[data-id]');
  if (!g) return;
  e.stopPropagation();
  openPop(byId(g.dataset.id));
});
document.addEventListener('click', e => { if ((doomed || merging) && !e.target.closest('#btnDel, #btnMerge')) disarm(); });
$('popClose').onclick = closePop;
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !pop.dataset.id || dialogOpen()) return;
  if (doomed || merging) disarm(); else closePop();
});

// comment of the version: saved with the timeline (typing = autosave after the usual delay)
$('pNote').addEventListener('input', e => {
  const c = byId(pop.dataset.id);
  if (!c) return;
  c.note = e.target.value;
  scheduleSave();
});

$('btnNext').onclick = doNext;
$('btnBranch').onclick = doBranch;
$('btnDel').onclick = doDelete;
$('btnMerge').onclick = doMerge;
$('nName').addEventListener('keydown', e => { if (e.key === 'Enter') doNext(); });
[$('pNodeName'), $('bName')].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') doBranch(); }));

[['modeDec', 'dec'], ['modeInt', 'int']].forEach(([id, m]) => {
  $(id).onclick = () => { setMode(m); scheduleSave(); };
});
