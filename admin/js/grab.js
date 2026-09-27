/*
 * FINDOM YOURSELF · Control Room: "Grab from any shop page". A bookmarklet for shops that
 * block the server (it sees a captcha where she sees the product): clicked on a product page,
 * it reads the name, brand, price and photo the page already shows her, and opens the Control
 * Room at #add=<data>. Nothing is saved from there: the editor opens filled in, and only her
 * Save adds it. Everything in the fragment is treated as untrusted and checked field by field.
 */
import { h, parseAmount, amountInput, hostOf, fold } from './core.js';
import { store } from './api.js';
import { toast } from './ui.js';
import { openItemEditor, editorState } from './item.js';

const MAX_FRAGMENT = 12000; // base64 of six fields, generously
const MAX_TEXT = 300;
const MAX_URL = 2048;

/* ───────────────────────── the bookmarklet ───────────────────────── */

// Runs on the shop's page, so plain ES5 without newlines (bookmarks drop them). TARGET is
// replaced with the Control Room's address. JSON-LD Product first, then meta tags, then
// Amazon's own markup; every field is cut short before it's sent. The photo is only ever an
// image's own address (a string, an ImageObject's contentUrl or url): never a caption or an
// "@id" reference, and never the page itself, so og:image still gets its turn.
const GRABBER = "(function(){var d=document,o={u:location.href.split('#')[0],n:'',b:'',p:'',c:'',i:''};"
  + "function m(s,a){var e=d.querySelector(s);return e?((a?e.getAttribute(a):e.content||e.textContent)||'').trim():''}"
  + "function g(p){return m('meta[property=\"'+p+'\"]')}"
  + "function t(v){return typeof v=='string'||typeof v=='number'?String(v):v&&typeof v=='object'?t(v.name||v.url||v['@id']||v[0]):''}"
  + "function im(v){return typeof v=='string'?v:v&&typeof v=='object'?im(v.length?v[0]:v.contentUrl||v.url):''}"
  + "function r(v){try{v=v&&new URL(v,o.u).href}catch(e){v=''}return /^https?:/.test(v)&&v.split('#')[0]!=o.u?v:''}"
  + "function w(j){if(!j||typeof j!='object')return;if(Array.isArray(j))return j.forEach(w);if(j['@graph'])w(j['@graph']);"
  + "var y=[].concat(j['@type']);if(y.indexOf('Product')>-1||y.indexOf('ProductGroup')>-1){if(!o.n){o.n=t(j.name);o.b=t(j.brand);o.i=im(j.image)}"
  + "var f=[].concat(j.offers||[])[0]||{};f=[].concat(f.offers||f)[0]||{};if(!o.p){o.p=t(f.price||f.lowPrice||(f.priceSpecification||{}).price);o.c=t(f.priceCurrency)}}"
  + "else if(j.mainEntity)w(j.mainEntity)}"
  + "d.querySelectorAll('script[type*=\"ld+json\"]').forEach(function(s){try{w(JSON.parse(s.textContent))}catch(e){}});"
  + "o.n=o.n||m('#productTitle')||g('og:title')||d.title;"
  + "o.b=o.b||g('product:brand')||m('#bylineInfo').replace(/^(Visit the |Brand: )|( Store)$/g,'');"
  + "o.p=o.p||g('product:price:amount')||g('og:price:amount')||m('#corePrice_feature_div .a-offscreen')||m('.a-price .a-offscreen');"
  + "o.c=o.c||g('product:price:currency')||g('og:price:currency');"
  + "o.i=r(o.i)||r(m('#landingImage','data-old-hires'))||r(g('og:image'));"
  + "for(var k in o)o[k]=String(o[k]).slice(0,k=='u'||k=='i'?2e3:300);"
  + "var s=btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');"
  + "window.open(TARGET+'#add='+s,'_blank','noopener')})()";

/** The Control Room's own address ("https://example.com/admin/"). */
const adminUrl = () => new URL('./', location.href).href;

/**
 * The bookmarklet as a javascript: link (under 2 KB) that opens base + "#add=…". base is the
 * Control Room's address; a bare origin ("https://example.com") gets "/admin/" added.
 */
export function bookmarkletHref(base = adminUrl()) {
  const target = /^https?:\/\/[^/]+\/?$/i.test(base) ? `${base.replace(/\/$/, '')}/admin/` : base;
  const code = GRABBER.replace('TARGET', () => JSON.stringify(target));
  // Browsers percent-decode a javascript: link before running it, so % (and #, spaces) are escaped.
  return `javascript:${code.replace(/[%#\s"<>]/g, (c) => encodeURIComponent(c))}`;
}

/** The draggable "+ Findom" link and what it's for. */
export function bookmarkletLink() {
  return h('div', { class: 'grab' },
    h('a', {
      class: 'btn btn-gold btn-sm grab-link', href: bookmarkletHref(), draggable: 'true', title: 'Drag me to your bookmarks bar',
      onclick: (e) => {
        e.preventDefault();
        toast('Drag it to your bookmarks bar, then click it on a shop’s product page.');
      },
    }, '+ Findom'),
    h('p', { class: 'field-hint', text: 'Drag this to your bookmarks bar. On any product page, click it to add the item here, even from shops that block automatic lookups.' }));
}

/* ───────────────────────── reading #add= ───────────────────────── */

/** Plain one-line text, at most MAX_TEXT characters, or ''. */
function cleanText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const s = String(value).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]+/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, MAX_TEXT).join('').trim();
}

/** An http(s) link without a password in it, or ''. */
function cleanLink(value) {
  if (typeof value !== 'string' || value.length > MAX_URL) return '';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    url.hash = '';
    return url.href.length <= MAX_URL ? url.href : '';
  } catch (e) {
    return '';
  }
}

const AMAZON_HOST = /^(?:(?:www|smile|m)\.)?amazon\.((?:com?\.)?[a-z]{2,3})$/i;
const ASIN = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i;
const AMAZON_TRACKING = ['tag', 'ascsubtag', 'linkCode', 'linkId', 'ref_'];

/**
 * An Amazon page as its plain /dp/ link. The address bar keeps the tag of whoever's link she
 * arrived through, and that isn't hers (her own Amazon tag, if she saved one, goes on visitors'
 * buttons). Other shops' links are left as they are.
 */
function plainAmazon(link) {
  try {
    const url = new URL(link);
    const shop = AMAZON_HOST.exec(url.hostname);
    if (!shop) return link;
    const asin = ASIN.exec(url.pathname);
    if (asin) return `https://www.amazon.${shop[1].toLowerCase()}/dp/${asin[1].toUpperCase()}`;
    if (!AMAZON_TRACKING.some((key) => url.searchParams.has(key))) return link;
    AMAZON_TRACKING.forEach((key) => url.searchParams.delete(key));
    return url.href;
  } catch (e) {
    return link;
  }
}

const SYMBOLS = { '€': 'EUR', '£': 'GBP', '₹': 'INR' };
const AMAZON_CURRENCIES = {
  com: 'USD', ca: 'CAD', 'com.mx': 'MXN', 'com.br': 'BRL', 'co.uk': 'GBP', de: 'EUR', fr: 'EUR', it: 'EUR', es: 'EUR', nl: 'EUR',
  'com.be': 'EUR', se: 'SEK', pl: 'PLN', 'com.tr': 'TRY', ae: 'AED', in: 'INR', 'co.jp': 'JPY', sg: 'SGD', 'com.au': 'AUD',
};

/** A currency the Control Room knows: the page's code, else what its price's symbol (or Amazon's country) gives away. */
function cleanCurrency(code, priceText, url) {
  const known = (store.meta && store.meta.currencies) || [];
  const c = cleanText(code).toUpperCase();
  if (/^[A-Z]{3}$/.test(c) && known.includes(c)) return c;
  const symbol = Object.keys(SYMBOLS).find((sym) => String(priceText).includes(sym));
  const amazon = /(?:^|\.)amazon\.([a-z.]+)$/.exec(hostOf(url));
  const guess = symbol ? SYMBOLS[symbol] : amazon ? AMAZON_CURRENCIES[amazon[1]] : '';
  return guess && known.includes(guess) ? guess : '';
}

/** "Horsebit bag | GUCCI® US" → "Horsebit bag": drops a leading or trailing part that's just the shop. */
function tidyName(name, url) {
  const label = fold(hostOf(url).split('.')[0]).replace(/[^a-z0-9]/g, '');
  const parts = name.split(/\s+[|–—]\s+|\s+-\s+/);
  if (parts.length < 2 || label.length < 2) return name;
  const isShop = (part) => {
    const bare = fold(part).replace(/[^a-z0-9]/g, '');
    return bare.startsWith(label) && bare.length <= label.length + 12;
  };
  while (parts.length > 1 && isShop(parts[parts.length - 1])) parts.pop();
  while (parts.length > 1 && isShop(parts[0])) parts.shift();
  return parts.join(' – ');
}

/** "KHAITE Lotus mini bag" with the brand KHAITE → "Lotus mini bag": the brand has its own box. */
function dropBrand(name, brand) {
  if (!brand || name.length <= brand.length || fold(name.slice(0, brand.length)) !== fold(brand)) return name;
  const rest = name.slice(brand.length);
  return /^[\s|–—:·-]+\S/.test(rest) ? rest.replace(/^[\s|–—:·-]+/, '') : name;
}

/** base64url → text, or null. */
function decode(data) {
  try {
    const b64 = data.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((data.length + 3) % 4);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (e) {
    return null;
  }
}

/**
 * Reads (and clears from the address bar) what the bookmarklet sent. Returns null when the
 * address has no #add=, {invalid: true} when it can't be used, else the checked fields.
 */
export function takeGrab() {
  if (!location.hash.startsWith('#add=')) return null;
  const data = location.hash.slice(5);
  history.replaceState(null, '', '#list');
  if (!data || data.length > MAX_FRAGMENT || !/^[A-Za-z0-9_-]+$/.test(data)) return { invalid: true };
  let raw;
  try {
    raw = JSON.parse(decode(data) || 'null');
  } catch (e) {
    raw = null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { invalid: true };
  const url = plainAmazon(cleanLink(raw.u));
  if (!url) return { invalid: true };
  const priceText = cleanText(raw.p);
  const price = priceText ? parseAmount(priceText) : null;
  const brand = Array.from(cleanText(raw.b)).slice(0, 80).join('');
  return {
    url,
    name: Array.from(dropBrand(tidyName(cleanText(raw.n), url), brand)).slice(0, 140).join(''),
    brand,
    price: price !== null && price > 0 && price < 1e9 ? price : null,
    currency: cleanCurrency(raw.c, priceText, url),
    image: cleanLink(raw.i),
  };
}

/** Same product page? Host and path (Amazon: the product code), ignoring the rest. */
function pageKey(link) {
  try {
    const url = new URL(link);
    const asin = ASIN.exec(url.pathname);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    return asin ? `${host}/dp/${asin[1].toUpperCase()}` : `${host}${url.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch (e) {
    return '';
  }
}

/** Opens the editor for a new item, filled in from the shop page. Only her Save adds it. */
export function openGrabbed(grab) {
  if (grab.invalid) {
    toast('That bookmark link couldn’t be read. Try clicking it again on the product page.', { tone: 'error' });
    return;
  }
  if (editorState()) {
    toast('Close the item that’s open first, then click the bookmark again.', { tone: 'error' });
    return;
  }
  const key = pageKey(grab.url);
  const same = key ? store.state.items.find((i) => i.url && pageKey(i.url) === key) : null;
  const prefill = { url: grab.url, name: grab.name, brand: grab.brand };
  if (grab.price !== null) prefill.price = amountInput(grab.price);
  if (grab.currency) prefill.currency = grab.currency;
  openItemEditor(null, { prefill, image: grab.image, grabbed: true, sameAs: same ? same.id : null });
}
