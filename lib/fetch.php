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
const FETCH_MAX_REDIRECTS = 5;
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
    if ($packed === false) {
        return false;
    }
    // IPv4-mapped / NAT64 addresses hide an IPv4 address inside IPv6: check that one instead.
    if (substr($packed, 0, 12) === str_repeat("\0", 10) . "\xff\xff" || substr($packed, 0, 12) === "\x00\x64\xff\x9b" . str_repeat("\0", 8)) {
        return is_public_ip((string)inet_ntop(substr($packed, 12)));
    }
    $first = ord($packed[0]);
    return !($first === 0xfc || $first === 0xfd || $first === 0xfe || $first === 0xff);
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

        $body = '';
        $tooBig = false;
        $responseHeaders = [];
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_RESOLVE => [$host . ':' . $port . ':' . (strpos($ip, ':') !== false ? '[' . $ip . ']' : $ip)],
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

/** Unwraps Google redirect/search wrappers and strips tracking parameters. */
function normalize_link(string $url): string
{
    $url = trim($url, " \t\n\r\0\x0B<>\"'");
    for ($i = 0; $i < 3; $i++) {
        $p = parse_url($url);
        if (!$p || empty($p['host']) || !preg_match('/(^|\.)google\.[a-z.]+$/i', $p['host'])
            || !in_array($p['path'] ?? '', ['/url', '/search', '/imgres'], true)) {
            break;
        }
        parse_str($p['query'] ?? '', $q);
        $inner = '';
        foreach (['q', 'url', 'imgurl'] as $key) {
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
    $p = parse_url($url);
    if (!$p || empty($p['host']) || empty($p['scheme'])) {
        return $url;
    }
    $query = '';
    if (!empty($p['query'])) {
        $kept = [];
        foreach (explode('&', $p['query']) as $pair) {
            $key = strtolower(urldecode(explode('=', $pair, 2)[0]));
            if ($key === '' || preg_match('/^(utm_|mc_|_pos$|_sid$|_ss$|_psq$|_v$|gclid$|gbraid$|wbraid$|fbclid$|msclkid$|igshid$|ref_$|srsltid$|trk$|clickid$|irclickid$|ranmid$|ransiteid$)/', $key)) {
                continue;
            }
            $kept[] = $pair;
        }
        $query = $kept ? '?' . implode('&', $kept) : '';
    }
    return strtolower($p['scheme']) . '://' . strtolower($p['host']) . (isset($p['port']) ? ':' . $p['port'] : '')
        . ($p['path'] ?? '/') . $query;
}

/** "versace-medusa-rhapsody-ashtray-13cm-item-16661316.aspx" → "Versace Medusa Rhapsody Ashtray 13cm". */
function name_from_url(string $url): string
{
    $path = (string)parse_url($url, PHP_URL_PATH);
    $segments = array_values(array_filter(explode('/', $path), function ($s) {
        return $s !== '';
    }));
    $slug = '';
    for ($i = count($segments) - 1; $i >= 0; $i--) { // last segment that has words in it
        $candidate = urldecode($segments[$i]);
        $candidate = preg_replace('/\.(aspx?|html?|php)$/i', '', $candidate);
        $candidate = preg_replace('/[-_](item|p|prod|product|dp)[-_]?\d+$/i', '', $candidate);
        $candidate = preg_replace('/[-_]?\d{5,}$/', '', $candidate);
        if (preg_match('/[a-z]{3,}/i', (string)$candidate) && !in_array(strtolower((string)$candidate), ['products', 'product', 'shopping', 'women', 'men', 'dp', 'p'], true)) {
            $slug = (string)$candidate;
            break;
        }
    }
    $slug = preg_replace('/^((wo)?mens?[-_])+/i', '', $slug);
    $slug = preg_replace('/[-_]\d{1,2}$/', '', (string)$slug); // Shopify's "-1" duplicate suffix
    $slug = trim((string)preg_replace('/[-_+]+/', ' ', (string)$slug));
    if ($slug === '') {
        return '';
    }
    $words = array_map(function ($w) {
        return strlen($w) <= 2 && ctype_alpha($w) && !in_array(strtolower($w), ['of', 'on', 'in', 'to', 'by'], true)
            ? strtoupper($w) : ucfirst(strtolower($w));
    }, explode(' ', $slug));
    return mb_substr(implode(' ', $words), 0, 140);
}

/* ───────────────────────── product pages ───────────────────────── */

/**
 * Everything we can learn about a product from its link:
 * ['url','store','name','brand','variant','price','currency','image','found','blocked','error'].
 * Never throws: when the shop can't be reached, the name still comes from the link itself.
 */
function inspect_link(string $rawUrl): array
{
    $url = normalize_link($rawUrl);
    if (clean_url($url) === '') {
        throw new RuntimeException('That doesn’t look like a link. Paste the full address, starting with https://');
    }
    $info = [
        'url' => $url, 'store' => store_name($url), 'name' => '', 'brand' => '', 'variant' => '',
        'price' => null, 'currency' => '', 'image' => '', 'found' => false, 'blocked' => false, 'error' => '',
    ];

    // Shopify shops (amiri.com and many more) publish clean product JSON next to every product page.
    if (preg_match('#^(https?://[^/]+)(?:/[a-z]{2}(?:-[a-z]{2})?)?/products/([^/?#]+)#i', $url, $m)) {
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
                    $info['image'] = resolve_url($url, $image);
                }
                $info['found'] = true;
            }
        } catch (RuntimeException $e) {
            // fall through to the page itself
        }
    }

    try {
        $r = safe_request($url, FETCH_HTML_MAX, HTML_ACCEPT);
        if ($r['status'] >= 200 && $r['status'] < 300 && strpos($r['type'], 'html') !== false) {
            $page = parse_product_html($r['body'], $r['url']);
            foreach (['name', 'brand', 'variant', 'image', 'currency'] as $key) {
                if ($info[$key] === '' && $page[$key] !== '') {
                    $info[$key] = $page[$key];
                }
            }
            if ($info['price'] === null && $page['price'] !== null) {
                $info['price'] = $page['price'];
            }
            $info['found'] = $info['found'] || $page['name'] !== '';
        } elseif (in_array($r['status'], [401, 403, 429, 503], true)) {
            $info['blocked'] = true;
            $info['error'] = $info['store'] . ' blocked the automatic lookup.';
        } else {
            $info['error'] = $info['store'] . ' answered with an error (' . $r['status'] . ').';
        }
    } catch (RuntimeException $e) {
        $info['error'] = $e->getMessage();
    }

    if ($info['name'] === '') {
        $info['name'] = name_from_url($url) ?: $info['store'] . ' find';
    }
    if ($info['brand'] === '' && is_single_brand_store($url)) {
        $info['brand'] = $info['store'];
    }
    $info['name'] = tidy_product_name($info['name'], $info['brand'], $info['store']);
    if ($info['currency'] === '' && $info['price'] !== null) {
        $info['currency'] = guess_store_currency($url);
    }
    return $info;
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
    if ($out['name'] === '') {
        $title = $xp->query('//title')->item(0);
        $out['name'] = $title ? clean_text($title->textContent, 140) : '';
    }
    if ($out['image'] === '') {
        $out['image'] = $meta['og:image:secure_url'] ?? ($meta['og:image'] ?? ($meta['twitter:image'] ?? ($meta['image'] ?? '')));
    }
    if ($out['price'] === null) {
        $out['price'] = parse_amount($meta['product:price:amount'] ?? ($meta['og:price:amount'] ?? ($meta['price'] ?? null)));
    }
    if ($out['currency'] === '') {
        $out['currency'] = strtoupper(clean_text($meta['product:price:currency'] ?? ($meta['og:price:currency'] ?? ($meta['pricecurrency'] ?? '')), 3));
    }
    if ($out['brand'] === '') {
        $out['brand'] = clean_text($meta['product:brand'] ?? ($meta['og:brand'] ?? ''), 80);
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

/** Drops shop suffixes ("… | FARFETCH") and a duplicated brand prefix from a product name. */
function tidy_product_name(string $name, string $brand, string $store): string
{
    $name = trim((string)preg_replace('/\s*[|–—-]\s*(' . preg_quote($store, '/') . '|farfetch|amiri|ssense|shop now|buy online)[^|–—-]*$/i', '', $name));
    $name = trim((string)preg_replace('/\s*[|]\s*[^|]*$/', '', $name));
    if ($brand !== '' && stripos($name, $brand . ' ') === 0 && mb_strlen($name) > mb_strlen($brand) + 3) {
        $name = trim(mb_substr($name, mb_strlen($brand)));
    }
    return clean_text($name, 140);
}

/** Shops that only sell their own brand, so the store name is the brand. */
function is_single_brand_store(string $url): bool
{
    $multi = ['farfetch', 'ssense', 'net-a-porter', 'mrporter', 'mytheresa', 'matches', 'luisaviaroma', 'nordstrom',
        'saks', 'neimanmarcus', 'bergdorfgoodman', 'selfridges', 'harrods', 'amazon', 'sephora', 'etsy', 'revolve',
        'fwrd', 'shopbop', 'goat', 'stockx', 'therealreal', 'vestiairecollective', 'ebay'];
    $host = strtolower((string)parse_url($url, PHP_URL_HOST));
    foreach ($multi as $shop) {
        if (strpos($host, $shop) !== false) {
            return false;
        }
    }
    return true;
}

function guess_store_currency(string $url): string
{
    $host = strtolower((string)parse_url($url, PHP_URL_HOST));
    $tlds = ['.co.uk' => 'GBP', '.uk' => 'GBP', '.de' => 'EUR', '.fr' => 'EUR', '.it' => 'EUR', '.es' => 'EUR',
        '.nl' => 'EUR', '.eu' => 'EUR', '.ca' => 'CAD', '.com.au' => 'AUD', '.jp' => 'JPY', '.ch' => 'CHF'];
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
