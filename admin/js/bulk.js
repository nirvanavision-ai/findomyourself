/*
 * FINDOM YOURSELF · Control Room: adding many items at once. "Paste a whole list" (read it,
 * check it, add it) and fetching photos for items that have none, a few per request.
 */
import { h, icon, swap, currencyName, parseAmount, amountInput, hostOf, plural, uid } from './core.js';
import { api, store } from './api.js';
import { Sheet, textArea, textInput, confirmSheet, toast, button, busy } from './ui.js';
import { openItemEditor } from './item.js';

const EXAMPLE = `Paste your list here. All of these work:

### Shoes
1. **Versace Gianni Ribbon Sandals (Red)**
* **Price:** 1.150 €
* **Link:** https://www.farfetch.com/…

Versace Medusa ashtray – 271 € – https://…
Name ⇥ Price ⇥ Link     (rows from a spreadsheet)
https://amiri.com/products/…     (just links)`;

/* ───────────────────────── paste a whole list ───────────────────────── */

export function openBulkImport(initialText = '') {
  let step = 'paste';
  let rows = [];
  let added = [];
  const sheet = new Sheet({
    title: 'Paste a whole list', eyebrow: 'Wishlist', size: 'lg', className: 'sheet-bulk',
    onRequestClose: async () => {
      if (step === 'paste' && text.value.trim().length > 40) {
        return confirmSheet({ title: 'Close without adding?', message: 'The text you pasted won’t be kept.', confirmLabel: 'Close', cancelLabel: 'Keep going' });
      }
      if (step === 'check') {
        return confirmSheet({ title: 'Close without adding?', message: 'None of these items have been added yet.', confirmLabel: 'Close', cancelLabel: 'Keep going' });
      }
      return true;
    },
  });
  const text = textArea({ rows: 13, placeholder: EXAMPLE, value: initialText, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', class: 'input textarea bulk-text', 'aria-label': 'Your list' });
  const error = h('p', { class: 'msg error', role: 'alert', hidden: true });
  const showError = (message) => {
    error.textContent = message;
    error.hidden = !message;
  };

  /* ── step 1: paste ── */
  function renderPaste() {
    step = 'paste';
    sheet.setTitle('Paste a whole list', 'Wishlist');
    const preview = button('Read the list', { kind: 'primary', type: 'submit', iconName: 'sparkle' });
    const form = h('form', { class: 'stack', novalidate: true, id: uid('bulk') },
      h('p', { class: 'sheet-lede', text: 'Lists from ChatGPT or Gemini, “Name – price – link” lines, spreadsheet rows, or just links. Up to 200 at a time; you’ll check everything before it’s added.' }),
      text, error);
    preview.setAttribute('form', form.id);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!text.value.trim()) {
        showError('Paste something first.');
        text.focus();
        return;
      }
      showError('');
      await busy(preview, async () => {
        try {
          const res = await api('items.parse', { text: text.value });
          if (!res.items.length) {
            showError('Couldn’t find any items in that. Try one item per line, or one link per line.');
            return;
          }
          rows = res.items.map((item) => ({
            ...item,
            checked: !item.duplicate,
            priceText: item.price !== null && item.price !== undefined ? amountInput(item.price) : '',
            currency: item.currency || store.state.settings.baseCurrency,
          }));
          renderCheck();
        } catch (err) {
          showError(err.message);
        }
      }, 'Reading…');
    });
    swap(sheet.body, form);
    sheet.foot.replaceChildren(button('Cancel', { onclick: () => sheet.requestClose() }), preview);
  }

  /* ── step 2: check ── */
  function renderCheck() {
    step = 'check';
    showError('');
    const dupes = rows.filter((r) => r.duplicate).length;
    sheet.setTitle(rows.some((r) => !r.duplicate) ? `Found ${plural(rows.filter((r) => !r.duplicate).length, 'new item')}` : 'Nothing new here', 'Check before adding');
    const addBtn = button('Add', { kind: 'primary', type: 'submit', iconName: 'plus' });
    const syncCount = () => {
      const n = rows.filter((r) => r.checked).length;
      addBtn.querySelector('.btn-label').textContent = n ? `Add ${plural(n, 'item')}` : 'Add';
      addBtn.disabled = !n;
    };
    // New finds first; the ones already on the list wait, unticked, in a fold of their own.
    const fresh = rows.filter((r) => !r.duplicate);
    const repeats = rows.filter((r) => r.duplicate);
    const list = h('div', { class: 'bulk-groups' },
      fresh.length
        ? h('ol', { class: 'bulk-rows' }, fresh.map((row) => bulkRow(row, rows.indexOf(row), syncCount)))
        : h('p', { class: 'empty-line', text: 'Everything here is already on your list. Greedy, but consistent.' }),
      repeats.length > 0 && h('details', { class: 'bulk-dupes', open: !fresh.length },
        h('summary', { class: 'disclosure' }, h('span', { text: `${plural(repeats.length, 'item')} already on your list` })),
        h('ol', { class: 'bulk-rows' }, repeats.map((row) => bulkRow(row, rows.indexOf(row), syncCount)))));
    const setAll = (checked) => {
      rows.forEach((r) => { r.checked = checked; });
      list.querySelectorAll('.bulk-check').forEach((cb) => { cb.checked = checked; cb.closest('.bulk-row').classList.toggle('is-off', !checked); });
      syncCount();
    };
    const form = h('form', { class: 'stack', novalidate: true, id: uid('bulk-check') },
      h('div', { class: 'bulk-summary' },
        h('p', null, h('strong', { text: `${fresh.length} new` }), dupes ? ` · ${dupes} already on your list (unticked)` : ''),
        h('div', { class: 'bulk-select' },
          h('button', { class: 'link-btn', type: 'button', text: 'Tick all', onclick: () => setAll(true) }),
          h('button', { class: 'link-btn', type: 'button', text: 'Untick all', onclick: () => setAll(false) }))),
      list, error);
    addBtn.setAttribute('form', form.id);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const chosen = rows.filter((r) => r.checked);
      if (chosen.some((r) => !r.name.trim())) {
        showError('Every ticked item needs a name.');
        return;
      }
      const bad = chosen.find((r) => r.priceText.trim() && parseAmount(r.priceText) === null);
      if (bad) {
        showError(`“${bad.name}” has a price that isn’t a number.`);
        return;
      }
      showError('');
      await busy(addBtn, async () => {
        try {
          const res = await api('items.import', {
            items: chosen.map((r) => ({
              name: r.name.trim(), brand: r.brand.trim(), variant: r.variant, category: r.category,
              price: parseAmount(r.priceText) || 0, currency: r.currency, url: r.url, affiliateUrl: r.affiliateUrl || '', image: r.image, note: r.note, priority: r.priority,
            })),
          });
          added = res.ids || [];
          renderDone(res.added);
        } catch (err) {
          showError(err.message);
        }
      }, 'Adding…');
    });
    syncCount();
    swap(sheet.body, form);
    sheet.body.scrollTop = 0;
    sheet.foot.replaceChildren(button('Back', { onclick: () => renderPaste() }), addBtn);
  }

  function bulkRow(row, index, onChange) {
    const cb = h('input', { type: 'checkbox', class: 'check bulk-check', checked: row.checked, 'aria-label': `Add item ${index + 1}` });
    const nameIn = textInput({ value: row.name, maxlength: 140, 'aria-label': 'Name', class: 'input bulk-name' });
    const brandIn = textInput({ value: row.brand, maxlength: 80, placeholder: 'Brand', 'aria-label': 'Brand', list: 'brand-list' });
    const priceIn = textInput({ value: row.priceText, inputmode: 'decimal', placeholder: 'Price', 'aria-label': 'Price', class: 'input mono' });
    const curIn = h('select', { class: 'input select', 'aria-label': 'Currency' },
      store.meta.currencies.map((c) => h('option', { value: c, text: c, title: currencyName(c) })));
    curIn.value = row.currency;
    const li = h('li', { class: ['bulk-row', !row.checked && 'is-off', row.duplicate && 'is-dupe'] });
    cb.addEventListener('change', () => {
      row.checked = cb.checked;
      li.classList.toggle('is-off', !cb.checked);
      onChange();
    });
    nameIn.addEventListener('input', () => { row.name = nameIn.value; });
    brandIn.addEventListener('input', () => { row.brand = brandIn.value; });
    priceIn.addEventListener('input', () => { row.priceText = priceIn.value; });
    curIn.addEventListener('change', () => { row.currency = curIn.value; });
    const meta = [row.variant, row.category, hostOf(row.url)].filter(Boolean).join(' · ');
    li.append(
      h('label', { class: 'bulk-tick' }, cb),
      h('div', { class: 'bulk-fields' },
        nameIn,
        h('div', { class: 'bulk-line' }, brandIn, priceIn, curIn),
        (meta || row.duplicate || row.affiliateUrl) && h('p', { class: 'bulk-meta' },
          row.duplicate && h('span', { class: 'badge badge-warn', text: 'Already on your list' }),
          // An affiliate or creator link in the list: kept as the item's "Your link", visitors go through it.
          row.affiliateUrl && h('span', { class: 'badge badge-aff', title: `Your link: ${hostOf(row.affiliateUrl)}` }, icon('tag'), 'Your link'),
          meta && h('span', { text: meta }))));
    return li;
  }

  /* ── step 3: done ── */
  function renderDone(count) {
    step = 'done';
    const items = store.state.items.filter((i) => added.includes(i.id));
    const fetchable = items.filter((i) => !i.image && (i.imageSource || i.url)).length;
    sheet.setTitle(`Added ${plural(count, 'item')}`, 'Done');
    const fetchBtn = button('Fetch their photos', { kind: 'primary', iconName: 'image', onclick: () => {
      sheet.close();
      fetchPhotos({ ids: added, title: 'Photos for the new items' });
    } });
    swap(sheet.body, h('div', { class: 'done-state' },
      h('p', { class: 'done-mark', 'aria-hidden': 'true' }, icon('check')),
      h('p', { class: 'done-line', text: `${plural(count, 'new obsession')} on the list.` }),
      fetchable
        ? h('p', { class: 'sheet-lede', text: `${plural(fetchable, 'of them has', 'of them have')} a shop link. Want me to grab the product photos? Some shops refuse; you’ll see which.` })
        : h('p', { class: 'sheet-lede', text: 'None of them had links, so add photos from each item when you’re ready.' })));
    swap(sheet.foot, button(fetchable ? 'Not now' : 'Done', { kind: fetchable ? 'ghost' : 'primary', onclick: () => sheet.close() }), fetchable ? fetchBtn : null);
    toast(`Added ${plural(count, 'item')}.`);
  }

  renderPaste();
  sheet.open({ focus: text });
  if (initialText) text.setSelectionRange(0, 0);
  return sheet;
}

/* ───────────────────────── fetching photos ───────────────────────── */

/** Items that could get a photo from their link (the server skips archived ones). */
export const missingPhotos = (state) => state.items.filter((i) => !i.image && i.status !== 'archived' && (i.imageSource || i.url));

/**
 * Asks the server for photos until it has tried every item. ids limits it to those items.
 * Items that fail are passed back as "exclude" so the next round moves on.
 */
export async function fetchPhotos({ ids = null, title = 'Fetching photos' } = {}) {
  let stopped = false;
  let running = true;
  const done = [];
  const failed = [];
  let total = null;
  const bar = h('span');
  const progress = h('div', { class: 'progress progress-lg is-indeterminate', role: 'progressbar', 'aria-label': 'Photos fetched', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar);
  const count = h('p', { class: 'fetch-count mono' });
  const statusLine = h('p', { class: 'muted', 'aria-live': 'polite' });
  const failures = h('div', { class: 'fetch-failures' });
  const sheet = new Sheet({
    title, eyebrow: 'Photos', size: 'md',
    onRequestClose: () => {
      if (running) stopped = true;
      return true;
    },
  });
  const stopBtn = button('Stop', { onclick: () => {
    stopped = true;
    stopBtn.disabled = true;
    statusLine.textContent = 'Stopping after this batch…';
  } });
  const doneBtn = button('Done', { kind: 'primary', onclick: () => sheet.close() });
  doneBtn.hidden = true;

  const render = () => {
    const tried = done.length + failed.length;
    if (total) {
      const pct = Math.round((tried / total) * 100);
      progress.classList.remove('is-indeterminate');
      progress.setAttribute('aria-valuenow', String(pct));
      bar.style.width = `${pct}%`;
    }
    swap(count,
      h('span', { class: 'is-in', text: `${done.length} saved` }), ' · ',
      h('span', { class: failed.length ? 'is-out' : '', text: `${failed.length} failed` }),
      total ? h('span', { class: 'muted', text: ` · ${total} to try` }) : null);
    swap(failures, failed.length ? [
      h('h3', { class: 'card-label', text: 'Couldn’t get these' }),
      h('ul', { class: 'failure-list' }, failed.map((f) => {
        const item = store.state.items.find((i) => i.id === f.id);
        return h('li', { class: 'failure' },
          h('div', { class: 'failure-text' }, h('strong', { text: f.name }), h('span', { class: 'muted', text: f.error })),
          h('div', { class: 'failure-actions' },
            item && item.url && h('a', { class: 'btn btn-ghost btn-sm', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, 'Shop ', icon('external')),
            button('Add photo', { size: 'sm', kind: 'primary', iconName: 'upload', onclick: () => {
              stopped = true;
              sheet.close();
              openItemEditor(f.id, { focus: 'photo' });
            } })));
      })),
      h('p', { class: 'field-hint', text: 'Tip: open the shop page, press and hold the photo, copy it, then paste it into the item.' }),
    ] : []);
  };

  sheet.body.append(progress, count, statusLine, failures);
  sheet.foot.append(stopBtn, doneBtn);
  render();
  sheet.open();

  for (let round = 0; !stopped && round < 200; round++) {
    const tried = done.length + failed.length;
    statusLine.textContent = total === null ? 'Asking the shops for photos…' : `Working… ${tried} of ${total}`;
    let res;
    try {
      res = await api('items.fetchImages', { ...(ids ? { ids } : {}), exclude: failed.map((f) => f.id) });
    } catch (e) {
      statusLine.textContent = e.message;
      break;
    }
    done.push(...res.done);
    failed.push(...res.failed);
    if (total === null) total = res.done.length + res.failed.length + res.remaining;
    render();
    if (res.remaining <= 0 || (!res.done.length && !res.failed.length)) break;
  }
  running = false;
  if (total === 0) {
    statusLine.textContent = 'Nothing to fetch: every item has a photo already, or no link to look at.';
    progress.hidden = true;
  } else if (stopped) {
    statusLine.textContent = 'Stopped. Whatever finished is saved.';
  } else {
    statusLine.textContent = failed.length ? 'Done. Some shops wouldn’t hand their photos over.' : 'Done. Every photo is in.';
  }
  stopBtn.hidden = true;
  doneBtn.hidden = false;
  if (sheet.closed && total) toast(`Photos: ${done.length} saved, ${failed.length} failed.`);
  return { done, failed };
}
