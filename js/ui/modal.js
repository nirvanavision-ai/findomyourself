/*
 * Item details in a <dialog>: photo behind its frost, price, progress, the domme's
 * verdict and the store link. ← → step through the list; #item/<id> links straight here.
 */
import { $, el, clear, svg, icons } from '../lib/dom.js';
import { getState, subscribe } from '../lib/state.js';
import { money, hours, shortDate } from '../lib/format.js';
import { lockScroll } from '../lib/scroll.js';
import { progressLine } from './lines.js';
import { sound } from '../audio.js';

let dialog;
let currentId = null;
let order = [];
let getOrder = () => [];

export function initModal(orderSource) {
  dialog = $('#modal');
  getOrder = orderSource;
  dialog.addEventListener('close', () => {
    currentId = null;
    lockScroll(false);
    if (location.hash.startsWith('#item/')) history.replaceState(null, '', location.pathname + location.search);
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // backdrop
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  });
  subscribe(() => { if (currentId && dialog.open) render(currentId, false); });
  window.addEventListener('hashchange', openFromHash);
}

export function openFromHash() {
  const m = location.hash.match(/^#item\/([a-z0-9_]+)$/);
  if (m && getState().byId.has(m[1])) openItem(m[1]);
}

export function openItem(id) {
  if (!getState().byId.has(id)) return;
  order = getOrder();
  if (!order.includes(id)) order = [id, ...order];
  render(id, true);
  if (!dialog.open) {
    dialog.showModal();
    lockScroll(true);
  }
  history.replaceState(null, '', `#item/${id}`);
  sound.tick();
}

function step(dir) {
  if (!currentId || order.length < 2) return;
  const i = order.indexOf(currentId);
  const next = order[(i + dir + order.length) % order.length];
  render(next, true);
  history.replaceState(null, '', `#item/${next}`);
}

function render(id, fresh) {
  const s = getState();
  const item = s.byId.get(id);
  if (!item) { dialog.close(); return; }
  currentId = id;
  const base = s.settings.baseCurrency;
  const locked = item.status === 'wishing' && !item.affordable;

  const media = el('div', { class: 'modal__media', style: { '--p': item.priceMissing ? 0 : item.progress } });
  if (item.image) {
    const img = el('img', { src: item.image, alt: item.title, referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove(), { once: true });
    media.append(img);
  } else {
    media.append(el('div', { class: 'card__ph' }, el('span', { class: 'initial', text: (item.brand || item.name).charAt(0) }), el('span', { class: 'brand', text: 'Photo pending' })));
  }
  if (locked) {
    const frost = el('div', { class: 'card__frost' }, svg(icons.lock));
    frost.querySelector('svg').classList.add('card__lock');
    if (fresh) { // the glass slides to its level when the dialog opens
      frost.style.height = '100%';
      requestAnimationFrame(() => requestAnimationFrame(() => { frost.style.height = ''; }));
    }
    media.append(frost);
  }

  const converted = item.priceBase !== null && item.currency !== base && !item.priceMissing;
  const facts = el('dl', { class: 'modal__facts' },
    fact('Progress', item.status === 'claimed' ? 'Claimed' : item.priceMissing ? '—' : `${Math.floor(item.progress * 100)}%`),
    fact('Work left', item.status !== 'wishing' ? '—' : item.affordable ? 'None. Go.' : item.priceMissing ? '—' : hours(item.hoursToGo)),
    fact('Still to earn', item.toGo === null ? '•••' : item.status === 'wishing' && !item.affordable && !item.priceMissing ? money(item.toGo, base) : money(0, base)),
    fact(item.status === 'claimed' ? 'Claimed' : 'On the list since', shortDate(item.status === 'claimed' && item.claimedAt ? item.claimedAt : item.createdAt, s.settings.timezone)),
  );

  const actions = el('div', { class: 'modal__actions' });
  if (item.url) {
    actions.append(el('a', {
      class: `btn ${item.affordable ? 'btn--gold' : 'btn--ghost'}`, href: item.url, target: '_blank', rel: 'noopener noreferrer nofollow', 'data-cursor': 'Shop',
    }, item.affordable ? `Buy it at ${item.store || 'the store'}` : `Look, don’t touch · ${item.store || 'store'}`, svg(icons.arrow)));
    actions.querySelector('svg').setAttribute('width', '14');
  }

  const body = el('div', { class: 'modal__body' },
    el('p', { class: 'modal__brand', text: [item.brand, item.category].filter(Boolean).join(' · ') || item.store || '' }),
    el('h2', { class: 'modal__title', id: 'modal-title', text: item.name }),
    item.variant ? el('p', { class: 'modal__variant', text: item.variant }) : null,
    el('p', { class: 'modal__price' },
      item.priceMissing ? 'Price TBD' : item.priceBase === null ? '•••' : money(item.priceBase, base),
      converted ? el('small', { text: `${money(item.price, item.currency)} listed` }) : null),
    el('div', { class: 'bar', style: { '--p': item.priceMissing ? 0 : item.progress } }, el('span')),
    el('p', { class: 'modal__line', text: progressLine(item) }),
    facts,
    item.note ? el('p', { class: 'modal__note', text: item.note }) : null,
    actions,
  );

  const content = el('div', { class: 'modal__grid' }, media, body);
  const close = el('button', { class: 'modal__close', type: 'button', 'aria-label': 'Close', text: '✕', on: { click: () => dialog.close() } });
  const nav = order.length > 1 ? [
    el('button', { class: 'modal__nav modal__nav--prev', type: 'button', 'aria-label': 'Previous item', text: '←', on: { click: () => step(-1) } }),
    el('button', { class: 'modal__nav modal__nav--next', type: 'button', 'aria-label': 'Next item', text: '→', on: { click: () => step(1) } }),
  ] : [];
  clear(dialog).append(content, close, ...nav);
}

function fact(label, value) {
  return el('div', {}, el('dt', { text: label }), el('dd', { text: value }));
}
