/*
 * The wishlist grid. Cards are keyed by item id and updated in place, so the live
 * polling never makes the grid flicker. Locked photos sit behind frosted glass that
 * clears from the bottom up as the vault fills.
 */
import { $, el, clear, svg, icons } from '../lib/dom.js';
import { getState, subscribe } from '../lib/state.js';
import { money, hours } from '../lib/format.js';
import { isTouch, prefersReducedMotion } from '../lib/motion.js';
import { openItem } from './modal.js';

const FILTERS = [
  ['wishing', 'On the list'],
  ['unlocked', 'Unlocked'],
  ['locked', 'Still locked'],
  ['claimed', 'Claimed'],
];
const view = { filter: 'wishing', category: '', sort: 'closest' };
const nodes = new Map();
let visibleIds = [];

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

  const keep = new Set(visibleIds);
  for (const [id, node] of nodes) {
    if (!keep.has(id)) { node.remove(); nodes.delete(id); }
  }
  shown.forEach((item, index) => {
    const signature = JSON.stringify([item, index, s.settings.baseCurrency]);
    let node = nodes.get(item.id);
    if (!node) {
      node = card(item, index, s);
      node.dataset.sig = signature;
      nodes.set(item.id, node);
      enter(node);
    } else if (node.dataset.sig !== signature) {
      const fresh = card(item, index, s);
      fresh.className = node.className;
      fresh.dataset.sig = signature;
      node.replaceWith(fresh);
      nodes.set(item.id, fresh);
      node = fresh;
    }
    grid.append(node); // (re)appending keeps DOM order in sync with the sort
  });

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
  if (status === 'locked' || status === 'unpriced') {
    media.append(el('div', { class: 'card__frost' }, svg(icons.lock)));
    media.querySelector('.card__frost svg').classList.add('card__lock');
  }
  media.append(el('span', { class: 'card__corner card__corner--l', text: `No. ${String(index + 1).padStart(2, '0')}` }));
  if (status === 'unlocked') media.append(el('span', { class: 'card__stamp', text: 'Unlocked' }));
  else if (status === 'locked') media.append(el('span', { class: 'card__corner card__corner--r', text: `${Math.floor(item.progress * 100)}%` }));
  media.append(el('span', { class: 'card__glare', 'aria-hidden': 'true' }));

  const converted = item.priceBase !== null && item.currency !== base;
  const price = item.priceMissing ? el('span', { class: 'card__price', text: 'Price TBD' })
    : el('span', { class: 'card__price' }, item.priceBase === null ? '•••' : money(item.priceBase, base), converted ? el('small', { text: money(item.price, item.currency) }) : null);
  const hoursText = status === 'claimed' ? 'Claimed ✓' : status === 'unlocked' ? 'Paid for' : status === 'unpriced' ? '—' : `${hours(item.hoursToGo)} to go`;
  const label = `${item.title}. ${status === 'locked' ? `${Math.floor(item.progress * 100)}% earned, ${hours(item.hoursToGo)} of work to go` : status}.`;

  return el('li', { class: 'card', data: { id: item.id, status, priority: String(item.priority) }, style: { '--p': status === 'unpriced' ? 0 : item.progress } },
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
