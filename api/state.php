<?php
/*
 * FINDOM YOURSELF: public state as JSON. The page polls this to keep the vault, the
 * receipts and the "working now" light live. Unchanged state answers 304 via ETag.
 */
declare(strict_types=1);

require __DIR__ . '/../lib/store.php';
require __DIR__ . '/../lib/auth.php';

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('Cache-Control: no-cache');

$data = load_data();
if (!has_view_access($data['settings'])) {
    header('Cache-Control: no-store');
    json_fail(401, 'This site is private.', ['locked' => true]);
}

$json = json_encode(['ok' => true, 'state' => public_state($data)], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
$etag = '"' . substr(sha1((string)$json), 0, 24) . '"';
header('ETag: ' . $etag);
if (trim((string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
    http_response_code(304);
    exit;
}
header('Content-Type: application/json; charset=utf-8');
echo $json;
