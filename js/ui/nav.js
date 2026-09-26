/* The fixed nav: tucks away on the way down, and the live status pill ("In session · 00:42:13"). */
import { $, $$ } from '../lib/dom.js';
import { onScroll } from '../lib/scroll.js';
import { getState, subscribe, now } from '../lib/state.js';
import { clock, span } from '../lib/format.js';

export function initNav() {
  const nav = $('#nav');
  const status = $('#status');
  const text = $('#status-text');

  onScroll((info) => {
    nav.classList.toggle('is-scrolled', info.y > 40);
    const deep = info.y > window.innerHeight * 0.9;
    if (!deep || info.direction < 0) nav.classList.remove('is-tucked');
    else if (info.direction > 0 && Math.abs(info.velocity) > 60) nav.classList.add('is-tucked');
  });

  const renderStatus = () => {
    const s = getState();
    if (!s) return;
    let mode = 'idle';
    let label;
    if (s.session) {
      mode = 'live';
      label = `In session · ${clock(now() - Date.parse(s.session.startedAt))}`;
    } else if (s.stats.activeToday) {
      mode = 'paid';
      label = 'Tribute paid today';
    } else if (s.stats.lastTributeAt) {
      const idle = now() - Date.parse(s.stats.lastTributeAt);
      label = idle > 24 * 3600 * 1000 ? `Slacking · ${span(idle)}` : `Last tribute ${span(idle)} ago`;
    } else {
      label = 'No tribute yet';
    }
    status.dataset.state = mode;
    if (text.textContent !== label) text.textContent = label;
    status.title = s.session ? `Working on: ${s.session.label}` : '';
  };
  subscribe(renderStatus);
  renderStatus();
  setInterval(renderStatus, 1000);

  // Highlight the section in view.
  const links = new Map($$('.nav__links a').map((a) => [a.getAttribute('href').slice(1), a]));
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const link = links.get(entry.target.id);
      if (link) link.classList.toggle('is-current', entry.isIntersecting);
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  links.forEach((_, id) => { const section = document.getElementById(id); if (section) seen.observe(section); });

  const whipOn = () => {
    const on = getState()?.settings.whip !== false;
    $$('[data-whip-link]').forEach((a) => { a.hidden = !on; });
  };
  subscribe(whipOn);
  whipOn();
}
