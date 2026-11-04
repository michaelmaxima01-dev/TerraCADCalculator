<?php
// Teste local do pacote Hostinger com o servidor embutido do PHP (que não lê .htaccess):
//   php -S 127.0.0.1:8080 -t pacote-hostinger/public_html scripts/hostinger-local-router.php
// Reproduz as regras do .htaccess: login e API liberados; o resto passa pelo gate.php.
$path = (string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$docroot = rtrim((string)$_SERVER['DOCUMENT_ROOT'], '/\\');
if (preg_match('#^/(login\.html|login\.js|login\.css|auth-client\.js|favicon\.svg|LICENSE\.txt)$#', $path)) return false;
if ($path === '/api/auth.php') return false;
if (strpos($path, '/api/') === 0) { http_response_code(403); exit('Acesso negado'); }
$_SERVER['SCRIPT_NAME'] = '/gate.php';
$_SERVER['SCRIPT_FILENAME'] = $docroot . '/gate.php';
require $docroot . '/gate.php';
