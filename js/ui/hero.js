/* The hero: split headline, the stats strip, and the domme typing at you. */
import { $, $$, el, splitText } from '../lib/dom.js';
import { getState, subscribe, voiceLines } from '../lib/state.js';
import { money, hours, fillCopy } from '../lib/format.js';
import { shuffle, prefersReducedMotion } from '../lib/motion.js';

export function initHero() {
  $$('.hero [data-split]').forEach(splitText);
  renderStats(getState());
  subscribe((s) => renderStats(s));
  startTicker();
}

/** Called once the loader is gone: the headline rises into place. */
export function revealHero() {
  $$('.hero [data-split]').forEach((node, i) => {
    node.style.setProperty('--d', `${i * 140}ms`);
    node.classList.add('is-in');
  });
}

function renderStats(s) {
  const base = s.settings.baseCurrency;
  set('[data-stat="balance"]', s.stats.balance === null ? '•••' : money(s.stats.balance, base, { whole: Math.abs(s.stats.balance) >= 1000 }));
  set('[data-stat="streak"]', `${s.stats.streak} ${s.stats.streak === 1 ? 'day' : 'days'}`);
  set('[data-stat="hours"]', hours(s.stats.hours));
  let next = '—';
  if (s.unlocked.length) next = 'Now. Claim it.';
  else if (s.goal && !s.goal.priceMissing) next = hours(s.goal.hoursToGo);
  set('[data-stat="next"]', next);
  $('.hero [data-stat="balance"]').classList.toggle('out', s.stats.balance !== null && s.stats.balance < 0);
}

function set(selector, text) {
  const node = $(`.hero ${selector}`);
  if (node && node.textContent !== text) node.textContent = text;
}

/* A typewriter that cycles through voice lines that fit the current mood. */
function startTicker() {
  const target = $('#says-text');
  let queue = [];
  let lastMood = '';
  const caret = el('span', { class: 'caret', 'aria-hidden': 'true' });

  const nextLine = () => {
    const s = getState();
    if (!queue.length || s.mood !== lastMood) {
      lastMood = s.mood;
      queue = shuffle(voiceLines(s));
    }
    return fillCopy(queue.shift(), s);
  };

  if (prefersReducedMotion()) {
    const show = () => { target.textContent = nextLine(); };
    show();
    setInterval(show, 9000);
    return;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  (async () => {
    target.textContent = '';
    target.append(caret);
    await sleep(2200);
    for (;;) {
      const line = nextLine();
      const textNode = document.createTextNode('');
      target.textContent = '';
      target.append(textNode, caret);
      for (let i = 1; i <= line.length; i++) {
        textNode.textContent = line.slice(0, i);
        await sleep(line[i - 1] === ' ' ? 18 : 22 + Math.random() * 34);
      }
      await sleep(4200 + line.length * 30);
      if (document.hidden) await new Promise((r) => document.addEventListener('visibilitychange', r, { once: true }));
      for (let i = line.length; i >= 0; i -= 2) {
        textNode.textContent = line.slice(0, i);
        await sleep(9);
      }
      await sleep(260);
    }
  })();
}
