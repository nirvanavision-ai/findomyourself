/*
 * End-to-end check of the public and Control Room APIs against a real PHP server:
 *
 *   node tools/smoke.mjs
 *
 * Starts `php -S` on a free port with a throwaway private folder, walks through setup, sign-in,
 * logging tribute, the focus timer, pasting links and lists, affiliate links and click counting,
 * claiming, settings, the whip, backups and the security checks, then cleans up. Needs PHP 8.1+
 * and Node 18+. (Shops can't be reached from sandboxes without internet; the "link → item" checks
 * expect the fallback of naming the item from its URL, and the affiliate checks use .example shops.)
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
const main = { cookie: '' }; // the owner's browser; other "browsers" get their own jar
let csrf = '';
const log = (...a) => console.log(...a);
async function req(path, opts = {}, jar = main) {
  const res = await fetch(BASE + path, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), cookie: jar.cookie } });
  const set = res.headers.getSetCookie?.() || [];
  for (const c of set) {
    const kv = c.split(';')[0];
    const [k, v] = kv.split('=');
    jar.cookie = jar.cookie.split('; ').filter(x => x && !x.startsWith(k + '=')).concat(v ? [kv] : []).join('; ');
  }
  return res;
}
async function page(path, jar = main) { const r = await req(path, {}, jar); return r.text(); }
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
const formToken = (html) => (html.match(/name="csrf" value="([a-f0-9]{32})"/) || [])[1] || '';
async function post(path, fields, jar = main) { return req(path, { method: 'POST', headers: FORM, body: new URLSearchParams(fields) }, jar); }
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

const first = await req('/admin/');
let html = await first.text();
assert(!first.headers.getSetCookie().some(c => c.startsWith('findom_admin=')), 'anonymous visit starts no session');
assert(formToken(html) !== '' && main.cookie.includes('findom_form='), 'setup form carries its CSRF token');
const code = fs.readFileSync(PRIV + '/setup-code.txt', 'utf8').trim();
const setupFields = { csrf: formToken(html), action: 'setup', code, password: 'correct horse battery', confirm: 'correct horse battery' };
let r = await post('/admin/', setupFields, { cookie: '' });
assert(r.status === 200 && (await r.text()).includes('form expired'), 'setup without the form cookie refused');
r = await post('/admin/', { ...setupFields, password: 'short', confirm: 'short' });
assert(r.status === 200 && (await r.text()).includes('at least 10'), 'short password refused');
r = await post('/admin/', setupFields);
assert(r.status === 303, 'setup redirects');
html = await page('/admin/');
assert(html.includes('id="app"'), 'app shell after setup');
csrf = html.match(/name="csrf-token" content="([^"]+)"/)[1];
assert(!fs.existsSync(PRIV + '/setup-code.txt'), 'setup code used up');
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

// affiliate links: settings, her own links, pasted affiliate links, teaching it a link, the public buttons
s = await api('state', null, 'GET');
assert(s.meta.amazonMarketplaces['co.uk'] === 'amazon.co.uk (UK)' && s.meta.affiliateNetworks.sovrn === 'Sovrn Commerce', 'meta lists Amazon stores and networks');
assert(JSON.stringify(s.state.settings.affiliate) === '{"enabled":true,"amazon":{},"network":"none","networkId":"","rules":[],"exclude":[]}', 'affiliate links start unset');
let ash = s.state.items.find(i => i.id === 'i_versace_ashtray');
assert(ash.out.kind === 'plain' && ash.out.url === ash.url && ash.clicks.total === 0 && s.state.clicksTotal === 0, 'items say where their button goes and how often it was clicked');
assert(!(await page('/', { cookie: '' })).includes('id="disclosure"'), 'no disclosure while no button is an affiliate link');
for (const [bad, what] of [[{ network: 'skimlinks', networkId: 'nope' }, 'a bad Skimlinks ID'], [{ network: 'sovrn', networkId: '' }, 'a missing Sovrn key'],
  [{ network: 'evil', networkId: '123456X1234567' }, 'an unknown network'], [{ amazon: { com: 'bad tag' } }, 'a bad Amazon tag'], [{ exclude: 'gucci.com\nnot-a-shop' }, 'junk on the never list']]) {
  s = await api('settings.save', { settings: { affiliate: bad } });
  assert(!s.ok && s.status === 400, 'affiliate settings refuse ' + what + ': ' + s.error);
}
s = await api('settings.save', { settings: { affiliate: { network: 'skimlinks', networkId: '123456x1234567', amazon: { com: 'fin-20' }, exclude: ['https://www.amiri.com/'] }, copy: { affiliateNote: 'Some links pay me.' } } });
let aff = s.state?.settings.affiliate;
assert(s.ok && aff.network === 'skimlinks' && aff.networkId === '123456X1234567' && aff.amazon.com === 'fin-20' && aff.exclude.join() === 'amiri.com' && s.state.settings.copy.affiliateNote === 'Some links pay me.', 'affiliate settings save');
s = await api('settings.save', { settings: { affiliate: { enabled: false } } });
aff = s.state?.settings.affiliate;
assert(s.ok && aff.enabled === false && aff.network === 'skimlinks' && aff.amazon.com === 'fin-20' && aff.exclude.length === 1, 'a partial affiliate save keeps the rest');
s = await api('settings.save', { settings: { affiliate: { enabled: true } } });
ash = s.state.items.find(i => i.id === 'i_versace_ashtray');
assert(ash.out.kind === 'network' && ash.out.url === 'https://go.skimresources.com/?id=123456X1234567&xs=1&url=' + encodeURIComponent(ash.url) + '&xcust=i_versace_ashtray', 'other shops go through Skimlinks: ' + ash.out.url);

s = await api('item.save', { item: { id: 'i_amiri_hat', affiliateUrl: 'javascript:alert(1)' } });
assert(!s.ok && s.status === 400, 'her link must be a web link: ' + s.error);
s = await api('item.save', { item: { id: 'i_amiri_hat', affiliateUrl: 'https://www.google.com/url?q=https%3A%2F%2Fgo.shopmy.us%2Fp-123%3Futm_source%3Dme' } });
let hat = s.state?.items.find(i => i.id === 'i_amiri_hat');
assert(s.ok && hat.affiliateUrl === 'https://go.shopmy.us/p-123?utm_source=me' && hat.out.kind === 'mine' && hat.out.label === 'Your link (ShopMy)', 'item.save keeps her link as made (only Google’s wrapper comes off), even for a shop on the never list');
s = await api('item.save', { item: { id: 'i_amiri_hat', affiliateUrl: '' } });
hat = s.state?.items.find(i => i.id === 'i_amiri_hat');
assert(s.ok && hat.affiliateUrl === '' && hat.out.kind === 'plain', 'clearing her link');
s = await api('item.save', { item: { id: 'i_amiri_hat', affiliateUrl: 'https://go.shopmy.us/p-123?utm_source=me' } });

const awin = 'https://www.awin1.com/cread.php?awinmid=6597&awinaffid=123456&ued=https%3A%2F%2Fwww.silk-scarves.example%2Fproducts%2Fgreen-silk-scarf%3Futm_source%3Dx';
s = await api('item.fromLink', { url: awin });
const scarf = s.state?.items.find(i => i.id === s.itemId);
assert(s.ok && scarf.url === 'https://www.silk-scarves.example/products/green-silk-scarf' && scarf.affiliateUrl === awin && scarf.out.kind === 'mine', 'awin link → item: the shop link inside it, her link kept as pasted (' + scarf?.name + ')');
assert(s.affiliate?.network === 'Awin' && s.suggestion?.domain === 'silk-scarves.example' && s.suggestion.rule.value === 'https://www.awin1.com/cread.php?awinmid=6597&awinaffid=123456&ued={url}', 'awin link → recognized, with a suggestion to use Awin for that shop');
s = await api('item.fromLink', { url: awin });
assert(s.ok && s.duplicate === true && s.itemId === scarf.id, 'the same awin link again → duplicate');
s = await api('affiliate.detect', { url: awin });
assert(s.ok && s.detected.network === 'Awin' && s.detected.destination === 'https://www.silk-scarves.example/products/green-silk-scarf?utm_source=x' && s.suggestion.rule && s.preview.kind === 'network', 'affiliate.detect: what the link is, what it would teach, where that shop goes now');
s = await api('affiliate.learn', { url: awin });
assert(s.ok && s.applied === 'Awin · silk-scarves.example' && s.state.settings.affiliate.rules.length === 1, 'affiliate.learn adds a rule for the shop');
s = await api('affiliate.detect', { url: 'https://www.silk-scarves.example/products/red-scarf' });
assert(s.ok && s.detected === null && s.preview.kind === 'rule' && s.preview.url === 'https://www.awin1.com/cread.php?awinmid=6597&awinaffid=123456&ued=' + encodeURIComponent('https://www.silk-scarves.example/products/red-scarf'), 'that shop’s other links go through the learned rule');
s = await api('affiliate.learn', { url: 'https://go.shopmy.us/p-1' });
assert(!s.ok && s.status === 400, 'nothing to learn from a creator link: ' + s.error);
s = await api('affiliate.detect', { url: 'not a link' });
assert(s.ok && s.detected === null && s.preview.kind === 'none', 'affiliate.detect stays calm while she types');

s = await api('item.fromLink', { url: 'https://www.amazon.com/Some-Bag/dp/B0TESTTEST?tag=fin-20&ref=x' });
const bag = s.state?.items.find(i => i.id === s.itemId);
assert(s.ok && bag.url === 'https://www.amazon.com/dp/B0TESTTEST' && bag.affiliateUrl === '' && s.affiliate === null && bag.out.url === 'https://www.amazon.com/dp/B0TESTTEST?tag=fin-20', 'amazon link with her own tag → short product link, her tag added on the way out');
s = await api('item.fromLink', { url: 'https://www.amazon.de/dp/B0TESTTES2?tag=fin-21' });
const deBag = s.state?.items.find(i => i.id === s.itemId);
assert(s.ok && deBag.affiliateUrl === 'https://www.amazon.de/dp/B0TESTTES2?tag=fin-21' && s.suggestion?.amazon?.de === 'fin-21', 'amazon.de link with a tag she hasn’t saved → kept as her link, with a suggestion to save the tag');
s = await api('items.parse', { text: 'https://go.shopmy.us/p-123?utm_source=me\n' + awin.replace('green-silk-scarf', 'blue-silk-scarf') });
assert(s.ok && s.items.length === 2 && s.items[0].duplicate && !s.items[1].duplicate && s.items[1].affiliateUrl.startsWith('https://www.awin1.com/') && s.items[1].url === 'https://www.silk-scarves.example/products/blue-silk-scarf', 'paste parse: her links recognized (and one already on the list)');
s = await api('items.import', { items: [
  { name: 'Tagged thing', url: 'https://www.amazon.com/Tagged-Thing/dp/B0TESTTES3?tag=fin-20', affiliateUrl: 'https://www.amazon.com/dp/B0TESTTES3?tag=fin-20' },
  { name: s.items[1].name, url: s.items[1].url, affiliateUrl: s.items[1].affiliateUrl },
] });
const tagged = s.state?.items.find(i => i.name === 'Tagged thing');
assert(s.ok && s.added === 2 && tagged.url === 'https://www.amazon.com/dp/B0TESTTES3' && tagged.affiliateUrl === '' && s.state.items[1].affiliateUrl.startsWith('https://www.awin1.com/'), 'import: short product links, her own links kept unless they only repeat her Amazon tag');

const pubAff = (await (await fetch(BASE + '/api/state.php')).json()).state;
const shown = Object.fromEntries(pubAff.items.map(i => [i.id, i]));
assert(pubAff.items.every(i => !('url' in i) && typeof i.link === 'string' && typeof i.affiliate === 'boolean'), 'public items carry link and affiliate, never url');
assert(shown.i_amiri_hat.link === 'https://go.shopmy.us/p-123?utm_source=me' && shown.i_amiri_hat.affiliate && shown.i_amiri_hat.store === 'AMIRI', 'public: her own link');
assert(shown.i_amiri_polo.link === 'https://amiri.com/products/women-womens-ma-quad-knit-short-sleeve-polo-black' && !shown.i_amiri_polo.affiliate, 'public: a shop on the never list stays plain');
assert(shown.i_versace_ashtray.link.startsWith('https://go.skimresources.com/?id=123456X1234567&xs=1&url=https%3A%2F%2Fwww.farfetch.com%2F') && shown.i_versace_ashtray.affiliate, 'public: other shops through Skimlinks');
assert(shown[bag.id].link === 'https://www.amazon.com/dp/B0TESTTEST?tag=fin-20' && shown[bag.id].store === 'Amazon', 'public: Amazon with her tag');
assert(shown[scarf.id].link === awin, 'public: her pasted Awin link');
assert(pubAff.settings.affiliateNote === 'Some links pay me. As an Amazon Associate I earn from qualifying purchases.' && pubAff.settings.copy.affiliateNote === pubAff.settings.affiliateNote, 'public: disclosure with Amazon’s sentence');
const affPage = await page('/', { cookie: '' });
assert(affPage.includes('id="disclosure"') && affPage.includes('As an Amazon Associate') && affPage.includes('rel="sponsored noopener"'), 'the page shows the disclosure and marks affiliate links');

// clicks on shop buttons
const phoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
async function click(id, { headers = { 'X-Findom': '1' }, jar = { cookie: '' }, agent = phoneUA } = {}) {
  const res = await req('/api/click.php', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': agent, ...headers }, body: JSON.stringify({ id }) }, jar);
  return { status: res.status, cache: res.headers.get('cache-control') || '', cookies: res.headers.getSetCookie(), ...(await res.json().catch(() => ({}))) };
}
let c = await click('i_amiri_hat', { headers: {} });
assert(c.status === 403, 'click without the header refused');
assert((await req('/api/click.php')).status === 405, 'click by GET refused');
c = await click('i_amiri_hat');
assert(c.status === 200 && c.ok && c.counted === true && /no-store/.test(c.cache) && c.cookies.length === 0, 'click counts, sets no cookie');
c = await click('i_amiri_hat');
assert(c.ok && c.counted === false, 'the same visitor, item and day counts once');
c = await click('i_versace_ashtray', { agent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });
assert(c.ok && c.counted === false, 'bots aren’t counted');
c = await click('i_nope');
assert(c.status === 404 && c.ok === false, 'unknown item: 404');
c = await click({ id: 'i_amiri_hat' });
assert(c.status === 404, 'junk id: 404');
await api('item.save', { item: { id: 'i_amiri_polo', status: 'archived' } });
c = await click('i_amiri_polo');
assert(c.status === 404, 'archived item: 404');
await api('item.save', { item: { id: 'i_amiri_polo', status: 'wishing' } });
s = await api('state', null, 'GET');
hat = s.state.items.find(i => i.id === 'i_amiri_hat');
assert(hat.clicks.total === 1 && hat.clicks.week === 1 && hat.clicks.last && s.state.clicksTotal === 1, 'the Control Room sees the click');
assert(!fs.readFileSync(PRIV + '/clicks.json', 'utf8').includes('127.0.0.1'), 'no address stored with clicks');

s = await api('settings.save', { settings: { hourlyRate: 40, copy: { heroKicker: 'Test kicker' }, voice: { praise: ['Good.'] } } });
assert(s.ok && s.state.settings.hourlyRate === 40 && s.state.settings.copy.heroKicker === 'Test kicker' && s.state.settings.voice.praise.length === 1, 'settings save');
s = await api('settings.save', { settings: { visibility: 'private' } });
assert(!s.ok && s.status === 400, 'private needs a passcode');
s = await api('settings.save', { settings: { visibility: 'private', passcode: 'kneel' } });
assert(!s.ok && s.status === 400, 'short passcode refused');
s = await api('settings.save', { settings: { visibility: 'private', passcode: 'kneel-before-me' } });
assert(s.ok && s.state.settings.visibility === 'private' && s.state.settings.hasPasscode, 'private with passcode');
let pr = await fetch(BASE + '/api/state.php');
assert(pr.status === 401 && /no-store/.test(pr.headers.get('cache-control')), 'public state locked when private');
c = await click('i_amiri_skirt');
assert(c.status === 401, 'clicks locked when private');
const visitor = { cookie: '' };
const gate = await req('/', {}, visitor);
const gateHtml = await gate.text();
assert(gate.status === 401 && gateHtml.includes('name="passcode"') && !gateHtml.includes('Chrome Hearts'), 'private site shows only the passcode gate');
r = await post('/', { csrf: formToken(gateHtml), passcode: 'wrong-passcode' }, visitor);
assert(r.status === 401 && (await r.text()).includes('Wrong'), 'wrong passcode refused');
r = await post('/', { csrf: 'f'.repeat(32), passcode: 'kneel-before-me' }, visitor);
assert(r.status === 401 && (await r.text()).includes('expired'), 'passcode form without its token refused');
r = await post('/', { csrf: formToken(gateHtml), passcode: 'kneel-before-me' }, visitor);
assert(r.status === 303 && visitor.cookie.includes('findom_view='), 'right passcode lets the visitor in');
pr = await req('/api/state.php', {}, visitor);
assert(pr.status === 200 && /private/.test(pr.headers.get('cache-control')), 'visitor cookie opens the state API, privately cached');
c = await click('i_amiri_skirt', { jar: visitor });
assert(c.ok && c.counted === true, 'a visitor with the passcode can click');
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
const forged = await req('/admin/api.php?action=state', {}, { cookie: 'findom_admin=' + 'a'.repeat(32) });
assert(forged.status === 401, 'made-up session cookie refused');
const weird = await req('/admin/api.php?action[]=state');
assert(weird.status !== 500 && weird.status !== 200, 'array action rejected cleanly (' + weird.status + ')');
for (const p of ['//lib/store.php', '/lib//auth.php', '/tools/test.php', '/package.json', '/README.md', '/uploads/.htaccess']) {
  const res = await fetch(BASE + p);
  assert(res.status === 404 || res.status === 403, 'internal file hidden: ' + p + ' (' + res.status + ')');
}

// backup round trip
const exp = await req('/admin/api.php?action=export');
const backup = await exp.json();
assert(Array.isArray(backup.items) && backup.ledger.length > 0, 'export has data');
s = await api('data.import', { data: backup });
assert(s.ok && s.items === backup.items.length, 'restore backup');
s = await api('data.import', { data: { hello: 1 } });
assert(!s.ok, 'restore rejects junk');

// a second device signs in; a password change signs it out but keeps this one signed in
const phone = { cookie: '' };
const loginHtml = await page('/admin/', phone);
r = await post('/admin/', { csrf: formToken(loginHtml), action: 'login', password: 'correct horse battery' }, phone);
assert(r.status === 303 && phone.cookie.includes('findom_admin='), 'second device signs in');
r = await req('/admin/api.php?action=state', {}, phone);
assert(r.status === 200, 'second device can read state');
s = await api('password.change', { current: 'correct horse battery', next: 'new password 123' });
assert(s.ok && s.csrf, 'password change');
s = await api('ledger.add', { type: 'money', amount: 1, label: 'after pw change' });
assert(s.ok, 'still signed in after password change');
r = await req('/admin/api.php?action=state', {}, phone);
assert(r.status === 401, 'password change signs other devices out');

// sign-in lockout: the seventh wrong password in a row is refused without being checked
const guesser = { cookie: '' };
const guessHtml = await page('/admin/', guesser);
let lockedAt = -1;
for (let i = 0; i < 8 && lockedAt < 0; i++) {
  const t = await (await post('/admin/', { csrf: formToken(guessHtml), action: 'login', password: 'guess number ' + i }, guesser)).text();
  if (t.includes('Too many wrong attempts')) lockedAt = i;
}
assert(lockedAt === 6, 'sign-in locks after 6 wrong passwords (locked at ' + lockedAt + ')');
r = await post('/admin/', { csrf: formToken(guessHtml), action: 'login', password: 'new password 123' }, guesser);
assert(r.status === 200 && (await r.text()).includes('Too many wrong attempts'), 'even the right password waits out the lockout');

console.log(failed ? `\n${failed} checks failed.` : '\nAll smoke checks passed.');
process.exit(failed ? 1 : 0);
