<?php
declare(strict_types=1);

/**
 * Terra CAD — porteiro do aplicativo.
 * Todo pedido que não seja do login ou da API chega aqui (ver .htaccess). Só quem tem sessão válida
 * (cookie tc_sessao, conta ativa e licença no prazo) recebe os arquivos de app/; os demais vão para
 * login.html. A pasta app/ é bloqueada para acesso direto.
 */

require __DIR__ . '/api/auth.php';

const APP_DIR = __DIR__ . '/app';
const MIME = [
    'html' => 'text/html; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'mjs' => 'text/javascript; charset=utf-8',
    'css' => 'text/css; charset=utf-8', 'json' => 'application/json', 'wasm' => 'application/wasm', 'svg' => 'image/svg+xml',
    'png' => 'image/png', 'jpg' => 'image/jpeg', 'ico' => 'image/x-icon', 'webp' => 'image/webp', 'txt' => 'text/plain; charset=utf-8',
    'woff2' => 'font/woff2',
];

function gateBase(): string
{
    return rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/gate.php')), '/') . '/';
}

/** Caminho pedido, relativo à pasta do site (funciona na raiz ou numa subpasta). */
function requestedPath(): string
{
    $uri = rawurldecode((string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
    $base = gateBase();
    $rel = strpos($uri, $base) === 0 ? substr($uri, strlen($base)) : ltrim($uri, '/');
    if ($rel === '' || $rel === 'gate.php' || substr($rel, -1) === '/') $rel .= 'index.html';
    if ($rel === 'gate.phpindex.html') $rel = 'index.html';
    return $rel;
}

function deny(int $code, string $message, string $rel): void
{
    header('Cache-Control: no-store');
    $ext = strtolower(pathinfo($rel, PATHINFO_EXTENSION));
    if ($ext === 'html' || $ext === '') { // navegação: volta para o login com o motivo
        header('Location: ' . gateBase() . 'login.html?motivo=' . rawurlencode($message), true, 302);
        exit;
    }
    http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message;
    exit;
}

ensureStorage();
$rel = requestedPath();
[$user, $err, $msg] = currentUser();
if (!$user) deny($err === 'session' ? 401 : 403, needsSetup() ? 'Instalação pendente: crie a conta do proprietário.' : $msg, $rel);

$root = realpath(APP_DIR);
$file = $root ? realpath($root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel)) : false;
if (!$root || !$file || strpos($file, $root . DIRECTORY_SEPARATOR) !== 0 || !is_file($file) || substr($file, -3) === '.gz' || basename($file) === '.htaccess') {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Arquivo não encontrado.');
}

$ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
header('Content-Type: ' . (MIME[$ext] ?? 'application/octet-stream'));
header('X-Content-Type-Options: nosniff');
header('Vary: Accept-Encoding, Cookie');
// arquivos com hash no nome (assets/) não mudam; index.html sempre revalida
header(strpos($rel, 'assets/') === 0 ? 'Cache-Control: private, max-age=31536000, immutable' : 'Cache-Control: no-store');

// versão pré-compactada (.gz gerada pelo empacotador), quando o navegador aceita gzip
$gz = $file . '.gz';
if (is_file($gz) && stripos($_SERVER['HTTP_ACCEPT_ENCODING'] ?? '', 'gzip') !== false) {
    header('Content-Encoding: gzip');
    $file = $gz;
}
header('Content-Length: ' . filesize($file));
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') exit;
if (function_exists('apache_setenv')) @apache_setenv('no-gzip', '1');
@ini_set('zlib.output_compression', 'Off');
while (ob_get_level()) ob_end_clean();
readfile($file);
