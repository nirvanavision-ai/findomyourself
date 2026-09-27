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
check('store: short and creator links', [store_name('https://amzn.to/3x'), store_name('https://a.co/d/x'), store_name('https://go.shopmy.us/p-1'), store_name('https://liketk.it/4x'), store_name('https://bit.ly/x')], ['Amazon', 'Amazon', 'ShopMy', 'LTK', 'Bitly']);
check('store: big shops', [store_name('https://www.gucci.com/us/en/pr/x'), store_name('https://www.amazon.co.uk/dp/B08N5WRWNW'), store_name('https://www2.hm.com/en_us/x'), store_name('https://www.ulta.com/p/x')], ['Gucci', 'Amazon', 'H&M', 'Ulta Beauty']);

/* ───── links from any shop ───── */
$amazonLink = 'https://www.amazon.com/Apple-AirPods-Pro-2nd-Generation/dp/B0D1XD1ZV3/ref=sr_1_1?crid=2X&keywords=airpods&qid=1700000000&sr=8-1&tag=someone-20&th=1';
check('amazon: canonical', canonical_product_url($amazonLink), 'https://www.amazon.com/dp/B0D1XD1ZV3');
check('amazon: canonical twice', canonical_product_url(canonical_product_url($amazonLink)), 'https://www.amazon.com/dp/B0D1XD1ZV3');
check('amazon: gp/product, no www', canonical_product_url('https://amazon.co.uk/gp/product/b08n5wrwnw?psc=1&linkCode=ll1&tag=me-21&linkId=abc&ref_=as_li_ss_tl'), 'https://www.amazon.co.uk/dp/B08N5WRWNW');
check('amazon: mobile gp/aw/d', canonical_product_url('https://m.amazon.de/gp/aw/d/B0CHX1W1XY/?th=1'), 'https://www.amazon.de/dp/B0CHX1W1XY');
check('amazon: smile', canonical_product_url('https://smile.amazon.com/dp/B0CHX1W1XY?ref=x'), 'https://www.amazon.com/dp/B0CHX1W1XY');
check('amazon: search page keeps its query', canonical_product_url('https://www.amazon.com/s/ref=nb_sb_noss?k=gucci+bag&tag=x-20&ref=nb'), 'https://www.amazon.com/s?k=gucci+bag');
check('amazon: asin forms', [amazon_asin('https://www.amazon.com/exec/obidos/ASIN/0143127748/'), amazon_asin('https://www.amazon.com/gp/offer-listing?asin=b0chx1w1xy'), amazon_asin('https://www.ssense.com/product/B0CHX1W1XY')], ['0143127748', 'B0CHX1W1XY', null]);
check('amazon: short link kept as is', canonical_product_url('https://amzn.to/3XyZabc'), 'https://amzn.to/3XyZabc');
check('link: affiliate tracking stripped', canonical_product_url('https://www.shop.com/p/x?color=red&awc=123_abc&cjevent=zz&irgwc=1&sharedid=q&AFFID=9&gad_source=1&ranSiteID=x&size=m'), 'https://www.shop.com/p/x?color=red&size=m');
check('link: ebay partner params stripped', canonical_product_url('https://www.ebay.com/itm/123456789012?mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5338&customid=&toolid=10001&mkevt=1&var=55'), 'https://www.ebay.com/itm/123456789012?var=55');
check('link: unwrap keeps her parameters', unwrap_google_link(' https://www.google.com/url?sa=t&url=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB0D1XD1ZV3%3Ftag%3Dme-20%26utm_source%3Dx '), 'https://www.amazon.com/dp/B0D1XD1ZV3?tag=me-20&utm_source=x');
check('link: instagram wrapper', unwrap_google_link('https://l.instagram.com/?u=https%3A%2F%2Fshopmy.us%2Fabc&e=AT0'), 'https://shopmy.us/abc');
check('link: other sites untouched', unwrap_google_link('https://example.com/url?q=https://x.com'), 'https://example.com/url?q=https://x.com');
$names = [
    'amazon' => [$amazonLink, 'Apple AirPods Pro 2nd Generation'],
    'amazon without words' => ['https://www.amazon.co.uk/gp/product/B08N5WRWNW', ''],
    'revolve' => ['https://www.revolve.com/lovers-and-friends-kylie-dress/dp/LOVF-WD1234/?d=Womens&page=1', 'Lovers and Friends Kylie Dress'],
    'gucci' => ['https://www.gucci.com/us/en/pr/women/handbags/shoulder-bags-for-women/gucci-horsebit-1955-small-shoulder-bag-p-7001321DS1G1022', 'Gucci Horsebit 1955 Small Shoulder Bag'],
    'mytheresa' => ['https://www.mytheresa.com/us/en/women/gucci-horsebit-1955-small-leather-shoulder-bag-black-p00886524', 'Gucci Horsebit 1955 Small Leather Shoulder Bag Black'],
    'saks' => ['https://www.saksfifthavenue.com/product/gucci-horsebit-1955-shoulder-bag-0400012345678.html', 'Gucci Horsebit 1955 Shoulder Bag'],
    'neiman' => ['https://www.neimanmarcus.com/p/gucci-horsebit-1955-shoulder-bag-prod271950005?childItemId=NMY1', 'Gucci Horsebit 1955 Shoulder Bag'],
    'sephora' => ['https://www.sephora.com/product/rare-beauty-soft-pinch-liquid-blush-P97989778?skuId=2518959', 'Rare Beauty Soft Pinch Liquid Blush'],
    'zara' => ['https://www.zara.com/us/en/ribbed-knit-top-p01234567.html?v1=123456', 'Ribbed Knit Top'],
    'walmart' => ['https://www.walmart.com/ip/Apple-AirPods-Pro-2nd-Generation/1752657021?athbdg=L1600', 'Apple AirPods Pro 2nd Generation'],
    'walmart without words' => ['https://www.walmart.com/ip/1752657021', ''],
    'target' => ['https://www.target.com/p/stanley-40oz-quencher-tumbler/-/A-87654321', 'Stanley 40oz Quencher Tumbler'],
    'ebay' => ['https://www.ebay.com/itm/Vintage-Gucci-Horsebit-Bag/123456789012?hash=item1cbd', 'Vintage Gucci Horsebit Bag'],
    'ebay without words' => ['https://www.ebay.com/itm/123456789012', ''],
    'etsy' => ['https://www.etsy.com/listing/1234567890/handmade-leather-tote-bag-personalized?ref=hp_rv-1', 'Handmade Leather Tote Bag Personalized'],
    'etsy without words' => ['https://www.etsy.com/listing/1234567890', ''],
    'nike' => ['https://www.nike.com/t/air-force-1-07-mens-shoes-jBrhbr/CW2288-111', 'Air Force 1 07 Men’s Shoes'],
    'nordstrom' => ['https://www.nordstrom.com/s/zella-live-in-high-waist-leggings/5460106?color=001', 'Zella Live in High Waist Leggings'],
    'ssense' => ['https://www.ssense.com/en-us/women/product/gucci/black-horsebit-1955-shoulder-bag/15241661', 'Black Horsebit 1955 Shoulder Bag'],
    'net-a-porter' => ['https://www.net-a-porter.com/en-us/shop/product/gucci/bags/shoulder-bags/horsebit-1955-small-leather-shoulder-bag/1647597284580431', 'Horsebit 1955 Small Leather Shoulder Bag'],
    'net-a-porter without words' => ['https://www.net-a-porter.com/en-us/shop/product/gucci/1647597284580431', ''],
    'awin link names its shop' => ['https://www.awin1.com/cread.php?awinmid=6305&awinaffid=123&ued=https%3A%2F%2Fwww.farfetch.com%2Fshopping%2Fwomen%2Fgucci-horsebit-1955-bag-item-123456.aspx', 'Gucci Horsebit 1955 Bag'],
    'short links have no words' => ['https://amzn.to/3XyZabc', ''],
    'creator links have no words' => ['https://go.shopmy.us/p-12345', ''],
];
foreach ($names as $shop => [$url, $name]) {
    check('name: ' . $shop, name_from_url($url), $name);
}
check('brand: from the link', [brand_from_url($names['ssense'][0]), brand_from_url($names['net-a-porter'][0]), brand_from_url('https://www.ssense.com/en-us/women/product/chloe/tan-woody-tote/1234567')], ['Gucci', 'Gucci', 'Chloé']);
check('brand: marketplaces aren’t brands', [is_single_brand_store('https://www.amazon.com/dp/B0D1XD1ZV3'), is_single_brand_store('https://www.target.com/p/x/-/A-1'), is_single_brand_store('https://amzn.to/3x'), is_single_brand_store('https://www.gucci.com/us/en/pr/x')], [false, false, false, true]);
check('currency: amazon marketplaces', array_map('guess_store_currency', ['https://www.amazon.co.uk/dp/X', 'https://www.amazon.de/dp/X', 'https://www.amazon.ca/dp/X', 'https://www.amazon.co.jp/dp/X', 'https://www.amazon.com/dp/X']), ['GBP', 'EUR', 'CAD', 'JPY', 'USD']);

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
$amazonPage = (string)file_get_contents(__DIR__ . '/fixtures/amazon-product.html');
check('html: amazon layout', parse_product_html($amazonPage, 'https://www.amazon.com/dp/B0D1XD1ZV3'), [
    'name' => 'Apple AirPods Pro 2 Wireless Earbuds, Active Noise Cancellation', 'brand' => 'Apple', 'variant' => '',
    'price' => 249.0, 'currency' => '', 'image' => 'https://m.media-amazon.com/images/I/61SUj2aKoEL._AC_SL1500_.jpg',
]);
check('html: amazon.co.uk layout', parse_product_html(
    '<html><head><title>Amazon.co.uk: Silk Scarf : Fashion</title></head><body><span id="productTitle"> Silk Scarf </span>'
    . '<a id="bylineInfo">Brand: Chloé</a><div id="apex_desktop"><span class="a-price" data-a-strike="true"><span class="a-offscreen">£300.00</span></span>'
    . '<span class="a-price"><span class="a-offscreen">£229.00</span></span></div>'
    . '<img id="landingImage" data-a-dynamic-image="{&quot;https://m.media-amazon.com/s.jpg&quot;:[300,300],&quot;https://m.media-amazon.com/l.jpg&quot;:[900,900]}"></body></html>',
    'https://www.amazon.co.uk/dp/B08N5WRWNW'
), ['name' => 'Silk Scarf', 'brand' => 'Chloé', 'variant' => '', 'price' => 229.0, 'currency' => 'GBP', 'image' => 'https://m.media-amazon.com/l.jpg']);
check('wall: amazon captcha', is_bot_wall((string)file_get_contents(__DIR__ . '/fixtures/amazon-captcha.html')), true);
check('wall: cloudflare', is_bot_wall('<html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt={}</script></body></html>'), true);
check('wall: akamai', is_bot_wall('<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY>You don\'t have permission</BODY></HTML>'), true);
check('wall: perimeterx', is_bot_wall('<html><body><div id="px-captcha"></div></body></html>'), true);
check('wall: datadome', is_bot_wall('<html><body><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=x"></iframe></body></html>'), true);
check('wall: a product page isn’t one', is_bot_wall($amazonPage), false);
check('wall: a page with cloudflare’s script isn’t one', is_bot_wall('<html><head><title>Bag</title></head><body><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></body></html>'), false);

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

$awinLink = 'https://www.awin1.com/cread.php?awinmid=6305&awinaffid=123456&clickref=wish&ued=https%3A%2F%2Fwww.farfetch.com%2Fshopping%2Fwomen%2Fgucci-horsebit-1955-bag-item-123456.aspx%3Futm_source%3Dx';
$mine = parse_wishlist_text("AirPods Pro – $249 – $amazonLink\n$awinLink\nGucci loafers, 890, https://go.shopmy.us/p-12345\nhttps://www.amazon.co.uk/gp/product/B08N5WRWNW?psc=1\nhttps://amzn.to/3XyZabc\nhttps://bit.ly/3abcDEF");
$pick = function (array $item): array {
    return [$item['name'], $item['url'], $item['affiliateUrl']];
};
check('import mine: amazon with a tag', $pick($mine[0]), ['AirPods Pro', 'https://www.amazon.com/dp/B0D1XD1ZV3', $amazonLink]);
check('import mine: awin keeps her link, shop link inside', $pick($mine[1]), ['Horsebit 1955 Bag', 'https://www.farfetch.com/shopping/women/gucci-horsebit-1955-bag-item-123456.aspx', $awinLink]);
check('import mine: awin brand', $mine[1]['brand'], 'Gucci');
check('import mine: shopmy', $pick($mine[2]), ['loafers', 'https://go.shopmy.us/p-12345', 'https://go.shopmy.us/p-12345']);
check('import mine: bare amazon link named', $pick($mine[3]), ['Amazon find', 'https://www.amazon.co.uk/dp/B08N5WRWNW', '']);
check('import mine: amazon short link', $pick($mine[4]), ['Amazon find', 'https://amzn.to/3XyZabc', 'https://amzn.to/3XyZabc']);
check('import mine: a plain short link isn’t her link', $pick($mine[5])[2], '');

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
unset($_COOKIE[VIEW_COOKIE]);

/* ───── affiliate settings ───── */
check('affiliate: defaults', normalize_settings([])['affiliate'], ['enabled' => true, 'amazon' => [], 'network' => 'none', 'networkId' => '', 'rules' => [], 'exclude' => []]);
check('affiliate: switched off', normalize_settings(['affiliate' => ['enabled' => false]])['affiliate']['enabled'], false);
$aff = normalize_affiliate([
    'amazon' => ['com' => ' fin-20 ', 'co.uk' => 'bad tag!', 'xx' => 'fin-20', 'de' => '', 'fr' => '-starts-badly'],
    'network' => 'skimlinks', 'networkId' => '123456x1234567',
    'rules' => [
        ['label' => '', 'domains' => ['https://www.Farfetch.com/shopping', 'junk domain', 'farfetch.com'], 'mode' => 'wrap', 'value' => 'https://www.awin1.com/cread.php?awinmid=6597&awinaffid=123456&ued={url}'],
        ['label' => 'Over http', 'domains' => ['x.com'], 'mode' => 'wrap', 'value' => 'http://www.awin1.com/cread.php?ued={url}'],
        ['label' => 'No placeholder', 'domains' => ['y.com'], 'mode' => 'wrap', 'value' => 'https://www.awin1.com/cread.php?ued=x'],
        ['label' => 'Two placeholders', 'domains' => ['y.com'], 'mode' => 'wrap', 'value' => 'https://a.com/?u={url}&v={url}'],
        ['label' => 'Placeholder as the host', 'domains' => ['y.com'], 'mode' => 'wrap', 'value' => 'https://{url}/x'],
        ['label' => '', 'domains' => ['amiri.com'], 'mode' => 'params', 'value' => '?sca_ref=123.abc&utm_source=me'],
        ['label' => 'Params with a placeholder', 'domains' => ['z.com'], 'mode' => 'params', 'value' => 'a={url}'],
        ['label' => 'Junk domains only', 'domains' => ['..', 'not a domain'], 'mode' => 'params', 'value' => 'a=1'],
        ['label' => 'Unknown mode', 'domains' => ['z.com'], 'mode' => 'eval', 'value' => 'a=1'],
        'not a rule',
    ],
    'exclude' => "https://www.Hermes.com/us/en/\nnot a domain, gucci.com gucci.com",
]);
check('affiliate: amazon tags, bad ones dropped', $aff['amazon'], ['com' => 'fin-20']);
check('affiliate: skimlinks id', [$aff['network'], $aff['networkId']], ['skimlinks', '123456X1234567']);
check('affiliate: bad skimlinks id turns it off', array_intersect_key(normalize_affiliate(['network' => 'skimlinks', 'networkId' => '12345']), ['network' => 1, 'networkId' => 1]), ['network' => 'none', 'networkId' => '']);
check('affiliate: sovrn key', array_intersect_key(normalize_affiliate(['network' => 'sovrn', 'networkId' => str_repeat('AB12', 8)]), ['network' => 1, 'networkId' => 1]), ['network' => 'sovrn', 'networkId' => str_repeat('ab12', 8)]);
check('affiliate: skimlinks id is not a sovrn key', normalize_affiliate(['network' => 'sovrn', 'networkId' => '123456X1234567'])['network'], 'none');
check('affiliate: unknown network', normalize_affiliate(['network' => 'evil', 'networkId' => '123456X1234567'])['network'], 'none');
check('affiliate: only working rules kept', array_column($aff['rules'], 'label'), ['Awin · farfetch.com', 'amiri.com']);
check('affiliate: rule domains cleaned', $aff['rules'][0]['domains'], ['farfetch.com']);
check('affiliate: rule id', (bool)preg_match('/^r_[a-z0-9]{10}$/', $aff['rules'][0]['id']), true);
check('affiliate: params rebuilt', $aff['rules'][1]['value'], 'sca_ref=123.abc&utm_source=me');
check('affiliate: exclude cleaned', $aff['exclude'], ['hermes.com', 'gucci.com']);
$many = normalize_affiliate(['rules' => array_fill(0, 40, ['domains' => ['a.com'], 'mode' => 'params', 'value' => 'a=1'])])['rules'];
check('affiliate: 30 rules at most, each its own id', [count($many), count(array_unique(array_column($many, 'id')))], [30, 30]);
check('affiliate: long label cut', mb_strlen(normalize_affiliate_rule(['label' => str_repeat('x', 90), 'domains' => ['a.com'], 'mode' => 'params', 'value' => 'a=1'])['label']), 60);
check('item: her link kept exactly', normalize_item(['name' => 'x', 'affiliateUrl' => ' https://www.awin1.com/cread.php?awinmid=1&ued=https%3A%2F%2Fa.com&utm_source=me '], default_settings())['affiliateUrl'], 'https://www.awin1.com/cread.php?awinmid=1&ued=https%3A%2F%2Fa.com&utm_source=me');
check('item: her link must be a web link', [normalize_item(['name' => 'x', 'affiliateUrl' => 'javascript:alert(1)'], default_settings())['affiliateUrl'], normalize_item(['name' => 'x'], default_settings())['affiliateUrl']], ['', '']);

/* ───── where a visitor's button goes ───── */
$settings = default_settings();
$settings['affiliate'] = normalize_affiliate([
    'amazon' => ['com' => 'fin-20', 'de' => 'fin-21', 'co.uk' => 'fin-21'],
    'network' => 'skimlinks', 'networkId' => '123456X1234567',
    'rules' => [
        ['domains' => ['farfetch.com'], 'mode' => 'wrap', 'value' => 'https://www.awin1.com/cread.php?awinmid=6597&awinaffid=123456&ued={url}'],
        ['domains' => ['amazon.de'], 'mode' => 'wrap', 'value' => 'https://track.example.com/c?url={url}'],
        ['domains' => ['amiri.com'], 'mode' => 'params', 'value' => 'sca_ref=123.abc'],
    ],
    'exclude' => ['hermes.com', 'amazon.co.uk'],
]);
$out = function (array $item) use (&$settings): array {
    return resolve_outbound($item + ['id' => 'i_test', 'url' => '', 'affiliateUrl' => ''], $settings);
};
check('out: her own link wins', $out(['url' => 'https://www.amazon.com/dp/B08N5WRWNW', 'affiliateUrl' => 'https://go.shopmy.us/p-123']), ['url' => 'https://go.shopmy.us/p-123', 'kind' => 'mine', 'label' => 'Your link (ShopMy)', 'affiliate' => true, 'amazon' => false]);
check('out: her amazon short link', $out(['affiliateUrl' => 'https://amzn.to/3abc']), ['url' => 'https://amzn.to/3abc', 'kind' => 'mine', 'label' => 'Your link (Amazon)', 'affiliate' => true, 'amazon' => true]);
check('out: her plain short link', $out(['affiliateUrl' => 'https://bit.ly/x'])['label'], 'Your link');
check('out: excluded shop stays plain', $out(['url' => 'https://shop.hermes.com/us/en/product/x']), ['url' => 'https://shop.hermes.com/us/en/product/x', 'kind' => 'plain', 'label' => 'Plain link', 'affiliate' => false, 'amazon' => false]);
check('out: excluded beats amazon', $out(['url' => 'https://www.amazon.co.uk/dp/B08N5WRWNW'])['kind'], 'plain');
check('out: amazon, short form with her tag', $out(['url' => $amazonLink]), ['url' => 'https://www.amazon.com/dp/B0D1XD1ZV3?tag=fin-20', 'kind' => 'amazon', 'label' => 'Amazon Associates · fin-20', 'affiliate' => true, 'amazon' => true]);
check('out: amazon beats a rule', $out(['url' => 'https://www.amazon.de/dp/B08N5WRWNW'])['url'], 'https://www.amazon.de/dp/B08N5WRWNW?tag=fin-21');
check('out: amazon without a product code: tag replaced', $out(['url' => 'https://www.amazon.com/s?k=gucci+bag&tag=old-20#top'])['url'], 'https://www.amazon.com/s?k=gucci+bag&tag=fin-20#top');
check('out: amazon without her tag is never networked', $out(['url' => 'https://www.amazon.fr/dp/B08N5WRWNW']), ['url' => 'https://www.amazon.fr/dp/B08N5WRWNW', 'kind' => 'plain', 'label' => 'Plain link', 'affiliate' => false, 'amazon' => false]);
check('out: unlisted amazon store never networked', $out(['url' => 'https://www.amazon.cn/dp/B08N5WRWNW'])['kind'], 'plain');
check('out: rule (deep link)', $out(['url' => 'https://www.farfetch.com/shopping/x-item-1.aspx?size=2']), ['url' => 'https://www.awin1.com/cread.php?awinmid=6597&awinaffid=123456&ued=https%3A%2F%2Fwww.farfetch.com%2Fshopping%2Fx-item-1.aspx%3Fsize%3D2', 'kind' => 'rule', 'label' => 'Awin · farfetch.com', 'affiliate' => true, 'amazon' => false]);
check('out: rule (parameters)', $out(['url' => 'https://amiri.com/products/x?variant=1&sca_ref=old'])['url'], 'https://amiri.com/products/x?variant=1&sca_ref=123.abc');
check('out: skimlinks', $out(['url' => 'https://www.ssense.com/en-us/women/product/x/123?a=1&b=2']), ['url' => 'https://go.skimresources.com/?id=123456X1234567&xs=1&url=https%3A%2F%2Fwww.ssense.com%2Fen-us%2Fwomen%2Fproduct%2Fx%2F123%3Fa%3D1%26b%3D2&xcust=i_test', 'kind' => 'network', 'label' => 'Skimlinks', 'affiliate' => true, 'amazon' => false]);
$configured = $settings;
$settings['affiliate']['network'] = 'sovrn';
$settings['affiliate']['networkId'] = str_repeat('ab12', 8);
check('out: sovrn', $out(['url' => 'https://x.com/p q?a=1']), ['url' => 'https://redirect.viglink.com/?key=' . str_repeat('ab12', 8) . '&u=https%3A%2F%2Fx.com%2Fp%20q%3Fa%3D1&cuid=i_test', 'kind' => 'network', 'label' => 'Sovrn Commerce', 'affiliate' => true, 'amazon' => false]);
$settings['affiliate']['network'] = 'none';
check('out: no network → plain', $out(['url' => 'https://www.ssense.com/x']), ['url' => 'https://www.ssense.com/x', 'kind' => 'plain', 'label' => 'Plain link', 'affiliate' => false, 'amazon' => false]);
check('out: no link at all', $out([]), ['url' => '', 'kind' => 'none', 'label' => 'No link', 'affiliate' => false, 'amazon' => false]);
$settings['affiliate']['enabled'] = false;
check('out: switched off → plain', [$out(['url' => 'https://www.farfetch.com/x'])['kind'], $out(['url' => 'https://www.amazon.com/dp/B08N5WRWNW'])['url']], ['plain', 'https://www.amazon.com/dp/B08N5WRWNW']);
check('out: switched off keeps her own link', $out(['url' => 'https://www.farfetch.com/x', 'affiliateUrl' => 'https://rstyle.me/+abc'])['kind'], 'mine');
$settings = $configured;
check('out: an affiliate shop link isn’t wrapped again', $out(['url' => $awinLink]), ['url' => $awinLink, 'kind' => 'mine', 'label' => 'Affiliate link (Awin)', 'affiliate' => true, 'amazon' => false]);
check('out: a creator shop link isn’t wrapped again', $out(['url' => 'https://go.shopmy.us/p-12345'])['url'], 'https://go.shopmy.us/p-12345');
check('out: someone’s amazon tag, none of hers', $out(['url' => 'https://www.amazon.it/dp/B08N5WRWNW?tag=me-21']), ['url' => 'https://www.amazon.it/dp/B08N5WRWNW?tag=me-21', 'kind' => 'mine', 'label' => 'Affiliate link (Amazon Associates)', 'affiliate' => true, 'amazon' => true]);
check('out: a plain short link can still go through the network', $out(['url' => 'https://bit.ly/abc'])['kind'], 'network');

/* ───── recognizing affiliate links ───── */
$detect = function (string $url): ?array {
    $found = detect_affiliate_link($url);
    return $found ? [$found['network'], $found['kind'], $found['destination'], $found['param'], $found['id'], $found['marketplace']] : null;
};
check('detect: shop link', $detect('https://www.farfetch.com/shopping/x.aspx'), null);
check('detect: amazon without a tag', $detect('https://www.amazon.com/dp/B08N5WRWNW'), null);
check('detect: amazon associates', $detect('https://www.amazon.co.uk/Thing/dp/B08N5WRWNW/ref=sr_1?tag=me-21&linkCode=ll1'), ['Amazon Associates', 'amazon', 'https://www.amazon.co.uk/dp/B08N5WRWNW', '', 'me-21', 'co.uk']);
foreach (['amzn.to/3xYz', 'amzn.eu/d/abc', 'amzn.asia/d/abc', 'a.co/d/abc'] as $short) {
    check('detect: ' . $short, $detect('https://' . $short), ['Amazon (short link)', 'short', '', '', '', '']);
}
check('detect: skimlinks', $detect('https://go.skimresources.com/?id=123X456&xs=1&url=https%3A%2F%2Fwww.net-a-porter.com%2Fp%2F1'), ['Skimlinks', 'wrapper', 'https://www.net-a-porter.com/p/1', 'url', '123X456', '']);
check('detect: sovrn', $detect('https://redirect.viglink.com/?key=' . str_repeat('ab', 16) . '&u=https%3A%2F%2Fshop.com%2Fa'), ['Sovrn', 'wrapper', 'https://shop.com/a', 'u', str_repeat('ab', 16), '']);
check('detect: awin', $detect('https://www.awin1.com/cread.php?awinmid=6597&awinaffid=123456&ued=https%3A%2F%2Fwww.farfetch.com%2Fshopping%2Fx-item-1.aspx'), ['Awin', 'wrapper', 'https://www.farfetch.com/shopping/x-item-1.aspx', 'ued', '123456', '']);
check('detect: awin p=', $detect('https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&p=https%3A%2F%2Fshop.com%2Fx')[2] ?? null, 'https://shop.com/x');
check('detect: encoded twice', $detect('https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued=https%253A%252F%252Fshop.com%252Fx')[2] ?? null, 'https://shop.com/x');
check('detect: rakuten', $detect('https://click.linksynergy.com/deeplink?id=AbC&mid=123&murl=https%3A%2F%2Fwww.nordstrom.com%2Fs%2Fx%2F1'), ['Rakuten', 'wrapper', 'https://www.nordstrom.com/s/x/1', 'murl', 'AbC', '']);
foreach (['anrdoezrs.net', 'jdoqocy.com', 'tkqlhce.com', 'dpbolvw.net', 'kqzyfj.com', 'qksrv.net', 'emjcd.com', 'ftjcfx.com', 'lduhtrp.net', 'tqlkg.com', 'awltovhc.com', 'yceml.net'] as $cj) {
    check('detect: cj ' . $cj, $detect('https://www.' . $cj . '/click-1234567-7654321?url=https%3A%2F%2Fwww.saksfifthavenue.com%2Fp'), ['CJ', 'wrapper', 'https://www.saksfifthavenue.com/p', 'url', '1234567', '']);
}
foreach (['sjv.io', 'pxf.io', 'evyy.net', 'ojrq.net', '7eer.net'] as $impact) {
    check('detect: impact ' . $impact, $detect('https://ssense.' . $impact . '/c/111/222/333?u=https%3A%2F%2Fwww.ssense.com%2Fx'), ['Impact', 'wrapper', 'https://www.ssense.com/x', 'u', '111', '']);
}
check('detect: impact on a brand’s domain', $detect('https://goto.target.com/c/111/222/333?u=https%3A%2F%2Fwww.target.com%2Fp%2Fx'), ['Impact', 'wrapper', 'https://www.target.com/p/x', 'u', '111', '']);
check('detect: shop path that only looks like impact', $detect('https://shop.com/c/111/222/333'), null);
check('detect: partnerize', $detect('https://prf.hn/click/camref:1100l3Bx/pubref:me/destination:https%3A%2F%2Fwww.mytheresa.com%2Fen-us%2Fx-p00886524.html'), ['Partnerize', 'wrapper', 'https://www.mytheresa.com/en-us/x-p00886524.html', '', '1100l3Bx', '']);
check('detect: shareasale', $detect('https://shareasale.com/r.cfm?b=1&u=2468&m=3&urllink=www.shop.com%2Fp%2F1&afftrack='), ['ShareASale', 'wrapper', 'https://www.shop.com/p/1', 'urllink', '2468', '']);
foreach (['pjtra.com', 'pjatr.com', 'gopjn.com'] as $pj) {
    check('detect: pepperjam ' . $pj, $detect('https://www.' . $pj . '/t/abc?url=https%3A%2F%2Fshop.com%2Fa')[0] ?? null, 'Pepperjam');
}
check('detect: flexoffers', $detect('https://track.flexlinkspro.com/g.ashx?foid=1.2&url=https%3A%2F%2Fshop.com%2Fa')[0] ?? null, 'FlexOffers');
check('detect: ebay partner network', $detect('https://www.ebay.com/itm/Vintage-Gucci-Bag/123456789012?mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5338123456&customid=wish&toolid=10001&mkevt=1'), ['eBay Partner Network', 'wrapper', 'https://www.ebay.com/itm/Vintage-Gucci-Bag/123456789012', '', '5338123456', '']);
check('detect: plain ebay', $detect('https://www.ebay.com/itm/123456789012?hash=x'), null);
$creators = ['shopmy.us/x' => 'ShopMy', 'go.shopmy.us/p-12345' => 'ShopMy', 'shop-links.co/123' => 'ShopMy', 'liketk.it/4abc' => 'LTK',
    'shopltk.com/explore/x' => 'LTK', 'rstyle.me/+abc' => 'LTK', 'howl.me/abc' => 'Howl', 'howl.link/abc' => 'Howl', 'geni.us/abc' => 'Geniuslink'];
foreach ($creators as $link => $network) {
    check('detect: ' . $link, $detect('https://' . $link), [$network, 'creator', '', '', '', '']);
}
foreach (['bit.ly', 'tinyurl.com', 't.co', 'ow.ly', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'lnk.to'] as $shortener) {
    check('detect: ' . $shortener, $detect('https://' . $shortener . '/abc'), ['Short link', 'short', '', '', '', '']);
}
check('detect: unknown network', $detect('https://track.example-network.com/click?pid=1&dest=https%3A%2F%2Fwww.gucci.com%2Fus%2Fen%2Fpr%2Fx'), ['Affiliate network', 'wrapper', 'https://www.gucci.com/us/en/pr/x', 'dest', '', '']);
check('detect: same-site redirect isn’t one', $detect('https://www.shop.com/login?redirect=https%3A%2F%2Fshop.com%2Fcart'), null);
check('detect: javascript inside', $detect('https://www.awin1.com/cread.php?ued=javascript%3Aalert(1)')[2] ?? null, '');
check('detect: not a link', $detect('hello'), null);

/* ───── learning from one of her links ───── */
$learned = learn_affiliate_link('https://www.awin1.com/cread.php?awinmid=6597&awinaffid=123456&clickref=abc&ued=https%3A%2F%2Fwww.farfetch.com%2Fshopping%2Fx-item-1.aspx#frag');
check('learn: awin rule', $learned, ['network' => 'Awin', 'domain' => 'farfetch.com', 'rule' => ['label' => 'Awin · farfetch.com', 'domains' => ['farfetch.com'], 'mode' => 'wrap', 'value' => 'https://www.awin1.com/cread.php?awinmid=6597&awinaffid=123456&clickref=abc&ued={url}']]);
$roundTrip = function (string $link, string $product) {
    $learned = learn_affiliate_link($link);
    $found = $learned ? detect_affiliate_link(apply_rule($learned['rule'], $product)) : null;
    return $found ? $found['destination'] : null;
};
check('learn: awin round trip', $roundTrip('https://www.awin1.com/cread.php?awinmid=6597&awinaffid=123456&ued=https%3A%2F%2Fwww.farfetch.com%2Fa', 'https://www.farfetch.com/y?size=2&c=1'), 'https://www.farfetch.com/y?size=2&c=1');
check('learn: rakuten round trip', $roundTrip('https://click.linksynergy.com/deeplink?id=AbC&mid=123&murl=https%3A%2F%2Fwww.nordstrom.com%2Fs%2Fx%2F1', 'https://www.nordstrom.com/s/y/2'), 'https://www.nordstrom.com/s/y/2');
check('learn: cj round trip', $roundTrip('https://www.anrdoezrs.net/click-1-2?url=https%3A%2F%2Fwww.saks.com%2Fp', 'https://www.saks.com/q'), 'https://www.saks.com/q');
check('learn: impact round trip', $roundTrip('https://ssense.sjv.io/c/111/222/333?u=https%3A%2F%2Fwww.ssense.com%2Fx&subId1=wish', 'https://www.ssense.com/y'), 'https://www.ssense.com/y');
check('learn: partnerize round trip', $roundTrip('https://prf.hn/click/camref:1100l3Bx/destination:https%3A%2F%2Fwww.mytheresa.com%2Fx', 'https://www.mytheresa.com/y?z=1'), 'https://www.mytheresa.com/y?z=1');
check('learn: shareasale round trip', $roundTrip('https://shareasale.com/r.cfm?b=1&u=2468&m=3&urllink=www.shop.com%2Fp%2F1', 'https://www.shop.com/q'), 'https://www.shop.com/q');
check('learn: http upgraded', learn_affiliate_link('http://www.anrdoezrs.net/click-1-2?url=https%3A%2F%2Fwww.saks.com%2Fp')['rule']['value'] ?? null, 'https://www.anrdoezrs.net/click-1-2?url={url}');
$ebay = learn_affiliate_link('https://www.ebay.com/itm/123456789012?mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5338123456&customid=wish&toolid=10001&mkevt=1');
check('learn: ebay parameters', $ebay['rule'] ?? null, ['label' => 'eBay Partner Network · ebay.com', 'domains' => ['ebay.com'], 'mode' => 'params', 'value' => 'mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5338123456&toolid=10001&mkevt=1']);
check('learn: ebay round trip', detect_affiliate_link(apply_rule($ebay['rule'], 'https://www.ebay.com/itm/999?var=5'))['destination'] ?? null, 'https://www.ebay.com/itm/999?var=5');
check('learn: amazon tag', learn_affiliate_link('https://www.amazon.com/dp/B08N5WRWNW?tag=me-20'), ['network' => 'Amazon Associates', 'domain' => 'amazon.com', 'amazon' => ['com' => 'me-20']]);
check('learn: skimlinks catch-all', learn_affiliate_link('https://go.skimresources.com/?id=123x456&url=https%3A%2F%2Fa.com%2F'), ['network' => 'Skimlinks', 'domain' => '', 'catchAll' => ['network' => 'skimlinks', 'networkId' => '123X456']]);
check('learn: nothing from creator, short or amazon-bound links', [learn_affiliate_link('https://go.shopmy.us/p-1'), learn_affiliate_link('https://bit.ly/x'), learn_affiliate_link('https://amzn.to/x'), learn_affiliate_link('https://track.x.com/c?url=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB08N5WRWNW')], [null, null, null, null]);
$a = $settings['affiliate'];
check('learn: new only when it changes something', [
    affiliate_suggestion_is_new($learned, $a), affiliate_suggestion_is_new(['domain' => 'ssense.com', 'rule' => []], $a),
    affiliate_suggestion_is_new(['domain' => 'hermes.com', 'rule' => []], $a), affiliate_suggestion_is_new(['amazon' => ['com' => 'x-20']], $a),
    affiliate_suggestion_is_new(['amazon' => ['fr' => 'x-21']], $a), affiliate_suggestion_is_new(['catchAll' => []], $a),
], [false, true, false, false, true, false]);
$taught = normalize_affiliate(apply_learned_link($a, learn_affiliate_link('https://www.anrdoezrs.net/click-1-2?url=https%3A%2F%2Fwww.farfetch.com%2Fp')));
check('learn: a shop’s new rule replaces its old one', array_column($taught['rules'], 'label'), ['amazon.de', 'amiri.com', 'CJ · farfetch.com']);
check('learn: amazon tag added', normalize_affiliate(apply_learned_link($a, ['amazon' => ['fr' => 'fin-21']]))['amazon'], ['com' => 'fin-20', 'co.uk' => 'fin-21', 'de' => 'fin-21', 'fr' => 'fin-21']);
check('redundant: her own amazon tag', affiliate_link_redundant(detect_affiliate_link('https://www.amazon.com/dp/B08N5WRWNW?tag=fin-20'), $a), true);
check('redundant: someone else’s tag', affiliate_link_redundant(detect_affiliate_link('https://www.amazon.com/dp/B08N5WRWNW?tag=other-20'), $a), false);
check('redundant: her own skimlinks id', affiliate_link_redundant(detect_affiliate_link('https://go.skimresources.com/?id=123456X1234567&url=https%3A%2F%2Fa.com%2F'), $a), true);

/* ───── the public page's links ───── */
$site = load_data();
$plain = public_state($site);
check('public: items carry link, not url', [array_key_exists('url', $plain['items'][0]), $plain['items'][0]['link'], $plain['items'][0]['affiliate']], [false, $site['items'][0]['url'], false]);
check('public: no disclosure without affiliate links', [$plain['settings']['affiliateNote'], $plain['settings']['copy']['affiliateNote']], ['', '']);
$site['settings']['affiliate'] = normalize_affiliate(['network' => 'skimlinks', 'networkId' => '123456X1234567', 'exclude' => ['amiri.com']]);
$pub = array_column(public_state($site)['items'], null, 'id');
check('public: farfetch through skimlinks', [(bool)preg_match('#^https://go\.skimresources\.com/\?id=123456X1234567&xs=1&url=https%3A%2F%2Fwww\.farfetch\.com%2F.+&xcust=i_versace_ashtray$#', $pub['i_versace_ashtray']['link']), $pub['i_versace_ashtray']['affiliate'], $pub['i_versace_ashtray']['store']], [true, true, 'Farfetch']);
check('public: excluded shop plain', [$pub['i_amiri_hat']['link'], $pub['i_amiri_hat']['affiliate']], ['https://amiri.com/products/arts-district-canvas-hat-sapphire', false]);
$note = default_settings()['copy']['affiliateNote'];
$state = public_state($site);
check('public: disclosure', [$state['settings']['affiliateNote'], $state['settings']['copy']['affiliateNote']], [$note, $note]);
$hat = array_search('i_amiri_hat', array_column($site['items'], 'id'), true);
$site['items'][$hat]['affiliateUrl'] = 'https://amzn.to/3XyZabc';
$pub = array_column(public_state($site)['items'], null, 'id');
check('public: her link beats the never list', [$pub['i_amiri_hat']['link'], $pub['i_amiri_hat']['affiliate'], $pub['i_amiri_hat']['store']], ['https://amzn.to/3XyZabc', true, 'AMIRI']);
check('public: amazon sentence added', public_state($site)['settings']['affiliateNote'], $note . ' ' . AMAZON_SENTENCE);
$site['settings']['visibility'] = 'hide-amounts';
check('public: links shown with amounts hidden', array_column(public_state($site)['items'], null, 'id')['i_amiri_hat']['link'], 'https://amzn.to/3XyZabc');
$site['items'][$hat]['status'] = 'archived';
check('public: archived items don’t count', public_state($site)['settings']['affiliateNote'], $note);
$site['items'][$hat]['status'] = 'wishing';
$site['settings']['copy']['affiliateNote'] = 'As an Amazon Associate I earn from qualifying purchases, and so do my other shops.';
check('public: amazon sentence never doubled', public_state($site)['settings']['affiliateNote'], $site['settings']['copy']['affiliateNote']);
$site['settings']['affiliate']['enabled'] = false;
$site['items'][$hat]['affiliateUrl'] = '';
check('public: all off, no disclosure', public_state($site)['settings']['affiliateNote'], '');

/* ───── clicks on shop buttons ───── */
$tzName = 'America/Los_Angeles';
$noon = (new DateTimeImmutable('today 12:00:00', new DateTimeZone($tzName)))->getTimestamp();
$_SERVER['REMOTE_ADDR'] = '203.0.113.20';
$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
check('click: counts', count_click('i_amiri_hat', $tzName, $noon), true);
check('click: once per visitor, item and day', count_click('i_amiri_hat', $tzName, $noon + 3600), false);
check('click: another item counts', count_click('i_amiri_polo', $tzName, $noon + 60), true);
check('click: counts again the next day', count_click('i_amiri_hat', $tzName, $noon + 86400), true);
$_SERVER['REMOTE_ADDR'] = '203.0.113.21';
check('click: another visitor counts', count_click('i_amiri_hat', $tzName, $noon + 86400), true);
$before = (string)file_get_contents(clicks_file());
$bots = ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'facebookexternalhit/1.1', 'WhatsApp/2.23.20',
    'TelegramBot (like TwitterBot)', 'Discordbot/2.0', 'curl/8.4.0', 'python-requests/2.31', 'Mozilla/5.0 HeadlessChrome/120.0', ''];
$counted = 0;
foreach ($bots as $agent) {
    $_SERVER['HTTP_USER_AGENT'] = $agent;
    $counted += count_click('i_amiri_skirt', $tzName, $noon + 86400) ? 1 : 0;
}
check('click: bots and link previews never count', $counted, 0);
$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15';
check('click: bad id', count_click('../data', $tzName, $noon), false);
check('click: nothing written when nothing counted', file_get_contents(clicks_file()), $before);
$_SERVER['REMOTE_ADDR'] = '203.0.113.22';
$counted = 0;
for ($i = 0; $i < 70; $i++) {
    $counted += count_click('i_rate_' . $i, $tzName, $noon + 2 * 86400 + $i) ? 1 : 0;
}
check('click: at most 60 per visitor per 10 minutes', $counted, 60);
check('click: the window moves on', count_click('i_rate_70', $tzName, $noon + 2 * 86400 + CLICK_WINDOW + 30), true);
$clicks = load_clicks();
$dayKey = function (int $days) use ($noon, $tzName): string {
    return local_day($noon + $days * 86400, new DateTimeZone($tzName));
};
check('click: only today and yesterday remembered', array_keys($clicks['seen']), [$dayKey(1), $dayKey(2)]);
check('click: summary', array_intersect_key(click_summary($clicks, 'i_amiri_hat', $tzName), ['total' => 1, 'week' => 1]), ['total' => 3, 'week' => 3]);
check('click: summary of an unclicked item', click_summary($clicks, 'i_nope', $tzName), ['total' => 0, 'week' => 0, 'last' => null]);
check('click: no address stored', strpos((string)file_get_contents(clicks_file()), '203.0.113') === false, true);
check('click: counts kept 90 days', [count_click('i_amiri_hat', $tzName, $noon + 100 * 86400), array_keys(load_clicks()['items']['i_amiri_hat']['days']), load_clicks()['items']['i_amiri_hat']['total']], [true, [$dayKey(100)], 4]);
unset($_SERVER['REMOTE_ADDR'], $_SERVER['HTTP_USER_AGENT']);

/* ───── clean up ───── */
foreach (['/sessions', ''] as $sub) {
    array_map('unlink', array_filter((array)glob($tmp . $sub . '/{,.}*', GLOB_BRACE), 'is_file'));
    @rmdir($tmp . $sub);
}

echo ($failures ? "\n$failures of $count checks failed.\n" : "All $count checks passed.\n");
exit($failures ? 1 : 0);
