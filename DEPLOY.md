# Going live on Hostinger

findomyourself.com was bought on Hostinger, so its DNS already points there. You add it as a website,
connect this GitHub repo in hPanel, and every push to `main` updates the live site. It's the same flow as
theeggplantfiles.com.

> Menu names below match hPanel at the time of writing. If a label differs slightly, look for the closest
> match.

## 1. Add the website

hPanel → **Websites** → **Add website** → choose **Custom PHP/HTML website** (not WordPress, not the
Website Builder or Horizons) → use the **existing domain** **findomyourself.com** → **Continue**.

If **Websites** is empty, check **Domains** in the left menu: a domain on its own can't run the site, it needs
a **Web Hosting** plan. The plan theeggplantfiles.com is on can host this site too (Premium and Business
allow several websites); if you don't see theeggplantfiles.com either, you're signed in to a different
Hostinger account.

## 2. Turn on HTTPS

Website dashboard → **Security → SSL**: install the free SSL certificate for `findomyourself.com` (it covers
`www` too), then turn on **Force HTTPS**. It can take a few minutes to issue.

## 3. Check PHP

**Advanced → PHP Configuration**: pick **PHP 8.3** or **8.4**. The site needs the `curl`, `gd`, `fileinfo`
and `mbstring` extensions, which are on by default at Hostinger.

## 4. Connect the repo

Hostinger only deploys into a folder that is **completely empty**. A new website usually comes with a
`default.php` or `index.html` in `public_html`, so remove it first:

1. **Files → File Manager** → open `public_html` → turn on **Show hidden files** in the settings → select
   everything (including `.htaccess`) → **Delete**.
2. **Advanced → GIT** → *Create a new repository*:
   - **Repository**: `https://github.com/nirvanavision-ai/findomyourself.git`
   - **Branch**: `main`
   - **Directory**: leave **empty** (that means `public_html`)
3. The repo is public, so no key is needed. (If you ever make it private, switch the address to
   `git@github.com:nirvanavision-ai/findomyourself.git` and add the **SSH key** hPanel shows in the GIT section
   to the repo in GitHub under **Settings → Deploy keys**, with *Allow write access* **off**. Or use
   **Connect with GitHub** if hPanel offers it.)
4. Click **Create**, then **Deploy**. Visit **https://www.findomyourself.com**.

## 5. Turn on auto-deploy

In **Advanced → GIT**, open the repository's **Auto Deployment** and copy the **webhook URL**. In GitHub, go
to the repo → **Settings → Webhooks → Add webhook**:

- **Payload URL**: the webhook URL from hPanel
- **Content type**: `application/x-www-form-urlencoded`
- **Which events**: *Just the push event*

Now every merge to `main` goes live automatically.

## 6. Set up the Control Room (one time)

1. Open **www.findomyourself.com/admin/**. It asks for a **setup code**, which proves you own the server.
2. In **File Manager**, go **one level above `public_html`** (the `findomyourself.com` domain folder). Open
   `findom-private/setup-code.txt` and copy the code.
3. Paste it, choose a password (10+ characters), and you're in. You stay signed in on that device for 30
   days of inactivity, so the phone you log work from stays ready.

Forgot the password? Delete `findom-private/auth.json` in File Manager and reload `/admin/` to set a new one
(a fresh setup code is created). Your wishlist and ledger are untouched.

## 7. Bring in the product photos

The site ships with your 12 items but without photos (they're fetched by your server, not stored in Git).

- Control Room → **List** → **Fetch missing photos**. Your server visits each store link and downloads the
  main product photo. AMIRI (a Shopify store) usually works.
- Some stores block automated visits (Farfetch often does). For those, open the product page, right-click
  (long-press on a phone) the photo → **Copy image address**, and paste it into the item's **Image link**
  slot. Or upload the photo, or paste it straight from the clipboard.

## 8. Check prices and exchange rates

- Farfetch items are listed in euros and converted to dollars at the rate under **Settings → Money**. Hit
  **Refresh rates** for today's European Central Bank rates.
- The Chrome Hearts scarf came in as **1,911 €** but the list you pasted also said **~$1,229**. Those don't
  match, so open the item, check the real price, and fix it.

## 9. Set up affiliate links

Optional: the site works without any of this. With it, visitors' shop buttons earn you a commission. Everything
below is in the Control Room under **Settings → Affiliate links** (the sign-up pages are linked there too, under
**Where to sign up**). Press **Save changes** when you're done.

1. **Amazon Associates**, for Amazon links (Amazon only pays through its own program). Sign up at
   [affiliate-program.amazon.com](https://affiliate-program.amazon.com/) with the site's address. Your tracking ID,
   like `yourname-20`, is at the top right of Associates Central (and under **Manage Tracking IDs**). Paste it into
   **Tag for amazon.com (US)**. Each other Amazon country (amazon.co.uk, amazon.de…) is a separate sign-up with its
   own tag: those go under **Other Amazon stores**.
2. **Skimlinks or Sovrn Commerce**, for everything else. Pick one, not both. One ID turns links to Gucci, Farfetch,
   Net-a-Porter, SSENSE, Mytheresa, Nordstrom, Sephora and tens of thousands of other shops into affiliate links on
   its own; a shop without a program still just works. Sign up at [skimlinks.com](https://skimlinks.com/) or
   [sovrn.com/commerce](https://www.sovrn.com/commerce/), then under **Everything else, automatically** choose
   **Skimlinks** or **Sovrn** and paste:
   - Skimlinks: your publisher ID, like `123456X1234567` (Skimlinks → **Settings → Sites**).
   - Sovrn Commerce: your site's API key, 32 letters and numbers (Sovrn Commerce → **Settings → Sites**, the key
     icon).
3. **ShopMy and LTK**, for creator links. Sign up at [shopmy.us](https://shopmy.us/) or
   [company.shopltk.com](https://company.shopltk.com/). Make the link for a product in their app, then paste it
   into the add box: on **Today** (**Add a wish**), behind the **+** at the top of the screen, or on the **List**
   tab. It's recognized and saved as that item's own link. For an item that's already on the list, open it and
   paste the link into **Your link**. An item's own link always comes first.
4. **A brand's own program** on Rakuten, Awin, CJ or Impact, for one brand you buy from a lot. You keep the whole
   commission there (Skimlinks and Sovrn keep a share). Once the brand approves you, make a deep link to any of its
   products in the network, paste it under **Teach it a link** and press **Check**, then **Use it for all …
   links**. From then on every link to that shop goes through your program. Taught shops are listed under **Shops
   it knows**.
5. **Check it.** Open any item: under **Your link**, **Visitors go to:** says which link its button uses, with the
   clicks so far.

Shops that should always get a plain link go under **Never use affiliate links for**, one per line. **Use
affiliate links on the site** switches everything off at once (an item's own link is still used).

**The disclosure is automatic.** While any button uses an affiliate link, a short note appears at the bottom of
the site and a small **Affiliate link** caption sits under that button. Change the wording under **Disclosure**.
When Amazon links show, Amazon's required sentence ("As an Amazon Associate I earn from qualifying purchases.")
is added on its own.

Good to know:

- **Approval takes time.** Every program reviews the site first, which can take a few days or longer. Apply once
  the site is live with some items on it.
- **Amazon's 180 days.** Amazon closes the account if it doesn't get 3 qualifying sales in the first 180 days
  (you can apply again later).
- **Amazon needs a public site.** Keep **Settings → Visibility** on **Public** or **Hide amounts**. Behind a
  passcode (**Private**), Amazon can't see it.
- **Your own purchases usually don't count.** Most programs don't pay commission on things you buy yourself, and
  Amazon forbids buying through your own links. Commissions come from visitors buying.
- **Clicks aren't sales.** The Control Room counts button clicks (once per visitor per item per day, bots
  ignored). What you actually earned is in each program's own dashboard.
- **Some shops block automatic lookups** (Farfetch and Amazon often do), so the name, price or photo can come in
  empty. Type the price in the item, or use the **+ Findom** button on a computer (in **Settings → Affiliate
  links** and behind the **+**): drag it to your bookmarks bar, then click it on the product page. The Control Room
  opens with the item filled in, and nothing is saved until you press **Add to the list**. If you were signed out,
  sign in and click it again.

## What's stored where

| What | Where | In Git? |
|------|-------|---------|
| Wishlist, ledger, rules, settings | `findom-private/data.json` (next to `public_html`, not web-accessible) | No |
| Whip counters | `findom-private/whips.json` | No |
| Clicks on shop buttons (not in the backup file) | `findom-private/clicks.json` | No |
| Password hash, setup code, sign-in sessions | `findom-private/` | No |
| Item photos | `public_html/uploads/items/` | No |
| The site itself (code, fonts, 3D) | `public_html/` | Yes |

Code deploys never touch your data, because Git doesn't track it. Hostinger's regular backups include both
folders. For an extra copy, use **Settings → Backup → Download backup** in the Control Room.

If PHP can't create `findom-private/` next to `public_html`, the site falls back to `public_html/private/`,
which is blocked from the web by `.htaccess`.

## If a change doesn't show up

Hostinger's CDN can cache files for a while. In hPanel, go to **Performance → CDN → Purge all cache**, then
hard-refresh your browser (Shift + Reload). Wishlist edits and new photos skip the cache on their own; code
updates from GitHub are the ones that might need a purge.
