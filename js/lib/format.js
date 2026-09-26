/* Formatting money, time and the {placeholders} in the site's copy. */

const moneyFormats = new Map();

/** "$1,284.50". With whole: true, no cents. null (amounts hidden) shows as "•••". */
export function money(value, currency = 'USD', { whole = false } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return '•••';
  const cents = !whole && Math.round(value * 100) % 100 !== 0;
  const key = currency + (cents ? ':c' : ':w');
  if (!moneyFormats.has(key)) {
    try {
      moneyFormats.set(key, new Intl.NumberFormat('en-US', {
        style: 'currency', currency, minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0,
      }));
    } catch {
      moneyFormats.set(key, { format: (v) => `${v.toFixed(cents ? 2 : 0)} ${currency}` });
    }
  }
  return moneyFormats.get(key).format(value);
}

/** Money that always shows cents: the vault. */
export function moneyExact(value, currency = 'USD') {
  if (value === null || value === undefined) return '•••';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function signedMoney(value, currency) {
  if (value === null || value === undefined) return '•••';
  return (value < 0 ? '−' : '+') + money(Math.abs(value), currency);
}

/** 9.4 → "9.4 hrs", 1 → "1 hr", 0.5 → "30 min". */
export function hours(h) {
  if (h === null || h === undefined) return '—';
  if (h > 0 && h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  const rounded = h >= 100 ? Math.round(h) : Math.round(h * 10) / 10;
  return `${rounded.toLocaleString('en-US')} ${rounded === 1 ? 'hr' : 'hrs'}`;
}

export function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Length of time in words: "3 days", "5 hours", "12 minutes". */
export function span(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hrs = Math.round(minutes / 60);
  if (hrs < 48) return `${hrs} hour${hrs === 1 ? '' : 's'}`;
  const days = Math.round(hrs / 24);
  if (days < 60) return `${days} days`;
  return `${Math.round(days / 30)} months`;
}

export function ago(iso, now = Date.now()) {
  if (!iso) return 'never';
  const ms = now - Date.parse(iso);
  if (ms < 60000) return 'just now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hrs = Math.round(minutes / 60);
  if (hrs < 36) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function shortDate(iso, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function receiptTime(iso, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(new Date(iso));
    return parts.replace(',', '').toUpperCase();
  } catch {
    return iso.slice(5, 16).replace('T', ' ');
  }
}

export function itemTitle(item) {
  return item ? [item.brand, item.name].filter(Boolean).join(' ') : '';
}

/** Fills {rate} {goal} {item} {hours} {balance} {streak} {since} {count} from the current state. */
export function fillCopy(text, s) {
  if (!text) return '';
  const base = s.settings.baseCurrency;
  const goal = s.goal;
  const unlocked = s.unlocked[0] || goal;
  const values = {
    rate: money(s.settings.hourlyRate, base, { whole: true }),
    goal: goal ? itemTitle(goal) : 'next obsession',
    item: unlocked ? itemTitle(unlocked) : 'next obsession',
    hours: goal ? (goal.hoursToGo ? String(goal.hoursToGo) : '0') : '0',
    balance: moneyExact(s.stats.balance, base),
    streak: String(s.stats.streak),
    since: s.stats.lastTributeAt ? span(s.now() - Date.parse(s.stats.lastTributeAt)) : 'forever',
    count: String(s.wishing.length),
  };
  return text.replace(/\{(rate|goal|item|hours|balance|streak|since|count)\}/g, (_, key) => values[key]);
}
