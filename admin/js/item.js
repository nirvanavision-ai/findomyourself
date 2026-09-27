/*
 * FINDOM YOURSELF · Control Room: one wishlist item. The editor sheet (photo, details, her own
 * affiliate link and where visitors' button goes, goal, status), claiming and unclaiming, and
 * every way to get a photo in: upload (shrunk on the device first when it's big), paste, drag
 * and drop, or an image link.
 *
 * Unsaved edits are kept on this device while the sheet is open, so a reload (or iOS
 * killing the tab in the background) doesn't lose them.
 */
import {
  h, icon, swap, sig, uid, local, debounce, money, balance, amountInput, parseAmount, currencyName, currencyShort, when, shortDate,
  plural, hostOf, extractUrl, reducedMotion,
} from './core.js';
import { api, upload, store, subscribe } from './api.js';
import {
  Sheet, field, textInput, textArea, moneyInput, segmented, toggle, confirmSheet, toast, toastError, button, busy, note, thumb,
} from './ui.js';

const PRIORITIES = [{ value: 1, label: 'Whim' }, { value: 2, label: 'Want' }, { value: 3, label: 'Obsessed' }];
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const DRAFT_DAYS = 14;
const draftKey = (id) => `item-draft:${id || 'new'}`;

let openEditor = null; // the editor on screen, if any: {id, isDirty()}

export const editorState = () => openEditor;

/* ───────────────────────── photos ───────────────────────── */

/** Decodes an image file into something a canvas can draw (upright, per its EXIF). */
async function decodeImage(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) { /* try the <img> route */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * Big photos (or formats the server can't read, like HEIC) are redrawn here as a JPEG of
 * at most 2400px, so phone photos upload fast and fit under the server's upload limit.
 */
export async function preparePhoto(file) {
  const limit = Math.min((store.meta && store.meta.maxUpload) || 20 * 1048576, 20 * 1048576);
  const convert = !PHOTO_TYPES.includes(file.type);
  const big = file.size > Math.min(3 * 1048576, limit * 0.9);
  if (!convert && !big) return file;
  let source;
  try {
    source = await decodeImage(file);
  } catch (e) {
    return file; // can't read it here: let the server have a go and explain
  }
  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;
  const canvas = document.createElement('canvas');
  const c = canvas.getContext('2d');
  for (const [edge, quality] of [[2400, 0.9], [1800, 0.85], [1400, 0.8]]) {
    const scale = Math.min(1, edge / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    c.fillStyle = '#ffffff'; // JPEG has no transparency: cut-outs go on white, which the porcelain tile melts away
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= limit * 0.95) {
      if (source.close) source.close();
      const name = (file.name || 'photo').replace(/\.[a-z0-9]+$/i, '') + '.jpg';
      return new File([blob], name, { type: 'image/jpeg' });
    }
  }
  if (source.close) source.close();
  return file;
}

const imageFrom = (list) => Array.from(list || []).find((f) => f && (f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|gif|avif)$/i.test(f.name || '')));

/* ───────────────────────── affiliate links ───────────────────────── */

/** Her own link as typed: a full address is kept exactly (its parameters are the point). */
const ownLink = (text) => {
  const s = String(text || '').trim();
  return /^https?:\/\/\S+$/i.test(s) ? s : extractUrl(s);
};

/** "Awin", "Amazon": a network's name without "(short link)". */
const networkName = (network) => String(network || '').replace(/\s*\(.*\)$/, '');

/** "a ShopMy link", "an Awin link", "an LTK link" (initials that start with a vowel sound). */
const aLink = (network) => `${/^[aeiou]/i.test(network) || /^[FHLMNRSX][A-Z]/.test(network) ? 'an' : 'a'} ${network} link`;

/** The button that teaches a whole shop (or her Amazon tag, or the catch-all) from one link. */
function suggestionLabel(suggestion) {
  if (!suggestion) return '';
  if (suggestion.rule) return `Use ${suggestion.network} for every ${suggestion.domain} link`;
  if (suggestion.amazon) return `Save ${Object.values(suggestion.amazon)[0]} as your Amazon tag`;
  if (suggestion.catchAll) return `Use ${suggestion.network} for every other shop`;
  return '';
}

/** Offers to learn from a link she pasted; the button gives way to what was set up. */
function suggestionButton(suggestion, url) {
  const label = suggestionLabel(suggestion);
  if (!label) return null;
  const wrap = h('div', { class: 'learn-offer' });
  const btn = button(label, { size: 'sm', iconName: 'sparkle', className: 'btn-wrap' });
  btn.addEventListener('click', () => busy(btn, async () => {
    try {
      const res = await api('affiliate.learn', { url });
      wrap.replaceChildren(h('p', { class: 'learn-done' }, icon('check'), `Done: ${res.applied}.`));
      toast(`Learned: ${res.applied}. Visitors go through it from now on.`, { tone: 'gold' });
    } catch (e) {
      toastError(e);
    }
  }));
  wrap.append(btn);
  return wrap;
}

/* ───────────────────────── the editor ───────────────────────── */

const blankValues = () => ({
  name: '', brand: '', variant: '', category: '', price: '', currency: store.state.settings.baseCurrency,
  url: '', affiliateUrl: '', priority: '2', note: '', status: 'wishing', goal: false,
});

/** An item's editable fields as the form holds them (strings). */
function valuesOf(item, state = store.state) {
  return {
    name: item.name, brand: item.brand, variant: item.variant, category: item.category,
    price: item.price > 0 ? amountInput(item.price) : '', currency: item.currency, url: item.url,
    affiliateUrl: item.affiliateUrl || '',
    priority: String(item.priority), note: item.note, status: item.status === 'claimed' ? 'claimed' : item.status,
    goal: state.settings.goalId === item.id,
  };
}

/**
 * Opens the editor. opts: {warnings: [], duplicate: bool, focus: 'price'|'photo'|'name', fromLink: bool,
 * affiliate: {network, kind} (her link was recognized), suggestion + pasted (what that link could teach),
 * prefill: {field: value} + image + grabbed + sameAs (a new item from the bookmarklet)}.
 * id null = a new item typed in by hand (or grabbed from a shop page). Returns the sheet.
 */
export function openItemEditor(id = null, opts = {}) {
  const s0 = store.state;
  let itemId = id;
  const item = id ? s0.items.find((i) => i.id === id) : null;
  if (id && !item) {
    toast('That item isn’t on the list anymore.', { tone: 'error' });
    return null;
  }
  let base = item ? valuesOf(item) : blankValues();
  let gone = false;
  let photoBusy = false;
  let photoSig = null;
  let pendingImage = !id && opts.image ? opts.image : ''; // a grabbed photo, fetched when the new item is saved
  const find = () => (itemId ? store.state.items.find((i) => i.id === itemId) : null);

  /* ── controls ── */
  const name = textInput({ maxlength: 140, required: true, autocapitalize: 'words', enterkeyhint: 'next', 'aria-required': 'true' });
  const brand = textInput({ maxlength: 80, list: 'brand-list', autocapitalize: 'words', enterkeyhint: 'next' });
  const variant = textInput({ maxlength: 80, placeholder: 'Colour, size…', enterkeyhint: 'next' });
  const category = textInput({ maxlength: 60, list: 'category-list', enterkeyhint: 'next' });
  const price = moneyInput({ label: 'Price', placeholder: '0' });
  const currency = h('select', { class: 'input select', 'aria-label': 'Currency' },
    (store.meta.currencies || [base.currency]).map((c) => h('option', { value: c, text: currencyShort(c), title: currencyName(c) })));
  const url = h('input', { class: 'input', type: 'url', inputmode: 'url', placeholder: 'https://…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done' });
  const mine = h('input', { class: 'input', type: 'url', inputmode: 'url', placeholder: 'https://…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done' });
  const outBox = h('div', { class: 'span-2 out-box', 'aria-live': 'polite' });
  const priority = segmented({ legend: 'How badly?', options: PRIORITIES, value: base.priority, className: 'seg-fill' });
  const noteIn = textArea({ maxlength: 400, rows: 3, placeholder: 'Size, why you want it, where else it’s sold…' });
  const status = segmented({ legend: 'Status', value: 'wishing', className: 'seg-fill', options: [{ value: 'wishing', label: 'On the list' }, { value: 'archived', label: 'Archived' }] });
  const goal = toggle({ label: 'Pin as the current goal', hint: 'The goal gets the spotlight on the site. Off = the cheapest item leads.', checked: base.goal });
  const goalHint = goal.querySelector('.switch-hint');
  const error = h('p', { class: 'msg error', role: 'alert', hidden: true });
  const notices = h('div', { class: 'notices' });
  const missingBox = h('div');
  const inspectBox = h('div', { class: 'inspect', hidden: true });
  const statusControls = h('div', { class: 'stack' }, status, goal);
  const claimArea = h('div', { class: 'claim-area' });
  const openLink = h('a', { class: 'link-btn', target: '_blank', rel: 'noopener noreferrer' }, 'Open ', icon('external'));
  const refreshBtn = button('Refresh from link', { size: 'sm', iconName: 'refresh' });
  const priceField = field({ label: 'Price', control: price.wrap, className: 'field-price' });
  priceField.querySelector('label').htmlFor = price.input.id;

  /* ── the photo ── */
  const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  const photoLink = h('input', { class: 'input', type: 'url', inputmode: 'url', placeholder: 'Image link', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'Image link' });
  const photoMsg = h('p', { class: 'photo-msg', 'aria-live': 'polite' });
  const tile = h('div', { class: 'photo-tile' });
  const busyText = h('span', { class: 'photo-busy-text' });
  const overlay = h('div', { class: 'photo-busy', hidden: true }, h('span', { class: 'spinner' }), busyText);
  const photoActions = h('div', { class: 'photo-actions' });
  const photoBox = h('section', { class: 'photo', 'aria-label': 'Photo' },
    h('div', { class: 'photo-frame' }, tile, overlay),
    h('div', { class: 'photo-side' },
      photoActions,
      h('form', { class: 'photo-link', novalidate: true, onsubmit: (e) => { e.preventDefault(); fetchPhoto(photoLink.value); } },
        photoLink, button('Fetch', { type: 'submit', size: 'sm', className: 'photo-fetch' })),
      photoMsg,
      h('p', { class: 'field-hint', text: 'Drop or paste a photo here too. White backgrounds melt into the tile.' })),
    fileInput);

  /* ── reading and writing the form ── */
  const read = () => ({
    name: name.value, brand: brand.value, variant: variant.value, category: category.value, price: price.input.value,
    currency: currency.value, url: url.value, affiliateUrl: mine.value, priority: priority.value, note: noteIn.value,
    status: base.status === 'claimed' ? 'claimed' : status.value, goal: goal.input.checked,
  });
  const write = (v) => {
    name.value = v.name;
    brand.value = v.brand;
    variant.value = v.variant;
    category.value = v.category;
    price.input.value = v.price;
    currency.value = v.currency;
    price.setCurrency(v.currency);
    url.value = v.url;
    mine.value = v.affiliateUrl || '';
    priority.value = v.priority;
    noteIn.value = v.note;
    if (v.status !== 'claimed') status.value = v.status;
    goal.input.checked = !!v.goal;
    goal.input.disabled = status.value !== 'wishing';
    syncLink();
    syncMissing();
  };
  const trimmed = (v) => ({
    ...v, name: v.name.trim(), brand: v.brand.trim(), variant: v.variant.trim(), category: v.category.trim(),
    url: v.url.trim(), affiliateUrl: String(v.affiliateUrl || '').trim(), note: v.note.trim(), price: String(parseAmount(v.price) ?? v.price.trim()),
  });
  const isDirty = () => sig(trimmed(read())) !== sig(trimmed(base));

  function syncLink() {
    const link = extractUrl(url.value);
    openLink.hidden = !link;
    if (link) openLink.href = link;
    refreshBtn.disabled = !link;
    syncOut();
  }

  /* ── where visitors' button goes ── */
  // Saved links: the server's answer (item.out) and the clicks. Links typed but not saved yet:
  // asked about half a second after typing stops (affiliate.detect saves nothing).
  let outKey = null; // the links last asked about
  let outSig = '';
  let outSeq = 0;

  function showOut(out, clicks, extra = null) {
    outBox.classList.remove('is-checking');
    const next = sig(out, clicks, extra && extra.key);
    if (next === outSig) return;
    outSig = next;
    const parts = [];
    if (out && out.kind !== 'none') {
      const safe = /^https?:\/\//i.test(out.url || '');
      parts.push(h('p', { class: ['out-to', out.affiliate && 'is-affiliate'] },
        icon(out.affiliate ? 'tag' : 'link'),
        h('span', { class: 'out-text' }, 'Visitors go to: ', h('strong', { text: out.label }),
          out.kind === 'plain' ? h('span', { class: 'muted', text: ' (no commission)' }) : null),
        safe && h('a', { class: 'link-btn', href: out.url, target: '_blank', rel: 'noopener noreferrer', dataset: { key: 'out-open' }, 'aria-label': 'Open where visitors go (new tab)' }, 'Open ', icon('external'))));
      if (clicks) {
        parts.push(h('p', { class: 'out-clicks', text: clicks.total ? `${plural(clicks.total, 'click')} · ${clicks.week} this week` : 'No clicks yet' }));
      }
    }
    if (extra) parts.push(extra.node);
    swap(outBox, parts);
  }

  const detectOut = debounce(async (key, mineLink, productLink) => {
    const seq = ++outSeq;
    const current = find();
    const clicks = current ? current.clicks : null;
    try {
      const res = await api('affiliate.detect', { url: mineLink || productLink });
      if (seq !== outSeq || gone) return;
      const found = res.detected;
      if (mineLink) {
        const network = found && found.network !== 'Short link' ? networkName(found.network) : '';
        showOut({ url: mineLink, kind: 'mine', label: network ? `Your link (${network})` : 'Your link', affiliate: true }, clicks);
        return;
      }
      // Her own affiliate or creator link typed as the shop link: it belongs in "Your link".
      if (found && found.kind !== 'amazon' && found.network !== 'Short link') {
        const move = button('Move it to Your link', { size: 'sm', iconName: 'down', onclick: () => {
          mine.value = url.value.trim();
          url.value = found.destination || '';
          syncLink();
          syncMissing();
          saveDraft();
        } });
        // Where it would lead as it stands isn't worth showing: the move is the fix.
        showOut(null, null, { key: `move:${key}`, node: h('div', { class: 'out-move' }, h('p', { text: `That’s ${aLink(networkName(found.network))}, so it works best as Your link.` }), move) });
        return;
      }
      showOut(res.preview, clicks);
    } catch (e) {
      if (seq !== outSeq || gone) return;
      if (mineLink) showOut({ url: mineLink, kind: 'mine', label: 'Your link', affiliate: true }, clicks);
      else showOut(null, null, { key: 'error', node: h('p', { class: 'muted', text: 'Couldn’t check where that link goes right now.' }) });
    }
  }, 500);

  function syncOut() {
    const current = find();
    const mineText = mine.value.trim();
    const productText = url.value.trim();
    if (current && current.out && mineText === (current.affiliateUrl || '') && productText === current.url) {
      outKey = null;
      outSeq++;
      detectOut.cancel();
      showOut(current.out, current.clicks);
      return;
    }
    const mineLink = mineText ? ownLink(mineText) : '';
    const productLink = extractUrl(productText);
    const key = `${mineLink}\n${productLink}`;
    if (key === outKey) return; // already showing (or asking about) these links
    outKey = key;
    outSeq++;
    if (!mineLink && !productLink) {
      detectOut.cancel();
      showOut(null, null);
      return;
    }
    outBox.classList.add('is-checking');
    detectOut(key, mineLink, productLink);
  }

  /** Highlights what's missing (price, photo) and offers one-tap fixes. */
  function syncMissing() {
    const current = find();
    const noPrice = !(parseAmount(price.input.value) > 0);
    const noPhoto = !current || !current.image;
    priceField.classList.toggle('is-missing', noPrice);
    photoBox.classList.toggle('is-missing', noPhoto && !(current && current.imageSource) && !pendingImage);
    const warnings = (opts.warnings || []).filter((w) => !/already on your list/i.test(w));
    const fixes = [];
    if (noPrice) fixes.push(h('button', { class: 'chip chip-fix', type: 'button', onclick: () => focusField(price.input) }, icon('plus'), 'Add price'));
    if (noPhoto) {
      fixes.push(h('button', { class: 'chip chip-fix', type: 'button', onclick: () => pickFile() }, icon('upload'), 'Upload photo'));
      fixes.push(h('button', { class: 'chip chip-fix', type: 'button', onclick: () => focusField(photoLink) }, icon('link'), 'Paste image link'));
    }
    if (!warnings.length && !(opts.fromLink && fixes.length)) {
      missingBox.replaceChildren();
      return;
    }
    missingBox.replaceChildren(note(fixes.length ? 'warn' : 'ok',
      warnings.length ? warnings.map((w) => h('p', { text: w })) : h('p', { text: 'Almost there. A couple of things are missing:' }),
      fixes.length ? h('div', { class: 'chips fix-chips' }, fixes) : h('p', { class: 'muted', text: 'All sorted now. Save when you’re happy.' })));
  }

  function focusField(input) {
    input.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    input.focus({ preventScroll: true });
  }

  /* ── drafts on this device ── */
  const saveDraft = debounce(() => {
    if (gone) return;
    if (isDirty()) local.set(draftKey(itemId), { at: Date.now(), values: read() });
    else local.remove(draftKey(itemId));
  }, 350);
  const dropDraft = () => {
    saveDraft.cancel();
    local.remove(draftKey(itemId));
  };

  /* ── photo actions ── */
  function renderPhoto(force = false) {
    const current = find();
    const next = sig(current && current.image, current && current.imageSource, gone, pendingImage);
    if (!force && next === photoSig) return;
    photoSig = next;
    if (current && (current.image || current.imageSource)) {
      tile.replaceChildren(thumb(current, 'xl'));
    } else if (!current && pendingImage) {
      tile.replaceChildren(thumb({ imageSource: pendingImage, name: name.value, brand: brand.value }, 'xl'));
    } else {
      tile.replaceChildren(h('span', { class: 'photo-empty' }, icon('image'), h('span', { text: 'No photo' })));
    }
    tile.classList.toggle('has-photo', !!(current && current.image));
    const canPaste = !!(navigator.clipboard && navigator.clipboard.read);
    swap(photoActions,
      button(current && current.image ? 'Replace' : 'Upload', { size: 'sm', kind: current && current.image ? 'ghost' : 'primary', iconName: 'upload', dataset: { key: 'photo-upload' }, onclick: () => pickFile(), disabled: photoBusy || gone }),
      canPaste && button('Paste', { size: 'sm', iconName: 'paste', dataset: { key: 'photo-paste' }, onclick: () => pasteFromClipboard(), disabled: photoBusy || gone }),
      current && current.image && button('Remove', { size: 'sm', kind: 'danger', iconName: 'trash', dataset: { key: 'photo-remove' }, onclick: () => removePhoto(), disabled: photoBusy || gone }));
    if (current && !current.image && current.imageSource) {
      photoOk(`Showing the photo straight from ${hostOf(current.imageSource) || 'the shop'}. Fetch it to keep a copy that can’t break.`);
      if (!photoLink.value) photoLink.value = current.imageSource;
    } else if (!current && pendingImage) {
      photoOk(`The photo from ${hostOf(pendingImage) || 'the shop page'} is fetched when you add the item.`);
      if (!photoLink.value) photoLink.value = pendingImage;
    }
  }

  const setPhotoBusy = (on, text = '', progress = null) => {
    photoBusy = on;
    overlay.hidden = !on;
    busyText.textContent = progress === null ? text : `${text} ${Math.round(progress * 100)}%`;
    photoActions.querySelectorAll('button').forEach((b) => { b.disabled = on || gone; });
  };
  function photoError(message) {
    photoMsg.textContent = message;
    photoMsg.classList.add('is-error');
  }
  function photoOk(message) {
    photoMsg.textContent = message;
    photoMsg.classList.remove('is-error');
  }
  function pickFile() {
    fileInput.value = '';
    fileInput.click();
  }
  fileInput.addEventListener('change', () => {
    const file = imageFrom(fileInput.files);
    if (file) handleFile(file);
  });

  async function handleFile(file) {
    if (photoBusy || gone) return;
    if (!(await ensureSaved())) return;
    setPhotoBusy(true, 'Getting it ready…');
    photoOk('');
    try {
      const ready = await preparePhoto(file);
      setPhotoBusy(true, 'Uploading…', 0);
      await upload('item.image.upload', { id: itemId }, ready, { onProgress: (p) => setPhotoBusy(true, 'Uploading…', p) });
      photoOk('Photo saved.');
    } catch (e) {
      photoError(e.message);
    } finally {
      setPhotoBusy(false);
      renderPhoto(true);
      syncMissing();
    }
  }

  async function fetchPhoto(raw) {
    if (photoBusy || gone) return;
    const link = extractUrl(raw);
    if (!link) {
      photoError('Paste the full image or product link, starting with https://');
      photoLink.focus();
      return;
    }
    if (!(await ensureSaved())) return;
    setPhotoBusy(true, 'Fetching the photo…');
    photoOk('');
    try {
      await api('item.image.fetch', { id: itemId, url: link });
      photoLink.value = '';
      photoOk('Photo saved.');
    } catch (e) {
      photoError(e.message);
    } finally {
      setPhotoBusy(false);
      renderPhoto(true);
      syncMissing();
    }
  }

  async function pasteFromClipboard() {
    try {
      const items = await navigator.clipboard.read();
      for (const clip of items) {
        const type = clip.types.find((t) => t.startsWith('image/'));
        if (type) {
          const blob = await clip.getType(type);
          await handleFile(new File([blob], `pasted.${type.split('/')[1] || 'png'}`, { type }));
          return;
        }
      }
      for (const clip of items) {
        if (clip.types.includes('text/plain')) {
          const text = await (await clip.getType('text/plain')).text();
          if (extractUrl(text)) {
            await fetchPhoto(text);
            return;
          }
        }
      }
      photoError('There’s no image on the clipboard. Copy a photo (or its link) first.');
    } catch (e) {
      photoError('The browser wouldn’t share the clipboard. Paste straight into the image link box instead.');
    }
  }

  async function removePhoto() {
    const ok = await confirmSheet({ title: 'Remove the photo?', message: 'The item stays on the list, shown with its brand initial instead.', confirmLabel: 'Remove it', danger: true });
    if (!ok) return;
    setPhotoBusy(true, 'Removing…');
    try {
      await api('item.image.remove', { id: itemId });
      photoOk('Photo removed.');
    } catch (e) {
      photoError(e.message);
    } finally {
      setPhotoBusy(false);
      renderPhoto(true);
      syncMissing();
    }
  }

  // Drag and drop onto the tile.
  const frame = photoBox.querySelector('.photo-frame');
  frame.addEventListener('dragover', (e) => {
    e.preventDefault();
    frame.classList.add('is-drop');
  });
  frame.addEventListener('dragleave', () => frame.classList.remove('is-drop'));
  frame.addEventListener('drop', (e) => {
    e.preventDefault();
    frame.classList.remove('is-drop');
    const file = imageFrom(e.dataTransfer.files);
    if (file) handleFile(file);
    else {
      const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (extractUrl(text)) fetchPhoto(text);
    }
  });

  /* ── what the product page says ── */
  async function inspect() {
    const link = extractUrl(url.value);
    if (!link) return;
    await busy(refreshBtn, async () => {
      try {
        const res = await api('link.inspect', { url: link });
        showInspect(res.info);
      } catch (e) {
        inspectBox.hidden = false;
        inspectBox.replaceChildren(note('error', e.message));
      }
    }, 'Reading the page…');
  }

  function showInspect(info) {
    const v = read();
    const current = find();
    const candidates = [];
    const offer = (key, label, found, now) => {
      if (found === '' || found === null || found === undefined) return;
      if (String(found).trim().toLowerCase() === String(now).trim().toLowerCase()) return;
      if (!info.found && String(now).trim() !== '') return; // a guess from the link itself never replaces what's typed
      candidates.push({ key, label, found, now, display: found, checked: String(now).trim() === '' });
    };
    offer('name', 'Name', info.name, v.name);
    offer('brand', 'Brand', info.brand, v.brand);
    offer('variant', 'Colour / size', info.variant, v.variant);
    if (info.price !== null && info.price !== undefined) {
      const foundCur = info.currency || v.currency;
      const nowPrice = parseAmount(v.price);
      if (nowPrice !== info.price || foundCur !== v.currency) {
        candidates.push({ key: 'price', label: 'Price', found: info.price, currency: foundCur, now: nowPrice ? money(nowPrice, v.currency) : '', display: money(info.price, foundCur), checked: !nowPrice });
      }
    }
    if (info.image && !(current && current.image)) {
      candidates.push({ key: 'photo', label: 'Photo', found: info.image, now: '', display: `from ${hostOf(info.image)}`, checked: true });
    }
    const typed = extractUrl(v.url);
    if (info.url && typed && info.url !== typed) {
      candidates.push({ key: 'url', label: 'Clean link', found: info.url, now: '', display: 'same page, minus the tracking bits', checked: true });
    }
    inspectBox.hidden = false;
    const close = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => { inspectBox.hidden = true; } }, icon('x'));
    if (!candidates.length) {
      swap(inspectBox,
        h('div', { class: 'inspect-head' }, h('p', { class: 'inspect-title', text: info.found ? 'Nothing new on that page.' : 'The shop didn’t share its details.' }), close),
        !info.found && info.error && h('p', { class: 'muted', text: info.error }));
      return;
    }
    const rows = candidates.map((c) => {
      const cb = h('input', { type: 'checkbox', checked: c.checked, class: 'check' });
      cb.candidate = c;
      return h('label', { class: 'inspect-row' }, cb,
        h('span', null, h('strong', { text: `${c.label}: ` }), h('span', { text: String(c.display) }),
          c.now ? h('span', { class: 'muted', text: ` (now: ${c.now})` }) : null));
    });
    const apply = button('Use the ticked ones', { kind: 'primary', size: 'sm', onclick: () => {
      const fields = { name, brand, variant };
      for (const row of rows) {
        const cb = row.querySelector('input');
        if (!cb.checked) continue;
        const c = cb.candidate;
        if (c.key === 'price') {
          price.input.value = amountInput(c.found);
          currency.value = c.currency;
          price.setCurrency(c.currency);
        } else if (c.key === 'photo') {
          fetchPhoto(c.found);
        } else if (c.key === 'url') {
          url.value = c.found;
        } else {
          fields[c.key].value = c.found;
        }
      }
      inspectBox.hidden = true;
      syncLink();
      syncMissing();
      saveDraft();
    } });
    swap(inspectBox,
      h('div', { class: 'inspect-head' }, h('p', { class: 'inspect-title', text: info.found ? `Found on ${info.store || hostOf(info.url)}` : 'Only the link itself had clues' }), close),
      !info.found && info.error && h('p', { class: 'muted', text: info.error }),
      h('div', { class: 'inspect-rows' }, rows),
      h('div', { class: 'row-end' }, apply));
  }

  /* ── status: claim, unclaim, goal ── */
  function renderStatus() {
    const current = find();
    const s = store.state;
    if (current && current.status === 'claimed') {
      statusControls.hidden = true;
      swap(claimArea, h('div', { class: 'claimed-box' },
        h('span', { class: 'badge badge-claimed', text: 'Claimed' }),
        h('p', null, `Claimed${current.claimedAt ? ` ${shortDate(current.claimedAt, true)}` : ''} for `, h('strong', { class: 'mono', text: money(current.claimedAmount || current.priceBase) }), '. It’s on the trophy wall.'),
        button('Unclaim', { size: 'sm', iconName: 'undo', dataset: { key: 'unclaim' }, onclick: () => unclaimItem(itemId) })));
      return;
    }
    statusControls.hidden = false;
    const autoGoal = current && s.goalId === current.id && s.settings.goalId !== current.id;
    goalHint.textContent = autoGoal ? 'It’s the goal right now because it’s the cheapest. Pin it to keep it there.' : 'The goal gets the spotlight on the site. Off = the cheapest item leads.';
    if (!current || current.status !== 'wishing') {
      swap(claimArea);
      return;
    }
    swap(claimArea, h('div', { class: 'claim-row' },
      button(current.affordable ? 'Unlocked — claim it' : 'Bought it? Claim it', { kind: current.affordable ? 'primary' : 'ghost', iconName: 'sparkle', className: current.affordable ? 'glow' : '', dataset: { key: 'claim' }, onclick: () => claimFromEditor() }),
      !current.affordable && !current.priceMissing && h('span', { class: 'muted', text: `${money(current.toGo)} to go` })));
  }
  status.addEventListener('change', () => { goal.input.disabled = status.value !== 'wishing'; });

  async function claimFromEditor() {
    if (isDirty() && !(await save({ keepOpen: true }))) return;
    openClaimSheet(itemId);
  }

  /* ── saving ── */
  function showError(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  async function ensureSaved() {
    if (itemId) return true;
    if (!name.value.trim()) {
      showError('Give it a name first, then add the photo.');
      name.focus();
      return false;
    }
    return save({ keepOpen: true });
  }

  async function save({ keepOpen = false } = {}) {
    if (gone) return false;
    const v = read();
    showError('');
    if (!v.name.trim()) {
      showError('Give it a name.');
      name.focus();
      return false;
    }
    const priceValue = v.price.trim() === '' ? 0 : parseAmount(v.price);
    if (priceValue === null) {
      showError('Type the price as a number, like 1100 or 590.00.');
      price.input.focus();
      return false;
    }
    const link = v.url.trim() ? extractUrl(v.url) : '';
    if (v.url.trim() && !link) {
      showError('That link doesn’t look right. Paste the full address, starting with https://');
      url.focus();
      return false;
    }
    const own = v.affiliateUrl.trim() ? ownLink(v.affiliateUrl) : '';
    if (v.affiliateUrl.trim() && !own) {
      showError('Your link doesn’t look right. Paste the full address, starting with https://');
      mine.focus();
      return false;
    }
    const payload = {
      name: v.name.trim(), brand: v.brand.trim(), variant: v.variant.trim(), category: v.category.trim(),
      price: priceValue, currency: v.currency, url: link, affiliateUrl: own, priority: Number(v.priority) || 2, note: v.note.trim(),
    };
    if (itemId) payload.id = itemId;
    if (base.status !== 'claimed') payload.status = v.status;
    if (v.goal !== base.goal) payload.goal = v.goal;
    const wasNew = !itemId;
    // A new item saved with an image link typed in (or grabbed from the shop page) gets that photo too.
    // Saving just before an upload or a fetch (keepOpen) leaves the photo to that.
    const photoUrl = wasNew && !keepOpen ? extractUrl(photoLink.value) : '';
    if (photoUrl) payload.imageUrl = photoUrl;
    try {
      const res = await busy(saveBtn, () => api('item.save', { item: payload }));
      dropDraft();
      itemId = res.itemId;
      pendingImage = '';
      const fresh = res.state.items.find((i) => i.id === itemId);
      if (fresh) base = valuesOf(fresh, res.state);
      if (res.warnings && res.warnings.length) toast(res.warnings[0], { tone: 'error' });
      if (keepOpen) {
        write(base);
        if (fresh) sheet.setTitle(fresh.name, fresh.brand || 'Wishlist');
        saveBtn.querySelector('.btn-label').textContent = 'Save';
        if (!deleteZone.firstChild) deleteZone.append(deleteBtn);
        openEditor.id = itemId;
        rememberOpen(itemId);
        renderPhoto(true);
        renderStatus();
        if (wasNew) toast('Added to the list.');
        return true;
      }
      sheet.close();
      toast(wasNew ? 'Added to the list. Now go earn it.' : 'Saved.');
      return true;
    } catch (e) {
      showError(e.message);
      return false;
    }
  }

  async function remove() {
    const current = find();
    if (!current) return;
    const ok = await confirmSheet({
      title: `Delete “${current.name}”?`,
      message: 'It disappears from the list, photo and all. Past receipts stay. This can’t be undone.',
      confirmLabel: 'Delete it', danger: true,
    });
    if (!ok) return;
    try {
      await api('item.delete', { id: itemId });
      dropDraft();
      gone = true;
      sheet.close();
      toast('Deleted. One less temptation.');
    } catch (e) {
      showError(e.message);
    }
  }

  /* ── the sheet ── */
  const saveBtn = button(itemId ? 'Save' : 'Add to the list', { kind: 'primary', type: 'submit', iconName: 'check' });
  const deleteBtn = button('Delete item', { kind: 'danger', size: 'sm', iconName: 'trash', onclick: () => remove() });
  const deleteZone = h('div', { class: 'danger-zone' }, itemId ? deleteBtn : null);
  const form = h('form', { class: 'item-form stack', novalidate: true, id: uid('item-form') },
    h('div', { class: 'form-grid' },
      field({ label: 'Name', control: name, className: 'span-2', labelExtra: h('span', { class: 'req', 'aria-hidden': 'true', text: '*' }) }),
      field({ label: 'Brand', control: brand }),
      field({ label: 'Colour / size', control: variant }),
      priceField,
      field({ label: 'Currency', control: currency }),
      field({ label: 'Link', control: url, className: 'span-2', labelExtra: openLink }),
      h('div', { class: 'span-2 link-tools' }, refreshBtn, h('span', { class: 'field-hint', text: 'Reads the shop page again and offers what it finds.' })),
      h('div', { class: 'span-2' }, inspectBox),
      field({ label: 'Your link', control: mine, className: 'span-2', hint: 'Optional. Your affiliate or creator link (ShopMy, LTK, Amazon, Awin…). Visitors go through it instead of the shop link.' }),
      outBox,
      field({ label: 'Category', control: category, className: 'span-2' }),
      h('div', { class: 'span-2' }, priority),
      field({ label: 'Note', control: noteIn, counter: 400, className: 'span-2' })),
    h('section', { class: 'form-section status-box', 'aria-label': 'Status' }, statusControls, claimArea),
    error,
    deleteZone);
  saveBtn.setAttribute('form', form.id);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
  form.addEventListener('input', () => {
    saveDraft();
    syncMissing();
  });
  form.addEventListener('change', () => saveDraft());
  url.addEventListener('input', syncLink);
  mine.addEventListener('input', syncOut);
  currency.addEventListener('change', () => price.setCurrency(currency.value));
  refreshBtn.addEventListener('click', inspect);

  const sheet = new Sheet({
    title: item ? item.name : 'New item',
    eyebrow: item ? (item.brand || hostOf(item.url) || 'Wishlist') : opts.grabbed ? `From ${hostOf(opts.prefill && opts.prefill.url) || 'a shop page'}` : 'Add by hand',
    size: 'lg',
    className: 'sheet-item',
    onRequestClose: async () => {
      if (gone || !isDirty()) return true;
      const discard = await confirmSheet({ title: 'Discard your changes?', message: 'Your edits to this item haven’t been saved.', confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true });
      if (discard) dropDraft();
      return discard;
    },
  });
  notices.append(missingBox);
  if (opts.duplicate) notices.prepend(note('info', 'That link is already on your list. Here it is.'));
  // A pasted affiliate link: say so, and offer to learn the shop (or her Amazon tag) from it.
  const learn = opts.suggestion && opts.pasted ? suggestionButton(opts.suggestion, opts.pasted) : null;
  if (opts.affiliate) {
    notices.append(note('ok', h('p', { text: `Recognized ${aLink(networkName(opts.affiliate.network))}. It’s saved as your link, and visitors will go through it.` }), learn));
  } else if (learn) {
    notices.append(note('info', h('p', { text: 'That link can set up the whole shop, not just this item.' }), learn));
  }
  if (opts.grabbed) {
    notices.append(note('info', h('p', { text: 'Filled in from the shop page. Check it over, then add it to the list.' })));
  }
  if (opts.sameAs) {
    notices.prepend(note('warn', h('p', { text: 'Looks like this is already on your list.' }),
      h('button', { class: 'link-btn inline', type: 'button', text: 'Open that one instead', onclick: () => openInstead(opts.sameAs) })));
  }
  sheet.body.append(notices, photoBox, form);
  sheet.foot.append(button('Cancel', { onclick: () => sheet.requestClose() }), saveBtn);
  // Photos pasted anywhere in the sheet (text pastes into fields work as usual).
  sheet.el.addEventListener('paste', (e) => {
    const file = imageFrom(e.clipboardData && e.clipboardData.files);
    if (file) {
      e.preventDefault();
      handleFile(file);
    }
  });
  // A photo dropped anywhere on the sheet shouldn't make the browser open the file instead.
  sheet.el.addEventListener('dragover', (e) => e.preventDefault());
  sheet.el.addEventListener('drop', (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const file = imageFrom(e.dataTransfer.files);
    if (file) handleFile(file);
  });

  /* ── fill in, restoring unsaved edits from this device ── */
  write(opts.prefill ? { ...base, ...opts.prefill } : base); // prefilled (grabbed) counts as unsaved: only Save adds it
  const draft = opts.prefill ? null : local.get(draftKey(itemId));
  if (draft && draft.values && Date.now() - draft.at < DRAFT_DAYS * 86400000 && sig(trimmed({ ...base, ...draft.values })) !== sig(trimmed(base))) {
    write({ ...base, ...draft.values, status: base.status === 'claimed' ? 'claimed' : draft.values.status || base.status });
    const restored = note('info', `Restored your unsaved edits from ${when(new Date(draft.at).toISOString())}. `,
      h('button', {
        class: 'link-btn inline', type: 'button', text: 'Throw them away',
        onclick: () => {
          write(base);
          dropDraft();
          restored.remove();
        },
      }));
    notices.prepend(restored);
  } else if (draft) {
    local.remove(draftKey(itemId));
  }
  renderPhoto(true);
  renderStatus();
  syncMissing();

  // Changes from elsewhere (photo saved, claimed, edited on another device) show up here.
  const stop = subscribe((s) => {
    if (!itemId || gone) return;
    const current = s.items.find((i) => i.id === itemId);
    if (!current) {
      gone = true;
      dropDraft();
      notices.prepend(note('error', 'This item was deleted, maybe on another device. Nothing to save here anymore.'));
      saveBtn.disabled = true;
      renderPhoto(true);
      return;
    }
    const fresh = valuesOf(current, s);
    if (sig(fresh) !== sig(base)) {
      const untouched = !isDirty();
      base = fresh;
      if (untouched) write(base); // nothing typed here: follow the server
    }
    if (!photoBusy) renderPhoto();
    renderStatus();
    syncMissing();
    syncOut(); // clicks, and where the saved links lead now
  });
  sheet.onClosed = () => {
    stop();
    saveDraft.cancel();
    detectOut.cancel();
    if (openEditor && openEditor.sheet === sheet) openEditor = null;
    rememberOpen(null);
  };

  /** Swaps this (unsaved) editor for the item that's already on the list, once this one has closed. */
  async function openInstead(otherId) {
    const closed = sheet.onClosed;
    sheet.onClosed = () => {
      closed();
      openItemEditor(otherId);
    };
    await sheet.requestClose();
    if (!sheet.closed) sheet.onClosed = closed;
  }

  openEditor = { id: itemId, sheet, isDirty: () => !gone && isDirty() };
  rememberOpen(itemId);
  const focusTarget = opts.focus === 'price' ? price.input : opts.focus === 'name' || !itemId ? name : null;
  sheet.open({ focus: focusTarget });
  if (opts.focus === 'price') requestAnimationFrame(() => focusField(price.input));
  if (opts.focus === 'photo') requestAnimationFrame(() => photoBox.scrollIntoView({ block: 'center' }));
  return sheet;
}

/** Keeps "#<tab>/<item id>" in the address bar while an item is open, so a reload reopens it. */
function rememberOpen(id) {
  const tab = location.hash.slice(1).split('/')[0] || 'today';
  const target = id ? `#${tab}/${id}` : `#${tab}`;
  if (location.hash !== target) history.replaceState(null, '', target);
}

/* ───────────────────────── claiming ───────────────────────── */

export function openClaimSheet(id) {
  const s = store.state;
  const item = s.items.find((i) => i.id === id);
  if (!item || item.status !== 'wishing') return;
  const vault = s.stats.balance;
  const amount = moneyInput({ value: amountInput(item.priceBase), label: 'Amount paid from the vault' });
  const after = h('p', { class: 'claim-after' });
  const warn = h('div', { 'aria-live': 'polite' });
  const error = h('p', { class: 'msg error', role: 'alert', hidden: true });
  const submit = button('Claim it', { kind: 'primary', type: 'submit', iconName: 'sparkle' });
  const base = s.settings.baseCurrency;
  const value = () => parseAmount(amount.input.value);

  const update = () => {
    const v = value() || 0;
    const left = vault - v;
    after.replaceChildren('Vault after: ', h('strong', { class: ['mono', left < 0 ? 'is-out' : 'is-in'], text: balance(left) }));
    if (v > vault) {
      warn.replaceChildren(note('warn', `You’re ${money(v - vault)} short. Claim anyway and go into debt?`));
      submit.querySelector('.btn-label').textContent = 'Claim anyway';
    } else {
      warn.replaceChildren();
      submit.querySelector('.btn-label').textContent = 'Claim it';
    }
  };
  amount.input.addEventListener('input', update);
  const form = h('form', { class: 'stack', novalidate: true, id: `claim-${item.id}` },
    h('div', { class: 'claim-item' }, thumb(item, 'md'),
      h('div', null,
        item.brand && h('p', { class: 'item-brand', text: item.brand }),
        h('p', { class: 'claim-name', text: item.name }),
        h('p', { class: 'mono muted', text: item.currency !== base ? `${money(item.price, item.currency)} ≈ ${money(item.priceBase)}` : money(item.price, item.currency) }))),
    field({ label: `Paid from the vault (${base})`, control: amount.wrap, hint: 'What it actually cost you. Starts at the list price.' }),
    after, warn, error);
  form.querySelector('.field-label').htmlFor = amount.input.id;
  submit.setAttribute('form', form.id);
  const sheet = new Sheet({ title: 'Claim it', eyebrow: 'Treat time', size: 'sm' });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = value();
    if (v === null) {
      error.textContent = 'Type what it cost, like 590 or 1287.50.';
      error.hidden = false;
      return;
    }
    const inDebt = v > vault;
    await busy(submit, async () => {
      try {
        await api('item.claim', { id: item.id, amount: v });
        sheet.close();
        toast(inDebt ? 'Claimed on credit. Now work it off.' : 'Claimed. You earned the damn thing.', {
          tone: 'gold', detail: `${item.brand ? `${item.brand} ` : ''}${item.name} · −${money(v)}`,
          action: async () => {
            try {
              await api('item.unclaim', { id: item.id });
              toast('Unclaimed. Back on the list.');
            } catch (err) {
              toastError(err);
            }
          },
        });
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    });
  });
  update();
  sheet.body.append(form);
  sheet.foot.append(button('Not yet', { onclick: () => sheet.requestClose() }), submit);
  sheet.open();
}

export async function unclaimItem(id) {
  const item = store.state.items.find((i) => i.id === id);
  if (!item) return;
  const ok = await confirmSheet({
    title: 'Put it back on the list?',
    message: `The purchase receipt is removed and ${money(item.claimedAmount || item.priceBase)} goes back into the vault.`,
    confirmLabel: 'Unclaim it',
  });
  if (!ok) return;
  try {
    await api('item.unclaim', { id });
    toast('Back on the list. The vault got its money back.');
  } catch (e) {
    toastError(e);
  }
}
