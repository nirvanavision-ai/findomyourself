<?php
/*
 * FINDOM YOURSELF: backend tests. Run from the repo root:
 *
 *   php tools/test.php
 *
 * Uses a throwaway private folder, so it never touches real data.
 */
declare(strict_types=1);

$tmp = sys_get_temp_dir() . '/findom-test-' . bin2hex(random_bytes(4));
mkdir($tmp, 0700, true);
putenv('FINDOM_PRIVATE_DIR=' . $tmp);

require __DIR__ . '/../lib/store.php';
require __DIR__ . '/../lib/auth.php';
require __DIR__ . '/../lib/import.php';
require __DIR__ . '/../lib/images.php';

$failures = 0;
$count = 0;

function check(string $name, $actual, $expected): void
{
    global $failures, $count;
    $count++;
    if ($actual === $expected) {
        return;
    }
    $failures++;
    echo "✗ $name\n    expected: " . var_export($expected, true) . "\n    actual:   " . var_export($actual, true) . "\n";
}

/* ───── prices ───── */
check('amount: plain', parse_amount('590'), 590.0);
check('amount: dollars', parse_amount('$1,264.50'), 1264.5);
check('amount: euro thousands', parse_amount('1.100 €'), 1100.0);
check('amount: euro decimals', parse_amount('1.100,50'), 1100.5);
check('amount: decimal comma', parse_amount('12,50'), 12.5);
check('amount: decimal dot', parse_amount('590.00'), 590.0);
check('amount: garbage', parse_amount('abc'), null);
check('price: first wins', array_slice(find_price('1.100 € (~$1,264 USD)', true), 0, 2), [1100.0, 'EUR']);
check('price: usd', array_slice(find_price('$590 USD', true), 0, 2), [590.0, 'USD']);
check('price: code first', array_slice(find_price('EUR 271', true), 0, 2), [271.0, 'EUR']);
check('price: segment', array_slice(find_price('Cute hat, 120, ', false), 0, 2), [120.0, '']);
check('price: year is not a price', array_slice(find_price('1994 Tank', false), 0, 2), [null, '']);

/* ───── links ───── */
check('link: strips utm', normalize_link('https://amiri.com/products/x?utm_source=gemini'), 'https://amiri.com/products/x');
check('link: keeps real params', normalize_link('https://shop.com/p?id=4&utm_medium=x&color=red'), 'https://shop.com/p?id=4&color=red');
check('link: unwraps google search', normalize_link('https://www.google.com/search?q=https://amiri.com/products/women-womens-ma-quad-knit-short-sleeve-polo-black&utm_source=gemini'), 'https://amiri.com/products/women-womens-ma-quad-knit-short-sleeve-polo-black');
check('link: unwraps google redirect', normalize_link('https://www.google.com/url?sa=t&url=https%3A%2F%2Fwww.ssense.com%2Fen-us%2Fwomen%2Fproduct%2Fx%2F123'), 'https://www.ssense.com/en-us/women/product/x/123');
check('name: farfetch slug', name_from_url('https://www.farfetch.com/shopping/women/versace-medusa-rhapsody-ashtray-13cm-item-16661316.aspx'), 'Versace Medusa Rhapsody Ashtray 13cm');
check('name: shopify handle', name_from_url('https://amiri.com/products/women-womens-ma-quad-jacquard-mini-skirt-stone-indigo'), 'MA Quad Jacquard Mini Skirt Stone Indigo');
check('store: farfetch', store_name('https://www.farfetch.com/shopping/x'), 'Farfetch');
check('store: amiri', store_name('https://amiri.com/products/x'), 'AMIRI');
check('store: unknown', store_name('https://www.coolshop.co.uk/x'), 'Coolshop');

/* ───── safe fetch guard ───── */
check('ip: loopback', is_public_ip('127.0.0.1'), false);
check('ip: private', is_public_ip('192.168.1.10'), false);
check('ip: metadata', is_public_ip('169.254.169.254'), false);
check('ip: cgnat', is_public_ip('100.100.100.200'), false);
check('ip: mapped v6', is_public_ip('::ffff:127.0.0.1'), false);
check('ip: v6 loopback', is_public_ip('::1'), false);
check('ip: v6 ula', is_public_ip('fd00::1'), false);
check('ip: public', is_public_ip('93.184.216.34'), true);
check('ip: test-net', is_public_ip('198.51.100.7'), false);
check('ip: v6 compat loopback', is_public_ip('::7f00:1'), false);
check('ip: v6 documentation', is_public_ip('2001:db8::1'), false);
check('ip: v6 6to4 wrapping 127.0.0.1', is_public_ip('2002:7f00:1::1'), false);
check('ip: v6 teredo', is_public_ip('2001::1'), false);
check('ip: v6 nat64', is_public_ip('64:ff9b::7f00:1'), false);
check('ip: v6 link-local', is_public_ip('fe80::1'), false);
check('ip: v6 global', is_public_ip('2606:4700:4700::1111'), true);
$_SERVER['REMOTE_ADDR'] = '2a01:4f8:1:2:aaaa::1';
$v6a = client_key();
$_SERVER['REMOTE_ADDR'] = '2a01:4f8:1:2:bbbb::9';
check('rate limit: one IPv6 /64 is one visitor', client_key(), $v6a);
$_SERVER['REMOTE_ADDR'] = '203.0.113.9';
check('rate limit: IPv4 as is', client_key(), '203.0.113.9');
unset($_SERVER['REMOTE_ADDR']);
check('host: localhost refused', public_ip_for('localhost'), null);
check('host: literal private refused', public_ip_for('10.0.0.5'), null);
try {
    safe_request('http://127.0.0.1/', 1000, '*/*');
    check('fetch: loopback refused', 'fetched', 'refused');
} catch (RuntimeException $e) {
    check('fetch: loopback refused', 'refused', 'refused');
}
try {
    safe_request('http://[::1]/', 1000, '*/*');
    check('fetch: v6 loopback refused', 'fetched', 'refused');
} catch (RuntimeException $e) {
    check('fetch: v6 loopback refused', 'refused', 'refused');
}
try {
    safe_request('file:///etc/passwd', 1000, '*/*');
    check('fetch: file refused', 'fetched', 'refused');
} catch (RuntimeException $e) {
    check('fetch: file refused', 'refused', 'refused');
}
check('html: json-ld product', parse_product_html(
    '<html><head><title>X | FARFETCH</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Medusa Rhapsody ashtray","brand":{"@type":"Brand","name":"Versace"},"image":["https://cdn.example/a.jpg"],"offers":{"@type":"Offer","price":"271.00","priceCurrency":"EUR"}}</script></head></html>',
    'https://www.farfetch.com/x'
), ['name' => 'Medusa Rhapsody ashtray', 'brand' => 'Versace', 'variant' => '', 'price' => 271.0, 'currency' => 'EUR', 'image' => 'https://cdn.example/a.jpg']);
check('html: og tags', parse_product_html(
    '<html><head><meta property="og:title" content="Court Hi"><meta property="og:image" content="//cdn.shopify.com/a.png"><meta property="product:price:amount" content="590.00"><meta property="product:price:currency" content="USD"></head></html>',
    'https://amiri.com/products/x'
), ['name' => 'Court Hi', 'brand' => '', 'variant' => '', 'price' => 590.0, 'currency' => 'USD', 'image' => 'https://cdn.shopify.com/a.png']);

/* ───── pasted wishlist (the exact Gemini output) ───── */
$parsed = parse_wishlist_text((string)file_get_contents(__DIR__ . '/fixtures/gemini-wishlist.md'));
check('import: 12 items', count($parsed), 12);
check('import: first item', array_intersect_key($parsed[0] ?? [], array_flip(['name', 'brand', 'variant', 'category', 'price', 'currency', 'url'])), [
    'name' => 'Large Transparent Speaker', 'brand' => 'Transparent', 'variant' => 'White', 'category' => 'Home, Design & Audio',
    'price' => 1100.0, 'currency' => 'EUR', 'url' => 'https://www.farfetch.com/shopping/women/transparent-large-transparent-speaker-item-19979010.aspx',
]);
check('import: apostrophe brand', [$parsed[3]['brand'] ?? '', $parsed[3]['name'] ?? ''], ['L’Objet', 'Malachite Porcelain Ashtray']);
check('import: scarf price', [$parsed[5]['price'] ?? null, $parsed[5]['currency'] ?? ''], [1911.0, 'EUR']);
check('import: category switch', $parsed[4]['category'] ?? '', 'Footwear & Accessories');
check('import: google-wrapped link', $parsed[8]['url'] ?? '', 'https://amiri.com/products/women-womens-ma-quad-knit-short-sleeve-polo-black');
check('import: womens prefix dropped', [$parsed[8]['brand'] ?? '', $parsed[8]['name'] ?? '', $parsed[8]['variant'] ?? ''], ['AMIRI', 'MA Quad Knit Short Sleeve Polo', 'Black']);
check('import: 1994 tank', [$parsed[11]['name'] ?? '', $parsed[11]['price'] ?? null, $parsed[11]['currency'] ?? ''], ['1994 Tank', 350.0, 'USD']);

$lines = parse_wishlist_text("Versace Medusa ashtray – 271 € – https://www.farfetch.com/x-item-1.aspx\nCute hat, 120, https://shop.com/hat\nhttps://amiri.com/products/amiri-1994-tank-black\nJust a name with no price");
check('import lines: count', count($lines), 4);
check('import lines: inline', [$lines[0]['brand'], $lines[0]['name'], $lines[0]['price'], $lines[0]['currency']], ['Versace', 'Medusa ashtray', 271.0, 'EUR']);
check('import lines: bare number', [$lines[1]['name'], $lines[1]['price'], $lines[1]['url']], ['Cute hat', 120.0, 'https://shop.com/hat']);
check('import lines: bare link named from slug', [$lines[2]['brand'], $lines[2]['name'], $lines[2]['url']], ['AMIRI', '1994 Tank Black', 'https://amiri.com/products/amiri-1994-tank-black']);
check('import lines: name only', [$lines[3]['name'], $lines[3]['price']], ['Just a name with no price', null]);

check('trim: separators only', trim_separators(' — Chloé bag –, '), 'Chloé bag');
check('trim: keeps multibyte ends', [trim_separators('Café À'), trim_separators('“Quoted” ·')], ['Café À', '“Quoted”']);
$mb = parse_wishlist_text("Chloé Woody tote — 890 € — https://shop.com/tote\n€uro Café À – 12 €");
check('import lines: multibyte separators', [$mb[0]['brand'], $mb[0]['name'], $mb[0]['price'], $mb[0]['currency']], ['Chloé', 'Woody tote', 890.0, 'EUR']);
check('import lines: multibyte name intact', $mb[1]['name'], '€uro Café À');
check('brand: two words', split_brand('Bottega Veneta Andiamo bag'), ['Bottega Veneta', 'Andiamo bag']);
check('brand: needs a word break', split_brand('Diorama lamp'), ['', 'Diorama lamp']);
check('brand: apostrophe normalized', split_brand("L'Objet ashtray"), ['L’Objet', 'ashtray']);
check('brand: from the wishlist', split_brand('Maison Nobody vase', ['Maison Nobody']), ['Maison Nobody', 'vase']);
check('name: shop suffix removed', tidy_product_name('Medusa bag | FARFETCH', 'Versace', 'Farfetch'), 'Medusa bag');
check('name: never emptied', tidy_product_name('AMIRI', 'AMIRI', 'AMIRI'), 'AMIRI');

$rows = parse_wishlist_text("Silk scarf\t$1,229\thttps://example.com/scarf\tChrome Hearts");
check('import rows: tab separated', [$rows[0]['name'], $rows[0]['price'], $rows[0]['currency'], $rows[0]['url'], $rows[0]['brand']], ['Silk scarf', 1229.0, 'USD', 'https://example.com/scarf', 'Chrome Hearts']);

/* ───── data model ───── */
$data = load_data();
check('seed: 12 items', count($data['items']), 12);
check('seed: saved on first load', is_file(data_file()), true);
check('seed: stable ids', $data['items'][0]['id'], 'i_transparent_speaker');
check('fx: euro converts', to_base(1100, 'EUR', $data['settings']), 1287.0);
check('pay: 90 minutes at $25', work_pay(90, $data['settings']), 37.5);

$tz = new DateTimeZone($data['settings']['timezone']);
$day = function (int $daysAgo, string $time = '12:00:00') use ($tz): string {
    return (new DateTimeImmutable('today ' . $time, $tz))->modify("-$daysAgo day")->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
};
$data['ledger'] = [
    ['type' => 'work', 'label' => 'Deep work', 'amount' => 50, 'minutes' => 120, 'at' => $day(0)],
    ['type' => 'task', 'label' => 'Gym', 'amount' => 15, 'at' => $day(1)],
    ['type' => 'money', 'label' => 'Invoice paid', 'amount' => 300, 'at' => $day(2)],
    ['type' => 'fine', 'label' => 'Doomscrolled', 'amount' => 10, 'at' => $day(2, '20:00:00')],
    ['type' => 'task', 'label' => 'Gym', 'amount' => 15, 'at' => $day(5)],
    ['type' => 'task', 'label' => 'Gym', 'amount' => 15, 'at' => $day(6)],
    ['type' => 'claim', 'label' => 'Claimed', 'amount' => 100, 'at' => $day(3), 'ref' => 'i_amiri_hat'],
];
$data = normalize_data($data);
check('ledger: fines negative', $data['ledger'][array_search('fine', array_column($data['ledger'], 'type'), true)]['amount'], -10.0);
check('ledger: sorted newest first', $data['ledger'][0]['label'], 'Deep work');
$stats = compute_stats($data);
check('stats: balance', $stats['balance'], 285.0);
check('stats: earned', $stats['earned'], 395.0);
check('stats: fined', $stats['fined'], 10.0);
check('stats: spent', $stats['spent'], 100.0);
check('stats: hours', $stats['hours'], 2.0);
check('stats: today', $stats['today'], 50.0);
check('stats: streak', $stats['streak'], 3);
check('stats: best streak', $stats['bestStreak'], 3);

$data['ledger'] = array_values(array_filter($data['ledger'], function ($e) {
    return $e['at'] < gmdate('Y-m-d\TH:i:s\Z', strtotime('today', time()) - 86400 * 0);
}));
$data['ledger'] = array_values(array_filter($data['ledger'], function ($e) use ($day) {
    return $e['at'] <= $day(1, '23:59:59');
}));
check('stats: streak counts from yesterday', compute_stats($data)['streak'], 2);

$views = item_views($data, 300.0);
$byId = array_column($views, null, 'id');
check('item: affordable', $byId['i_amiri_ribbed_tank']['affordable'], true);
check('item: progress', $byId['i_amiri_1994_tank']['progress'], round(300 / 350, 4));
check('item: hours to go', $byId['i_amiri_1994_tank']['hoursToGo'], 2.0);
check('goal: cheapest first', pick_goal($views, $data['settings']), 'i_lobjet_ashtray');
$settings = $data['settings'];
$settings['goalId'] = 'i_versace_sandals';
check('goal: pinned wins', pick_goal($views, $settings), 'i_versace_sandals');

$unpriced = normalize_data(['items' => [['id' => 'i_x', 'name' => 'Mystery', 'price' => 0]]]);
$v = item_views($unpriced, 50.0)[0];
check('item: missing price stays locked', [$v['affordable'], $v['priceMissing'], $v['progress']], [false, true, 0.0]);

/* ───── public view ───── */
$data['settings']['visibility'] = 'hide-amounts';
$public = public_state($data);
check('hidden: balance', $public['stats']['balance'], null);
check('hidden: price', $public['items'][0]['price'], null);
check('hidden: progress kept', is_float($public['items'][0]['progress']), true);
$bucketed = array_filter($public['items'], function ($i) {
    return $i['status'] === 'wishing' && abs($i['progress'] * 10 - round($i['progress'] * 10)) > 1e-9;
});
check('hidden: progress only in tenths', count($bucketed), 0);
check('hidden: hours to go', $public['items'][0]['hoursToGo'], null);
check('private without passcode falls back to public', normalize_settings(['visibility' => 'private'])['visibility'], 'public');
check('copy: empty falls back', normalize_settings(['copy' => ['heroIntro' => '   ']])['copy']['heroIntro'], default_settings()['copy']['heroIntro']);

/* ───── normalizing hostile input ───── */
$evil = normalize_item(['name' => "<script>x</script>\x07 Bag", 'price' => '-5', 'url' => 'javascript:alert(1)', 'image' => '../../etc/passwd', 'priority' => 99], default_settings());
check('item: price floors at 0', $evil['price'], 0.0);
check('item: javascript url dropped', $evil['url'], '');
check('item: image path traversal dropped', $evil['image'], '');
check('item: priority clamped', $evil['priority'], 3);
check('item: control chars stripped', $evil['name'], '<script>x</script> Bag');
check('entry: bad date dropped', normalize_entry(['type' => 'task', 'amount' => 5, 'at' => 'yesterday-ish']), null);
check('entry: unknown type dropped', normalize_entry(['type' => 'bribe', 'amount' => 5, 'at' => iso_now()]), null);

/* ───── damaged data file ───── */
$good = (string)file_get_contents(data_file());
save_data(load_data()); // leaves a data.json.bak
file_put_contents(data_file(), '{"items": [trunc');
$logTo = ini_set('error_log', $tmp . '/php-errors.log'); // the fallback logs a warning; keep it out of the output
check('data: damaged file falls back to the backup', count(load_data()['items']), 12);
ini_set('error_log', (string)$logTo);
check('data: damaged file left for inspection', file_get_contents(data_file()), '{"items": [trunc');
file_put_contents(data_file(), $good);

/* ───── photos ───── */
$png = function (int $w, int $h): string {
    $img = imagecreatetruecolor($w, $h);
    imagefill($img, 0, 0, imagecolorallocate($img, 200, 30, 90));
    $file = tempnam(sys_get_temp_dir(), 'findom-img');
    imagepng($img, $file);
    return $file;
};
$photoError = function (string $file, int $maxPixels = IMAGE_MAX_PIXELS): string {
    try {
        $stored = store_item_image($file, 'i_test', $maxPixels);
        delete_item_image($stored);
        return 'stored';
    } catch (RuntimeException $e) {
        return 'refused';
    }
};
$ok = $png(64, 48);
$stored = store_item_image($ok, 'i_test');
check('photo: re-encoded', (bool)preg_match('#^uploads/items/i-test-[a-f0-9]{8}\.(webp|jpg)$#', $stored), true);
check('photo: saved', is_file(uploads_dir() . '/' . substr($stored, strlen('uploads/'))), true);
delete_item_image($stored);
check('photo: deleted', is_file(uploads_dir() . '/' . substr($stored, strlen('uploads/'))), false);
check('photo: over the pixel cap', $photoError($ok, 1000), 'refused');
$tiny = $png(8, 8);
check('photo: too small', $photoError($tiny), 'refused');
$broken = $png(64, 48);
file_put_contents($broken, substr((string)file_get_contents($broken), 0, 40)); // header only: looks like a PNG, won't decode
check('photo: undecodable refused', $photoError($broken), 'refused');
$text = tempnam(sys_get_temp_dir(), 'findom-img');
file_put_contents($text, '<?php echo "hi";');
check('photo: not an image', $photoError($text), 'refused');
array_map('unlink', [$ok, $tiny, $broken, $text]);

/* ───── viewer passcode token ───── */
$hash = password_hash('open sesame', PASSWORD_DEFAULT);
$token = view_token($hash, time() + 60);
$_COOKIE[VIEW_COOKIE] = $token;
check('view: valid token', has_view_access(['visibility' => 'private', 'passcodeHash' => $hash]), true);
check('view: other passcode voids token', has_view_access(['visibility' => 'private', 'passcodeHash' => password_hash('x', PASSWORD_DEFAULT)]), false);
$_COOKIE[VIEW_COOKIE] = view_token($hash, time() - 5);
check('view: expired token', has_view_access(['visibility' => 'private', 'passcodeHash' => $hash]), false);

/* ───── clean up ───── */
foreach (['/sessions', ''] as $sub) {
    array_map('unlink', array_filter((array)glob($tmp . $sub . '/{,.}*', GLOB_BRACE), 'is_file'));
    @rmdir($tmp . $sub);
}

echo ($failures ? "\n$failures of $count checks failed.\n" : "All $count checks passed.\n");
exit($failures ? 1 : 0);
