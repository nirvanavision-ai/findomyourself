/* Site words from the Control Room, with their {placeholders} kept live. */
import { $$, splitText } from '../lib/dom.js';
import { subscribe, getState } from '../lib/state.js';
import { fillCopy } from '../lib/format.js';

export function initCopy() {
  const render = (s) => {
    for (const node of $$('[data-copy]')) {
      const text = fillCopy(s.settings.copy[node.dataset.copy] || '', s);
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
