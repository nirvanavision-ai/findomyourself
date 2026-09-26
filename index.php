<?php
/*
 * FINDOM YOURSELF: the public site. The page ships with its data inline, so it renders
 * without waiting on a second request; js/main.js takes it from there (and polls
 * api/state.php to keep the vault, receipts and live timer current).
 */
declare(strict_types=1);

require __DIR__ . '/lib/store.php';
require __DIR__ . '/lib/auth.php';

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('X-Frame-Options: SAMEORIGIN');
header('Cache-Control: no-cache');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; media-src 'self' data: blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'");

$data = load_data();
$s = $data['settings'];

/* ───── private mode: ask for the passcode ───── */
if (!has_view_access($s)) {
    $error = '';
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
        if (($wait = lockout_seconds('view')) > 0) {
            $error = lockout_message($wait);
        } elseif (password_verify((string)($_POST['passcode'] ?? ''), (string)$s['passcodeHash'])) {
            grant_view_access($s);
            header('Location: ./', true, 303);
            exit;
        } else {
            record_failure('view');
            $error = 'Wrong. Try again, and mean it this time.';
        }
    }
    http_response_code(401);
    header('X-Robots-Tag: noindex');
    ?><!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#0b0709">
  <title><?= h($s['title']) ?></title>
  <link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="<?= h(asset('css/site.css')) ?>">
</head>
<body class="gatepage">
  <form class="passgate" method="post">
    <p class="eyebrow">Private collection</p>
    <h1><em>Findom</em> <span>Yourself</span></h1>
    <p>This wishlist is invitation only. Knock politely.</p>
    <?php if ($error): ?><p class="passgate__error" role="alert"><?= h($error) ?></p><?php endif; ?>
    <label for="passcode">Passcode</label>
    <input id="passcode" name="passcode" type="password" required autofocus autocomplete="current-password">
    <button class="btn btn--primary" type="submit">Let me in</button>
  </form>
</body>
</html>
<?php
    exit;
}

/* ───── the site ───── */
$state = public_state($data);
$copy = $state['settings']['copy'];

$scheme = is_https() ? 'https' : 'http';
$host = preg_replace('/[^a-z0-9.:-]/i', '', (string)($_SERVER['HTTP_HOST'] ?? 'findomyourself.com'));
$base = $scheme . '://' . $host . rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/') . '/';
$description = $s['tagline'] . ' A wishlist that only unlocks when the work is done: every hour of real work pays tribute into the vault.';

/** Placeholders for the server-rendered copy (the page script re-renders them live). */
function fill_copy(string $text, array $state): string
{
    $items = array_column($state['items'], null, 'id');
    $goal = $items[$state['goalId']] ?? null;
    $symbol = ['USD' => '$', 'EUR' => '€', 'GBP' => '£', 'JPY' => '¥'][$state['settings']['baseCurrency']] ?? '';
    $money = function ($v) use ($symbol, $state) {
        return $v === null ? '•••' : ($symbol !== '' ? $symbol . number_format((float)$v, 0) : number_format((float)$v, 0) . ' ' . $state['settings']['baseCurrency']);
    };
    $wishing = count(array_filter($state['items'], function ($i) {
        return $i['status'] === 'wishing';
    }));
    return strtr($text, [
        '{rate}' => $money($state['settings']['hourlyRate']),
        '{goal}' => $goal ? trim($goal['brand'] . ' ' . $goal['name']) : 'next thing',
        '{item}' => $goal ? trim($goal['brand'] . ' ' . $goal['name']) : 'next thing',
        '{hours}' => $goal ? (string)$goal['hoursToGo'] : '0',
        '{balance}' => $money($state['stats']['balance']),
        '{streak}' => (string)$state['stats']['streak'],
        '{count}' => (string)$wishing,
        '{since}' => 'a while',
    ]);
}

function copy_html(string $key, array $copy, array $state): string
{
    return h(fill_copy($copy[$key] ?? '', $state));
}
?><!doctype html>
<html lang="en" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title><?= h($s['title'] . ' · ' . $s['tagline']) ?></title>
  <meta name="description" content="<?= h($description) ?>">
  <meta name="theme-color" content="#0b0709">
  <meta name="color-scheme" content="dark">
  <link rel="canonical" href="<?= h($base) ?>">
  <meta property="og:type" content="website">
  <meta property="og:title" content="<?= h($s['title']) ?>">
  <meta property="og:description" content="<?= h($description) ?>">
  <meta property="og:url" content="<?= h($base) ?>">
  <meta property="og:image" content="<?= h($base . 'assets/img/og.jpg') ?>">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png">
  <link rel="preload" href="assets/fonts/bodoni-moda-italic-var.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="assets/fonts/archivo-var.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="modulepreload" href="<?= h(asset('js/main.js')) ?>">
  <link rel="stylesheet" href="<?= h(asset('css/site.css')) ?>">
  <noscript><style>.loader, .cursor { display: none !important; }</style></noscript>
  <script type="module" src="<?= h(asset('js/main.js')) ?>"></script>
</head>
<body>
<canvas class="gl" id="gl" aria-hidden="true"></canvas>
<div class="backdrop" aria-hidden="true"></div>
<div class="grain" aria-hidden="true"></div>

<div class="loader" id="loader" aria-hidden="true">
  <p class="loader__brand"><em>Findom</em> <span>Yourself</span></p>
  <p class="loader__count"><span id="loader-count">000</span></p>
  <p class="loader__line" id="loader-line">Hiding your credit card…</p>
  <div class="loader__bar"><span id="loader-bar"></span></div>
</div>

<div class="cursor" id="cursor" aria-hidden="true"><span class="cursor__dot"></span><span class="cursor__ring"><span class="cursor__label" id="cursor-label"></span></span></div>

<a class="skip" href="#list">Skip to the list</a>

<header class="nav" id="nav">
  <a class="nav__brand" href="#top" aria-label="<?= h($s['title']) ?>, back to the top"><em>Findom</em><span>Yourself</span></a>
  <nav class="nav__links" aria-label="Sections">
    <a href="#list">The list</a>
    <a href="#vault">Vault</a>
    <a href="#rules">Rules</a>
    <a href="#whip" data-whip-link>Whip</a>
  </nav>
  <div class="nav__tools">
    <a class="status" id="status" href="#vault"><i class="status__dot"></i><span class="status__text" id="status-text">Checking…</span></a>
    <button class="sound" id="sound" type="button" aria-pressed="false"><span class="sound__bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="sound__label">Sound</span></button>
  </div>
</header>

<main id="main">
  <section class="hero" id="top" data-tone="hero">
    <div class="hero__anchor" id="hero-anchor" aria-hidden="true"></div>
    <p class="hero__kicker" data-reveal><span class="rule-line"></span><span data-copy="heroKicker"><?= copy_html('heroKicker', $copy, $state) ?></span></p>
    <h1 class="hero__title" aria-label="<?= h($s['title']) ?>">
      <span class="hero__findom" data-split aria-hidden="true">Findom</span>
      <span class="hero__yourself" data-split aria-hidden="true">Yourself<i>.</i></span>
    </h1>
    <figure class="says" id="says" data-reveal>
      <blockquote><p id="says-text">Cute wishlist. Now earn it.</p></blockquote>
      <figcaption>Future You</figcaption>
    </figure>
    <div class="hero__side" data-reveal>
      <p class="hero__intro" data-copy="heroIntro"><?= copy_html('heroIntro', $copy, $state) ?></p>
      <div class="hero__ctas">
        <a class="btn btn--primary" href="#list" data-cursor="Look">See what I’m working for <span aria-hidden="true">↓</span></a>
        <a class="btn btn--ghost" href="#whip" data-cursor="Crack" data-whip-link>Crack the whip</a>
      </div>
    </div>
    <dl class="hero__stats" data-reveal>
      <div><dt>In the vault</dt><dd data-stat="balance">—</dd></div>
      <div><dt>Streak</dt><dd data-stat="streak">—</dd></div>
      <div><dt>Grind logged</dt><dd data-stat="hours">—</dd></div>
      <div><dt>Next unlock</dt><dd data-stat="next">—</dd></div>
    </dl>
    <p class="hero__scroll" aria-hidden="true"><span>Scroll, if you can commit to something</span></p>
  </section>

  <div class="ribbons" id="ribbons" aria-hidden="true">
    <div class="ribbon ribbon--a"><div class="ribbon__track" data-ribbon="a"></div></div>
    <div class="ribbon ribbon--b"><div class="ribbon__track" data-ribbon="b"></div></div>
  </div>

  <section class="rules" id="rules" data-tone="rules">
    <header class="section-head">
      <p class="eyebrow" data-reveal>House rules · non-negotiable</p>
      <h2 class="section-title" data-split><em>The</em> deal.</h2>
    </header>
    <ol class="rules__list">
      <?php foreach ([1, 2, 3] as $n): ?>
      <li class="rule" data-reveal>
        <span class="rule__num" aria-hidden="true">0<?= $n ?></span>
        <h3 class="rule__title" data-copy="rule<?= $n ?>"><?= copy_html('rule' . $n, $copy, $state) ?></h3>
        <p class="rule__body" data-copy="rule<?= $n ?>Body"><?= copy_html('rule' . $n . 'Body', $copy, $state) ?></p>
      </li>
      <?php endforeach; ?>
    </ol>
    <div class="menu" data-reveal>
      <div class="menu__head">
        <h3 class="menu__title"><em>Tribute</em> menu</h3>
        <p class="menu__note">Prices subject to my mood.</p>
      </div>
      <div class="menu__cols">
        <div class="menu__col">
          <h4>Pays into the vault</h4>
          <ul id="menu-pays"></ul>
        </div>
        <div class="menu__col menu__col--costs">
          <h4>Costs you</h4>
          <ul id="menu-costs"></ul>
        </div>
      </div>
    </div>
  </section>

  <section class="vault" id="vault" data-tone="vault">
    <div class="vault__stage" data-reveal>
      <div class="vault__anchor" id="vault-anchor" aria-hidden="true"></div>
      <p class="vault__caption" id="vault-caption" aria-hidden="true"></p>
    </div>
    <div class="vault__info">
      <header class="section-head">
        <p class="eyebrow" data-reveal>Live · updates as tribute lands</p>
        <h2 class="section-title" data-split><em>The</em> vault.</h2>
      </header>
      <p class="vault__balance" data-reveal><span id="vault-balance">—</span></p>
      <p class="vault__intro" data-copy="vaultIntro" data-reveal><?= copy_html('vaultIntro', $copy, $state) ?></p>
      <dl class="vault__stats" data-reveal>
        <div><dt>Earned</dt><dd data-stat="earned">—</dd></div>
        <div><dt>Fined</dt><dd data-stat="fined">—</dd></div>
        <div><dt>Spent</dt><dd data-stat="spent">—</dd></div>
        <div><dt>Today</dt><dd data-stat="today">—</dd></div>
        <div><dt>Best streak</dt><dd data-stat="bestStreak">—</dd></div>
        <div><dt>Whipped today</dt><dd data-stat="whipsToday">—</dd></div>
      </dl>
      <div class="goal" id="goal" data-reveal></div>
    </div>
    <aside class="receipt" id="receipt" aria-label="Latest tribute" data-reveal></aside>
  </section>

  <section class="list" id="list" data-tone="list">
    <header class="section-head section-head--split">
      <div>
        <p class="eyebrow" id="list-eyebrow" data-reveal>The collection</p>
        <h2 class="section-title" data-split><em>The</em> list.</h2>
      </div>
      <p class="section-intro" data-copy="listIntro" data-reveal><?= copy_html('listIntro', $copy, $state) ?></p>
    </header>
    <div class="list__controls" data-reveal>
      <div class="chips" id="filters" role="group" aria-label="Show"></div>
      <div class="chips chips--cats" id="categories" role="group" aria-label="Category"></div>
      <label class="sort"><span>Sort</span>
        <select id="sort">
          <option value="closest">Closest to unlock</option>
          <option value="order">My order</option>
          <option value="price-asc">Price, low to high</option>
          <option value="price-desc">Price, high to low</option>
        </select>
      </label>
    </div>
    <ul class="grid" id="grid"></ul>
    <p class="list__empty" id="list-empty" hidden>Nothing here. Suspicious.</p>
  </section>

  <section class="trophies" id="trophies" data-tone="trophies">
    <header class="section-head">
      <p class="eyebrow" data-reveal>Earned · bought · flaunted</p>
      <h2 class="section-title" data-split><em>Trophy</em> wall.</h2>
      <p class="section-intro" data-copy="trophyIntro" data-reveal><?= copy_html('trophyIntro', $copy, $state) ?></p>
    </header>
    <ul class="wall" id="wall"></ul>
  </section>

  <section class="whip" id="whip" data-tone="whip"<?= $s['whip'] ? '' : ' hidden' ?>>
    <div class="whip__head">
      <p class="eyebrow" data-reveal>Interactive · motivational · slightly unhinged</p>
      <h2 class="whip__title" data-split><em>Crack</em> the whip.</h2>
      <p class="whip__intro" data-copy="whipIntro" data-reveal><?= copy_html('whipIntro', $copy, $state) ?></p>
    </div>
    <div class="whip__arena" id="whip-arena" data-cursor-hide>
      <p class="whip__hint" id="whip-hint">Grab it. Flick hard.</p>
      <p class="whip__live" id="whip-live" hidden></p>
    </div>
    <div class="whip__footer">
      <dl class="whip__counts">
        <div><dt>Yours</dt><dd id="whip-mine">0</dd></div>
        <div><dt>Today</dt><dd id="whip-today">0</dd></div>
        <div><dt>All time</dt><dd id="whip-total">0</dd></div>
      </dl>
      <button class="btn btn--primary whip__button" id="whip-button" type="button">Crack it for me</button>
    </div>
  </section>
</main>

<footer class="footer" data-tone="footer">
  <p class="footer__big" data-copy="footerLine" data-split><?= copy_html('footerLine', $copy, $state) ?></p>
  <div class="footer__row">
    <p class="footer__fine" data-copy="finePrint"><?= copy_html('finePrint', $copy, $state) ?></p>
    <nav class="footer__links" aria-label="More">
      <a href="#top">Back to top ↑</a>
      <a href="admin/" rel="nofollow">Control room</a>
    </nav>
  </div>
  <p class="footer__credit"><span>© <?= date('Y') ?> <?= h(preg_replace('/^www\./', '', $host)) ?></span><span>Designed &amp; built with Claude</span></p>
</footer>

<dialog class="modal" id="modal" aria-labelledby="modal-title"></dialog>
<div class="pops" id="pops" aria-hidden="true"></div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>

<noscript>
  <div class="noscript">
    <p>This site is best with JavaScript on. Here’s the list anyway:</p>
    <ul>
      <?php foreach ($state['items'] as $item): if ($item['status'] !== 'wishing') { continue; } ?>
      <li><?= h(trim($item['brand'] . ' ' . $item['name'])) ?><?= $item['price'] !== null ? ' · ' . h(number_format((float)$item['price'], 0) . ' ' . $item['currency']) : '' ?><?php if ($item['url']): ?> · <a href="<?= h($item['url']) ?>" rel="noopener noreferrer nofollow">store</a><?php endif; ?></li>
      <?php endforeach; ?>
    </ul>
  </div>
</noscript>
<script type="application/json" id="initial-state"><?= json_for_html($state) ?></script>
</body>
</html>
