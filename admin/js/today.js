/*
 * FINDOM YOURSELF · Control Room: the Today tab. The vault, the current goal, adding a wish,
 * the focus timer, one-tap commands and fines, money in, and the latest receipts.
 */
import {
  h, icon, swap, sig, uid, money, signed, balance, hours, duration, clock, longDay, timeOfDay,
  parseAmount, serverNow, voiceLine, pickVoice, fillVoice, voiceFits, reducedMotion,
} from './core.js';
import { api, store } from './api.js';
import {
  Sheet, field, textInput, moneyInput, segmented, durationInput, confirmSheet, toast, toastError, button, busy, thumb,
} from './ui.js';
import { receiptRow, openLedgerAll, openLogWork, undoEntry } from './ledger.js';
import { openItemEditor, openClaimSheet } from './item.js';
import { addLinkForm, openAddSheet } from './add.js';

const RECENT = 25;
const STARTED_AGO = [0, 5, 10, 15, 30, 45, 60, 90];
const workPay = (minutes) => Math.round((minutes / 60) * store.state.settings.hourlyRate * 100) / 100;

export function createToday({ go }) {
  const eyebrow = h('p', { class: 'eyebrow' });
  const vault = h('section', { class: 'card vault-card', 'aria-labelledby': 'vault-title' });
  const goal = h('section', { class: 'card goal-card', 'aria-labelledby': 'goal-title' });
  const addWish = h('section', { class: 'card add-card', 'aria-labelledby': 'add-title' },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-label', id: 'add-title', text: 'Add a wish' }),
      h('button', { class: 'link-btn', type: 'button', onclick: () => openAddSheet() }, 'More ways ', icon('next'))),
    addLinkForm({ compact: true }).el);
  const timer = h('section', { class: 'card timer-card', 'aria-labelledby': 'timer-title' });
  const commands = h('section', { class: 'card cmd-card', 'aria-labelledby': 'commands-title' });
  const fines = h('section', { class: 'card cmd-card fines-card', 'aria-labelledby': 'fines-title' });
  const moneyCard = h('section', { class: 'card money-card', 'aria-labelledby': 'money-title' });
  const receipts = h('section', { class: 'card receipts-card', 'aria-labelledby': 'receipts-title' });
  const el = h('section', { class: 'view view-today', id: 'view-today', 'aria-labelledby': 'today-title', hidden: true },
    h('header', { class: 'view-head' }, eyebrow, h('h1', { class: 'view-title', id: 'today-title' }, 'Today’s ', h('em', { text: 'tribute' }))),
    h('div', { class: 'today-grid' },
      h('div', { class: 'col' }, vault, timer, goal, addWish),
      h('div', { class: 'col' }, commands, fines, moneyCard, receipts)));

  const last = {};
  const changed = (key, ...parts) => {
    const next = sig(...parts);
    if (last[key] === next) return false;
    last[key] = next;
    return true;
  };

  /* ───── the vault ───── */

  let mood = null;
  let moodTemplate = '';
  function renderVault(s) {
    const st = s.stats;
    const nextMood = s.session ? 'working' : st.balance <= 0 ? 'empty' : !st.activeToday ? 'slacking' : 'praise';
    // The same line stays until the mood changes (polling doesn't reshuffle it); its numbers stay current.
    if (nextMood !== mood || !voiceFits(moodTemplate, s)) {
      mood = nextMood;
      moodTemplate = pickVoice(mood, s);
    }
    const moodLine = fillVoice(moodTemplate, s);
    if (!changed('vault', st.balance, st.today, st.streak, st.bestStreak, st.hours, s.whips.today, s.settings.baseCurrency, moodLine)) return;
    const debt = st.balance < 0;
    vault.classList.toggle('is-debt', debt);
    const stat = (label, value, unit = '', cls = '') => h('div', { class: 'stat' },
      h('dt', { text: label }),
      h('dd', { class: ['mono', cls] }, value, unit && h('span', { class: 'unit', text: ` ${unit}` })));
    swap(vault,
      h('div', { class: 'card-head' },
        h('h2', { class: 'card-label', id: 'vault-title', text: 'The vault' }),
        debt ? h('span', { class: 'badge badge-debt', text: 'In debt' }) : h('span', { class: 'card-aside mono', text: `${money(s.settings.hourlyRate)}/hr` })),
      h('p', { class: 'vault-balance mono' }, balance(st.balance)),
      h('dl', { class: 'vault-stats' },
        stat('Today', st.today > 0 ? `+${money(st.today)}` : money(0), '', st.today > 0 ? 'is-in' : ''),
        stat('Streak', `🔥 ${st.streak}`, st.streak === 1 ? 'day' : 'days'),
        stat('Focus', hours(st.hours), 'hrs'),
        stat('Whips today', String(s.whips.today), '', s.whips.today ? 'is-out' : '')),
      moodLine && h('p', { class: 'voice-line', text: moodLine }));
  }

  /* ───── the goal ───── */

  function renderGoal(s) {
    const item = s.items.find((i) => i.id === s.goalId);
    if (!changed('goal', item, s.settings.goalId, s.settings.baseCurrency, s.settings.hourlyRate)) return;
    const headRow = (aside) => h('div', { class: 'card-head' }, h('h2', { class: 'card-label', id: 'goal-title', text: 'Current goal' }), aside);
    if (!item) {
      swap(goal, headRow(null),
        h('div', { class: 'empty-state' },
          h('p', { class: 'empty-line', text: 'Nothing on the list. Suspicious.' }),
          button('Add something to want', { kind: 'primary', iconName: 'plus', onclick: () => openAddSheet(), dataset: { key: 'goal-add' } })));
      return;
    }
    const pinned = s.settings.goalId === item.id;
    const pct = Math.round(item.progress * 100);
    let status;
    if (item.priceMissing) {
      status = h('div', { class: 'goal-status' },
        h('p', { class: 'muted', text: 'No price yet, so it can’t unlock.' }),
        button('Add the price', { kind: 'ghost', size: 'sm', iconName: 'pencil', dataset: { key: 'goal-price' }, onclick: () => openItemEditor(item.id, { focus: 'price' }) }));
    } else if (item.affordable) {
      status = button('Unlocked — claim it', { kind: 'primary', size: 'lg', className: 'btn-block glow', iconName: 'sparkle', dataset: { key: 'goal-claim' }, onclick: () => openClaimSheet(item.id) });
    } else {
      status = h('p', { class: 'goal-togo' },
        h('strong', { class: 'mono', text: money(item.toGo) }), ' to go',
        item.hoursToGo > 0 ? [' · ', h('strong', { class: 'mono', text: hours(item.hoursToGo) }), ` ${item.hoursToGo === 1 ? 'hr' : 'hrs'} of work`] : null);
    }
    const base = s.settings.baseCurrency;
    swap(goal,
      headRow(h('span', { class: 'card-aside', text: pinned ? 'Pinned' : 'Cheapest first' })),
      h('button', { class: 'goal', type: 'button', dataset: { key: 'goal-open' }, onclick: () => openItemEditor(item.id) },
        thumb(item, 'lg'),
        h('span', { class: 'goal-text' },
          item.brand && h('span', { class: 'item-brand', text: item.brand }),
          h('span', { class: 'goal-name', text: item.name }),
          item.variant && h('span', { class: 'item-variant', text: item.variant }),
          h('span', { class: 'goal-price mono' },
            item.priceMissing ? 'No price' : money(item.price, item.currency),
            !item.priceMissing && item.currency !== base && h('span', { class: 'muted', text: ` ≈ ${money(item.priceBase)}` })))),
      !item.priceMissing && h('div', { class: 'progress-row' },
        h('div', { class: ['progress', item.affordable && 'is-full'], role: 'progressbar', 'aria-label': 'Progress to the goal', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) },
          h('span', { style: { width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` } })),
        h('span', { class: 'progress-pct mono', text: `${pct}%` })),
      status);
  }

  /* ───── the focus timer ───── */

  let timerMode = null;
  const t = {}; // live timer nodes

  function renderTimer(s) {
    const mode = s.session ? 'running' : 'idle';
    if (mode !== timerMode) {
      timerMode = mode;
      if (mode === 'running') buildRunning(s);
      else buildIdle(s);
    } else if (mode === 'running' && document.activeElement !== t.label && t.label.value !== s.session.label && !t.labelDirty) {
      t.label.value = s.session.label; // renamed on another device
    }
    tick();
  }

  function timerHead(extra) {
    return h('div', { class: 'card-head' }, h('h2', { class: 'card-label', id: 'timer-title', text: 'Focus timer' }), extra);
  }

  function buildIdle() {
    const label = textInput({ placeholder: 'What are you working on?', maxlength: 60, list: 'work-labels', enterkeyhint: 'go', 'aria-label': 'What are you working on?', dataset: { key: 'timer-label' } });
    const summary = h('summary', { class: 'disclosure' }, h('span', { text: 'Started earlier?' }));
    const ago = segmented({
      legend: 'I started', value: '0', className: 'seg-wrap',
      options: STARTED_AGO.map((m) => ({ value: m, label: m === 0 ? 'Just now' : m < 60 ? `${m} min ago` : `${hours(m / 60)} h ago` })),
      onChange: (m) => {
        summary.firstChild.textContent = Number(m) ? `Started ${m < 60 ? `${m} min` : `${hours(m / 60)} h`} ago` : 'Started earlier?';
      },
    });
    const start = button('Start session', { kind: 'primary', size: 'xl', type: 'submit', iconName: 'play', className: 'btn-block', dataset: { key: 'timer-start' } });
    const form = h('form', { class: 'timer-idle stack', novalidate: true },
      label, start,
      h('details', { class: 'started-ago' }, summary, ago));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await busy(start, async () => {
        try {
          const res = await api('session.start', { label: label.value.trim(), minutesAgo: Number(ago.value) || 0 });
          toast(voiceLine('working', res.state), { tone: 'gold' });
        } catch (err) {
          toastError(err);
        }
      }, 'Starting…');
    });
    swap(timer, timerHead(h('button', { class: 'link-btn', type: 'button', dataset: { key: 'timer-log' }, onclick: () => openLogWork() }, icon('plus'), 'Log past work')), form);
    timer.classList.remove('is-running');
  }

  function buildRunning(s) {
    t.clock = h('p', { class: 'timer-clock mono', role: 'timer', 'aria-label': 'Time worked this session' }, '00:00:00');
    t.earned = h('span', { class: 'mono is-in' });
    t.since = h('span');
    t.label = textInput({ value: s.session.label, maxlength: 60, list: 'work-labels', enterkeyhint: 'done', dataset: { key: 'timer-rename' } });
    t.saved = h('span', { class: 'saved-tick', 'aria-live': 'polite' });
    t.labelDirty = false;
    t.label.addEventListener('input', () => { t.labelDirty = true; });
    t.label.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); t.label.blur(); } });
    t.label.addEventListener('change', async () => {
      const value = t.label.value.trim();
      if (!store.state.session || value === store.state.session.label) { t.labelDirty = false; return; }
      try {
        await api('session.update', { label: value });
        t.labelDirty = false;
        t.saved.textContent = 'Saved';
        setTimeout(() => { t.saved.textContent = ''; }, 1800);
      } catch (err) {
        toastError(err);
      }
    });
    const stop = button('Stop & bank', { kind: 'gold', size: 'lg', iconName: 'stop', dataset: { key: 'timer-stop' }, onclick: () => openStopSession() });
    const discard = button('Discard', { kind: 'ghost', size: 'lg', dataset: { key: 'timer-discard' }, onclick: () => discardSession(discard) });
    swap(timer,
      timerHead(h('span', { class: 'live' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), 'Live')),
      t.clock,
      h('p', { class: 'timer-sub' }, t.earned, ' earned · ', t.since),
      h('div', { class: 'timer-label-row' }, field({ label: 'Working on', control: t.label }), t.saved),
      h('div', { class: 'timer-actions' }, stop, discard));
    timer.classList.add('is-running');
  }

  /** Once a second while a session runs: the clock and the money it's making. */
  function tick() {
    const s = store.state;
    if (!s || !s.session || timerMode !== 'running' || !t.clock) return;
    const started = Date.parse(s.session.startedAt);
    const seconds = Math.max(0, (serverNow() - started) / 1000);
    t.clock.textContent = clock(seconds);
    t.earned.textContent = `+${money(Math.floor((seconds / 3600) * s.settings.hourlyRate * 100) / 100)}`;
    t.since.textContent = `since ${timeOfDay(started)}`;
  }

  async function discardSession(btn) {
    const ok = await confirmSheet({
      title: 'Discard this session?', message: 'The timer stops and nothing goes into the vault. For when you got distracted and would rather not talk about it.',
      confirmLabel: 'Discard it', danger: true,
    });
    if (!ok) return;
    await busy(btn, async () => {
      try {
        await api('session.stop', { discard: true });
        toast('Discarded. We’ll pretend that didn’t happen.');
      } catch (err) {
        toastError(err);
      }
    });
  }

  function openStopSession() {
    const s = store.state;
    if (!s.session) return;
    const started = Date.parse(s.session.startedAt);
    const elapsed = () => Math.floor((serverNow() - started) / 60000);
    const preview = h('p', { class: 'pay-preview', 'aria-live': 'polite' });
    const timerHint = h('p', { class: 'field-hint' });
    const dur = durationInput({ minutes: Math.min(elapsed(), 1440), legend: 'Time to bank', onChange: () => showPay() }); // a day at most
    const label = textInput({ value: s.session.label, maxlength: 120, list: 'work-labels', enterkeyhint: 'done' });
    const error = h('p', { class: 'msg error', role: 'alert', hidden: true });
    const submit = button('Bank it', { kind: 'gold', type: 'submit', iconName: 'check' });
    const showPay = () => {
      const m = dur.get();
      timerHint.textContent = `The timer says ${duration(elapsed())}. Forgot to stop it? Trim it.`;
      if (m && m > 0) {
        preview.replaceChildren('Pays ', h('strong', { class: 'mono is-in', text: `+${money(workPay(m))}` }), ' into the vault.');
        submit.querySelector('.btn-label').textContent = `Bank +${money(workPay(m))}`;
      } else {
        preview.textContent = 'Under a minute pays nothing. Discard it instead?';
        submit.querySelector('.btn-label').textContent = 'Bank it';
      }
    };
    const form = h('form', { class: 'stack', novalidate: true, id: uid('stop-form') },
      dur.wrap, timerHint, field({ label: 'What was it?', control: label }), preview, error);
    submit.setAttribute('form', form.id);
    const ticker = setInterval(() => { timerHint.textContent = `The timer says ${duration(elapsed())}. Forgot to stop it? Trim it.`; }, 15000);
    const sheet = new Sheet({ title: 'Bank this session', eyebrow: `Started ${timeOfDay(started)}` });
    sheet.onClosed = () => clearInterval(ticker);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const minutes = dur.get();
      if (minutes === null || minutes < 1 || minutes > 1440) {
        error.textContent = minutes === 0 ? 'Bank at least a minute, or discard the session instead.' : 'Bank between 1 minute and 24 hours.';
        error.hidden = false;
        return;
      }
      await busy(submit, async () => {
        try {
          const res = await api('session.stop', { minutes, label: label.value.trim() });
          sheet.close();
          if (!res.logged) {
            toast('Under a minute, so nothing was banked.');
            return;
          }
          toast(voiceLine('praise', res.state), {
            tone: 'gold', detail: `Banked ${duration(res.minutes)} · +${money(res.amount)}`,
            action: () => undoEntry(res.entryId, 'Undone. That session never happened.'),
          });
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        }
      });
    });
    showPay();
    sheet.body.append(form);
    sheet.foot.append(button('Keep going', { onclick: () => sheet.requestClose() }), submit);
    sheet.open();
  }

  /* ───── commands and fines ───── */

  const locks = new Set(); // rule ids with a tap in progress: stops accidental double taps

  function renderRules(container, list, type, s) {
    if (!changed(type, list, s.settings.baseCurrency)) return;
    const isFine = type === 'fine';
    const titleId = isFine ? 'fines-title' : 'commands-title';
    const head = h('div', { class: 'card-head' },
      h('h2', { class: 'card-label', id: titleId, text: isFine ? 'Fines' : 'Commands' }),
      h('span', { class: 'card-aside', text: isFine ? 'Self-report. Honesty is hot.' : 'Obeyed? Tap it.' }));
    if (!list.length) {
      swap(container, head, h('div', { class: 'empty-state' },
        h('p', { class: 'empty-line', text: isFine ? 'No fines yet. Living dangerously.' : 'No commands yet. Write some rules.' }),
        button('Write the rules', { kind: 'ghost', size: 'sm', onclick: () => go('rules') })));
      return;
    }
    swap(container, head, h('div', { class: 'cmd-grid' }, list.map((rule) => {
      const btn = h('button', {
        class: ['cmd', isFine && 'cmd-fine', locks.has(rule.id) && 'is-busy'], type: 'button', dataset: { key: `${type}:${rule.id}`, id: rule.id },
        'aria-label': `${isFine ? 'Fine' : 'Log'}: ${rule.name}, ${isFine ? 'minus' : 'plus'} ${money(rule.amount)}`,
      },
      h('span', { class: 'cmd-emoji', 'aria-hidden': 'true', text: rule.emoji || (isFine ? '⚠️' : '✅') }),
      h('span', { class: 'cmd-name', text: rule.name }),
      h('span', { class: 'cmd-amount mono', text: `${isFine ? '−' : '+'}${money(rule.amount)}` }));
      btn.addEventListener('click', () => tapRule(btn, type, rule));
      return btn;
    })));
  }

  async function tapRule(btn, type, rule) {
    if (locks.has(rule.id)) return;
    locks.add(rule.id);
    const container = btn.closest('.cmd-grid');
    const setBusy = (on) => {
      const current = container && container.isConnected ? container.querySelector(`[data-id="${rule.id}"]`) : btn;
      if (current) current.classList.toggle('is-busy', on);
    };
    setBusy(true);
    const startedAt = performance.now();
    const isFine = type === 'fine';
    try {
      const res = await api('ledger.add', { type: isFine ? 'fine' : 'task', ref: rule.id });
      celebrate(btn, isFine);
      const entry = res.state.ledger.find((e) => e.id === res.entryId);
      toast(isFine ? 'Fined. Actions, meet consequences.' : voiceLine('praise', res.state), {
        tone: isFine ? 'pink' : 'gold',
        detail: `${entry ? entry.label : rule.name} · ${signed(entry ? entry.amount : isFine ? -rule.amount : rule.amount)}`,
        action: () => undoEntry(res.entryId),
      });
    } catch (err) {
      toastError(err);
    } finally {
      // A short lock after each tap: a deliberate second tap still works a moment later.
      setTimeout(() => {
        locks.delete(rule.id);
        setBusy(false);
      }, Math.max(0, 900 - (performance.now() - startedAt)));
    }
  }

  function celebrate(btn, isFine) {
    if (navigator.vibrate) navigator.vibrate(isFine ? [20, 40, 20] : 12);
    if (reducedMotion() || !btn.isConnected) return;
    const pop = h('span', { class: ['cmd-pop', isFine && 'is-out'], 'aria-hidden': 'true', text: btn.querySelector('.cmd-amount').textContent });
    btn.append(pop);
    setTimeout(() => pop.remove(), 900);
  }

  /* ───── money in ───── */

  function buildMoney() {
    const amount = moneyInput({ label: 'Amount', placeholder: '0.00', dataset: { key: 'money-amount' } });
    const label = textInput({ placeholder: 'Where from?', maxlength: 120, enterkeyhint: 'done', 'aria-label': 'Where it came from (paycheck, client, gift…)' });
    const submit = button('Add money', { kind: 'gold', type: 'submit', iconName: 'plus' });
    const error = h('p', { class: 'msg error', role: 'alert', hidden: true });
    const form = h('form', { class: 'money-form', novalidate: true },
      h('div', { class: 'money-row' }, amount.wrap, label), submit, error);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = parseAmount(amount.input.value);
      if (!value || value <= 0) {
        error.textContent = 'How much? Type an amount like 50 or 12.50.';
        error.hidden = false;
        amount.input.focus();
        return;
      }
      error.hidden = true;
      const text = label.value.trim();
      await busy(submit, async () => {
        try {
          const res = await api('ledger.add', { type: 'money', amount: value, label: text });
          form.reset();
          amount.input.blur();
          label.blur();
          toast('Money in. The vault thanks you.', { tone: 'gold', detail: `${text || 'Money in'} · +${money(value)}`, action: () => undoEntry(res.entryId) });
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        }
      });
    });

    // Corrections: a signed amount that doesn't count as tribute.
    const adjAmount = moneyInput({ label: 'Adjustment amount', placeholder: '0.00' });
    const adjSign = segmented({ legend: 'Direction', hideLegend: true, className: 'seg-sign', value: '+', options: [{ value: '+', label: '+ Add' }, { value: '-', label: '− Take out' }] });
    const adjLabel = textInput({ placeholder: 'Why? (e.g. fixing a typo)', maxlength: 120, 'aria-label': 'Reason' });
    const adjSubmit = button('Apply adjustment', { kind: 'ghost', type: 'submit' });
    const adjError = h('p', { class: 'msg error', role: 'alert', hidden: true });
    const adjForm = h('form', { class: 'stack', novalidate: true },
      h('p', { class: 'field-hint', text: 'For corrections. It changes the balance but doesn’t count as tribute or keep a streak alive.' }),
      adjSign, adjAmount.wrap, adjLabel, adjSubmit, adjError);
    adjForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = parseAmount(adjAmount.input.value);
      if (!value || value <= 0) {
        adjError.textContent = 'Type the amount to add or take out.';
        adjError.hidden = false;
        return;
      }
      adjError.hidden = true;
      const signedValue = adjSign.value === '-' ? -value : value;
      const text = adjLabel.value.trim();
      await busy(adjSubmit, async () => {
        try {
          const res = await api('ledger.add', { type: 'adjust', amount: signedValue, label: text });
          adjForm.reset();
          adjSign.value = '+';
          toast('Adjusted.', { detail: `${text || 'Adjustment'} · ${signed(signedValue)}`, action: () => undoEntry(res.entryId) });
        } catch (err) {
          adjError.textContent = err.message;
          adjError.hidden = false;
        }
      });
    });

    swap(moneyCard,
      h('div', { class: 'card-head' }, h('h2', { class: 'card-label', id: 'money-title', text: 'Money in' }), h('span', { class: 'card-aside', text: 'Real money counts too' })),
      form,
      h('details', { class: 'adjust' }, h('summary', { class: 'disclosure' }, h('span', { text: 'Adjust the balance' })), adjForm));
    moneyCard.setCurrency = (cur) => {
      amount.setCurrency(cur);
      adjAmount.setCurrency(cur);
    };
  }

  /* ───── receipts ───── */

  function renderReceipts(s) {
    const minute = Math.floor(serverNow() / 60000); // relative times ("5 min ago") move on
    if (!changed('receipts', s.ledger.slice(0, RECENT), s.ledgerCount, s.settings.baseCurrency, s.settings.timezone, minute)) return;
    const recent = s.ledger.slice(0, RECENT);
    swap(receipts,
      h('div', { class: 'card-head' },
        h('h2', { class: 'card-label', id: 'receipts-title', text: 'Receipts' }),
        s.ledgerCount > 0 && h('button', { class: 'link-btn', type: 'button', dataset: { key: 'ledger-all' }, onclick: () => openLedgerAll() }, `Show all (${s.ledgerCount})`)),
      recent.length
        ? h('ul', { class: 'receipts' }, recent.map((e) => receiptRow(e)))
        : h('p', { class: 'empty-line', text: 'No receipts yet. The vault is waiting, and so am I.' }));
  }

  /* ───── putting it together ───── */

  buildMoney();

  function update(s) {
    eyebrow.textContent = longDay();
    renderVault(s);
    renderGoal(s);
    renderTimer(s);
    renderRules(commands, s.commands, 'task', s);
    renderRules(fines, s.fines, 'fine', s);
    if (changed('currency', s.settings.baseCurrency)) moneyCard.setCurrency(s.settings.baseCurrency);
    renderReceipts(s);
  }

  return { el, update, tick, title: 'Today' };
}
