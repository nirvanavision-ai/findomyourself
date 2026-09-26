<?php
/*
 * FINDOM YOURSELF: first-run content. Everything here is editable in the admin;
 * it only seeds data.json the very first time the site runs.
 *
 * Placeholders the site fills in: {goal} {item} {hours} {rate} {balance} {streak} {since} {count}
 */
declare(strict_types=1);

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    exit;
}

function default_settings(): array
{
    return [
        'title' => 'Findom Yourself',
        'tagline' => 'No work. No treats.',
        'baseCurrency' => 'USD',
        'fx' => ['EUR' => 1.17],
        'fxUpdatedAt' => null,
        'hourlyRate' => 25.0,
        'timezone' => 'America/Los_Angeles',
        'goalId' => '',
        'visibility' => 'public',
        'passcodeHash' => '',
        'whip' => true,
        'showLive' => true,
        'showLedger' => true,
        'copy' => [
            'heroKicker' => 'A self-inflicted financial domination project',
            'heroIntro' => 'You want pretty things. I want you to stop fucking around. Every hour of real work pays tribute into the vault, every lazy hour costs you, and nothing on this list gets bought until it’s earned.',
            'rule1' => 'Want it.',
            'rule1Body' => 'Put it on the list. Obsess responsibly. Drool if you must, just don’t buy it yet.',
            'rule2' => 'Earn it.',
            'rule2Body' => 'Timer on, phone face-down. Every hour of focus pays {rate} into the vault. Commands pay extra. Slacking gets fined.',
            'rule3' => 'Take it.',
            'rule3Body' => 'The second the vault covers it, it’s yours. Guilt-free, no crying about the price. Receipts go on the wall.',
            'vaultIntro' => 'Every coin in here is an hour you didn’t waste. Fines come straight back out.',
            'listIntro' => '{count} expensive obsessions. Each one unlocks when the vault can cover it. Not a second sooner.',
            'trophyIntro' => 'Earned, bought, flaunted. Receipts don’t lie.',
            'whipIntro' => 'Catch my sub slacking? Grab the whip and swing it. Hard. Every crack gets counted, and they will hear about it.',
            'footerLine' => 'No work. No treats. No exceptions.',
            'finePrint' => 'A self-inflicted financial domination project: one person, one wishlist, zero free rides. All tribute is paid in hours of real work, logged honestly (mostly).',
        ],
        'voice' => [
            'taunts' => [
                'Cute wishlist. Now earn it.',
                'You don’t have a spending problem. You have a working problem.',
                'Put the phone down. Yes, you.',
                'Every scroll costs you. Every hour pays you. Do the fucking math.',
                'Nothing on this list is free, sweetheart. Least of all your time.',
                'Want the {goal}? Then act like it.',
                'You’re {hours} hours of work away from the {goal}. Stop reading this.',
                'Lazy is expensive. You can’t afford it.',
                'Kneel before your to-do list.',
                'Tribute is due. Daily. No excuses, no extensions.',
                'Your future self called. They’re pissed.',
                'Oh, you’re tired? The vault doesn’t give a shit.',
                'Grind first. Treats later. That’s the whole deal.',
                'No receipts, no rewards.',
                'You wanted luxury. Luxury wants overtime.',
                'Close the tab. Open the laptop. Get to work.',
                'Excuses don’t go in the vault.',
                'Discipline looks good on you. Wear it more often.',
            ],
            'working' => [
                'Look at you, actually working. Don’t fuck it up.',
                'Session live. Phone face-down. Eyes on the prize.',
                'Every minute pays. Keep going, and don’t you dare check your phone.',
                'Grinding for the {goal}. Visitors, don’t distract.',
                'Good. Keep that timer running.',
                'This is what obedience looks like.',
            ],
            'slacking' => [
                'Nothing logged in {since}. Bold strategy.',
                '{since} without tribute. The vault is starving.',
                'The vault’s collecting dust, and so are you.',
                'Did you forget about me? Because I didn’t forget about you.',
                'Still nothing? Pathetic. Get up.',
            ],
            'praise' => [
                'Good. Again.',
                'Now that’s what I like to see. Keep it coming.',
                '{streak} days straight. Don’t you dare break it.',
                'Tribute received. You may continue.',
                'Look who decided to be useful today.',
                'Proud of you. Don’t let it go to your head.',
            ],
            'unlocked' => [
                'The {item} is paid for. Go get it. You earned the damn thing.',
                'Unlocked. Buy it before you talk yourself out of it.',
                'You did it. The {item} is yours. Receipts or it didn’t happen.',
            ],
            'empty' => [
                'The vault is empty. Much like your excuses. No wait, you’ve got plenty of those.',
                '{balance} in the vault. Impressive, in the worst possible way.',
                'Zero. Nada. Nothing. Get to work.',
            ],
        ],
    ];
}

function default_commands(): array
{
    return [
        ['id' => 'c_gym', 'emoji' => '🏋️', 'name' => 'Gym session', 'amount' => 15],
        ['id' => 'c_todo', 'emoji' => '✅', 'name' => 'Crushed the to-do list', 'amount' => 20],
        ['id' => 'c_content', 'emoji' => '🎥', 'name' => 'Posted content', 'amount' => 20],
        ['id' => 'c_invoice', 'emoji' => '🧾', 'name' => 'Sent an invoice', 'amount' => 10],
        ['id' => 'c_inbox', 'emoji' => '📬', 'name' => 'Inbox zero', 'amount' => 5],
        ['id' => 'c_clean', 'emoji' => '🧹', 'name' => 'Cleaned the damn apartment', 'amount' => 10],
        ['id' => 'c_cook', 'emoji' => '🍳', 'name' => 'Cooked instead of ordering', 'amount' => 8],
        ['id' => 'c_early', 'emoji' => '☀️', 'name' => 'Up before 8am', 'amount' => 5],
    ];
}

function default_fines(): array
{
    return [
        ['id' => 'f_scroll', 'emoji' => '📱', 'name' => 'Doomscrolled an hour', 'amount' => 10],
        ['id' => 'f_gym', 'emoji' => '🛋️', 'name' => 'Skipped the gym', 'amount' => 15],
        ['id' => 'f_impulse', 'emoji' => '🛍️', 'name' => 'Bought something not on the list', 'amount' => 25],
        ['id' => 'f_delivery', 'emoji' => '🍕', 'name' => 'Lazy delivery order', 'amount' => 10],
        ['id' => 'f_snooze', 'emoji' => '⏰', 'name' => 'Snoozed 3+ times', 'amount' => 5],
        ['id' => 'f_wasted', 'emoji' => '🫠', 'name' => 'Wasted the whole damn day', 'amount' => 40],
    ];
}

/** The wishlist as it was handed over. Photos are fetched from the store links in the admin. */
function default_items(): array
{
    $home = 'Home, Design & Audio';
    $shoes = 'Footwear & Accessories';
    $rtw = 'Ready-To-Wear & Knitwear';
    $items = [
        ['i_transparent_speaker', 'Transparent Large Speaker', 'Transparent', 'White', $home, 1100, 'EUR',
            'https://www.farfetch.com/shopping/women/transparent-large-transparent-speaker-item-19979010.aspx'],
        ['i_transparent_turntable', 'Transparent Turntable Record Player', 'Transparent', 'White', $home, 1478, 'EUR',
            'https://www.farfetch.com/shopping/women/transparent-transparent-turntable-record-player-item-19973019.aspx'],
        ['i_versace_ashtray', 'Medusa Rhapsody Ashtray', 'Versace', '13 cm', $home, 271, 'EUR',
            'https://www.farfetch.com/shopping/women/versace-medusa-rhapsody-ashtray-13cm-item-16661316.aspx'],
        ['i_lobjet_ashtray', 'Malachite Porcelain Ashtray', 'L’Objet', '', $home, 233, 'EUR',
            'https://www.farfetch.com/shopping/men/lobjet-malachite-porcelain-ashtray-item-18820423.aspx'],
        ['i_versace_sandals', 'Gianni Ribbon Patent Leather Sandals', 'Versace', 'Red · 140 mm', $shoes, 1150, 'EUR',
            'https://www.farfetch.com/shopping/women/versace-bow-detail-patent-leather-sandals-item-37531093.aspx'],
        ['i_chrome_hearts_scarf', 'Cemetery Cross Silk Scarf', 'Chrome Hearts', 'Royal Blue / White', $shoes, 1911, 'EUR',
            'https://www.farfetch.com/shopping/women/chrome-hearts-cemetery-cross-silk-scarf-item-33111567.aspx'],
        ['i_amiri_court_hi', 'MA Court Hi Sneakers', 'AMIRI', 'Black / White', $shoes, 590, 'USD',
            'https://amiri.com/products/ma-court-hi-black-white-1'],
        ['i_amiri_hat', 'Arts District Canvas Hat', 'AMIRI', 'Sapphire Blue', $shoes, 390, 'USD',
            'https://amiri.com/products/arts-district-canvas-hat-sapphire'],
        ['i_amiri_polo', 'MA Quad Knit Short-Sleeve Polo', 'AMIRI', 'Black', $rtw, 690, 'USD',
            'https://amiri.com/products/women-womens-ma-quad-knit-short-sleeve-polo-black'],
        ['i_amiri_skirt', 'MA Quad Jacquard Mini Skirt', 'AMIRI', 'Stone Indigo', $rtw, 790, 'USD',
            'https://amiri.com/products/women-womens-ma-quad-jacquard-mini-skirt-stone-indigo'],
        ['i_amiri_ribbed_tank', 'MA Embroidered Ribbed Tank', 'AMIRI', 'White', $rtw, 290, 'USD',
            'https://amiri.com/products/women-womens-ma-embroidered-ribbed-tank-white'],
        ['i_amiri_1994_tank', '1994 Tank', 'AMIRI', 'Black', $rtw, 350, 'USD',
            'https://amiri.com/products/amiri-1994-tank-black'],
    ];
    $now = iso_now();
    return array_map(function ($row) use ($now) {
        [$id, $name, $brand, $variant, $category, $price, $currency, $url] = $row;
        return [
            'id' => $id, 'name' => $name, 'brand' => $brand, 'variant' => $variant, 'category' => $category,
            'price' => $price, 'currency' => $currency, 'url' => $url, 'image' => '', 'imageSource' => '',
            'priority' => 2, 'note' => '', 'status' => 'wishing', 'createdAt' => $now, 'claimedAt' => null,
        ];
    }, $items);
}

function seed_data(): array
{
    return [
        'schema' => 1,
        'settings' => default_settings(),
        'items' => default_items(),
        'commands' => default_commands(),
        'fines' => default_fines(),
        'ledger' => [],
        'session' => null,
    ];
}
