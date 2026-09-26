/*
 * FINDOM YOURSELF · Control Room (the admin). Builds the app shell (top bar, tab bars),
 * routes between Today, List, Rules and Settings, and keeps the state fresh: every change
 * answers with the full state, and while the page is visible it's re-read every 30 seconds
 * (and whenever you come back to it) so a phone and a laptop stay in step.
 *
 * js/core.js      DOM building, icons, money and time formatting
 * js/ui.js        toasts, sheets, confirmations, form controls
 * js/api.js       talking to api.php, signing back in, the shared state
 * js/today.js     vault, goal, focus timer, commands, fines, money in, receipts
 * js/ledger.js    receipts: rows, editing, the full history, logging past work
 * js/list.js      paste a link, filters, the list, reordering
 * js/item.js      the item editor, photos, claiming
 * js/bulk.js      pasting a whole list, fetching photos in bulk
 * js/rules.js     hourly rate, commands, fines
 * js/settings.js  site words, voice, money, time zone, visibility, password, backup
 */
import { h, icon, balance, serverNow, sig, reducedMotion } from './js/core.js';
import { refresh, store, subscribe, isReauthing } from './js/api.js';
import { confirmSheet, button } from './js/ui.js';
import { createToday } from './js/today.js';
import { createList } from './js/list.js';
import { createRules } from './js/rules.js';
import { createSettings } from './js/settings.js';
import { openItemEditor, editorState } from './js/item.js';
import { recentWorkLabels } from './js/ledger.js';

const TABS = [
  { id: 'today', label: 'Today', icon: 'flame' },
  { id: 'list', label: 'List', icon: 'bag' },
  { id: 'rules', label: 'Rules', icon: 'rules' },
  { id: 'settings', label: 'Settings', icon: 'sliders' },
];
const POLL_MS = 30000;

const app = document.getElementById('app');
const views = {};
let current = null;
let leaving = false;

/* ───────────────────────── the shell ───────────────────────── */

const pillAmount = h('span', { class: 'pill-amount mono' });
const pillLabel = h('span', { class: 'pill-label', text: 'Vault' });
const pill = h('button', { class: 'vault-pill', type: 'button', onclick: () => go('today') }, pillLabel, pillAmount);
const datalists = {
  work: h('datalist', { id: 'work-labels' }),
  brands: h('datalist', { id: 'brand-list' }),
  categories: h('datalist', { id: 'category-list' }),
};
const offline = h('div', { class: 'offline', role: 'status', hidden: true }, icon('warn'), 'Offline. Changes won’t save until you’re back.');

function tabButton(tab, where) {
  return h('button', { class: ['tab', `tab-${where}`], type: 'button', dataset: { tab: tab.id }, onclick: () => go(tab.id) },
    where === 'bottom' ? icon(tab.icon) : null,
    h('span', { class: 'tab-text', text: tab.label }),
    h('span', { class: 'tab-dot', hidden: true, 'aria-hidden': 'true' }));
}

function buildShell() {
  const menu = h('details', { class: 'menu' },
    h('summary', { class: 'icon-btn menu-toggle', 'aria-label': 'More' }, icon('more')),
    h('div', { class: 'menu-panel' },
      h('a', { class: 'menu-item', href: '../', target: '_blank', rel: 'noopener' }, icon('external'), 'View site'),
      h('button', { class: 'menu-item', type: 'button', onclick: signOut }, icon('logout'), 'Sign out')));
  // The menu closes on Esc, a tap elsewhere, or once something in it is chosen.
  document.addEventListener('click', (e) => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  menu.addEventListener('click', (e) => { if (e.target.closest('.menu-item')) menu.open = false; });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
  const topbar = h('header', { class: 'topbar' },
    h('div', { class: 'topbar-inner' },
      h('a', { class: 'brand', href: '#today', onclick: (e) => { e.preventDefault(); go('today'); } }, 'Control ', h('em', { text: 'Room' })),
      h('nav', { class: 'top-tabs', 'aria-label': 'Sections' }, TABS.map((t) => tabButton(t, 'top'))),
      h('div', { class: 'topbar-end' },
        pill,
        h('a', { class: 'btn btn-ghost btn-sm top-link', href: '../', target: '_blank', rel: 'noopener' }, 'View site ', icon('external')),
        button('Sign out', { size: 'sm', className: 'top-link', onclick: signOut }),
        menu)));
  const main = h('main', { class: 'main', id: 'main' }, Object.values(views).map((v) => v.el));
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Sections' }, TABS.map((t) => tabButton(t, 'bottom')));
  app.replaceChildren(topbar, offline, main, tabbar, ...Object.values(datalists));
  app.classList.add('is-ready');
}

async function signOut() {
  if (hasUnsaved()) {
    const ok = await confirmSheet({ title: 'Sign out with unsaved changes?', message: 'Edits you haven’t saved yet will be lost.', confirmLabel: 'Sign out anyway', danger: true });
    if (!ok) return;
  }
  leaving = true;
  document.getElementById('logout-form').submit();
}

const hasUnsaved = () => (views.rules && views.rules.isDirty()) || (views.settings && views.settings.isDirty()) || !!(editorState() && editorState().isDirty());

/* ───────────────────────── routing ───────────────────────── */

function go(tab) {
  if (!views[tab]) tab = 'today';
  if (current !== tab) {
    current = tab;
    for (const [id, view] of Object.entries(views)) view.el.hidden = id !== tab;
    document.querySelectorAll('.tab').forEach((b) => {
      if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if (store.state) views[tab].update(store.state);
    window.scrollTo({ top: 0, behavior: 'auto' });
    document.title = `${views[tab].title} · Control Room`;
  }
  const hash = location.hash.slice(1).split('/');
  if (hash[0] !== tab) history.replaceState(null, '', `#${tab}`);
}

function route() {
  const [tab, itemId] = location.hash.slice(1).split('/');
  go(TABS.some((t) => t.id === tab) ? tab : 'today');
  if (itemId && /^[a-z]{1,3}_[a-z0-9_]{1,40}$/.test(itemId) && !editorState()) {
    if (store.state.items.some((i) => i.id === itemId)) openItemEditor(itemId);
    else history.replaceState(null, '', `#${current}`);
  }
}

/* ───────────────────────── keeping it fresh ───────────────────────── */

let chromeSig = '';
let lastBalance = null;
function updateChrome(s) {
  const b = s.stats.balance;
  pillAmount.textContent = balance(b);
  pill.classList.toggle('is-debt', b < 0);
  pillLabel.textContent = b < 0 ? 'In debt' : 'Vault';
  pill.setAttribute('aria-label', `Vault: ${balance(b)}${b < 0 ? ', in debt' : ''}. Go to Today`);
  pill.title = b < 0 ? 'In debt' : 'The vault';
  if (lastBalance !== null && b !== lastBalance && !reducedMotion()) {
    pill.classList.remove('is-bump');
    void pill.offsetWidth; // restart the animation
    pill.classList.add('is-bump');
  }
  lastBalance = b;
  const unlocked = s.items.filter((i) => i.affordable).length;
  document.querySelectorAll('.tab[data-tab="list"] .tab-dot').forEach((d) => { d.hidden = !unlocked; });
  document.querySelectorAll('.tab[data-tab="today"] .tab-dot').forEach((d) => { d.hidden = !s.session; d.classList.toggle('is-live', !!s.session); });

  const next = sig(recentWorkLabels(s), s.items.map((i) => [i.brand, i.category]));
  if (next === chromeSig) return;
  chromeSig = next;
  const options = (list) => [...new Set(list.filter(Boolean))].sort((x, y) => x.localeCompare(y)).map((v) => h('option', { value: v }));
  datalists.work.replaceChildren(...recentWorkLabels(s).map((v) => h('option', { value: v })));
  datalists.brands.replaceChildren(...options(s.items.map((i) => i.brand)));
  datalists.categories.replaceChildren(...options(s.items.map((i) => i.category)));
}

function onState(s) {
  updateChrome(s);
  if (current) views[current].update(s);
}

let lastPoll = 0;
let polling = false;
async function poll(force = false) {
  if (document.hidden || polling || isReauthing()) return;
  if (!force && Date.now() - lastPoll < 8000) return;
  polling = true;
  lastPoll = Date.now();
  try {
    await refresh();
    offline.hidden = true;
  } catch (e) {
    if (e.code === 'network') offline.hidden = false;
  } finally {
    polling = false;
  }
}

/** The focus timer's clock ticks on the second; relative times ("5 min ago") move each minute. */
let lastMinute = 0;
function tick() {
  if (!document.hidden && store.state) {
    if (current === 'today') views.today.tick();
    const minute = Math.floor(serverNow() / 60000);
    if (minute !== lastMinute) {
      lastMinute = minute;
      if (current) views[current].update(store.state);
    }
  }
  setTimeout(tick, 1000 - (serverNow() % 1000) + 15);
}

/* ───────────────────────── boot ───────────────────────── */

async function boot() {
  try {
    await refresh();
  } catch (e) {
    app.replaceChildren(h('div', { class: 'boot-error' },
      h('p', { class: 'msg error', role: 'alert', text: e.message }),
      button('Try again', { kind: 'primary', onclick: () => location.reload() })));
    return;
  }
  views.today = createToday({ go });
  views.list = createList();
  views.rules = createRules();
  views.settings = createSettings();
  buildShell();
  subscribe(onState);
  updateChrome(store.state);
  route();
  tick();

  setInterval(() => poll(true), POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  window.addEventListener('focus', () => poll());
  window.addEventListener('online', () => poll(true));
  window.addEventListener('offline', () => { offline.hidden = false; });
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', (e) => {
    if (!leaving && ((views.rules && views.rules.isDirty()) || (views.settings && views.settings.isDirty()))) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

boot();
