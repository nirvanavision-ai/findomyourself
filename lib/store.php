<?php
/*
 * FINDOM YOURSELF: the data model.
 *
 * data.json holds everything the site knows:
 *   settings  site words, voice lines, hourly rate, currencies, visibility
 *   items     the wishlist, in display order
 *   commands  one-tap tasks that pay tribute ("Gym session +$15")
 *   fines     one-tap penalties ("Doomscrolled an hour −$10")
 *   ledger    every tribute, fine and purchase, newest first
 *   session   the focus timer, when one is running
 *
 * The vault balance is simply the sum of the ledger. Nothing else is stored twice.
 */
declare(strict_types=1);

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/seed.php';

const SCHEMA_VERSION = 1;
const ITEM_STATUSES = ['wishing', 'claimed', 'archived'];
const LEDGER_TYPES = ['work', 'task', 'money', 'fine', 'claim', 'adjust'];
const TRIBUTE_TYPES = ['work', 'task', 'money'];
const VISIBILITIES = ['public', 'hide-amounts', 'private'];
const MAX_ITEMS = 500;
const MAX_RULES = 40;
const MAX_LEDGER = 50000;
const MAX_AMOUNT = 10000000;
const PUBLIC_LEDGER_SIZE = 40;
const CURRENCIES = [
    'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON',
    'TRY', 'JPY', 'KRW', 'CNY', 'HKD', 'SGD', 'INR', 'AED', 'ILS', 'ZAR', 'MXN', 'BRL',
];
/* Site words the admin can edit, with their length limits. */
const COPY_FIELDS = [
    'heroKicker' => 140,
    'heroIntro' => 600,
    'rule1' => 40, 'rule1Body' => 320,
    'rule2' => 40, 'rule2Body' => 320,
    'rule3' => 40, 'rule3Body' => 320,
    'vaultIntro' => 320,
    'listIntro' => 320,
    'trophyIntro' => 320,
    'whipIntro' => 320,
    'footerLine' => 120,
    'finePrint' => 600,
];
const VOICE_MOODS = ['taunts', 'working', 'slacking', 'praise', 'unlocked', 'empty'];

/* ───────────────────────── load + save ───────────────────────── */

/** The current data. On the very first request the wishlist is seeded and saved. */
function load_data(): array
{
    $data = read_data_file();
    if ($data !== null) {
        return normalize_data($data);
    }
    return with_lock(data_file(), function () {
        $data = read_data_file();
        if ($data === null) {
            $data = normalize_data(seed_data());
            save_data($data);
        }
        return normalize_data($data);
    });
}

/**
 * data.json as an array, or null if there is none yet. A file that exists but can't be read
 * is never replaced with the seed (that would wipe the ledger): the last good copy
 * (data.json.bak) is used instead, and without one the request fails loudly.
 */
function read_data_file(): ?array
{
    $file = data_file();
    if (!is_file($file)) {
        return null;
    }
    $data = read_json($file, null);
    if (is_array($data)) {
        return $data;
    }
    $backup = read_json($file . '.bak', null);
    if (is_array($backup)) {
        error_log('findomyourself: data.json is unreadable, using data.json.bak');
        return $backup;
    }
    http_response_code(500);
    exit('The site’s data file (findom-private/data.json) is damaged. Restore it from a backup in the Control Room or your hosting panel.');
}

function save_data(array $data): void
{
    $data['schema'] = SCHEMA_VERSION;
    $data['updatedAt'] = iso_now();
    if (is_array(read_json(data_file(), null))) {
        @copy(data_file(), data_file() . '.bak'); // one step of undo if a write ever goes wrong
    }
    write_json(data_file(), $data);
}

/**
 * Read-modify-write under a lock. $fn receives the data by reference and may return a value.
 * Changes are normalized before they are saved, so a mistake can't corrupt the file.
 */
function mutate_data(callable $fn)
{
    return with_lock(data_file(), function () use ($fn) {
        $data = normalize_data(read_data_file() ?? seed_data());
        $result = $fn($data);
        $data = normalize_data($data);
        save_data($data);
        return $result;
    });
}

/* ───────────────────────── normalizing ───────────────────────── */

function valid_id($id): bool
{
    return is_string($id) && preg_match('/^[a-z]{1,3}_[a-z0-9_]{1,40}$/', $id) === 1;
}

function normalize_data(array $in): array
{
    $settings = normalize_settings(is_array($in['settings'] ?? null) ? $in['settings'] : []);

    $items = [];
    $seen = [];
    foreach (array_slice((array)($in['items'] ?? []), 0, MAX_ITEMS) as $raw) {
        $item = normalize_item($raw, $settings);
        if ($item && !isset($seen[$item['id']])) {
            $seen[$item['id']] = true;
            $items[] = $item;
        }
    }
    if ($settings['goalId'] !== '' && !isset($seen[$settings['goalId']])) {
        $settings['goalId'] = '';
    }

    $ledger = [];
    $seen = [];
    foreach (array_slice((array)($in['ledger'] ?? []), 0, MAX_LEDGER) as $raw) {
        $entry = normalize_entry($raw);
        if ($entry && !isset($seen[$entry['id']])) {
            $seen[$entry['id']] = true;
            $ledger[] = $entry;
        }
    }
    usort($ledger, function ($a, $b) {
        return strcmp($b['at'], $a['at']);
    });

    return [
        'schema' => SCHEMA_VERSION,
        'updatedAt' => clean_iso($in['updatedAt'] ?? null) ?? iso_now(),
        'settings' => $settings,
        'items' => $items,
        'commands' => normalize_rules($in['commands'] ?? [], 'c'),
        'fines' => normalize_rules($in['fines'] ?? [], 'f'),
        'ledger' => $ledger,
        'session' => normalize_session($in['session'] ?? null),
    ];
}

function normalize_settings(array $in): array
{
    $d = default_settings();
    $out = $d;

    foreach (['title' => 60, 'tagline' => 140] as $key => $max) {
        if (isset($in[$key])) {
            $out[$key] = clean_text($in[$key], $max) ?: $d[$key];
        }
    }
    if (isset($in['baseCurrency']) && in_array($in['baseCurrency'], CURRENCIES, true)) {
        $out['baseCurrency'] = $in['baseCurrency'];
    }
    if (isset($in['fx']) && is_array($in['fx'])) {
        $fx = [];
        foreach ($in['fx'] as $code => $rate) {
            if (in_array($code, CURRENCIES, true) && $code !== $out['baseCurrency'] && is_numeric($rate)
                && (float)$rate > 0 && (float)$rate < 100000) {
                $fx[$code] = round((float)$rate, 6);
            }
        }
        ksort($fx);
        $out['fx'] = $fx;
    }
    unset($out['fx'][$out['baseCurrency']]);
    $out['fxUpdatedAt'] = clean_iso($in['fxUpdatedAt'] ?? null);
    if (isset($in['hourlyRate']) && is_numeric($in['hourlyRate'])) {
        $out['hourlyRate'] = max(0.0, min(100000.0, money($in['hourlyRate'])));
    }
    if (isset($in['timezone']) && is_string($in['timezone']) && in_array($in['timezone'], DateTimeZone::listIdentifiers(), true)) {
        $out['timezone'] = $in['timezone'];
    }
    $out['goalId'] = valid_id($in['goalId'] ?? null) ? $in['goalId'] : '';
    if (isset($in['visibility']) && in_array($in['visibility'], VISIBILITIES, true)) {
        $out['visibility'] = $in['visibility'];
    }
    $hash = (string)($in['passcodeHash'] ?? '');
    $out['passcodeHash'] = (strlen($hash) >= 20 && strlen($hash) <= 255 && strpos($hash, '$') === 0) ? $hash : '';
    if ($out['visibility'] === 'private' && $out['passcodeHash'] === '') {
        $out['visibility'] = 'public';
    }
    foreach (['whip', 'showLive', 'showLedger'] as $key) {
        if (array_key_exists($key, $in)) {
            $out[$key] = (bool)$in[$key];
        }
    }

    $copy = is_array($in['copy'] ?? null) ? $in['copy'] : [];
    foreach (COPY_FIELDS as $key => $max) {
        if (array_key_exists($key, $copy)) {
            $out['copy'][$key] = clean_text($copy[$key], $max, true) ?: $d['copy'][$key];
        }
    }

    $voice = is_array($in['voice'] ?? null) ? $in['voice'] : [];
    foreach (VOICE_MOODS as $mood) {
        if (!array_key_exists($mood, $voice)) {
            continue;
        }
        $lines = [];
        foreach (array_slice((array)$voice[$mood], 0, 60) as $line) {
            $line = clean_text($line, 220);
            if ($line !== '') {
                $lines[] = $line;
            }
        }
        $out['voice'][$mood] = $lines;
    }
    return $out;
}

function normalize_item($raw, array $settings): ?array
{
    if (!is_array($raw)) {
        return null;
    }
    $name = clean_text($raw['name'] ?? '', 140);
    if ($name === '') {
        return null;
    }
    $currency = in_array($raw['currency'] ?? '', CURRENCIES, true) ? $raw['currency'] : $settings['baseCurrency'];
    $image = (string)($raw['image'] ?? '');
    if (!preg_match('#^uploads/items/[a-z0-9_-]+\.(webp|jpe?g|png|gif|avif)$#', $image)) {
        $image = '';
    }
    $priority = (int)($raw['priority'] ?? 2);
    $status = in_array($raw['status'] ?? '', ITEM_STATUSES, true) ? $raw['status'] : 'wishing';
    return [
        'id' => valid_id($raw['id'] ?? null) ? $raw['id'] : new_id('i'),
        'name' => $name,
        'brand' => clean_text($raw['brand'] ?? '', 80),
        'variant' => clean_text($raw['variant'] ?? '', 80),
        'category' => clean_text($raw['category'] ?? '', 60),
        'price' => max(0.0, min((float)MAX_AMOUNT, money($raw['price'] ?? 0))),
        'currency' => $currency,
        'url' => clean_url($raw['url'] ?? ''),
        'image' => $image,
        'imageSource' => clean_url($raw['imageSource'] ?? ''),
        'priority' => max(1, min(3, $priority)),
        'note' => clean_text($raw['note'] ?? '', 400, true),
        'status' => $status,
        'createdAt' => clean_iso($raw['createdAt'] ?? null) ?? iso_now(),
        'claimedAt' => $status === 'claimed' ? (clean_iso($raw['claimedAt'] ?? null) ?? iso_now()) : null,
    ];
}

/** Commands and fines share a shape: {id, name, emoji, amount}. */
function normalize_rules($list, string $prefix): array
{
    $out = [];
    $seen = [];
    foreach (array_slice(is_array($list) ? $list : [], 0, MAX_RULES) as $raw) {
        if (!is_array($raw)) {
            continue;
        }
        $name = clean_text($raw['name'] ?? '', 60);
        if ($name === '') {
            continue;
        }
        $id = (valid_id($raw['id'] ?? null) && strpos($raw['id'], $prefix . '_') === 0) ? $raw['id'] : new_id($prefix);
        if (isset($seen[$id])) {
            $id = new_id($prefix);
        }
        $seen[$id] = true;
        $out[] = [
            'id' => $id,
            'name' => $name,
            'emoji' => mb_substr(clean_text($raw['emoji'] ?? '', 16), 0, 8),
            'amount' => max(0.0, min((float)MAX_AMOUNT, money(abs((float)($raw['amount'] ?? 0))))),
        ];
    }
    return $out;
}

function normalize_entry($raw): ?array
{
    if (!is_array($raw) || !in_array($raw['type'] ?? '', LEDGER_TYPES, true)) {
        return null;
    }
    $type = $raw['type'];
    $amount = money($raw['amount'] ?? 0);
    $amount = max(-(float)MAX_AMOUNT, min((float)MAX_AMOUNT, $amount));
    if (in_array($type, ['fine', 'claim'], true)) {
        $amount = -abs($amount);
    } elseif (in_array($type, TRIBUTE_TYPES, true)) {
        $amount = abs($amount);
    }
    $minutes = null;
    if ($type === 'work') {
        $minutes = max(0, min(24 * 60, (int)round((float)($raw['minutes'] ?? 0))));
    }
    $at = clean_iso($raw['at'] ?? null);
    if ($at === null) {
        return null;
    }
    return [
        'id' => valid_id($raw['id'] ?? null) ? $raw['id'] : new_id('l'),
        'type' => $type,
        'label' => clean_text($raw['label'] ?? '', 120) ?: default_entry_label($type),
        'amount' => $amount,
        'minutes' => $minutes,
        'at' => $at,
        'ref' => valid_id($raw['ref'] ?? null) ? $raw['ref'] : '',
        'note' => clean_text($raw['note'] ?? '', 280, true),
    ];
}

function default_entry_label(string $type): string
{
    $labels = [
        'work' => 'Focus session',
        'task' => 'Command obeyed',
        'money' => 'Money in',
        'fine' => 'Fine',
        'claim' => 'Claimed a reward',
        'adjust' => 'Adjustment',
    ];
    return $labels[$type] ?? 'Entry';
}

function normalize_session($raw): ?array
{
    if (!is_array($raw)) {
        return null;
    }
    $started = clean_iso($raw['startedAt'] ?? null);
    if ($started === null) {
        return null;
    }
    return [
        'startedAt' => $started,
        'label' => clean_text($raw['label'] ?? '', 60) ?: 'Focus session',
    ];
}

/* ───────────────────────── money ───────────────────────── */

/** Converts an amount into the base currency. fx[CUR] = base units per 1 CUR. */
function to_base(float $amount, string $currency, array $settings): float
{
    if ($currency === '' || $currency === $settings['baseCurrency']) {
        return money($amount);
    }
    $rate = (float)($settings['fx'][$currency] ?? 0);
    return $rate > 0 ? money($amount * $rate) : money($amount);
}

/** Pay for a focus session of $minutes at the hourly rate. */
function work_pay(int $minutes, array $settings): float
{
    return money($minutes / 60 * (float)$settings['hourlyRate']);
}

/* ───────────────────────── stats ───────────────────────── */

function local_day(int $timestamp, DateTimeZone $tz): string
{
    return (new DateTimeImmutable('@' . $timestamp))->setTimezone($tz)->format('Y-m-d');
}

function compute_stats(array $data, ?int $now = null): array
{
    $now = $now ?? time();
    $tz = new DateTimeZone($data['settings']['timezone']);
    $todayKey = local_day($now, $tz);
    $weekAgo = $now - 7 * 86400;
    $previousTz = date_default_timezone_get();
    date_default_timezone_set($tz->getName()); // date() is much faster than a DateTime per entry

    $balance = $earned = $fined = $spent = $today = $week = 0.0;
    $minutes = 0;
    $days = [];
    $last = null;

    foreach ($data['ledger'] as $e) {
        $amount = (float)$e['amount'];
        $balance += $amount;
        if ($e['type'] === 'fine') {
            $fined -= $amount;
        } elseif ($e['type'] === 'claim') {
            $spent -= $amount;
        } else {
            $earned += $amount;
        }
        if ($e['type'] === 'work') {
            $minutes += (int)$e['minutes'];
        }
        if (in_array($e['type'], TRIBUTE_TYPES, true) && $amount > 0) {
            $ts = (int)strtotime($e['at']);
            $key = date('Y-m-d', $ts);
            $days[$key] = true;
            if ($key === $todayKey) {
                $today += $amount;
            }
            if ($ts >= $weekAgo) {
                $week += $amount;
            }
            $last = max($last ?? 0, $ts);
        }
    }
    date_default_timezone_set($previousTz);

    // Streak: consecutive days with tribute, counting today or (if nothing yet today) yesterday.
    $streak = 0;
    $cursor = new DateTimeImmutable($todayKey . ' 12:00:00', $tz);
    if (!isset($days[$todayKey])) {
        $cursor = $cursor->modify('-1 day');
    }
    while (isset($days[$cursor->format('Y-m-d')])) {
        $streak++;
        $cursor = $cursor->modify('-1 day');
    }

    $best = 0;
    $run = 0;
    $prev = null;
    $keys = array_keys($days);
    sort($keys);
    foreach ($keys as $key) {
        $day = new DateTimeImmutable($key . ' 12:00:00', $tz);
        $run = ($prev !== null && $prev->modify('+1 day')->format('Y-m-d') === $key) ? $run + 1 : 1;
        $best = max($best, $run);
        $prev = $day;
    }

    return [
        'balance' => money($balance),
        'earned' => money($earned),
        'fined' => money($fined),
        'spent' => money($spent),
        'minutes' => $minutes,
        'hours' => round($minutes / 60, 2),
        'today' => money($today),
        'week' => money($week),
        'streak' => $streak,
        'bestStreak' => $best,
        'activeToday' => isset($days[$todayKey]),
        'lastTributeAt' => $last ? gmdate('Y-m-d\TH:i:s\Z', $last) : null,
        'entries' => count($data['ledger']),
    ];
}

/** Items with their base price, progress toward it, and what's left to earn. */
function item_views(array $data, float $balance): array
{
    $settings = $data['settings'];
    $rate = (float)$settings['hourlyRate'];
    $claims = [];
    foreach ($data['ledger'] as $e) {
        if ($e['type'] === 'claim' && $e['ref'] !== '' && !isset($claims[$e['ref']])) {
            $claims[$e['ref']] = -(float)$e['amount'];
        }
    }
    $views = [];
    foreach ($data['items'] as $index => $item) {
        $priceBase = to_base((float)$item['price'], $item['currency'], $settings);
        $claimed = $item['status'] === 'claimed';
        $wishing = $item['status'] === 'wishing';
        $priced = $priceBase > 0; // a pasted link whose shop hid the price stays locked until it has one
        $affordable = $wishing && $priced && $balance >= $priceBase;
        $toGo = ($wishing && $priced && !$affordable) ? money($priceBase - $balance) : 0.0;
        $views[] = $item + [
            'order' => $index,
            'priceBase' => $priceBase,
            'priceMissing' => !$priced,
            'progress' => $claimed ? 1.0 : ($priced ? round(max(0, min(1, $balance / $priceBase)), 4) : 0.0),
            'affordable' => $affordable,
            'toGo' => $toGo,
            'hoursToGo' => ($toGo > 0 && $rate > 0) ? round($toGo / $rate, 1) : 0.0,
            'claimedAmount' => $claimed ? money($claims[$item['id']] ?? $priceBase) : null,
        ];
    }
    return $views;
}

/** The goal: the item pinned in settings, or else the cheapest thing still on the list. */
function pick_goal(array $views, array $settings): string
{
    $wishing = array_values(array_filter($views, function ($v) {
        return $v['status'] === 'wishing';
    }));
    foreach ($wishing as $v) {
        if ($v['id'] === $settings['goalId']) {
            return $v['id'];
        }
    }
    $priced = array_values(array_filter($wishing, function ($v) {
        return !$v['priceMissing'];
    }));
    $wishing = $priced ?: $wishing;
    usort($wishing, function ($a, $b) {
        return [$a['priceBase'], $a['order']] <=> [$b['priceBase'], $b['order']];
    });
    return $wishing[0]['id'] ?? '';
}

/* ───────────────────────── whips ───────────────────────── */

function load_whips(): array
{
    $w = read_json(whips_file(), []);
    $days = [];
    foreach ((array)($w['days'] ?? []) as $day => $count) {
        if (is_string($day) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) {
            $days[$day] = max(0, (int)$count);
        }
    }
    return ['total' => max(0, (int)($w['total'] ?? 0)), 'days' => $days];
}

function whips_summary(array $whips, string $timezone): array
{
    $today = local_day(time(), new DateTimeZone($timezone));
    return ['total' => $whips['total'], 'today' => $whips['days'][$today] ?? 0];
}

/* ───────────────────────── views ───────────────────────── */

/**
 * public_state(), cached in the private folder until the data or the whip counters change (or
 * the hour turns, since streaks and "today" depend on the date). Keeps every visit cheap.
 */
function cached_public_state(array $data): array
{
    $tz = new DateTimeZone($data['settings']['timezone']);
    // Keyed on the content itself (timestamps have one-second resolution; two saves can share one),
    // plus the local hour for the rolling "this week" and streak numbers.
    $key = sha1(serialize($data) . '|' . serialize(load_whips()) . '|' . (new DateTimeImmutable('now', $tz))->format('Y-m-d H'));
    $file = private_dir() . '/public-state.json';
    $cached = read_json($file, []);
    if (($cached['key'] ?? '') === $key && is_array($cached['state'] ?? null)) {
        return $cached['state'];
    }
    $state = public_state($data);
    write_json($file, ['key' => $key, 'state' => $state]);
    return $state;
}

/** Everything the public site shows, with amounts removed when the owner hides them. */
function public_state(array $data): array
{
    $s = $data['settings'];
    $stats = compute_stats($data);
    $views = item_views($data, $stats['balance']);
    $hide = $s['visibility'] === 'hide-amounts';

    $items = array_map(function ($v) use ($hide) {
        $out = [
            'id' => $v['id'],
            'name' => $v['name'],
            'brand' => $v['brand'],
            'variant' => $v['variant'],
            'category' => $v['category'],
            'price' => $hide ? null : $v['price'],
            'currency' => $v['currency'],
            'priceBase' => $hide ? null : $v['priceBase'],
            'priceMissing' => $v['priceMissing'],
            'url' => $v['url'],
            'store' => store_name($v['url']),
            'image' => $v['image'], // only photos stored here: visitors' browsers never call other sites
            'priority' => $v['priority'],
            'note' => $v['note'],
            'status' => $v['status'],
            'createdAt' => $v['createdAt'],
            'claimedAt' => $v['claimedAt'],
            // Hidden amounts: exact progress times the (public) shop price would give the balance away.
            'progress' => $hide && $v['status'] === 'wishing' ? floor($v['progress'] * 10) / 10 : $v['progress'],
            'affordable' => $v['affordable'],
            'toGo' => $hide ? null : $v['toGo'],
            'hoursToGo' => $hide ? null : $v['hoursToGo'],
            'claimedAmount' => $hide ? null : $v['claimedAmount'],
        ];
        return $out;
    }, array_values(array_filter($views, function ($v) {
        return $v['status'] !== 'archived';
    })));

    if ($hide) {
        foreach (['balance', 'earned', 'fined', 'spent', 'today', 'week'] as $key) {
            $stats[$key] = null;
        }
    }

    $ledger = [];
    if ($s['showLedger']) {
        foreach (array_slice($data['ledger'], 0, PUBLIC_LEDGER_SIZE) as $e) {
            $ledger[] = [
                'id' => $e['id'],
                'type' => $e['type'],
                'label' => $e['label'],
                'amount' => $hide ? null : $e['amount'],
                'minutes' => $e['minutes'],
                'at' => $e['at'],
            ];
        }
    }

    $session = null;
    if ($s['showLive'] && $data['session']) {
        $session = ['startedAt' => $data['session']['startedAt'], 'label' => $data['session']['label']];
    }

    return [
        'settings' => [
            'title' => $s['title'],
            'tagline' => $s['tagline'],
            'baseCurrency' => $s['baseCurrency'],
            'hourlyRate' => $hide ? null : $s['hourlyRate'],
            'timezone' => $s['timezone'],
            'amountsHidden' => $hide,
            'whip' => $s['whip'],
            'showLedger' => $s['showLedger'],
            'copy' => $s['copy'],
            'voice' => $s['voice'],
        ],
        'stats' => $stats,
        'goalId' => pick_goal($views, $s),
        'items' => $items,
        'commands' => array_map(function ($c) use ($hide) {
            return ['name' => $c['name'], 'emoji' => $c['emoji'], 'amount' => $hide ? null : $c['amount']];
        }, $data['commands']),
        'fines' => array_map(function ($f) use ($hide) {
            return ['name' => $f['name'], 'emoji' => $f['emoji'], 'amount' => $hide ? null : $f['amount']];
        }, $data['fines']),
        'ledger' => $ledger,
        'session' => $session,
        'whips' => whips_summary(load_whips(), $s['timezone']),
        'updatedAt' => $data['updatedAt'],
    ];
}

/** Store name for a product link: known shops by name, anything else by domain. */
function store_name(string $url): string
{
    $host = strtolower((string)parse_url($url, PHP_URL_HOST));
    if ($host === '') {
        return '';
    }
    $host = preg_replace('/^(www|shop|store|m|us|uk|eu)\./', '', $host);
    $known = [
        'farfetch' => 'Farfetch', 'amiri' => 'AMIRI', 'ssense' => 'SSENSE', 'net-a-porter' => 'Net-a-Porter',
        'mrporter' => 'Mr Porter', 'mytheresa' => 'Mytheresa', 'matchesfashion' => 'Matches', 'matches' => 'Matches',
        'luisaviaroma' => 'LuisaViaRoma', 'nordstrom' => 'Nordstrom', 'saksfifthavenue' => 'Saks', 'saks' => 'Saks',
        'neimanmarcus' => 'Neiman Marcus', 'bergdorfgoodman' => 'Bergdorf Goodman', 'selfridges' => 'Selfridges',
        'harrods' => 'Harrods', 'amazon' => 'Amazon', 'sephora' => 'Sephora', 'versace' => 'Versace',
        'chromehearts' => 'Chrome Hearts', 'lobjet' => "L'Objet", 'apple' => 'Apple', 'etsy' => 'Etsy',
        'revolve' => 'Revolve', 'fwrd' => 'FWRD', 'shopbop' => 'Shopbop', 'goat' => 'GOAT', 'stockx' => 'StockX',
        'therealreal' => 'The RealReal', 'vestiairecollective' => 'Vestiaire', 'ebay' => 'eBay', 'zara' => 'Zara',
        'transparentspeaker' => 'Transparent', 'transparent' => 'Transparent', 'hermes' => 'Hermès',
        'louisvuitton' => 'Louis Vuitton', 'dior' => 'Dior', 'chanel' => 'Chanel', 'gucci' => 'Gucci',
        'prada' => 'Prada', 'balenciaga' => 'Balenciaga', 'bottegaveneta' => 'Bottega Veneta', 'ysl' => 'Saint Laurent',
    ];
    $labels = explode('.', (string)$host);
    $name = count($labels) >= 2 ? $labels[count($labels) - 2] : $labels[0];
    if (in_array($name, ['co', 'com'], true) && count($labels) >= 3) {
        $name = $labels[count($labels) - 3];
    }
    return $known[$name] ?? ucfirst($name);
}
