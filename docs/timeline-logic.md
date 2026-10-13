# Timeline logic

Code: `static/js/timeline/04-model.js` (logic) and `08-popup.js` (UI). This document must always match the code.

## Concepts
- **Node** = one version: `{id, name, branch, parent, twin, col, stack, base, color}`.
- **Branch** = one horizontal line (lane): `{name, shade}`. `branches[0]` is always `main` with shade 0.
- `parent`: the previous node. `twin`: the "same-name parallel" node that sits right below the original node (same column).
- `col`: horizontal column; `parent ? parent.col + 1 : twin ? twin.col : 0`. `stack`: id of the group of same-column nodes (twins).
- `col` and `stack` are rebuilt by `relayout()` from the links.

## Start
`initialState()`: the `main` branch with node "1". The first node (no parent and no twin) cannot be deleted.

## Next version (`doNext`)
- Only on the last node of each branch (`tipOf`).
- The default name `defaultNext(name)` depends on `mode`:
  - `dec` (decimal): `1.2 -> 1.3`, and "2" -> "2.1"
  - `int` (integer): `2 -> 3`, and `2.2 -> 3`
- The user can type the name manually.

## Parallel branch (`createBranch`)
- From any node. The default name of the branch's first node = `defaultNext(source node name)` (from 2.2 to 2.3).
- If the name is exactly equal to the source node's name -> a **twin** node (same column, below that node).
  Otherwise -> a child of the source node, one column ahead, with an L-shaped line from the source to it.
- The new branch is placed right below the lowest node of the same `stack` in the branch list.
- Each new branch from the same point gets a new **shade**: `max(shade of the branches in the same stack) + 1`.

## Color
- The base color comes from the **first number in the name** (`colorFor`, from `PALETTE`); with no number, the previous node's color.
- Final color = `shadeOf(base, branch.shade)`: 0 the color itself, 1 lighter, 2 darker, 3 even lighter, ...
- A same-name twin node has exactly the color of the original node.

## Connectors
`elbow(a, b)`: if they are in the same row/column the line is straight; otherwise it **goes straight down first, then turns right with a rounded corner**.

## Delete (`subtree` + `removeNodes`)
- Deleting a node = itself + all later nodes + every branch split from any of them (chained through `parent`/`twin`).
- A branch with no nodes is removed. The first node is never removed.
- The UI has two steps: the first click dims the nodes to be deleted, the second click deletes.

## Merge into main (`planMerge` + `applyMerge`)
For a node n on a non-main branch:
1. **Path** = the ancestors of n that are not on main, in chronological order. For a twin node we go back to the original node of the same `stack` (intermediate twins are skipped).
2. The path nodes are **moved** onto main, after the last main node (`parent` = the previous node on main, `twin = null`, branch = main, color = pure color).
3. If the name of any path node already exists on main, **all merged nodes** are renumbered from the end of main with `defaultNext` (e.g. main reached 1.3 and the branch has 1.2 and 1.3 -> 1.4 and 1.5). If there is no collision, names stay the same (fast-forward case).
4. **Parallel timelines built on these nodes are not removed**: their link (`parent`) stays on the moved node and their line is drawn from the new place. Nodes after n on the same branch stay and continue from the merged node.
5. The moved nodes go to the end of the `commits` array (so `tipOf(main)` is them), then `relayout()` and empty branches are removed.
- The UI has two steps; the first click turns the nodes to be merged white and, if names will change, writes that there.

## Zoom and pan (`06-view.js`)
- Scroll = zoom around the mouse; drag = pan; two fingers = zoom and pan; the buttons `+ - ⤢`.
- The background dots move with zoom/pan. If a new node is out of view, the view slides (`reveal`).
- When zoom/drag starts, the node popup closes. After a drag, the next click is ignored.

## Neon glow
`GLOW` in `01-config.js`: `false` means the `glow` class is not put on `<html>` and no shadow rule in `timeline.css` applies. (Currently `false`.)

## Files
Upload/export of each version's files: `docs/versions-files.md`. A merged node keeps its id, so its files stay too.

## Autosave (`07-persist.js`)
After every change (next/branch/delete/merge/mode change) a `PUT` is sent with a 600 ms delay; also immediately when the tab is closed. The change counter (`rev`) prevents concurrent saves. The indicator at the top of the page shows the save state.
