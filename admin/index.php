<?php
/*
 * FINDOM YOURSELF: the Control Room. One-time setup, sign-in, and the app shell
 * that admin.js turns into the dashboard.
 */
declare(strict_types=1);

require __DIR__ . '/../lib/store.php';
require __DIR__ . '/../lib/auth.php';

send_admin_headers();
start_session();

$error = '';
$setUp = is_set_up();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = post_string('action');
    if ($action === 'logout') {
        if (check_csrf($_POST['csrf'] ?? null)) {
            log_out();
        }
        redirect_self();
    } elseif (!check_form_token($_POST['csrf'] ?? null)) {
        $error = 'Your form expired. Please try again.';
    } elseif (($action === 'setup' && !$setUp) || ($action === 'login' && $setUp)) {
        if (($wait = begin_attempt('admin')) > 0) {
            $error = lockout_message($wait);
        } elseif ($action === 'setup') {
            $code = strtoupper((string)preg_replace('/\s+/', '', post_string('code')));
            $password = post_string('password');
            if (!hash_equals(setup_code(), $code)) {
                $error = 'That setup code doesn’t match. Copy it again from setup-code.txt.';
            } elseif (($problem = password_problem($password, MIN_PASSWORD_LENGTH)) !== '') {
                $error = $problem;
            } elseif ($password !== post_string('confirm')) {
                $error = 'The two passwords don’t match.';
            } else {
                set_password($password);
                @unlink(setup_code_file());
                clear_attempts('admin');
                log_in();
                redirect_self();
            }
        } elseif (verify_password(post_string('password'))) {
            clear_attempts('admin');
            log_in();
            redirect_self();
        } else {
            $error = 'That password is wrong.';
        }
    }
}

function post_string(string $key): string
{
    $value = $_POST[$key] ?? '';
    return is_string($value) ? $value : '';
}

function redirect_self(): void
{
    header('Location: ./', true, 303);
    exit;
}

if (!$setUp) {
    setup_code(); // make sure the code file exists before pointing the owner at it
}
$view = !$setUp ? 'setup' : (is_authed() ? 'app' : 'login');
$settings = load_data()['settings'];
if ($view === 'app') {
    grant_view_access($settings); // a private site stays open to its owner
}
$formToken = $view === 'app' ? '' : form_token(); // sets a cookie, so before any output
?><!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#0b0709">
  <meta name="color-scheme" content="dark">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Control Room">
  <?php if ($view === 'app'): ?><meta name="csrf-token" content="<?= h(csrf_token()) ?>"><?php endif; ?>
  <title>Control Room · <?= h($settings['title']) ?></title>
  <link rel="icon" href="../assets/img/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="../assets/img/apple-touch-icon.png">
  <link rel="preload" href="../assets/fonts/bodoni-moda-italic-var.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="../assets/fonts/archivo-var.woff2" as="font" type="font/woff2" crossorigin>
  <?php if ($view === 'app'): ?><link rel="preload" href="../assets/fonts/jetbrains-mono-var.woff2" as="font" type="font/woff2" crossorigin><?php endif; ?>
  <?php /* asset() paths are relative to the site root; this page lives one folder down. */ ?>
  <link rel="stylesheet" href="../<?= h(asset('admin/admin.css')) ?>">
</head>
<body class="view-<?= h($view) ?>">
<?php if ($view !== 'app'): ?>
  <main class="gate">
    <form class="gate-card" method="post" autocomplete="on">
      <p class="eyebrow"><?= h($settings['title']) ?></p>
      <h1>Control <em>Room</em></h1>
      <input type="hidden" name="csrf" value="<?= h($formToken) ?>">
      <?php if ($error): ?><p class="msg error" role="alert"><?= h($error) ?></p><?php endif; ?>
      <?php if ($view === 'setup'): ?>
        <input type="hidden" name="action" value="setup">
        <p class="lede">First time here. Prove you own this site with the one-time setup code from this file in your hosting File Manager:</p>
        <?php [$hintFile, $hintWhere] = private_file_hint('setup-code.txt'); ?>
        <p class="path"><code><?= h($hintFile) ?></code> <span><?= h($hintWhere) ?></span></p>
        <label for="code">Setup code</label>
        <input id="code" name="code" required autocomplete="one-time-code" spellcheck="false" autocapitalize="characters" maxlength="20">
        <label for="password">New password <small>(at least <?= MIN_PASSWORD_LENGTH ?> characters)</small></label>
        <input id="password" name="password" type="password" required minlength="<?= MIN_PASSWORD_LENGTH ?>" autocomplete="new-password">
        <label for="confirm">Type it again</label>
        <input id="confirm" name="confirm" type="password" required minlength="<?= MIN_PASSWORD_LENGTH ?>" autocomplete="new-password">
        <button class="btn primary" type="submit">Create password and enter</button>
      <?php else: ?>
        <input type="hidden" name="action" value="login">
        <input type="text" name="username" value="owner" autocomplete="username" hidden>
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required autocomplete="current-password" autofocus>
        <button class="btn primary" type="submit">Enter</button>
        <p class="fine">Forgot it? In your hosting File Manager, delete <code>auth.json</code> from the private folder next to <code>public_html</code>, then reload this page to set a new one.</p>
      <?php endif; ?>
      <a class="back" href="../">← Back to the site</a>
    </form>
  </main>
<?php else: ?>
  <div id="app" data-logout-csrf="<?= h(csrf_token()) ?>">
    <p class="booting"><span>Opening the Control <em>Room</em>…</span></p>
    <noscript><p class="msg error">The Control Room needs JavaScript. Turn it on for this site and reload.</p></noscript>
  </div>
  <form id="logout-form" method="post" hidden>
    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
    <input type="hidden" name="action" value="logout">
  </form>
  <script type="module" src="../<?= h(asset('admin/admin.js')) ?>"></script>
<?php endif; ?>
</body>
</html>
