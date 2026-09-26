/*
 * FINDOM YOURSELF · Control Room: UI building blocks. Toasts, sheets (bottom sheets on
 * phones, centred dialogs on desktop, built on <dialog> for focus trapping and Esc),
 * confirmations, and the form controls every tab shares.
 */
import { h, icon, uid, append, currencySymbol, reducedMotion, ctx } from './core.js';

/* ───────────────────────── toasts ───────────────────────── */

// The live region exists from the start, so even the first message is announced.
const toastBox = h('div', { class: 'toasts', 'aria-live': 'polite', 'aria-relevant': 'additions' });
document.body.append(toastBox);

/**
 * New toasts go into the topmost open dialog, if any (everything else is inert under a modal),
 * and show at the top of the screen there, clear of the sheet's form and buttons.
 */
function toastHost() {
  const open = Array.from(document.querySelectorAll('dialog[open]')).filter((d) => !d.classList.contains('is-closing'));
  return open[open.length - 1] || document.body;
}

export function rehomeToasts() {
  const host = toastHost();
  if (toastBox.parentNode !== host) host.append(toastBox);
}

/**
 * toast('Good. Again.', {tone: 'gold', detail: '🏋️ Gym session · +$15', action: fn, actionLabel: 'Undo'})
 * Tones: info, gold (money in), pink (money out), error.
 */
export function toast(message, opts = {}) {
  const { tone = 'info', detail = '', action = null, actionLabel = 'Undo' } = opts;
  const duration = opts.duration || (action ? 7000 : tone === 'error' ? 6500 : 3800);
  rehomeToasts();

  let timer = null;
  let left = duration;
  let startedAt = 0;
  let paused = false;
  const node = h('div', { class: ['toast', `toast-${tone}`], role: tone === 'error' ? 'alert' : null });
  const dismiss = () => {
    clearTimeout(timer);
    if (!node.isConnected || node.classList.contains('is-leaving')) return;
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), reducedMotion() ? 0 : 200);
  };
  const start = () => { // (re)start the countdown; hovering or focusing a toast pauses it
    if (!paused && timer) return;
    paused = false;
    startedAt = Date.now();
    clearTimeout(timer);
    timer = setTimeout(dismiss, left);
  };
  const pause = () => {
    if (paused) return;
    paused = true;
    clearTimeout(timer);
    left = Math.max(1500, left - (Date.now() - startedAt));
  };
  append(node, [
    h('span', { class: 'toast-glyph', 'aria-hidden': 'true' }, icon(tone === 'error' ? 'warn' : tone === 'pink' ? 'bolt' : tone === 'gold' ? 'sparkle' : 'check')),
    h('span', { class: 'toast-text' },
      h('span', { class: 'toast-msg', text: message }),
      detail && h('span', { class: 'toast-detail', text: detail })),
    action && h('button', {
      class: 'toast-action', type: 'button', text: actionLabel,
      onclick: async (e) => {
        e.currentTarget.disabled = true;
        dismiss();
        await action();
      },
    }),
    h('button', { class: 'toast-close', type: 'button', 'aria-label': 'Dismiss', onclick: dismiss }, icon('x')),
  ]);
  node.addEventListener('pointerenter', pause);
  node.addEventListener('pointerleave', start);
  node.addEventListener('focusin', pause);
  node.addEventListener('focusout', start);
  toastBox.append(node);
  while (toastBox.children.length > 3) toastBox.firstElementChild.remove();
  start();
  return dismiss;
}

export const toastError = (err) => toast(err && err.message ? err.message : String(err), { tone: 'error' });

/* ───────────────────────── sheets ───────────────────────── */

let openSheets = 0;

/** Keeps sheets above the iPhone keyboard: CSS reads --vvh (visible height) and --kb (keyboard). */
function trackViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  root.style.setProperty('--vvh', `${vv.height}px`);
  root.style.setProperty('--kb', `${kb > 60 ? kb : 0}px`);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', trackViewport);
  window.visualViewport.addEventListener('scroll', trackViewport);
}

export class Sheet {
  /**
   * new Sheet({title, eyebrow, size: 'sm'|'md'|'lg', className, onRequestClose})
   * onRequestClose may return false (or a promise of false) to keep it open, e.g. unsaved edits.
   */
  constructor({ title, eyebrow = '', size = 'md', className = '', onRequestClose = null } = {}) {
    const titleId = uid('sheet-title');
    this.onRequestClose = onRequestClose;
    this.onClosed = null;
    this.closed = false;
    this.titleEl = h('h2', { class: 'sheet-title', id: titleId }, title);
    this.eyebrowEl = h('p', { class: 'eyebrow', text: eyebrow, hidden: !eyebrow });
    this.closeBtn = h('button', { class: 'icon-btn sheet-x', type: 'button', 'aria-label': 'Close', onclick: () => this.requestClose() }, icon('x'));
    this.head = h('header', { class: 'sheet-head' },
      h('span', { class: 'sheet-grab', 'aria-hidden': 'true' }),
      h('div', { class: 'sheet-titles' }, this.eyebrowEl, this.titleEl),
      this.closeBtn);
    this.body = h('div', { class: 'sheet-body' });
    this.foot = h('footer', { class: 'sheet-foot' });
    this.panel = h('div', { class: 'sheet-panel', tabindex: '-1' }, this.head, this.body, this.foot);
    this.el = h('dialog', { class: ['sheet', `sheet-${size}`, className], 'aria-labelledby': titleId }, this.panel);

    this.el.addEventListener('cancel', (e) => { // Esc
      e.preventDefault();
      this.requestClose();
    });
    // A tap on the dimmed backdrop closes, but not a drag that merely ends there (text selection).
    let downOnBackdrop = false;
    this.el.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === this.el; });
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el && downOnBackdrop) this.requestClose();
      downOnBackdrop = false;
    });
  }

  setTitle(title, eyebrow) {
    this.titleEl.textContent = title;
    if (eyebrow !== undefined) {
      this.eyebrowEl.textContent = eyebrow;
      this.eyebrowEl.hidden = !eyebrow;
    }
  }

  open({ focus = null } = {}) {
    this.opener = document.activeElement;
    document.body.append(this.el);
    this.el.showModal();
    openSheets++;
    document.documentElement.classList.add('has-sheet');
    trackViewport();
    // Focus the panel (screen readers announce the title) unless a field should take it.
    const target = focus || this.panel;
    target.focus({ preventScroll: true });
    requestAnimationFrame(() => this.el.classList.add('is-open'));
    return this;
  }

  async requestClose() {
    if (this.closed) return;
    if (this.onRequestClose) {
      const ok = await this.onRequestClose();
      if (ok === false) return;
    }
    this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.el.classList.remove('is-open');
    this.el.classList.add('is-closing');
    const finish = () => {
      if (this.el.open) this.el.close();
      this.el.remove();
      openSheets = Math.max(0, openSheets - 1);
      if (!openSheets) document.documentElement.classList.remove('has-sheet');
      rehomeToasts();
      // Back to whatever opened it, if that's still on screen and not behind another sheet.
      const open = Array.from(document.querySelectorAll('dialog[open]'));
      const top = open[open.length - 1];
      if (this.opener && this.opener.isConnected && typeof this.opener.focus === 'function' && (!top || top.contains(this.opener))) {
        this.opener.focus({ preventScroll: true });
      }
      if (this.onClosed) this.onClosed();
    };
    if (reducedMotion()) finish();
    else setTimeout(finish, 190);
  }
}

export const sheetIsOpen = () => openSheets > 0;

/** Ask before doing something. Resolves true (confirmed) or false. */
export function confirmSheet({ title, message = '', confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, extra = null, tone = null } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const sheet = new Sheet({ title, size: 'sm', className: 'sheet-confirm' });
    if (message) sheet.body.append(h('p', { class: 'sheet-lede', text: message }));
    if (extra) sheet.body.append(extra);
    const ok = h('button', {
      class: ['btn', danger ? 'btn-danger-solid' : tone === 'gold' ? 'btn-gold' : 'btn-primary'], type: 'button', text: confirmLabel,
      onclick: () => {
        answered = true;
        resolve(true);
        sheet.close();
      },
    });
    const cancel = h('button', { class: 'btn btn-ghost', type: 'button', text: cancelLabel, onclick: () => sheet.requestClose() });
    sheet.foot.append(cancel, ok);
    sheet.onClosed = () => {
      if (!answered) resolve(false);
    };
    sheet.open({ focus: ok });
  });
}

/* ───────────────────────── form controls ───────────────────────── */

/** A labelled field: label, control, optional hint and character counter. */
export function field({ label, control, hint = '', counter = 0, className = '', labelExtra = null }) {
  if (!control.id) control.id = uid('f');
  const hintEl = hint ? h('p', { class: 'field-hint', id: `${control.id}-hint`, text: hint }) : null;
  if (hintEl) control.setAttribute('aria-describedby', hintEl.id);
  const labelEl = h('label', { class: 'field-label', for: control.id }, h('span', { text: label }), labelExtra);
  const wrap = h('div', { class: ['field', className] }, labelEl, control, hintEl);
  if (counter) {
    const count = h('span', { class: 'counter', 'aria-hidden': 'true' });
    const input = control.matches('input, textarea') ? control : control.querySelector('input, textarea');
    const update = () => {
      const n = Array.from(input.value).length;
      count.textContent = `${n}/${counter}`;
      count.classList.toggle('is-near', n > counter * 0.9);
    };
    input.addEventListener('input', update);
    update();
    labelEl.append(count);
  }
  return wrap;
}

export function textInput(props = {}) {
  return h('input', { class: 'input', type: 'text', autocomplete: 'off', ...props });
}

export function textArea(props = {}) {
  return h('textarea', { class: 'input textarea', rows: 3, ...props });
}

/** An amount box with the currency symbol in front. Returns {wrap, input, setCurrency}. */
export function moneyInput({ value = '', currency = ctx.currency, placeholder = '0', id = uid('amt'), label = '', ...rest } = {}) {
  const symbol = h('span', { class: 'money-sym', 'aria-hidden': 'true', text: currencySymbol(currency) });
  const input = h('input', {
    class: 'input money-in mono', type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done',
    placeholder, id, value, 'aria-label': label || null, ...rest,
  });
  const wrap = h('div', { class: 'money-field' }, symbol, input);
  const setCurrency = (cur) => {
    symbol.textContent = currencySymbol(cur);
    wrap.style.setProperty('--sym', `${Math.max(1, symbol.textContent.length)}`);
  };
  setCurrency(currency);
  return { wrap, input, setCurrency };
}

/** Radio pills. options: [{value, label, hint?}]. Returns the <fieldset>; read .value from it. */
export function segmented({ legend, options, value, onChange = null, className = '', name = uid('seg'), hideLegend = false }) {
  const set = h('fieldset', { class: ['segmented', className] },
    h('legend', { class: hideLegend ? 'visually-hidden' : 'field-label', text: legend }));
  const row = h('div', { class: 'seg-row' });
  for (const opt of options) {
    const id = uid('seg');
    const radio = h('input', { type: 'radio', name, id, value: String(opt.value), checked: String(opt.value) === String(value), class: 'seg-radio' });
    radio.addEventListener('change', () => {
      if (radio.checked && onChange) onChange(opt.value);
    });
    row.append(radio, h('label', { for: id, class: 'seg-label', title: opt.hint || null }, opt.label));
  }
  set.append(row);
  Object.defineProperty(set, 'value', {
    get() {
      const checked = set.querySelector('input:checked');
      return checked ? checked.value : '';
    },
    set(v) {
      for (const r of set.querySelectorAll('input')) r.checked = r.value === String(v);
    },
  });
  return set;
}

/** An on/off switch. Returns the wrapper; the checkbox is .input. */
export function toggle({ label, hint = '', checked = false, onChange = null, disabled = false }) {
  const id = uid('sw');
  const input = h('input', { type: 'checkbox', role: 'switch', id, class: 'switch-input', checked, disabled });
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  const hintEl = hint ? h('span', { class: 'switch-hint', id: `${id}-hint`, text: hint }) : null;
  if (hintEl) input.setAttribute('aria-describedby', hintEl.id);
  const wrap = h('div', { class: ['switch-row', disabled && 'is-disabled'] },
    h('label', { class: 'switch-label', for: id }, h('span', { class: 'switch-text', text: label }), hintEl),
    h('span', { class: 'switch' }, input, h('span', { class: 'switch-track', 'aria-hidden': 'true' })));
  wrap.input = input;
  return wrap;
}

/** Hours + minutes boxes. Returns {wrap, get() → minutes|null, set(minutes)}. */
export function durationInput({ minutes = 0, legend = 'Duration', onChange = null } = {}) {
  const hIn = h('input', { class: 'input mono', type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Hours', maxlength: 2, enterkeyhint: 'next' });
  const mIn = h('input', { class: 'input mono', type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Minutes', maxlength: 4, enterkeyhint: 'done' });
  const set = (total) => {
    const t = Math.max(0, Math.round(total || 0));
    hIn.value = String(Math.floor(t / 60));
    mIn.value = String(t % 60);
  };
  const get = () => {
    const hh = hIn.value.trim() === '' ? 0 : Number(hIn.value.replace(',', '.'));
    const mm = mIn.value.trim() === '' ? 0 : Number(mIn.value.replace(',', '.'));
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || mm < 0) return null;
    return Math.round(hh * 60 + mm);
  };
  for (const input of [hIn, mIn]) input.addEventListener('input', () => onChange && onChange(get()));
  set(minutes);
  const wrap = h('fieldset', { class: 'duration' },
    h('legend', { class: 'field-label', text: legend }),
    h('div', { class: 'duration-row' },
      h('label', { class: 'duration-part' }, hIn, h('span', { class: 'duration-unit', text: 'h' })),
      h('label', { class: 'duration-part' }, mIn, h('span', { class: 'duration-unit', text: 'min' }))));
  return { wrap, get, set, inputs: [hIn, mIn] };
}

/** Disables a button and shows a spinner while fn runs. Returns fn's result. */
export async function busy(btn, fn, busyLabel = null) {
  if (!btn) return fn();
  const label = btn.querySelector('.btn-label');
  const before = label ? label.textContent : null;
  btn.disabled = true;
  btn.classList.add('is-busy');
  btn.setAttribute('aria-busy', 'true');
  if (busyLabel && label) label.textContent = busyLabel;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-busy');
    btn.removeAttribute('aria-busy');
    if (busyLabel && label) label.textContent = before;
  }
}

/** A button with an optional icon; its text lives in .btn-label so busy() can swap it. */
export function button(label, { kind = 'ghost', size = '', iconName = null, type = 'button', onclick = null, className = '', ...rest } = {}) {
  return h('button', { class: ['btn', `btn-${kind}`, size && `btn-${size}`, className], type, onclick, ...rest },
    iconName && icon(iconName),
    h('span', { class: 'btn-label', text: label }),
    h('span', { class: 'spinner', 'aria-hidden': 'true' }));
}

/**
 * The "Unsaved changes · Discard · Save" bar that sticks to the bottom of a tab while its
 * forms differ from what's saved. onSave may throw: the message shows in the bar.
 */
export function saveBar({ onSave, onDiscard }) {
  const error = h('p', { class: 'savebar-error', role: 'alert', hidden: true });
  const save = button('Save changes', { kind: 'primary', iconName: 'check' });
  const discard = button('Discard', { kind: 'ghost' });
  const el = h('div', { class: 'savebar', hidden: true, role: 'region', 'aria-label': 'Unsaved changes' },
    h('div', { class: 'savebar-text' }, h('p', { class: 'savebar-msg', text: 'Unsaved changes' }), error),
    h('div', { class: 'savebar-actions' }, discard, save));
  const showError = (message) => {
    error.textContent = message || '';
    error.hidden = !message;
  };
  save.addEventListener('click', () => busy(save, async () => {
    showError('');
    try {
      await onSave();
    } catch (e) {
      showError(e.message);
    }
  }));
  discard.addEventListener('click', () => {
    showError('');
    onDiscard();
  });
  return {
    el,
    error: showError,
    show(on) {
      if (!on) showError('');
      el.hidden = !on;
    },
  };
}

/** A short inline message: kind 'error' | 'warn' | 'info' | 'ok'. */
export function note(kind, ...children) {
  return h('div', { class: ['note', `note-${kind}`], role: kind === 'error' ? 'alert' : null },
    icon(kind === 'ok' ? 'check' : kind === 'info' ? 'sparkle' : 'warn'),
    h('div', { class: 'note-body' }, ...children));
}

/** A product photo on its porcelain tile, or the brand's initial when there's no photo. */
export function thumb(item, size = '') {
  const tile = h('span', { class: ['thumb', size && `thumb-${size}`] });
  const src = item.image ? `../${item.image}` : item.imageSource || '';
  const initial = () => {
    tile.classList.add('is-empty');
    tile.replaceChildren(h('span', { class: 'thumb-initial', 'aria-hidden': 'true', text: (item.brand || item.name || '?').trim().charAt(0).toUpperCase() }));
  };
  if (src) {
    const img = h('img', { src, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', initial, { once: true });
    tile.append(img);
    if (!item.image) tile.classList.add('is-remote');
  } else {
    initial();
  }
  return tile;
}
