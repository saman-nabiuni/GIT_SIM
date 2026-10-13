/* Settings → company employees: upload CSV/Excel, preview and edit with Tabulator, save.
   Note: each column's field in Tabulator is f0, f1, ... so arbitrary column names (dots, spaces) cause no problems. */
const card = document.getElementById('employeesCard');
const COMPANY_ID = card.dataset.companyId;
const REQUIRED = JSON.parse(card.dataset.required);
const URLS = { load: card.dataset.urlLoad, preview: card.dataset.urlPreview, save: card.dataset.urlSave };

const msgBox = document.getElementById('msgBox');
const rowCount = document.getElementById('rowCount');
const dirtyBadge = document.getElementById('dirtyBadge');
const fileInput = document.getElementById('fileInput');

let table = null;
let colNames = [];   // real column names, in order
let dirty = false;

const field = i => `f${i}`;

function setDirty(value) {
  dirty = value;
  dirtyBadge.hidden = !value;
}

function updateCount() {
  rowCount.textContent = table ? `${table.getData().length} ردیف` : '';
}

function buildColumns() {
  const defs = colNames.map((name, i) => {
    const def = { title: name, field: field(i), editor: 'input', minWidth: 120 };
    if (REQUIRED.includes(name)) def.cssClass = 'col-required';
    if (name === 'password') def.formatter = cell => (cell.getValue() ? '••••••' : '');
    return def;
  });
  defs.push({
    title: '', width: 46, hozAlign: 'center', headerSort: false, formatter: 'buttonCross',
    cellClick: (_e, cell) => { cell.getRow().delete(); setDirty(true); updateCount(); },
  });
  return defs;
}

function renderTable(columns, rows) {
  colNames = columns.slice();
  const data = rows.map(r => Object.fromEntries(colNames.map((c, i) => [field(i), r[c] ?? ''])));
  if (table) table.destroy();
  table = new Tabulator('#employeesTable', {
    data,
    columns: buildColumns(),
    layout: 'fitDataStretch',
    height: '420px',
    placeholder: 'هنوز کارمندی اضافه نشده',
  });
  table.on('cellEdited', () => setDirty(true));
  table.on('tableBuilt', updateCount); // don't touch the table API before the table is built
}

function readRows() {
  return table.getData().map(r => Object.fromEntries(colNames.map((c, i) => [c, String(r[field(i)] ?? '')])));
}

async function loadSaved() {
  try {
    const { columns, rows } = await api(URLS.load);
    renderTable(columns, rows);
  } catch (err) {
    renderTable(REQUIRED.slice(), []);
    showMessage(msgBox, 'danger', err.message);
  }
}

document.getElementById('btnPick').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  hideMessage(msgBox);
  const form = new FormData();
  form.append('file', file);
  try {
    const { columns, rows, errors } = await api(URLS.preview, { method: 'POST', form });
    renderTable(columns, rows);
    setDirty(true);
    if (errors.length) showMessage(msgBox, 'warning', 'فایل خوانده شد ولی خطا دارد؛ اصلاح کن و بعد ذخیره بزن:', errors);
    else showMessage(msgBox, 'info', `فایل خوانده شد (${rows.length} ردیف). برای اعمال، «ذخیره» را بزن.`);
  } catch (err) {
    showMessage(msgBox, 'danger', err.message);
  } finally {
    fileInput.value = '';
  }
});

document.getElementById('btnAddRow').addEventListener('click', () => {
  if (!table) return;
  const row = Object.fromEntries(colNames.map((c, i) => [field(i), c === 'company_id' ? COMPANY_ID : '']));
  table.addRow(row, true);
  setDirty(true);
  updateCount();
});

document.getElementById('btnFixCompany').addEventListener('click', () => {
  const idx = colNames.indexOf('company_id');
  if (!table || idx < 0) return;
  table.getRows().forEach(r => r.update({ [field(idx)]: COMPANY_ID }));
  setDirty(true);
});

document.getElementById('btnSave').addEventListener('click', async () => {
  if (!table) return;
  hideMessage(msgBox);
  const btn = document.getElementById('btnSave');
  btn.disabled = true;
  try {
    const res = await api(URLS.save, { method: 'PUT', json: { columns: colNames, rows: readRows() } });
    setDirty(false);
    showMessage(msgBox, 'success', `ذخیره شد (${res.count} ردیف).`);
  } catch (err) {
    showMessage(msgBox, 'danger', err.message, err.details);
  } finally {
    btn.disabled = false;
  }
});

window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

loadSaved();
