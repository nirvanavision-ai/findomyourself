<?php
/*
 * FINDOM YOURSELF: fetching things from other sites, safely.
 *
 * Used by the admin to turn a pasted product link into a wishlist item (name, brand,
 * price, photo) and to refresh currency rates. Every request goes through
 * safe_request(), which only talks to public internet addresses: the host is resolved
 * first, private/loopback/metadata addresses are refused, the connection is pinned to
 * the checked address, and every redirect is checked the same way.
 */
declare(strict_types=1);

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/store.php';

const FETCH_TIMEOUT = 10;
const FETCH_MAX_REDIRECTS = 8; // creator and affiliate links hop through a few trackers before the shop
const FETCH_HTML_MAX = 5 * 1024 * 1024;
const FETCH_IMAGE_MAX = 15 * 1024 * 1024;
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';

/* ───────────────────────── safe HTTP ───────────────────────── */

function is_public_ip(string $ip): bool
{
    $flags = FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE;
    if (defined('FILTER_FLAG_GLOBAL_RANGE')) {
        $flags |= FILTER_FLAG_GLOBAL_RANGE;
    }
    if (!filter_var($ip, FILTER_VALIDATE_IP, $flags)) {
        return false;
    }
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        $long = ip2long($ip);
        $blocked = [ // ranges older PHP versions don't know about
            ['100.64.0.0', 10], ['192.0.0.0', 24], ['192.0.2.0', 24], ['198.18.0.0', 15],
            ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
        ];
        foreach ($blocked as [$net, $bits]) {
            $mask = -1 << (32 - $bits);
            if (($long & $mask) === (ip2long($net) & $mask)) {
                return false;
            }
        }
        return true;
    }
    $packed = inet_pton($ip);
    if ($packed === false || strlen($packed) !== 16) {
        return false;
    }
    // IPv6: only global unicast (2000::/3), minus ranges that aren't really out on the internet:
    // Teredo 2001::/32, benchmarking 2001:2::/48, ORCHIDv2 2001:20::/28, documentation 2001:db8::/32
    // and 3fff::/20, and 6to4 2002::/16 (which can wrap a private IPv4 address).
    if ((ord($packed[0]) & 0xe0) !== 0x20) {
        return false;
    }
    $hex = bin2hex($packed);
    foreach (['20010000', '200100020000', '2001002', '20010db8', '3fff0', '2002'] as $prefix) {
        if (strncmp($hex, $prefix, strlen($prefix)) === 0) {
            return false;
        }
    }
    return true;
}

/** A public address for $host, or null. Refuses the host if any of its addresses is private. */
function public_ip_for(string $host): ?string
{
    $host = trim($host, '[]');
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        return is_public_ip($host) ? $host : null;
    }
    if (!preg_match('/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i', $host)) {
        return null;
    }
    $ips = @gethostbynamel($host) ?: [];
    if (function_exists('dns_get_record')) {
        foreach ((array)@dns_get_record($host, DNS_AAAA) as $record) {
            if (!empty($record['ipv6'])) {
                $ips[] = $record['ipv6'];
            }
        }
    }
    if (!$ips) {
        return null;
    }
    foreach ($ips as $ip) {
        if (!is_public_ip($ip)) {
            return null;
        }
    }
    foreach ($ips as $ip) { // prefer IPv4: shared hosts often have no IPv6 route
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            return $ip;
        }
    }
    return $ips[0];
}

/** Resolves a (possibly relative) link against the page it appeared on. */
function resolve_url(string $base, string $ref): string
{
    $ref = trim(html_entity_decode($ref, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    if ($ref === '') {
        return '';
    }
    if (preg_match('#^https?://#i', $ref)) {
        return $ref;
    }
    $b = parse_url($base);
    if (!$b || empty($b['scheme']) || empty($b['host'])) {
        return '';
    }
    $origin = $b['scheme'] . '://' . $b['host'] . (isset($b['port']) ? ':' . $b['port'] : '');
    if (strpos($ref, '//') === 0) {
        return $b['scheme'] . ':' . $ref;
    }
    if ($ref[0] === '/') {
        return $origin . $ref;
    }
    if ($ref[0] === '?' || $ref[0] === '#') {
        return $origin . ($b['path'] ?? '/') . $ref;
    }
    $dir = preg_replace('#/[^/]*$#', '/', $b['path'] ?? '/');
    return $origin . $dir . $ref;
}

/**
 * GET $url and return ['status', 'body', 'type', 'url' (after redirects)].
 * Throws RuntimeException with a message that can be shown to the owner.
 */
function safe_request(string $url, int $maxBytes, string $accept, array $headers = []): array
{
    if (!function_exists('curl_init')) {
        throw new RuntimeException('This server can’t fetch links (PHP’s cURL extension is off).');
    }
    for ($hop = 0; $hop <= FETCH_MAX_REDIRECTS; $hop++) {
        $parts = parse_url($url);
        $scheme = strtolower((string)($parts['scheme'] ?? ''));
        $host = strtolower((string)($parts['host'] ?? ''));
        if (!in_array($scheme, ['http', 'https'], true) || $host === '' || isset($parts['user']) || isset($parts['pass'])) {
            throw new RuntimeException('That isn’t a normal web link.');
        }
        $port = (int)($parts['port'] ?? ($scheme === 'https' ? 443 : 80));
        if (!in_array($port, [80, 443], true)) {
            throw new RuntimeException('Links on unusual ports aren’t allowed.');
        }
        $ip = public_ip_for($host);
        if ($ip === null) {
            throw new RuntimeException('Couldn’t find ' . $host . ' on the public internet.');
        }
        $literal = filter_var(trim($host, '[]'), FILTER_VALIDATE_IP) !== false; // nothing to resolve, nothing to pin

        $body = '';
        $tooBig = false;
        $responseHeaders = [];
        try {
            $ch = curl_init($url);
        } catch (ValueError $e) { // e.g. a NUL byte smuggled into a link
            throw new RuntimeException('That isn’t a normal web link.');
        }
        curl_setopt_array($ch, [
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_PROXY => '', // straight to the checked address: a proxy would resolve names itself
            CURLOPT_RESOLVE => $literal ? [] : [$host . ':' . $port . ':' . (strpos($ip, ':') !== false ? '[' . $ip . ']' : $ip)],
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => FETCH_TIMEOUT,
            CURLOPT_ENCODING => '',
            CURLOPT_USERAGENT => BROWSER_UA,
            CURLOPT_HTTPHEADER => array_merge([
                'Accept: ' . $accept,
                'Accept-Language: en-US,en;q=0.9',
                'Cache-Control: no-cache',
            ], $headers),
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$responseHeaders) {
                if (preg_match('/^HTTP\//i', $line)) {
                    $responseHeaders = []; // a new response block (e.g. after "100 Continue")
                } elseif (strpos($line, ':') !== false) {
                    [$name, $value] = explode(':', $line, 2);
                    $responseHeaders[strtolower(trim($name))] = trim($value);
                }
                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$body, &$tooBig, $maxBytes) {
                $body .= $chunk;
                if (strlen($body) > $maxBytes) {
                    $tooBig = true;
                    return 0;
                }
                return strlen($chunk);
            },
        ]);
        $ok = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($tooBig) {
            throw new RuntimeException('That file is too large (limit ' . round($maxBytes / 1048576) . ' MB).');
        }
        if ($ok === false && $status === 0) {
            throw new RuntimeException('Couldn’t reach ' . $host . ($error ? ' (' . $error . ')' : '') . '.');
        }
        if (in_array($status, [301, 302, 303, 307, 308], true) && !empty($responseHeaders['location'])) {
            $url = resolve_url($url, $responseHeaders['location']);
            continue;
        }
        return [
            'status' => $status,
            'body' => $body,
            'type' => strtolower(trim(explode(';', $responseHeaders['content-type'] ?? '')[0])),
            'url' => $url,
        ];
    }
    throw new RuntimeException('That link redirects too many times.');
}

/* ───────────────────────── links ───────────────────────── */

/** Affiliate and click-tracking parameters that never change which product a link opens. */
const LINK_TRACKING_PARAMS = [
    'ascsubtag', 'linkcode', 'linkid', 'creative', 'creativeasin', 'camp', 'raneaid', 'ransiteid', 'siteid',
    'cjevent', 'cjdata', 'awc', 'sv1', 'sv_campaign_id', 'clickref', 'pubref', 'irgwc', 'sharedid', 'sscid',
    'gad_source', 'dclid', 'twclid', 'ttclid', 'epik', 'mkcid', 'mkevt', 'mkrid', 'campid', 'toolid', 'customid',
    '_branch_match_id', 'affid', 'aff_id', 'affiliate_id',
];
/** Parameters that only say where a click came from, per shop (regex alternatives, lowercase). */
const SHOP_TRACKING_PARAMS = [
    'amazon' => 'tag|ref_?|pd_rd_\w+|pf_rd_\w+|qid|sr|crid|sprefix|psc|th|_encoding|content-id|dib|dib_tag|social_share',
    'ebay' => '_trksid|_trkparms|_from|hash|amdata',
    'etsy' => 'ref|pro|sts|frs|click_key|click_sum|ga_\w+|organic_search_click|sr_prefetch|pf_from|ls|content_source|logging_key|plkey',
    'revolve' => 'd|page|lc|itrownum|itcurrpage|itview|plpsrc|rrec',
    'walmart' => 'ath\w+|from|classtype|adsredirect|wmlspartner|sourceid|veh|affiliates_ad_id|campaign_id',
    'target' => 'afid|clkid|lnm|cpng|ref|fndsrc',
    'nordstrom' => 'origin|breadcrumb|sp_source|sp_placement',
    'neimanmarcus' => 'navpath|page|position',
    'sephora' => 'icid2|om_mmc',
];
/** Short-link, creator and affiliate-network domains: they lead to a shop but aren't one. */
const LINK_SERVICE_DOMAINS = [
    'amzn.to', 'amzn.eu', 'amzn.asia', 'a.co', 'bit.ly', 'tinyurl.com', 't.co', 'ow.ly', 'buff.ly', 'rebrand.ly',
    'cutt.ly', 'lnk.to', 'tidd.ly', 'app.link', 'linktr.ee', 'geni.us', 'shopmy.us', 'shop-links.co', 'liketk.it',
    'shopltk.com', 'rstyle.me', 'howl.me', 'howl.link', 'shopstyle.it', 'skimresources.com', 'redirectingat.com',
    'viglink.com', 'awin1.com', 'linksynergy.com', 'anrdoezrs.net', 'jdoqocy.com', 'tkqlhce.com', 'dpbolvw.net',
    'kqzyfj.com', 'qksrv.net', 'emjcd.com', 'ftjcfx.com', 'lduhtrp.net', 'tqlkg.com', 'awltovhc.com', 'yceml.net',
    'sjv.io', 'pxf.io', 'evyy.net', 'ojrq.net', '7eer.net', 'prf.hn', 'shareasale.com', 'pjtra.com', 'pjatr.com',
    'gopjn.com', 'flexlinkspro.com',
];

/**
 * Unwraps Google redirect/search wrappers (and Facebook/Instagram link shims) without touching the
 * link inside: "google.com/url?q=https://shop.com/x?tag%3Dme-20" → "https://shop.com/x?tag=me-20".
 */
function unwrap_google_link(string $url): string
{
    $url = trim($url, " \t\n\r\0\x0B<>\"'");
    for ($i = 0; $i < 3; $i++) {
        $p = parse_url($url);
        if (!$p || empty($p['host'])) {
            break;
        }
        $host = strtolower($p['host']);
        if (preg_match('/(^|\.)google\.[a-z.]+$/', $host) && in_array($p['path'] ?? '', ['/url', '/search', '/imgres', '/aclk'], true)) {
            $keys = ['q', 'url', 'imgurl', 'adurl'];
        } elseif (preg_match('/^(l|lm)\.(facebook|instagram|messenger)\.com$/', $host) || $host === 'l.threads.net') {
            $keys = ['u'];
        } else {
            break;
        }
        parse_str($p['query'] ?? '', $q);
        $inner = '';
        foreach ($keys as $key) {
            if (!empty($q[$key]) && is_string($q[$key]) && preg_match('#^https?://#i', $q[$key])) {
                $inner = $q[$key];
                break;
            }
        }
        if ($inner === '') {
            break;
        }
        $url = $inner;
    }
    return $url;
}

/** Unwraps Google redirect/search wrappers and strips tracking parameters. */
function normalize_link(string $url): string
{
    $url = unwrap_google_link($url);
    $p = parse_url($url);
    if (!$p || empty($p['host']) || empty($p['scheme'])) {
        return $url;
    }
    $query = drop_query_params($p['query'] ?? '', '/^(utm_|mc_|_pos$|_sid$|_ss$|_psq$|_v$|gclid$|gbraid$|wbraid$|fbclid$|msclkid$|igshid$|ref_$|srsltid$|trk$|clickid$|irclickid$|ranmid$|ransiteid$)/');
    return strtolower($p['scheme']) . '://' . strtolower($p['host']) . (isset($p['port']) ? ':' . $p['port'] : '')
        . ($p['path'] ?? '/') . ($query !== '' ? '?' . $query : '');
}

/** A query string without the parameters whose lowercased names match $pattern. */
function drop_query_params(string $query, string $pattern): string
{
    $kept = [];
    foreach (explode('&', $query) as $pair) {
        $key = strtolower(urldecode(explode('=', $pair, 2)[0]));
        if ($key === '' || preg_match($pattern, $key)) {
            continue;
        }
        $kept[] = $pair;
    }
    return implode('&', $kept);
}

/**
 * The link to keep for a product: normalize_link() plus Amazon's short form
 * (https://www.amazon.com/dp/B0…, no tag or ref) and no affiliate or click-tracking parameters.
 */
function canonical_product_url(string $url): string
{
    $url = normalize_link($url);
    $p = parse_url($url);
    if (!$p || empty($p['host']) || empty($p['scheme'])) {
        return $url;
    }
    $host = strtolower($p['host']);
    $path = $p['path'] ?? '/';
    $tld = amazon_store_tld($host);
    if ($tld !== null) {
        $asin = amazon_asin($url);
        if ($asin !== null) {
            return 'https://www.amazon.' . $tld . '/dp/' . $asin;
        }
        $path = (string)preg_replace('#/ref=[^/]*$#i', '', $path) ?: '/';
    }
    $drop = implode('|', array_map(function ($key) {
        return preg_quote($key, '/');
    }, LINK_TRACKING_PARAMS));
    $shop = SHOP_TRACKING_PARAMS[explode('.', shop_domain($host))[0]] ?? '';
    $query = drop_query_params($p['query'] ?? '', '/^(' . $drop . ($shop !== '' ? '|' . $shop : '') . ')$/');
    return $p['scheme'] . '://' . $host . (isset($p['port']) ? ':' . $p['port'] : '') . $path . ($query !== '' ? '?' . $query : '');
}

/** "com", "co.uk", "com.au"… for Amazon's own shop hosts (amazon.de, www.amazon.co.uk, smile.amazon.com), else null. */
function amazon_store_tld(string $host): ?string
{
    return preg_match('/^(?:(?:www|smile|m)\.)?amazon\.((?:com?\.)?[a-z]{2,3})$/', strtolower($host), $m) ? $m[1] : null;
}

/** The 10-character product code (ASIN) in an Amazon link: /dp/X, /gp/product/X, /gp/aw/d/X, ?asin=X…, or null. */
function amazon_asin(string $url): ?string
{
    $p = parse_url(trim($url));
    if (!$p || amazon_store_tld((string)($p['host'] ?? '')) === null) {
        return null;
    }
    if (preg_match('#/(?:dp|gp/product|gp/aw/d|exec/obidos/asin|o/asin|product)/([a-z0-9]{10})(?=/|$)#i', $p['path'] ?? '', $m)) {
        return strtoupper($m[1]);
    }
    parse_str($p['query'] ?? '', $q);
    foreach (['asin', 'ASIN'] as $key) {
        if (is_string($q[$key] ?? null) && preg_match('/^[a-z0-9]{10}$/i', $q[$key])) {
            return strtoupper($q[$key]);
        }
    }
    return null;
}

/** "www.amazon.co.uk" → "amazon.co.uk", "go.shopmy.us" → "shopmy.us": the part of a host a shop registers. */
function shop_domain(string $host): string
{
    $labels = explode('.', strtolower(trim($host, '.[]')));
    $n = count($labels);
    if ($n <= 2) {
        return implode('.', $labels);
    }
    $second = in_array($labels[$n - 2], ['co', 'com', 'net', 'org', 'ac', 'gov', 'edu', 'ne', 'or', 'gen'], true);
    return implode('.', array_slice($labels, $second && strlen($labels[$n - 1]) === 2 ? -3 : -2));
}

/** True for short links, creator platforms and affiliate networks (amzn.to, bit.ly, ShopMy, LTK, Awin…). */
function is_link_service(string $host): bool
{
    return in_array(shop_domain($host), LINK_SERVICE_DOMAINS, true);
}

/**
 * A product name from the words in its link, or '' when the link only holds ids:
 * ".../versace-medusa-rhapsody-ashtray-13cm-item-16661316.aspx" → "Versace Medusa Rhapsody Ashtray 13cm".
 * Knows where the big shops keep the words (Amazon, Walmart, Target, eBay, Etsy, Nike, SSENSE…).
 */
function name_from_url(string $url): string
{
    $slug = product_slug($url);
    $slug = (string)preg_replace('/^((wo)?mens?[-_])+/i', '', $slug);
    if (stripos((string)parse_url($url, PHP_URL_PATH), '/products/') !== false) {
        $slug = (string)preg_replace('/[-_]\d{1,2}$/', '', $slug); // Shopify's "-1" duplicate suffix
    }
    return $slug === '' ? '' : mb_substr(slug_words($slug), 0, 140);
}

/**
 * The designer a shop puts in its links, else '': SSENSE and Net-a-Porter give it a path segment
 * (/product/gucci/…), Farfetch starts the slug with it.
 */
function brand_from_url(string $url): string
{
    $host = strtolower((string)parse_url($url, PHP_URL_HOST));
    $shop = explode('.', shop_domain($host))[0];
    if (in_array($shop, ['ssense', 'net-a-porter', 'mrporter', 'theoutnet'], true)) {
        $segments = url_segments($url);
        $i = array_search('product', array_map('strtolower', $segments), true);
        if ($i !== false && isset($segments[$i + 2]) && is_wordy($segments[$i + 1])) {
            return known_brand_spelling(slug_words($segments[$i + 1]));
        }
        return '';
    }
    if ($shop === 'farfetch') {
        return split_brand(name_from_url($url))[0];
    }
    return '';
}

/** The path segment that names the product, with shop codes and file endings trimmed off, or ''. */
function product_slug(string $url): string
{
    $host = strtolower((string)parse_url($url, PHP_URL_HOST));
    if ($host === '') {
        return '';
    }
    if (is_link_service($host)) { // a wrapper that names where it goes (Awin's ued=, Skimlinks' url=…)
        parse_str((string)parse_url($url, PHP_URL_QUERY), $q);
        foreach (['url', 'u', 'murl', 'ued', 'urllink', 'dest', 'destination'] as $key) {
            if (is_string($q[$key] ?? null) && preg_match('#^https?://#i', $q[$key]) && !is_link_service((string)parse_url($q[$key], PHP_URL_HOST))) {
                return product_slug($q[$key]);
            }
        }
        return '';
    }
    $segments = url_segments($url);
    $lower = array_map('strtolower', $segments);
    $shop = explode('.', shop_domain($host))[0];

    // "/Slug-Words/dp/B0…" (Amazon, Revolve): the words sit just before the product code.
    if (amazon_store_tld($host) !== null || $shop === 'revolve') {
        foreach ($lower as $i => $segment) {
            if ($i > 0 && in_array($segment, ['dp', 'gp', 'product-reviews', 'exec', 'o'], true)) {
                return trim_slug($segments[$i - 1]);
            }
        }
        return '';
    }
    // Shops with a marker segment: the slug is the segment $offset places after it (or none at all).
    $markers = [
        'ssense' => ['product', 2], 'ebay' => ['itm', 1], 'etsy' => ['listing', 2], 'walmart' => ['ip', 1],
        'target' => ['p', 1], 'nike' => ['t', 1], 'nordstrom' => ['s', 1],
    ];
    if (isset($markers[$shop])) {
        [$marker, $offset] = $markers[$shop];
        $i = array_search($marker, $lower, true);
        if ($i !== false) {
            $slug = trim_slug($segments[$i + $offset] ?? '');
            if ($shop === 'nike') { // "air-force-1-07-mens-shoes-jBrhbr": Nike's style code at the end
                $slug = (string)preg_replace('/-(?=[a-z0-9]*[A-Z])(?=[A-Z0-9]*[a-z])[A-Za-z0-9]{6}$/', '', $slug);
            }
            return $slug;
        }
    }
    // Net-a-Porter, Mr Porter: /product/<brand>/<category>/…/<slug>/<id>, the brand isn't the name.
    $first = 0;
    if (in_array($shop, ['net-a-porter', 'mrporter', 'theoutnet'], true) && ($i = array_search('product', $lower, true)) !== false) {
        $first = $i + 2;
    }
    // Everyone else: the last segment with words in it.
    $skip = ['products', 'product', 'shopping', 'shop', 'women', 'men', 'womens', 'mens', 'kids', 'pr', 'item', 'items',
        'itm', 'ip', 'dp', 'p', 'listing', 'catalog', 'collections', 'collection', 'category'];
    for ($i = count($segments) - 1; $i >= $first; $i--) {
        $slug = trim_slug($segments[$i]);
        if ($slug !== '' && !in_array(strtolower($slug), $skip, true)) {
            return $slug;
        }
    }
    return '';
}

/** Non-empty, decoded path segments of a link. */
function url_segments(string $url): array
{
    $segments = [];
    foreach (explode('/', (string)parse_url($url, PHP_URL_PATH)) as $segment) {
        if ($segment !== '') {
            $segments[] = urldecode($segment);
        }
    }
    return $segments;
}

/** A path segment without file endings and product codes ("-item-123", "-p-7001321DS1G1022", "-P97989778"), or '' if no words are left. */
function trim_slug(string $segment): string
{
    if (strpos($segment, '=') !== false) { // Amazon's "ref=sr_1_1"
        return '';
    }
    $slug = (string)preg_replace('/\.(aspx?|html?|php|jsp)$/i', '', $segment);
    $slug = (string)preg_replace('/[-_]p-(?=[a-z]*\d)[a-z0-9]{6,}$/i', '', $slug);            // Gucci
    $slug = (string)preg_replace('/[-_](item|p|prod|product|dp|pid|sku)[-_]?\d+$/i', '', $slug); // Farfetch, Mytheresa, Neiman, Sephora, Zara
    $slug = (string)preg_replace('/[-_]?\d{5,}$/', '', $slug);                                   // Saks and other trailing ids
    return is_wordy($slug) ? $slug : '';
}

/** True when a slug has a real word in it, not only ids like "B0CHWRXH8B" or "aB3xYz". */
function is_wordy(string $slug): bool
{
    foreach (preg_split('/[-_+\s.]+/', $slug) ?: [] as $word) {
        if (preg_match('/^(\p{Ll}{3,}|\p{Lu}\p{Ll}{2,}|\p{Lu}{3,}|\p{Lo}{2,})$/u', $word)) { // \p{Lo}: Japanese, Arabic…
            return true;
        }
    }
    return false;
}

/** "air-force-1-07-mens-shoes" → "Air Force 1 07 Men’s Shoes"; keeps "AirPods" and "iPhone" as they are. */
function slug_words(string $slug): string
{
    $words = preg_split('/[-_+\s]+/', $slug, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    $shouting = !preg_match('/\p{Ll}/u', $slug);
    $out = [];
    foreach ($words as $i => $word) {
        $lower = mb_strtolower($word);
        if (in_array($lower, ['and', 'or', 'of', 'on', 'in', 'to', 'by', 'with', 'for', 'the'], true)) {
            $out[] = $i > 0 ? $lower : ucfirst($lower);
        } elseif (in_array($lower, ['mens', 'womens'], true)) {
            $out[] = $lower === 'mens' ? 'Men’s' : 'Women’s';
        } elseif (preg_match('/\p{Ll}/u', $word) && preg_match('/\p{Lu}/u', $word) && !preg_match('/^\p{Lu}[^\p{Lu}]*$/u', $word)) {
            $out[] = $word; // written that way on purpose: AirPods, iPhone, McQueen
        } elseif (!$shouting && preg_match('/^\p{Lu}{2,4}$/u', $word)) {
            $out[] = $word; // LED, UGG
        } elseif (mb_strlen($word) <= 2 && preg_match('/^\p{L}+$/u', $word)) {
            $out[] = mb_strtoupper($word); // "ma" → "MA"
        } else {
            $out[] = mb_strtoupper(mb_substr($lower, 0, 1)) . mb_substr($lower, 1);
        }
    }
    return implode(' ', $out);
}

/* ───────────────────────── product pages ───────────────────────── */

/**
 * Everything we can learn about a product from its link:
 * ['url','store','name','brand','variant','price','currency','image','found','blocked','error'].
 * 'url' is the canonical product link, after following short links (amzn.to, ShopMy, LTK, bit.ly…)
 * to the shop. Never throws: when the shop can't be reached, the name still comes from the link itself.
 */
function inspect_link(string $rawUrl, array $knownBrands = []): array
{
    $pasted = normalize_link($rawUrl);
    $url = canonical_product_url($pasted);
    if (clean_url($url) === '') {
        throw new RuntimeException('That doesn’t look like a link. Paste the full address, starting with https://');
    }
    $info = [
        'url' => $url, 'store' => store_name($url), 'name' => '', 'brand' => '', 'variant' => '',
        'price' => null, 'currency' => '', 'image' => '', 'found' => false, 'blocked' => false, 'error' => '',
    ];
    $worded = [$pasted]; // links whose words can name the product, best first

    $page = null;
    try {
        $r = safe_request($url, FETCH_HTML_MAX, HTML_ACCEPT);
        $landed = landing_url($url, $r['url']);
        if ($landed !== $url) {
            $info['url'] = $landed;
            $info['store'] = store_name($landed);
            array_unshift($worded, normalize_link($r['url']));
        }
        if (is_bot_wall($r['body'])) {
            $info['blocked'] = true;
            $info['error'] = $info['store'] . ' asked for a captcha, so the details couldn’t be read.';
        } elseif ($r['status'] >= 200 && $r['status'] < 300 && strpos($r['type'], 'html') !== false) {
            $page = parse_product_html($r['body'], $r['url']);
        } elseif (in_array($r['status'], [401, 403, 429, 503], true)) {
            $info['blocked'] = true;
            $info['error'] = $info['store'] . ' blocked the automatic lookup.';
        } else {
            $info['error'] = $info['store'] . ' answered with an error (' . $r['status'] . ').';
        }
    } catch (RuntimeException $e) {
        $info['error'] = $e->getMessage();
    }

    // Shopify shops (amiri.com and many more) publish clean product JSON next to every product page.
    if (preg_match('~^(https?://[^/]+)(?:/[a-z]{2}(?:-[a-z]{2})?)?/products/([^/?#]+)~i', $info['url'], $m)) {
        try {
            $r = safe_request($m[1] . '/products/' . $m[2] . '.js', 2 * 1024 * 1024, 'application/json');
            $p = $r['status'] === 200 ? json_decode($r['body'], true) : null;
            if (is_array($p) && !empty($p['title'])) {
                $info['name'] = clean_text($p['title'], 140);
                $info['brand'] = clean_text($p['vendor'] ?? '', 80);
                if (isset($p['price']) && is_numeric($p['price'])) {
                    $info['price'] = round((float)$p['price'] / 100, 2);
                }
                $image = $p['featured_image'] ?? ($p['images'][0] ?? '');
                if (is_string($image) && $image !== '') {
                    $info['image'] = clean_url(resolve_url($info['url'], $image));
                }
                $info['found'] = true;
            }
        } catch (RuntimeException $e) {
            // the page itself is all there is
        }
    }

    if ($page !== null) {
        foreach (['name', 'brand', 'variant', 'image', 'currency'] as $key) {
            if ($info[$key] === '' && $page[$key] !== '') {
                $info[$key] = $page[$key];
            }
        }
        if ($info['price'] === null && $page['price'] !== null) {
            $info['price'] = $page['price'];
        }
        $info['found'] = $info['found'] || $page['name'] !== '';
    }

    $slugName = '';
    foreach ($worded as $link) {
        if ($slugName === '') {
            $slugName = name_from_url($link);
        }
        if ($info['brand'] === '') {
            $info['brand'] = brand_from_url($link);
        }
    }
    if ($info['name'] === '') {
        $info['name'] = $slugName ?: $info['store'] . ' find';
    }
    if ($info['brand'] === '' && is_single_brand_store($info['url'])) {
        $info['brand'] = $info['store'];
    }
    $info['name'] = tidy_product_name($info['name'], $info['brand'], $info['store']);
    if ($info['brand'] === '') { // multi-brand shops: "Gucci Horsebit loafers" → Gucci + Horsebit loafers
        [$info['brand'], $info['name']] = split_brand($info['name'], $knownBrands);
    }
    if ($info['name'] === '') {
        $info['name'] = $slugName ?: $info['store'] . ' find';
    }
    if ($info['currency'] === '' && $info['price'] !== null) {
        $info['currency'] = guess_store_currency($info['url']);
    }
    return $info;
}

/**
 * The link to keep after following redirects: where a short link (amzn.to, ShopMy, LTK, bit.ly…)
 * ends up, but not a captcha or sign-in page, a shop's homepage standing in for a sold-out product,
 * or the same product in the server's country version of the shop.
 */
function landing_url(string $before, string $after): string
{
    $after = canonical_product_url($after);
    $a = parse_url($after);
    $b = parse_url($before);
    if (clean_url($after) === '' || !$a || !$b || empty($a['host']) || empty($b['host'])) {
        return $before;
    }
    if (preg_match('#/(errors/validatecaptcha|captcha|blocked|challenge|ap/signin|signin|sign-in|login|log-in)(/|$)#i', $a['path'] ?? '/')) {
        return $before;
    }
    if (shop_domain($a['host']) !== shop_domain($b['host'])) {
        return $after;
    }
    $key = function (string $path): string { // the path without country/language parts like /us/en or /en-gb
        return implode('/', array_filter(explode('/', strtolower($path)), function ($s) {
            return $s !== '' && !preg_match('/^([a-z]{2}([-_][a-z]{2})?|intl|int|global)$/', $s);
        }));
    };
    $afterKey = $key($a['path'] ?? '/');
    $beforeKey = $key($b['path'] ?? '/');
    return $afterKey === $beforeKey || ($afterKey === '' && $beforeKey !== '') ? $before : $after;
}

/**
 * True when a shop answered with a captcha or bot check instead of the page
 * (Amazon, Akamai, PerimeterX, DataDome, Cloudflare, Imperva).
 */
function is_bot_wall(string $html): bool
{
    $titles = 'robot check|access denied|just a moment\.*|attention required!? \| cloudflare|pardon our interruption'
        . '|robot or human\??|are you a (robot|human)\??|security check|access to this page has been denied\.?';
    if (preg_match('#<title[^>]*>\s*(' . $titles . ')\s*</title>#i', substr($html, 0, 200000))) {
        return true;
    }
    if (strlen($html) > 300000) { // a real product page; walls are a few kilobytes
        return false;
    }
    return (bool)preg_match('#/errors/validateCaptcha|Enter the characters you see below|id=["\']px-captcha|captcha-delivery\.com|_cf_chl_opt|Incapsula incident ID#i', $html);
}

/** Name, brand, price, currency, image and color from a product page's structured data and meta tags. */
function parse_product_html(string $html, string $baseUrl): array
{
    $out = ['name' => '', 'brand' => '', 'variant' => '', 'price' => null, 'currency' => '', 'image' => ''];
    $prev = libxml_use_internal_errors(true);
    $doc = new DOMDocument();
    $loaded = $doc->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NONET | LIBXML_NOWARNING | LIBXML_NOERROR);
    libxml_clear_errors();
    libxml_use_internal_errors($prev);
    if (!$loaded) {
        return $out;
    }
    $xp = new DOMXPath($doc);

    // 1. schema.org Product in JSON-LD: the most reliable source when a shop has it.
    foreach ($xp->query('//script[@type="application/ld+json"]') ?: [] as $node) {
        $json = trim((string)$node->textContent);
        $json = preg_replace('/^\s*<!--|-->\s*$/', '', $json);
        $data = json_decode((string)$json, true);
        $product = is_array($data) ? find_ld_product($data) : null;
        if (!$product) {
            continue;
        }
        $out['name'] = clean_text(ld_text($product['name'] ?? ''), 140);
        $brand = $product['brand'] ?? '';
        $out['brand'] = clean_text(is_array($brand) ? ld_text($brand['name'] ?? '') : ld_text($brand), 80);
        $out['variant'] = clean_text(ld_text($product['color'] ?? ''), 80);
        $out['image'] = ld_image($product['image'] ?? '');
        $offers = $product['offers'] ?? [];
        if (is_array($offers) && (isset($offers['@type']) || isset($offers['price']))) {
            $offers = [$offers];
        }
        foreach ((array)$offers as $offer) {
            if (!is_array($offer)) {
                continue;
            }
            $price = parse_amount($offer['price'] ?? ($offer['lowPrice'] ?? ($offer['priceSpecification']['price'] ?? null)));
            if ($price !== null) {
                $out['price'] = $price;
                $out['currency'] = strtoupper(clean_text($offer['priceCurrency'] ?? ($offer['priceSpecification']['priceCurrency'] ?? ''), 3));
                break;
            }
        }
        break;
    }

    // 2. Open Graph / product meta tags.
    $meta = [];
    foreach ($xp->query('//meta[@content]') ?: [] as $node) {
        /** @var DOMElement $node */
        $key = strtolower($node->getAttribute('property') ?: $node->getAttribute('name') ?: $node->getAttribute('itemprop'));
        if ($key !== '' && !isset($meta[$key])) {
            $meta[$key] = trim($node->getAttribute('content'));
        }
    }
    if ($out['name'] === '') {
        $out['name'] = clean_text($meta['og:title'] ?? ($meta['twitter:title'] ?? ''), 140);
    }
    if ($out['name'] === '') { // 3. Amazon keeps its details in the page layout instead
        $out['name'] = clean_text(first_text($xp, ['//*[@id="productTitle"]']), 140);
    }
    if ($out['name'] === '') {
        $title = $xp->query('//title')->item(0);
        $out['name'] = $title ? clean_text($title->textContent, 140) : '';
    }
    if ($out['image'] === '') {
        $out['image'] = $meta['og:image:secure_url'] ?? ($meta['og:image'] ?? ($meta['twitter:image'] ?? ($meta['image'] ?? '')));
    }
    if ($out['image'] === '') {
        $out['image'] = amazon_image($xp);
    }
    if ($out['price'] === null) {
        $out['price'] = parse_amount($meta['product:price:amount'] ?? ($meta['og:price:amount'] ?? ($meta['price'] ?? null)));
    }
    if ($out['currency'] === '') {
        $out['currency'] = strtoupper(clean_text($meta['product:price:currency'] ?? ($meta['og:price:currency'] ?? ($meta['pricecurrency'] ?? '')), 3));
    }
    if ($out['price'] === null) {
        $shown = amazon_price_text($xp);
        if (preg_match('/\d[\d.,\s]*/u', $shown, $m)) {
            $out['price'] = parse_amount(trim($m[0]));
            if ($out['price'] !== null && $out['currency'] === '') {
                $out['currency'] = price_text_currency($shown);
            }
        }
    }
    if ($out['brand'] === '') {
        $out['brand'] = clean_text($meta['product:brand'] ?? ($meta['og:brand'] ?? ''), 80);
    }
    if ($out['brand'] === '') {
        $out['brand'] = clean_text(amazon_byline_brand(first_text($xp, ['//*[@id="bylineInfo"]'])), 80);
    }
    if ($out['image'] !== '') {
        $out['image'] = clean_url(resolve_url($baseUrl, $out['image']));
    }
    if (!preg_match('/^[A-Z]{3}$/', $out['currency'])) {
        $out['currency'] = '';
    }
    return $out;
}

function find_ld_product(array $data, int $depth = 0): ?array
{
    if ($depth > 6) {
        return null;
    }
    $type = $data['@type'] ?? null;
    $types = is_array($type) ? $type : [$type];
    if (in_array('Product', $types, true) || in_array('ProductGroup', $types, true)) {
        if (in_array('ProductGroup', $types, true) && empty($data['offers']) && !empty($data['hasVariant'][0])) {
            return $data['hasVariant'][0] + ['name' => $data['name'] ?? '', 'brand' => $data['brand'] ?? ''];
        }
        return $data;
    }
    foreach ($data as $value) {
        if (is_array($value)) {
            $found = find_ld_product($value, $depth + 1);
            if ($found) {
                return $found;
            }
        }
    }
    return null;
}

function ld_text($value): string
{
    if (is_array($value)) {
        $value = $value['name'] ?? ($value['@value'] ?? (is_string($value[0] ?? null) ? $value[0] : ''));
    }
    return is_scalar($value) ? html_entity_decode((string)$value, ENT_QUOTES | ENT_HTML5, 'UTF-8') : '';
}

function ld_image($value): string
{
    if (is_string($value)) {
        return $value;
    }
    if (is_array($value)) {
        if (isset($value['url']) || isset($value['contentUrl'])) {
            return (string)($value['url'] ?? $value['contentUrl']);
        }
        foreach ($value as $v) {
            $found = ld_image($v);
            if ($found !== '') {
                return $found;
            }
        }
    }
    return '';
}

/** Text of the first node the XPath queries find (tried in order), whitespace tidied, or ''. */
function first_text(DOMXPath $xp, array $queries): string
{
    foreach ($queries as $query) {
        foreach ($xp->query($query) ?: [] as $node) {
            $text = trim((string)preg_replace('/\s+/u', ' ', $node->textContent));
            if ($text !== '') {
                return $text;
            }
        }
    }
    return '';
}

/** The price in Amazon's buy box ("$249.00", "1.299,00 €"), or ''. Struck-through list prices are skipped. */
function amazon_price_text(DOMXPath $xp): string
{
    $class = function (string $name): string {
        return 'contains(concat(" ", normalize-space(@class), " "), " ' . $name . ' ")';
    };
    $shown = $class('a-offscreen') . ' and not(ancestor-or-self::*[@data-a-strike="true"])';
    return first_text($xp, [
        '//*[@id="corePrice_feature_div" or @id="corePriceDisplay_desktop_feature_div" or @id="apex_desktop"]//*[' . $shown . ']',
        '//*[' . $class('a-price') . ' and not(' . $class('a-text-price') . ')]//*[' . $shown . ']',
        '//*[@id="priceblock_ourprice" or @id="priceblock_dealprice"]',
    ]);
}

/** Amazon's main photo: the full-size one in data-old-hires, else the widest in data-a-dynamic-image. */
function amazon_image(DOMXPath $xp): string
{
    foreach ($xp->query('//img[@id="landingImage" or @id="imgBlkFront" or @id="ebooksImgBlkFront"]') ?: [] as $img) {
        /** @var DOMElement $img */
        $hires = trim($img->getAttribute('data-old-hires'));
        if ($hires !== '') {
            return $hires;
        }
        $sizes = json_decode($img->getAttribute('data-a-dynamic-image'), true);
        if (is_array($sizes) && $sizes) {
            $best = '';
            $width = -1;
            foreach ($sizes as $src => $size) {
                if ((int)(is_array($size) ? ($size[0] ?? 0) : 0) > $width) {
                    $best = (string)$src;
                    $width = (int)(is_array($size) ? ($size[0] ?? 0) : 0);
                }
            }
            return $best;
        }
        $src = trim($img->getAttribute('src'));
        if ($src !== '' && stripos($src, 'data:') !== 0) {
            return $src;
        }
    }
    return '';
}

/** "Visit the Apple Store" or "Brand: Apple" (Amazon's byline, in a few languages) → "Apple", else ''. */
function amazon_byline_brand(string $byline): string
{
    $patterns = [
        '/^Visit the (.+?) Store$/iu', '/^(?:Brand|Marke|Marque|Marca|Merk|Märke|Marka)\s*:\s*(.+)$/iu',
        '/^Besuche den (.+?)-Store$/iu', '/^Visitez la boutique (.+)$/iu', '/^Visita la tienda de (.+)$/iu',
        '/^Visita lo Store di (.+)$/iu',
    ];
    foreach ($patterns as $pattern) {
        if (preg_match($pattern, trim($byline), $m)) {
            return trim($m[1]);
        }
    }
    return '';
}

/** The currency a shown price is in ("£49.99" → GBP), or '' when its sign could mean several ("$"). */
function price_text_currency(string $text): string
{
    $signs = ['US$' => 'USD', 'CDN$' => 'CAD', 'CA$' => 'CAD', 'C$' => 'CAD', 'AU$' => 'AUD', 'A$' => 'AUD', 'S$' => 'SGD',
        'R$' => 'BRL', 'MX$' => 'MXN', '£' => 'GBP', '€' => 'EUR', '¥' => 'JPY', '￥' => 'JPY', '₹' => 'INR', 'zł' => 'PLN', '₺' => 'TRY'];
    foreach ($signs as $sign => $code) {
        if (strpos($text, $sign) !== false) {
            return $code;
        }
    }
    if (preg_match('/\b([A-Z]{3})\b/', $text, $m) && in_array($m[1], CURRENCIES, true)) {
        return $m[1];
    }
    return '';
}

/**
 * Drops shop suffixes ("… | FARFETCH", "… — FARFETCH", "Amazon.com: … : Electronics") and a
 * duplicated brand prefix from a product name.
 */
function tidy_product_name(string $name, string $brand, string $store): string
{
    $original = clean_text($name, 140);
    if (preg_match('/^amazon(\.[a-z.]+)?\s*:\s*(.+)$/iu', $name, $m)) { // "Amazon.com: <name> : <department>"
        $name = (string)preg_replace('/\s+:\s+[^:]+$/u', '', $m[2]);
    }
    $name = trim((string)preg_replace('/\s*[|–—:-]\s*(' . preg_quote($store, '/') . '|farfetch|amiri|ssense|shop now|buy online)[^|–—]*$/iu', '', $name));
    $name = trim((string)preg_replace('/\s*[|]\s*[^|]*$/u', '', $name));
    if ($brand !== '' && mb_stripos($name, $brand . ' ') === 0 && mb_strlen($name) > mb_strlen($brand) + 3) {
        $name = trim(mb_substr($name, mb_strlen($brand)));
    }
    return clean_text($name, 140) ?: $original;
}

/** Luxury and design brands recognized at the start of a product name. */
const KNOWN_BRANDS = [
    'AMIRI', 'Versace', 'Chrome Hearts', 'L’Objet', "L'Objet", 'Transparent', 'Gucci', 'Prada', 'Louis Vuitton', 'Dior',
    'Chanel', 'Hermès', 'Hermes', 'Balenciaga', 'Bottega Veneta', 'Saint Laurent', 'YSL', 'Valentino', 'Fendi',
    'Givenchy', 'Celine', 'Loewe', 'Miu Miu', 'Burberry', 'Alexander McQueen', 'Off-White', 'Rick Owens',
    'Maison Margiela', 'Jacquemus', 'The Row', 'Khaite', 'Mugler', 'Jean Paul Gaultier', 'Vivienne Westwood',
    'Christian Louboutin', 'Louboutin', 'Jimmy Choo', 'Manolo Blahnik', 'Aquazzura', 'Gianvito Rossi', 'Amina Muaddi',
    'Cartier', 'Tiffany & Co.', 'Van Cleef & Arpels', 'Bulgari', 'Bvlgari', 'Rolex', 'Apple', 'Dyson',
    'Bang & Olufsen', 'Diptyque', 'Le Labo', 'Byredo', 'Aesop', 'Skims', 'Moncler', 'Nike', 'Adidas', 'New Balance',
    'Salomon', 'Acne Studios', 'Ganni', 'Zimmermann', 'Dolce & Gabbana', 'Balmain', 'Tom Ford', 'Stella McCartney',
    'Chloé', 'Marni', 'Alaïa', 'Ferragamo', 'Roger Vivier', 'Golden Goose', 'Palm Angels', 'Fear of God', 'Loro Piana',
    'Brunello Cucinelli', 'Missoni', 'Fornasetti', 'Seletti', 'Gufram', 'Baccarat', 'Lalique', 'Christofle',
    'Ginori 1735', 'Louis Poulsen', 'Flos', 'Jil Sander', 'Lemaire', 'Toteme', 'Coperni', 'Ludovic de Saint Sernin',
    'Dsquared2', 'Moschino', 'Maison Kitsuné', 'Stüssy', 'Supreme', 'Palace', 'Kith', 'Telfar', 'Marc Jacobs',
    'MM6 Maison Margiela', 'Max Mara', 'Self-Portrait', 'Nanushka', 'Staud', 'Cult Gaia', 'Vetements', 'Rimowa', 'Goyard',
    'Chopard', 'Messika', 'David Yurman', 'Mejuri', 'Polène', 'Longchamp', 'Tory Burch', 'Kate Spade', 'Michael Kors',
    'Ralph Lauren', 'Calvin Klein', 'Hugo Boss', 'Ray-Ban', 'Swarovski', 'UGG', 'Birkenstock', 'Reformation',
    'Lululemon', 'Alo Yoga', 'Rare Beauty', 'Charlotte Tilbury', 'Fenty Beauty', 'Huda Beauty', 'Kylie Cosmetics',
    'Glossier', 'Drunk Elephant', 'Sol de Janeiro', 'La Mer', 'Estée Lauder', 'Lancôme', 'Pat McGrath Labs', 'Tatcha',
    'Olaplex', 'Kérastase', 'Samsung', 'Sony', 'Bose', 'Stanley',
];

/** A brand as the list above spells it ("saint laurent" → "Saint Laurent", "Chloe" → "Chloé"), else as given. */
function known_brand_spelling(string $brand): string
{
    $key = brand_key($brand);
    foreach (KNOWN_BRANDS as $known) {
        if (brand_key($known) === $key) {
            return $known === "L'Objet" ? 'L’Objet' : $known;
        }
    }
    return $brand;
}

/** "Chloé" → "chloe", "Tiffany & Co." → "tiffanyco": brand names compared without case, accents or punctuation. */
function brand_key(string $brand): string
{
    $plain = strtr(mb_strtolower($brand), [
        'à' => 'a', 'á' => 'a', 'â' => 'a', 'ä' => 'a', 'ç' => 'c', 'è' => 'e', 'é' => 'e', 'ê' => 'e', 'ë' => 'e',
        'í' => 'i', 'î' => 'i', 'ï' => 'i', 'ñ' => 'n', 'ó' => 'o', 'ô' => 'o', 'ö' => 'o', 'ú' => 'u', 'û' => 'u', 'ü' => 'u',
    ]);
    return (string)preg_replace('/[^a-z0-9]/', '', $plain);
}

/** [brand, rest of the name] when the name starts with a known brand, else ['', name]. */
function split_brand(string $name, array $extraBrands = []): array
{
    $brands = array_merge($extraBrands, KNOWN_BRANDS);
    usort($brands, function ($a, $b) {
        return mb_strlen((string)$b) <=> mb_strlen((string)$a);
    });
    foreach ($brands as $brand) {
        $b = (string)$brand;
        if ($b !== '' && mb_strlen($name) > mb_strlen($b) + 2
            && mb_strtolower(mb_substr($name, 0, mb_strlen($b) + 1)) === mb_strtolower($b . ' ')) {
            return [$b === "L'Objet" ? 'L’Objet' : $b, trim(mb_substr($name, mb_strlen($b)))];
        }
    }
    return ['', $name];
}

/**
 * Shops that only sell their own brand, so the store name is the brand. Department stores,
 * marketplaces and short/affiliate links (amzn.to, ShopMy…) are not.
 */
function is_single_brand_store(string $url): bool
{
    $multi = ['farfetch', 'ssense', 'net-a-porter', 'mrporter', 'mytheresa', 'matches', 'luisaviaroma', 'nordstrom',
        'saks', 'neimanmarcus', 'bergdorfgoodman', 'selfridges', 'harrods', 'amazon', 'sephora', 'etsy', 'revolve',
        'fwrd', 'shopbop', 'goat', 'stockx', 'therealreal', 'vestiairecollective', 'ebay', 'amzn', 'target', 'walmart',
        'ulta', 'bloomingdales', 'macys', 'asos', 'zalando', 'cettire', 'modaoperandi', 'theoutnet', 'yoox', 'italist',
        'brownsfashion', 'endclothing', 'hbx', '24s', 'harveynichols', 'libertylondon', 'lookfantastic', 'cultbeauty',
        'spacenk', 'dermstore', 'bestbuy', 'costco', 'kohls', 'wayfair', 'depop', 'poshmark', 'grailed', 'fashionphile',
        'rebag', '1stdibs', 'aliexpress', 'temu', 'shein', 'lyst'];
    $host = strtolower((string)parse_url($url, PHP_URL_HOST));
    if ($host === '' || is_link_service($host)) {
        return false;
    }
    $name = explode('.', shop_domain($host))[0];
    foreach ($multi as $shop) {
        if (strpos($name, $shop) === 0) {
            return false;
        }
    }
    return true;
}

/** The currency a shop most likely charges in, from its address: amazon.co.uk → GBP, shop.de → EUR, else USD. */
function guess_store_currency(string $url): string
{
    $host = strtolower((string)parse_url($url, PHP_URL_HOST));
    $amazon = ['co.uk' => 'GBP', 'de' => 'EUR', 'fr' => 'EUR', 'it' => 'EUR', 'es' => 'EUR', 'nl' => 'EUR', 'com.be' => 'EUR',
        'ie' => 'EUR', 'ca' => 'CAD', 'com.au' => 'AUD', 'co.jp' => 'JPY', 'in' => 'INR', 'com.mx' => 'MXN', 'com.br' => 'BRL',
        'se' => 'SEK', 'pl' => 'PLN', 'com.tr' => 'TRY', 'ae' => 'AED', 'sg' => 'SGD'];
    $tld = amazon_store_tld($host);
    if ($tld !== null) {
        return $amazon[$tld] ?? 'USD';
    }
    $tlds = ['.co.uk' => 'GBP', '.uk' => 'GBP', '.de' => 'EUR', '.fr' => 'EUR', '.it' => 'EUR', '.es' => 'EUR',
        '.nl' => 'EUR', '.eu' => 'EUR', '.be' => 'EUR', '.at' => 'EUR', '.ie' => 'EUR', '.pt' => 'EUR', '.fi' => 'EUR',
        '.gr' => 'EUR', '.ca' => 'CAD', '.com.au' => 'AUD', '.au' => 'AUD', '.nz' => 'NZD', '.jp' => 'JPY', '.ch' => 'CHF',
        '.se' => 'SEK', '.dk' => 'DKK', '.no' => 'NOK', '.pl' => 'PLN', '.cz' => 'CZK', '.sg' => 'SGD', '.hk' => 'HKD',
        '.kr' => 'KRW', '.in' => 'INR', '.ae' => 'AED', '.mx' => 'MXN', '.br' => 'BRL', '.tr' => 'TRY', '.za' => 'ZAR'];
    foreach ($tlds as $tld => $currency) {
        if (substr($host, -strlen($tld)) === $tld) {
            return $currency;
        }
    }
    return 'USD';
}

/**
 * Parses a price in any common format: 1100, "1,100.00", "1.100,00", "1.100 €", "$590".
 * A single separator followed by exactly three digits is a thousands separator ("1.100" = 1100).
 */
function parse_amount($value): ?float
{
    if (is_int($value) || is_float($value)) {
        return $value >= 0 ? round((float)$value, 2) : null;
    }
    if (!is_string($value)) {
        return null;
    }
    $s = preg_replace('/[^\d.,]/', '', $value);
    if ($s === '' || !preg_match('/\d/', (string)$s)) {
        return null;
    }
    $s = trim((string)$s, '.,');
    $lastDot = strrpos($s, '.');
    $lastComma = strrpos($s, ',');
    if ($lastDot !== false && $lastComma !== false) {
        $decimal = $lastDot > $lastComma ? '.' : ',';
        $s = str_replace($decimal === '.' ? ',' : '.', '', $s);
        $s = str_replace($decimal, '.', $s);
    } elseif ($lastComma !== false || $lastDot !== false) {
        $sep = $lastComma !== false ? ',' : '.';
        $after = strlen($s) - (int)strrpos($s, $sep) - 1;
        if (substr_count($s, $sep) === 1 && $after !== 3) {
            $s = str_replace($sep, '.', $s);
        } else {
            $s = str_replace($sep, '', $s);
        }
    }
    return is_numeric($s) ? round((float)$s, 2) : null;
}

/* ───────────────────────── images ───────────────────────── */

/**
 * Downloads a product photo to a temp file and returns its path. $url may be the image
 * itself or a product page, in which case the page's main image is used.
 */
function download_image(string $url, string $referer = ''): string
{
    $url = normalize_link($url);
    $headers = $referer !== '' ? ['Referer: ' . $referer] : [];
    $r = safe_request($url, FETCH_IMAGE_MAX, IMAGE_ACCEPT . ',text/html;q=0.5', $headers);
    if ($r['status'] < 200 || $r['status'] >= 300) {
        throw new RuntimeException(store_name($url) . ' didn’t hand over the photo (error ' . $r['status'] . ').');
    }
    if (strpos($r['type'], 'html') !== false) {
        $page = parse_product_html($r['body'], $r['url']);
        if ($page['image'] === '') {
            throw new RuntimeException('That page doesn’t name a main photo. Paste the image address itself instead.');
        }
        $r = safe_request($page['image'], FETCH_IMAGE_MAX, IMAGE_ACCEPT, ['Referer: ' . $r['url']]);
        if ($r['status'] < 200 || $r['status'] >= 300) {
            throw new RuntimeException('The photo host refused the download (error ' . $r['status'] . ').');
        }
    }
    $tmp = tmp_dir() . '/dl-' . bin2hex(random_bytes(6));
    if (@file_put_contents($tmp, $r['body']) === false) {
        throw new RuntimeException('Couldn’t save the download. Check folder permissions.');
    }
    return $tmp;
}

/* ───────────────────────── currency rates ───────────────────────── */

/** Latest ECB rates as base units per 1 unit of each currency, e.g. ['EUR' => 1.17]. */
function fetch_fx_rates(string $base, array $currencies): array
{
    $currencies = array_values(array_diff(array_unique($currencies), [$base]));
    if (!$currencies) {
        return [];
    }
    $sources = [
        'https://api.frankfurter.dev/v1/latest?base=' . $base . '&symbols=' . implode(',', $currencies),
        'https://api.frankfurter.app/latest?from=' . $base . '&to=' . implode(',', $currencies),
    ];
    $lastError = 'No rate service answered.';
    foreach ($sources as $source) {
        try {
            $r = safe_request($source, 256 * 1024, 'application/json');
            $data = json_decode($r['body'], true);
            if ($r['status'] !== 200 || !is_array($data['rates'] ?? null)) {
                $lastError = 'The rate service answered with an error (' . $r['status'] . ').';
                continue;
            }
            $out = [];
            foreach ($data['rates'] as $code => $perBase) {
                if (is_numeric($perBase) && (float)$perBase > 0) {
                    $out[$code] = round(1 / (float)$perBase, 6);
                }
            }
            return $out;
        } catch (RuntimeException $e) {
            $lastError = $e->getMessage();
        }
    }
    throw new RuntimeException($lastError);
}
