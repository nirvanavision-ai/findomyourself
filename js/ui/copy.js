/* Site words from the Control Room, with their {placeholders} kept live. */
import { $, $$, el, splitText } from '../lib/dom.js';
import { subscribe, getState } from '../lib/state.js';
import { fillCopy } from '../lib/format.js';

export function initCopy() {
  const render = (s) => {
    syncDisclosure(s);
    for (const node of $$('[data-copy]')) {
      const text = fillCopy(copyText(s, node.dataset.copy), s);
      if (node.dataset.rendered === text) continue;
      node.dataset.rendered = text;
      const wasIn = node.classList.contains('is-in');
      node.textContent = text;
      if (node.dataset.splitDone) { // re-split so the animation still works on changed words
        delete node.dataset.splitDone;
        node.removeAttribute('aria-label');
        splitText(node);
        if (wasIn) node.classList.add('is-in');
      }
    }
  };
  render(getState());
  subscribe(render);
}

/** The affiliate disclosure comes finished from the server (empty while no button is an affiliate link). */
function copyText(s, key) {
  return key === 'affiliateNote' ? s.settings.affiliateNote || '' : s.settings.copy[key] || '';
}

/** The footer's disclosure is there only while affiliate links are in use, like the server renders it. */
function syncDisclosure(s) {
  const node = $('#disclosure');
  if (!s.settings.affiliateNote) {
    node?.remove();
  } else if (!node) {
    $('.footer__row')?.after(el('p', { class: 'footer__disclosure', id: 'disclosure', 'data-copy': 'affiliateNote' }));
  }
}
