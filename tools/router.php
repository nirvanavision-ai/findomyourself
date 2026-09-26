<?php
/*
 * Local development server with the same "never serve internals" rules as .htaccess:
 *
 *   php -S 127.0.0.1:8080 tools/router.php      → site at /, Control Room at /admin/
 *
 * Data goes to private/ inside the repo (ignored by Git) unless FINDOM_PRIVATE_DIR is set.
 */
$path = rawurldecode((string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
if (preg_match('#^/(lib|tools|private|node_modules)(/|$)#', $path) || preg_match('#/\.(?!well-known/)#', $path)
    || preg_match('#\.(md|lock|log|sh)$#i', $path) || preg_match('#^/package(-lock)?\.json$#', $path)) {
    http_response_code(404);
    echo 'Not found';
    return true;
}
if (preg_match('#^/uploads/.+\.(php\d?|phtml|phar)$#i', $path)) {
    http_response_code(403);
    return true;
}
return false; // let the built-in server handle it (static files, *.php, directory index.php)
