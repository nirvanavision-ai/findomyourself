# Going live on Hostinger

findomyourself.com was bought on Hostinger, so its DNS already points there. You add it as a website,
connect this GitHub repo in hPanel, and every push to `main` updates the live site. It's the same flow as
theeggplantfiles.com.

> Menu names below match hPanel at the time of writing. If a label differs slightly, look for the closest
> match.

## 1. Add the website

hPanel → **Websites** → **Add website** → choose an **empty PHP/HTML website** (not WordPress, not the
Website Builder) → pick **findomyourself.com**.

If your plan only allows one website, hPanel will say so when you try to add a second one. Premium and
Business web hosting plans allow several.

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
   - **Repository**: `git@github.com:nirvanavision-ai/findomyourself.git`
   - **Branch**: `main`
   - **Directory**: leave **empty** (that means `public_html`)
3. If the repo is private, Hostinger needs read access. Either click **Connect GitHub** / sign in with
   GitHub if hPanel offers it and pick the repo, **or** copy the **SSH key** hPanel shows in the GIT section,
   then in GitHub go to the repo → **Settings → Deploy keys → Add deploy key**, paste it, leave
   *Allow write access* **off**, and save.
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

## What's stored where

| What | Where | In Git? |
|------|-------|---------|
| Wishlist, ledger, rules, settings | `findom-private/data.json` (next to `public_html`, not web-accessible) | No |
| Whip counters | `findom-private/whips.json` | No |
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
