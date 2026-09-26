/*
 * FINDOM YOURSELF · Control Room: the List tab. Paste a product link (the main event), paste
 * a whole list, filter and search, and the wishlist itself in display order: drag the grip
 * (mouse or finger) or use the arrow buttons/keys to reorder.
 */
import {
  h, icon, swap, sig, local, money, plural, fold, hostOf, extractUrl, allUrls, reducedMotion,
} from './core.js';
import { api, store } from './api.js';
import { toast, toastError, button, note, thumb, sheetIsOpen } from './ui.js';
import { openItemEditor } from './item.js';
import { openBulkImport, fetchPhotos, missingPhotos } from './bulk.js';

const FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'wishing', label: 'Wishing', test: (i) => i.status === 'wishing' },
  { key: 'unlocked', label: 'Unlocked', test: (i) => i.affordable },
  { key: 'claimed', label: 'Claimed', test: (i) => i.status === 'claimed' },
  { key: 'archived', label: 'Archived', test: (i) => i.status === 'archived' },
];
const SLOW_STEPS = [
  [0, 'Fetching the shop page…'],
  [6000, 'Still talking to the shop. Some are slow…'],
  [14000, 'Almost there. If the shop won’t talk, I’ll add it from the link anyway.'],
];

export function createList() {
  let filter = FILTERS.some((f) => f.key === local.get('list-filter')) ? local.get('list-filter') : 'all';
  let query = '';
  let arranging = false;
  let dragging = null;
  let lastSig = '';

  /* ───── paste a link ───── */

  const linkInput = h('input', {
    class: 'input input-lg', type: 'url', inputmode: 'url', id: 'paste-link', placeholder: 'https://www.farfetch.com/…',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go',
  });
  const canReadClipboard = !!(navigator.clipboard && navigator.clipboard.readText);
  const pasteBtn = canReadClipboard ? button('Paste', { iconName: 'paste', className: 'paste-btn' }) : null;
  const addBtn = button('Add', { kind: 'primary', type: 'submit', iconName: 'plus', className: 'add-btn' });
  const status = h('div', { class: 'paste-status', 'aria-live': 'polite' });
  const offer = h('div', { class: 'paste-offer', hidden: true });
  const pasteForm = h('form', { class: 'card paste-card', novalidate: true },
    h('label', { class: 'paste-label', for: 'paste-link' },
      h('span', { class: 'card-label', text: 'Add to the list' }),
      h('span', { class: 'paste-title' }, 'Paste a product ', h('em', { text: 'link' }))),
    h('div', { class: 'paste-row' }, linkInput, h('div', { class: 'paste-buttons' }, pasteBtn, addBtn)),
    status,
    offer,
    h('div', { class: 'paste-more' },
      moreRow('list', 'Paste a whole list', 'From ChatGPT, Gemini, Notes or a spreadsheet', () => openBulkImport()),
      moreRow('pencil', 'Add by hand', 'No link? Type it in yourself', () => openItemEditor(null))));

  function moreRow(iconName, title, hint, onclick) {
    return h('button', { class: 'more-row', type: 'button', onclick },
      h('span', { class: 'more-icon' }, icon(iconName)),
      h('span', { class: 'more-text' }, h('span', { class: 'more-title', text: title }), h('span', { class: 'more-hint', text: hint })),
      icon('next'));
  }

  let adding = false;
  async function addLink(raw) {
    if (adding) return;
    const url = extractUrl(raw);
    if (!url) {
      status.replaceChildren(note('error', 'That doesn’t look like a link. Copy the whole address from the shop, starting with https://'));
      linkInput.focus();
      return;
    }
    adding = true;
    linkInput.value = url;
    linkInput.readOnly = true;
    addBtn.disabled = true;
    addBtn.classList.add('is-busy');
    if (pasteBtn) pasteBtn.disabled = true;
    offer.hidden = true;
    const text = h('span');
    status.replaceChildren(h('div', { class: 'fetching' }, h('span', { class: 'spinner' }), text));
    const timers = SLOW_STEPS.map(([ms, message]) => setTimeout(() => { text.textContent = message; }, ms));
    try {
      const res = await api('item.fromLink', { url });
      linkInput.value = '';
      status.replaceChildren();
      openItemEditor(res.itemId, { warnings: res.warnings || [], duplicate: !!res.duplicate, fromLink: true });
      if (!res.duplicate && !(res.warnings || []).length) toast('Added to the list. Now go earn it.', { tone: 'gold' }); // otherwise the editor explains
    } catch (e) {
      status.replaceChildren(note('error', e.message));
    } finally {
      timers.forEach(clearTimeout);
      adding = false;
      linkInput.readOnly = false;
      addBtn.disabled = false;
      addBtn.classList.remove('is-busy');
      if (pasteBtn) pasteBtn.disabled = false;
    }
  }

  pasteForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!linkInput.value.trim()) {
      status.replaceChildren(note('info', 'Paste a link from any shop: Farfetch, SSENSE, the brand’s own site…'));
      linkInput.focus();
      return;
    }
    addLink(linkInput.value);
  });
  linkInput.addEventListener('input', () => {
    if (status.firstChild && !adding) status.replaceChildren();
  });
  // Pasting a whole list into the link box: offer the list importer instead.
  linkInput.addEventListener('paste', (e) => {
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (text.split('\n').filter((l) => l.trim()).length > 1) {
      e.preventDefault();
      showOffer('list', text);
    }
  });
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text.split('\n').filter((l) => l.trim()).length > 1) {
          showOffer('list', text);
          return;
        }
        const url = extractUrl(text);
        if (!url) {
          status.replaceChildren(note('info', 'No link on the clipboard. Copy one from the shop first.'));
          return;
        }
        linkInput.value = url;
        addLink(url);
      } catch (e) {
        status.replaceChildren(note('info', 'The browser wouldn’t share the clipboard. Long-press the box and choose Paste.'));
        linkInput.focus();
      }
    });
  }

  /** "Add this link?" / "Read this as a list?" after a paste outside the box. */
  function showOffer(kind, payload) {
    const dismiss = h('button', { class: 'link-btn', type: 'button', text: 'No thanks', onclick: () => { offer.hidden = true; } });
    if (kind === 'link') {
      offer.replaceChildren(icon('link'),
        h('p', null, 'Add this link? ', h('span', { class: 'muted', text: `${hostOf(payload)}${new URL(payload).pathname.slice(0, 40)}…` })),
        h('div', { class: 'offer-actions' }, button('Add it', { kind: 'primary', size: 'sm', onclick: () => addLink(payload) }), dismiss));
    } else {
      const links = allUrls(payload).length;
      offer.replaceChildren(icon('list'),
        h('p', null, 'That looks like a whole list', h('span', { class: 'muted', text: links ? ` (${plural(links, 'link')}).` : '.' })),
        h('div', { class: 'offer-actions' }, button('Read the list', { kind: 'primary', size: 'sm', onclick: () => { offer.hidden = true; openBulkImport(payload); } }), dismiss));
    }
    offer.hidden = false;
  }

  // A link pasted anywhere on this tab (not into another box) is offered for adding.
  document.addEventListener('paste', (e) => {
    if (el.hidden || sheetIsOpen() || adding) return;
    const target = e.target;
    if (target && target.closest && target.closest('input, textarea, select, [contenteditable]')) return;
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (!text.trim()) return;
    const lines = text.split('\n').filter((l) => l.trim()).length;
    if (lines > 1 && (allUrls(text).length > 1 || lines > 2)) {
      e.preventDefault();
      showOffer('list', text);
      pasteForm.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    } else if (extractUrl(text)) {
      e.preventDefault();
      showOffer('link', extractUrl(text));
      pasteForm.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  });

  /* ───── filters, search, tools ───── */

  const chips = h('div', { class: 'chips filter-chips', role: 'group', 'aria-label': 'Show' });
  const search = h('input', { class: 'input input-search', type: 'search', placeholder: 'Search the list', 'aria-label': 'Search the list', autocomplete: 'off', enterkeyhint: 'search' });
  search.addEventListener('input', () => {
    query = search.value;
    renderList(store.state);
  });
  const photosBtn = button('Fetch missing photos', { size: 'sm', iconName: 'image', onclick: () => fetchPhotos({ title: 'Fetching missing photos' }) });
  const arrangeBtn = button('Arrange', { size: 'sm', iconName: 'arrange', className: 'arrange-btn', 'aria-pressed': 'false' });
  arrangeBtn.addEventListener('click', () => {
    arranging = !arranging;
    arrangeBtn.setAttribute('aria-pressed', String(arranging));
    listWrap.classList.toggle('is-arranging', arranging);
  });
  const toolbar = h('div', { class: 'list-toolbar' },
    chips,
    h('div', { class: 'list-tools' }, h('div', { class: 'search-wrap' }, icon('search'), search), photosBtn, arrangeBtn));

  const listWrap = h('div', { class: 'list-wrap' });
  const live = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const subtitle = h('p', { class: 'view-sub' });
  const el = h('section', { class: 'view view-list', id: 'view-list', 'aria-labelledby': 'list-title', hidden: true },
    h('header', { class: 'view-head' },
      h('p', { class: 'eyebrow', text: 'Wishlist' }),
      h('h1', { class: 'view-title', id: 'list-title' }, 'The ', h('em', { text: 'list' })),
      subtitle),
    h('div', { class: 'list-layout' },
      h('div', { class: 'list-side' }, pasteForm),
      h('div', { class: 'list-main' }, toolbar, listWrap)),
    live);

  const visible = (s) => {
    const f = FILTERS.find((x) => x.key === filter) || FILTERS[0];
    const q = fold(query.trim());
    return s.items.filter((i) => f.test(i) && (!q || fold([i.name, i.brand, i.variant, i.category, i.note, hostOf(i.url)].join(' ')).includes(q)));
  };

  function renderChips(s) {
    swap(chips, FILTERS.map((f) => {
      const count = s.items.filter(f.test).length;
      return h('button', {
        class: ['chip', f.key === 'unlocked' && count && 'chip-hot'], type: 'button', 'aria-pressed': String(filter === f.key), dataset: { key: `filter:${f.key}` },
        onclick: () => {
          filter = f.key;
          local.set('list-filter', filter);
          renderChips(store.state);
          renderList(store.state);
        },
      }, f.label, h('span', { class: 'chip-count', text: String(count) }));
    }));
  }

  /* ───── the rows ───── */

  function row(item, index, total, s) {
    const base = s.settings.baseCurrency;
    const badges = [];
    if (s.goalId === item.id) badges.push(['goal', s.settings.goalId === item.id ? 'Goal · pinned' : 'Goal']);
    if (item.affordable) badges.push(['unlocked', 'Unlocked']);
    if (item.status === 'claimed') badges.push(['claimed', 'Claimed']);
    if (item.status === 'archived') badges.push(['archived', 'Archived']);
    if (!item.image && !item.imageSource) badges.push(['warn', 'No photo']);
    else if (!item.image) badges.push(['muted', 'Linked photo']);
    if (item.priceMissing) badges.push(['warn', 'No price']);
    if (item.priority === 3) badges.push(['hot', 'Obsessed']);
    const label = [item.brand, item.name].filter(Boolean).join(' ');
    const li = h('li', { class: ['item-row', `is-${item.status}`, item.affordable && 'is-unlocked'], dataset: { id: item.id } });
    const grip = h('button', {
      class: 'grip', type: 'button', dataset: { key: `grip:${item.id}` },
      'aria-label': `Move ${label} (position ${index + 1} of ${total}). Drag, or use the arrow keys.`,
    }, icon('grip'));
    grip.addEventListener('pointerdown', (e) => startDrag(e, li, grip));
    grip.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        move(item.id, e.key === 'ArrowUp' ? -1 : 1);
      }
    });
    const showProgress = item.status === 'wishing' && !item.priceMissing;
    li.append(
      grip,
      h('button', { class: 'item-main', type: 'button', dataset: { key: `open:${item.id}` }, onclick: () => openItemEditor(item.id) },
        thumb(item),
        h('span', { class: 'item-text' },
          item.brand && h('span', { class: 'item-brand', text: item.brand }),
          h('span', { class: 'item-name', text: item.name }),
          item.variant && h('span', { class: 'item-variant', text: item.variant })),
        h('span', { class: 'item-money' },
          h('span', { class: 'item-price mono' },
            item.priceMissing ? h('span', { class: 'muted', text: 'No price yet' }) : money(item.price, item.currency),
            !item.priceMissing && item.currency !== base && h('span', { class: 'muted', text: ` ≈ ${money(item.priceBase)}` }),
            item.status === 'claimed' && item.claimedAmount !== null && Math.abs(item.claimedAmount - item.priceBase) >= 0.01 && h('span', { class: 'muted', text: ` · paid ${money(item.claimedAmount)}` })),
          showProgress && h('span', { class: ['mini-progress', item.affordable && 'is-full'], 'aria-hidden': 'true' },
            h('span', { style: { width: `${Math.round(item.progress * 100)}%` } }))),
        badges.length ? h('span', { class: 'badges' }, badges.map(([kind, text]) => h('span', { class: `badge badge-${kind}`, text }))) : null),
      h('div', { class: 'order-btns' },
        h('button', {
          class: 'icon-btn order-btn', type: 'button', 'aria-label': `Move ${label} up`, dataset: { key: `up:${item.id}` },
          'aria-disabled': index === 0 ? 'true' : null, onclick: () => move(item.id, -1),
        }, icon('up')),
        h('button', {
          class: 'icon-btn order-btn', type: 'button', 'aria-label': `Move ${label} down`, dataset: { key: `down:${item.id}` },
          'aria-disabled': index === total - 1 ? 'true' : null, onclick: () => move(item.id, 1),
        }, icon('down'))));
    return li;
  }

  function renderList(s, force = false) {
    if (dragging) return; // the list is re-drawn when the drag ends
    const items = visible(s);
    const next = sig(items, filter, query, s.goalId, s.settings.goalId, s.settings.baseCurrency);
    if (!force && next === lastSig) return;
    lastSig = next;
    if (!s.items.length) {
      swap(listWrap, h('div', { class: 'empty-state big' },
        h('p', { class: 'empty-line', text: 'Nothing on the list. Suspicious.' }),
        h('p', { class: 'muted', text: 'Paste a product link above, or a whole list from your notes.' })));
      return;
    }
    if (!items.length) {
      swap(listWrap, h('div', { class: 'empty-state' },
        h('p', { class: 'empty-line', text: query ? `Nothing matches “${query}”.` : `Nothing ${FILTERS.find((f) => f.key === filter).label.toLowerCase()} right now.` }),
        button('Show everything', { size: 'sm', dataset: { key: 'show-all' }, onclick: () => {
          filter = 'all';
          query = '';
          search.value = '';
          local.set('list-filter', filter);
          renderChips(store.state);
          renderList(store.state);
        } })));
      return;
    }
    swap(listWrap, h('ol', { class: 'items', 'aria-label': 'Wishlist items, in display order' }, items.map((item, i) => row(item, i, items.length, s))));
  }

  /* ───── reordering ───── */

  /** Sends the new order. The visible items trade places among the slots they already hold. */
  async function commitOrder(visibleIds) {
    const all = store.state.items.map((i) => i.id);
    const shown = new Set(visibleIds);
    const slots = [];
    all.forEach((id, index) => { if (shown.has(id)) slots.push(index); });
    const next = all.slice();
    slots.forEach((slot, k) => { next[slot] = visibleIds[k]; });
    if (next.join() === all.join()) return;
    try {
      await api('items.reorder', { ids: next });
    } catch (e) {
      toastError(e);
      renderList(store.state, true);
    }
  }

  function move(id, delta) {
    const ids = visible(store.state).map((i) => i.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    const list = listWrap.querySelector('.items');
    const li = list && list.querySelector(`[data-id="${CSS.escape(id)}"]`);
    const other = list && list.querySelector(`[data-id="${CSS.escape(ids[from])}"]`);
    if (li && other) {
      const focused = document.activeElement;
      if (delta < 0) other.before(li);
      else other.after(li);
      if (focused && li.contains(focused)) focused.focus({ preventScroll: false });
    }
    const item = store.state.items.find((i) => i.id === id);
    live.textContent = `${item ? item.name : 'Item'} moved to position ${to + 1} of ${ids.length}.`;
    commitOrder(ids);
  }

  function startDrag(e, li, grip) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const list = li.parentElement;
    if (!list || dragging) return;
    e.preventDefault();
    try {
      grip.setPointerCapture(e.pointerId);
    } catch (err) { /* pointer already gone */ }
    const rect = li.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const placeholder = h('li', { class: 'item-placeholder', 'aria-hidden': 'true', style: { height: `${rect.height}px` } });
    li.after(placeholder);
    li.classList.add('is-dragging');
    Object.assign(li.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, zIndex: '60' });
    const before = Array.from(list.querySelectorAll('.item-row')).map((n) => n.dataset.id);
    dragging = { y: e.clientY };
    let frame = 0;

    const place = () => {
      const y = dragging.y;
      li.style.top = `${y - offsetY}px`;
      let target = null;
      for (const sib of list.children) {
        if (sib === li || sib === placeholder) continue;
        const r = sib.getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          target = sib;
          break;
        }
      }
      if (target) {
        if (placeholder.nextSibling !== target) list.insertBefore(placeholder, target);
      } else if (list.lastElementChild !== placeholder) {
        list.append(placeholder);
      }
    };
    // Near the top bar or the tab bar: scroll the page along, faster the closer the finger gets.
    const topbar = document.querySelector('.topbar');
    const tabbar = document.querySelector('.tabbar');
    const top = (topbar ? topbar.getBoundingClientRect().bottom : 0) + 56;
    const bottom = (tabbar && tabbar.offsetParent !== null ? tabbar.getBoundingClientRect().top : window.innerHeight) - 56;
    const scrollLoop = () => {
      if (!dragging) return;
      const y = dragging.y;
      const speed = y < top ? -Math.min(14, (top - y) / 5) : y > bottom ? Math.min(14, (y - bottom) / 5) : 0;
      if (speed) {
        window.scrollBy(0, speed);
        place();
      }
      frame = requestAnimationFrame(scrollLoop);
    };
    const onMove = (ev) => {
      dragging.y = ev.clientY;
      place();
    };
    const onEnd = () => {
      cancelAnimationFrame(frame);
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onEnd);
      grip.removeEventListener('pointercancel', onEnd);
      li.classList.remove('is-dragging');
      for (const prop of ['position', 'left', 'top', 'width', 'zIndex']) li.style[prop] = '';
      placeholder.replaceWith(li);
      dragging = null;
      const after = Array.from(list.querySelectorAll('.item-row')).map((n) => n.dataset.id);
      grip.focus({ preventScroll: true });
      if (after.join() !== before.join()) {
        const item = store.state.items.find((i) => i.id === li.dataset.id);
        live.textContent = `${item ? item.name : 'Item'} moved to position ${after.indexOf(li.dataset.id) + 1} of ${after.length}.`;
        commitOrder(after);
      } else {
        renderList(store.state);
      }
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onEnd);
    grip.addEventListener('pointercancel', onEnd);
    frame = requestAnimationFrame(scrollLoop);
  }

  /* ───── putting it together ───── */

  function update(s) {
    const wishing = s.items.filter((i) => i.status === 'wishing');
    const worth = wishing.reduce((sum, i) => sum + i.priceBase, 0);
    subtitle.textContent = wishing.length ? `${plural(wishing.length, 'wish', 'wishes')} worth ${money(worth)} in all.` : 'Empty. For now.';
    renderChips(s);
    const missing = missingPhotos(s).length;
    photosBtn.hidden = !missing;
    photosBtn.querySelector('.btn-label').textContent = `Fetch photos (${missing})`;
    photosBtn.title = `Fetch the missing photos of ${plural(missing, 'item')} from their shop links`;
    arrangeBtn.hidden = s.items.length < 2;
    renderList(s);
  }

  return {
    el, update, title: 'List',
    focusPaste: () => linkInput.focus(),
  };
}
