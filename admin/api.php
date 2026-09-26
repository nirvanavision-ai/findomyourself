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
 *                                                 item.goal true/false pins/unpins it as the current goal
 *   item.fromLink     {url}                       paste a product link → new item (name, brand, price, photo)
 *   link.inspect      {url}                       what a link tells us, without saving
 *   items.parse       {text}                      preview a pasted list
 *   items.import      {items}                     add the previewed items
 *   items.reorder     {ids}                       new display order
 *   items.fetchImages {exclude?}                  fetch missing photos, a few per call (answers "remaining")
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
 *   settings.save     {settings}                  partial; settings.passcode (plain text) is hashed here
 *   rules.save        {commands?, fines?}
 *   fx.refresh        {}
 *   password.change   {current, next}
 *   data.import       {data}                      restore a backup
 */
declare(strict_types=1);

require __DIR__ . '/../lib/store.php';
require __DIR__ . '/../lib/auth.php';
require __DIR__ . '/../lib/fetch.php';
require __DIR__ . '/../lib/images.php';
require __DIR__ . '/../lib/import.php';

const EDITABLE_ITEM_FIELDS = ['name', 'brand', 'variant', 'category', 'price', 'currency', 'url', 'priority', 'note'];

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
    return [
        'settings' => $settings,
        'stats' => $stats,
        'goalId' => pick_goal($views, $data['settings']),
        'items' => $views,
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
    $url = normalize_link($url);
    return rtrim((string)preg_replace('#^https?://(www\.)?#i', '', strtolower($url)), '/');
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
    $imageUrl = clean_url($raw['imageUrl'] ?? '');
    $id = mutate_data(function (array &$data) use ($raw) {
        $index = item_index($data, $raw['id'] ?? null);
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

/** The "paste a link" box: the item is created even if the shop refuses to talk to us. */
function act_item_from_link(array $in): array
{
    @set_time_limit(60);
    try {
        $info = inspect_link((string)($in['url'] ?? ''), wishlist_brands(load_data()));
    } catch (RuntimeException $e) {
        fail_on($e, 400);
        return [];
    }
    $data = load_data();
    foreach ($data['items'] as $item) {
        if ($item['url'] !== '' && url_key($item['url']) === url_key($info['url'])) {
            return ['itemId' => $item['id'], 'duplicate' => true, 'info' => $info, 'warnings' => ['That link is already on your list.']];
        }
    }
    $id = mutate_data(function (array &$data) use ($info, $in) {
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
            'imageSource' => $info['image'],
            'status' => 'wishing',
            'createdAt' => iso_now(),
        ], $data['settings']);
        array_unshift($data['items'], $item);
        return $item['id'];
    });

    $warnings = [];
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
    return ['itemId' => $id, 'info' => $info, 'warnings' => $warnings];
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
    $names = [];
    foreach ($data['items'] as $item) {
        if ($item['url'] !== '') {
            $urls[url_key($item['url'])] = true;
        }
        $names[mb_strtolower($item['brand'] . ' ' . $item['name'])] = true;
    }
    foreach ($items as &$item) {
        $item['duplicate'] = ($item['url'] !== '' && isset($urls[url_key($item['url'])]))
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
                $fields['url'] = normalize_link($fields['url']);
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
 * Fetches photos for items that don't have one, starting new ones for ~12 seconds per call.
 * The UI calls again while "remaining" > 0, passing the ids that failed as "exclude".
 */
function act_items_fetch_images(array $in): array
{
    @set_time_limit(90);
    $exclude = array_flip(array_filter((array)($in['exclude'] ?? []), 'valid_id'));
    $only = array_flip(array_filter((array)($in['ids'] ?? []), 'valid_id'));
    $data = load_data();
    $todo = array_values(array_filter($data['items'], function ($item) use ($exclude, $only) {
        return $item['image'] === '' && $item['status'] !== 'archived'
            && ($item['imageSource'] !== '' || $item['url'] !== '')
            && !isset($exclude[$item['id']]) && (!$only || isset($only[$item['id']]));
    }));
    $started = microtime(true);
    $done = [];
    $failed = [];
    foreach ($todo as $n => $item) {
        if (microtime(true) - $started > 12) {
            break;
        }
        try {
            $source = $item['imageSource'];
            if ($source === '') {
                $info = inspect_link($item['url']);
                $source = $info['image'];
                if ($source === '') {
                    throw new RuntimeException($info['error'] ?: 'No photo on the page.');
                }
            }
            attach_image_from_url($item['id'], $source);
            $done[] = $item['id'];
        } catch (RuntimeException $e) {
            $failed[] = ['id' => $item['id'], 'name' => $item['name'], 'error' => $e->getMessage()];
        }
        unset($todo[$n]);
    }
    return ['done' => $done, 'failed' => $failed, 'remaining' => count($todo)];
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
