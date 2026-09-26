<?php
/*
 * FINDOM YOURSELF: admin sign-in (sessions, CSRF, password, lockout) and the
 * viewer passcode used when the site is set to private.
 */
declare(strict_types=1);

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/bootstrap.php';

const SESSION_IDLE_SECONDS = 30 * 24 * 3600; // stay signed in on your phone for a month of inactivity
const LOGIN_MAX_FAILURES = 6;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const MIN_PASSWORD_LENGTH = 10;
const VIEW_COOKIE = 'findom_view';
const VIEW_COOKIE_DAYS = 30;

function send_admin_headers(): void
{
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    header('X-Robots-Tag: noindex, nofollow');
    header('Cache-Control: no-store, private');
    header("Content-Security-Policy: default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
}

/* ───────────────────────── sessions + CSRF ───────────────────────── */

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    // Our own folder and lifetime: shared hosts often delete session files after
    // ~24 idle minutes, which would sign you out in the middle of logging work.
    $sessionDir = private_dir() . '/sessions';
    if ((is_dir($sessionDir) || @mkdir($sessionDir, 0700, true)) && is_writable($sessionDir)) {
        session_save_path($sessionDir);
    }
    ini_set('session.gc_maxlifetime', (string)SESSION_IDLE_SECONDS);
    ini_set('session.gc_probability', '1');
    ini_set('session.gc_divisor', '100');
    ini_set('session.use_strict_mode', '1');

    $path = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/admin/index.php'), '/') . '/';
    session_name('findom_admin');
    session_set_cookie_params([
        'lifetime' => SESSION_IDLE_SECONDS,
        'path' => $path,
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
    if (!empty($_SESSION['authed']) && (time() - (int)($_SESSION['seen'] ?? 0)) > SESSION_IDLE_SECONDS) {
        $_SESSION = [];
        session_regenerate_id(true);
    }
    $_SESSION['seen'] = time();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
}

function csrf_token(): string
{
    return (string)$_SESSION['csrf'];
}

function check_csrf(?string $token): bool
{
    return is_string($token) && $token !== '' && hash_equals(csrf_token(), $token);
}

function is_authed(): bool
{
    return !empty($_SESSION['authed']);
}

/* ───────────────────────── password ───────────────────────── */

function auth_file(): string
{
    return private_dir() . '/auth.json';
}

function setup_code_file(): string
{
    return private_dir() . '/setup-code.txt';
}

function is_set_up(): bool
{
    $auth = read_json(auth_file(), []);
    return !empty($auth['hash']);
}

/** Creates the one-time setup code file if it doesn't exist yet, and returns the code. */
function setup_code(): string
{
    $file = setup_code_file();
    $code = is_file($file) ? trim((string)file_get_contents($file)) : '';
    if (!preg_match('/^[A-Z2-9]{10}$/', $code)) {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $code = '';
        for ($i = 0; $i < 10; $i++) {
            $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        file_put_contents($file, $code . "\n", LOCK_EX);
        @chmod($file, 0600);
    }
    return $code;
}

/** Seconds until this visitor may try again (0 = not locked out). Buckets: 'admin', 'view'. */
function lockout_seconds(string $bucket = 'admin'): int
{
    $auth = read_json(auth_file(), []);
    $recent = recent_failures($auth, $bucket . ':' . client_ip());
    if (count($recent) < LOGIN_MAX_FAILURES) {
        return 0;
    }
    return max(1, LOGIN_WINDOW_SECONDS - (time() - min($recent)));
}

function lockout_message(int $wait): string
{
    $minutes = max(1, (int)ceil($wait / 60));
    return 'Too many wrong attempts. Try again in ' . $minutes . ' minute' . ($minutes > 1 ? 's' : '') . '.';
}

function recent_failures(array $auth, string $key): array
{
    $cutoff = time() - LOGIN_WINDOW_SECONDS;
    return array_values(array_filter((array)($auth['failures'][$key] ?? []), function ($t) use ($cutoff) {
        return (int)$t > $cutoff;
    }));
}

function record_failure(string $bucket = 'admin'): void
{
    with_lock(auth_file(), function () use ($bucket) {
        $auth = read_json(auth_file(), []);
        $key = $bucket . ':' . client_ip();
        $failures = (array)($auth['failures'] ?? []);
        foreach (array_keys($failures) as $k) { // forget stale entries
            if (!recent_failures($auth, (string)$k)) {
                unset($failures[$k]);
            }
        }
        $list = recent_failures($auth, $key);
        $list[] = time();
        $failures[$key] = $list;
        $auth['failures'] = $failures;
        write_json(auth_file(), $auth);
    });
}

function set_password(string $password): void
{
    with_lock(auth_file(), function () use ($password) {
        $auth = read_json(auth_file(), []);
        $auth['hash'] = password_hash($password, PASSWORD_DEFAULT);
        $auth['changed'] = iso_now();
        $auth['failures'] = [];
        write_json(auth_file(), $auth);
    });
}

function verify_password(string $password): bool
{
    $auth = read_json(auth_file(), []);
    return !empty($auth['hash']) && password_verify($password, (string)$auth['hash']);
}

function log_in(): void
{
    session_regenerate_id(true);
    $_SESSION['authed'] = true;
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    $_SESSION['seen'] = time();
}

function log_out(): void
{
    $_SESSION = [];
    session_regenerate_id(true);
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

/* ───────────────────────── private-site viewer cookie ───────────────────────── */

function site_secret(): string
{
    $file = private_dir() . '/secret.key';
    $secret = is_file($file) ? trim((string)file_get_contents($file)) : '';
    if (!preg_match('/^[a-f0-9]{64}$/', $secret)) {
        $secret = bin2hex(random_bytes(32));
        file_put_contents($file, $secret . "\n", LOCK_EX);
        @chmod($file, 0600);
    }
    return $secret;
}

/** A token that proves the viewer knew the current passcode. Changing the passcode voids it. */
function view_token(string $passcodeHash, int $expires): string
{
    $sig = hash_hmac('sha256', $expires . '|' . $passcodeHash, site_secret());
    return $expires . '.' . $sig;
}

function has_view_access(array $settings): bool
{
    if (($settings['visibility'] ?? 'public') !== 'private' || empty($settings['passcodeHash'])) {
        return true;
    }
    $cookie = (string)($_COOKIE[VIEW_COOKIE] ?? '');
    if (!preg_match('/^(\d{9,11})\.([a-f0-9]{64})$/', $cookie, $m) || (int)$m[1] < time()) {
        return false;
    }
    return hash_equals(view_token((string)$settings['passcodeHash'], (int)$m[1]), $cookie);
}

function grant_view_access(array $settings): void
{
    if (empty($settings['passcodeHash'])) {
        return;
    }
    $expires = time() + VIEW_COOKIE_DAYS * 86400;
    setcookie(VIEW_COOKIE, view_token((string)$settings['passcodeHash'], $expires), [
        'expires' => $expires,
        'path' => '/',
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}
