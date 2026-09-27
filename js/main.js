/*
 * FINDOM YOURSELF: boots the page. The HTML already carries the data (#initial-state);
 * the UI renders from it immediately, the 3D stage loads behind the intro counter, and
 * api/state.php keeps everything live afterwards.
 */
import { $ } from './lib/dom.js';
import { setState, getState, subscribe, startPolling } from './lib/state.js';
import { startLoop } from './lib/loop.js';
import { initScroll } from './lib/scroll.js';
import { prefersReducedMotion } from './lib/motion.js';
import { trackClicks } from './lib/clicks.js';
import { sound } from './audio.js';
import { createLoader } from './ui/loader.js';
import { initCursor, initButtons } from './ui/cursor.js';
import { initNav } from './ui/nav.js';
import { initHero, revealHero } from './ui/hero.js';
import { initRibbons } from './ui/ribbons.js';
import { initCopy } from './ui/copy.js';
import { initMenu } from './ui/menu.js';
import { initVault } from './ui/vault.js';
import { initList, listOrder } from './ui/list.js';
import { initModal, openFromHash } from './ui/modal.js';
import { initTrophies } from './ui/trophies.js';
import { initWhipUI, crack } from './ui/whip.js';
import { initReveal, revealHeroDetails } from './ui/reveal.js';
import { toast } from './ui/toast.js';

const html = document.documentElement;
html.classList.replace('no-js', 'js');

setState(JSON.parse($('#initial-state').textContent));

const loader = createLoader();
startLoop();

initCopy();
initHero();
initNav();
initRibbons();
initMenu();
initModal(listOrder);
initVault();
initList();
initTrophies();
initWhipUI();
initReveal();
initCursor();
initButtons();
trackClicks();
sound.init($('#sound'));

const fonts = loader.track(document.fonts ? document.fonts.ready : Promise.resolve(), 1);
const scroll = loader.track(initScroll(), 1);
const stage = loader.track(bootStage(), 4);

await Promise.race([
  Promise.allSettled([fonts, scroll, stage]),
  new Promise((resolve) => setTimeout(resolve, 6000)), // never hold the page hostage
]);
await loader.finish();
revealHero();
revealHeroDetails();
stage.then((s) => s?.intro());
startPolling();
openFromHash();
celebrateUnlocks();

function hasWebGL2() {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

async function bootStage() {
  if (!hasWebGL2()) {
    html.classList.add('no-webgl');
    return null;
  }
  try {
    const { createStage } = await import('./gl/stage.js');
    const instance = await createStage({
      canvas: $('#gl'),
      getState,
      subscribe,
      onCrack: crack,
      reducedMotion: prefersReducedMotion(),
    });
    html.classList.add('gl-ready');
    if (new URLSearchParams(location.search).has('debug')) window.__findom = { stage: instance };
    return instance;
  } catch (error) {
    console.warn('3D stage unavailable, falling back to 2D:', error);
    html.classList.add('no-webgl');
    return null;
  }
}

/** When polling brings news that something just became affordable, say so. */
function celebrateUnlocks() {
  subscribe((s, prev) => {
    if (!prev) return;
    const before = new Set(prev.unlocked.map((i) => i.id));
    const fresh = s.unlocked.find((i) => !before.has(i.id));
    if (fresh) {
      sound.chime();
      toast(`Unlocked: ${fresh.title}. Go get it.`);
    }
    if (s.stats.balance !== null && prev.stats.balance !== null && s.stats.balance > prev.stats.balance) {
      toast('Tribute just landed in the vault.');
    }
  });
}
