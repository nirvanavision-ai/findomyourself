/* Small DOM helpers. User data only ever goes in through textContent/attributes. */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/**
 * el('p', { class: 'x', text: 'hi', data: { id: 1 }, style: { '--p': .5 }, on: { click } }, child, …)
 * Children may be nodes, strings (as text) or falsy (skipped).
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'data') Object.entries(value).forEach(([k, v]) => { node.dataset[k] = v; });
    else if (key === 'style') Object.entries(value).forEach(([k, v]) => node.style.setProperty(k, v));
    else if (key === 'on') Object.entries(value).forEach(([k, v]) => node.addEventListener(k, v));
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** An inline SVG from trusted markup written in this codebase (icons), never user data. */
export function svg(markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  return tpl.content.firstElementChild;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * Wraps every character of an element's text in spans (keeping inline elements like <em>),
 * grouped per word so lines never break mid-word. CSS animates `.split.is-in .c`.
 */
export function splitText(node) {
  if (node.dataset.splitDone) return node;
  // Screen readers get the words, not a string of single letters.
  if (!node.hasAttribute('aria-hidden') && !node.closest('[aria-label]')) node.setAttribute('aria-label', node.textContent.trim());
  let index = 0;
  const walk = (parent) => {
    for (const child of [...parent.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        for (const part of child.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { frag.append(document.createTextNode(' ')); continue; }
          const word = document.createElement('span');
          word.className = 'w';
          word.setAttribute('aria-hidden', 'true');
          for (const ch of part) {
            const c = document.createElement('span');
            c.className = 'c';
            c.style.setProperty('--i', index++);
            c.textContent = ch;
            word.append(c);
          }
          frag.append(word);
        }
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    }
  };
  walk(node);
  node.classList.add('split');
  node.dataset.splitDone = '1';
  return node;
}

export const icons = {
  lock: '<svg viewBox="0 0 24 28" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6.5 12V8.2a5.5 5.5 0 0 1 11 0V12"/><rect x="3" y="12" width="18" height="14" rx="2.5"/><path d="M12 17.2v3.6" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.3" fill="currentColor" stroke="none"/></svg>',
  unlock: '<svg viewBox="0 0 24 28" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6.5 12V8.2a5.5 5.5 0 0 1 10.6-2"/><rect x="3" y="12" width="18" height="14" rx="2.5"/><path d="M12 17.2v3.6" stroke-linecap="round"/></svg>',
  arrow: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 12L12 4M5.5 4H12v6.5"/></svg>',
};
