/*
 * FINDOM YOURSELF · Control Room: adding to the list. The paste-a-link form (any shop, or one
 * of her affiliate links), shared by the List tab, the "Add a wish" card on Today and the add
 * sheet that the + in the top bar opens from anywhere. A link becomes an item straight away
 * and its editor opens, saying what the shop wouldn't share and which affiliate link it saw.
 */
import { h, icon, uid, plural, hostOf, extractUrl, allUrls } from './core.js';
import { api } from './api.js';
import { Sheet, toast, button, note } from './ui.js';
import { openItemEditor } from './item.js';
import { openBulkImport } from './bulk.js';
import { bookmarkletLink } from './grab.js';

const SLOW_STEPS = [
  [0, 'Fetching the shop page…'],
  [6000, 'Still talking to the shop. Some are slow…'],
  [14000, 'Almost there. If the shop won’t talk, I’ll add it from the link anyway.'],
];
const PLACEHOLDER = 'Paste a link from any shop';
const HINT = 'Amazon, Gucci, Farfetch, ShopMy, LTK… Affiliate links are recognized.';

const canReadClipboard = () => !!(navigator.clipboard && navigator.clipboard.readText);
const isList = (text) => text.split('\n').filter((l) => l.trim()).length > 1;

/** One of the "other ways to add" rows: icon, title, hint, arrow. */
export function moreRow(iconName, title, hint, onclick) {
  return h('button', { class: 'more-row', type: 'button', onclick },
    h('span', { class: 'more-icon' }, icon(iconName)),
    h('span', { class: 'more-text' }, h('span', { class: 'more-title', text: title }), h('span', { class: 'more-hint', text: hint })),
    icon('next'));
}

/** "Paste a whole list" and "Add by hand". before() runs first (the add sheet closes itself). */
export function moreRows(before = null) {
  const run = (fn) => () => {
    const opener = before ? before() : null;
    const sheet = fn();
    if (sheet && opener) sheet.opener = opener;
  };
  return [
    moreRow('list', 'Paste a whole list', 'From ChatGPT, Gemini, Notes or a spreadsheet', run(() => openBulkImport())),
    moreRow('pencil', 'Add by hand', 'No link? Type it in yourself', run(() => openItemEditor(null))),
  ];
}

/**
 * The link box with its Paste and Add buttons. A link becomes an item and its editor opens.
 * opts: {compact: smaller, for Today; label: the visible label node (else a hidden one);
 * onDone(): runs before the editor opens and may return what focus goes back to afterwards}.
 * Returns {el, input, focus(), showOffer(kind, text), isBusy()}.
 */
export function addLinkForm({ compact = false, label = null, onDone = null } = {}) {
  const id = uid('paste-link');
  const hintId = `${id}-hint`;
  const input = h('input', {
    class: ['input', !compact && 'input-lg'], type: 'url', inputmode: 'url', id, placeholder: PLACEHOLDER,
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-describedby': hintId,
  });
  const pasteBtn = canReadClipboard() ? button('Paste', { iconName: 'paste', className: 'paste-btn', 'aria-label': 'Paste a link from the clipboard' }) : null;
  const addBtn = button('Add', { kind: 'primary', type: 'submit', iconName: 'plus', className: 'add-btn' });
  const status = h('div', { class: 'paste-status', 'aria-live': 'polite' });
  const offer = h('div', { class: 'paste-offer', hidden: true });
  const el = h('form', { class: ['paste-form', compact && 'is-compact'], novalidate: true },
    label ? h('label', { class: 'paste-label', for: id }, label) : h('label', { class: 'visually-hidden', for: id, text: 'Product link' }),
    h('div', { class: 'paste-row' }, input, h('div', { class: 'paste-buttons' }, pasteBtn, addBtn)),
    h('p', { class: 'field-hint paste-hint', id: hintId, text: HINT }),
    status,
    offer);

  let adding = false;
  function setBusy(on) {
    adding = on;
    input.readOnly = on;
    addBtn.disabled = on;
    addBtn.classList.toggle('is-busy', on);
    if (pasteBtn) pasteBtn.disabled = on;
  }

  async function addLink(raw) {
    if (adding) return;
    const url = extractUrl(raw);
    if (!url) {
      status.replaceChildren(note('error', 'That doesn’t look like a link. Copy the whole address from the shop, starting with https://'));
      input.focus();
      return;
    }
    setBusy(true);
    input.value = url;
    offer.hidden = true;
    const text = h('span');
    status.replaceChildren(h('div', { class: 'fetching' }, h('span', { class: 'spinner' }), text));
    const timers = SLOW_STEPS.map(([ms, message]) => setTimeout(() => { text.textContent = message; }, ms));
    try {
      const res = await api('item.fromLink', { url });
      input.value = '';
      status.replaceChildren();
      const opener = onDone ? onDone() : null;
      const editor = openItemEditor(res.itemId, {
        warnings: res.warnings || [], duplicate: !!res.duplicate, fromLink: true,
        affiliate: res.affiliate || null, suggestion: res.suggestion || null, pasted: url,
      });
      if (editor && opener) editor.opener = opener;
      // Otherwise the editor explains what's missing or what it recognized.
      if (!res.duplicate && !(res.warnings || []).length && !res.affiliate) toast('Added to the list. Now go earn it.', { tone: 'gold' });
    } catch (e) {
      status.replaceChildren(note('error', e.message));
    } finally {
      timers.forEach(clearTimeout);
      setBusy(false);
    }
  }

  /** "Add this link?" / "Read this as a list?" after a paste outside the box. */
  function showOffer(kind, payload) {
    const dismiss = h('button', { class: 'link-btn', type: 'button', text: 'No thanks', onclick: () => { offer.hidden = true; } });
    if (kind === 'link') {
      let path = '';
      try {
        path = new URL(payload).pathname.slice(0, 40);
      } catch (e) { /* shown without its path */ }
      offer.replaceChildren(icon('link'),
        h('p', null, 'Add this link? ', h('span', { class: 'muted', text: `${hostOf(payload)}${path}…` })),
        h('div', { class: 'offer-actions' }, button('Add it', { kind: 'primary', size: 'sm', onclick: () => addLink(payload) }), dismiss));
    } else {
      const links = allUrls(payload).length;
      offer.replaceChildren(icon('list'),
        h('p', null, 'That looks like a whole list', h('span', { class: 'muted', text: links ? ` (${plural(links, 'link')}).` : '.' })),
        h('div', { class: 'offer-actions' }, button('Read the list', {
          kind: 'primary', size: 'sm',
          onclick: () => {
            offer.hidden = true;
            const opener = onDone ? onDone() : null;
            const sheet = openBulkImport(payload);
            if (sheet && opener) sheet.opener = opener;
          },
        }), dismiss));
    }
    offer.hidden = false;
  }

  el.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input.value.trim()) {
      status.replaceChildren(note('info', 'Paste a link from any shop: Amazon, Gucci, Farfetch, the brand’s own site… or one of your affiliate links.'));
      input.focus();
      return;
    }
    addLink(input.value);
  });
  input.addEventListener('input', () => {
    if (status.firstChild && !adding) status.replaceChildren();
  });
  // Pasting a whole list into the link box: offer the list importer instead.
  input.addEventListener('paste', (e) => {
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (isList(text)) {
      e.preventDefault();
      showOffer('list', text);
    }
  });
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (isList(text)) {
          showOffer('list', text);
          return;
        }
        const url = extractUrl(text);
        if (!url) {
          status.replaceChildren(note('info', 'No link on the clipboard. Copy one from the shop first.'));
          return;
        }
        input.value = url;
        addLink(url);
      } catch (e) {
        status.replaceChildren(note('info', 'The browser wouldn’t share the clipboard. Long-press the box and choose Paste.'));
        input.focus();
      }
    });
  }

  return { el, input, focus: () => input.focus(), showOffer, isBusy: () => adding };
}

/* ───────────────────────── the add sheet (the + in the top bar) ───────────────────────── */

let addSheet = null;

/** Paste a link, paste a whole list, or add by hand: from any tab. */
export function openAddSheet() {
  if (addSheet && !addSheet.closed) return addSheet;
  const sheet = new Sheet({ title: 'Add to the list', eyebrow: 'Wishlist', size: 'md', className: 'sheet-add' });
  // The sheet makes way for the editor (or the list importer), which hands focus back to the +.
  const done = () => {
    const opener = sheet.opener;
    sheet.close();
    return opener;
  };
  const form = addLinkForm({ onDone: done, label: h('span', { class: 'field-label', text: 'Product link' }) });
  sheet.body.append(
    form.el,
    h('div', { class: 'paste-more' }, moreRows(done)),
    h('div', { class: 'grab-box' }, bookmarkletLink()));
  sheet.foot.remove();
  sheet.onClosed = () => {
    if (addSheet === sheet) addSheet = null;
  };
  addSheet = sheet;
  // On a phone the keyboard would cover the other options: the Paste button is right there.
  const touch = window.matchMedia('(pointer: coarse)').matches;
  sheet.open({ focus: touch ? null : form.input });
  return sheet;
}
