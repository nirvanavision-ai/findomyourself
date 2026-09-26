<?php
/*
 * FINDOM YOURSELF: shared backend helpers (paths, JSON files, HTTP responses).
 *
 * Storage (never tracked by Git, so code deploys never touch it):
 *   <private>/data.json        wishlist, ledger, rules and settings
 *   <private>/whips.json       crack-the-whip counters
 *   <private>/auth.json        admin password hash + failed sign-in log
 *   <private>/setup-code.txt   one-time code for creating the admin password
 *   <private>/secret.key       signs the viewer cookie when the site is private
 *   <private>/sessions/        admin sign-in sessions
 *   <private>/tmp/             scratch space for downloads
 *   <site>/uploads/items/      item photos (public)
 *
 * <private> is a folder next to public_html when PHP can create one there
 * (e.g. /home/u123/domains/findomyourself.com/findom-private), otherwise
 * <site>/private/, which .htaccess blocks from the web.
 */
declare(strict_types=1);

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    exit;
}

const PRIVATE_DIR_NAME = 'findom-private';

/* ───────────────────────── paths ───────────────────────── */

function site_dir(): string
{
    return dirname(__DIR__);
}

function uploads_dir(): string
{
    return site_dir() . '/uploads';
}

function private_dir(): string
{
    static $dir = null;
    if ($dir !== null) {
        return $dir;
    }
    $candidates = [];
    $env = getenv('FINDOM_PRIVATE_DIR');
    if ($env) {
        $candidates[] = rtrim($env, '/');
    }
    $docroot = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
    if ($docroot !== '' && PHP_SAPI !== 'cli-server') {
        $candidates[] = dirname($docroot) . '/' . PRIVATE_DIR_NAME;
    }
    $candidates[] = site_dir() . '/private';
    foreach ($candidates as $candidate) {
        if ((is_dir($candidate) || @mkdir($candidate, 0700, true)) && is_writable($candidate)) {
            $dir = $candidate;
            break;
        }
    }
    if ($dir === null) {
        http_response_code(500);
        exit('The site needs a writable private folder. Check folder permissions in your hosting File Manager.');
    }
    if (strpos($dir, site_dir()) === 0) {
        write_if_missing($dir . '/.htaccess', "Require all denied\nDeny from all\n");
        write_if_missing($dir . '/index.html', '');
    }
    return $dir;
}

/** Human-friendly location of a private file: [path, where to find it]. */
function private_file_hint(string $name): array
{
    $dir = private_dir();
    if (strpos($dir, site_dir()) === 0) {
        return ['private/' . $name, 'inside public_html'];
    }
    return [basename($dir) . '/' . $name, 'in the folder that contains public_html'];
}

function data_file(): string
{
    return private_dir() . '/data.json';
}

function whips_file(): string
{
    return private_dir() . '/whips.json';
}

function tmp_dir(): string
{
    $dir = private_dir() . '/tmp';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    return $dir;
}

/** Creates uploads/ with a folder rule that never executes anything inside it. */
function ensure_uploads(): void
{
    $items = uploads_dir() . '/items';
    if (!is_dir($items) && !@mkdir($items, 0755, true)) {
        json_fail(500, 'Could not create the uploads folder. Check folder permissions.');
    }
    write_if_missing(uploads_dir() . '/.htaccess', <<<HTACCESS
# Uploaded photos only: never execute anything in here.
Options -Indexes
<FilesMatch "\\.(php[0-9]?|phtml|phar|pl|py|cgi|sh|shtml|htaccess|htpasswd|svg|html?)$">
  Require all denied
</FilesMatch>
RemoveHandler .php .phtml .php3 .php4 .php5 .php7 .php8 .phar
RemoveType .php .phtml .php3 .php4 .php5 .php7 .php8 .phar
<IfModule mod_php.c>
  php_flag engine off
</IfModule>
<IfModule mod_headers.c>
  Header set X-Content-Type-Options "nosniff"
  Header set Cache-Control "public, max-age=31536000, immutable"
</IfModule>

HTACCESS);
    write_if_missing(uploads_dir() . '/index.html', '');
    write_if_missing($items . '/index.html', '');
}

function write_if_missing(string $path, string $contents): void
{
    if (!file_exists($path)) {
        @file_put_contents($path, $contents, LOCK_EX);
    }
}

/* ───────────────────────── JSON files ───────────────────────── */

function read_json(string $path, $default)
{
    if (!is_file($path)) {
        return $default;
    }
    $raw = @file_get_contents($path);
    if ($raw === false || $raw === '') {
        return $default;
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : $default;
}

/** Atomic write: temp file + rename, so readers never see half a file. */
function write_json(string $path, array $data): void
{
    $tmp = $path . '.' . bin2hex(random_bytes(4)) . '.tmp';
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
    if ($json === false || @file_put_contents($tmp, $json, LOCK_EX) === false || !@rename($tmp, $path)) {
        @unlink($tmp);
        json_fail(500, 'Could not save. Check that the private folder is writable.');
    }
    @chmod($path, 0600);
}

/**
 * Runs $fn while holding an exclusive lock on $path, so two quick taps in the admin
 * can't both read the old file and lose one of the writes.
 */
function with_lock(string $path, callable $fn)
{
    $lock = @fopen($path . '.lock', 'c');
    if (!$lock) {
        json_fail(500, 'Could not lock the data file. Check that the private folder is writable.');
    }
    try {
        flock($lock, LOCK_EX);
        return $fn();
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

/* ───────────────────────── HTTP helpers ───────────────────────── */

function json_out(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
    exit;
}

function json_fail(int $status, string $message, array $extra = []): void
{
    json_out(['ok' => false, 'error' => $message] + $extra, $status);
}

/** Reads a JSON request body (at most $maxBytes). */
function request_json(int $maxBytes = 2 * 1024 * 1024): array
{
    $raw = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
    if ($raw === false || strlen($raw) > $maxBytes) {
        json_fail(413, 'That request is too large.');
    }
    if ($raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        json_fail(400, 'Could not read the request.');
    }
    return $data;
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
        || ((int)($_SERVER['SERVER_PORT'] ?? 0) === 443);
}

function client_ip(): string
{
    return substr((string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 0, 64);
}

function h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** JSON that is safe to drop inside a <script> element. */
function json_for_html($data): string
{
    return (string)json_encode(
        $data,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION
        | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
    );
}

/** Bytes from php.ini shorthand like "128M". */
function ini_bytes(string $key): int
{
    $value = trim((string)ini_get($key));
    if ($value === '' || $value === '-1' || $value === '0') {
        return PHP_INT_MAX;
    }
    $number = (float)$value;
    switch (strtolower(substr($value, -1))) {
        case 'g': $number *= 1024;
        // no break
        case 'm': $number *= 1024;
        // no break
        case 'k': $number *= 1024;
    }
    return (int)$number;
}

/** Cache-busting URL for a file in the site: "css/site.css?v=1a2b3c4d". */
function asset(string $path): string
{
    $file = site_dir() . '/' . ltrim($path, '/');
    $version = is_file($file) ? substr(md5((string)filemtime($file) . filesize($file)), 0, 8) : '0';
    return $path . '?v=' . $version;
}

/* ───────────────────────── text ───────────────────────── */

function clean_text($value, int $max, bool $multiline = false): string
{
    if (is_int($value) || is_float($value)) {
        $value = (string)$value;
    }
    if (!is_string($value)) {
        return '';
    }
    $value = str_replace(["\r\n", "\r"], "\n", $value);
    $value = (string)preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value);
    if (!$multiline) {
        $value = (string)preg_replace('/\s+/u', ' ', $value);
    }
    $value = trim($value);
    return mb_substr($value, 0, $max);
}

/** An http(s) URL without whitespace or credentials, or '' if it isn't one. */
function clean_url($value): string
{
    $url = clean_text($value, 2000);
    if ($url === '' || !preg_match('#^https?://#i', $url)) {
        return '';
    }
    $parts = parse_url($url);
    if (!$parts || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
        return '';
    }
    return $url;
}

function new_id(string $prefix): string
{
    return $prefix . '_' . bin2hex(random_bytes(5));
}

function iso_now(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

/** Parses an ISO date/time into a UTC ISO string, or null. */
function clean_iso($value): ?string
{
    if (!is_string($value) || $value === '') {
        return null;
    }
    if (preg_match('/^(\d{4})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $value, $m)) { // already canonical: skip the parse
        return ((int)$m[1] >= 2000 && (int)$m[1] <= 2100) ? $value : null;
    }
    try {
        $dt = new DateTimeImmutable($value);
    } catch (Exception $e) {
        return null;
    }
    $year = (int)$dt->format('Y');
    if ($year < 2000 || $year > 2100) {
        return null;
    }
    return $dt->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
}

function money($value): float
{
    return round((float)$value, 2);
}
