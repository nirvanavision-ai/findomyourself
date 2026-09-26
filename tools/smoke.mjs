/*
 * End-to-end check of the public and Control Room APIs against a real PHP server:
 *
 *   node tools/smoke.mjs
 *
 * Starts `php -S` on a free port with a throwaway private folder, walks through setup, sign-in,
 * logging tribute, the focus timer, pasting links and lists, claiming, settings, the whip,
 * backups and the security checks, then cleans up. Needs PHP 8.1+ and Node 18+.
 * (Shops can't be reached from sandboxes without internet; the "link → item" check expects
 * the fallback of naming the item from its URL.)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIV = fs.mkdtempSync(path.join(os.tmpdir(), 'findom-smoke-'));
const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const server = spawn('php', ['-S', `127.0.0.1:${port}`, 'tools/router.php'], { cwd: root, env: { ...process.env, FINDOM_PRIVATE_DIR: PRIV }, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/state.php'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
process.on('exit', () => { server.kill(); fs.rmSync(PRIV, { recursive: true, force: true }); });
let cookie = '';
let csrf = '';
const log = (...a) => console.log(...a);
async function req(path, opts = {}) {
  const res = await fetch(BASE + path, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), cookie } });
  const set = res.headers.getSetCookie?.() || [];
  for (const c of set) { const kv = c.split(';')[0]; const [k] = kv.split('='); cookie = cookie.split('; ').filter(x => x && !x.startsWith(k + '=')).concat(kv).join('; '); }
  return res;
}
async function page(path) { const r = await req(path); return r.text(); }
async function api(action, body, method = 'POST') {
  const r = await req('/admin/api.php?action=' + action, method === 'GET' ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({ ok: false, error: 'non-json ' + r.status }));
  if (j.csrf) csrf = j.csrf;
  return { status: r.status, ...j };
}
let failed = 0;
function assert(cond, msg) { if (!cond) { failed++; console.error('✗ ' + msg); process.exitCode = 1; } else log('✓ ' + msg); }

let html = await page('/admin/');
csrf = html.match(/name="csrf-token" content="([^"]+)"/)[1];
const code = fs.readFileSync(PRIV + '/setup-code.txt', 'utf8').trim();
let r = await req('/admin/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ csrf, action: 'setup', code, password: 'correct horse battery', confirm: 'correct horse battery' }) });
assert(r.status === 303, 'setup redirects');
html = await page('/admin/');
assert(html.includes('id="app"'), 'app shell after setup');
let s = await api('state', null, 'GET');
assert(s.ok && s.state.items.length === 12, 'state has 12 seeded items');
assert(s.meta && s.meta.curl === true, 'meta reports curl');

s = await api('ledger.add', { type: 'task', ref: 'c_gym' });
assert(s.ok && s.state.stats.balance === 15, 'command pays $15 (balance ' + s.state?.stats?.balance + ')');
const gymId = s.entryId;
s = await api('ledger.add', { type: 'fine', ref: 'f_scroll' });
assert(s.ok && s.state.stats.balance === 5, 'fine takes $10');
s = await api('ledger.add', { type: 'work', minutes: 90, label: 'Deep work' });
assert(s.ok && s.state.stats.balance === 42.5 && s.state.stats.hours === 1.5, 'work 90 min pays $37.50');
s = await api('ledger.add', { type: 'money', amount: 300, label: 'Invoice paid' });
assert(s.ok && s.state.stats.balance === 342.5, 'money in');
s = await api('ledger.delete', { id: gymId });
assert(s.ok && s.state.stats.balance === 327.5, 'undo command');
s = await api('ledger.add', { type: 'task', amount: 0 });
assert(!s.ok && s.status === 400, 'zero task rejected: ' + s.error);

s = await api('session.start', { label: 'Writing', minutesAgo: 30 });
assert(s.ok && s.state.session && s.state.session.label === 'Writing', 'session starts');
const pub = await (await fetch(BASE + '/api/state.php')).json();
assert(pub.state.session && pub.state.session.label === 'Writing', 'public sees live session');
s = await api('session.start', {});
assert(!s.ok && s.status === 409, 'double start refused');
s = await api('session.stop', {});
assert(s.ok && s.logged && s.minutes === 30 && s.amount === 12.5, 'stop banks 30 min = $12.50 (' + JSON.stringify([s.minutes, s.amount]) + ')');

const text = fs.readFileSync(path.join(root, 'tools/fixtures/gemini-wishlist.md'), 'utf8');
s = await api('items.parse', { text });
assert(s.ok && s.items.length === 12 && s.items.every(i => i.duplicate), 'paste parse: 12 found, all duplicates of the seed');
s = await api('items.parse', { text: 'Diptyque Baies candle – $80 – https://www.diptyqueparis.com/en_us/p/baies-candle.html?utm_source=x\nhttps://www.ssense.com/en-us/women/product/khaite/black-lucca-bag/123456' });
assert(s.ok && s.items.length === 2 && s.items[0].brand === 'Diptyque' && s.items[0].price === 80, 'paste parse: new lines');
s = await api('items.import', { items: s.items });
assert(s.ok && s.added === 2 && s.state.items.length === 14 && s.state.items[0].name === 'Baies candle', 'import adds to top');

s = await api('item.fromLink', { url: 'https://www.google.com/search?q=https://amiri.com/products/amiri-ma-bar-hoodie-black&utm_source=gemini' });
assert(s.ok && s.itemId, 'link → item even when the shop is unreachable');
log('   warnings:', s.warnings);
const linkItem = s.state.items.find(i => i.id === s.itemId);
log('   created:', JSON.stringify({ name: linkItem.name, brand: linkItem.brand, url: linkItem.url, price: linkItem.price }));
s = await api('item.fromLink', { url: 'https://amiri.com/products/amiri-ma-bar-hoodie-black?utm_source=other' });
assert(s.ok && s.duplicate === true, 'same link again → duplicate');
s = await api('item.fromLink', { url: 'not a link' });
assert(!s.ok && s.status === 400, 'garbage link rejected: ' + s.error);
s = await api('item.fromLink', { url: 'http://127.0.0.1:8090/admin/' });
assert(s.ok, 'local link: item made from slug, fetch refused internally');
log('   warnings:', s.warnings);

s = await api('item.save', { item: { id: linkItem.id, price: 1450, currency: 'USD', brand: 'AMIRI', name: 'MA Bar Hoodie', goal: true } });
assert(s.ok && s.state.goalId === linkItem.id, 'edit + pin goal');
s = await api('item.save', { item: { name: 'Mystery bag', price: '1.250,00', currency: 'EUR', url: 'javascript:alert(1)' } });
assert(!s.ok && s.status === 400, 'javascript: link rejected');
s = await api('item.save', { item: { name: 'Mystery bag', price: 1250, currency: 'EUR' } });
assert(s.ok && s.state.items[0].name === 'Mystery bag' && s.state.items[0].priceBase === 1462.5, 'new item converts EUR');

s = await api('item.claim', { id: 'i_amiri_ribbed_tank' });
const tank = s.state.items.find(i => i.id === 'i_amiri_ribbed_tank');
assert(s.ok && tank.status === 'claimed' && s.state.stats.balance === 50, 'claim pays $290 (balance ' + s.state.stats.balance + ')');
s = await api('item.claim', { id: 'i_amiri_ribbed_tank' });
assert(!s.ok && s.status === 409, 'double claim refused');
s = await api('item.unclaim', { id: 'i_amiri_ribbed_tank' });
assert(s.ok && s.state.stats.balance === 340, 'unclaim refunds');

const ids = s.state.items.map(i => i.id).reverse();
s = await api('items.reorder', { ids });
assert(s.ok && s.state.items[0].id === ids[0], 'reorder');

s = await api('settings.save', { settings: { hourlyRate: 40, copy: { heroKicker: 'Test kicker' }, voice: { praise: ['Good.'] } } });
assert(s.ok && s.state.settings.hourlyRate === 40 && s.state.settings.copy.heroKicker === 'Test kicker' && s.state.settings.voice.praise.length === 1, 'settings save');
s = await api('settings.save', { settings: { visibility: 'private' } });
assert(!s.ok && s.status === 400, 'private needs a passcode');
s = await api('settings.save', { settings: { visibility: 'private', passcode: 'kneel' } });
assert(s.ok && s.state.settings.visibility === 'private' && s.state.settings.hasPasscode, 'private with passcode');
let pr = await fetch(BASE + '/api/state.php');
assert(pr.status === 401, 'public state locked when private');
s = await api('settings.save', { settings: { visibility: 'hide-amounts' } });
const hidden = await (await fetch(BASE + '/api/state.php')).json();
assert(hidden.state.stats.balance === null && hidden.state.items[0].price === null, 'hide-amounts hides money');
s = await api('settings.save', { settings: { visibility: 'public', baseCurrency: 'EUR' } });
assert(s.ok && s.state.settings.fx.USD && Math.abs(s.state.settings.fx.USD - 1 / 1.17) < 0.0001, 'switching base re-expresses rates: ' + JSON.stringify(s.state.settings.fx));
s = await api('settings.save', { settings: { baseCurrency: 'USD' } });

s = await api('rules.save', { commands: [{ name: 'Wrote 1000 words', emoji: '✍️', amount: 12 }], fines: [] });
assert(s.ok && s.state.commands.length === 1 && s.state.fines.length === 0, 'rules save');

// whip
let w = await fetch(BASE + '/api/whip.php', { method: 'POST', headers: { 'X-Findom': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 3 }) });
let wj = await w.json();
assert(wj.ok && wj.counted === 3 && wj.total === 3, 'whip counts');
w = await fetch(BASE + '/api/whip.php', { method: 'POST', body: '{}' });
assert(w.status === 403, 'whip without header refused');
for (let i = 0; i < 5; i++) await fetch(BASE + '/api/whip.php', { method: 'POST', headers: { 'X-Findom': '1' }, body: JSON.stringify({ count: 25 }) });
wj = await (await fetch(BASE + '/api/whip.php', { method: 'POST', headers: { 'X-Findom': '1' }, body: JSON.stringify({ count: 25 }) })).json();
assert(wj.counted === 0 && wj.total === 90, 'whip rate limit caps at 90 per window (total ' + wj.total + ')');

// ETag
const e1 = await fetch(BASE + '/api/state.php');
const etag = e1.headers.get('etag');
const e2 = await fetch(BASE + '/api/state.php', { headers: { 'If-None-Match': etag } });
assert(e2.status === 304, 'state answers 304 when unchanged');

// CSRF + auth
const bad = await req('/admin/api.php?action=ledger.add', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'nope' }, body: '{"type":"money","amount":5}' });
assert(bad.status === 403, 'bad CSRF refused');
const anon = await fetch(BASE + '/admin/api.php?action=state');
assert(anon.status === 401, 'anonymous state refused');

// backup round trip
const exp = await req('/admin/api.php?action=export');
const backup = await exp.json();
assert(Array.isArray(backup.items) && backup.ledger.length > 0, 'export has data');
s = await api('data.import', { data: backup });
assert(s.ok && s.items === backup.items.length, 'restore backup');
s = await api('data.import', { data: { hello: 1 } });
assert(!s.ok, 'restore rejects junk');

// password change keeps you signed in
s = await api('password.change', { current: 'correct horse battery', next: 'new password 123' });
assert(s.ok && s.csrf, 'password change');
s = await api('ledger.add', { type: 'money', amount: 1, label: 'after pw change' });
assert(s.ok, 'still signed in after password change');

console.log(failed ? `\n${failed} checks failed.` : '\nAll smoke checks passed.');
process.exit(failed ? 1 : 0);
