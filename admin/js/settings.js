/*
 * FINDOM YOURSELF · Control Room: the Settings tab. The words on the site, the voice lines,
 * money and exchange rates, time zone, who can see what, the password, and backups.
 * Everything except the password and backups waits in a draft until "Save changes".
 */
import {
  h, icon, swap, sig, money, currencyName, fullDateTime, deviceTimezone, plural, reducedMotion,
} from './core.js';
import { api, store, downloadBackup } from './api.js';
import {
  field, textInput, textArea, segmented, toggle, toast, toastError, button, busy, note, saveBar, confirmSheet,
} from './ui.js';

const COPY_LABELS = {
  heroKicker: ['Hero kicker', 'The small line above the big headline.'],
  heroIntro: ['Hero intro', 'The paragraph under the headline.'],
  rule1: ['Rule 1', 'Title of the first rule.'],
  rule1Body: ['Rule 1 text', ''],
  rule2: ['Rule 2', ''],
  rule2Body: ['Rule 2 text', '{rate} works well here.'],
  rule3: ['Rule 3', ''],
  rule3Body: ['Rule 3 text', ''],
  vaultIntro: ['Vault intro', ''],
  listIntro: ['Wishlist intro', '{count} = how many things are on the list.'],
  trophyIntro: ['Trophy wall intro', 'Above the things you’ve claimed.'],
  whipIntro: ['Whip section intro', ''],
  footerLine: ['Footer line', ''],
  finePrint: ['Fine print', 'The small print at the very bottom.'],
};
const COPY_GROUPS = [
  ['The top of the page', ['heroKicker', 'heroIntro']],
  ['The three rules', ['rule1', 'rule1Body', 'rule2', 'rule2Body', 'rule3', 'rule3Body']],
  ['Section intros', ['vaultIntro', 'listIntro', 'trophyIntro', 'whipIntro']],
  ['The bottom of the page', ['footerLine', 'finePrint']],
];
const MOODS = {
  taunts: ['Taunts', 'Random jabs around the site.'],
  working: ['While working', 'Shown while the focus timer runs. Also what you hear when you start one here.'],
  slacking: ['Slacking', 'When nothing’s been logged for a while. {since} = how long.'],
  praise: ['Praise', 'Right after tribute, and in the Control Room after every command.'],
  unlocked: ['Unlocked', 'When the vault covers something. {item} = its name.'],
  empty: ['Empty vault', 'When there’s nothing in the vault.'],
};
const PLACEHOLDERS = [
  ['{rate}', 'hourly rate'], ['{goal}', 'current goal'], ['{hours}', 'hours of work left for it'], ['{balance}', 'vault balance'],
  ['{streak}', 'streak in days'], ['{since}', 'time since the last tribute'], ['{count}', 'items on the list'], ['{item}', 'the item just unlocked'],
];
const VISIBILITY = [
  { value: 'public', label: 'Public', hint: 'Everything shows, amounts included.' },
  { value: 'hide-amounts', label: 'Hide amounts', hint: 'The list and progress show, the money figures don’t.' },
  { value: 'private', label: 'Private', hint: 'Only people with the passcode get in.' },
];
const lines = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
const rate = (v) => {
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
};

export function createSettings() {
  const meta = store.meta;
  let draft = null;
  let savedSig = '';
  let stateSig = '';

  const fromState = (s) => ({
    title: s.settings.title,
    tagline: s.settings.tagline,
    copy: { ...s.settings.copy },
    voice: Object.fromEntries(meta.voiceMoods.map((m) => [m, (s.settings.voice[m] || []).join('\n')])),
    baseCurrency: s.settings.baseCurrency,
    fx: Object.fromEntries(Object.entries(s.settings.fx).map(([k, v]) => [k, String(v)])),
    timezone: s.settings.timezone,
    visibility: s.settings.visibility,
    passcode: '',
    showLive: s.settings.showLive,
    showLedger: s.settings.showLedger,
    whip: s.settings.whip,
    goalId: s.settings.goalId,
  });
  const comparable = (d) => ({
    ...d,
    title: d.title.trim(),
    tagline: d.tagline.trim(),
    copy: Object.fromEntries(Object.entries(d.copy).map(([k, v]) => [k, String(v).trim()])),
    voice: Object.fromEntries(Object.entries(d.voice).map(([k, v]) => [k, lines(v)])),
    fx: Object.fromEntries(Object.entries(d.fx).filter(([, v]) => String(v).trim() !== '').map(([k, v]) => [k, rate(v) ?? v])),
  });
  const isDirty = () => !!draft && sig(comparable(draft)) !== savedSig;
  const bar = saveBar({ onSave: save, onDiscard: () => fill(store.state) });
  const sync = () => {
    bar.show(isDirty());
    baseWarning.hidden = draft.baseCurrency === store.state.settings.baseCurrency;
    passcodeField.hidden = draft.visibility !== 'private';
    renderFx();
  };
  const bind = (input, key, sub) => {
    input.addEventListener('input', () => {
      if (sub) draft[key][sub] = input.value;
      else draft[key] = input.value;
      sync();
    });
  };

  /* ───── site words ───── */

  const titleIn = textInput({ maxlength: 60 });
  const taglineIn = textInput({ maxlength: 140 });
  bind(titleIn, 'title');
  bind(taglineIn, 'tagline');
  const copyInputs = {};
  const copyGroups = COPY_GROUPS.map(([heading, keys]) => h('fieldset', { class: 'copy-group' },
    h('legend', { class: 'group-label', text: heading }),
    keys.filter((k) => meta.copyFields[k]).map((key) => {
      const max = meta.copyFields[key];
      const input = max > 60 ? textArea({ maxlength: max, rows: max > 400 ? 4 : max > 140 ? 3 : 2, class: 'input textarea textarea-short' }) : textInput({ maxlength: max });
      copyInputs[key] = input;
      bind(input, 'copy', key);
      const [label, hint] = COPY_LABELS[key] || [key, ''];
      return field({ label, control: input, hint, counter: max });
    })));
  // Any copy fields added on the server later still get a box.
  const extra = Object.keys(meta.copyFields).filter((k) => !COPY_GROUPS.some(([, keys]) => keys.includes(k)));
  if (extra.length) {
    copyGroups.push(h('fieldset', { class: 'copy-group' }, h('legend', { class: 'group-label', text: 'More' }), extra.map((key) => {
      const input = textArea({ maxlength: meta.copyFields[key], rows: 2 });
      copyInputs[key] = input;
      bind(input, 'copy', key);
      return field({ label: key, control: input, counter: meta.copyFields[key] });
    })));
  }
  const wordsCard = h('section', { class: 'card', 'aria-labelledby': 'words-title' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-label', id: 'words-title', text: 'Site words' }), h('a', { class: 'link-btn', href: '../', target: '_blank', rel: 'noopener' }, 'See them live ', icon('external'))),
    h('div', { class: 'stack' },
      field({ label: 'Site title', control: titleIn, counter: 60 }),
      field({ label: 'Tagline', control: taglineIn, counter: 140 }),
      h('details', { class: 'placeholders' },
        h('summary', { class: 'disclosure' }, h('span', { text: 'Placeholders you can use' })),
        h('dl', { class: 'placeholder-list' }, PLACEHOLDERS.map(([code, meaning]) => [h('dt', null, h('code', { text: code })), h('dd', { text: meaning })])),
        h('p', { class: 'field-hint', text: 'Leave a box empty to bring back the original words.' })),
      copyGroups));

  /* ───── voice ───── */

  const voiceInputs = {};
  const voiceCounts = {};
  const voiceCard = h('section', { class: 'card', 'aria-labelledby': 'voice-title' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-label', id: 'voice-title', text: 'Voice lines' }), h('span', { class: 'card-aside', text: 'One line per row' })),
    h('p', { class: 'card-lede', text: 'What the site says, by mood. It picks a line at random.' }),
    h('div', { class: 'stack' }, meta.voiceMoods.map((mood) => {
      const input = textArea({ rows: 5, class: 'input textarea voice-text', spellcheck: 'true' });
      voiceInputs[mood] = input;
      const count = h('span', { class: 'counter' });
      voiceCounts[mood] = count;
      input.addEventListener('input', () => {
        draft.voice[mood] = input.value;
        count.textContent = plural(lines(input.value).length, 'line');
        sync();
      });
      const [label, hint] = MOODS[mood] || [mood, ''];
      const wrap = field({ label, control: input, hint });
      wrap.querySelector('.field-label').append(count);
      return wrap;
    })));

  /* ───── money ───── */

  const baseSelect = h('select', { class: 'input select' }, meta.currencies.map((c) => h('option', { value: c, text: `${c} · ${currencyName(c)}` })));
  baseSelect.addEventListener('change', () => {
    draft.baseCurrency = baseSelect.value;
    sync();
  });
  const baseWarning = note('warn', 'Heads up: amounts already in the vault and the ledger keep their numbers and just get the new label ($100 becomes €100). Nothing is converted. Exchange rates are re-expressed against the new currency when you save.');
  baseWarning.hidden = true;
  const fxBox = h('div', { class: 'fx' });
  const fxUpdated = h('p', { class: 'field-hint' });
  const fxRefresh = button('Refresh rates', { size: 'sm', iconName: 'refresh' });
  fxRefresh.addEventListener('click', () => busy(fxRefresh, async () => {
    try {
      const res = await api('fx.refresh', {});
      const got = Object.entries(res.rates || {});
      // The fresh rates replace any typed here; other unsaved edits stay.
      draft.fx = Object.fromEntries(Object.entries(store.state.settings.fx).map(([k, v]) => [k, String(v)]));
      savedSig = sig(comparable(fromState(store.state)));
      renderFx(true);
      sync();
      toast(got.length ? `Rates refreshed: ${got.map(([c, r]) => `1 ${c} = ${money(r)}`).join(', ')}` : 'No other currencies to refresh.');
    } catch (e) {
      toastError(e);
    }
  }, 'Refreshing…'));
  let fxSig = '';
  function renderFx(force = false) {
    const s = store.state;
    const base = draft.baseCurrency;
    const used = new Set(s.items.map((i) => i.currency));
    const codes = [...new Set([...used, ...Object.keys(draft.fx)])].filter((c) => c && c !== base).sort();
    const locked = base !== s.settings.baseCurrency;
    const next = sig(codes, base, locked, [...used].sort());
    fxUpdated.textContent = s.settings.fxUpdatedAt ? `Rates last refreshed ${fullDateTime(s.settings.fxUpdatedAt)}.` : 'Rates have only been typed by hand so far.';
    if (!force && next === fxSig) return;
    fxSig = next;
    if (!codes.length) {
      swap(fxBox, h('p', { class: 'muted', text: `Every price is in ${base}. Nothing to convert.` }));
      return;
    }
    swap(fxBox, h('div', { class: 'fx-rows' }, codes.map((code) => {
      const input = h('input', {
        class: 'input mono fx-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: draft.fx[code] || '',
        placeholder: 'rate', 'aria-label': `${base} per 1 ${code}`, disabled: locked, dataset: { key: `fx:${code}` },
      });
      input.addEventListener('input', () => {
        draft.fx[code] = input.value;
        row.classList.toggle('is-missing', !rate(input.value));
        bar.show(isDirty());
      });
      const count = s.items.filter((i) => i.currency === code).length;
      const row = h('div', { class: ['fx-row', !rate(draft.fx[code] || '') && 'is-missing'] },
        h('span', { class: 'fx-left mono', text: `1 ${code} =` }), input, h('span', { class: 'fx-right mono', text: base }),
        h('span', { class: 'fx-note', text: count ? `${plural(count, 'item')}${rate(draft.fx[code] || '') ? '' : ' · counted 1:1 until you add a rate'}` : 'not used right now' }));
      return row;
    })));
  }
  const moneyCard = h('section', { class: 'card', 'aria-labelledby': 'money-set-title' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-label', id: 'money-set-title', text: 'Money' })),
    h('div', { class: 'stack' },
      field({ label: 'Vault currency', control: baseSelect, hint: 'The vault, the hourly rate and every receipt are in this currency.' }),
      baseWarning,
      h('div', { class: 'field' },
        h('div', { class: 'field-label-row' }, h('span', { class: 'field-label', text: 'Exchange rates' }), fxRefresh),
        fxBox, fxUpdated)));

  /* ───── time zone ───── */

  let tzControl;
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch (e) {
    zones = [];
  }
  if (zones.length) {
    tzControl = h('select', { class: 'input select' });
  } else {
    tzControl = textInput({ placeholder: 'Europe/London', autocapitalize: 'off', spellcheck: 'false' });
  }
  const fillZones = (current) => {
    if (!zones.length) return;
    const all = [...new Set([...zones, 'UTC', current])].filter(Boolean).sort();
    const groups = new Map();
    for (const z of all) {
      const region = z.includes('/') ? z.split('/')[0] : 'Other';
      if (!groups.has(region)) groups.set(region, []);
      groups.get(region).push(z);
    }
    tzControl.replaceChildren(...[...groups].map(([region, list]) => h('optgroup', { label: region }, list.map((z) => h('option', { value: z, text: z.replace(/_/g, ' ') })))));
  };
  tzControl.addEventListener(zones.length ? 'change' : 'input', () => {
    draft.timezone = tzControl.value.trim();
    syncTz();
    sync();
  });
  const tzDevice = h('div', { class: 'tz-device' });
  function syncTz() {
    const device = deviceTimezone();
    if (device && device !== draft.timezone) {
      swap(tzDevice, button(`Use this device’s: ${device.replace(/_/g, ' ')}`, { size: 'sm', iconName: 'clock', onclick: () => {
        if (zones.length && !Array.from(tzControl.options).some((o) => o.value === device)) fillZones(device);
        tzControl.value = device;
        draft.timezone = device;
        syncTz();
        sync();
      } }));
    } else {
      swap(tzDevice, device ? h('p', { class: 'field-hint', text: 'Same as this device.' }) : null);
    }
  }
  const tzCard = h('section', { class: 'card', 'aria-labelledby': 'tz-title' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-label', id: 'tz-title', text: 'Time zone' })),
    field({ label: 'Your time zone', control: tzControl, hint: 'Decides when a day starts: “earned today”, streaks, and the times on receipts.' }),
    tzDevice);

  /* ───── visibility ───── */

  const visSeg = segmented({ legend: 'Who can see the site', options: VISIBILITY, value: 'public', className: 'seg-fill seg-stack-phone', onChange: (v) => { draft.visibility = v; syncVisHint(); sync(); } });
  const visHint = h('p', { class: 'field-hint' });
  const syncVisHint = () => { visHint.textContent = (VISIBILITY.find((v) => v.value === draft.visibility) || VISIBILITY[0]).hint; };
  const passcode = textInput({ autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', minlength: 4, maxlength: 100 });
  bind(passcode, 'passcode');
  const passcodeField = field({ label: 'Passcode for visitors', control: passcode, hint: 'Share it with whoever gets to watch. At least 4 characters.' });
  const liveToggle = toggle({ label: 'Live timer light', hint: 'Visitors see when a focus session is running.', onChange: (v) => { draft.showLive = v; sync(); } });
  const ledgerToggle = toggle({ label: 'Public receipts', hint: 'The latest tributes and fines show on the site.', onChange: (v) => { draft.showLedger = v; sync(); } });
  const whipToggle = toggle({ label: 'Crack-the-whip section', hint: 'Visitors can crack the whip at you. You’ll see the count on Today.', onChange: (v) => { draft.whip = v; sync(); } });
  const goalSelect = h('select', { class: 'input select' });
  goalSelect.addEventListener('change', () => {
    draft.goalId = goalSelect.value;
    sync();
  });
  let goalSig = '';
  function renderGoalOptions(s) {
    const wishing = s.items.filter((i) => i.status === 'wishing');
    const next = sig(wishing.map((i) => [i.id, i.name, i.brand, i.priceBase]), draft.goalId, s.settings.baseCurrency);
    if (next === goalSig) return;
    goalSig = next;
    const options = [h('option', { value: '', text: 'Automatic: the cheapest thing on the list' })];
    for (const i of wishing) options.push(h('option', { value: i.id, text: `${i.brand ? `${i.brand} · ` : ''}${i.name}${i.priceMissing ? '' : ` · ${money(i.priceBase)}`}` }));
    if (draft.goalId && !wishing.some((i) => i.id === draft.goalId)) {
      const other = s.items.find((i) => i.id === draft.goalId);
      if (other) options.push(h('option', { value: other.id, text: `${other.name} (${other.status})` }));
    }
    goalSelect.replaceChildren(...options);
    goalSelect.value = draft.goalId;
  }
  const visCard = h('section', { class: 'card', 'aria-labelledby': 'vis-title' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-label', id: 'vis-title', text: 'Visibility' })),
    h('div', { class: 'stack' },
      visSeg, visHint, passcodeField,
      h('div', { class: 'switch-list' }, liveToggle, ledgerToggle, whipToggle),
      field({ label: 'Pinned goal', control: goalSelect, hint: 'The one thing the site shows off as “the goal”.' })));

  /* ───── account ───── */

  const currentPw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const nextPw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: 10, required: true });
  const againPw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: 10, required: true });
  const pwError = h('p', { class: 'msg error', role: 'alert', hidden: true });
  const pwSubmit = button('Change password', { type: 'submit', iconName: 'lock' });
  const pwForm = h('form', { class: 'stack', novalidate: true },
    h('input', { type: 'text', name: 'username', value: 'owner', autocomplete: 'username', hidden: true, tabindex: '-1', 'aria-hidden': 'true' }),
    field({ label: 'Current password', control: currentPw }),
    field({ label: 'New password', control: nextPw, hint: 'At least 10 characters.' }),
    field({ label: 'New password again', control: againPw }),
    pwError, h('div', { class: 'row-end' }, pwSubmit));
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fail = (message, input) => {
      pwError.textContent = message;
      pwError.hidden = false;
      if (input) input.focus();
    };
    pwError.hidden = true;
    if (!currentPw.value) return fail('Type your current password.', currentPw);
    if (nextPw.value.length < 10) return fail('Use at least 10 characters for the new password.', nextPw);
    if (nextPw.value !== againPw.value) return fail('The two new passwords don’t match.', againPw);
    await busy(pwSubmit, async () => {
      try {
        await api('password.change', { current: currentPw.value, next: nextPw.value });
        pwForm.reset();
        toast('Password changed. Don’t forget it.');
      } catch (err) {
        fail(err.message);
      }
    });
    return undefined;
  });
  const accountCard = h('section', { class: 'card', 'aria-labelledby': 'account-title' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-label', id: 'account-title', text: 'Password' })), pwForm);

  /* ───── backup ───── */

  const restoreInput = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  const downloadBtn = button('Download backup', { iconName: 'download', kind: 'gold' });
  downloadBtn.addEventListener('click', () => busy(downloadBtn, async () => {
    try {
      const name = await downloadBackup();
      toast(`Backup saved as ${name}.`);
    } catch (e) {
      toastError(e);
    }
  }, 'Preparing…'));
  const restoreBtn = button('Restore from a file', { iconName: 'upload', onclick: () => { restoreInput.value = ''; restoreInput.click(); } });
  restoreInput.addEventListener('change', async () => {
    const file = restoreInput.files && restoreInput.files[0];
    if (!file) return;
    if (file.size > 20 * 1048576) {
      toast('That file is over 20 MB. It isn’t a backup from here.', { tone: 'error' });
      return;
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      toast('That file isn’t readable JSON. Pick a backup downloaded from here.', { tone: 'error' });
      return;
    }
    if (!data || typeof data !== 'object' || (!Array.isArray(data.items) && !Array.isArray(data.ledger))) {
      toast('That file isn’t a Findom Yourself backup.', { tone: 'error' });
      return;
    }
    const items = Array.isArray(data.items) ? data.items.length : 0;
    const entries = Array.isArray(data.ledger) ? data.ledger.length : 0;
    const ok = await confirmSheet({
      title: 'Replace everything with this backup?',
      message: `The backup has ${plural(items, 'item')} and ${plural(entries, 'receipt')}${data.updatedAt ? `, saved ${fullDateTime(data.updatedAt)}` : ''}. Everything here now (list, ledger, rules, settings) is replaced. Download a backup first if you’re not sure.`,
      confirmLabel: 'Replace everything', danger: true,
    });
    if (!ok) return;
    await busy(restoreBtn, async () => {
      try {
        const res = await api('data.import', { data });
        fill(store.state);
        toast(`Restored: ${plural(res.items, 'item')}, ${plural(res.entries, 'receipt')}.`);
      } catch (e) {
        toastError(e);
      }
    }, 'Restoring…');
  });
  const backupCard = h('section', { class: 'card', 'aria-labelledby': 'backup-title' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-label', id: 'backup-title', text: 'Backup' })),
    h('p', { class: 'card-lede', text: 'One file with everything: the list, every receipt, rules and settings. Photos stay on the server.' }),
    h('div', { class: 'button-row' }, downloadBtn, restoreBtn), restoreInput);

  // On a phone the page is long: chips jump straight to each card.
  const sections = [[wordsCard, 'Words'], [voiceCard, 'Voice'], [visCard, 'Visibility'], [moneyCard, 'Money'], [tzCard, 'Time zone'], [accountCard, 'Password'], [backupCard, 'Backup']];
  const jump = h('nav', { class: 'chips jump-chips', 'aria-label': 'Jump to' }, sections.map(([card, label]) => h('button', {
    class: 'chip', type: 'button', text: label,
    onclick: () => {
      card.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
      const heading = card.querySelector('h2');
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    },
  })));

  const el = h('section', { class: 'view view-settings', id: 'view-settings', 'aria-labelledby': 'settings-title', hidden: true },
    h('header', { class: 'view-head' },
      h('p', { class: 'eyebrow', text: 'Settings' }),
      h('h1', { class: 'view-title', id: 'settings-title' }, 'The fine ', h('em', { text: 'print' })),
      h('p', { class: 'view-sub', text: 'Words, voice, money, and who gets to watch.' })),
    jump,
    h('div', { class: 'settings-grid' },
      h('div', { class: 'col' }, wordsCard, voiceCard),
      h('div', { class: 'col' }, visCard, moneyCard, tzCard, accountCard, backupCard)),
    bar.el);

  /* ───── filling in and saving ───── */

  function fill(s) {
    draft = fromState(s);
    savedSig = sig(comparable(draft));
    titleIn.value = draft.title;
    taglineIn.value = draft.tagline;
    for (const [key, input] of Object.entries(copyInputs)) {
      input.value = draft.copy[key] || '';
      input.dispatchEvent(new Event('input')); // refresh counters (harmless: same value)
    }
    for (const [mood, input] of Object.entries(voiceInputs)) {
      input.value = draft.voice[mood] || '';
      voiceCounts[mood].textContent = plural(lines(input.value).length, 'line');
    }
    titleIn.dispatchEvent(new Event('input'));
    taglineIn.dispatchEvent(new Event('input'));
    baseSelect.value = draft.baseCurrency;
    fillZones(draft.timezone);
    tzControl.value = draft.timezone;
    syncTz();
    visSeg.value = draft.visibility;
    syncVisHint();
    passcode.value = '';
    passcode.placeholder = s.settings.hasPasscode ? 'A passcode is set. Type a new one to change it.' : 'At least 4 characters';
    liveToggle.input.checked = draft.showLive;
    ledgerToggle.input.checked = draft.showLedger;
    whipToggle.input.checked = draft.whip;
    goalSig = '';
    renderGoalOptions(s);
    renderFx(true);
    sync();
  }

  async function save() {
    const s = store.state;
    const saved = fromState(s);
    const patch = {};
    if (draft.title.trim() !== saved.title) patch.title = draft.title.trim();
    if (draft.tagline.trim() !== saved.tagline) patch.tagline = draft.tagline.trim();
    const copy = {};
    for (const key of Object.keys(copyInputs)) {
      if (String(draft.copy[key] || '').trim() !== String(saved.copy[key] || '')) copy[key] = String(draft.copy[key] || '').trim();
    }
    if (Object.keys(copy).length) patch.copy = copy;
    const voice = {};
    for (const mood of meta.voiceMoods) {
      const next = lines(draft.voice[mood]);
      if (sig(next) !== sig(s.settings.voice[mood] || [])) voice[mood] = next;
    }
    if (Object.keys(voice).length) patch.voice = voice;
    if (draft.baseCurrency !== saved.baseCurrency) {
      patch.baseCurrency = draft.baseCurrency;
    } else {
      const fx = {};
      for (const [code, value] of Object.entries(draft.fx)) {
        if (String(value).trim() === '') continue;
        const r = rate(value);
        if (r === null) throw new Error(`The rate for ${code} needs to be a number above 0, like 1.17.`);
        fx[code] = r;
      }
      if (sig(fx) !== sig(Object.fromEntries(Object.entries(s.settings.fx).map(([k, v]) => [k, v])))) patch.fx = fx;
    }
    if (draft.timezone !== saved.timezone) patch.timezone = draft.timezone;
    if (draft.visibility !== saved.visibility) patch.visibility = draft.visibility;
    if (draft.passcode.trim()) {
      if (draft.passcode.trim().length < 4) throw new Error('Use at least 4 characters for the passcode.');
      patch.passcode = draft.passcode.trim();
    }
    if (draft.visibility === 'private' && !s.settings.hasPasscode && !patch.passcode) {
      passcode.focus();
      throw new Error('Choose a passcode to make the site private.');
    }
    for (const key of ['showLive', 'showLedger', 'whip', 'goalId']) {
      if (draft[key] !== saved[key]) patch[key] = draft[key];
    }
    if (!Object.keys(patch).length) {
      fill(s);
      return;
    }
    await api('settings.save', { settings: patch });
    const after = store.state;
    fill(after);
    if (patch.timezone && after.settings.timezone !== patch.timezone) {
      toast('The server didn’t recognise that time zone, so it kept the old one. Try a nearby city.', { tone: 'error' });
    } else {
      toast(patch.passcode ? 'Saved. The new passcode works now.' : 'Saved. The site’s updated.');
    }
  }

  function update(s) {
    const next = sig(s.settings, s.items.map((i) => [i.id, i.name, i.brand, i.status, i.currency, i.priceBase]));
    if (next === stateSig) return;
    stateSig = next;
    if (!draft || !isDirty()) {
      fill(s);
    } else {
      renderGoalOptions(s); // keep the choices current without touching edits
      renderFx();
    }
  }

  return { el, update, isDirty, title: 'Settings' };
}
