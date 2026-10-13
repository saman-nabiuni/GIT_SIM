/* Data model and operations on it (no DOM): create node, parallel branch, delete, merge.
   Exact rules in docs/timeline-logic.md */

function addCommit(branch, name, parent, twin) {
  const id = rid();
  let base, color;
  if (!parent && twin && name === twin.name) {
    // same-name parallel node: exactly the same color as the original node
    base = twin.base;
    color = twin.color;
  } else {
    // later nodes: the family color, with this branch's own shade
    base = colorFor(name, (parent || twin)?.base);
    color = shadeOf(base, branch.shade);
  }
  const c = {
    id, name, branch, parent, twin,
    col: parent ? parent.col + 1 : twin ? twin.col : 0,
    stack: !parent && twin ? twin.stack : id,
    base, color,
  };
  commits.push(c);
  freshId = id;
  return c;
}

// the node itself + everything branched from it or after it (chained)
function subtree(c) {
  const out = new Set([c]);
  for (let grew = true; grew;) {
    grew = false;
    commits.forEach(x => {
      if (!out.has(x) && (out.has(x.parent) || out.has(x.twin))) { out.add(x); grew = true; }
    });
  }
  return out;
}

// nodes that must move onto main: from the last non-main node up to their first ancestor, in chronological order
function planMerge(n) {
  const mainB = branches[0];
  const path = [];
  for (let c = n; c && c.branch !== mainB;) {
    path.unshift(c);
    c = c.parent || (c.twin && byId(c.stack)); // a same-name parallel node resolves to the original node at that point
  }
  const tip = tipOf(mainB);
  const used = new Set(commits.filter(x => x.branch === mainB).map(x => x.name));
  const dupe = path.some(p => used.has(p.name));
  const newNames = [];
  if (dupe) { // names collide on main: renumber starting after the end of main
    let prev = tip.name;
    path.forEach(() => { prev = defaultNext(prev); newNames.push(prev); });
  } else path.forEach(p => newNames.push(p.name));
  return { path, tip, dupe, newNames };
}

// recompute every node's column and stack from the links
function relayout() {
  const col = new Map();
  const colOf = c => {
    if (!col.has(c)) col.set(c, c.parent ? colOf(c.parent) + 1 : c.twin ? colOf(c.twin) : 0);
    return col.get(c);
  };
  const stackOf = c => (c.parent ? c.id : c.twin ? stackOf(c.twin) : c.id);
  commits.forEach(c => { c.col = colOf(c); });
  commits.forEach(c => { c.stack = stackOf(c); });
}

/* Start: main branch with version 1 */
function initialState() {
  const main = { name: 'main', shade: 0 };
  branches = [main];
  commits = [];
  addCommit(main, '1', null, null);
}

// parallel branch from node c; returns the new node
function createBranch(c, name, bname) {
  const sameName = name === c.name; // only if the name is exactly the same, a same-column parallel node is created
  // lowest same-name node at this point; the new branch sits right below it
  const low = commits.filter(x => x.stack === c.stack)
    .reduce((a, x) => (laneOf(x.branch) > laneOf(a.branch) ? x : a));
  // each new branch from this point gets a new shade (main branch shade 0 = pure color)
  const family = uniq(commits.filter(x => x.stack === c.stack).map(x => x.branch));
  const b = { name: bname, shade: Math.max(...family.map(x => x.shade)) + 1 };
  branches.splice(laneOf(low.branch) + 1, 0, b);
  return sameName
    ? addCommit(b, name, null, low)   // same-name node, below this node
    : addCommit(b, name, c, null);    // next version, one column ahead and attached to this node
}

// remove a set of nodes (dead = Set); a branch left with no nodes is removed too
function removeNodes(dead) {
  commits = commits.filter(x => !dead.has(x));
  branches = branches.filter(b => commits.some(x => x.branch === b));
}

// apply the merge plan (planMerge); returns the last moved node
function applyMerge(plan) {
  let prev = plan.tip;
  plan.path.forEach((p, i) => {
    p.name = plan.newNames[i];
    p.parent = prev; p.twin = null; p.branch = branches[0];
    p.base = colorFor(p.name, prev.base);
    p.color = p.base; // main has shade 0 = pure color
    prev = p;
  });
  // moved nodes go to the end of the list so they become the last nodes of main
  commits = [...commits.filter(x => !plan.path.includes(x)), ...plan.path];
  relayout();
  // parallel branches split from these nodes stay in place; only an empty branch is removed
  branches = branches.filter(b => commits.some(x => x.branch === b));
  return prev;
}
