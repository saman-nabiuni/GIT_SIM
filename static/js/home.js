/* Projects page: new-project form + folder picker (admin), share with employees (admin), remove/unshare from list (two-step). */
const newCard = document.getElementById('newProjectCard');
const btnNew = document.getElementById('btnNewProject');
const form = document.getElementById('newProjectForm');
const errBox = document.getElementById('newProjectError');

if (newCard && btnNew && form) {  // only the admin has these
  function toggleForm(open) {
    newCard.hidden = !open;
    btnNew.setAttribute('aria-expanded', open);
    if (open) document.getElementById('projName').focus();
  }
  btnNew.addEventListener('click', () => toggleForm(newCard.hidden));
  document.getElementById('btnCancelProject').addEventListener('click', () => { hideMessage(errBox); toggleForm(false); });

  // Browse button: opens the native folder dialog on the server machine and fills the path input.
  const pathInput = document.getElementById('projPath');
  const btnBrowse = document.getElementById('btnBrowse');
  btnBrowse.addEventListener('click', async () => {
    hideMessage(errBox);
    btnBrowse.disabled = true;
    try {
      const { path } = await api('/api/fs/pick', { method: 'POST', json: { initial: pathInput.value.trim() } });
      if (path) pathInput.value = path;  // empty = the user cancelled the dialog
    } catch (err) {
      showMessage(errBox, 'danger', err.message);
    } finally {
      btnBrowse.disabled = false;
    }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    hideMessage(errBox);
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api('/api/projects', {
        method: 'POST',
        json: { name: document.getElementById('projName').value, base_path: document.getElementById('projPath').value },
      });
      location.reload();
    } catch (err) {
      showMessage(errBox, 'danger', err.message);
      submit.disabled = false;
    }
  });
}

// share: the admin picks employees; each gets a private copy (fork) of the project's latest main version
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;  // textContent only: names come from the employees file
  return node;
}

function renderSharePanel(panel, pid, people, settingsUrl) {
  panel.replaceChildren();
  if (!people.length) {
    const p = el('p', 'mb-0', 'هنوز کارمندی تعریف نشده؛ اول در ');
    const a = el('a', '', 'تنظیمات'); a.href = settingsUrl;
    p.append(a, ' فایل کارمندان را آپلود کن.');
    panel.append(p);
    return;
  }
  panel.append(el('p', 'mb-2 text-secondary', 'با چه کسانی شیر شود؟ برای هر نفر یک نسخه‌ی شخصی از آخرین نسخه‌ی main ساخته می‌شود.'));
  const boxes = [];
  people.forEach(person => {
    const label = el('label', 'd-flex align-items-center gap-2 py-1');
    const box = el('input', 'form-check-input m-0');
    box.type = 'checkbox'; box.value = person.user_id;
    if (person.fork_id) { box.checked = true; box.disabled = true; } else boxes.push(box);
    const name = el('span', '', person.username); name.dir = 'ltr';
    label.append(box, name);
    if (person.fork_id) label.append(el('span', 'badge text-bg-success', 'شیر شده'));
    else if (!person.has_password) label.append(el('span', 'badge text-bg-warning', 'رمز ندارد؛ نمی‌تواند وارد شود'));
    panel.append(label);
  });
  const msg = el('div', 'mt-2');
  const go = el('button', 'btn btn-sm btn-primary mt-2', 'شیر کن');
  go.type = 'button';
  go.disabled = !boxes.length;
  if (!boxes.length) msg.textContent = 'با همه‌ی کارمندان شیر شده است.';
  go.addEventListener('click', async () => {
    const ids = boxes.filter(b => b.checked).map(b => b.value);
    if (!ids.length) { msg.textContent = 'حداقل یک نفر را انتخاب کن.'; return; }
    go.disabled = true; msg.textContent = '…';
    try {
      const r = await api(`/api/projects/${pid}/shares`, { method: 'POST', json: { user_ids: ids } });
      if (!r.failed.length) { location.reload(); return; }
      msg.textContent = r.failed.map(f => `${f.username || f.user_id}: ${f.error}`).join(' | ');
      go.disabled = false;
    } catch (err) {
      msg.textContent = err.message;
      go.disabled = false;
    }
  });
  panel.append(go, msg);
}

document.querySelectorAll('.js-share').forEach(btn => {
  const panel = btn.parentElement.querySelector('.share-panel');
  btn.addEventListener('click', async () => {
    const open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open);
    if (!open) return;
    panel.textContent = '…';
    try {
      const { people } = await api(`/api/projects/${btn.dataset.id}/shares`);
      renderSharePanel(panel, btn.dataset.id, people, btn.dataset.settingsUrl);
    } catch (err) {
      panel.textContent = err.message;
    }
  });
});

// remove from list: the first click turns the button into "Sure?", the second click removes (project files are not deleted)
document.querySelectorAll('.js-remove').forEach(btn => {
  let timer = null;
  btn.addEventListener('click', async () => {
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.dataset.label = btn.textContent;
      btn.textContent = 'مطمئنی؟';
      timer = setTimeout(() => { btn.classList.remove('armed'); btn.textContent = btn.dataset.label; }, 3500);
      return;
    }
    clearTimeout(timer);
    btn.disabled = true;
    try {
      await api(`/api/projects/${btn.dataset.id}`, { method: 'DELETE' });
      location.reload();
    } catch (err) {
      btn.disabled = false;
      btn.classList.remove('armed');
      btn.textContent = btn.dataset.label;
      alert(err.message);
    }
  });
});
