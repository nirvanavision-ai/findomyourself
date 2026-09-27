<?php
/*
 * FINDOM YOURSELF: counts clicks on items' shop buttons. POST {id} with the header
 * X-Findom: 1 (a plain cross-site form can't send it). A visitor counts once per item per
 * day, for 20 items a day at most, bots never count, and visitors are told apart by
 * a salted hash, never a stored IP. This only counts: it never redirects anywhere.
 */
declare(strict_types=1);

require __DIR__ . '/../lib/store.php';
require __DIR__ . '/../lib/auth.php';

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

$in = request_json(1024);
$id = $in['id'] ?? null;
$item = null;
foreach ($data['items'] as $candidate) {
    if (valid_id($id) && $candidate['id'] === $id && $candidate['status'] !== 'archived') {
        $item = $candidate;
        break;
    }
}
if ($item === null) {
    json_fail(404, 'That item isn’t on the list.');
}
// An item without a link has no button, so there's nothing to count.
$counted = resolve_outbound($item, $data['settings'])['url'] !== '' && count_click($item['id'], $data['settings']['timezone']);

json_out(['ok' => true, 'counted' => $counted]);
