<?php
/*
 * FINDOM YOURSELF: Control Room JSON API. Every action needs a signed-in session, and
 * every change needs the session's CSRF token in the X-CSRF-Token header.
 *
 * GET  api.php?action=state     everything the Control Room shows, plus the CSRF token
 * GET  api.php?action=export    download a backup of all data
 * POST api.php?action=NAME      JSON body. Answers {ok: true, state, ...} so the UI can re-render.
 *
 *   login             {password}                  sign back in without losing work (header X-Findom-Admin: 1)
 *   item.save         {item}                      create (no id) or update; item.imageUrl also fetches that photo;
 *                                                 item.goal true/false pins/unpins it as the current goal;
 *                                                 item.affiliateUrl is her own link for it ('' clears it)
 *   item.fromLink     {url, category?}            paste a link from any shop, or an affiliate link → new item
 *                                                 (name, brand, price, photo); answers affiliate {network, kind, id}
 *                                                 when it's kept as her link, and suggestion (see affiliate.learn)
 *   link.inspect      {url}                       what a link tells us, without saving
 *   items.parse       {text}                      preview a pasted list
 *   items.import      {items}                     add the previewed items
 *   items.reorder     {ids}                       new display order
 *   items.fetchImages {ids?, exclude?, auto?, limit?}  fetch missing photos, a few per call (answers "remaining");
 *                                                 auto: the background fetch (skips items tried in the last day)
 *   item.delete       {id}
 *   item.claim        {id, amount?}               buy it: the vault pays and it moves to the trophy wall
 *   item.unclaim      {id}
 *   item.image.upload multipart: id, file
 *   item.image.fetch  {id, url}                   photo from an image link or a product page
 *   item.image.remove {id}
 *   ledger.add        {type, label?, amount?, minutes?, at?, ref?, note?}
 *   ledger.update     {id, label?, amount?, minutes?, at?, note?}
 *   ledger.delete     {id}
 *   session.start     {label?, minutesAgo?}
 *   session.update    {label?, minutesAgo?}
 *   session.stop      {minutes?, label?, discard?}
 *   settings.save     {settings}                  partial; settings.passcode (plain text) is hashed here;
 *                                                 each part of settings.affiliate that's sent replaces the old one
 *   affiliate.detect  {url, shopUrl?}             what an affiliate link is, what it would teach, and where
 *                                                 visitors would go for that shop (preview), without saving;
 *                                                 with shopUrl, where that item would go with url as Your link (out)
 *   affiliate.learn   {url}                       teach it one of her links: a rule for that shop, her Amazon
 *                                                 tag or the catch-all network (answers "applied")
 *   rules.save        {commands?, fines?}
 *   fx.refresh        {}
 *   password.change   {current, next}
 *   data.import       {data}                      restore a backup
 */
declare(strict_types=1);

require __DIR__ . '/../lib/store.php';
require __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/fetch.php'; // store.php loads these two already
require_once __DIR__ . '/../lib/affiliate.php';
require __DIR__ . '/../lib/images.php';
require __DIR__ . '/../lib/import.php';

const EDITABLE_ITEM_FIELDS = ['name', 'brand', 'variant', 'category', 'price', 'currency', 'url', 'affiliateUrl', 'priority', 'note'];
const PHOTO_RETRY_SECONDS = 86400; // the automatic photo fetch waits a day after a miss… (RETRY_MS in admin/js/bulk.js)
const PHOTO_AUTO_TRIES = 3;        // …and stops trying a link after this many (AUTO_TRIES there)

send_admin_headers();

$action = is_string($_GET['action'] ?? null) ? $_GET['action'] : '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($action === 'login' && $method === 'POST') {
    api_login();
}
// Resumes the owner's session only; anonymous requests never create one.
if (!is_set_up() || !start_session() || !is_authed()) {
    json_fail(401, 'You were signed out. Sign in again to keep going.', ['code' => 'auth']);
}
session_write_close(); // nothing below changes the session: don't make parallel requests wait on its lock

if ($method === 'GET') {
    if ($action === 'state') {
        json_out(['ok' => true, 'csrf' => csrf_token(), 'state' => admin_state(load_data()), 'meta' => server_meta()]);
    }
    if ($action === 'export') {
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="findom-yourself-backup-' . gmdate('Y-m-d') . '.json"');
        echo json_encode(load_data(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
        exit;
    }
    json_fail(400, 'Unknown request.');
}
if ($method !== 'POST') {
    json_fail(405, 'Unsupported request.');
}
if (!check_csrf($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null)) {
    // The UI fetches a fresh token and retries once, e.g. after signing in again in another tab.
    json_fail(403, 'Security check failed. Reload the page and try again.', ['code' => 'csrf']);
}

$actions = [
    'item.save' => 'act_item_save',
    'item.fromLink' => 'act_item_from_link',
    'link.inspect' => 'act_link_inspect',
    'items.parse' => 'act_items_parse',
    'items.import' => 'act_items_import',
    'items.reorder' => 'act_items_reorder',
    'items.fetchImages' => 'act_items_fetch_images',
    'item.delete' => 'act_item_delete',
    'item.claim' => 'act_item_claim',
    'item.unclaim' => 'act_item_unclaim',
    'item.image.upload' => 'act_image_upload',
    'item.image.fetch' => 'act_image_fetch',
    'item.image.remove' => 'act_image_remove',
    'ledger.add' => 'act_ledger_add',
    'ledger.update' => 'act_ledger_update',
    'ledger.delete' => 'act_ledger_delete',
    'session.start' => 'act_session_start',
    'session.update' => 'act_session_update',
    'session.stop' => 'act_session_stop',
    'settings.save' => 'act_settings_save',
    'affiliate.detect' => 'act_affiliate_detect',
    'affiliate.learn' => 'act_affiliate_learn',
    'rules.save' => 'act_rules_save',
    'fx.refresh' => 'act_fx_refresh',
    'password.change' => 'act_password_change',
    'data.import' => 'act_data_import',
];
if (!isset($actions[$action])) {
    json_fail(400, 'Unknown action.');
}
$in = $action === 'item.image.upload' ? $_POST : request_json($action === 'data.import' ? 20 * 1024 * 1024 : 1024 * 1024);
$extra = $actions[$action]($in);
json_out(['ok' => true, 'state' => admin_state(load_data())] + $extra);

/* ───────────────────────── state ───────────────────────── */

function admin_state(array $data): array
{
    $stats = compute_stats($data);
    $views = item_views($data, $stats['balance']);
    $settings = $data['settings'];
    $settings['hasPasscode'] = $settings['passcodeHash'] !== '';
    unset($settings['passcodeHash']);
    $settings['affiliate']['amazon'] = (object)$settings['affiliate']['amazon']; // {} rather than [] when empty
    // Where each item's button takes visitors, and how often they've clicked it.
    $clicks = load_clicks();
    $clicksTotal = 0;
    foreach ($views as &$view) {
        $view['out'] = resolve_outbound($view, $data['settings']);
        $view['clicks'] = click_summary($clicks, $view['id'], $data['settings']['timezone']);
        $clicksTotal += $view['clicks']['total'];
    }
    unset($view);
    return [
        'settings' => $settings,
        'stats' => $stats,
        'goalId' => pick_goal($views, $data['settings']),
        'items' => $views,
        'clicksTotal' => $clicksTotal,
        'clicksCapped' => clicks_capped_today($clicks, $data['settings']['timezone']), // today's clicks stopped being counted
        'commands' => $data['commands'],
        'fines' => $data['fines'],
        'ledger' => array_slice($data['ledger'], 0, 400),
        'ledgerCount' => count($data['ledger']),
        'session' => $data['session'],
        'whips' => whips_summary(load_whips(), $settings['timezone']),
        'updatedAt' => $data['updatedAt'],
        'serverTime' => iso_now(),
    ];
}

function server_meta(): array
{
    return [
        'curl' => function_exists('curl_init'),
        'gd' => extension_loaded('gd'),
        'webp' => function_exists('imagewebp'),
        'maxUpload' => min(ini_bytes('upload_max_filesize'), ini_bytes('post_max_size'), IMAGE_MAX_UPLOAD),
        'currencies' => CURRENCIES,
        'copyFields' => COPY_FIELDS,
        'voiceMoods' => VOICE_MOODS,
        'amazonMarketplaces' => amazon_marketplace_names(),
        'affiliateNetworks' => AFFILIATE_NETWORKS,
        'php' => PHP_VERSION,
    ];
}

/* ───────────────────────── helpers ───────────────────────── */

function item_index(array $data, $id): ?int
{
    if (!valid_id($id)) {
        return null;
    }
    foreach ($data['items'] as $i => $item) {
        if ($item['id'] === $id) {
            return $i;
        }
    }
    return null;
}

function require_item(array $data, $id): int
{
    $index = item_index($data, $id);
    if ($index === null) {
        json_fail(404, 'That item isn’t on the list anymore. Reload to catch up.');
    }
    return $index;
}

function fail_on(RuntimeException $e, int $status = 422): void
{
    json_fail($status, $e->getMessage());
}

/** Downloads $url as the photo for item $id (replacing any old one). Throws on failure. */
function attach_image_from_url(string $id, string $url): string
{
    $data = load_data();
    $index = item_index($data, $id);
    $referer = $index !== null ? $data['items'][$index]['url'] : '';
    $tmp = download_image($url, $referer);
    try {
        $path = store_item_image($tmp, $id, IMAGE_MAX_PIXELS_REMOTE);
    } finally {
        @unlink($tmp);
    }
    set_item_image($id, $path, $url);
    return $path;
}

/** Points item $id at a stored photo and deletes the one it replaces. */
function set_item_image(string $id, string $path, string $source): void
{
    $old = mutate_data(function (array &$data) use ($id, $path, $source) {
        $index = item_index($data, $id);
        if ($index === null) {
            return false;
        }
        $old = $data['items'][$index]['image'];
        $data['items'][$index]['image'] = $path;
        if ($source !== '') {
            $data['items'][$index]['imageSource'] = $source;
        }
        return $old;
    });
    if ($old === false) {
        delete_item_image($path);
        json_fail(404, 'That item isn’t on the list anymore.');
    }
    if ($old !== '' && $old !== $path) {
        delete_item_image($old);
    }
}

function url_key(string $url): string
{
    $url = canonical_product_url($url); // e.g. every way of writing one Amazon product is the same product
    return rtrim((string)preg_replace('#^https?://(www\.)?#i', '', strtolower($url)), '/');
}

/**
 * A new shop link as it's kept: its short form without tracking (Amazon's /dp/ASIN, without her
 * search words or the tag of whoever's link she came through), like a pasted link. An affiliate or
 * creator link typed in as the shop link stays whole: its parameters are what makes it work.
 */
function kept_shop_link(string $url): string
{
    $found = detect_affiliate_link($url);
    return $found && $found['kind'] !== 'amazon' ? $url : (clean_url(canonical_product_url($url)) ?: $url);
}

/* ───────────────────────── items ───────────────────────── */

function act_item_save(array $in): array
{
    $raw = is_array($in['item'] ?? null) ? $in['item'] : [];
    if (isset($raw['url']) && is_string($raw['url']) && $raw['url'] !== '') {
        $raw['url'] = normalize_link($raw['url']);
        if (clean_url($raw['url']) === '') {
            json_fail(400, 'That link doesn’t look right. Paste the full address, starting with https://');
        }
    }
    if (array_key_exists('affiliateUrl', $raw)) { // her own link is kept as she made it: only Google's wrapper comes off
        $mine = is_string($raw['affiliateUrl']) ? trim($raw['affiliateUrl']) : '';
        if ($mine !== '') {
            $mine = clean_url(unwrap_google_link($mine));
            if ($mine === '') {
                json_fail(400, 'Your link doesn’t look right. Paste the full address, starting with https://');
            }
        }
        $raw['affiliateUrl'] = $mine;
    }
    $imageUrl = clean_url($raw['imageUrl'] ?? '');
    $id = mutate_data(function (array &$data) use ($raw) {
        $index = item_index($data, $raw['id'] ?? null);
        // A new or changed shop link (typed, or grabbed from the page she's on) is shortened like a pasted one.
        if (isset($raw['url']) && is_string($raw['url']) && $raw['url'] !== ''
            && ($index === null || $raw['url'] !== $data['items'][$index]['url'])) {
            $raw['url'] = kept_shop_link($raw['url']);
        }
        if ($index === null) {
            if (count($data['items']) >= MAX_ITEMS) {
                json_fail(400, 'The list is full (' . MAX_ITEMS . ' items). Delete a few first.');
            }
            $fields = array_intersect_key($raw, array_flip(EDITABLE_ITEM_FIELDS));
            $item = normalize_item(['id' => new_id('i'), 'status' => 'wishing', 'createdAt' => iso_now()] + $fields, $data['settings']);
            if (!$item) {
                json_fail(400, 'Give it a name first.');
            }
            array_unshift($data['items'], $item);
        } else {
            $old = $data['items'][$index];
            $merged = array_merge($old, array_intersect_key($raw, array_flip(EDITABLE_ITEM_FIELDS)));
            if (in_array($raw['status'] ?? null, ['wishing', 'archived'], true) && $old['status'] !== 'claimed') {
                $merged['status'] = $raw['status'];
            }
            $item = normalize_item($merged, $data['settings']);
            if (!$item) {
                json_fail(400, 'An item needs a name.');
            }
            $data['items'][$index] = $item;
        }
        if (array_key_exists('goal', $raw)) {
            if ($raw['goal']) {
                $data['settings']['goalId'] = $item['id'];
            } elseif ($data['settings']['goalId'] === $item['id']) {
                $data['settings']['goalId'] = '';
            }
        }
        return $item['id'];
    });
    $warnings = [];
    if ($imageUrl !== '') {
        try {
            attach_image_from_url($id, $imageUrl);
        } catch (RuntimeException $e) {
            $warnings[] = 'Saved, but the photo didn’t download: ' . $e->getMessage();
        }
    }
    return ['itemId' => $id, 'warnings' => $warnings];
}

/** Brands already on the list, so a link or pasted name starting with one gets it split off. */
function wishlist_brands(array $data): array
{
    return array_values(array_unique(array_filter(array_map('strval', array_column($data['items'], 'brand')))));
}

function act_link_inspect(array $in): array
{
    try {
        return ['info' => inspect_link((string)($in['url'] ?? ''), wishlist_brands(load_data()))];
    } catch (RuntimeException $e) {
        fail_on($e, 400);
    }
    return [];
}

/**
 * The "paste a link" box: a link from any shop, or one of her affiliate links (Awin, ShopMy, Amazon
 * with a tag…), which is kept as her link while the shop link inside it (or at the end of its
 * redirects) becomes the item's link. A link her settings already cover (an Amazon store she has a
 * tag for, Skimlinks/Sovrn while she has a catch-all) isn't kept: her own tag or ID is used, not the
 * one in the link. The item is created even if the shop refuses to talk to us.
 */
function act_item_from_link(array $in): array
{
    @set_time_limit(60);
    $pasted = unwrap_google_link(trim(is_string($in['url'] ?? null) ? $in['url'] : ''));
    $found = detect_affiliate_link($pasted);
    // A link through a site we don't know by name ("…?url=…") may only be a redirect: the shop link
    // inside it becomes the item's link, but it isn't kept as her link or offered as a rule.
    $unknown = $found && $found['network'] === 'Affiliate network';
    // An Amazon link with a tag is looked up as pasted: the words in it can still name the product.
    $lookup = $found && $found['destination'] !== '' && $found['kind'] !== 'amazon' ? $found['destination'] : $pasted;
    $landed = '';
    try {
        $info = inspect_link($lookup, wishlist_brands(load_data()), $landed);
    } catch (RuntimeException $e) {
        fail_on($e, 400);
        return [];
    }
    // An Amazon short link is what it led to: SiteStripe's carry a tag, the app's Share links don't.
    $found = amazon_short_link_found($pasted, $found, $landed);
    $data = load_data();
    $affiliate = $data['settings']['affiliate'];
    $mine = '';
    $notes = [];
    if ($unknown) {
        $notes[] = 'That link went through ' . link_host($pasted) . ' first, so only the shop link inside it was kept. If it was your affiliate link, paste it into Your link.';
    } elseif ($found && $found['network'] !== 'Short link') {
        $hers = own_affiliate_id($found, $affiliate);
        if ($hers === '') {
            $mine = clean_url($pasted);
        } elseif ($found['id'] !== '' && strcasecmp($hers, $found['id']) !== 0) {
            $notes[] = 'That link carried the ' . ($found['kind'] === 'amazon' ? 'Amazon tag ' : $found['network'] . ' ID ') . $found['id']
                . '. Your own ' . ($found['kind'] === 'amazon' ? 'tag (' . $hers . ')' : AFFILIATE_NETWORKS[$affiliate['network']] . ' ID')
                . ' is used instead.';
        }
    }
    $learned = $unknown ? null : learn_affiliate_link($pasted);
    $suggestion = $learned && affiliate_suggestion_is_new($learned, $affiliate) ? $learned : null;
    // What she's told was kept as her link, with the tag or ID in it, so one that isn't hers stands out.
    $recognized = $mine !== '' ? ['network' => $found['network'], 'kind' => $found['kind'], 'id' => $found['id']] : null;

    $pastedKey = clean_url($pasted);
    foreach ($data['items'] as $item) {
        $same = ($item['url'] !== '' && url_key($item['url']) === url_key($info['url']))
            || ($item['affiliateUrl'] !== '' && $item['affiliateUrl'] === $pastedKey);
        if (!$same) {
            continue;
        }
        if ($mine !== '' && $item['affiliateUrl'] === '') { // her link for something already on the list: attach it
            mutate_data(function (array &$data) use ($item, $mine) {
                $index = item_index($data, $item['id']);
                if ($index !== null && $data['items'][$index]['affiliateUrl'] === '') {
                    $data['items'][$index]['affiliateUrl'] = $mine;
                }
            });
            return ['itemId' => $item['id'], 'duplicate' => true, 'info' => $info, 'affiliate' => $recognized,
                'suggestion' => $suggestion, 'warnings' => array_merge($notes, ['That’s already on your list, so your link was added to it.'])];
        }
        return ['itemId' => $item['id'], 'duplicate' => true, 'info' => $info, 'affiliate' => null,
            'suggestion' => $suggestion, 'warnings' => array_merge($notes, ['That link is already on your list.'])];
    }
    $id = mutate_data(function (array &$data) use ($info, $in, $mine) {
        if (count($data['items']) >= MAX_ITEMS) {
            json_fail(400, 'The list is full (' . MAX_ITEMS . ' items). Delete a few first.');
        }
        $item = normalize_item([
            'id' => new_id('i'),
            'name' => $info['name'] !== '' ? $info['name'] : ($info['store'] ?: 'New') . ' find',
            'brand' => $info['brand'],
            'variant' => $info['variant'],
            'category' => clean_text($in['category'] ?? '', 60),
            'price' => $info['price'] ?? 0,
            'currency' => $info['currency'] ?: $data['settings']['baseCurrency'],
            'url' => $info['url'],
            'affiliateUrl' => $mine,
            'imageSource' => $info['image'],
            'status' => 'wishing',
            'createdAt' => iso_now(),
        ], $data['settings']);
        array_unshift($data['items'], $item);
        return $item['id'];
    });

    $warnings = $notes;
    if (!$info['found']) {
        $warnings[] = ($info['error'] ?: $info['store'] . ' didn’t share the details.') . ' The item was still added, named from the link. Check the name and add the price.';
    } elseif ($info['price'] === null) {
        $warnings[] = 'Couldn’t read the price. Add it so the item can unlock.';
    }
    if ($info['image'] !== '') {
        try {
            attach_image_from_url($id, $info['image']);
        } catch (RuntimeException $e) {
            $warnings[] = 'The photo didn’t download (' . $e->getMessage() . '). Paste an image link or upload one.';
        }
    } elseif ($info['found']) {
        $warnings[] = 'No photo found on the page. Paste an image link or upload one.';
    }
    return ['itemId' => $id, 'info' => $info, 'affiliate' => $recognized, 'suggestion' => $suggestion, 'warnings' => $warnings];
}

function act_items_parse(array $in): array
{
    $text = (string)($in['text'] ?? '');
    if (strlen($text) > 300 * 1024) {
        json_fail(413, 'That’s a lot of text. Paste up to 200 items at a time.');
    }
    $data = load_data();
    $items = parse_wishlist_text($text, wishlist_brands($data));
    $urls = [];
    $mine = [];
    $names = [];
    foreach ($data['items'] as $item) {
        if ($item['url'] !== '') {
            $urls[url_key($item['url'])] = true;
        }
        if ($item['affiliateUrl'] !== '') {
            $mine[$item['affiliateUrl']] = true;
        }
        $names[mb_strtolower($item['brand'] . ' ' . $item['name'])] = true;
    }
    foreach ($items as &$item) {
        $item['duplicate'] = ($item['url'] !== '' && isset($urls[url_key($item['url'])]))
            || ($item['affiliateUrl'] !== '' && isset($mine[$item['affiliateUrl']]))
            || ($item['url'] === '' && isset($names[mb_strtolower($item['brand'] . ' ' . $item['name'])]));
    }
    unset($item);
    return ['items' => $items];
}

function act_items_import(array $in): array
{
    $list = array_slice(is_array($in['items'] ?? null) ? $in['items'] : [], 0, IMPORT_MAX_ITEMS);
    $ids = mutate_data(function (array &$data) use ($list) {
        $new = [];
        foreach ($list as $raw) {
            if (!is_array($raw)) {
                continue;
            }
            $fields = array_intersect_key($raw, array_flip(EDITABLE_ITEM_FIELDS));
            if (isset($fields['url']) && is_string($fields['url'])) {
                $fields['url'] = canonical_product_url($fields['url']);
            }
            if (isset($fields['affiliateUrl']) && is_string($fields['affiliateUrl']) && $fields['affiliateUrl'] !== '') {
                // An affiliate link her settings already cover isn't kept as her link (whoever's tag
                // or ID is in it): her own is used for the shop link inside it.
                $found = detect_affiliate_link($fields['affiliateUrl']);
                if ($found && affiliate_link_redundant($found, $data['settings']['affiliate'])) {
                    $fields['affiliateUrl'] = '';
                    if (!is_string($fields['url'] ?? null) || $fields['url'] === '') {
                        $fields['url'] = $found['destination'];
                    }
                }
            }
            $item = normalize_item(['id' => new_id('i'), 'status' => 'wishing', 'createdAt' => iso_now(),
                'imageSource' => clean_url($raw['image'] ?? '')] + $fields, $data['settings']);
            if ($item) {
                $new[] = $item;
            }
        }
        if (count($data['items']) + count($new) > MAX_ITEMS) {
            json_fail(400, 'That would put more than ' . MAX_ITEMS . ' items on the list.');
        }
        $data['items'] = array_merge($new, $data['items']);
        return array_column($new, 'id');
    });
    return ['added' => count($ids), 'ids' => $ids];
}

function act_items_reorder(array $in): array
{
    $ids = array_values(array_filter((array)($in['ids'] ?? []), 'valid_id'));
    mutate_data(function (array &$data) use ($ids) {
        $byId = array_column($data['items'], null, 'id');
        $ordered = [];
        foreach ($ids as $id) {
            if (isset($byId[$id])) {
                $ordered[] = $byId[$id];
                unset($byId[$id]);
            }
        }
        $data['items'] = array_merge($ordered, array_values($byId)); // anything not mentioned keeps its place at the end
    });
    return [];
}

/**
 * Fetches photos for items that don't have one, starting new ones for ~12 seconds per call, or
 * at most "limit" of them. The UI calls again while "remaining" > 0, passing the ids that failed
 * as "exclude". "auto" is the Control Room's background fetch, with stricter rules (see
 * photo_fetch_wanted). Each item is marked as looked-at just before it's tried, so a phone and a
 * laptop open at once don't fetch the same photo twice. Failures carry the shop's name, whether
 * it blocked the lookup, and how often this link has been tried (the summary names new misses only).
 */
function act_items_fetch_images(array $in): array
{
    @set_time_limit(90);
    $exclude = array_flip(array_filter((array)($in['exclude'] ?? []), 'valid_id'));
    $only = array_flip(array_filter((array)($in['ids'] ?? []), 'valid_id'));
    $auto = ($in['auto'] ?? false) === true;
    $limit = max(0, min(50, (int)($in['limit'] ?? 0))); // 0: as many as fit in the time
    $data = load_data();
    $now = time();
    $todo = array_values(array_filter($data['items'], function ($item) use ($exclude, $only, $auto, $now) {
        return photo_fetch_wanted($item, $auto, $now)
            && !isset($exclude[$item['id']]) && (!$only || isset($only[$item['id']]));
    }));
    $started = microtime(true);
    $done = [];
    $failed = [];
    foreach ($todo as $n => $item) {
        if (($limit && count($done) + count($failed) >= $limit) || microtime(true) - $started > 12) {
            break;
        }
        unset($todo[$n]);
        $item = claim_photo_fetch($item['id'], $auto);
        if ($item === null) {
            continue; // deleted, given a photo meanwhile, or another device is already on it
        }
        $blocked = false;
        try {
            $source = $item['imageSource'];
            if ($source === '') {
                $info = inspect_link($item['url']);
                $source = $info['image'];
                $blocked = $info['blocked'];
                if ($source === '') {
                    throw new RuntimeException($info['error'] ?: 'No photo on the page.');
                }
            }
            attach_image_from_url($item['id'], $source);
            $done[] = $item['id'];
        } catch (RuntimeException $e) {
            $failed[] = ['id' => $item['id'], 'name' => $item['name'], 'error' => $e->getMessage(),
                'store' => store_name($item['url'] ?: $item['imageSource']), 'blocked' => $blocked,
                'tries' => $item['imageFetch']['tries']];
        }
    }
    return ['done' => $done, 'failed' => $failed, 'remaining' => count($todo)];
}

/**
 * Whether a photo fetch should look for this item's photo. The background fetch ($auto) also skips
 * items that ever had a photo (one she removed stays removed), and tries each link a few times at
 * most, a day apart: a shop that always blocks isn't asked (or reported) every day.
 */
function photo_fetch_wanted(array $item, bool $auto, int $now): bool
{
    if ($item['image'] !== '' || $item['status'] === 'archived' || ($item['imageSource'] === '' && $item['url'] === '')) {
        return false;
    }
    $fetch = $item['imageFetch'];
    return !$auto || $fetch === null
        || (!$fetch['had'] && $fetch['tries'] < PHOTO_AUTO_TRIES
            && ($fetch['at'] === null || $now - (int)strtotime($fetch['at']) >= PHOTO_RETRY_SECONDS));
}

/** Marks item $id's photo as looked for now, if it still wants one. Answers the item as it is now, or null. */
function claim_photo_fetch(string $id, bool $auto): ?array
{
    return mutate_data(function (array &$data) use ($id, $auto) {
        $index = item_index($data, $id);
        if ($index === null || !photo_fetch_wanted($data['items'][$index], $auto, time())) {
            return null;
        }
        $item = $data['items'][$index];
        $data['items'][$index]['imageFetch'] = [
            'at' => iso_now(),
            'tries' => ($item['imageFetch']['tries'] ?? 0) + 1,
            'had' => $item['imageFetch']['had'] ?? false,
            'for' => image_fetch_key($item['url'], $item['imageSource']),
        ];
        return $data['items'][$index];
    });
}

function act_item_delete(array $in): array
{
    $image = mutate_data(function (array &$data) use ($in) {
        $index = require_item($data, $in['id'] ?? null);
        $image = $data['items'][$index]['image'];
        if ($data['settings']['goalId'] === $data['items'][$index]['id']) {
            $data['settings']['goalId'] = '';
        }
        array_splice($data['items'], $index, 1);
        return $image;
    });
    delete_item_image($image);
    return [];
}

function act_item_claim(array $in): array
{
    $entryId = mutate_data(function (array &$data) use ($in) {
        $index = require_item($data, $in['id'] ?? null);
        $item = $data['items'][$index];
        if ($item['status'] === 'claimed') {
            json_fail(409, 'Already claimed. Greedy.');
        }
        $price = to_base((float)$item['price'], $item['currency'], $data['settings']);
        $amount = isset($in['amount']) && is_numeric($in['amount']) ? money(abs((float)$in['amount'])) : $price;
        $entry = normalize_entry([
            'id' => new_id('l'),
            'type' => 'claim',
            'label' => trim(($item['brand'] !== '' ? $item['brand'] . ' ' : '') . $item['name']),
            'amount' => $amount,
            'at' => iso_now(),
            'ref' => $item['id'],
        ]);
        array_unshift($data['ledger'], $entry);
        $data['items'][$index]['status'] = 'claimed';
        $data['items'][$index]['claimedAt'] = iso_now();
        if ($data['settings']['goalId'] === $item['id']) {
            $data['settings']['goalId'] = '';
        }
        return $entry['id'];
    });
    return ['entryId' => $entryId];
}

function act_item_unclaim(array $in): array
{
    mutate_data(function (array &$data) use ($in) {
        $index = require_item($data, $in['id'] ?? null);
        $id = $data['items'][$index]['id'];
        $data['items'][$index]['status'] = 'wishing';
        $data['items'][$index]['claimedAt'] = null;
        $data['ledger'] = array_values(array_filter($data['ledger'], function ($e) use ($id) {
            return !($e['type'] === 'claim' && $e['ref'] === $id);
        }));
    });
    return [];
}

function act_image_upload(array $in): array
{
    if (!$in && !$_FILES && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
        // Over post_max_size, PHP drops the whole body (id and file alike): say so, not "item gone".
        json_fail(413, 'The server says that photo is too large. Try a smaller one.');
    }
    $id = (string)($in['id'] ?? '');
    $data = load_data();
    require_item($data, $id);
    $file = $_FILES['file'] ?? null;
    if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
        $tooBig = in_array($file['error'] ?? 0, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true);
        json_fail($tooBig ? 413 : 400, $tooBig ? 'The server says that photo is too large. Try a smaller one.' : 'The photo didn’t arrive. Try again.');
    }
    try {
        $path = store_item_image($file['tmp_name'], $id);
    } catch (RuntimeException $e) {
        fail_on($e, 415);
        return [];
    }
    set_item_image($id, $path, '');
    return ['image' => $path];
}

function act_image_fetch(array $in): array
{
    $id = (string)($in['id'] ?? '');
    require_item(load_data(), $id);
    $url = trim((string)($in['url'] ?? ''));
    if (clean_url(normalize_link($url)) === '') {
        json_fail(400, 'Paste the full image address, starting with https://');
    }
    @set_time_limit(60);
    try {
        $path = attach_image_from_url($id, $url);
    } catch (RuntimeException $e) {
        fail_on($e);
        return [];
    }
    return ['image' => $path];
}

function act_image_remove(array $in): array
{
    $image = mutate_data(function (array &$data) use ($in) {
        $index = require_item($data, $in['id'] ?? null);
        $image = $data['items'][$index]['image'];
        $data['items'][$index]['image'] = '';
        $data['items'][$index]['imageSource'] = '';
        return $image;
    });
    delete_item_image($image);
    return [];
}

/* ───────────────────────── ledger ───────────────────────── */

/** A time no later than a few minutes from now (phones' clocks drift). */
function entry_time($value): string
{
    $at = clean_iso($value) ?? iso_now();
    return strtotime($at) > time() + 300 ? iso_now() : $at;
}

function act_ledger_add(array $in): array
{
    $type = (string)($in['type'] ?? '');
    if (!in_array($type, ['work', 'task', 'money', 'fine', 'adjust'], true)) {
        json_fail(400, 'Unknown kind of entry.');
    }
    $entryId = mutate_data(function (array &$data) use ($in, $type) {
        $label = clean_text($in['label'] ?? '', 120);
        $amount = isset($in['amount']) && is_numeric($in['amount']) ? money((float)$in['amount']) : null;
        $minutes = null;
        $ref = valid_id($in['ref'] ?? null) ? $in['ref'] : '';
        if ($ref !== '' && in_array($type, ['task', 'fine'], true)) {
            $rules = $type === 'task' ? $data['commands'] : $data['fines'];
            foreach ($rules as $rule) {
                if ($rule['id'] === $ref) {
                    $label = $label ?: trim($rule['emoji'] . ' ' . $rule['name']);
                    $amount = $amount ?? $rule['amount'];
                }
            }
        }
        if ($type === 'work') {
            $minutes = (int)round((float)($in['minutes'] ?? 0));
            if ($minutes < 1 || $minutes > 24 * 60) {
                json_fail(400, 'Log between 1 minute and 24 hours of work.');
            }
            $amount = $amount ?? work_pay($minutes, $data['settings']);
        }
        if ($amount === null || ($amount == 0 && $type !== 'work')) {
            json_fail(400, 'How much is it worth? Enter an amount.');
        }
        $entry = normalize_entry([
            'id' => new_id('l'),
            'type' => $type,
            'label' => $label,
            'amount' => $amount,
            'minutes' => $minutes,
            'at' => entry_time($in['at'] ?? null),
            'ref' => $ref,
            'note' => $in['note'] ?? '',
        ]);
        array_unshift($data['ledger'], $entry);
        return $entry['id'];
    });
    return ['entryId' => $entryId];
}

function act_ledger_update(array $in): array
{
    mutate_data(function (array &$data) use ($in) {
        foreach ($data['ledger'] as $i => $entry) {
            if ($entry['id'] !== ($in['id'] ?? null)) {
                continue;
            }
            foreach (['label', 'note'] as $field) {
                if (array_key_exists($field, $in)) {
                    $entry[$field] = $in[$field];
                }
            }
            if (isset($in['amount']) && is_numeric($in['amount'])) {
                $entry['amount'] = money((float)$in['amount']);
            }
            if ($entry['type'] === 'work' && isset($in['minutes']) && is_numeric($in['minutes'])) {
                $entry['minutes'] = (int)round((float)$in['minutes']);
                if (!isset($in['amount'])) {
                    $entry['amount'] = work_pay($entry['minutes'], $data['settings']);
                }
            }
            if (isset($in['at'])) {
                $entry['at'] = entry_time($in['at']);
            }
            $clean = normalize_entry($entry);
            if (!$clean) {
                json_fail(400, 'That change doesn’t make sense for this entry.');
            }
            $data['ledger'][$i] = $clean;
            return;
        }
        json_fail(404, 'That entry is gone. Reload to catch up.');
    });
    return [];
}

function act_ledger_delete(array $in): array
{
    mutate_data(function (array &$data) use ($in) {
        foreach ($data['ledger'] as $i => $entry) {
            if ($entry['id'] !== ($in['id'] ?? null)) {
                continue;
            }
            array_splice($data['ledger'], $i, 1);
            if ($entry['type'] === 'claim' && $entry['ref'] !== '') { // undoing a purchase puts the item back on the list
                $index = item_index($data, $entry['ref']);
                if ($index !== null && $data['items'][$index]['status'] === 'claimed') {
                    $data['items'][$index]['status'] = 'wishing';
                    $data['items'][$index]['claimedAt'] = null;
                }
            }
            return;
        }
        json_fail(404, 'That entry is already gone.');
    });
    return [];
}

/* ───────────────────────── focus timer ───────────────────────── */

function started_at(array $in): string
{
    $ago = max(0, min(12 * 60, (int)($in['minutesAgo'] ?? 0)));
    return gmdate('Y-m-d\TH:i:s\Z', time() - $ago * 60);
}

function act_session_start(array $in): array
{
    mutate_data(function (array &$data) use ($in) {
        if ($data['session']) {
            json_fail(409, 'A session is already running. Stop it first.');
        }
        $data['session'] = ['startedAt' => started_at($in), 'label' => clean_text($in['label'] ?? '', 60) ?: 'Focus session'];
    });
    return [];
}

function act_session_update(array $in): array
{
    mutate_data(function (array &$data) use ($in) {
        if (!$data['session']) {
            json_fail(409, 'No session is running.');
        }
        if (array_key_exists('label', $in)) {
            $data['session']['label'] = clean_text($in['label'], 60) ?: 'Focus session';
        }
        if (array_key_exists('minutesAgo', $in)) {
            $data['session']['startedAt'] = started_at($in);
        }
    });
    return [];
}

function act_session_stop(array $in): array
{
    $result = mutate_data(function (array &$data) use ($in) {
        $session = $data['session'];
        if (!$session) {
            json_fail(409, 'No session is running.');
        }
        $data['session'] = null;
        if (!empty($in['discard'])) {
            return ['logged' => false];
        }
        $elapsed = (int)floor((time() - strtotime($session['startedAt'])) / 60);
        $minutes = isset($in['minutes']) && is_numeric($in['minutes']) ? (int)round((float)$in['minutes']) : $elapsed;
        $minutes = max(0, min(24 * 60, $minutes));
        if ($minutes < 1) {
            return ['logged' => false, 'minutes' => 0];
        }
        $entry = normalize_entry([
            'id' => new_id('l'),
            'type' => 'work',
            'label' => clean_text($in['label'] ?? '', 120) ?: $session['label'],
            'amount' => work_pay($minutes, $data['settings']),
            'minutes' => $minutes,
            'at' => iso_now(),
        ]);
        array_unshift($data['ledger'], $entry);
        return ['logged' => true, 'minutes' => $minutes, 'amount' => $entry['amount'], 'entryId' => $entry['id']];
    });
    return $result;
}

/* ───────────────────────── settings + rules ───────────────────────── */

function act_settings_save(array $in): array
{
    $patch = is_array($in['settings'] ?? null) ? $in['settings'] : [];
    mutate_data(function (array &$data) use ($patch) {
        $s = $data['settings'];
        $allowed = ['title', 'tagline', 'baseCurrency', 'fx', 'hourlyRate', 'timezone', 'goalId', 'visibility', 'whip', 'showLive', 'showLedger'];
        $next = array_merge($s, array_intersect_key($patch, array_flip($allowed)));
        if (is_array($patch['copy'] ?? null)) {
            $next['copy'] = array_merge($s['copy'], $patch['copy']);
        }
        if (is_array($patch['voice'] ?? null)) {
            $next['voice'] = array_merge($s['voice'], $patch['voice']);
        }
        if (is_array($patch['affiliate'] ?? null)) {
            $next['affiliate'] = affiliate_patch($s['affiliate'], $patch['affiliate']);
        }
        if (isset($patch['passcode']) && is_string($patch['passcode']) && $patch['passcode'] !== '') {
            if (($problem = password_problem($patch['passcode'], MIN_PASSCODE_LENGTH)) !== '') {
                json_fail(400, 'Site passcode: ' . lcfirst($problem));
            }
            $next['passcodeHash'] = password_hash($patch['passcode'], PASSWORD_DEFAULT);
        }
        if (($next['visibility'] ?? '') === 'private' && empty($next['passcodeHash'])) {
            json_fail(400, 'Choose a passcode to make the site private.');
        }
        // Switching the base currency: re-express the exchange rates against the new base.
        $newBase = $next['baseCurrency'] ?? $s['baseCurrency'];
        if ($newBase !== $s['baseCurrency'] && !isset($patch['fx']) && !empty($s['fx'][$newBase])) {
            $pivot = (float)$s['fx'][$newBase];
            $fx = [$s['baseCurrency'] => round(1 / $pivot, 6)];
            foreach ($s['fx'] as $code => $rate) {
                if ($code !== $newBase) {
                    $fx[$code] = round((float)$rate / $pivot, 6);
                }
            }
            $next['fx'] = $fx;
        }
        $data['settings'] = normalize_settings($next);
    });
    grant_view_access(load_data()['settings']); // going private (or a new passcode) keeps this device in
    return [];
}

/**
 * The affiliate settings with a patch applied: enabled, amazon, the catch-all (network + networkId),
 * rules and exclude each replace the old value when sent. IDs she typed wrong are refused with a
 * hint rather than quietly dropped, so a typo never switches her affiliate links off unnoticed.
 */
function affiliate_patch(array $old, array $patch): array
{
    $next = $old;
    foreach (['enabled', 'amazon', 'rules', 'exclude'] as $key) {
        if (array_key_exists($key, $patch)) {
            $next[$key] = $patch[$key];
        }
    }
    if (array_key_exists('network', $patch) || array_key_exists('networkId', $patch)) {
        $next['network'] = is_string($patch['network'] ?? null) ? $patch['network'] : 'none';
        $next['networkId'] = is_string($patch['networkId'] ?? null) ? trim($patch['networkId']) : '';
    }
    foreach (is_array($patch['amazon'] ?? null) ? $patch['amazon'] : [] as $market => $tag) {
        $tag = is_string($tag) ? trim($tag) : '';
        if ($tag !== '' && in_array($market, AMAZON_MARKETPLACES, true) && !preg_match(AMAZON_TAG_PATTERN, $tag)) {
            json_fail(400, '“' . clean_text($tag, 40) . '” doesn’t look like an Amazon tracking ID (for amazon.' . $market
                . '). A tracking ID is one word ending in a dash and two digits, like yourname-20 or yourname-21, shown top right in Associates Central.');
        }
    }
    $network = $next['network'];
    if ($network !== 'none' && normalize_affiliate($next)['network'] !== $network) {
        $hints = [
            'skimlinks' => 'It’s your publisher ID, like 123456X1234567 (Skimlinks → Settings → Sites).',
            'sovrn' => 'It’s your site’s API key: 32 letters and numbers (Sovrn Commerce → Settings → Sites, key icon).',
        ];
        if (!isset(AFFILIATE_NETWORKS[$network])) {
            json_fail(400, 'Choose Skimlinks, Sovrn or Off for the other shops.');
        }
        json_fail(400, ($next['networkId'] === '' ? 'Add your ' . AFFILIATE_NETWORKS[$network] . ' ID, or switch it off. '
            : 'That ' . AFFILIATE_NETWORKS[$network] . ' ID doesn’t look right. ') . $hints[$network]);
    }
    $exclude = $patch['exclude'] ?? [];
    foreach (is_string($exclude) ? (preg_split('/[\s,]+/', $exclude) ?: []) : (is_array($exclude) ? $exclude : []) as $domain) {
        if (is_string($domain) && trim($domain) !== '' && clean_domain($domain) === '') {
            json_fail(400, '“' . clean_text($domain, 60) . '” isn’t a shop’s web address. Put one per line, like gucci.com.');
        }
    }
    return $next;
}

/**
 * What an affiliate link is, what it would teach, and where visitors would go for that shop now.
 * With "shopUrl" (an item's shop link), "out" says where that item's button would go with this
 * link as its "Your link" (a plain link there counts as the shop link, see resolve_outbound).
 */
function act_affiliate_detect(array $in): array
{
    $url = unwrap_google_link(trim(is_string($in['url'] ?? null) ? $in['url'] : ''));
    $found = detect_affiliate_link($url);
    $product = clean_url($found && $found['destination'] !== '' ? $found['destination'] : $url);
    $settings = load_data()['settings'];
    $answer = [
        'detected' => $found,
        'suggestion' => learn_affiliate_link($url),
        'preview' => resolve_outbound(
            ['id' => 'preview', 'url' => $product !== '' ? clean_url(canonical_product_url($product)) : '', 'affiliateUrl' => ''],
            $settings
        ),
    ];
    if (is_string($in['shopUrl'] ?? null)) {
        $answer['out'] = resolve_outbound(['id' => 'preview', 'url' => clean_url(normalize_link(trim($in['shopUrl']))), 'affiliateUrl' => clean_url($url)], $settings);
    }
    return $answer;
}

/** "Teach it a link": one of her affiliate links becomes a rule for its shop, her Amazon tag or the catch-all. */
function act_affiliate_learn(array $in): array
{
    $url = unwrap_google_link(trim(is_string($in['url'] ?? null) ? $in['url'] : ''));
    $learned = learn_affiliate_link($url);
    if (!$learned) {
        $found = detect_affiliate_link($url);
        if (!$found) {
            json_fail(400, 'That doesn’t look like an affiliate link. Paste a deep link you made in Awin, Rakuten, CJ, Impact or another network.');
        }
        if (in_array($found['kind'], ['creator', 'short'], true)) {
            json_fail(400, 'That link is made for one product, so there’s no pattern to learn. Paste it into the item’s “Your link” instead.');
        }
        if ($found['kind'] === 'amazon') {
            json_fail(400, 'That Amazon link’s tag doesn’t look like a tracking ID. Add your tag under Amazon Associates instead.');
        }
        if ($found['destination'] !== '' && is_amazon_link($found['destination'])) {
            json_fail(400, 'Amazon only pays through Amazon Associates. Add your Amazon tag instead.');
        }
        json_fail(400, 'That link doesn’t say which shop it leads to, so there’s nothing to learn. Make a deep link to a product page and paste that.');
    }
    $applied = mutate_data(function (array &$data) use ($learned) {
        $next = apply_learned_link($data['settings']['affiliate'], $learned);
        if (count($next['rules']) > MAX_AFFILIATE_RULES) {
            json_fail(400, 'You already have ' . MAX_AFFILIATE_RULES . ' shop rules. Delete one first.');
        }
        $data['settings']['affiliate'] = $next;
        return learned_label($learned);
    });
    return ['applied' => $applied];
}

function act_rules_save(array $in): array
{
    mutate_data(function (array &$data) use ($in) {
        if (isset($in['commands']) && is_array($in['commands'])) {
            $data['commands'] = normalize_rules($in['commands'], 'c');
        }
        if (isset($in['fines']) && is_array($in['fines'])) {
            $data['fines'] = normalize_rules($in['fines'], 'f');
        }
    });
    return [];
}

function act_fx_refresh(array $in): array
{
    $data = load_data();
    $s = $data['settings'];
    $wanted = array_merge(array_keys($s['fx']), array_column($data['items'], 'currency'));
    try {
        $rates = fetch_fx_rates($s['baseCurrency'], $wanted);
    } catch (RuntimeException $e) {
        fail_on($e, 502);
        return [];
    }
    if (!$rates) {
        return ['rates' => []];
    }
    mutate_data(function (array &$data) use ($rates) {
        $data['settings']['fx'] = array_merge($data['settings']['fx'], $rates);
        $data['settings']['fxUpdatedAt'] = iso_now();
    });
    return ['rates' => $rates];
}

/* ───────────────────────── account + backup ───────────────────────── */

function act_password_change(array $in): array
{
    $next = $in['next'] ?? '';
    if (($problem = password_problem($next, MIN_PASSWORD_LENGTH)) !== '') {
        json_fail(400, $problem);
    }
    if (($wait = begin_attempt('admin')) > 0) {
        json_fail(429, lockout_message($wait));
    }
    if (!verify_password($in['current'] ?? '')) {
        json_fail(403, 'Your current password is wrong.');
    }
    clear_attempts('admin');
    set_password($next); // new epoch: every other signed-in device is signed out
    log_in();            // …but not this one
    return ['csrf' => csrf_token()];
}

function act_data_import(array $in): array
{
    $backup = $in['data'] ?? null;
    if (!is_array($backup) || (!isset($backup['items']) && !isset($backup['ledger']))) {
        json_fail(400, 'That file isn’t a Findom Yourself backup.');
    }
    $restored = normalize_data($backup);
    with_lock(data_file(), function () use ($restored) {
        save_data($restored);
    });
    return ['items' => count($restored['items']), 'entries' => count($restored['ledger'])];
}

/**
 * Signs back in from inside the Control Room, so an expired session never costs work.
 * The custom header can't be sent by a cross-site form, which keeps this same-origin.
 */
function api_login(): void
{
    if (($_SERVER['HTTP_X_FINDOM_ADMIN'] ?? '') !== '1') {
        json_fail(403, 'Security check failed. Reload the page and try again.');
    }
    if (!is_set_up()) {
        json_fail(401, 'The Control Room isn’t set up yet. Reload the page.');
    }
    $in = request_json(4096);
    if (($wait = begin_attempt('admin')) > 0) {
        json_fail(429, lockout_message($wait));
    }
    if (!verify_password($in['password'] ?? '')) {
        json_fail(403, 'That password is wrong.');
    }
    clear_attempts('admin');
    log_in();
    json_out(['ok' => true, 'csrf' => csrf_token()]);
}
