/*
 * FINDOM YOURSELF · Control Room: adding many items at once. "Paste a whole list" (read it,
 * check it, add it) and fetching photos for items that have none, a few per request: by hand
 * (List → "Fetch photos"), and quietly in the background when the Control Room opens and after
 * a list is added (a small status in the top bar, then one toast with the result).
 */
import { h, icon, swap, currencyName, parseAmount, amountInput, hostOf, plural, uid, serverNow } from './core.js';
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
    swap(sheet.body, h('div', { class: 'done-state' },
      h('p', { class: 'done-mark', 'aria-hidden': 'true' }, icon('check')),
      h('p', { class: 'done-line', text: `${plural(count, 'new obsession')} on the list.` }),
      fetchable
        ? h('p', { class: 'sheet-lede', text: 'Their photos are downloading in the background and pop in as they arrive. Some shops refuse; you’ll see which.' })
        : h('p', { class: 'sheet-lede', text: 'None of them had links, so add photos from each item when you’re ready.' })));
    swap(sheet.foot, button('Done', { kind: 'primary', onclick: () => sheet.close() }));
    toast(`Added ${plural(count, 'item')}.`);
    if (fetchable) autoFetchPhotos();
  }

  renderPaste();
  sheet.open({ focus: text });
  if (initialText) text.setSelectionRange(0, 0);
  return sheet;
}

/* ───────────────────────── fetching photos ───────────────────────── */

/** Items that could get a photo from their link (the server skips archived ones). */
export const missingPhotos = (state) => state.items.filter((i) => !i.image && i.status !== 'archived' && (i.imageSource || i.url));

/** "Couldn’t get these": each failed item with its shop link and an "Add photo" button. */
function failureList(failed, onPick) {
  return [
    h('h3', { class: 'card-label', text: 'Couldn’t get these' }),
    h('ul', { class: 'failure-list' }, failed.map((f) => {
      const item = store.state.items.find((i) => i.id === f.id);
      return h('li', { class: 'failure' },
        h('div', { class: 'failure-text' }, h('strong', { text: f.name }), h('span', { class: 'muted', text: f.error })),
        h('div', { class: 'failure-actions' },
          item && item.url && h('a', { class: 'btn btn-ghost btn-sm', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, 'Shop ', icon('external')),
          button('Add photo', { size: 'sm', kind: 'primary', iconName: 'upload', onclick: () => onPick(f.id) })));
    })),
    h('p', { class: 'field-hint', text: 'Tip: open the shop page, press and hold the photo, copy it (or its image address), then paste it into the item. On a computer, the + Findom bookmarklet brings the photo over from the shop page.' }),
  ];
}

/**
 * Asks the server for photos until it has tried every item. ids limits it to those items.
 * Items that fail are passed back as "exclude" so the next round moves on. A background
 * fetch that's running finishes its current request first and hands over to this one.
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
    swap(failures, failed.length ? failureList(failed, (id) => {
      stopped = true;
      sheet.close();
      openItemEditor(id, { focus: 'photo' });
    }) : []);
  };

  sheet.body.append(progress, count, statusLine, failures);
  sheet.foot.append(stopBtn, doneBtn);
  render();
  sheet.open();

  if (auto.run) statusLine.textContent = 'Letting the background fetch finish its batch…';
  await stopAutoPhotos('manual');
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

/* ───────────────────────── in the background ───────────────────────── */

const RETRY_MS = 24 * 3600 * 1000; // PHOTO_RETRY_SECONDS in api.php
const AUTO_TRIES = 3; // PHOTO_AUTO_TRIES in api.php
const BATCH = 3; // photos per request: the status moves often, and each request stays short
const MAX_ROUNDS = 80; // a safety net (the list holds 200 items at most)

/**
 * Missing photos the background fetch may look for (the server has the final say): never had one,
 * not tried too often at this link, and not in the last day.
 */
const duePhotos = (state, now = serverNow()) => missingPhotos(state).filter((i) => {
  const f = i.imageFetch;
  return !f || (!f.had && (f.tries || 0) < AUTO_TRIES && !(f.at && now - Date.parse(f.at) < RETRY_MS));
});

const auto = {
  run: null, // the run in progress (a promise that never rejects)
  stop: '', // set to stop after the current request: 'hidden' or 'manual'
  again: false, // asked again mid-run (a list was just added): one more pass before finishing
  paused: false, // stopped by the page being hidden or the connection dropping: carries on when back
  total: 0,
  done: [], // results so far, kept across a pause for the one toast at the end
  failed: [],
  error: '',
  tried: new Set(), // every item tried since the page opened: never twice in one visit
};

const statusText = h('span', { class: 'photo-status-text', 'aria-live': 'polite' });
const statusWords = () => `Fetching missing photos in the background: ${auto.done.length + auto.failed.length} of ${auto.total} tried. They pop in as they arrive.`;
/** The small "fetching photos" status for the top bar (admin.js puts it there). On a phone it's just a ring: a tap says what it is. */
export const photoStatus = h('button', { class: 'photo-status', type: 'button', hidden: true, onclick: () => toast(statusWords()) },
  h('span', { class: 'photo-status-ring', 'aria-hidden': 'true' }, icon('image')), statusText);

function showStatus() {
  const tried = auto.done.length + auto.failed.length;
  photoStatus.hidden = false;
  statusText.textContent = tried ? `Photos ${tried}/${auto.total}` : `Fetching ${plural(auto.total, 'photo')}…`;
  photoStatus.title = statusWords();
}

function resetRun() {
  Object.assign(auto, { again: false, paused: false, total: 0, done: [], failed: [], error: '' });
}

/**
 * Quietly fetches the photos that are due (see duePhotos), a few per request, with a small status
 * in the top bar and one toast at the end. Called when the Control Room opens and after a list is
 * added; asked again while running, it makes one more pass for anything new. Never runs while the
 * page is hidden: it stops after the current request and carries on when she's back.
 */
export function autoFetchPhotos() {
  if (auto.run) {
    auto.again = true;
    if (auto.stop === 'hidden' && !document.hidden) auto.stop = '';
    return auto.run;
  }
  if (!store.state) return null;
  if (document.hidden) {
    auto.paused = true; // starts when she looks
    return null;
  }
  auto.paused = false;
  const due = duePhotos(store.state).filter((i) => !auto.tried.has(i.id)).length;
  if (!due) {
    report(); // a paused run whose last photos someone else fetched meanwhile
    return null;
  }
  auto.total = auto.done.length + auto.failed.length + due;
  auto.run = runAuto().catch((e) => console.error(e)).finally(() => { auto.run = null; });
  return auto.run;
}

/** Carries on a background fetch that stopped when the page was hidden or went offline. */
export function resumeAutoPhotos() {
  if (auto.run) {
    if (auto.stop === 'hidden') auto.stop = ''; // back before it had stopped: just keep going
  } else if (auto.paused) {
    autoFetchPhotos();
  }
}

/** Stops the background fetch after its current request ('hidden': until she's back; 'manual': for good). */
export async function stopAutoPhotos(reason = 'hidden') {
  if (auto.run) {
    auto.stop = reason;
    await auto.run;
  } else if (reason === 'manual') {
    resetRun(); // the manual fetch supersedes a paused one, results and all
  }
}

async function runAuto() {
  auto.stop = '';
  auto.again = false;
  showStatus();
  let gone = 0;
  try {
    for (let round = 0; round < MAX_ROUNDS && !auto.stop; round++) {
      let res;
      try {
        res = await api('items.fetchImages', { auto: true, limit: BATCH, exclude: [...auto.tried] });
      } catch (e) {
        if (e.status === 404 && ++gone < 3) continue; // an item deleted mid-fetch: the next round skips it
        if (e.code === 'network') auto.paused = true; // tries again when the connection is back
        else auto.error = e.message;
        break;
      }
      res.done.forEach((id) => auto.tried.add(id));
      res.failed.forEach((f) => auto.tried.add(f.id));
      auto.done.push(...res.done);
      auto.failed.push(...res.failed);
      auto.total = auto.done.length + auto.failed.length + res.remaining;
      showStatus();
      if (res.remaining > 0 && (res.done.length || res.failed.length)) continue;
      if (!auto.again) break;
      auto.again = false; // a list was added meanwhile: one more pass picks its items up
    }
  } finally {
    photoStatus.hidden = true;
  }
  if (auto.stop === 'hidden') auto.paused = true;
  if (auto.stop === 'manual') resetRun(); // the manual fetch reports for itself
  else if (!auto.paused) report();
  auto.stop = '';
}

/**
 * One toast for the whole run: what arrived, and which shops refused (with a way to fix them).
 * A photo that failed before and failed again on a later day isn't reported twice.
 */
function report() {
  const { done, error } = auto;
  // New misses only; and failures fixed or deleted since don't need mentioning.
  const failed = auto.failed.filter((f) => !(f.tries > 1) && store.state.items.some((i) => i.id === f.id && !i.image));
  resetRun();
  if (!done.length && !failed.length) {
    if (error) toast(`Couldn’t fetch the missing photos: ${error}`, { tone: 'error' });
    return;
  }
  toast(photoSummary(done.length, failed), failed.length
    ? { tone: 'warn', action: () => openPhotoFailures(failed), actionLabel: 'See which', duration: 10000, stacked: true }
    : {});
}

/**
 * "2 photos added. Farfetch blocked 1: paste its image link or use the + Findom bookmarklet."
 * (The bookmarklet, clicked on the shop's page, offers that page's photo to the item already on the list.
 * It lives in a bookmarks bar, so on a touch screen it isn't suggested.)
 */
function photoSummary(added, failed) {
  const parts = added ? [`${plural(added, 'photo')} added.`] : [];
  const n = failed.length;
  if (!n) return parts.join(' ');
  const stores = new Map();
  for (const f of failed) stores.set(f.store || 'the shop', (stores.get(f.store || 'the shop') || 0) + 1);
  const count = added ? String(n) : plural(n, 'photo');
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const fix = `paste ${n === 1 ? 'its image link' : 'their image links'}${touch ? ' or add a photo from the item' : ' or use the + Findom bookmarklet'}`;
  if (stores.size === 1) {
    const [name] = stores.keys();
    parts.push(failed.every((f) => f.blocked)
      ? `${name} blocked ${count}: ${fix}.`
      : `${count} from ${name} didn’t come through: ${fix}.`);
  } else {
    const which = [...stores].sort((a, b) => b[1] - a[1]).map(([s, c]) => `${s} ${c}`).join(', ');
    parts.push(`${count} didn’t come through (${which}): ${fix}.`);
  }
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

/** The photos the background fetch couldn't get, each with a way to add it by hand. */
function openPhotoFailures(failed) {
  const open = failed.filter((f) => store.state.items.some((i) => i.id === f.id && !i.image));
  if (!open.length) {
    toast('Those items have photos now.');
    return;
  }
  const sheet = new Sheet({ title: `${plural(open.length, 'photo')} to add`, eyebrow: 'Photos', size: 'md' });
  sheet.body.append(h('div', { class: 'fetch-failures' }, failureList(open, (id) => {
    sheet.close();
    openItemEditor(id, { focus: 'photo' });
  })));
  sheet.foot.append(button('Done', { kind: 'primary', onclick: () => sheet.close() }));
  sheet.open();
}
