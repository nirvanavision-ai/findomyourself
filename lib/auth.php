<?php
/*
 * FINDOM YOURSELF: admin sign-in (sessions, CSRF, password, lockout) and the
 * viewer passcode used when the site is set to private.
 *
 * Sessions exist only for the signed-in owner: anonymous visits never create one (so nobody
 * can fill the hosting account with session files), and a password change or reset signs
 * every other device out. The sign-in and passcode forms carry their own CSRF token in a
 * SameSite=Strict cookie instead.
 */
declare(strict_types=1);

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/bootstrap.php';

const SESSION_IDLE_SECONDS = 30 * 24 * 3600; // stay signed in on your phone for a month of inactivity
const LOGIN_MAX_ATTEMPTS = 6;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const MIN_PASSWORD_LENGTH = 10;
const MIN_PASSCODE_LENGTH = 8;
const SESSION_COOKIE = 'findom_admin';
const FORM_COOKIE = 'findom_form';
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
    send_hsts();
}

/* ───────────────────────── sessions + CSRF ───────────────────────── */

/**
 * Resumes the owner's session if the browser has one. With $create, starts a new one
 * (only log_in() does that). Returns whether a signed-in session is now active.
 */
function start_session(bool $create = false): bool
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return true;
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
    ini_set('session.use_only_cookies', '1');

    session_name(SESSION_COOKIE);
    session_set_cookie_params([
        'lifetime' => SESSION_IDLE_SECONDS,
        'path' => session_cookie_path(),
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    if (!$create && !is_string($_COOKIE[SESSION_COOKIE] ?? null)) {
        return false; // anonymous visitor: no session, no file
    }
    session_start();
    if ($create) {
        return true;
    }
    $stale = empty($_SESSION['authed'])
        || (time() - (int)($_SESSION['seen'] ?? 0)) > SESSION_IDLE_SECONDS
        || !hash_equals(auth_epoch(), (string)($_SESSION['epoch'] ?? ''));
    if ($stale) { // unknown, expired, signed out elsewhere or from before a password change
        end_session();
        return false;
    }
    $_SESSION['seen'] = time();
    return true;
}

function session_cookie_path(): string
{
    return rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/admin/index.php'), '/') . '/';
}

/** Deletes the session file and the cookie. */
function end_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        $_SESSION = [];
        session_destroy();
    }
    setcookie(SESSION_COOKIE, '', [
        'expires' => time() - 3600,
        'path' => session_cookie_path(),
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function csrf_token(): string
{
    return (string)($_SESSION['csrf'] ?? '');
}

function check_csrf($token): bool
{
    return is_string($token) && $token !== '' && csrf_token() !== '' && hash_equals(csrf_token(), $token);
}

function is_authed(): bool
{
    return session_status() === PHP_SESSION_ACTIVE && !empty($_SESSION['authed']);
}

/**
 * CSRF for forms shown before sign-in (setup, sign-in, the site passcode): a random value in a
 * SameSite=Strict cookie that the form must echo back. Other sites can't read or send it.
 */
function form_token(): string
{
    $token = $_COOKIE[FORM_COOKIE] ?? '';
    if (!is_string($token) || !preg_match('/^[a-f0-9]{32}$/', $token)) {
        $token = bin2hex(random_bytes(16));
        setcookie(FORM_COOKIE, $token, ['expires' => 0, 'path' => '/', 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Strict']);
        $_COOKIE[FORM_COOKIE] = $token;
    }
    return $token;
}

function check_form_token($value): bool
{
    $cookie = $_COOKIE[FORM_COOKIE] ?? '';
    return is_string($value) && is_string($cookie) && preg_match('/^[a-f0-9]{32}$/', $cookie) === 1 && hash_equals($cookie, $value);
}

/* ───────────────────────── password ───────────────────────── */

function auth_file(): string
{
    return private_dir() . '/auth.json';
}

function attempts_file(): string
{
    return private_dir() . '/attempts.json';
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

/** Changes whenever the password is set; sessions from before it stop working. */
function auth_epoch(): string
{
    $auth = read_json(auth_file(), []);
    return (string)($auth['epoch'] ?? ($auth['changed'] ?? ''));
}

/** Creates the one-time setup code file if it doesn't exist yet, and returns the code. */
function setup_code(): string
{
    return with_lock(setup_code_file(), function () {
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
    });
}

/**
 * Reserves a password attempt for this visitor before the (slow) check runs, so parallel
 * requests can't sneak extra guesses past the limit. Returns seconds to wait (0 = go ahead).
 * Buckets: 'admin' (sign-in) and 'view' (the private-site passcode).
 */
function begin_attempt(string $bucket): int
{
    return with_lock(attempts_file(), function () use ($bucket) {
        $now = time();
        $all = read_json(attempts_file(), []);
        foreach ($all as $key => $times) { // forget old entries
            $all[$key] = array_values(array_filter((array)$times, function ($t) use ($now) {
                return (int)$t > $now - LOGIN_WINDOW_SECONDS;
            }));
            if (!$all[$key]) {
                unset($all[$key]);
            }
        }
        $key = $bucket . ':' . client_key();
        $recent = $all[$key] ?? [];
        if (count($recent) >= LOGIN_MAX_ATTEMPTS) {
            return max(1, LOGIN_WINDOW_SECONDS - ($now - min($recent)));
        }
        $recent[] = $now;
        $all[$key] = $recent;
        write_json(attempts_file(), $all);
        return 0;
    });
}

/** A correct password: this visitor's attempts don't count against them anymore. */
function clear_attempts(string $bucket): void
{
    with_lock(attempts_file(), function () use ($bucket) {
        $all = read_json(attempts_file(), []);
        unset($all[$bucket . ':' . client_key()]);
        write_json(attempts_file(), $all);
    });
}

function lockout_message(int $wait): string
{
    $minutes = max(1, (int)ceil($wait / 60));
    return 'Too many wrong attempts. Try again in ' . $minutes . ' minute' . ($minutes > 1 ? 's' : '') . '.';
}

/** Why a new password or passcode can't be used, or '' if it's fine. */
function password_problem($password, int $min): string
{
    if (!is_string($password) || mb_strlen($password) < $min) {
        return 'Use at least ' . $min . ' characters.';
    }
    if (strpos($password, "\0") !== false || strlen($password) > 1000) {
        return 'That contains characters that can’t be used.';
    }
    return '';
}

function set_password(string $password): void
{
    with_lock(auth_file(), function () use ($password) {
        $auth = read_json(auth_file(), []);
        $auth['hash'] = password_hash($password, PASSWORD_DEFAULT);
        $auth['changed'] = iso_now();
        $auth['epoch'] = bin2hex(random_bytes(16)); // signs every other device out
        unset($auth['failures']);
        write_json(auth_file(), $auth);
    });
}

function verify_password($password): bool
{
    if (!is_string($password) || strpos($password, "\0") !== false) {
        return false;
    }
    $auth = read_json(auth_file(), []);
    return !empty($auth['hash']) && password_verify($password, (string)$auth['hash']);
}

function log_in(): void
{
    start_session(true);
    session_regenerate_id(true);
    $_SESSION['authed'] = true;
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    $_SESSION['seen'] = time();
    $_SESSION['epoch'] = auth_epoch();
}

function log_out(): void
{
    end_session();
}

/* ───────────────────────── private-site viewer cookie ───────────────────────── */

function site_secret(): string
{
    $file = private_dir() . '/secret.key';
    return with_lock($file, function () use ($file) {
        $secret = is_file($file) ? trim((string)file_get_contents($file)) : '';
        if (!preg_match('/^[a-f0-9]{64}$/', $secret)) {
            $secret = bin2hex(random_bytes(32));
            file_put_contents($file, $secret . "\n", LOCK_EX);
            @chmod($file, 0600);
        }
        return $secret;
    });
}

/** A token that proves the viewer knew the current passcode. Changing the passcode voids it. */
function view_token(string $passcodeHash, int $expires): string
{
    $sig = hash_hmac('sha256', $expires . '|' . $passcodeHash, site_secret());
    return $expires . '.' . $sig;
}

function is_private(array $settings): bool
{
    return ($settings['visibility'] ?? 'public') === 'private' && !empty($settings['passcodeHash']);
}

function has_view_access(array $settings): bool
{
    if (!is_private($settings)) {
        return true;
    }
    $cookie = $_COOKIE[VIEW_COOKIE] ?? '';
    if (!is_string($cookie) || !preg_match('/^(\d{9,11})\.([a-f0-9]{64})$/', $cookie, $m) || (int)$m[1] < time()) {
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

/** Private pages must never be kept by a shared cache. */
function send_private_cache_headers(array $settings): void
{
    if (is_private($settings)) {
        header('Cache-Control: private, no-store');
        header('Vary: Cookie');
    }
}
