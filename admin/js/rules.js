/*
 * FINDOM YOURSELF · Control Room: the Rules tab. The hourly rate, and the commands and fines
 * that become one-tap buttons on Today. Edits wait in a draft until you save them.
 */
import { h, icon, swap, sig, money, amountInput, parseAmount, uid } from './core.js';
import { api, store } from './api.js';
import { moneyInput, toast, button, saveBar, confirmSheet } from './ui.js';

const MAX_RULES = 40;

const toRow = (r) => ({ key: r.id, id: r.id, emoji: r.emoji, name: r.name, amount: amountInput(r.amount) });
const fromState = (s) => ({ rate: amountInput(s.settings.hourlyRate), commands: s.commands.map(toRow), fines: s.fines.map(toRow) });
const comparable = (d) => ({ rate: String(parseAmount(d.rate) ?? d.rate), commands: listSig(d.commands), fines: listSig(d.fines) });
const listSig = (rows) => rows.filter((r) => r.name.trim() || r.amount.trim() || r.emoji.trim())
  .map((r) => [r.id || '', r.emoji.trim(), r.name.trim(), String(parseAmount(r.amount) ?? r.amount)]);

export function createRules() {
  let draft = null;
  let savedSig = '';

  const bar = saveBar({ onSave: save, onDiscard: discard });
  const rate = moneyInput({ label: 'Hourly rate', placeholder: '25', id: 'rate-input' });
  const rateLine = h('p', { class: 'rate-line', 'aria-live': 'polite' });
  rate.input.addEventListener('input', () => {
    draft.rate = rate.input.value;
    renderRateLine();
    sync();
  });
  const rateCard = h('section', { class: 'card rate-card', 'aria-labelledby': 'rate-title' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-label', id: 'rate-title', text: 'Hourly rate' }), h('span', { class: 'card-aside', text: 'What focus pays' })),
    h('label', { class: 'rate-row', for: 'rate-input' }, rate.wrap, h('span', { class: 'rate-unit', text: 'per hour of focus' })),
    rateLine);

  const commandsList = h('ol', { class: 'rule-rows' });
  const finesList = h('ol', { class: 'rule-rows' });
  const addCommand = button('Add a command', { iconName: 'plus', size: 'sm', onclick: () => addRow('commands') });
  const addFine = button('Add a fine', { iconName: 'plus', size: 'sm', onclick: () => addRow('fines') });
  const editor = (key, title, lede, list, add) => h('section', { class: ['card', 'rules-editor', key === 'fines' && 'is-fines'], 'aria-labelledby': `${key}-edit-title` },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-label', id: `${key}-edit-title`, text: title }), h('span', { class: 'card-aside', text: key === 'fines' ? 'Money out' : 'Money in' })),
    h('p', { class: 'card-lede', text: lede }),
    list,
    h('div', { class: 'rules-foot' }, add));

  const el = h('section', { class: 'view view-rules', id: 'view-rules', 'aria-labelledby': 'rules-title', hidden: true },
    h('header', { class: 'view-head' },
      h('p', { class: 'eyebrow', text: 'Commands & fines' }),
      h('h1', { class: 'view-title', id: 'rules-title' }, 'House ', h('em', { text: 'rules' })),
      h('p', { class: 'view-sub', text: 'What pays, what costs. Every rule becomes a one-tap button on Today.' })),
    h('div', { class: 'rules-grid' },
      h('div', { class: 'col' }, rateCard),
      h('div', { class: 'col col-wide' },
        editor('commands', 'Commands', 'Things you do that earn tribute. Tap one on Today and the amount goes into the vault.', commandsList, addCommand),
        editor('fines', 'Fines', 'Things you shouldn’t do. Report yourself and the amount comes out.', finesList, addFine))),
    bar.el);

  function renderRateLine() {
    const value = parseAmount(draft.rate);
    if (value === null) {
      rateLine.textContent = 'Type a number, like 25.';
      return;
    }
    const sprint = Math.round((25 / 60) * value * 100) / 100;
    rateLine.replaceChildren('1 hour of focus pays ', h('strong', { class: 'mono is-in', text: money(value) }),
      '. A 25-minute sprint pays ', h('strong', { class: 'mono is-in', text: money(sprint) }), '.');
  }

  function renderRows(key) {
    const list = key === 'commands' ? commandsList : finesList;
    const rows = draft[key];
    const isFine = key === 'fines';
    if (!rows.length) {
      swap(list, h('li', { class: 'empty-line', text: isFine ? 'No fines. Living dangerously.' : 'No commands yet. Add the first one.' }));
    } else {
      swap(list, rows.map((row, index) => {
        const emoji = h('input', { class: 'input rule-emoji', type: 'text', value: row.emoji, maxlength: 8, placeholder: isFine ? '😈' : '✨', 'aria-label': 'Emoji', autocomplete: 'off', dataset: { key: `${key}:${row.key}:emoji` } });
        const name = h('input', { class: 'input rule-name', type: 'text', value: row.name, maxlength: 60, placeholder: isFine ? 'e.g. Skipped leg day' : 'e.g. Went for a run', 'aria-label': 'Name', autocomplete: 'off', enterkeyhint: 'next', dataset: { key: `${key}:${row.key}:name` } });
        const amount = moneyInput({ value: row.amount, label: 'Amount', placeholder: '10', dataset: { key: `${key}:${row.key}:amount` } });
        amount.wrap.classList.add('rule-amount', isFine ? 'is-out' : 'is-in');
        const up = h('button', { class: 'icon-btn', type: 'button', 'aria-disabled': index === 0 ? 'true' : null, dataset: { key: `${key}:${row.key}:up` }, onclick: () => moveRow(key, index, -1) }, icon('up'));
        const down = h('button', { class: 'icon-btn', type: 'button', 'aria-disabled': index === rows.length - 1 ? 'true' : null, dataset: { key: `${key}:${row.key}:down` }, onclick: () => moveRow(key, index, 1) }, icon('down'));
        const remove = h('button', { class: 'icon-btn danger', type: 'button', dataset: { key: `${key}:${row.key}:remove` }, onclick: () => removeRow(key, index) }, icon('trash'));
        const nameButtons = () => { // the buttons say which rule they act on, even while it's being typed
          const label = row.name.trim() || `${isFine ? 'fine' : 'command'} ${index + 1}`;
          up.setAttribute('aria-label', `Move ${label} up`);
          down.setAttribute('aria-label', `Move ${label} down`);
          remove.setAttribute('aria-label', `Remove ${label}`);
        };
        nameButtons();
        emoji.addEventListener('input', () => { row.emoji = emoji.value; sync(); });
        name.addEventListener('input', () => { row.name = name.value; name.classList.remove('is-invalid'); nameButtons(); sync(); });
        amount.input.addEventListener('input', () => { row.amount = amount.input.value; amount.input.classList.remove('is-invalid'); sync(); });
        return h('li', { class: 'rule-row' }, emoji, name, amount.wrap, h('div', { class: 'rule-tools' }, up, down, remove));
      }));
    }
    (isFine ? addFine : addCommand).disabled = rows.length >= MAX_RULES;
  }

  function addRow(key) {
    const row = { key: uid('new'), id: '', emoji: '', name: '', amount: '' };
    draft[key].push(row);
    renderRows(key);
    sync();
    const input = el.querySelector(`[data-key="${CSS.escape(`${key}:${row.key}:name`)}"]`);
    if (input) {
      input.scrollIntoView({ block: 'center' });
      input.focus({ preventScroll: true });
    }
  }

  function moveRow(key, index, delta) {
    const rows = draft[key];
    const to = index + delta;
    if (to < 0 || to >= rows.length) return;
    [rows[index], rows[to]] = [rows[to], rows[index]];
    renderRows(key);
    sync();
  }

  async function removeRow(key, index) {
    const row = draft[key][index];
    if (row.id && row.name.trim()) {
      const ok = await confirmSheet({ title: `Remove “${row.name}”?`, message: 'It disappears from Today when you save. Past receipts keep their labels.', confirmLabel: 'Remove', danger: true });
      if (!ok) return;
    }
    draft[key].splice(index, 1);
    renderRows(key);
    sync();
    const list = key === 'commands' ? commandsList : finesList;
    const next = list.querySelector('.rule-row:nth-child(' + Math.min(index + 1, draft[key].length) + ') .rule-name');
    if (next) next.focus();
  }

  const isDirty = () => draft && sig(comparable(draft)) !== savedSig;
  const sync = () => bar.show(isDirty());

  function fill(s) {
    draft = fromState(s);
    savedSig = sig(comparable(draft));
    rate.input.value = draft.rate;
    rate.setCurrency(s.settings.baseCurrency);
    renderRateLine();
    renderRows('commands');
    renderRows('fines');
    sync();
  }

  function discard() {
    fill(store.state);
  }

  /** Points at the box that needs fixing, then stops the save with a message for the owner. */
  function invalid(key, row, part, message) {
    const input = el.querySelector(`[data-key="${CSS.escape(`${key}:${row.key}:${part}`)}"]`);
    if (input) {
      input.classList.add('is-invalid');
      input.scrollIntoView({ block: 'center' });
      input.focus({ preventScroll: true });
    }
    throw new Error(message);
  }

  /** Checks one list; returns cleaned rules or throws with a message for the owner. */
  function clean(key) {
    const out = [];
    for (const row of draft[key]) {
      const name = row.name.trim();
      const blank = !name && !row.amount.trim() && !row.emoji.trim();
      if (blank) continue;
      if (!name) invalid(key, row, 'name', `One of the ${key} has no name. Name it or remove it.`);
      const amount = parseAmount(row.amount);
      if (amount === null) invalid(key, row, 'amount', `“${name}” needs an amount, like 10.`);
      out.push({ ...(row.id ? { id: row.id } : {}), emoji: row.emoji.trim(), name, amount });
    }
    return out;
  }

  async function save() {
    const s = store.state;
    const saved = fromState(s);
    const rateValue = parseAmount(draft.rate);
    if (rateValue === null) throw new Error('The hourly rate needs to be a number.');
    const commands = clean('commands');
    const fines = clean('fines');
    const rulesPatch = {};
    if (sig(listSig(draft.commands)) !== sig(listSig(saved.commands))) rulesPatch.commands = commands;
    if (sig(listSig(draft.fines)) !== sig(listSig(saved.fines))) rulesPatch.fines = fines;
    if (rateValue !== s.settings.hourlyRate) await api('settings.save', { settings: { hourlyRate: rateValue } });
    if (Object.keys(rulesPatch).length) await api('rules.save', rulesPatch);
    fill(store.state);
    toast('Rules saved. Now obey them.', { tone: 'gold' });
  }

  let stateSig = '';
  function update(s) {
    const next = sig(s.commands, s.fines, s.settings.hourlyRate, s.settings.baseCurrency);
    if (next === stateSig) return; // nothing this tab shows has changed
    stateSig = next;
    if (!draft || !isDirty()) fill(s); // never clobber edits in progress
    else rate.setCurrency(s.settings.baseCurrency);
  }

  return { el, update, isDirty, title: 'Rules' };
}
