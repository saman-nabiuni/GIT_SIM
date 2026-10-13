/* ===================== Settings =====================
   GLOW: neon glow (shadow/glow) on lines, nodes and colored circles.
   false → these shadows are not applied at all (not just invisible), so rendering is lighter.
   ====================================================== */
const GLOW = false;
document.documentElement.classList.toggle('glow', GLOW);

const PALETTE = ['#ff2e93', '#26e8ff', '#b6ff3b', '#ffb020', '#9b6bff', '#ff6b4a', '#2effb0', '#ff5de0'];
const STEP = 96, LANE = 78, PADX = 60, PADY = 56;
const MINK = 0.25, MAXK = 3;   // min and max zoom
const SAVE_DELAY_MS = 600;     // autosave delay after the last change
