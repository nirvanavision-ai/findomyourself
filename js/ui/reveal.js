/* Things fade and rise into place as they scroll into view. */
import { $$, splitText } from '../lib/dom.js';

export function initReveal() {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      io.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.01 });

  for (const node of $$('[data-split]')) {
    if (node.closest('.hero')) continue;
    splitText(node);
    io.observe(node);
  }
  for (const node of $$('[data-reveal]')) {
    if (!node.closest('.hero')) io.observe(node);
  }
}

/** The hero's supporting pieces, right after the headline starts rising. */
export function revealHeroDetails() {
  $$('.hero [data-reveal]').forEach((node, i) => {
    node.style.setProperty('--d', `${0.45 + i * 0.12}s`);
    node.classList.add('is-in');
  });
}
