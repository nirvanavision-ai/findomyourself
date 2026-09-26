/*
 * FINDOM YOURSELF · Control Room: receipts. How ledger entries look, editing and deleting
 * one, the full history, and logging work done without the timer.
 */
import {
  h, icon, swap, money, signed, duration, when, dayKey, dayLabel, toZonedInput, fromZonedInput,
  parseAmount, amountInput, serverNow, fullDateTime, plural, voiceLine, sig,
} from './core.js';
import { api, store, subscribe } from './api.js';
import { Sheet, field, textInput, textArea, moneyInput, segmented, durationInput, confirmSheet, toast, toastError, button, busy, note } from './ui.js';

export const TYPES = {
  work: { icon: 'clock', label: 'Focus', plural: 'Focus' },
  task: { icon: 'check', label: 'Command', plural: 'Commands' },
  money: { icon: 'coin', label: 'Money in', plural: 'Money in' },
  fine: { icon: 'bolt', label: 'Fine', plural: 'Fines' },
  claim: { icon: 'bag', label: 'Claimed', plural: 'Claims' },
  adjust: { icon: 'sliders', label: 'Adjustment', plural: 'Adjustments' },
};

const workPay = (minutes) => Math.round((minutes / 60) * store.state.settings.hourlyRate * 100) / 100;

/** Distinct labels of recent work, newest first (for the "what are you working on" suggestions). */
export function recentWorkLabels(state, limit = 12) {
  const seen = new Set();
  const out = [];
  for (const e of state.ledger) {
    if (e.type !== 'work' || seen.has(e.label)) continue;
    seen.add(e.label);
    out.push(e.label);
    if (out.length >= limit) break;
  }
  if (state.session && !seen.has(state.session.label)) out.unshift(state.session.label);
  return out;
}

export async function undoEntry(id, message = 'Undone. It never happened.') {
  try {
    await api('ledger.delete', { id });
    toast(message);
  } catch (e) {
    toastError(e);
  }
}

/* ───────────────────────── rows ───────────────────────── */

export function receiptRow(entry, { showDay = false } = {}) {
  const meta = TYPES[entry.type] || TYPES.adjust;
  const dir = entry.amount < 0 ? 'out' : entry.amount > 0 ? 'in' : 'zero';
  const bits = [showDay ? fullDateTime(entry.at) : when(entry.at)];
  if (entry.type === 'work' && entry.minutes) bits.push(duration(entry.minutes));
  if (entry.type !== 'work' && entry.type !== 'task' && entry.type !== 'fine') bits.push(meta.label);
  return h('li', null,
    h('button', {
      class: ['receipt', `is-${entry.type}`], type: 'button', dataset: { key: `entry:${entry.id}` },
      'aria-label': `${entry.label}, ${signed(entry.amount)}, ${bits.join(', ')}. Edit`,
      onclick: () => openEntryEditor(entry.id),
    },
    h('span', { class: ['r-glyph', `is-${dir}`] }, icon(meta.icon)),
    h('span', { class: 'r-main' },
      h('span', { class: 'r-label', text: entry.label }),
      h('span', { class: 'r-meta' }, bits.join(' · '), entry.note ? h('span', { class: 'r-note', text: ` · ${entry.note}` }) : null)),
    h('span', { class: ['r-amt', 'mono', `is-${dir}`], text: signed(entry.amount) })));
}

/* ───────────────────────── editing one entry ───────────────────────── */

export function openEntryEditor(entryId) {
  const entry = store.state.ledger.find((e) => e.id === entryId);
  if (!entry) {
    toast('That receipt is gone. It may have been deleted on another device.', { tone: 'error' });
    return;
  }
  const meta = TYPES[entry.type] || TYPES.adjust;
  const isWork = entry.type === 'work';
  const isAdjust = entry.type === 'adjust';

  const label = textInput({ value: entry.label, maxlength: 120, enterkeyhint: 'done' });
  const amount = moneyInput({ value: amountInput(Math.abs(entry.amount)), label: 'Amount' });
  const sign = isAdjust ? segmented({
    legend: 'Direction', hideLegend: true, className: 'seg-sign', value: entry.amount < 0 ? '-' : '+',
    options: [{ value: '+', label: '+ Add' }, { value: '-', label: '− Take out' }],
  }) : null;
  let amountTouched = false;
  amount.input.addEventListener('input', () => { amountTouched = true; });
  const dur = isWork ? durationInput({
    minutes: entry.minutes || 0, legend: 'Time worked',
    onChange: (m) => {
      if (!amountTouched && m !== null) amount.input.value = amountInput(workPay(m));
    },
  }) : null;
  const at = h('input', { class: 'input', type: 'datetime-local', value: toZonedInput(entry.at), max: toZonedInput(serverNow() + 5 * 60000), required: true });
  const noteIn = textArea({ value: entry.note, maxlength: 280, rows: 2, placeholder: 'Anything to remember about this one?' });
  const error = h('p', { class: 'msg error', role: 'alert', hidden: true });

  const direction = entry.type === 'fine' || entry.type === 'claim' ? 'Taken out of the vault' : isAdjust ? '' : 'Paid into the vault';
  const form = h('form', { class: 'stack', novalidate: true },
    field({ label: 'Label', control: label }),
    dur && dur.wrap,
    h('div', { class: 'field' },
      h('label', { class: 'field-label', for: amount.input.id }, h('span', { text: 'Amount' })),
      sign,
      amount.wrap,
      direction && h('p', { class: 'field-hint', text: isWork ? `${direction}. Change the time and the amount follows your hourly rate.` : `${direction}.` })),
    field({ label: 'When', control: at, hint: `Your time zone: ${store.state.settings.timezone}` }),
    field({ label: 'Note', control: noteIn, counter: 280 }),
    entry.type === 'claim' && note('info', 'Deleting this receipt puts the item back on the list and the money back in the vault.'),
    error);

  const initial = sig(label.value, amount.input.value, sign && sign.value, dur && dur.get(), at.value, noteIn.value);
  const dirty = () => sig(label.value, amount.input.value, sign && sign.value, dur && dur.get(), at.value, noteIn.value) !== initial;

  const sheet = new Sheet({
    title: entry.label, eyebrow: `${meta.label} · ${fullDateTime(entry.at)}`,
    onRequestClose: async () => !dirty() || confirmSheet({ title: 'Discard your changes?', confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true }),
  });
  const save = button('Save', { kind: 'primary', type: 'submit' });
  const del = button('Delete', { kind: 'danger', iconName: 'trash', className: 'push-left' });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const payload = { id: entry.id };
    if (label.value.trim() !== entry.label) payload.label = label.value.trim();
    const value = parseAmount(amount.input.value);
    if (value === null) {
      error.textContent = 'Type the amount as a number, like 25 or 12.50.';
      error.hidden = false;
      amount.input.focus();
      return;
    }
    const signedValue = isAdjust && sign.value === '-' ? -value : value;
    const minutes = dur ? dur.get() : null;
    if (dur && (minutes === null || minutes < 1 || minutes > 1440)) {
      error.textContent = 'Time worked has to be between 1 minute and 24 hours.';
      error.hidden = false;
      return;
    }
    if (dur && minutes !== entry.minutes) payload.minutes = minutes;
    const amountChanged = Math.abs(Math.abs(signedValue) - Math.abs(entry.amount)) >= 0.005 || (isAdjust && Math.sign(signedValue) !== Math.sign(entry.amount));
    if (amountChanged && !(dur && payload.minutes !== undefined && !amountTouched)) payload.amount = signedValue;
    const iso = fromZonedInput(at.value);
    if (!iso) {
      error.textContent = 'Pick a date and time.';
      error.hidden = false;
      return;
    }
    if (at.value !== toZonedInput(entry.at)) payload.at = iso;
    if (noteIn.value.trim() !== entry.note) payload.note = noteIn.value.trim();
    if (Object.keys(payload).length === 1) {
      sheet.close();
      return;
    }
    await busy(save, async () => {
      try {
        await api('ledger.update', payload);
        sheet.close();
        toast('Receipt updated.');
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    });
  });
  del.addEventListener('click', async () => {
    const extra = entry.type === 'claim' ? 'The item goes back on the list.' : '';
    const ok = await confirmSheet({
      title: 'Delete this receipt?',
      message: `“${entry.label}” (${signed(entry.amount)}) disappears from the ledger and the vault changes by ${signed(-entry.amount)}. ${extra}`.trim(),
      confirmLabel: 'Delete it', danger: true,
    });
    if (!ok) return;
    await busy(del, async () => {
      try {
        await api('ledger.delete', { id: entry.id });
        sheet.close();
        toast('Deleted. The vault’s been adjusted.');
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    });
  });
  save.setAttribute('form', form.id = `entry-form-${entry.id}`);
  sheet.body.append(form);
  sheet.foot.append(del, button('Cancel', { onclick: () => sheet.requestClose() }), save);
  sheet.open();
}

/* ───────────────────────── the whole ledger ───────────────────────── */

export function openLedgerAll() {
  const filters = [['all', 'All'], ...Object.entries(TYPES).map(([k, v]) => [k, v.plural])];
  let filter = 'all';
  const list = h('div', { class: 'ledger-all' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Show' });
  const sheet = new Sheet({ title: 'All receipts', size: 'lg' });

  const render = () => {
    const s = store.state;
    swap(chips, filters.map(([key, text]) => {
      const count = key === 'all' ? s.ledger.length : s.ledger.filter((e) => e.type === key).length;
      if (key !== 'all' && !count) return null;
      return h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(filter === key), dataset: { key: `lf:${key}` },
        onclick: () => { filter = key; render(); },
      }, text, h('span', { class: 'chip-count', text: String(count) }));
    }));
    const entries = s.ledger.filter((e) => filter === 'all' || e.type === filter);
    sheet.setTitle('All receipts', `${plural(s.ledgerCount, 'entry', 'entries')} in total`);
    if (!entries.length) {
      swap(list, h('p', { class: 'empty', text: 'No receipts yet. The vault is waiting.' }));
      return;
    }
    const groups = new Map();
    for (const e of entries) {
      const key = dayKey(Date.parse(e.at));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    const blocks = [];
    for (const [key, items] of groups) {
      const net = items.reduce((sum, e) => sum + e.amount, 0);
      blocks.push(h('section', { class: 'day' },
        h('h3', { class: 'day-head' }, h('span', { text: dayLabel(key) }), h('span', { class: ['mono', net < 0 ? 'is-out' : 'is-in'], text: signed(net) })),
        h('ul', { class: 'receipts' }, items.map((e) => receiptRow(e)))));
    }
    if (s.ledgerCount > s.ledger.length) {
      blocks.push(h('p', { class: 'fine-print', text: `Showing the latest ${s.ledger.length} of ${s.ledgerCount}. Download a backup (Settings) for the full history.` }));
    }
    swap(list, blocks);
  };
  const stop = subscribe(render);
  sheet.onClosed = stop;
  sheet.body.append(chips, list);
  sheet.foot.remove();
  render();
  sheet.open();
}

/* ───────────────────────── work without the timer ───────────────────────── */

export function openLogWork() {
  const s = store.state;
  const preview = h('p', { class: 'pay-preview', 'aria-live': 'polite' });
  const dur = durationInput({ minutes: 60, legend: 'How long?', onChange: () => update() });
  const quick = h('div', { class: 'chips' }, [15, 30, 45, 60, 90, 120, 180].map((m) => h('button', {
    class: 'chip', type: 'button', text: duration(m),
    onclick: () => { dur.set(m); update(); },
  })));
  const label = textInput({ placeholder: 'What did you work on?', maxlength: 120, list: 'work-labels', enterkeyhint: 'done' });
  const at = h('input', { class: 'input', type: 'datetime-local', value: toZonedInput(serverNow()), max: toZonedInput(serverNow() + 5 * 60000) });
  const error = h('p', { class: 'msg error', role: 'alert', hidden: true });
  const submit = button('Log it', { kind: 'gold', type: 'submit', iconName: 'check' });

  function update() {
    const m = dur.get();
    if (m && m > 0) {
      preview.replaceChildren('Pays ', h('strong', { class: 'mono is-in', text: `+${money(workPay(m))}` }), ` into the vault at ${money(s.settings.hourlyRate)}/hour.`);
    } else {
      preview.textContent = 'How much time? Hours and minutes.';
    }
  }
  update();

  const form = h('form', { class: 'stack', novalidate: true, id: 'log-work-form' },
    dur.wrap, quick,
    field({ label: 'What was it?', control: label }),
    field({ label: 'Finished at', control: at, hint: `Leave it at now if you just finished. Time zone: ${s.settings.timezone}` }),
    preview, error);
  submit.setAttribute('form', form.id);
  const sheet = new Sheet({ title: 'Log past work', eyebrow: 'Forgot the timer?' });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const minutes = dur.get();
    if (minutes === null || minutes < 1 || minutes > 1440) {
      error.textContent = 'Log between 1 minute and 24 hours.';
      error.hidden = false;
      return;
    }
    const payload = { type: 'work', minutes, label: label.value.trim() };
    const iso = fromZonedInput(at.value);
    if (iso && Math.abs(Date.parse(iso) - serverNow()) > 2 * 60000) payload.at = iso;
    await busy(submit, async () => {
      try {
        const res = await api('ledger.add', payload);
        sheet.close();
        const entry = res.state.ledger.find((x) => x.id === res.entryId);
        toast(voiceLine('praise', res.state), {
          tone: 'gold', detail: `${entry ? entry.label : 'Focus'} · ${duration(minutes)} · ${signed(entry ? entry.amount : workPay(minutes))}`,
          action: () => undoEntry(res.entryId),
        });
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    });
  });
  sheet.body.append(form);
  sheet.foot.append(button('Cancel', { onclick: () => sheet.requestClose() }), submit);
  sheet.open();
}
