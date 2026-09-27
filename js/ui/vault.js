/* The vault: the balance, the stats, the current goal and a receipt printer for new tribute. */
import { $, el, clear, svg } from '../lib/dom.js';
import { getState, subscribe } from '../lib/state.js';
import { money, moneyExact, signedMoney, hours, receiptTime, itemTitle } from '../lib/format.js';
import { countTo } from '../lib/motion.js';
import { progressLine } from './lines.js';
import { openItem, shopButton } from './modal.js';
import { sound } from '../audio.js';

const RECEIPT_LINES = 8;
let seen = false;
let lastTopEntry = null;

export function initVault() {
  const section = $('#vault');
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && !seen) {
      seen = true;
      render(getState(), true);
      io.disconnect();
    }
  }, { threshold: 0.2 });
  io.observe(section);
  render(getState(), false);
  subscribe((s) => render(s, seen));
}

function render(s, animate) {
  const base = s.settings.baseCurrency;
  const balanceNode = $('#vault-balance');
  const b = s.stats.balance;
  if (b === null) {
    balanceNode.textContent = '•••';
  } else if (animate) {
    countTo(balanceNode, b, (v) => moneyExact(v, base));
  } else if (!seen) {
    balanceNode.textContent = moneyExact(0, base);
  }
  $('.vault__balance').classList.toggle('is-debt', b !== null && b < 0);

  const stat = (key, text) => { const n = $(`.vault [data-stat="${key}"]`); if (n) n.textContent = text; };
  const m = (v) => (v === null ? '•••' : money(v, base));
  stat('earned', m(s.stats.earned));
  stat('fined', s.stats.fined === null ? '•••' : s.stats.fined > 0 ? '−' + money(s.stats.fined, base) : m(0));
  stat('spent', m(s.stats.spent));
  stat('today', m(s.stats.today));
  stat('bestStreak', `${s.stats.bestStreak} ${s.stats.bestStreak === 1 ? 'day' : 'days'}`);
  stat('whipsToday', String(s.whips?.today ?? 0));

  renderGoal(s);
  renderReceipt(s);
  const caption = $('#vault-caption');
  const g = s.goal;
  caption.textContent = !g ? '' : g.affordable ? `Full. The ${itemTitle(g)} is paid for.`
    : `The jar fills toward: ${itemTitle(g)} · ${Math.round(g.progress * 100)}%`;
}

function renderGoal(s) {
  const box = $('#goal');
  const g = s.goal;
  clear(box);
  box.classList.toggle('is-unlocked', Boolean(g?.affordable));
  if (!g) {
    box.append(el('p', { class: 'goal__label', text: 'Currently grinding for' }), el('p', { class: 'goal__line', text: 'Nothing. The list is empty. Go want something.' }));
    return;
  }
  const base = s.settings.baseCurrency;
  const thumb = el('span', { class: 'goal__thumb' });
  if (g.image) {
    const img = el('img', { src: g.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(el('span', { class: 'initial', text: (g.brand || g.name).charAt(0) })), { once: true });
    thumb.append(img);
  } else {
    thumb.append(el('span', { class: 'initial', text: (g.brand || g.name).charAt(0) }));
  }
  const pct = Math.round(g.progress * 100);
  box.append(
    el('p', { class: 'goal__label', text: g.affordable ? 'Unlocked · go get it' : 'Currently grinding for' }),
    el('button', { class: 'goal__item', type: 'button', 'data-cursor': 'View', on: { click: () => openItem(g.id) } },
      thumb,
      el('span', {}, el('span', { class: 'goal__brand', text: g.brand || g.store || '' }), el('span', { class: 'goal__name', text: g.name })),
      el('span', { class: 'goal__price', text: g.priceMissing ? 'TBD' : money(g.priceBase, base) }),
    ),
    el('div', { class: 'bar', style: { '--p': g.progress } }, el('span')),
    el('p', { class: 'goal__meta' },
      el('span', { text: `${pct}% there` }),
      el('span', { text: g.affordable ? 'Fully funded' : g.priceMissing ? 'Needs a price' : `${g.toGo === null ? '' : money(g.toGo, base) + ' to go · '}${hours(g.hoursToGo)} of work` }),
    ),
    el('p', { class: 'goal__line', text: progressLine(g) }),
  );
  if (g.affordable && g.link) {
    const cta = shopButton(g, { class: 'btn btn--gold btn--small' }, `Shop it at ${g.store || 'the store'} ↗`);
    cta.classList.add('goal__cta'); // on the caption's wrapper when there is one
    box.append(cta);
  }
}

function renderReceipt(s) {
  const root = $('#receipt');
  const base = s.settings.baseCurrency;
  const tz = s.settings.timezone;
  const entries = (s.ledger || []).slice(0, RECEIPT_LINES);
  const fresh = new Set();
  if (lastTopEntry !== null) {
    for (const e of entries) {
      if (e.id === lastTopEntry) break;
      fresh.add(e.id);
    }
  }
  lastTopEntry = entries[0]?.id ?? '';

  const lines = el('ul', { class: 'receipt__lines' });
  if (!s.settings.showLedger) {
    lines.append(el('li', {}, el('span', { class: 'what', text: 'Receipts are private.' }), el('span', { class: 'amt', text: 'Trust me.' })));
  } else if (!entries.length) {
    lines.append(el('li', {}, el('span', { class: 'what', text: 'Nothing yet.' }), el('span', { class: 'amt', text: 'Pathetic.' })));
  } else {
    for (const e of entries) {
      const what = e.type === 'work' && e.minutes ? `${e.label} · ${Math.floor(e.minutes / 60)}H${String(e.minutes % 60).padStart(2, '0')}` : e.label;
      lines.append(el('li', { class: fresh.has(e.id) ? 'is-new' : null },
        el('span', { class: 'when', text: receiptTime(e.at, tz) }),
        el('span', { class: 'what', text: what }),
        el('span', { class: `amt ${e.amount !== null && e.amount < 0 ? 'out' : 'in'}`, text: signedMoney(e.amount, base) }),
      ));
    }
  }
  if (fresh.size) sound.print(fresh.size);

  const total = s.stats.balance;
  clear(root).append(
    el('div', { class: 'receipt__slot', 'aria-hidden': 'true' }),
    el('div', { class: 'receipt__paper' },
      el('p', { class: 'receipt__head' }, el('b', { text: s.settings.title }), 'Tribute receipt'),
      el('p', { class: 'receipt__meta', text: `${receiptTime(new Date(s.now()).toISOString(), tz)} · NO. ${String(s.stats.entries).padStart(6, '0')}` }),
      el('hr'),
      lines,
      el('hr'),
      el('p', { class: 'receipt__total' }, el('span', { text: 'IN THE VAULT' }), el('span', { text: total === null ? '•••' : moneyExact(total, base) })),
      el('div', { class: 'receipt__barcode', 'aria-hidden': 'true' }, barcode(`${total}|${s.stats.entries}`)),
      el('p', { class: 'receipt__foot', text: 'THANK YOU FOR YOUR OBEDIENCE' }),
    ),
  );
}

/** A decorative barcode that changes with the vault. */
function barcode(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rand = () => { h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h >>> 0) % 1000) / 1000; };
  let x = 0;
  let bars = '';
  while (x < 300) {
    const w = 1 + Math.floor(rand() * 4);
    if (rand() > 0.35) bars += `<rect x="${x}" y="0" width="${w}" height="44"/>`;
    x += w + 1 + Math.floor(rand() * 2);
  }
  return svg(`<svg viewBox="0 0 300 44" preserveAspectRatio="none" fill="#1c1216">${bars}</svg>`);
}
