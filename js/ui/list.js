/*
 * The wishlist grid. Cards are keyed by item id and updated in place, so the live
 * polling never makes the grid flicker. Locked photos stay in full view, chained up,
 * with a padlock whose ring fills as the vault does; the chains snap off on unlock.
 */
import { $, el, clear } from '../lib/dom.js';
import { getState, subscribe } from '../lib/state.js';
import { money, hours } from '../lib/format.js';
import { isTouch, prefersReducedMotion } from '../lib/motion.js';
import { openItem } from './modal.js';
import { chainOverlay, carryChains, patchChains } from './chains.js';

const FILTERS = [
  ['wishing', 'On the list'],
  ['unlocked', 'Unlocked'],
  ['locked', 'Still locked'],
  ['claimed', 'Claimed'],
];
const view = { filter: 'wishing', category: '', sort: 'closest' };
const nodes = new Map();
const photos = new WeakMap(); // card → what its photo area shows (image, state), to tell a new photo from new numbers
let visibleIds = [];
// Cards in or near the viewport: only their rings slide on a live update. Each ring that
// animates restyles every frame, so fifty of them sliding off screen would cost for nothing.
const onScreen = new Set();
const viewObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) onScreen[entry.isIntersecting ? 'add' : 'delete'](entry.target.dataset.id);
}, { rootMargin: '25% 0px' });

export const listOrder = () => visibleIds;

export function initList() {
  const grid = $('#grid');
  try { Object.assign(view, JSON.parse(sessionStorage.getItem('findom:list') || '{}')); } catch { /* ignore */ }
  const sortSelect = $('#sort');
  sortSelect.value = view.sort;
  sortSelect.addEventListener('change', () => { view.sort = sortSelect.value; save(); render(getState()); });

  grid.addEventListener('click', (e) => {
    const hit = e.target.closest('.card__hit');
    if (hit) openItem(hit.closest('.card').dataset.id);
  });
  if (!isTouch() && !prefersReducedMotion()) tilt(grid);

  render(getState());
  subscribe((s) => render(s));
}

function save() {
  try { sessionStorage.setItem('findom:list', JSON.stringify(view)); } catch { /* ignore */ }
}

function statusOf(item) {
  if (item.status === 'claimed') return 'claimed';
  if (item.affordable) return 'unlocked';
  if (item.priceMissing) return 'unpriced';
  return 'locked';
}

function matches(item, filter) {
  const st = statusOf(item);
  if (filter === 'wishing') return item.status === 'wishing';
  if (filter === 'unlocked') return st === 'unlocked';
  if (filter === 'locked') return st === 'locked' || st === 'unpriced';
  return st === 'claimed';
}

function sorted(items, sort) {
  const price = (i) => (i.priceBase ?? (i.priceMissing ? Infinity : i.price ?? 0));
  const list = [...items];
  if (sort === 'price-asc') list.sort((a, b) => price(a) - price(b));
  else if (sort === 'price-desc') list.sort((a, b) => (price(b) === Infinity ? -1 : price(b)) - (price(a) === Infinity ? -1 : price(a)));
  else if (sort === 'closest') list.sort((a, b) => (Number(b.affordable) - Number(a.affordable)) || (b.progress - a.progress) || (price(a) - price(b)));
  return list;
}

function render(s) {
  renderFilters(s);
  const grid = $('#grid');
  const inFilter = s.items.filter((i) => matches(i, view.filter));
  const shown = sorted(inFilter.filter((i) => !view.category || i.category === view.category), view.sort);
  visibleIds = shown.map((i) => i.id);

  const focusedId = grid.contains(document.activeElement) ? document.activeElement.closest('.card')?.dataset.id : null;
  const keep = new Set(visibleIds);
  for (const [id, node] of nodes) {
    if (!keep.has(id)) { node.remove(); nodes.delete(id); viewObserver.unobserve(node); onScreen.delete(id); }
  }
  let cursor = grid.firstElementChild; // where the next card belongs
  shown.forEach((item, index) => {
    const signature = JSON.stringify([item, index, s.settings.baseCurrency]);
    let node = nodes.get(item.id);
    if (!node) {
      node = card(item, index, s);
      node.dataset.sig = signature;
      nodes.set(item.id, node);
      viewObserver.observe(node);
      enter(node);
    } else if (node.dataset.sig !== signature && photos.get(node) === photoKey(item)) {
      patch(node, card(item, index, s), item, onScreen.has(item.id)); // new numbers only: no need to rebuild the photo
      node.dataset.sig = signature;
    } else if (node.dataset.sig !== signature) {
      const fresh = card(item, index, s);
      fresh.className = node.className;
      fresh.dataset.sig = signature;
      carryChains(node, fresh, { slide: onScreen.has(item.id) }); // the ring slides to its new value; fresh unlocks snap their chains
      if (node.classList.contains('is-entering')) { // not scrolled into view yet: watch the replacement instead
        enterObserver.unobserve(node);
        enterObserver.observe(fresh);
      }
      viewObserver.unobserve(node);
      viewObserver.observe(fresh);
      node.replaceWith(fresh);
      if (cursor === node) cursor = fresh;
      nodes.set(item.id, fresh);
      node = fresh;
    }
    // Keep DOM order in sync with the sort, moving only the cards that change place: a move
    // re-inserts the card, which restyles its whole subtree (chains included) for nothing.
    if (node === cursor) cursor = node.nextElementSibling;
    else grid.insertBefore(node, cursor);
  });
  // a rebuilt or moved card drops keyboard focus: keyboard users keep their place
  if (focusedId && !grid.contains(document.activeElement)) nodes.get(focusedId)?.querySelector('.card__hit').focus({ preventScroll: true });

  const empty = $('#list-empty');
  empty.hidden = shown.length > 0;
  empty.textContent = view.filter === 'unlocked' ? 'Nothing unlocked yet. Go earn something.'
    : view.filter === 'claimed' ? 'Nothing claimed yet. The trophy wall is waiting.'
      : 'Nothing here. Suspicious.';
  const eyebrow = $('#list-eyebrow');
  eyebrow.textContent = `${s.wishing.length} ${s.wishing.length === 1 ? 'obsession' : 'obsessions'} · ${s.unlocked.length} unlocked`;
}

function renderFilters(s) {
  const counts = Object.fromEntries(FILTERS.map(([key]) => [key, s.items.filter((i) => matches(i, key)).length]));
  const box = $('#filters');
  clear(box).append(...FILTERS.map(([key, label]) => el('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(view.filter === key),
    on: { click: () => { view.filter = key; view.category = ''; save(); render(getState()); } },
  }, label, el('span', { class: 'n', text: String(counts[key]) }))));

  const cats = [...new Set(s.items.filter((i) => matches(i, view.filter)).map((i) => i.category).filter(Boolean))];
  const catBox = $('#categories');
  if (view.category && !cats.includes(view.category)) view.category = '';
  catBox.hidden = cats.length < 2;
  clear(catBox);
  if (cats.length >= 2) {
    catBox.append(...[['', 'Everything'], ...cats.map((c) => [c, c])].map(([value, label]) => el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(view.category === value),
      on: { click: () => { view.category = value; save(); render(getState()); } },
    }, label)));
  }
}

function card(item, index, s) {
  const base = s.settings.baseCurrency;
  const status = statusOf(item);
  const media = el('div', { class: 'card__media' });
  if (item.image) {
    const img = el('img', { src: item.image, alt: '', loading: index < 8 ? 'eager' : 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(placeholder(item)), { once: true });
    media.append(img);
  } else {
    media.append(placeholder(item));
  }
  if (status === 'locked' || status === 'unpriced') media.append(chainOverlay({ progress: item.progress, unpriced: status === 'unpriced' }));
  media.append(el('span', { class: 'card__corner card__corner--l', text: `No. ${String(index + 1).padStart(2, '0')}` }));
  if (status === 'unlocked') media.append(el('span', { class: 'card__stamp', text: 'Unlocked' }));
  media.append(el('span', { class: 'card__glare', 'aria-hidden': 'true' }));

  const converted = item.priceBase !== null && item.currency !== base;
  const price = item.priceMissing ? el('span', { class: 'card__price', text: 'Price TBD' })
    : el('span', { class: 'card__price' }, item.priceBase === null ? '•••' : money(item.priceBase, base), converted ? el('small', { text: money(item.price, item.currency) }) : null);
  const hoursText = status === 'claimed' ? 'Claimed ✓' : status === 'unlocked' ? 'Paid for' : status === 'unpriced' ? '—' : `${hours(item.hoursToGo)} to go`;
  const label = `${item.title}. ${status === 'locked' ? `${Math.floor(item.progress * 100)}% earned, ${hours(item.hoursToGo)} of work to go` : status}.`;

  const node = el('li', { class: 'card', data: { id: item.id, status, priority: String(item.priority) } },
    el('div', { class: 'card__inner' },
      media,
      el('div', { class: 'card__body' },
        el('p', { class: 'card__brand', text: item.brand || item.store || ' ' }),
        el('h3', { class: 'card__name', text: item.name }),
        item.variant ? el('p', { class: 'card__variant', text: item.variant }) : null,
        el('div', { class: 'card__foot' }, price, el('span', { class: 'card__hours', text: hoursText })),
        el('div', { class: 'bar card__bar', style: { '--p': status === 'unpriced' ? 0 : item.progress } }, el('span')),
      ),
    ),
    el('button', { class: 'card__hit', type: 'button', 'aria-label': label, 'data-cursor': 'View' }),
  );
  photos.set(node, photoKey(item));
  return node;
}

const photoKey = (item) => JSON.stringify([item.image, statusOf(item), item.brand || item.store || item.name]);

/**
 * A live update that only changes numbers: the text and label are swapped in, and the
 * ring (and, on screen, the bar under it) slide to the new value, while the photo, its
 * chains and any keyboard focus stay exactly where they are.
 */
function patch(node, fresh, item, slide) {
  node.dataset.priority = fresh.dataset.priority;
  node.querySelector('.card__corner--l').textContent = fresh.querySelector('.card__corner--l').textContent;
  node.querySelector('.card__hit').setAttribute('aria-label', fresh.querySelector('.card__hit').getAttribute('aria-label'));
  const body = node.querySelector('.card__body');
  const next = fresh.querySelector('.card__body');
  if (slide) { // the bar stays, so its width transitions along with the ring
    const bar = body.querySelector('.card__bar');
    const nextBar = next.querySelector('.card__bar');
    for (const child of [...body.children]) if (child !== bar) child.remove();
    for (const child of [...next.children]) if (child !== nextBar) body.insertBefore(child, bar);
    bar.style.setProperty('--p', nextBar.style.getPropertyValue('--p'));
  } else {
    body.replaceWith(next);
  }
  patchChains(node.querySelector('.card__media'), { progress: item.progress, unpriced: statusOf(item) === 'unpriced' }, { slide });
}

function placeholder(item) {
  const brand = item.brand || item.store || item.name;
  return el('div', { class: 'card__ph', 'aria-hidden': 'true' },
    el('span', { class: 'initial', text: brand.charAt(0) }),
    el('span', { class: 'brand', text: brand }),
  );
}

const enterObserver = new IntersectionObserver((entries) => {
  let delay = 0;
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const node = entry.target;
    node.style.setProperty('--d', `${delay}s`);
    delay += 0.07;
    node.classList.remove('is-entering');
    node.classList.add('is-shown');
    enterObserver.unobserve(node);
  }
}, { rootMargin: '0px 0px -8% 0px' });

function enter(node) {
  if (prefersReducedMotion()) return;
  node.classList.add('is-entering');
  enterObserver.observe(node);
}

/** Cards lean toward the pointer and catch a glare. */
function tilt(grid) {
  let active = null;
  let frame = 0;
  let last = null;
  grid.addEventListener('pointermove', (e) => {
    last = e;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const cardNode = last.target.closest('.card');
      if (active && active !== cardNode) reset(active);
      active = cardNode;
      if (!cardNode) return;
      const r = cardNode.getBoundingClientRect();
      const x = (last.clientX - r.left) / r.width;
      const y = (last.clientY - r.top) / r.height;
      const inner = cardNode.querySelector('.card__inner');
      inner.style.setProperty('--ry', `${(x - 0.5) * 10}deg`);
      inner.style.setProperty('--rx', `${(0.5 - y) * 8}deg`);
      cardNode.style.setProperty('--gx', `${x * 100}%`);
      cardNode.style.setProperty('--gy', `${y * 100}%`);
    });
  });
  grid.addEventListener('pointerleave', () => { if (active) reset(active); active = null; });
  function reset(node) {
    const inner = node.querySelector('.card__inner');
    inner?.style.setProperty('--ry', '0deg');
    inner?.style.setProperty('--rx', '0deg');
  }
}
