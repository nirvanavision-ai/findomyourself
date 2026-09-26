/* The trophy wall: everything that was earned and bought, pinned up like polaroids. */
import { $, el, clear } from '../lib/dom.js';
import { getState, subscribe } from '../lib/state.js';
import { hours, shortDate } from '../lib/format.js';
import { openItem } from './modal.js';

export function initTrophies() {
  let signature = '';
  const render = (s) => {
    const claimed = [...s.claimed].sort((a, b) => String(b.claimedAt).localeCompare(String(a.claimedAt)));
    const sig = JSON.stringify([claimed, s.settings.hourlyRate]);
    if (sig === signature) return;
    signature = sig;
    const wall = $('#wall');
    clear(wall);
    if (!claimed.length) {
      wall.append(el('li', { class: 'wall__empty' },
        el('div', { class: 'wall__frames', 'aria-hidden': 'true' },
          ...[-3, 2, -1.5].map((r) => el('span', { class: 'wall__frame', style: { '--r': `${r}deg` }, text: '?' }))),
        el('p', { class: 'wall__line', text: 'Nothing earned yet. The wall is waiting, and so am I.' }),
      ));
      return;
    }
    claimed.forEach((item, i) => {
      const rate = s.settings.hourlyRate;
      const grind = rate && item.claimedAmount ? ` · ${hours(item.claimedAmount / rate)} of grind` : '';
      const img = el('div', { class: 'trophy__img' });
      if (item.image) {
        const pic = el('img', { src: item.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
        pic.addEventListener('error', () => pic.remove(), { once: true });
        img.append(pic);
      }
      img.append(el('span', { class: 'trophy__stamp', text: 'Earned' }));
      wall.append(el('li', {
        class: 'trophy', data: { reveal: '' }, style: { '--r': `${[-2.5, 1.8, -1.2, 2.6, -3][i % 5]}deg`, '--t': `${[-4, 3, -2][i % 3]}deg`, '--d': `${i * 0.08}s` },
      },
      el('button', { class: 'card__hit', type: 'button', 'aria-label': `${item.title}, earned`, 'data-cursor': 'View', on: { click: () => openItem(item.id) } }),
      img,
      el('p', { class: 'trophy__brand', text: item.brand || item.store || '' }),
      el('p', { class: 'trophy__name', text: item.name }),
      el('p', { class: 'trophy__meta', text: `Claimed ${shortDate(item.claimedAt || item.createdAt, s.settings.timezone)}${grind}` }),
      ));
    });
    wall.querySelectorAll('[data-reveal]').forEach((n) => requestAnimationFrame(() => n.classList.add('is-in')));
  };
  render(getState());
  subscribe(render);
}
