<?php
/*
 * FINDOM YOURSELF: counts whip cracks from visitors. POST {count} with the header
 * X-Findom: 1 (a plain cross-site form can't send it). Each visitor gets at most
 * 90 cracks per 10 minutes; visitors are told apart by a salted hash, never a stored IP.
 */
declare(strict_types=1);

require __DIR__ . '/../lib/store.php';
require __DIR__ . '/../lib/auth.php';

const WHIP_WINDOW = 600;
const WHIP_MAX_PER_WINDOW = 90;

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_fail(405, 'Use POST.');
}
if (($_SERVER['HTTP_X_FINDOM'] ?? '') !== '1') {
    json_fail(403, 'Nice try.');
}
$data = load_data();
if (!has_view_access($data['settings'])) {
    json_fail(401, 'This site is private.');
}
if (!$data['settings']['whip']) {
    json_fail(403, 'The whip is put away for now.');
}

$in = request_json(1024);
$count = max(1, min(25, (int)($in['count'] ?? 1)));
$tz = new DateTimeZone($data['settings']['timezone']);

$result = with_lock(whips_file(), function () use ($count, $tz) {
    $now = time();
    $limitsFile = private_dir() . '/whip-limits.json';
    $limits = read_json($limitsFile, []);
    foreach ($limits as $k => $entry) {
        if (!is_array($entry) || $now - (int)($entry['t'] ?? 0) > WHIP_WINDOW) {
            unset($limits[$k]);
        }
    }
    $key = substr(hash_hmac('sha256', client_key(), site_secret()), 0, 20);
    $entry = $limits[$key] ?? ['t' => $now, 'n' => 0];
    $allowed = max(0, min($count, WHIP_MAX_PER_WINDOW - (int)$entry['n']));

    $whips = load_whips();
    $today = local_day($now, $tz);
    if ($allowed > 0) { // nothing counted, nothing written
        $entry['n'] = (int)$entry['n'] + $allowed;
        $limits[$key] = $entry;
        write_json($limitsFile, $limits);
        $whips['total'] += $allowed;
        $whips['days'][$today] = ($whips['days'][$today] ?? 0) + $allowed;
        krsort($whips['days']);
        $whips['days'] = array_slice($whips['days'], 0, 60, true);
        write_json(whips_file(), $whips);
    }
    return ['counted' => $allowed, 'total' => $whips['total'], 'today' => $whips['days'][$today] ?? 0];
});

json_out(['ok' => true] + $result);
