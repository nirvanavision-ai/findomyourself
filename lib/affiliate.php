<?php
/*
 * FINDOM YOURSELF: affiliate links and click counting.
 *
 * Where a visitor's shop button goes (resolve_outbound), first match wins:
 *   1. the owner's own link for the item ("Your link": ShopMy, LTK, Amazon SiteStripe, an Awin deep link…),
 *      or a shop link that already is an affiliate link (never wrapped twice)
 *   2. the plain shop link, when affiliate links are off or the shop is on the "never" list
 *   3. Amazon: the product with her Associates tag for that marketplace (never through a network)
 *   4. a rule she taught it for that shop: a deep-link template ("…&ued={url}") or extra parameters
 *   5. the catch-all network (Skimlinks or Sovrn Commerce), which covers most other shops
 *   6. the plain shop link
 * Outbound links are built only from stored items and settings, never from a request, and
 * nothing here fetches anything: pasted affiliate links are recognized by their shape alone.
 *
 * <private>/clicks.json counts visitors' clicks on those buttons:
 *   items  {id: {total, days: {Y-m-d: n}, last}}   the last 90 days per item
 *   seen   {Y-m-d: {hash: 1}}                      who already counted today (today and yesterday only)
 *   rate   {hash: {t, n}}                          counted clicks per visitor in the last 10 minutes
 * Visitors are told apart by a salted hash, never a stored IP.
 */
declare(strict_types=1);

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/fetch.php';

const AMAZON_MARKETPLACES = [
    'com', 'ca', 'com.mx', 'com.br', 'co.uk', 'de', 'fr', 'it', 'es', 'nl', 'se', 'pl', 'com.be', 'com.tr',
    'ae', 'sa', 'in', 'co.jp', 'sg', 'com.au',
];
const AMAZON_COUNTRIES = [
    'com' => 'US', 'ca' => 'Canada', 'com.mx' => 'Mexico', 'com.br' => 'Brazil', 'co.uk' => 'UK', 'de' => 'Germany',
    'fr' => 'France', 'it' => 'Italy', 'es' => 'Spain', 'nl' => 'Netherlands', 'se' => 'Sweden', 'pl' => 'Poland',
    'com.be' => 'Belgium', 'com.tr' => 'Türkiye', 'ae' => 'UAE', 'sa' => 'Saudi Arabia', 'in' => 'India',
    'co.jp' => 'Japan', 'sg' => 'Singapore', 'com.au' => 'Australia',
];
const AMAZON_SHORT_HOSTS = ['amzn.to', 'amzn.eu', 'amzn.asia', 'a.co'];
const AMAZON_TAG_PATTERN = '/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/';
const AMAZON_SENTENCE = 'As an Amazon Associate I earn from qualifying purchases.';
const AFFILIATE_NETWORKS = ['skimlinks' => 'Skimlinks', 'sovrn' => 'Sovrn Commerce'];
const AFFILIATE_NETWORK_IDS = ['skimlinks' => '/^\d{2,10}X\d{2,12}$/', 'sovrn' => '/^[a-f0-9]{32}$/i'];
const MAX_AFFILIATE_RULES = 30;
const MAX_AFFILIATE_EXCLUDES = 50;
const AFFILIATE_PARAMS_MAX = 300;
const HOSTNAME_PATTERN = '/^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/';

/*
 * Affiliate networks' tracking links: [network, hosts (subdomains too), query keys that carry the
 * shop link (first found wins), query key that carries the publisher ID].
 */
const AFFILIATE_WRAPPERS = [
    ['Skimlinks', ['go.skimresources.com', 'go.redirectingat.com'], ['url'], 'id'],
    ['Sovrn', ['redirect.viglink.com'], ['u'], 'key'],
    ['Awin', ['awin1.com'], ['ued', 'p'], 'awinaffid'],
    ['Rakuten', ['click.linksynergy.com'], ['murl'], 'id'],
    ['CJ', ['anrdoezrs.net', 'jdoqocy.com', 'tkqlhce.com', 'dpbolvw.net', 'kqzyfj.com', 'qksrv.net', 'emjcd.com',
        'ftjcfx.com', 'lduhtrp.net', 'tqlkg.com', 'awltovhc.com', 'yceml.net'], ['url'], ''],
    ['Impact', ['sjv.io', 'pxf.io', 'evyy.net', 'ojrq.net', '7eer.net'], ['u'], ''],
    ['ShareASale', ['shareasale.com'], ['urllink'], 'u'],
    ['Pepperjam', ['pjtra.com', 'pjatr.com', 'gopjn.com'], ['url'], ''],
    ['FlexOffers', ['flexlinkspro.com'], ['url'], 'foid'],
];
/* Creator platforms: each link is made for one product in their app, and leads there by redirect. */
const CREATOR_LINK_HOSTS = [
    'shopmy.us' => 'ShopMy', 'shop-links.co' => 'ShopMy',
    'liketk.it' => 'LTK', 'shopltk.com' => 'LTK', 'rstyle.me' => 'LTK',
    'howl.me' => 'Howl', 'howl.link' => 'Howl',
    'geni.us' => 'Geniuslink',
];
const SHORT_LINK_HOSTS = ['bit.ly', 'tinyurl.com', 't.co', 'ow.ly', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'lnk.to'];
/* eBay Partner Network adds these to eBay's own links (customid is per link, so it isn't learned). */
const EBAY_PARTNER_PARAMS = ['mkcid', 'mkrid', 'siteid', 'campid', 'toolid', 'mkevt'];
/* Query keys that often carry the real destination in networks we don't know by name. */
const DESTINATION_KEYS = ['url', 'u', 'murl', 'ued', 'dest', 'destination', 'redirect', 'target', 'link'];

const CLICK_WINDOW = 600;
const CLICK_MAX_PER_WINDOW = 60;
const CLICK_KEEP_DAYS = 90;
const CLICK_MAX_SEEN_PER_DAY = 5000; // a flood of "visitors" stops being counted instead of growing the file
const CLICK_MAX_VISITORS = 1000;
const CLICK_BOT_PATTERN = '/bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora|pinterest|whatsapp|telegram|discord|curl|wget|python|headless/i';

/* ───────────────────────── links ───────────────────────── */

/** Lowercase host of a link without "www.", or ''. */
function link_host(string $url): string
{
    $host = strtolower(rtrim((string)parse_url($url, PHP_URL_HOST), '.'));
    return (string)preg_replace('/^www\./', '', $host);
}

/** Whether $host is one of $domains or a subdomain of one. */
function host_matches(string $host, array $domains): bool
{
    $host = (string)preg_replace('/^www\./', '', strtolower(rtrim($host, '.')));
    if ($host === '') {
        return false;
    }
    foreach ($domains as $domain) {
        $domain = strtolower((string)$domain);
        if ($domain !== '' && ($host === $domain || substr($host, -strlen($domain) - 1) === '.' . $domain)) {
            return true;
        }
    }
    return false;
}

/** "shop.example.co.uk" → "example.co.uk": close enough to tell one site from another. */
function registrable_domain(string $host): string
{
    $labels = explode('.', strtolower($host));
    $n = count($labels);
    if ($n <= 2) {
        return strtolower($host);
    }
    $take = strlen($labels[$n - 1]) === 2 && preg_match('/^(co|com|net|org|gov|edu|ac|ne|or)$/', $labels[$n - 2]) ? 3 : 2;
    return implode('.', array_slice($labels, -$take));
}

/** "https://www.Gucci.com/us/en" → "gucci.com"; '' when it isn't a domain. */
function clean_domain($value): string
{
    if (!is_string($value)) {
        return '';
    }
    $domain = strtolower(trim($value));
    $domain = (string)preg_replace('#^[a-z][a-z0-9+.-]*://#', '', $domain);
    $domain = (string)preg_replace('#[/?\#].*$#s', '', $domain);
    $domain = (string)preg_replace('/:\d+$/', '', $domain);
    $domain = (string)preg_replace('/^(\*\.|www\.)/', '', rtrim($domain, '.'));
    return preg_match(HOSTNAME_PATTERN, $domain) ? $domain : '';
}

/** 'com', 'co.uk'… for an Amazon store link, or null (short links like amzn.to aren't a marketplace). */
function amazon_marketplace(string $url): ?string
{
    $host = strtolower((string)parse_url($url, PHP_URL_HOST));
    if (!preg_match('/^(?:(?:www|smile|m)\.)?amazon\.([a-z.]+)$/', $host, $m)) {
        return null;
    }
    return in_array($m[1], AMAZON_MARKETPLACES, true) ? $m[1] : null;
}

/** Any link to Amazon: a store (amazon.<tld>, even one not listed) or one of its short links. */
function is_amazon_link(string $url): bool
{
    $host = link_host($url);
    return preg_match('/(^|\.)amazon\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/', $host) === 1
        || in_array($host, AMAZON_SHORT_HOSTS, true);
}

/** Marketplaces for the Control Room: ['com' => 'amazon.com (US)', …]. */
function amazon_marketplace_names(): array
{
    $names = [];
    foreach (AMAZON_MARKETPLACES as $market) {
        $names[$market] = 'amazon.' . $market . ' (' . AMAZON_COUNTRIES[$market] . ')';
    }
    return $names;
}

/** A string query value, or ''. */
function query_value(array $query, string $key): string
{
    return is_string($query[$key] ?? null) ? $query[$key] : '';
}

/** $url with ?$key=$value set (replacing any old value), keeping everything else as it was. */
function set_query_param(string $url, string $key, string $value): string
{
    $fragment = '';
    if (($hash = strpos($url, '#')) !== false) {
        $fragment = substr($url, $hash);
        $url = substr($url, 0, $hash);
    }
    [$base, $query] = array_pad(explode('?', $url, 2), 2, '');
    $pairs = [];
    foreach (explode('&', $query) as $pair) {
        if ($pair !== '' && urldecode(explode('=', $pair, 2)[0]) !== $key) {
            $pairs[] = $pair;
        }
    }
    $pairs[] = rawurlencode($key) . '=' . rawurlencode($value);
    return $base . '?' . implode('&', $pairs) . $fragment;
}

/** $url without ?$key, keeping everything else as it was. */
function remove_query_param(string $url, string $key): string
{
    [$rest, $fragment] = array_pad(explode('#', $url, 2), 2, null);
    [$base, $query] = array_pad(explode('?', $rest, 2), 2, '');
    $pairs = array_filter(explode('&', $query), function ($pair) use ($key) {
        return $pair !== '' && urldecode(explode('=', $pair, 2)[0]) !== $key;
    });
    return $base . ($pairs ? '?' . implode('&', $pairs) : '') . ($fragment !== null ? '#' . $fragment : '');
}

/* ───────────────────────── where a button goes ───────────────────────── */

/**
 * Where a visitor's button for $item goes: ['url', 'kind' (mine|amazon|rule|network|plain|none),
 * 'label' (for the Control Room), 'affiliate' (needs the disclosure), 'amazon' (needs Amazon's sentence)].
 */
function resolve_outbound(array $item, array $settings): array
{
    $mine = (string)($item['affiliateUrl'] ?? '');
    if ($mine !== '') {
        return own_outbound($mine);
    }
    $url = (string)($item['url'] ?? '');
    if ($url === '') {
        return outbound_link('', 'none', 'No link');
    }
    $a = is_array($settings['affiliate'] ?? null) ? $settings['affiliate'] : [];
    $host = link_host($url);
    $on = !empty($a['enabled']) && !host_matches($host, (array)($a['exclude'] ?? []));
    $market = amazon_marketplace($url);
    $tag = $on && $market !== null ? (string)($a['amazon'][$market] ?? '') : '';
    // A shop link that is itself an affiliate or creator link (typed in as the shop link, or left
    // behind when "Your link" was cleared) goes out as it is, like her own link: wrapping it again
    // would break it. Only an Amazon link is rewritten, to carry her own tag.
    $found = detect_affiliate_link($url);
    if ($found && $found['network'] !== 'Short link' && !($found['kind'] === 'amazon' && $tag !== '')) {
        return own_outbound($url, 'Affiliate link');
    }
    if (!$on) {
        return outbound_link($url, 'plain', 'Plain link');
    }
    if (is_amazon_link($url)) { // Amazon only pays through Associates: never through a network
        if ($tag === '') {
            return outbound_link($url, 'plain', 'Plain link');
        }
        $asin = (string)amazon_asin($url);
        $link = preg_match('/^[A-Z0-9]{10}$/', $asin)
            ? 'https://www.amazon.' . $market . '/dp/' . $asin . '?tag=' . rawurlencode($tag)
            : set_query_param($url, 'tag', $tag);
        return outbound_link($link, 'amazon', 'Amazon Associates · ' . $tag, true);
    }
    foreach ((array)($a['rules'] ?? []) as $rule) {
        if (host_matches($host, $rule['domains'])) {
            return outbound_link(apply_rule($rule, $url), 'rule', $rule['label']);
        }
    }
    $network = (string)($a['network'] ?? 'none');
    $id = (string)($a['networkId'] ?? '');
    if (isset(AFFILIATE_NETWORKS[$network]) && preg_match(AFFILIATE_NETWORK_IDS[$network], $id)) {
        $itemId = rawurlencode((string)($item['id'] ?? ''));
        $link = $network === 'skimlinks'
            ? 'https://go.skimresources.com/?id=' . rawurlencode($id) . '&xs=1&url=' . rawurlencode($url) . '&xcust=' . $itemId
            : 'https://redirect.viglink.com/?key=' . rawurlencode($id) . '&u=' . rawurlencode($url) . '&cuid=' . $itemId;
        return outbound_link($link, 'network', AFFILIATE_NETWORKS[$network]);
    }
    return outbound_link($url, 'plain', 'Plain link');
}

/** One answer of resolve_outbound(). */
function outbound_link(string $url, string $kind, string $label, bool $amazon = false): array
{
    return [
        'url' => $url,
        'kind' => $kind,
        'label' => $label,
        'affiliate' => in_array($kind, ['mine', 'amazon', 'rule', 'network'], true),
        'amazon' => $amazon,
    ];
}

/**
 * Her own link, used exactly as it is: "Your link (ShopMy)", "Your link (Amazon)", or just "Your link"
 * ("Affiliate link (Awin)" when it's the shop link itself).
 */
function own_outbound(string $link, string $label = 'Your link'): array
{
    $found = detect_affiliate_link($link);
    $network = $found && $found['network'] !== 'Short link' ? preg_replace('/\s*\(.*\)$/', '', $found['network']) : '';
    return outbound_link($link, 'mine', $network !== '' ? $label . ' (' . $network . ')' : $label, is_amazon_link($link));
}

/** $url through one of her rules: a deep-link template ("…&ued={url}") or extra parameters. */
function apply_rule(array $rule, string $url): string
{
    if (($rule['mode'] ?? '') === 'wrap') {
        return str_replace('{url}', rawurlencode($url), (string)($rule['value'] ?? ''));
    }
    parse_str((string)($rule['value'] ?? ''), $params);
    foreach ($params as $key => $value) {
        if (is_string($value)) {
            $url = set_query_param($url, (string)$key, $value);
        }
    }
    return $url;
}

/** Store name for an item: from its shop link (or else her own link), looking inside affiliate links. */
function item_store(array $item): string
{
    $url = (string)($item['url'] ?? '') ?: (string)($item['affiliateUrl'] ?? '');
    if ($url === '') {
        return '';
    }
    $found = detect_affiliate_link($url);
    if (!$found || $found['kind'] === 'amazon') {
        return store_name($url);
    }
    if ($found['destination'] !== '') {
        return store_name($found['destination']);
    }
    return is_amazon_link($url) ? 'Amazon' : ''; // a creator or short link doesn't say which shop it is
}

/**
 * The disclosure under the site: her note (plus Amazon's required sentence when Amazon links
 * are used) when any of $outbounds is an affiliate link, else ''.
 */
function affiliate_note(array $outbounds, array $settings): string
{
    $affiliate = $amazon = false;
    foreach ($outbounds as $out) {
        $affiliate = $affiliate || $out['affiliate'];
        $amazon = $amazon || $out['amazon'];
    }
    if (!$affiliate) {
        return '';
    }
    $note = (string)($settings['copy']['affiliateNote'] ?? '');
    if ($amazon && stripos($note, 'Amazon Associate') === false) {
        $note = trim($note . ' ' . AMAZON_SENTENCE);
    }
    return $note;
}

/* ───────────────────────── recognizing pasted links ───────────────────────── */

/** One answer of detect_affiliate_link(). */
function affiliate_found(string $network, string $kind, string $destination = '', string $param = '', string $id = '', string $marketplace = ''): array
{
    return [
        'network' => $network,
        'kind' => $kind,
        'destination' => $destination,
        'param' => $param,
        'id' => clean_text($id, 80),
        'marketplace' => $marketplace,
    ];
}

/** A destination carried inside another link, decoded (twice-encoded ones too), or ''. */
function decoded_destination(string $value, bool $schemeless = false): string
{
    $value = trim($value);
    for ($i = 0; $i < 2 && preg_match('#^https?%3A#i', $value); $i++) {
        $value = rawurldecode($value);
    }
    if ($schemeless && $value !== '' && !preg_match('#^https?://#i', $value)) {
        $value = 'https://' . ltrim($value, '/');
    }
    return clean_url($value);
}

/**
 * Recognizes an affiliate, creator or short link by its shape (nothing is fetched):
 * ['network' ('Awin'), 'kind' (wrapper|amazon|creator|short), 'destination' (the shop link inside it,
 * '' when it has to be followed), 'param' (query key carrying it), 'id' (publisher ID or Amazon tag),
 * 'marketplace' (Amazon's tld)], or null for an ordinary link.
 */
function detect_affiliate_link(string $url): ?array
{
    $url = clean_url($url);
    if ($url === '') {
        return null;
    }
    $parts = parse_url($url);
    $host = link_host($url);
    $path = (string)($parts['path'] ?? '/');
    parse_str((string)($parts['query'] ?? ''), $query);

    $market = amazon_marketplace($url);
    if ($market !== null || is_amazon_link($url)) {
        if (in_array($host, AMAZON_SHORT_HOSTS, true)) {
            return affiliate_found('Amazon (short link)', 'short');
        }
        $tag = query_value($query, 'tag');
        if ($market === null || $tag === '') {
            return null; // a plain Amazon link
        }
        return affiliate_found('Amazon Associates', 'amazon', remove_query_param(canonical_product_url($url), 'tag'), '', $tag, $market);
    }
    // eBay Partner Network's tracking rides on eBay's own links ("…/itm/123?mkcid=1&campid=5338…").
    if (preg_match('/(^|\.)ebay\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/', $host)
        && query_value($query, 'campid') !== '' && query_value($query, 'mkcid') !== '') {
        return affiliate_found('eBay Partner Network', 'wrapper', canonical_product_url($url), '', query_value($query, 'campid'));
    }

    if (host_matches($host, ['prf.hn'])) {
        $destination = preg_match('#/destination:(.+)$#s', $url, $m) ? decoded_destination($m[1]) : '';
        $id = preg_match('#/camref:([^/]+)#', $path, $m) ? $m[1] : '';
        return affiliate_found('Partnerize', 'wrapper', $destination, '', $id);
    }
    foreach (AFFILIATE_WRAPPERS as [$network, $hosts, $keys, $idKey]) {
        // Impact also runs on brands' own domains ("goto.brand.com/c/1234/5678/90?u=…").
        $impactPath = $network === 'Impact' && preg_match('#^/c/\d+/\d+/\d+#', $path) && query_value($query, 'u') !== '';
        if (!$impactPath && !host_matches($host, $hosts)) {
            continue;
        }
        $destination = '';
        $param = '';
        foreach ($keys as $key) {
            $destination = decoded_destination(query_value($query, $key), $network === 'ShareASale');
            if ($destination !== '') {
                $param = $key;
                break;
            }
        }
        $id = $idKey !== '' ? query_value($query, $idKey) : '';
        if ($network === 'CJ' && preg_match('#/click-(\d+)-#', $path, $m)) {
            $id = $m[1];
        } elseif ($network === 'Impact' && preg_match('#^/c/(\d+)/#', $path, $m)) {
            $id = $m[1];
        }
        return affiliate_found($network, 'wrapper', $destination, $param, $id);
    }
    foreach (CREATOR_LINK_HOSTS as $domain => $network) {
        if (host_matches($host, [$domain])) {
            return affiliate_found($network, 'creator');
        }
    }
    if (host_matches($host, SHORT_LINK_HOSTS)) {
        return affiliate_found('Short link', 'short');
    }
    foreach (DESTINATION_KEYS as $key) {
        $destination = decoded_destination(query_value($query, $key));
        if ($destination !== '' && registrable_domain(link_host($destination)) !== registrable_domain($host)) {
            return affiliate_found('Affiliate network', 'wrapper', $destination, $key);
        }
    }
    return null;
}

/** The catch-all network setting ('skimlinks'/'sovrn') a detected network name stands for, or ''. */
function catch_all_network(string $network): string
{
    return ['Skimlinks' => 'skimlinks', 'Sovrn' => 'sovrn'][$network] ?? '';
}

/**
 * Turns one of her affiliate links into something that works for every product:
 *   a network's deep link → ['network', 'domain', 'rule' => {label, domains, mode: 'wrap', value: template}]
 *   an Amazon link with her tag → ['network' => 'Amazon Associates', 'domain', 'amazon' => [tld => tag]]
 *   a Skimlinks/Sovrn link → ['network', 'domain' => '', 'catchAll' => {network, networkId}]
 * Creator and short links are per product (they go in the item's "Your link"): null.
 */
function learn_affiliate_link(string $url): ?array
{
    $url = clean_url($url);
    $found = detect_affiliate_link($url);
    if (!$found) {
        return null;
    }
    if ($found['kind'] === 'amazon') {
        if ($found['marketplace'] === '' || !preg_match(AMAZON_TAG_PATTERN, $found['id'])) {
            return null;
        }
        return ['network' => 'Amazon Associates', 'domain' => 'amazon.' . $found['marketplace'], 'amazon' => [$found['marketplace'] => $found['id']]];
    }
    if ($found['kind'] !== 'wrapper' || $found['destination'] === '') {
        return null;
    }
    $catchAll = catch_all_network($found['network']);
    if ($catchAll !== '') {
        $id = $catchAll === 'skimlinks' ? strtoupper($found['id']) : strtolower($found['id']);
        if (!preg_match(AFFILIATE_NETWORK_IDS[$catchAll], $id)) {
            return null;
        }
        return ['network' => $found['network'], 'domain' => '', 'catchAll' => ['network' => $catchAll, 'networkId' => $id]];
    }
    $domain = link_host($found['destination']);
    if ($domain === '' || is_amazon_link($found['destination'])) {
        return null; // Amazon only pays through Associates
    }
    $ebay = $found['network'] === 'eBay Partner Network'; // its tracking is a set of parameters, not a wrapper
    $rule = normalize_affiliate_rule([
        'label' => $found['network'] . ' · ' . $domain,
        'domains' => [$domain],
        'mode' => $ebay ? 'params' : 'wrap',
        'value' => $ebay ? ebay_partner_params($url) : affiliate_template($url, $found),
    ]);
    if (!$rule) {
        return null;
    }
    unset($rule['id']);
    return ['network' => $found['network'], 'domain' => $domain, 'rule' => $rule];
}

/** Her deep link with the shop link inside it swapped for {url}, over HTTPS, or ''. */
function affiliate_template(string $url, array $found): string
{
    $url = (string)preg_replace('#^http://#i', 'https://', $url);
    if ($found['network'] === 'Partnerize') {
        $at = strpos($url, '/destination:');
        return $at === false ? '' : substr($url, 0, $at) . '/destination:{url}';
    }
    if ($found['param'] === '') {
        return '';
    }
    [$base, $query] = array_pad(explode('?', explode('#', $url, 2)[0], 2), 2, '');
    $pairs = [];
    $placed = false;
    foreach (explode('&', $query) as $pair) {
        if ($pair === '') {
            continue;
        }
        $key = explode('=', $pair, 2)[0];
        if (urldecode($key) === $found['param']) {
            if (!$placed) {
                $pairs[] = $key . '={url}';
                $placed = true;
            }
            continue;
        }
        $pairs[] = $pair;
    }
    return $placed ? $base . '?' . implode('&', $pairs) : '';
}

/** eBay Partner Network's parameters from one of her eBay links ("mkcid=1&mkrid=…&campid=…"), or ''. */
function ebay_partner_params(string $url): string
{
    parse_str((string)parse_url($url, PHP_URL_QUERY), $query);
    $params = [];
    foreach (EBAY_PARTNER_PARAMS as $key) {
        if (query_value($query, $key) !== '') {
            $params[$key] = $query[$key];
        }
    }
    return clean_rule_params(http_build_query($params, '', '&', PHP_QUERY_RFC3986));
}

/** Whether a learned link would change her settings (a shop without a rule, a missing tag, no catch-all yet). */
function affiliate_suggestion_is_new(array $learned, array $affiliate): bool
{
    if (isset($learned['amazon'])) {
        return (string)($affiliate['amazon'][(string)array_key_first($learned['amazon'])] ?? '') === '';
    }
    if (isset($learned['catchAll'])) {
        return ($affiliate['network'] ?? 'none') === 'none';
    }
    if (isset($learned['rule'])) {
        if (host_matches($learned['domain'], (array)($affiliate['exclude'] ?? []))) {
            return false;
        }
        foreach ((array)($affiliate['rules'] ?? []) as $rule) {
            if (host_matches($learned['domain'], $rule['domains'])) {
                return false;
            }
        }
        return true;
    }
    return false;
}

/** Her affiliate settings with a learned link applied (a shop's new rule replaces its old one). */
function apply_learned_link(array $affiliate, array $learned): array
{
    if (isset($learned['amazon'])) {
        $affiliate['amazon'] = array_merge((array)$affiliate['amazon'], $learned['amazon']);
    } elseif (isset($learned['catchAll'])) {
        $affiliate['network'] = $learned['catchAll']['network'];
        $affiliate['networkId'] = $learned['catchAll']['networkId'];
    } elseif (isset($learned['rule'])) {
        $domain = $learned['domain'];
        $rules = [];
        foreach ((array)$affiliate['rules'] as $rule) {
            $rule['domains'] = array_values(array_filter($rule['domains'], function ($d) use ($domain) {
                return $d !== $domain;
            }));
            if ($rule['domains']) {
                $rules[] = $rule;
            }
        }
        $rules[] = $learned['rule'];
        $affiliate['rules'] = $rules;
    }
    return $affiliate;
}

/** What a learned link set up, in words: "Awin · farfetch.com", "Amazon Associates · name-20", "Skimlinks". */
function learned_label(array $learned): string
{
    if (isset($learned['rule'])) {
        return $learned['rule']['label'];
    }
    if (isset($learned['amazon'])) {
        return 'Amazon Associates · ' . implode(', ', $learned['amazon']);
    }
    return AFFILIATE_NETWORKS[$learned['catchAll']['network'] ?? ''] ?? $learned['network'];
}

/**
 * A pasted affiliate link that does nothing her settings don't already do: an Amazon link with
 * the tag she saved for that marketplace, or a catch-all link with her own catch-all ID.
 */
function affiliate_link_redundant(array $found, array $affiliate): bool
{
    if ($found['kind'] === 'amazon') {
        return $found['id'] !== '' && (string)($affiliate['amazon'][$found['marketplace']] ?? '') === $found['id'];
    }
    $catchAll = catch_all_network($found['network']);
    return $catchAll !== '' && $found['destination'] !== '' && ($affiliate['network'] ?? '') === $catchAll
        && strcasecmp((string)$affiliate['networkId'], $found['id']) === 0;
}

/* ───────────────────────── settings ───────────────────────── */

/** The affiliate settings, cleaned: anything that isn't valid is dropped (see default_settings()). */
function normalize_affiliate($in): array
{
    $in = is_array($in) ? $in : [];
    $out = default_settings()['affiliate'];
    if (array_key_exists('enabled', $in)) {
        $out['enabled'] = (bool)$in['enabled'];
    }
    $amazon = is_array($in['amazon'] ?? null) ? $in['amazon'] : [];
    foreach (AMAZON_MARKETPLACES as $market) {
        $tag = is_string($amazon[$market] ?? null) ? trim($amazon[$market]) : '';
        if (preg_match(AMAZON_TAG_PATTERN, $tag)) {
            $out['amazon'][$market] = $tag;
        }
    }
    $network = is_string($in['network'] ?? null) ? $in['network'] : 'none';
    $id = is_string($in['networkId'] ?? null) ? trim($in['networkId']) : '';
    $id = $network === 'skimlinks' ? strtoupper($id) : strtolower($id);
    if (isset(AFFILIATE_NETWORKS[$network]) && preg_match(AFFILIATE_NETWORK_IDS[$network], $id)) {
        $out['network'] = $network;
        $out['networkId'] = $id;
    }
    $seen = [];
    foreach (array_slice(is_array($in['rules'] ?? null) ? $in['rules'] : [], 0, 100) as $raw) {
        $rule = normalize_affiliate_rule($raw);
        if (!$rule) {
            continue;
        }
        if (isset($seen[$rule['id']])) {
            $rule['id'] = new_id('r');
        }
        $seen[$rule['id']] = true;
        $out['rules'][] = $rule;
        if (count($out['rules']) >= MAX_AFFILIATE_RULES) {
            break;
        }
    }
    $exclude = $in['exclude'] ?? [];
    $exclude = is_string($exclude) ? preg_split('/[\s,]+/', $exclude) : $exclude;
    foreach (array_slice(is_array($exclude) ? $exclude : [], 0, 200) as $raw) {
        $domain = clean_domain($raw);
        if ($domain !== '' && !in_array($domain, $out['exclude'], true)) {
            $out['exclude'][] = $domain;
            if (count($out['exclude']) >= MAX_AFFILIATE_EXCLUDES) {
                break;
            }
        }
    }
    return $out;
}

/** One shop rule {id, label, domains, mode, value}, or null if it can't work. */
function normalize_affiliate_rule($raw): ?array
{
    if (!is_array($raw)) {
        return null;
    }
    $domains = [];
    $list = $raw['domains'] ?? [];
    $list = is_string($list) ? preg_split('/[\s,]+/', $list) : $list;
    foreach (array_slice(is_array($list) ? $list : [], 0, 50) as $domain) {
        $domain = clean_domain($domain);
        if ($domain !== '' && !in_array($domain, $domains, true)) {
            $domains[] = $domain;
        }
    }
    $domains = array_slice($domains, 0, 10);
    $mode = $raw['mode'] ?? '';
    if (!$domains || !in_array($mode, ['wrap', 'params'], true)) {
        return null;
    }
    $value = $mode === 'wrap' ? clean_rule_template($raw['value'] ?? '') : clean_rule_params($raw['value'] ?? '');
    if ($value === '') {
        return null;
    }
    $label = clean_text($raw['label'] ?? '', 60);
    if ($label === '') {
        $found = $mode === 'wrap' ? detect_affiliate_link(str_replace('{url}', rawurlencode('https://' . $domains[0] . '/'), $value)) : null;
        $label = $found && $found['network'] !== 'Affiliate network' ? mb_substr($found['network'] . ' · ' . $domains[0], 0, 60) : $domains[0];
    }
    $id = $raw['id'] ?? null;
    return [
        'id' => is_string($id) && preg_match('/^r_[a-z0-9]{1,40}$/', $id) ? $id : new_id('r'),
        'label' => $label,
        'domains' => $domains,
        'mode' => $mode,
        'value' => $value,
    ];
}

/** A deep-link template: an https:// link with {url} exactly once (after the host), or ''. */
function clean_rule_template($value): string
{
    $url = clean_url(is_string($value) ? trim($value) : '');
    if ($url === '' || substr_count($url, '{url}') !== 1 || preg_match('/[{}]/', str_replace('{url}', '', $url))
        || !preg_match('#^https://([^/?\#]+)[/?\#]#i', $url, $m) || !preg_match(HOSTNAME_PATTERN, strtolower($m[1]))) {
        return '';
    }
    return $url;
}

/** Extra parameters like "sca_ref=123.abc&utm_source=me", rebuilt cleanly, or ''. */
function clean_rule_params($value): string
{
    $value = is_string($value) ? trim($value) : '';
    $value = (string)preg_replace('/^\?/', '', $value);
    if ($value === '' || strlen($value) > AFFILIATE_PARAMS_MAX || preg_match('/[?{}#\s]/', $value)) {
        return '';
    }
    parse_str($value, $params);
    $clean = [];
    foreach ($params as $key => $param) {
        if (is_string($param) && preg_match('/^[A-Za-z0-9_.-]{1,60}$/', (string)$key)) {
            $clean[(string)$key] = clean_text($param, AFFILIATE_PARAMS_MAX);
        }
    }
    return $clean ? http_build_query($clean, '', '&', PHP_QUERY_RFC3986) : '';
}

/* ───────────────────────── clicks ───────────────────────── */

/** Visitors' clicks per item (see the top of this file). */
function clicks_file(): string
{
    return private_dir() . '/clicks.json';
}

/** clicks.json, cleaned up: ['items' => [id => {total, days, last}], 'seen' => …, 'rate' => …]. */
function load_clicks(): array
{
    $raw = read_json(clicks_file(), []);
    $items = [];
    foreach ((array)($raw['items'] ?? []) as $id => $count) {
        if (!valid_id($id) || !is_array($count)) {
            continue;
        }
        $days = [];
        foreach ((array)($count['days'] ?? []) as $day => $n) {
            if (is_string($day) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) {
                $days[$day] = max(0, (int)$n);
            }
        }
        $items[$id] = ['total' => max(0, (int)($count['total'] ?? 0)), 'days' => $days, 'last' => clean_iso($count['last'] ?? null)];
    }
    $seen = [];
    foreach ((array)($raw['seen'] ?? []) as $day => $hashes) {
        if (is_string($day) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $day) && is_array($hashes)) {
            $seen[$day] = $hashes;
        }
    }
    $rate = [];
    foreach ((array)($raw['rate'] ?? []) as $key => $entry) {
        if (is_array($entry)) {
            $rate[(string)$key] = ['t' => (int)($entry['t'] ?? 0), 'n' => max(0, (int)($entry['n'] ?? 0))];
        }
    }
    return ['items' => $items, 'seen' => $seen, 'rate' => $rate];
}

/** Clicks on one item: ['total', 'week' (the last 7 local days), 'last' (ISO time or null)]. */
function click_summary(array $clicks, string $id, string $timezone): array
{
    static $since = [];
    $count = $clicks['items'][$id] ?? null;
    if (!$count) {
        return ['total' => 0, 'week' => 0, 'last' => null];
    }
    $since[$timezone] = $since[$timezone] ?? (new DateTimeImmutable('now', new DateTimeZone($timezone)))->modify('-6 days')->format('Y-m-d');
    $week = 0;
    foreach ($count['days'] as $day => $n) {
        if ($day >= $since[$timezone]) {
            $week += $n;
        }
    }
    return ['total' => $count['total'], 'week' => $week, 'last' => $count['last']];
}

/** Link previews, crawlers and scripts (and requests that don't say what they are) aren't visitors. */
function is_bot_agent(string $agent): bool
{
    return trim($agent) === '' || preg_match(CLICK_BOT_PATTERN, $agent) === 1;
}

/**
 * Counts this visitor's click on item $id (the caller checks that the item exists). At most once
 * per visitor, item and local day, at most 60 per visitor per 10 minutes, and never for bots.
 * Returns whether it counted; nothing is written when it didn't. Needs lib/auth.php (site_secret).
 */
function count_click(string $id, string $timezone, ?int $now = null): bool
{
    if (!valid_id($id) || is_bot_agent((string)($_SERVER['HTTP_USER_AGENT'] ?? ''))) {
        return false;
    }
    $now = $now ?? time();
    $tz = new DateTimeZone($timezone);
    $today = local_day($now, $tz);
    $yesterday = (new DateTimeImmutable($today . ' 12:00:00', $tz))->modify('-1 day')->format('Y-m-d');
    $oldest = (new DateTimeImmutable($today . ' 12:00:00', $tz))->modify('-' . (CLICK_KEEP_DAYS - 1) . ' days')->format('Y-m-d');
    $secret = site_secret();
    $seenKey = substr(hash_hmac('sha256', client_key() . '|' . $id . '|' . $today, $secret), 0, 20);
    $rateKey = substr(hash_hmac('sha256', client_key() . '|clicks', $secret), 0, 20);

    return with_lock(clicks_file(), function () use ($id, $now, $today, $yesterday, $oldest, $seenKey, $rateKey) {
        $clicks = load_clicks();
        if (isset($clicks['seen'][$today][$seenKey])) {
            return false; // already counted today
        }
        $clicks['seen'] = array_intersect_key($clicks['seen'], [$today => true, $yesterday => true]);
        foreach ($clicks['rate'] as $key => $entry) {
            if ($now - $entry['t'] > CLICK_WINDOW) {
                unset($clicks['rate'][$key]);
            }
        }
        $entry = $clicks['rate'][$rateKey] ?? ['t' => $now, 'n' => 0];
        if ($entry['n'] >= CLICK_MAX_PER_WINDOW) {
            return false;
        }
        if (count($clicks['seen'][$today] ?? []) >= CLICK_MAX_SEEN_PER_DAY
            || (!isset($clicks['rate'][$rateKey]) && count($clicks['rate']) >= CLICK_MAX_VISITORS)) {
            return false;
        }
        $clicks['rate'][$rateKey] = ['t' => $entry['t'], 'n' => $entry['n'] + 1];
        $clicks['seen'][$today][$seenKey] = 1;
        $count = $clicks['items'][$id] ?? ['total' => 0, 'days' => [], 'last' => null];
        $count['total']++;
        $count['days'][$today] = ($count['days'][$today] ?? 0) + 1;
        $count['days'] = array_filter($count['days'], function ($day) use ($oldest) {
            return $day >= $oldest;
        }, ARRAY_FILTER_USE_KEY);
        krsort($count['days']);
        $count['last'] = gmdate('Y-m-d\TH:i:s\Z', $now);
        $clicks['items'][$id] = $count;
        write_json(clicks_file(), $clicks);
        return true;
    });
}
