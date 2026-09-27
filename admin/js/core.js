/*
 * FINDOM YOURSELF · Control Room: shared helpers. Builds DOM safely (text is always set as
 * text, never parsed as HTML), draws the icons, and formats money, durations and times in
 * the owner's time zone.
 */

/* ───────────────────────── context ───────────────────────── */

/** What the formatters need to know. api.js keeps it in step with the server's state. */
export const ctx = {
  currency: 'USD',
  timezone: 'UTC',
  offset: 0, // server clock minus this device's clock, in ms
  offsetKnown: false,
};

/** "Now" on the server's clock, so a phone with a wrong clock still times sessions right. */
export const serverNow = () => Date.now() + ctx.offset;

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ───────────────────────── DOM ───────────────────────── */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const PROPS = new Set(['checked', 'disabled', 'hidden', 'selected', 'multiple', 'required', 'readOnly', 'indeterminate', 'open', 'tabIndex']);

/**
 * h('button', {class: 'btn', onclick: fn, 'aria-label': 'Close'}, 'Text', childNode, [more])
 * Strings become text nodes; null/false children and props are skipped.
 */
export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  let value;
  if (props) {
    for (const [key, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (key === 'class') node.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
      else if (key === 'text') node.textContent = v;
      else if (key === 'value') value = v; // after the children, so a <select> has its options
      else if (key === 'style') typeof v === 'string' ? node.setAttribute('style', v) : Object.assign(node.style, v);
      else if (key === 'dataset') Object.assign(node.dataset, v);
      else if (key === 'ref') v(node);
      else if (key.startsWith('on') && typeof v === 'function') node.addEventListener(key.slice(2).toLowerCase(), v);
      else if (PROPS.has(key)) node[key] = v;
      else node.setAttribute(key, v === true ? '' : String(v));
    }
  }
  append(node, children);
  if (value !== undefined) node.value = value;
  return node;
}

export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Replaces a region's content and puts keyboard focus back on the "same" control (data-key). */
export function swap(container, ...children) {
  const active = document.activeElement;
  const key = active && container.contains(active) ? active.dataset.key : null;
  container.replaceChildren();
  append(container, children);
  if (key) {
    const again = container.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (again && !again.disabled) again.focus({ preventScroll: true });
  }
}

let uidCounter = 0;
export const uid = (prefix = 'f') => `${prefix}-${++uidCounter}`;

export function debounce(fn, ms) {
  let timer = null;
  const run = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  run.cancel = () => clearTimeout(timer);
  return run;
}

/** Stable-enough fingerprint of some data, to skip re-rendering when nothing changed. */
export const sig = (...parts) => JSON.stringify(parts);

/* ───────────────────────── storage (per device, may be unavailable) ───────────────────────── */

const PREFIX = 'findom-admin:';

export const local = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (e) { /* private mode or full */ }
  },
  remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
  },
};

/* ───────────────────────── icons ───────────────────────── */

const SVG = 'http://www.w3.org/2000/svg';
// 24×24 line icons. Strings are path data; {c:[cx,cy,r]} circles, {r:[x,y,w,h,rx]} rects; f = filled.
const ICONS = {
  flame: ['M12 2.8c1.2 3.1 5.2 5.3 5.2 10.1a5.2 5.2 0 0 1-10.4 0c0-2.3 1.1-3.9 2.5-5.1.1 1.7.9 2.9 2.1 3.4-.6-3-.4-5.8.6-8.4z'],
  bag: ['M5.2 8.2h13.6l-1.1 11.9a1.7 1.7 0 0 1-1.7 1.5H8a1.7 1.7 0 0 1-1.7-1.5z', 'M9 8.2V6.8a3 3 0 0 1 6 0v1.4'],
  rules: ['M10.5 6.5h9.5', 'M10.5 12h9.5', 'M10.5 17.5h9.5', 'M3.8 6.4l1.5 1.5 2.6-2.7', 'M3.8 11.9l1.5 1.5 2.6-2.7', 'M3.8 17.4l1.5 1.5 2.6-2.7'],
  sliders: ['M4 7h8.5', 'M16.5 7H20', 'M4 17h3.5', 'M11.5 17H20', { c: [14.5, 7, 2] }, { c: [9.5, 17, 2] }],
  x: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  grip: [{ c: [9, 6, 1.35], f: 1 }, { c: [15, 6, 1.35], f: 1 }, { c: [9, 12, 1.35], f: 1 }, { c: [15, 12, 1.35], f: 1 }, { c: [9, 18, 1.35], f: 1 }, { c: [15, 18, 1.35], f: 1 }],
  up: ['M6 14.5l6-6 6 6'],
  next: ['M9.5 5.5l6.5 6.5-6.5 6.5'],
  down: ['M6 9.5l6 6 6-6'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  trash: ['M4.5 7h15', 'M9.5 7V4.8h5V7', 'M6.8 7l.9 12.4a1.5 1.5 0 0 0 1.5 1.4h5.6a1.5 1.5 0 0 0 1.5-1.4L17.2 7'],
  link: ['M10 14a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1.1 1.1', 'M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1.1-1.1'],
  image: [{ r: [3.5, 4.5, 17, 15, 2.5] }, { c: [9, 10, 1.7] }, 'M20.5 15.5l-4.8-4.8L7 19.5'],
  upload: ['M12 15.5V4.5', 'M7.5 9L12 4.5 16.5 9', 'M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15'],
  download: ['M12 4.5v11', 'M7.5 11l4.5 4.5 4.5-4.5', 'M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15'],
  paste: [{ r: [5.5, 5, 13, 16, 2] }, 'M9 5V3.8h6V5', 'M9 11h6', 'M9 15h4'],
  refresh: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.5 4.5v4.5H15'],
  external: ['M13.5 4.5h6v6', 'M19.5 4.5l-8.5 8.5', 'M17.5 14v4.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5V8A1.5 1.5 0 0 1 6 6.5h4.5'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  clock: [{ c: [12, 12, 8.5] }, 'M12 7.5V12l3 2'],
  play: [{ p: 'M8.5 5.8v12.4a.8.8 0 0 0 1.2.7l9.6-6.2a.8.8 0 0 0 0-1.4L9.7 5.1a.8.8 0 0 0-1.2.7z', f: 1 }],
  stop: [{ r: [6.5, 6.5, 11, 11, 2], f: 1 }],
  search: [{ c: [11, 11, 6.5] }, 'M16 16l4.5 4.5'],
  more: [{ c: [5.5, 12, 1.6], f: 1 }, { c: [12, 12, 1.6], f: 1 }, { c: [18.5, 12, 1.6], f: 1 }],
  warn: ['M12 4.2l8.8 15.3H3.2z', 'M12 10v4.2', { c: [12, 16.9, 0.6], f: 1 }],
  pencil: ['M4.5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10z', 'M13 7l4 4'],
  lock: [{ r: [5, 10.5, 14, 10, 2.2] }, 'M8 10.5V7.8a4 4 0 0 1 8 0v2.7'],
  sparkle: ['M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 10.5l5.1-1.9z', 'M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z'],
  coin: [{ c: [12, 12, 8.5] }, 'M14.6 9.4c-.4-.9-1.4-1.5-2.6-1.5-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2.1 2.6.9 2.6 2.1-1.1 2-2.6 2c-1.2 0-2.2-.6-2.7-1.6', 'M12 6.2v1.7', 'M12 16.1v1.7'],
  bolt: ['M13 3.5L5.5 13.5h6l-1 7 7.5-10h-6z'],
  target: [{ c: [12, 12, 8.5] }, { c: [12, 12, 4.5] }, { c: [12, 12, 0.8], f: 1 }],
  undo: ['M9 14.5L4.5 10 9 5.5', 'M4.5 10h10a5 5 0 0 1 0 10H12'],
  eye: ['M2.8 12s3.4-6.5 9.2-6.5 9.2 6.5 9.2 6.5-3.4 6.5-9.2 6.5S2.8 12 2.8 12z', { c: [12, 12, 2.8] }],
  whip: ['M4.5 19.5l3.8-3.8', 'M8.3 15.7c2.4-2.4.4-6.2 3.7-8.6s7.8-.4 7.3 2.6-4.3 2.4-5.1.3', { c: [8.3, 15.7, 1.2], f: 1 }],
  list: ['M9 6.5h11', 'M9 12h11', 'M9 17.5h11', { c: [4.8, 6.5, 1.1], f: 1 }, { c: [4.8, 12, 1.1], f: 1 }, { c: [4.8, 17.5, 1.1], f: 1 }],
  arrange: ['M8 4.5v15', 'M4.5 8L8 4.5 11.5 8', 'M16 19.5v-15', 'M12.5 16l3.5 3.5 3.5-3.5'],
  logout: ['M14.5 4.5H18a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-3.5', 'M10 16.5L5.5 12 10 7.5', 'M5.5 12h10'],
  tag: ['M3.8 12.4V5.1a1.3 1.3 0 0 1 1.3-1.3h7.3l7.9 7.9a1.3 1.3 0 0 1 0 1.8l-7.3 7.3a1.3 1.3 0 0 1-1.8 0z', { c: [8.3, 8.3, 1.5] }],
};

export function icon(name, className = '') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon icon-${name} ${className}`.trim());
  for (const shape of ICONS[name] || []) {
    let node;
    if (typeof shape === 'string' || shape.p) {
      node = document.createElementNS(SVG, 'path');
      node.setAttribute('d', typeof shape === 'string' ? shape : shape.p);
    } else if (shape.c) {
      node = document.createElementNS(SVG, 'circle');
      const [cx, cy, r] = shape.c;
      node.setAttribute('cx', cx);
      node.setAttribute('cy', cy);
      node.setAttribute('r', r);
    } else if (shape.r) {
      node = document.createElementNS(SVG, 'rect');
      const [x, y, w, hh, rx] = shape.r;
      node.setAttribute('x', x);
      node.setAttribute('y', y);
      node.setAttribute('width', w);
      node.setAttribute('height', hh);
      node.setAttribute('rx', rx);
    }
    if (shape.f) node.setAttribute('class', 'fill');
    svg.append(node);
  }
  return svg;
}

/* ───────────────────────── money ───────────────────────── */

const moneyFormats = new Map();

function moneyFormat(currency, whole) {
  const key = `${currency}|${whole ? 0 : 2}`;
  if (!moneyFormats.has(key)) {
    let f;
    try {
      f = new Intl.NumberFormat(undefined, whole
        ? { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }
        : { style: 'currency', currency });
    } catch (e) {
      f = { format: (n) => `${currency} ${n.toFixed(whole ? 0 : 2)}` };
    }
    moneyFormats.set(key, f);
  }
  return moneyFormats.get(key);
}

/** "$1,250" or "$12.50": whole amounts drop the cents. */
export function money(amount, currency = ctx.currency) {
  const value = Number(amount) || 0;
  const whole = Math.abs(Math.round(value * 100) % 100) === 0;
  return moneyFormat(currency || ctx.currency, whole).format(value);
}

/** "+$15" / "−$10" with a real minus sign. */
export function signed(amount, currency = ctx.currency) {
  const value = Number(amount) || 0;
  return `${value < 0 ? '−' : '+'}${money(Math.abs(value), currency)}`;
}

/** Money in a debt-aware way: "−$120" for negative balances. */
export function balance(amount, currency = ctx.currency) {
  const value = Number(amount) || 0;
  return value < 0 ? `−${money(-value, currency)}` : money(value, currency);
}

/** The symbol a currency is written with here ("$", "€", "CHF"). */
export function currencySymbol(currency = ctx.currency) {
  try {
    const part = new Intl.NumberFormat(undefined, { style: 'currency', currency }).formatToParts(1).find((p) => p.type === 'currency');
    return part ? part.value : currency;
  } catch (e) {
    return currency;
  }
}

/** "EUR (€)" for tight spots; the full name goes in a tooltip. */
export function currencyShort(code) {
  const symbol = currencySymbol(code);
  return symbol && symbol !== code ? `${code} (${symbol})` : code;
}

let currencyNames = null;
export function currencyName(code) {
  try {
    currencyNames = currencyNames || new Intl.DisplayNames(undefined, { type: 'currency' });
    return currencyNames.of(code) || code;
  } catch (e) {
    return code;
  }
}

/**
 * Parses what people type as a price: "1100", "1,100.50", "1.100,50", "€ 1.100", "12,5".
 * Same rule as the server: one separator followed by exactly three digits groups thousands.
 */
export function parseAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? Math.round(input * 100) / 100 : null;
  let s = String(input ?? '').replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  s = s.replace(/^[.,]+|[.,]+$/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    s = s.split(decimal === '.' ? ',' : '.').join('');
    s = s.replace(decimal, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const after = s.length - s.lastIndexOf(sep) - 1;
    const count = s.split(sep).length - 1;
    s = count === 1 && after !== 3 ? s.replace(sep, '.') : s.split(sep).join('');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** A number as it should appear inside an input: "1287" or "1287.50". */
export const amountInput = (n) => {
  const v = Number(n) || 0;
  return Math.round(v * 100) % 100 === 0 ? String(Math.round(v)) : v.toFixed(2);
};

/* ───────────────────────── durations ───────────────────────── */

/** 85 → "1h 25m", 45 → "45m", 120 → "2h". */
export function duration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** Seconds → "01:23:45". */
export function clock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Hours with at most one decimal: 13.73 → "13.7". */
export const hours = (n) => {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  return v % 1 === 0 ? String(v) : v.toFixed(1);
};

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ───────────────────────── dates in the owner's time zone ───────────────────────── */

const dateFormats = new Map();

function dateFormat(options, tz = ctx.timezone) {
  const key = tz + JSON.stringify(options);
  if (!dateFormats.has(key)) {
    let f;
    try {
      f = new Intl.DateTimeFormat(undefined, { ...options, timeZone: tz });
    } catch (e) {
      f = new Intl.DateTimeFormat(undefined, options);
    }
    dateFormats.set(key, f);
  }
  return dateFormats.get(key);
}

/** Calendar parts of a moment in a time zone (numbers). */
function zonedParts(ms, tz = ctx.timezone) {
  const f = dateFormat({ hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }, tz);
  const out = {};
  for (const p of f.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  out.hour = out.hour % 24;
  return out;
}

/** "2026-09-26" for a moment, in the owner's time zone. */
export function dayKey(ms, tz = ctx.timezone) {
  const p = zonedParts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export const toMs = (iso) => (typeof iso === 'number' ? iso : Date.parse(iso));

export const timeOfDay = (iso) => dateFormat({ hour: 'numeric', minute: '2-digit' }).format(toMs(iso));

/** "Saturday, 26 September" style heading for today. */
export const longDay = (ms = serverNow()) => dateFormat({ weekday: 'long', day: 'numeric', month: 'long' }).format(ms);

export function shortDate(iso, withYear = false) {
  return dateFormat(withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' }).format(toMs(iso));
}

export const fullDateTime = (iso) => dateFormat({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(toMs(iso));

/** Receipts: "just now", "12 min ago", "14:05", "Yesterday 14:05", "Mon 14:05", "12 Sep". */
export function when(iso, now = serverNow()) {
  const t = toMs(iso);
  const diff = (now - t) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  const day = dayKey(t);
  if (day === dayKey(now)) return timeOfDay(t);
  if (day === dayKey(now - 86400000)) return `Yesterday ${timeOfDay(t)}`;
  if (diff < 6 * 86400) return `${dateFormat({ weekday: 'short' }).format(t)} ${timeOfDay(t)}`;
  return shortDate(t, zonedParts(t).year !== zonedParts(now).year);
}

/** "3 hours", "2 days": how long ago, as words for the voice lines ({since}). */
export function ago(iso, now = serverNow()) {
  const mins = Math.max(0, (now - toMs(iso)) / 60000);
  if (mins < 90) return plural(Math.max(1, Math.round(mins)), 'minute');
  if (mins < 48 * 60) return plural(Math.round(mins / 60), 'hour');
  return plural(Math.round(mins / 1440), 'day');
}

/** A day heading for grouped lists: "Today", "Yesterday", "Mon 21 Sep". */
export function dayLabel(key, now = serverNow()) {
  if (key === dayKey(now)) return 'Today';
  if (key === dayKey(now - 86400000)) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  const noon = Date.UTC(y, m - 1, d, 12);
  const f = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC', ...(y !== zonedParts(now).year ? { year: 'numeric' } : {}) });
  return f.format(noon);
}

function offsetAt(ms, tz) {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** ISO moment → "YYYY-MM-DDTHH:MM" wall clock in the owner's zone (for datetime-local inputs). */
export function toZonedInput(iso, tz = ctx.timezone) {
  const p = zonedParts(toMs(iso), tz);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** "YYYY-MM-DDTHH:MM" wall clock in the owner's zone → ISO UTC string, or null. */
export function fromZonedInput(value, tz = ctx.timezone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let ts = guess - offsetAt(guess, tz);
  ts = guess - offsetAt(ts, tz); // second pass lands DST changes correctly
  return new Date(ts).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export const deviceTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch (e) {
    return '';
  }
};

/* ───────────────────────── the voice ───────────────────────── */

const VOICE_FALLBACK = {
  praise: 'Good. Again.',
  working: 'Timer’s running. Phone face-down.',
  unlocked: 'Unlocked. You earned the damn thing.',
  taunts: 'Cute wishlist. Now earn it.',
  slacking: 'Nothing logged lately. Bold strategy.',
  empty: 'Zero. Get to work.',
};

/** Fills {goal} {item} {hours} {rate} {balance} {streak} {since} {count} from the state. */
export function fillVoice(line, state, extra = {}) {
  const goal = state.items.find((i) => i.id === state.goalId);
  const values = {
    goal: goal ? goal.name : 'next thing on the list',
    item: extra.item || (goal ? goal.name : 'next thing'),
    hours: goal ? hours(goal.hoursToGo) : '0',
    rate: money(state.settings.hourlyRate),
    balance: balance(state.stats.balance),
    streak: String(state.stats.streak),
    since: state.stats.lastTributeAt ? ago(state.stats.lastTributeAt) : 'ages',
    count: String(state.items.filter((i) => i.status === 'wishing').length),
  };
  return line.replace(/\{(\w+)\}/g, (m, key) => (key in values ? values[key] : m));
}

/** Whether a line's placeholders would read sensibly right now ("1 days straight" wouldn't). */
export function voiceFits(line, state, extra = {}) {
  const goal = state.items.find((i) => i.id === state.goalId);
  if (line.includes('{streak}') && state.stats.streak < 2) return false;
  if ((line.includes('{goal}') || line.includes('{hours}')) && !goal) return false;
  if (line.includes('{hours}') && !(goal && goal.hoursToGo > 0)) return false;
  if (line.includes('{since}') && !state.stats.lastTributeAt) return false;
  if (line.includes('{item}') && !extra.item && !goal) return false;
  return true;
}

/** A random line (still with its {placeholders}) from one of the owner's voice moods. */
export function pickVoice(mood, state, extra = {}) {
  const lines = ((state.settings.voice || {})[mood] || []).filter((line) => voiceFits(line, state, extra));
  return lines.length ? lines[Math.floor(Math.random() * lines.length)] : VOICE_FALLBACK[mood] || '';
}

/** A random voice line, filled in. */
export const voiceLine = (mood, state, extra = {}) => fillVoice(pickVoice(mood, state, extra), state, extra);

/* ───────────────────────── text ───────────────────────── */

/** Lowercase without accents, for forgiving search. */
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "https://www.farfetch.com/shopping/…" → "farfetch.com". */
export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

/** First web link in some pasted text; bare "shop.com/…" gets https:// added. */
export function extractUrl(text) {
  const s = String(text || '').trim();
  const full = /https?:\/\/[^\s<>"'`]+/i.exec(s);
  if (full) return full[0].replace(/[.,;:!?)\]]+$/, '');
  const bare = /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s<>"'`]*$/i.exec(s);
  return bare ? `https://${bare[0]}` : '';
}

/** Every link in a block of pasted text. */
export const allUrls = (text) => (String(text || '').match(/https?:\/\/[^\s<>"'`)\]]+/gi) || []);
