<?php
/*
 * FINDOM YOURSELF: item photos. Every photo, uploaded or downloaded, is checked to be a
 * real image, turned upright, shrunk to at most 1600px and saved as WebP (or JPEG if
 * this server's PHP has no WebP support) under uploads/items/ with a server-made name.
 */
declare(strict_types=1);

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/bootstrap.php';

const IMAGE_TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif', 'image/avif' => 'avif'];
const IMAGE_MAX_EDGE = 1600;
const IMAGE_MAX_PIXELS = 50000000;
const IMAGE_MAX_UPLOAD = 20 * 1024 * 1024;

/** Stores the image at $path for item $itemId and returns its public path ("uploads/items/…"). */
function store_item_image(string $path, string $itemId): string
{
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($path) ?: '';
    if (!isset(IMAGE_TYPES[$mime])) {
        throw new RuntimeException('That isn’t a photo the site can use (it reads as ' . ($mime ?: 'unknown') . '). Use JPG, PNG, WebP, GIF or AVIF.');
    }
    if (filesize($path) > IMAGE_MAX_UPLOAD) {
        throw new RuntimeException('That photo is over 20 MB. Use a smaller one.');
    }
    $size = @getimagesize($path);
    if ($size && ($size[0] < 16 || $size[1] < 16)) {
        throw new RuntimeException('That image is too small to use.');
    }
    if ($size && $size[0] * $size[1] > IMAGE_MAX_PIXELS) {
        throw new RuntimeException('That image is enormous. Use one under 50 megapixels.');
    }
    ensure_uploads();
    $stem = uploads_dir() . '/items/' . str_replace('_', '-', preg_replace('/[^a-z0-9_]/', '', $itemId)) . '-' . bin2hex(random_bytes(4));

    $img = $size ? gd_load($path, $mime) : null;
    if ($img) {
        $img = gd_upright($img, $path, $mime);
        $img = gd_fit($img, IMAGE_MAX_EDGE);
        if (function_exists('imagewebp')) {
            $dest = $stem . '.webp';
            imagesavealpha($img, true);
            $ok = imagewebp($img, $dest, 84);
        } else {
            $dest = $stem . '.jpg';
            $ok = imagejpeg(gd_flatten($img), $dest, 86);
        }
        imagedestroy($img);
        if (!$ok) {
            @unlink($dest);
            throw new RuntimeException('Couldn’t save the photo. Check that the uploads folder is writable.');
        }
    } else {
        if (!$size && $mime !== 'image/avif') { // unreadable and not a format GD merely can't decode
            throw new RuntimeException('That image looks damaged. Try another one.');
        }
        $dest = $stem . '.' . IMAGE_TYPES[$mime]; // this server can't re-encode it: keep the original
        if (!@copy($path, $dest)) {
            throw new RuntimeException('Couldn’t save the photo. Check that the uploads folder is writable.');
        }
    }
    @chmod($dest, 0644);
    return 'uploads/items/' . basename($dest);
}

/** Deletes a stored item photo, but only a file that really lives in uploads/items/. */
function delete_item_image(string $rel): void
{
    if (!preg_match('#^uploads/items/([a-z0-9_-]+\.(webp|jpe?g|png|gif|avif))$#', $rel, $m)) {
        return;
    }
    @unlink(uploads_dir() . '/items/' . $m[1]);
}

/** @return GdImage|resource|null */
function gd_load(string $path, string $mime)
{
    if (!extension_loaded('gd')) {
        return null;
    }
    $loaders = [
        'image/jpeg' => 'imagecreatefromjpeg',
        'image/png' => 'imagecreatefrompng',
        'image/webp' => 'imagecreatefromwebp',
        'image/gif' => 'imagecreatefromgif',
        'image/avif' => 'imagecreatefromavif',
    ];
    $fn = $loaders[$mime] ?? null;
    if (!$fn || !function_exists($fn)) {
        return null;
    }
    $img = @$fn($path);
    if (!$img) {
        return null;
    }
    if (!imageistruecolor($img)) {
        imagepalettetotruecolor($img);
    }
    imagealphablending($img, false);
    return $img;
}

/** Phone photos store their rotation separately; apply it so nothing shows up sideways. */
function gd_upright($img, string $path, string $mime)
{
    if ($mime !== 'image/jpeg' || !function_exists('exif_read_data')) {
        return $img;
    }
    $exif = @exif_read_data($path);
    $angle = [3 => 180, 6 => -90, 8 => 90][(int)($exif['Orientation'] ?? 1)] ?? 0;
    if ($angle === 0) {
        return $img;
    }
    $rotated = imagerotate($img, $angle, 0);
    if ($rotated) {
        imagedestroy($img);
        return $rotated;
    }
    return $img;
}

function gd_fit($img, int $maxEdge)
{
    $w = imagesx($img);
    $h = imagesy($img);
    $scale = $maxEdge / max($w, $h);
    if ($scale >= 1) {
        return $img;
    }
    $nw = max(1, (int)round($w * $scale));
    $nh = max(1, (int)round($h * $scale));
    $out = imagecreatetruecolor($nw, $nh);
    imagealphablending($out, false);
    imagesavealpha($out, true);
    imagefill($out, 0, 0, imagecolorallocatealpha($out, 0, 0, 0, 127));
    imagecopyresampled($out, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
    imagedestroy($img);
    return $out;
}

/** JPEG has no transparency: put transparent product cut-outs on white. */
function gd_flatten($img)
{
    $w = imagesx($img);
    $h = imagesy($img);
    $out = imagecreatetruecolor($w, $h);
    imagefill($out, 0, 0, imagecolorallocate($out, 255, 255, 255));
    imagealphablending($out, true);
    imagecopy($out, $img, 0, 0, 0, 0, $w, $h);
    return $out;
}
