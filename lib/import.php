<?php
/*
 * FINDOM YOURSELF: turns a pasted wishlist into items, whatever it came from
 * (Gemini, ChatGPT, Notes, a spreadsheet, or a pile of links). It understands:
 *
 *   ### Footwear & Accessories                       → category for what follows
 *   5. **Versace Gianni Ribbon Sandals (Red)**        → brand, name, variant
 *   * **Price:** 1.150 € ($1,250 USD)                 → 1150 EUR (the first amount wins)
 *   * **Direct Link:** [Farfetch – …](https://…)      → link (Google wrappers and utm_ tags removed)
 *   ---                                               → end of item
 *
 *   Versace Medusa ashtray – 271 € – https://…        one item per line, any separator
 *   Name<TAB>Price<TAB>Link                           rows copied from a spreadsheet
 *   https://amiri.com/products/…                      bare links (named from the link)
 */
declare(strict_types=1);

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/fetch.php';

const IMPORT_MAX_ITEMS = 200;
const IMPORT_FIELDS = [
    'price' => ['price', 'cost', 'retail', 'retail price', 'amount', 'msrp'],
    'url' => ['link', 'direct link', 'url', 'product link', 'buy', 'buy here', 'shop', 'shop here', 'where', 'store link'],
    'brand' => ['brand', 'designer', 'maker', 'label', 'house'],
    'variant' => ['color', 'colour', 'size', 'variant', 'option', 'style', 'finish', 'colorway'],
    'note' => ['note', 'notes', 'why', 'comment', 'details', 'description'],
    'category' => ['category', 'section', 'type'],
    'priority' => ['priority', 'want level', 'urgency'],
    'image' => ['image', 'photo', 'picture', 'img', 'image link', 'photo link'],
];
const CURRENCY_SYMBOLS = ['€' => 'EUR', '£' => 'GBP', '¥' => 'JPY', '₩' => 'KRW', '₹' => 'INR', '₪' => 'ILS', '$' => 'USD'];

/**
 * Returns a list of ['name','brand','variant','category','price','currency','url','image','note','priority'].
 * $knownBrands adds the brands already on the wishlist to the ones recognized in names.
 */
function parse_wishlist_text(string $text, array $knownBrands = []): array
{
    $text = str_replace(["\r\n", "\r", "\u{00A0}"], ["\n", "\n", ' '], $text);
    $items = [];
    $current = null;
    $category = '';

    $flush = function () use (&$current, &$items) {
        if ($current !== null && ($current['name'] !== '' || $current['url'] !== '')) {
            $items[] = $current;
        }
        $current = null;
    };

    foreach (explode("\n", $text) as $raw) {
        $line = trim($raw);
        if ($line === '') {
            continue;
        }
        if (preg_match('/^([-*_=])(\s*\1){2,}$/', $line)) {
            $flush();
            continue;
        }
        if (preg_match('/^#{1,6}\s*(.+)$/', $line, $m)) {
            $flush();
            $category = strip_markdown($m[1]);
            continue;
        }
        if ($field = import_field($line)) {
            if ($current === null) {
                $current = blank_import_item('', $category);
            }
            apply_import_field($current, $field[0], $field[1]);
            continue;
        }
        if (strpos($line, "\t") !== false) {
            $flush();
            $items[] = import_row(explode("\t", $line), $category);
            continue;
        }
        $body = (string)preg_replace('/^(\d{1,3}[.)]|[-*•+])\s+/u', '', $line);
        $urls = find_urls($body);
        $rest = trim_separators(strip_markdown(remove_urls($body)));
        // A line that is only a link belongs to the item above it, if that one has no link yet.
        if ($current !== null && $current['url'] === '' && $urls && $rest === '') {
            $current['url'] = $urls[0];
            continue;
        }
        $flush();
        $current = import_inline_item($body, $category);
    }
    $flush();

    $out = [];
    foreach (array_slice($items, 0, IMPORT_MAX_ITEMS) as $item) {
        $item = finish_import_item($item, $knownBrands);
        if ($item['name'] !== '') {
            $out[] = $item;
        }
    }
    return $out;
}

function blank_import_item(string $name, string $category): array
{
    return [
        'name' => $name, 'brand' => '', 'variant' => '', 'category' => $category, 'price' => null,
        'currency' => '', 'url' => '', 'image' => '', 'note' => '', 'priority' => 2,
    ];
}

/** "* **Price:** 1.100 €" → ['price', '1.100 €'], or null when the line isn't a labelled field. */
function import_field(string $line): ?array
{
    $patterns = [
        '/^(?:[-*•+]\s+)?(?:\*\*|__)([\p{L} ]{2,24}?)\s*:\s*(?:\*\*|__)\s*(.+)$/u',   // **Price:** value
        '/^(?:[-*•+]\s+)?(?:\*\*|__)?([\p{L} ]{2,24}?)(?:\*\*|__)?\s*:\s*(.+)$/u',   // Price: value / **Price**: value
    ];
    foreach ($patterns as $pattern) {
        if (!preg_match($pattern, $line, $m)) {
            continue;
        }
        $label = mb_strtolower(trim($m[1]));
        foreach (IMPORT_FIELDS as $key => $labels) {
            if (in_array($label, $labels, true)) {
                return [$key, trim($m[2])];
            }
        }
        return null;
    }
    return null;
}

function apply_import_field(array &$item, string $key, string $value): void
{
    switch ($key) {
        case 'price':
            [$price, $currency] = find_price($value, true);
            if ($price !== null) {
                $item['price'] = $price;
                $item['currency'] = $currency;
            }
            break;
        case 'url':
        case 'image':
            $urls = find_urls($value);
            if ($urls) {
                $item[$key] = $urls[0];
            }
            break;
        case 'priority':
            $item['priority'] = import_priority($value);
            break;
        case 'note':
            $item['note'] = trim($item['note'] . ' ' . strip_markdown($value));
            break;
        default:
            $item[$key] = strip_markdown($value);
    }
}

/** "Name – 271 € – https://…" (any order, any separator). */
function import_inline_item(string $body, string $category): array
{
    $urls = find_urls($body);
    $text = remove_urls($body);
    $item = blank_import_item('', $category);
    [$price, $currency, $matched] = find_price($text, false);
    if ($price !== null) {
        $item['price'] = $price;
        $item['currency'] = $currency;
        $text = str_replace($matched, ' ', $text);
    }
    $text = (string)preg_replace('/\(\s*~?\s*\)/u', '', $text);
    $item['name'] = trim_separators(strip_markdown($text));
    $item['url'] = $urls[0] ?? '';
    return $item;
}

/** A spreadsheet row: the link cell, the price cell, then the text cells as name (and brand). */
function import_row(array $cells, string $category): array
{
    $item = blank_import_item('', $category);
    $texts = [];
    foreach ($cells as $cell) {
        $cell = trim($cell);
        if ($cell === '') {
            continue;
        }
        $urls = find_urls($cell);
        if ($urls && $item['url'] === '') {
            $item['url'] = $urls[0];
            continue;
        }
        [$price, $currency] = find_price($cell, true);
        if ($price !== null && $item['price'] === null && preg_match('/^[^\p{L}]*(?:[A-Z]{3})?[^\p{L}]*$/u', $cell)) {
            $item['price'] = $price;
            $item['currency'] = $currency;
            continue;
        }
        $texts[] = strip_markdown($cell);
    }
    $item['name'] = $texts[0] ?? '';
    if (isset($texts[1]) && mb_strlen($texts[1]) <= 40) {
        $item['brand'] = $texts[1];
    }
    return $item;
}

function finish_import_item(array $item, array $knownBrands): array
{
    $name = strip_markdown($item['name']);
    if ($name === '' && $item['url'] !== '') {
        $name = name_from_url($item['url']);
    }
    // "(White)" at the end is the variant.
    if (preg_match('/^(.+?)\s*\(([^()]{1,60})\)\s*$/u', $name, $m)) {
        $name = trim($m[1]);
        if ($item['variant'] === '') {
            $item['variant'] = trim($m[2]);
        }
    }
    if ($item['brand'] === '') {
        [$item['brand'], $name] = split_brand($name, $knownBrands);
    }
    $name = (string)preg_replace("/^(women['’]?s|men['’]?s)\s+/iu", '', $name);
    $item['name'] = clean_text($name, 140);
    $item['brand'] = clean_text($item['brand'], 80);
    $item['variant'] = clean_text($item['variant'], 80);
    $item['category'] = clean_text($item['category'], 60);
    $item['note'] = clean_text($item['note'], 400);
    $item['url'] = $item['url'] !== '' ? clean_url(normalize_link($item['url'])) : '';
    $item['image'] = $item['image'] !== '' ? clean_url(normalize_link($item['image'])) : '';
    $item['currency'] = in_array($item['currency'], CURRENCIES, true) ? $item['currency'] : '';
    return $item;
}

/* ───────────────────────── text helpers ───────────────────────── */

/** URLs in a line: markdown link targets first, then bare links. */
function find_urls(string $text): array
{
    $urls = [];
    if (preg_match_all('/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i', $text, $m)) {
        $urls = $m[1];
    }
    if (preg_match_all('/(?<![(\w])https?:\/\/[^\s<>"\']+/i', remove_markdown_links($text), $m)) {
        foreach ($m[0] as $url) {
            $urls[] = rtrim($url, '.,;:!?)]*');
        }
    }
    return array_values(array_unique(array_map('normalize_link', $urls)));
}

/** Trims spaces and separators (- – — | : · , ;) from both ends. trim() would cut multibyte characters apart. */
function trim_separators(string $text): string
{
    return (string)preg_replace('/^[\s\-–—|:·,;]+|[\s\-–—|:·,;]+$/u', '', $text);
}

function remove_markdown_links(string $text): string
{
    return (string)preg_replace('/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/i', ' ', $text);
}

function remove_urls(string $text): string
{
    return (string)preg_replace('/https?:\/\/[^\s<>"\']+/i', ' ', remove_markdown_links($text));
}

function strip_markdown(string $text): string
{
    $text = (string)preg_replace('/\[([^\]]*)\]\([^)]*\)/', '$1', $text);
    $text = str_replace(['**', '__', '`', '~~'], '', $text);
    $text = (string)preg_replace('/(^|\s)[*_](\S)/u', '$1$2', $text);
    $text = (string)preg_replace('/(\S)[*_](\s|$)/u', '$1$2', $text);
    return trim((string)preg_replace('/\s+/u', ' ', $text));
}

/**
 * The first price in a string, with its currency: [amount, currency, matched text].
 * With $bare, a plain number counts too ("Price: 120"); otherwise a currency mark is needed,
 * or the number must stand alone between separators ("Name, 120, link").
 */
function find_price(string $text, bool $bare): array
{
    $symbols = '[$€£¥₩₹₪]';
    $codes = implode('|', CURRENCIES);
    $number = '\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?';
    $patterns = [
        '/(?:(' . $codes . ')\s?)?(' . $symbols . ')\s?(' . $number . ')/u',          // $590, US$ 590, €1.100
        '/(' . $number . ')\s?(' . $symbols . ')/u',                                      // 1.100 €
        '/(?:\b(' . $codes . ')\s?)(' . $number . ')\b/u',                               // EUR 1100
        '/\b(' . $number . ')\s?(' . $codes . ')\b/u',                                    // 1100 EUR
    ];
    $best = null;
    foreach ($patterns as $i => $pattern) {
        if (!preg_match($pattern, $text, $m, PREG_OFFSET_CAPTURE)) {
            continue;
        }
        $offset = $m[0][1];
        if ($best !== null && $best[3] <= $offset) {
            continue;
        }
        switch ($i) {
            case 0:
                $currency = ($m[1][0] ?? '') !== '' ? $m[1][0] : CURRENCY_SYMBOLS[$m[2][0]];
                $amount = $m[3][0];
                break;
            case 1:
                $currency = CURRENCY_SYMBOLS[$m[2][0]];
                $amount = $m[1][0];
                break;
            case 2:
                $currency = $m[1][0];
                $amount = $m[2][0];
                break;
            default:
                $currency = $m[2][0];
                $amount = $m[1][0];
        }
        $value = parse_amount(str_replace(' ', '', $amount));
        if ($value !== null) {
            $best = [$value, $currency, $m[0][0], $offset];
        }
    }
    if ($best !== null) {
        return [$best[0], $best[1], $best[2]];
    }
    if ($bare && preg_match('/(' . $number . ')/u', $text, $m)) {
        return [parse_amount(str_replace(' ', '', $m[1])), '', $m[1]];
    }
    // "Name, 120, https://…": a number that is a whole separated segment.
    foreach (preg_split('/\s[-–—|]\s|[,;|\t]/u', $text) ?: [] as $segment) {
        $segment = trim($segment);
        if ($segment !== '' && preg_match('/^(' . $number . ')$/u', $segment)) {
            return [parse_amount(str_replace(' ', '', $segment)), '', $segment];
        }
    }
    return [null, '', ''];
}

function import_priority(string $value): int
{
    $v = mb_strtolower(strip_markdown($value));
    if (preg_match('/obsess|must|high|urgent|need|3|!!!/', $v)) {
        return 3;
    }
    if (preg_match('/whim|low|maybe|someday|1/', $v)) {
        return 1;
    }
    return 2;
}
