/* App start: load the project timeline from the server and do the first draw. */
(async function start() {
  try {
    const res = await fetch(TIMELINE_URL, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `خطا ${res.status}`);
    if (body.timeline) deserialize(body.timeline);
    else initialState();
    persistEnabled = true;
    if (!body.timeline) scheduleSave(); // new project: create timeline.json right now
  } catch (err) {
    initialState(); // display only; since persistEnabled=false nothing is written to disk
    showLoadError(`بارگذاری تایم‌لاین ممکن نشد: ${err.message} — ذخیره‌ی خودکار غیرفعال است تا داده‌ی قبلی پاک نشود.`);
    setSaveState('error', 'ذخیره غیرفعال');
  }
  setMode(mode);
  render();
  fitView();
})();
