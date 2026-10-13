/* Shared helpers for the Bootstrap pages: JSON requests with CSRF token, message display and Persian dates. */
const CSRF_TOKEN = document.querySelector('meta[name="csrf-token"]')?.content || '';

// api(url, {method, json, form}) → JSON data; on error throws an Error with the server's (Persian) message (err.details = detail list)
async function api(url, { method = 'GET', json, form } = {}) {
  const headers = { 'X-CSRF-Token': CSRF_TOKEN, Accept: 'application/json' };
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  else if (form) body = form;
  const res = await fetch(url, { method, headers, body, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = '/login?next=' + encodeURIComponent(location.pathname); throw new Error('نشست تمام شده'); }
  if (!res.ok) {
    const err = new Error(data.error || `خطا ${res.status}`);
    err.details = data.details || [];
    throw err;
  }
  return data;
}

// showMessage(box, 'danger'|'success'|'warning'|'info', text, [details])
function showMessage(box, type, text, details = []) {
  box.className = `alert alert-${type} py-2 small mb-3`;
  box.textContent = '';
  const head = document.createElement('div');
  head.textContent = text;
  box.appendChild(head);
  if (details.length) {
    const ul = document.createElement('ul');
    ul.className = 'mb-0 mt-1 ps-3';
    details.slice(0, 8).forEach(d => { const li = document.createElement('li'); li.textContent = d; ul.appendChild(li); });
    if (details.length > 8) { const li = document.createElement('li'); li.textContent = `… و ${details.length - 8} مورد دیگر`; ul.appendChild(li); }
    box.appendChild(ul);
  }
  box.hidden = false;
}
const hideMessage = box => { box.hidden = true; };

// ISO dates with class js-date are converted to Persian date and time
document.querySelectorAll('time.js-date').forEach(el => {
  const d = new Date(el.getAttribute('datetime'));
  if (!isNaN(d)) el.textContent = d.toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' });
});
