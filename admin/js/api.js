/*
 * FINDOM YOURSELF · Control Room: talking to api.php, and the one copy of the state.
 *
 * Every change answers with the full admin state, which replaces ours and re-renders the
 * page. Signed out mid-task? A sign-in box appears in place and the same request is sent
 * again afterwards, so nothing typed is lost. A stale security token is refreshed once.
 */
import { h, ctx } from './core.js';
import { Sheet, field, toast, button } from './ui.js';

const tokenMeta = document.querySelector('meta[name="csrf-token"]');
let csrf = tokenMeta ? tokenMeta.content : '';

export const store = { state: null, meta: null };
const listeners = new Set();

/** fn(state, previousState) runs after every change. Returns an unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export class ApiError extends Error {
  constructor(message, status = 0, code = '', data = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export function setCsrf(token) {
  if (!token || token === csrf) return;
  csrf = token;
  if (tokenMeta) tokenMeta.content = token;
  document.querySelectorAll('input[name="csrf"]').forEach((input) => { input.value = token; });
  const app = document.getElementById('app');
  if (app) app.dataset.logoutCsrf = token;
}

/* ───────────────────────── applying state ───────────────────────── */

// Answers can arrive out of order when several requests overlap (two quick taps).
// "epoch" counts changes sent; a poll that started before a change never overwrites it.
let epoch = 0;
let inflight = 0;
let overlapped = false;

function applyState(state, receivedAt) {
  if (!state || !state.settings) return;
  const prev = store.state;
  if (prev && state.updatedAt < prev.updatedAt) return; // an older answer arriving late
  // Server clock vs ours: keep the estimate steady unless it's clearly off (a clock change).
  const serverMs = Date.parse(state.serverTime);
  if (Number.isFinite(serverMs)) {
    const offset = serverMs + 500 - receivedAt;
    if (!ctx.offsetKnown || Math.abs(offset - ctx.offset) > 2000) {
      ctx.offset = Math.abs(offset) < 1500 ? 0 : offset;
      ctx.offsetKnown = true;
    }
  }
  ctx.currency = state.settings.baseCurrency;
  ctx.timezone = state.settings.timezone;
  store.state = state;
  for (const fn of listeners) {
    try {
      fn(state, prev);
    } catch (e) {
      console.error(e); // one broken view must not stop the others updating
    }
  }
}

/* ───────────────────────── requests ───────────────────────── */

async function request(action, { method = 'POST', body = null } = {}) {
  const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (method === 'POST') {
    init.headers['X-CSRF-Token'] = csrf;
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body || {});
  }
  let res;
  try {
    res = await fetch(`api.php?action=${encodeURIComponent(action)}`, init);
  } catch (e) {
    throw new ApiError('Couldn’t reach the server. Check your connection and try again.', 0, 'network');
  }
  return readResponse(res.status, () => res.json());
}

async function readResponse(status, parse) {
  let data = null;
  try {
    data = await parse();
  } catch (e) {
    data = null;
  }
  if (!data || typeof data !== 'object') {
    const message = status === 413 ? 'That’s too large for the server.' : `The server hiccuped (error ${status || '?'}). Try again.`;
    throw new ApiError(message, status, 'server');
  }
  if (status < 200 || status >= 300 || data.ok === false) {
    throw new ApiError(data.error || `That didn’t work (error ${status}).`, status, data.code || '', data);
  }
  return data;
}

/** Runs send(); signs in again or refreshes the token when the server asks, then retries. */
async function withAuth(send) {
  let signIns = 0;
  let freshToken = false;
  for (;;) {
    try {
      return await send();
    } catch (e) {
      if (e.status === 401 && e.code === 'auth' && signIns < 3) {
        signIns++;
        await reauth();
        continue;
      }
      if (e.status === 403 && e.code === 'csrf' && !freshToken) {
        freshToken = true;
        await refresh();
        continue;
      }
      throw e;
    }
  }
}

async function tracked(send) {
  epoch++;
  inflight++;
  if (inflight > 1) overlapped = true;
  try {
    const data = await withAuth(send);
    if (data.csrf) setCsrf(data.csrf);
    applyState(data.state, Date.now());
    return data;
  } finally {
    inflight--;
    if (inflight === 0 && overlapped) { // several changes crossed paths: settle on the final truth
      overlapped = false;
      refresh().catch(() => {});
    }
  }
}

/** POST an action. Resolves with the whole answer (state already applied). */
export async function api(action, body = {}) {
  try {
    return await tracked(() => request(action, { body }));
  } catch (e) {
    // "Gone" or "already running": something changed on another device, so catch up right away.
    if (e.status === 404 || e.status === 409) refresh().catch(() => {});
    throw e;
  }
}

/** GET the current state (boot, polling, and a fresh security token). */
export async function refresh() {
  const startEpoch = epoch;
  const data = await withAuth(() => request('state', { method: 'GET' }));
  if (data.csrf) setCsrf(data.csrf);
  if (data.meta) store.meta = data.meta;
  if (epoch === startEpoch && inflight === 0) applyState(data.state, Date.now()); // never undo a newer change
  return data;
}

/** Multipart upload with progress (photos). fields are strings, file is a Blob/File. */
export function upload(action, fields, file, { onProgress = null } = {}) {
  const send = () => new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append('file', file, file.name || 'photo.jpg');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `api.php?action=${encodeURIComponent(action)}`);
    xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.setRequestHeader('Accept', 'application/json');
    if (onProgress) xhr.upload.addEventListener('progress', (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); });
    xhr.addEventListener('load', () => {
      readResponse(xhr.status, () => JSON.parse(xhr.responseText)).then(resolve, reject);
    });
    xhr.addEventListener('error', () => reject(new ApiError('The connection dropped during the upload. Try again.', 0, 'network')));
    xhr.send(form);
  });
  return tracked(send);
}

/** Downloads the backup file (signing in again first if needed). */
export async function downloadBackup() {
  const send = async () => {
    let res;
    try {
      res = await fetch('api.php?action=export', { credentials: 'same-origin' });
    } catch (e) {
      throw new ApiError('Couldn’t reach the server. Check your connection and try again.', 0, 'network');
    }
    if (!res.ok) await readResponse(res.status, () => res.json()); // throws the server's message
    return res;
  };
  const res = await withAuth(send);
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const name = match ? match[1] : 'findom-yourself-backup.json';
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: name, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return name;
}

/* ───────────────────────── signing back in ───────────────────────── */

let reauthPromise = null;
export const isReauthing = () => !!reauthPromise;

/** Shows the "sign in to keep going" sheet; resolves once signed in. Shared by every waiting request. */
function reauth() {
  if (reauthPromise) return reauthPromise;
  reauthPromise = new Promise((resolve) => {
    const sheet = new Sheet({ title: 'Sign in to keep going', eyebrow: 'Signed out', size: 'sm', className: 'sheet-reauth', onRequestClose: () => false });
    sheet.closeBtn.hidden = true;
    const password = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true, enterkeyhint: 'go' });
    const error = h('p', { class: 'msg error', role: 'alert', hidden: true });
    const submit = button('Sign in and carry on', { kind: 'primary', size: 'lg', type: 'submit', className: 'btn-block' });
    const form = h('form', { class: 'stack', novalidate: true },
      h('p', { class: 'sheet-lede', text: 'Your session ran out. Nothing is lost: sign in and whatever you were doing goes through.' }),
      h('input', { type: 'text', name: 'username', value: 'owner', autocomplete: 'username', hidden: true, tabindex: '-1', 'aria-hidden': 'true' }),
      field({ label: 'Password', control: password }),
      error,
      submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!password.value) {
        password.focus();
        return;
      }
      error.hidden = true;
      submit.disabled = true;
      submit.classList.add('is-busy');
      try {
        let res;
        try {
          res = await fetch('api.php?action=login', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Findom-Admin': '1' },
            body: JSON.stringify({ password: password.value }),
          });
        } catch (err) {
          throw new ApiError('Couldn’t reach the server. Check your connection and try again.', 0, 'network');
        }
        const data = await readResponse(res.status, () => res.json());
        setCsrf(data.csrf);
        sheet.close();
        toast('Signed back in. Carrying on.');
        resolve();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        password.select();
      } finally {
        submit.disabled = false;
        submit.classList.remove('is-busy');
      }
    });
    sheet.body.append(form);
    sheet.foot.remove();
    sheet.open({ focus: password });
  }).finally(() => {
    reauthPromise = null;
  });
  return reauthPromise;
}
