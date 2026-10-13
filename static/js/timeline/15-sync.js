/* Team fork only: new versions the owner adds on main's own line arrive here by themselves.
   The server copies the files and sends the nodes; THIS page adds them to its own timeline and saves it, so the
   member's own nodes are never touched. Placement rule for a new node N whose parent in main is P:
     - P is the last node of its branch  -> N goes on that same branch, right after P
     - otherwise (the member already continued after P) -> N starts a new branch "از مدیر" hanging from P. */
const SYNC_PULL_URL = document.body.dataset.syncPullUrl;
const SYNC_ACK_URL = document.body.dataset.syncAckUrl;
const SYNC_EVERY_MS = 30000;
const SYNC_BRANCH = 'از مدیر';
let syncStarted = false, syncBusy = false;

// the incoming node goes after its parent (or a new branch from it); returns the new node
function placeIncoming(n, anchor) {
  let branch = anchor.branch;
  if (tipOf(branch) !== anchor) {  // the member already built on this branch after the parent: use a new branch (same rules as createBranch)
    const family = commits.filter(x => x.stack === anchor.stack);
    const low = family.reduce((a, x) => (laneOf(x.branch) > laneOf(a.branch) ? x : a));
    branch = { name: SYNC_BRANCH, shade: Math.max(...uniq(family.map(x => x.branch)).map(b => b.shade)) + 1 };
    branches.splice(laneOf(low.branch) + 1, 0, branch);
  }
  const c = {
    id: n.id, name: n.name, branch, parent: anchor, twin: null, col: anchor.col + 1, stack: n.id,
    base: n.base, color: shadeOf(n.base, branch.shade), note: n.note || '',
  };
  commits.push(c);
  return c;
}

function applyIncoming(nodes, baseId) {
  let added = 0, last = null;
  nodes.forEach(n => {
    if (byId(n.id)) { last = byId(n.id); return; }   // already here (an earlier save whose acknowledgement got lost)
    const anchor = byId(n.parent) || last || byId(baseId) || commits[0];
    if (!anchor) return;
    last = placeIncoming(n, anchor);
    added++;
  });
  return added;
}

async function syncNow() {
  if (syncBusy) return;
  syncBusy = true;
  try {
    const r = await postJson(SYNC_PULL_URL, {});
    if (!r.nodes.length) return;
    const added = applyIncoming(r.nodes, r.base);
    if (added) { relayout(); render(); scheduleSave(); }
    if (await ensureSaved()) await postJson(SYNC_ACK_URL, { ids: r.nodes.map(n => n.id) });
    if (added) $('syncNote').textContent = `${faNum(added)} نسخه‌ی تازه از مدیر اضافه شد.`;
  } catch (_) { /* try again at the next round */ }
  finally { syncBusy = false; }
}

function startSync() {
  if (syncStarted || READONLY || !SYNC_PULL_URL || !persistEnabled) return;
  syncStarted = true;
  syncNow();
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, SYNC_EVERY_MS);
}

if (persistEnabled) startSync();  // 10-main.js already finished loading the timeline
