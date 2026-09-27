# 💳⛓️ Findom Yourself

**A self-inflicted financial domination project.** The site behind [findomyourself.com](https://www.findomyourself.com).

It's a wishlist that only unlocks when the work is done. Every hour of real work pays "tribute" into a vault;
slacking gets fined; an item unlocks the moment the vault can cover its price. A bratty domme voice ("Future You")
keeps score in public.

- **The vault.** Focus-timer hours (at your hourly rate), one-tap commands ("Gym session +$15"), real money earned,
  and fines ("Doomscrolled an hour −$10") all land in one ledger. The balance is simply its sum.
- **The list.** Each item sits behind frosted glass that clears from the bottom up as the vault fills. Prices in any
  currency are converted to your base currency. The cheapest item is the goal unless you pin one.
- **Live.** A "working now" light and timer when a focus session is running, a receipt printer for new tribute,
  and a streak counter. The page polls quietly and updates in place.
- **Crack the whip.** Visitors swing a physically simulated whip; flick hard enough and it cracks (and gets counted).
- **3D.** A chained obsidian credit card that prints the live balance and whose padlock springs open when something
  is affordable, a glass jar that fills with gold coins toward the goal, silk satin that shifts color per section,
  and drifting gold dust. All of it is WebGL (three.js), and all the textures are drawn in code.
- **Control Room** (`/admin/`). Mobile-first: paste a link from any shop (Amazon, Gucci, Farfetch, SSENSE, your own
  ShopMy/LTK/affiliate link…) on **Today**, the **List** tab or behind the **+** in the top bar to create an item
  (name, brand, price and photo are pulled from the page when the shop allows it), paste a whole list from
  Gemini/ChatGPT/Notes/a spreadsheet, start and stop the focus timer, one-tap commands and fines, claim items, edit
  every word on the site.

## Affiliate links

Visitors' shop buttons can earn a commission. For each item, the button opens the first of these that applies:

1. **Your link** on the item (a ShopMy, LTK, Amazon or Awin/Rakuten link you made), exactly as pasted. A shop link
   that already is an affiliate link goes out as it is too. This holds even with affiliate links switched off.
2. The **plain shop link**, when affiliate links are off or the shop is on the "never" list.
3. **Amazon**: the product with your Associates tag for that country. Amazon never goes through a network, so with
   no tag for that country the link stays plain.
4. A **shop you taught it**: paste one deep link you made (Awin, Rakuten, CJ, Impact, Partnerize…) and it reuses
   the pattern for every link to that shop.
5. **Skimlinks or Sovrn Commerce** (one ID) for everything else. Shops without a program still just work.
6. Otherwise, the plain shop link.

An affiliate or creator link pasted as a new item is recognized: it becomes the item's own link, the product inside
it is read as usual, and the editor offers to learn the shop (or save your Amazon tag). While any button uses an
affiliate link, the page shows a disclosure at the bottom (plus Amazon's required sentence when Amazon links show),
a small "Affiliate link" caption under that button, and marks the link `rel="sponsored"`. Clicks are counted per
item: once per visitor per day, bots ignored, IPs never stored.

Everything is set in **Control Room → Settings → Affiliate links**; an item's own link goes in **Your link** in
its editor, which also shows where visitors go and how often they click. The owner's step-by-step setup is in
[DEPLOY.md](DEPLOY.md#9-set-up-affiliate-links).

## Run it locally

PHP 8.1+ is all you need:

```bash
php -S 127.0.0.1:8080 tools/router.php   # site at /, Control Room at /admin/
```

Data goes to `private/` inside the repo (ignored by Git). The first visit to `/admin/` writes a setup code to
`private/setup-code.txt`. Add `?quality=low|mid|high` to force a 3D quality tier, `?debug` to expose the stage on
`window.__findom`.

## Tests

```bash
php tools/test.php     # money parsing, link cleanup, the SSRF guard, the paste importer, stats, streaks, visibility,
                       # affiliate links, click counting
node tools/smoke.mjs   # starts a throwaway server and walks every public + Control Room API flow end to end
```

## Going live

See **[DEPLOY.md](DEPLOY.md)** (Hostinger: add the website, connect this repo in hPanel, set up the Control Room).

## How it's built

No build step: PHP renders the page with its data inline, and plain ES modules take it from there.

```
index.php            the page (data inline as JSON, meta/OG, CSP) and the passcode gate for private mode
api/state.php        public state as JSON (ETag, so polling costs a 304 when nothing changed)
api/whip.php         counts whip cracks (rate-limited per visitor, IPs are never stored)
api/click.php        counts clicks on shop buttons (once per visitor per item per day, IPs are never stored)
admin/               the Control Room: index.php (setup, sign-in), api.php (every action), the UI
lib/store.php        the data model: items, commands, fines, ledger, session, settings, stats, streaks, the goal
lib/seed.php         first-run content: the 12 wishlist items, default commands, fines and voice lines
lib/fetch.php        fetching links safely (public addresses only) + reading product pages (Shopify, JSON-LD, OG,
                     Amazon), following short links, cleaning shop links
lib/affiliate.php    where each shop button goes, recognizing and learning affiliate links, click counts
lib/import.php       the paste-a-whole-list parser
lib/images.php       photo validation, orientation, resizing, WebP
lib/auth.php         sessions, CSRF, password, lockout, the private-mode viewer cookie
css/site.css         the design system and every section
js/main.js           boot: state, UI, the loader, the 3D stage, polling
js/ui/*              hero, nav, ribbons, menu, vault + receipt, list, modal, trophies, whip (DOM side), cursor
js/gl/*              the 3D: stage, silk, card (+ chains + padlock), jar (+ coin pile), whip (Verlet), dust, post
assets/vendor/       three.js and Lenis, bundled by tools/build-vendor.mjs
assets/fonts/        Bodoni Moda, Archivo, JetBrains Mono (self-hosted, OFL)
assets/img/          favicon, touch icon, link preview, fallback stills (for browsers without WebGL)
tools/               router.php (dev server), test.php, build-vendor.mjs, og/ (sources of the preview images)
```

**Performance.** The page renders from inline data immediately; three.js (tree-shaken, ~150 KB gzipped) loads
behind the intro counter. The 3D picks a quality tier from the device (pixel ratio, bloom, glass refraction,
particle counts) and steps down on its own if frames get slow. `prefers-reduced-motion` gets a still, full-quality
scene; browsers without WebGL 2 get pre-rendered stills.

**Security.** The admin password is bcrypt-hashed outside `public_html`; first-run setup needs a code from a file
only the server owner can read; sessions are HttpOnly + SameSite=Strict; every change needs a CSRF token; repeated
wrong passwords lock sign-in for 15 minutes. Link fetching resolves hosts first and refuses private, loopback and
cloud-metadata addresses (and re-checks every redirect), so a pasted link can't reach internal services. Photos are
re-encoded server-side under server-made names in a folder that never executes scripts. Every page sends a strict
Content-Security-Policy.

**Rebuilding the vendored libraries** (only when upgrading three.js or Lenis, or after importing a new three.js
class in `js/gl/`):

```bash
npm install && npm run vendor
```

## Credits

three.js and Lenis (MIT). Bodoni Moda, Archivo and JetBrains Mono (SIL Open Font License, see
`assets/fonts/LICENSE.md`). Designed and built with Claude.
