/*
 * FINDOM YOURSELF · Control Room: the Settings tab. The words on the site, the voice lines,
 * money and exchange rates, time zone, who can see what, the password, affiliate links, and
 * backups. Everything except the password, backups, teaching a link and deleting what it
 * learned waits in a draft until "Save changes".
 */
import {
  h, icon, swap, sig, uid, money, currencyName, fullDateTime, deviceTimezone, plural, hostOf, extractUrl, reducedMotion,
} from './core.js';
import { api, store, downloadBackup } from './api.js';
import {
  field, textInput, textArea, segmented, toggle, toast, toastError, button, busy, note, saveBar, confirmSheet,
} from './ui.js';
import { bookmarkletLink } from './grab.js';

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
const OWN_CARD_COPY = ['affiliateNote']; // copy fields edited in their own card, not under Site words
const NETWORKS = [{ value: 'none', label: 'Off' }, { value: 'skimlinks', label: 'Skimlinks' }, { value: 'sovrn', label: 'Sovrn' }];
const NETWORK_IDS = {
  skimlinks: ['Skimlinks publisher ID', 'Your publisher ID, like 123456X1234567 (Skimlinks → Settings → Sites).', '123456X1234567'],
  sovrn: ['Sovrn Commerce API key', 'Your site’s API key (Sovrn Commerce → Settings → Sites, key icon).', '32 letters and numbers'],
};
const SIGN_UP = [
  ['Amazon Associates', 'https://affiliate-program.amazon.com/', 'Amazon links. A tag per country.'],
  ['Skimlinks', 'https://skimlinks.com/', 'One ID for most other shops.'],
  ['Sovrn Commerce', 'https://www.sovrn.com/commerce/', 'Same idea as Skimlinks: pick one.'],
  ['ShopMy', 'https://shopmy.us/', 'Fashion creator links, made in their app.'],
  ['LTK', 'https://company.shopltk.com/', 'Creator links, made in their app.'],
];
const lines = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
const domainList = (text) => String(text || '').split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
const networkName = (network) => String(network || '').replace(/\s*\(.*\)$/, '');
const rate = (v) => {
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
};

export function createSettings() {
  const meta = store.meta;
  const markets = meta.amazonMarketplaces || { com: 'amazon.com (US)' };
  let draft = null;
  let savedSig = '';
  let stateSig = '';

  /** The affiliate settings as the form holds them (a tag box for every Amazon store). */
  const affFrom = (s) => {
    const a = s.settings.affiliate || {};
    return {
      enabled: a.enabled !== false,
      amazon: Object.fromEntries(Object.keys(markets).map((m) => [m, (a.amazon && a.amazon[m]) || ''])),
      network: a.network || 'none',
      networkId: a.networkId || '',
      exclude: (a.exclude || []).join('\n'),
    };
  };
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
    affiliate: affFrom(s),
  });
  const comparable = (d) => ({
    ...d,
    title: d.title.trim(),
    tagline: d.tagline.trim(),
    copy: Object.fromEntries(Object.entries(d.copy).map(([k, v]) => [k, String(v).trim()])),
    voice: Object.fromEntries(Object.entries(d.voice).map(([k, v]) => [k, lines(v)])),
    fx: Object.fromEntries(Object.entries(d.fx).filter(([, v]) => String(v).trim() !== '').map(([k, v]) => [k, rate(v) ?? v])),
    affiliate: {
      enabled: d.affiliate.enabled,
      amazon: Object.fromEntries(Object.entries(d.affiliate.amazon).map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => v)),
      network: d.affiliate.network,
      networkId: d.affiliate.network === 'none' ? '' : d.affiliate.networkId.trim(),
      exclude: domainList(d.affiliate.exclude),
    },
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
  const extra = Object.keys(meta.copyFields).filter((k) => !OWN_CARD_COPY.includes(k) && !COPY_GROUPS.some(([, keys]) => keys.includes(k)));
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
  const passcode = textInput({ autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', minlength: 8, maxlength: 100 });
  bind(passcode, 'passcode');
  const passcodeField = field({ label: 'Passcode for visitors', control: passcode, hint: 'Share it with whoever gets to watch. At least 8 characters.' });
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

  /* ───── affiliate links ───── */

  const affToggle = toggle({
    label: 'Use affiliate links on the site',
    hint: 'Off: buttons go straight to the shop. Links you added to an item as “Your link” are still used.',
    onChange: (v) => { draft.affiliate.enabled = v; sync(); },
  });
  const clicksAside = h('span', { class: 'card-aside mono' });

  // Amazon: a tag per store. amazon.com up front, the other countries folded away.
  const amazonIns = {};
  const amazonInput = (market) => {
    const input = textInput({ class: 'input mono', maxlength: 40, autocapitalize: 'off', spellcheck: 'false', placeholder: market === 'com' ? 'yourname-20' : '' });
    amazonIns[market] = input;
    input.addEventListener('input', () => {
      draft.affiliate.amazon[market] = input.value;
      syncMarkets();
      sync();
    });
    return input;
  };
  const otherMarkets = Object.keys(markets).filter((m) => m !== 'com');
  const otherSummary = h('span', { text: 'Other Amazon stores' });
  const amazonGroup = h('fieldset', { class: 'copy-group' },
    h('legend', { class: 'group-label', text: 'Amazon Associates' }),
    field({ label: `Tag for ${markets.com || 'amazon.com (US)'}`, control: amazonInput('com'), hint: 'Your tracking ID from Amazon Associates, like yourname-20.' }),
    otherMarkets.length ? h('details', { class: 'placeholders aff-markets' },
      h('summary', { class: 'disclosure' }, otherSummary),
      h('div', { class: 'market-rows' }, otherMarkets.map((m) => field({ label: markets[m], control: amazonInput(m) })))) : null);
  const syncMarkets = () => {
    const set = otherMarkets.filter((m) => String(draft.affiliate.amazon[m] || '').trim()).length;
    otherSummary.textContent = set ? `Other Amazon stores (${set} set)` : 'Other Amazon stores';
  };

  // Everything else: one catch-all network ID.
  const netSeg = segmented({
    legend: 'Catch-all network', hideLegend: true, options: NETWORKS, value: 'none', className: 'seg-fill',
    onChange: (v) => { draft.affiliate.network = v; syncNetwork(); sync(); },
  });
  const netId = textInput({ class: 'input mono', maxlength: 64, autocapitalize: 'off', spellcheck: 'false' });
  netId.addEventListener('input', () => { draft.affiliate.networkId = netId.value; sync(); });
  const netIdField = field({ label: NETWORK_IDS.skimlinks[0], control: netId, hint: NETWORK_IDS.skimlinks[1] });
  function syncNetwork() {
    const [label, hint, placeholder] = NETWORK_IDS[draft.affiliate.network] || NETWORK_IDS.skimlinks;
    netIdField.hidden = draft.affiliate.network === 'none';
    netIdField.querySelector('.field-label span').textContent = label;
    netIdField.querySelector('.field-hint').textContent = hint;
    netId.placeholder = placeholder;
  }
  const networkGroup = h('fieldset', { class: 'copy-group' },
    h('legend', { class: 'group-label', text: 'Everything else, automatically' }),
    h('p', { class: 'field-hint', text: 'One ID turns links to about 50,000 shops (Gucci, Farfetch, Net-a-Porter, SSENSE, Nordstrom…) into affiliate links. Shops without a program still just work. Amazon never goes through these.' }),
    netSeg, netIdField);

  // Teach it a link: one deep link she made becomes the rule for that whole shop.
  const teachIn = h('input', {
    class: 'input', type: 'url', inputmode: 'url', id: uid('teach'), placeholder: 'Paste an affiliate link you made (Awin, Rakuten, CJ, Impact…)',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go',
  });
  const teachBtn = button('Check', { type: 'submit', iconName: 'search' });
  const teachResult = h('div', { class: 'teach-result', 'aria-live': 'polite' });
  const teachForm = h('form', { class: 'teach-form', novalidate: true },
    h('label', { class: 'visually-hidden', for: teachIn.id, text: 'An affiliate link you made' }),
    h('div', { class: 'teach-row' }, teachIn, teachBtn),
    h('p', { class: 'field-hint', text: 'Make a deep link to any product in your network and paste it here. It learns the pattern and uses it for every link to that shop.' }));
  teachIn.addEventListener('input', () => { if (teachResult.firstChild) teachResult.replaceChildren(); });
  teachForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = teachIn.value.trim();
    const link = /^https?:\/\/\S+$/i.test(raw) ? raw : extractUrl(raw);
    if (!link) {
      teachResult.replaceChildren(note('error', 'Paste the whole link, starting with https://'));
      teachIn.focus();
      return;
    }
    await busy(teachBtn, async () => {
      try {
        showTeach(await api('affiliate.detect', { url: link }), link);
      } catch (err) {
        teachResult.replaceChildren(note('error', err.message));
      }
    }, 'Checking…');
  });

  /** What a checked link is, where that shop's visitors go now, and what it could learn. */
  function showTeach(res, link) {
    const found = res.detected;
    const learn = res.suggestion;
    const network = found ? networkName(found.network) : '';
    const shop = (learn && learn.domain) || (found ? hostOf(found.destination) : hostOf(link));
    const plainShort = !!found && found.network === 'Short link'; // bit.ly and co: no network of its own
    let title;
    if (!found) title = `A plain link to ${shop || 'a shop'}, not an affiliate link`;
    else if (found.kind === 'amazon') title = `Amazon link with the tag ${found.id}`;
    else if (found.kind === 'wrapper' && shop) title = `${network} link for ${shop}`;
    else if (plainShort) title = 'A short link';
    else title = `${network} link`;
    const body = [h('p', { class: 'teach-title', text: title })];
    const preview = res.preview;
    if (preview && preview.kind !== 'none' && shop && !(found && ['creator', 'short'].includes(found.kind))) {
      body.push(h('p', { class: 'muted' }, `Right now, visitors going to ${shop} get: `, h('strong', { text: preview.label }), '.'));
    }
    let tone = 'info';
    const known = learn ? learned(learn) : null;
    if (known === 'same') {
      tone = 'ok';
      body.push(h('p', { text: 'Already set up that way. Nothing to change.' }));
    } else if (known === 'excluded') {
      body.push(h('p', { text: `${learn.domain} is on your “Never use affiliate links for” list, so its buttons stay plain links. Take it off that list first.` }));
    } else if (learn) {
      tone = 'ok';
      const instead = known === 'other' ? ' instead' : ''; // it replaces what's there for that shop, store or catch-all
      const label = learn.rule ? `Use it for all ${learn.domain} links${instead}`
        : learn.amazon ? `Save ${Object.values(learn.amazon)[0]} as your Amazon tag${instead}` : `Use ${network} for every other shop${instead}`;
      const use = button(label, { kind: 'primary', size: 'sm', iconName: 'sparkle', className: 'btn-wrap' });
      use.addEventListener('click', () => busy(use, async () => {
        try {
          const done = await api('affiliate.learn', { url: link });
          teachIn.value = '';
          teachResult.replaceChildren(note('ok', h('p', { text: `Learned: ${done.applied}. Visitors go through it from now on.` })));
          toast(`Learned: ${done.applied}.`, { tone: 'gold' });
        } catch (err) {
          teachResult.replaceChildren(note('error', err.message));
        }
      }));
      body.push(h('div', { class: 'button-row learn-row' }, use));
    } else if (plainShort) {
      body.push(h('p', { text: 'A short link hides the shop it leads to, so there’s no pattern to learn. If it’s your link for one product, paste it into that item’s “Your link”.' }));
    } else if (found && ['creator', 'short'].includes(found.kind)) {
      body.push(h('p', { text: 'Links like this are made for one product, so there’s no pattern to learn. Paste it into that item’s “Your link” instead.' }));
    } else if (!found) {
      body.push(h('p', { text: 'Paste a link you made in your affiliate network: it has the shop’s link inside it.' }));
    } else {
      body.push(h('p', { text: 'There’s nothing to learn from this one. Make a deep link to a product page and paste that.' }));
    }
    teachResult.replaceChildren(note(tone, body));
  }

  /**
   * What learning would do to the saved settings: 'same' (nothing), 'other' (replace a tag, rule or ID),
   * 'excluded' (a rule for a shop she said never to use), or null (add).
   */
  function learned(learn) {
    const a = store.state.settings.affiliate || {};
    if (learn.amazon) {
      const [market, tag] = Object.entries(learn.amazon)[0] || [];
      const now = (a.amazon && a.amazon[market]) || '';
      return now === tag ? 'same' : now ? 'other' : null;
    }
    if (learn.catchAll) {
      if (a.network === learn.catchAll.network && a.networkId === learn.catchAll.networkId) return 'same';
      return a.network && a.network !== 'none' ? 'other' : null;
    }
    if (learn.rule) {
      if ((a.exclude || []).some((d) => learn.domain === d || learn.domain.endsWith(`.${d}`))) return 'excluded';
      const rules = (a.rules || []).filter((r) => r.domains.includes(learn.domain));
      if (rules.some((r) => r.mode === learn.rule.mode && r.value === learn.rule.value)) return 'same';
      return rules.length ? 'other' : null;
    }
    return null;
  }

  // What it has learned, shop by shop. Deleting one saves straight away (with an undo).
  const rulesBox = h('div', { class: 'aff-rules' });
  let rulesSig = '';
  function renderRules(s) {
    const rules = (s.settings.affiliate && s.settings.affiliate.rules) || [];
    const next = sig(rules);
    if (next === rulesSig) return;
    rulesSig = next;
    if (!rules.length) {
      swap(rulesBox, h('p', { class: 'field-hint', text: 'No shops taught yet.' }));
      return;
    }
    swap(rulesBox,
      h('p', { class: 'field-label', text: 'Shops it knows' }),
      h('ul', { class: 'aff-rule-list' }, rules.map((rule) => h('li', { class: 'aff-rule' },
        h('span', { class: 'aff-rule-text' },
          h('span', { class: 'aff-rule-label', text: rule.label }),
          h('span', { class: 'aff-rule-meta', text: `${rule.domains.join(', ')} · ${rule.mode === 'wrap' ? 'deep link' : 'extra parameters'}` })),
        h('button', {
          class: 'icon-btn danger', type: 'button', 'aria-label': `Delete ${rule.label}`, title: 'Delete', dataset: { key: `rule-del:${rule.id}` },
          onclick: (e) => deleteRule(rule, e.currentTarget),
        }, icon('trash'))))));
  }
  async function deleteRule(rule, btn) {
    const rules = store.state.settings.affiliate.rules;
    const index = rules.findIndex((r) => r.id === rule.id);
    btn.disabled = true;
    try {
      await api('settings.save', { settings: { affiliate: { rules: rules.filter((r) => r.id !== rule.id) } } });
      toast(`Deleted ${rule.label}.`, {
        action: async () => {
          const now = store.state.settings.affiliate.rules.filter((r) => r.id !== rule.id);
          now.splice(Math.min(index, now.length), 0, rule);
          try {
            await api('settings.save', { settings: { affiliate: { rules: now } } });
            toast(`${rule.label} is back.`);
          } catch (err) {
            toastError(err);
          }
        },
      });
    } catch (err) {
      btn.disabled = false;
      toastError(err);
    }
  }
  const teachGroup = h('fieldset', { class: 'copy-group' },
    h('legend', { class: 'group-label', text: 'Teach it a link' }),
    teachForm, teachResult, rulesBox);

  const excludeIn = textArea({ rows: 3, class: 'input textarea textarea-short', placeholder: 'gucci.com', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Never use affiliate links for these shops' });
  excludeIn.addEventListener('input', () => { draft.affiliate.exclude = excludeIn.value; sync(); });
  const excludeGroup = h('fieldset', { class: 'copy-group' },
    h('legend', { class: 'group-label', text: 'Never use affiliate links for' }),
    excludeIn,
    h('p', { class: 'field-hint', text: 'Shops’ web addresses, one per line. Their buttons stay plain links (your own links on items still count).' }));

  let disclosureGroup = null;
  if (meta.copyFields.affiliateNote) {
    const max = meta.copyFields.affiliateNote;
    const input = textArea({ maxlength: max, rows: 3, class: 'input textarea textarea-short' });
    copyInputs.affiliateNote = input; // saved with the other site words
    bind(input, 'copy', 'affiliateNote');
    disclosureGroup = h('fieldset', { class: 'copy-group' },
      h('legend', { class: 'group-label', text: 'Disclosure' }),
      field({ label: 'Shown at the foot of the site', control: input, counter: max, hint: 'Only while a button uses an affiliate link. Leave it empty to bring back the original words.' }),
      h('p', { class: 'field-hint', text: '“As an Amazon Associate I earn from qualifying purchases.” is added automatically when Amazon links are used.' }));
  }

  const signUp = h('div', { class: 'copy-group' },
    h('h3', { class: 'group-label', text: 'Where to sign up' }),
    h('ul', { class: 'signup-list' }, SIGN_UP.map(([name, href, what]) => h('li', null,
      h('a', { href, target: '_blank', rel: 'noopener' }, name, icon('external')),
      h('span', { class: 'muted', text: what })))));
  const grabGroup = h('div', { class: 'copy-group' },
    h('h3', { class: 'group-label', text: 'Grab from any shop page' }),
    bookmarkletLink());

  const affCard = h('section', { class: 'card aff-card', 'aria-labelledby': 'aff-title' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-label', id: 'aff-title', text: 'Affiliate links' }), clicksAside),
    h('p', { class: 'card-lede', text: 'Visitors’ buttons earn you a commission where they can: an item’s own link first, then your Amazon tag, the shops you’ve taught it, and Skimlinks or Sovrn for the rest.' }),
    h('div', { class: 'stack' },
      h('div', { class: 'switch-list' }, affToggle),
      amazonGroup, networkGroup, teachGroup, excludeGroup, disclosureGroup, signUp, grabGroup));

  /** Takes in affiliate changes made elsewhere (a link taught from an item) without touching her edits. */
  let baseAff = null;
  function mergeAffiliate(s) {
    const next = affFrom(s);
    const d = draft.affiliate;
    let changed = false;
    if (d.enabled === baseAff.enabled && next.enabled !== d.enabled) {
      d.enabled = next.enabled;
      affToggle.input.checked = d.enabled;
      changed = true;
    }
    for (const m of Object.keys(next.amazon)) {
      if (d.amazon[m] === baseAff.amazon[m] && next.amazon[m] !== d.amazon[m]) {
        d.amazon[m] = next.amazon[m];
        amazonIns[m].value = d.amazon[m];
        changed = true;
      }
    }
    if (d.network === baseAff.network && d.networkId === baseAff.networkId && (next.network !== d.network || next.networkId !== d.networkId)) {
      d.network = next.network;
      d.networkId = next.networkId;
      netSeg.value = d.network;
      netId.value = d.networkId;
      syncNetwork();
      changed = true;
    }
    if (d.exclude === baseAff.exclude && next.exclude !== d.exclude) {
      d.exclude = next.exclude;
      excludeIn.value = d.exclude;
      changed = true;
    }
    baseAff = next;
    if (changed) {
      syncMarkets();
      savedSig = sig(comparable(fromState(s)));
      sync();
    }
  }

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
  const sections = [[wordsCard, 'Words'], [voiceCard, 'Voice'], [visCard, 'Visibility'], [moneyCard, 'Money'], [tzCard, 'Time zone'], [accountCard, 'Password'], [affCard, 'Affiliate links'], [backupCard, 'Backup']];
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
      h('p', { class: 'view-sub', text: 'Words, voice, money, affiliate links, and who gets to watch.' })),
    jump,
    h('div', { class: 'settings-grid' },
      h('div', { class: 'col' }, wordsCard, voiceCard),
      h('div', { class: 'col' }, visCard, moneyCard, tzCard, accountCard, affCard, backupCard)),
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
    affToggle.input.checked = draft.affiliate.enabled;
    for (const [market, input] of Object.entries(amazonIns)) input.value = draft.affiliate.amazon[market] || '';
    netSeg.value = draft.affiliate.network;
    netId.value = draft.affiliate.networkId;
    excludeIn.value = draft.affiliate.exclude;
    baseAff = affFrom(s);
    syncMarkets();
    syncNetwork();
    renderRules(s);
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
      if (draft.passcode.trim().length < 8) throw new Error('Use at least 8 characters for the passcode.');
      patch.passcode = draft.passcode.trim();
    }
    if (draft.visibility === 'private' && !s.settings.hasPasscode && !patch.passcode) {
      passcode.focus();
      throw new Error('Choose a passcode to make the site private.');
    }
    for (const key of ['showLive', 'showLedger', 'whip', 'goalId']) {
      if (draft[key] !== saved[key]) patch[key] = draft[key];
    }
    // Affiliate links: each part that changed is sent whole (the server checks tags and IDs).
    const nextAff = comparable(draft).affiliate;
    const savedAff = comparable(saved).affiliate;
    const affiliate = {};
    if (nextAff.enabled !== savedAff.enabled) affiliate.enabled = nextAff.enabled;
    if (sig(nextAff.amazon) !== sig(savedAff.amazon)) affiliate.amazon = nextAff.amazon;
    if (nextAff.network !== savedAff.network || nextAff.networkId !== savedAff.networkId) {
      if (nextAff.network !== 'none' && !nextAff.networkId) {
        netId.focus();
        throw new Error(`Add your ${meta.affiliateNetworks ? meta.affiliateNetworks[nextAff.network] : 'network'} ID, or switch it off.`);
      }
      affiliate.network = nextAff.network;
      affiliate.networkId = nextAff.networkId;
    }
    if (sig(nextAff.exclude) !== sig(savedAff.exclude)) affiliate.exclude = nextAff.exclude;
    if (Object.keys(affiliate).length) patch.affiliate = affiliate;
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
    const next = sig(s.settings, s.items.map((i) => [i.id, i.name, i.brand, i.status, i.currency, i.priceBase]), s.clicksTotal);
    if (next === stateSig) return;
    stateSig = next;
    clicksAside.textContent = s.clicksTotal ? `${plural(s.clicksTotal, 'click')} so far` : '';
    if (!draft || !isDirty()) {
      fill(s);
    } else {
      renderGoalOptions(s); // keep the choices current without touching edits
      renderFx();
      mergeAffiliate(s);
      renderRules(s);
    }
  }

  return { el, update, isDirty, title: 'Settings' };
}
