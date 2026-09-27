/*
 * Shop-button clicks, counted for the Control Room: any link carrying data-item-link
 * sends a tiny beacon to api/click.php (the server keeps one per visitor, item and day).
 * The beacon never waits on anything and never gets in the way of the shop.
 */

/** Listens once on `root` for left, ctrl/cmd and middle clicks on item links. */
export function trackClicks(root = document) {
  const send = (e) => {
    if (e.type === 'auxclick' && e.button !== 1) return; // right-click only opens a menu
    const link = e.target.closest?.('a[data-item-link]');
    const id = link?.dataset.itemLink;
    if (!id) return;
    try {
      fetch('api/click.php', {
        method: 'POST',
        keepalive: true, // survives the page going away when the link opens in this tab
        headers: { 'Content-Type': 'application/json', 'X-Findom': '1' },
        body: JSON.stringify({ id }),
      }).catch(() => {});
    } catch {
      // no fetch, no count: the link still works
    }
  };
  root.addEventListener('click', send);
  root.addEventListener('auxclick', send);
}
