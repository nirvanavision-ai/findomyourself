/* The tribute menu: what pays into the vault and what gets fined, like a very judgmental price list. */
import { $, el, clear } from '../lib/dom.js';
import { subscribe, getState } from '../lib/state.js';
import { money } from '../lib/format.js';

export function initMenu() {
  const pays = $('#menu-pays');
  const costs = $('#menu-costs');
  let signature = '';

  const row = (emoji, name, amount, sign, featured) => el('li', { class: featured ? 'is-featured' : null },
    el('span', { class: 'emo', 'aria-hidden': 'true', text: emoji || '·' }),
    el('span', { class: 'name', text: name }),
    el('span', { class: 'dots', 'aria-hidden': 'true' }),
    el('span', { class: 'amt', text: amount === null ? '•••' : `${sign}${amount}` }),
  );

  const render = (s) => {
    const sig = JSON.stringify([s.commands, s.fines, s.settings.hourlyRate, s.settings.baseCurrency]);
    if (sig === signature) return;
    signature = sig;
    const base = s.settings.baseCurrency;
    const fmt = (v) => (v === null ? null : money(v, base));
    clear(pays).append(
      row('⏱', 'One hour of focus', fmt(s.settings.hourlyRate), '+', true),
      ...s.commands.map((c) => row(c.emoji, c.name, fmt(c.amount), '+')),
      row('💸', 'Real money earned', 'every cent', ''),
    );
    clear(costs).append(
      ...s.fines.map((f) => row(f.emoji, f.name, fmt(f.amount), '−')),
      row('🛍', 'Buying something on the list', 'its price', ''),
    );
  };
  render(getState());
  subscribe(render);
}
