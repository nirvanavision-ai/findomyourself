/* A one-line announcement at the bottom of the screen. */
import { $ } from '../lib/dom.js';

let timer = 0;

export function toast(message, ms = 3800) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('is-on');
  clearTimeout(timer);
  timer = setTimeout(() => node.classList.remove('is-on'), ms);
}
