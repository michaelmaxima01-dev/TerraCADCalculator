<?php
declare(strict_types=1);

/**
 * Terra CAD — login, senha, contas e licenças com validade (sem banco de dados).
 * Um único arquivo PHP (7.4+): contas em data/users.json (pasta bloqueada por .htaccess).
 * - Senhas com password_hash (bcrypt); tokens assinados com HMAC-SHA256.
 * - Primeiro acesso: não há senha padrão. O servidor gera data/codigo-instalacao.txt; quem tiver acesso
 *   ao Gerenciador de Arquivos da Hostinger lê esse código e cria a conta do proprietário (ação "setup").
 * - A sessão vai também num cookie HttpOnly (tc_sessao), que o gate.php confere antes de entregar o app.
 * - Só o proprietário (role "owner") gerencia contas; o painel exige a senha dele (desbloqueio temporário).
 * - Licenças: 1d, 1s, 1m, 3m, 6m, 12m, vitalicio. Bloqueio por IP após MAX_FAILS tentativas.
 * Ações (POST JSON {"action": ...}): status, setup, login, me, logout, unlock, list, create, update, delete.
 * Baseado na camada de login do Planta3D.
 */

// ===================== CONFIGURAÇÃO =====================
const DATA_DIR = __DIR__ . '/data';   // pasta das contas (bloqueada por .htaccess)
const SESSION_TTL = 12 * 3600;        // validade do token de sessão (s)
const ADMIN_TTL = 20 * 60;            // painel do proprietário desbloqueado por (s)
const MAX_FAILS = 8;                  // tentativas erradas antes do bloqueio
const LOCK_SECONDS = 15 * 60;         // duração do bloqueio (s)
const COOKIE_NAME = 'tc_sessao';
/** Planos: chave => dias (0 = vitalício). */
const PLANS = ['1d' => 1, '1s' => 7, '1m' => 30, '3m' => 90, '6m' => 180, '12m' => 365, 'vitalicio' => 0];
// ========================================================

const USERS_FILE = DATA_DIR . '/users.json';
const SECRET_FILE = DATA_DIR . '/secret.key';
const ATTEMPTS_FILE = DATA_DIR . '/attempts.json';
const SETUP_FILE = DATA_DIR . '/codigo-instalacao.txt';
const HTACCESS_DENY = "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order deny,allow\n  Deny from all\n</IfModule>\n";

function out(array $data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $error, string $message, int $code = 400): void
{
    out(['ok' => false, 'error' => $error, 'message' => $message], $code);
}

function ensureStorage(): void
{
    if (!is_dir(DATA_DIR) && !mkdir(DATA_DIR, 0750, true)) fail('storage', 'Não foi possível criar a pasta de dados (api/data). Verifique as permissões.', 500);
    if (!file_exists(DATA_DIR . '/.htaccess')) file_put_contents(DATA_DIR . '/.htaccess', HTACCESS_DENY);
    if (!file_exists(DATA_DIR . '/index.html')) file_put_contents(DATA_DIR . '/index.html', '');
    if (!file_exists(SECRET_FILE)) file_put_contents(SECRET_FILE, bin2hex(random_bytes(32)));
    if (!loadUsers() && !file_exists(SETUP_FILE)) {
        $code = strtoupper(substr(bin2hex(random_bytes(6)), 0, 4) . '-' . substr(bin2hex(random_bytes(6)), 0, 4) . '-' . substr(bin2hex(random_bytes(6)), 0, 4));
        file_put_contents(SETUP_FILE, $code . "\n\nCódigo de instalação do Terra CAD. Use-o uma única vez em login.html para criar a conta do proprietário.\nEste arquivo é apagado automaticamente depois da instalação.\n");
    }
}

function needsSetup(): bool { return !loadUsers(); }

function loadUsers(): array
{
    $raw = @file_get_contents(USERS_FILE);
    $data = $raw ? json_decode($raw, true) : null;
    return is_array($data) ? $data : [];
}

function saveUsers(array $users): void
{
    $tmp = USERS_FILE . '.tmp';
    $fp = fopen($tmp, 'c');
    if (!$fp) fail('storage', 'Sem permissão de escrita em api/data.', 500);
    flock($fp, LOCK_EX);
    ftruncate($fp, 0);
    fwrite($fp, json_encode(array_values($users), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    rename($tmp, USERS_FILE);
}

function secret(): string { return trim((string)file_get_contents(SECRET_FILE)); }
function b64u(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function unb64u(string $s): string { return (string)base64_decode(strtr($s, '-_', '+/')); }

function makeToken(array $payload): string
{
    $body = b64u(json_encode($payload));
    return $body . '.' . b64u(hash_hmac('sha256', $body, secret(), true));
}

function readToken(?string $token, string $scope): ?array
{
    if (!$token || strpos($token, '.') === false) return null;
    [$body, $sig] = explode('.', $token, 2);
    if (!hash_equals(b64u(hash_hmac('sha256', $body, secret(), true)), $sig)) return null;
    $p = json_decode(unb64u($body), true);
    if (!is_array($p) || ($p['scope'] ?? '') !== $scope || ($p['exp'] ?? 0) < time()) return null;
    return $p;
}

function findUser(array $users, string $login): ?int
{
    foreach ($users as $i => $u) if (strtolower($u['login']) === strtolower($login)) return $i;
    return null;
}

function isExpired(array $u): bool
{
    return $u['role'] !== 'owner' && $u['expires'] !== null && strtotime($u['expires']) < time();
}

function publicUser(array $u): array
{
    $secs = $u['expires'] === null ? null : strtotime($u['expires']) - time();
    $days = $secs === null ? null : (int)($secs < 0 ? floor($secs / 86400) : ceil($secs / 86400));
    return [
        'login' => $u['login'], 'name' => $u['name'], 'role' => $u['role'], 'active' => (bool)$u['active'],
        'plan' => $u['plan'], 'expires' => $u['expires'], 'daysLeft' => $days,
        'createdAt' => $u['createdAt'], 'lastLogin' => $u['lastLogin'], 'notes' => $u['notes'] ?? '',
    ];
}

function isHttps(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') || (($_SERVER['SERVER_PORT'] ?? '') === '443');
}

/** Cookie da sessão (HttpOnly): é ele que libera os arquivos do app no gate.php. */
function setSessionCookie(string $token, int $expires): void
{
    $path = rtrim(str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/api/auth.php'))), '/') . '/';
    setcookie(COOKIE_NAME, $token, ['expires' => $expires, 'path' => $path, 'secure' => isHttps(), 'httponly' => true, 'samesite' => 'Lax']);
}

function session(array $u): array
{
    $exp = time() + SESSION_TTL;
    $token = makeToken(['u' => $u['login'], 'scope' => 'app', 'exp' => $exp]);
    setSessionCookie($token, $exp);
    return ['user' => $u['login'], 'name' => $u['name'], 'role' => $u['role'], 'expires' => $u['expires'], 'token' => $token];
}

/** Nova validade: soma o plano a partir de hoje ou do vencimento atual (renovação antecipada). */
function expiryFor(string $plan, ?string $current): ?string
{
    if (!array_key_exists($plan, PLANS)) fail('plan', 'Plano inválido.');
    $days = PLANS[$plan];
    if ($days === 0) return null;
    $base = ($current !== null && strtotime($current) > time()) ? strtotime($current) : time();
    return gmdate('c', $base + $days * 86400);
}

// ---------- proteção contra força bruta ----------
function clientIp(): string { return $_SERVER['REMOTE_ADDR'] ?? 'desconhecido'; }

function attempts(): array
{
    $raw = @file_get_contents(ATTEMPTS_FILE);
    $a = $raw ? json_decode($raw, true) : [];
    return is_array($a) ? $a : [];
}

function checkLock(): void
{
    $a = attempts()[clientIp()] ?? null;
    if ($a && $a['n'] >= MAX_FAILS && time() - $a['t'] < LOCK_SECONDS) fail('locked', 'Muitas tentativas incorretas. Aguarde 15 minutos.', 429);
}

function registerFail(): void
{
    $all = attempts();
    $ip = clientIp();
    $a = $all[$ip] ?? ['n' => 0, 't' => time()];
    if (time() - $a['t'] > LOCK_SECONDS) $a = ['n' => 0, 't' => time()];
    $a['n']++;
    $a['t'] = time();
    $all[$ip] = $a;
    @file_put_contents(ATTEMPTS_FILE, json_encode($all));
}

function clearFails(): void
{
    $all = attempts();
    unset($all[clientIp()]);
    @file_put_contents(ATTEMPTS_FILE, json_encode($all));
}

function requireAdmin(array $in): void
{
    if (!readToken($in['adminToken'] ?? null, 'admin')) fail('admin', 'Painel bloqueado: informe novamente a senha do proprietário.', 401);
}

function validLogin(string $login): bool { return (bool)preg_match('/^[a-zA-Z0-9._-]{3,32}$/', $login); }

/**
 * Usuário da sessão atual (cookie tc_sessao, "Authorization: Bearer ..." ou token no corpo), ou o motivo da recusa.
 * @return array{0: ?array, 1: ?string, 2: ?string} [usuário público, código do erro, mensagem]
 */
function currentUser(?string $token = null): array
{
    if ($token === null) {
        $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        $token = stripos($h, 'Bearer ') === 0 ? trim(substr($h, 7)) : ($_COOKIE[COOKIE_NAME] ?? null);
    }
    $p = readToken(is_string($token) ? $token : null, 'app');
    if (!$p) return [null, 'session', 'Sessão expirada. Entre novamente.'];
    $users = loadUsers();
    $i = findUser($users, $p['u']);
    if ($i === null) return [null, 'session', 'Acesso removido.'];
    $u = $users[$i];
    if (!$u['active']) return [null, 'inactive', 'Este acesso foi inativado pelo administrador.'];
    if (isExpired($u)) return [null, 'expired', 'Sua licença venceu em ' . date('d/m/Y', strtotime($u['expires'])) . '. Fale com o administrador para renovar.'];
    return [$u, null, null];
}

/** Para proteger outras rotas PHP: require 'auth.php'; $u = exigirLicenca(); */
function exigirLicenca(bool $somenteProprietario = false): array
{
    ensureStorage();
    header('Content-Type: application/json; charset=utf-8');
    [$u, $err, $msg] = currentUser();
    if (!$u) fail($err, $msg, $err === 'session' ? 401 : 403);
    if ($somenteProprietario && $u['role'] !== 'owner') fail('forbidden', 'Somente o proprietário.', 403);
    return publicUser($u);
}

// ---------- requisição ----------
// Se este arquivo foi incluído por outro (require), só disponibiliza as funções acima.
if (realpath((string)($_SERVER['SCRIPT_FILENAME'] ?? '')) !== __FILE__) return;
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if ($_SERVER['REQUEST_METHOD'] === 'GET') { ensureStorage(); out(['ok' => true, 'service' => 'auth', 'needsSetup' => needsSetup()]); }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('method', 'Use POST.', 405);
ensureStorage();
$in = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($in)) fail('input', 'Requisição inválida.');

switch ((string)($in['action'] ?? '')) {
    case 'status': {
        out(['ok' => true, 'needsSetup' => needsSetup()]);
    }

    case 'setup': { // primeira conta (proprietário), só com o código gerado no servidor
        checkLock();
        if (!needsSetup()) fail('done', 'O Terra CAD já foi instalado. Entre com sua conta.', 409);
        $expected = trim((string)strtok((string)@file_get_contents(SETUP_FILE), "\n"));
        if ($expected === '' || !hash_equals(strtoupper($expected), strtoupper(trim((string)($in['code'] ?? ''))))) {
            registerFail();
            fail('code', 'Código de instalação incorreto. Abra api/data/codigo-instalacao.txt no Gerenciador de Arquivos da Hostinger.', 401);
        }
        $login = trim((string)($in['login'] ?? ''));
        $pass = (string)($in['pass'] ?? '');
        if (!validLogin($login)) fail('login', 'Login deve ter de 3 a 32 caracteres (letras, números, ponto, hífen ou sublinhado).');
        if (strlen($pass) < 8) fail('pass', 'A senha do proprietário precisa ter pelo menos 8 caracteres.');
        $owner = [
            'login' => $login, 'name' => trim((string)($in['name'] ?? '')) ?: 'Proprietário', 'role' => 'owner',
            'hash' => password_hash($pass, PASSWORD_DEFAULT), 'active' => true, 'plan' => 'vitalicio', 'expires' => null,
            'createdAt' => gmdate('c'), 'lastLogin' => gmdate('c'), 'notes' => '',
        ];
        saveUsers([$owner]);
        @unlink(SETUP_FILE);
        clearFails();
        out(['ok' => true, 'session' => session($owner)]);
    }

    case 'login': {
        checkLock();
        if (needsSetup()) fail('setup', 'Instalação pendente: crie a conta do proprietário com o código de instalação.', 409);
        $users = loadUsers();
        $i = findUser($users, (string)($in['user'] ?? ''));
        if ($i === null || !password_verify((string)($in['pass'] ?? ''), $users[$i]['hash'])) {
            registerFail();
            fail('invalid', 'Usuário ou senha incorretos.', 401);
        }
        $u = $users[$i];
        if (!$u['active']) fail('inactive', 'Este acesso está inativo. Fale com o administrador do sistema.', 403);
        if (isExpired($u)) fail('expired', 'Sua licença venceu em ' . date('d/m/Y', strtotime($u['expires'])) . '. Fale com o administrador para renovar.', 403);
        clearFails();
        $users[$i]['lastLogin'] = gmdate('c');
        saveUsers($users);
        out(['ok' => true, 'session' => session($users[$i])]);
    }

    case 'me': { // revalida a sessão (conta ativa e no prazo) e renova o cookie
        [$u, $err, $msg] = currentUser(isset($in['token']) ? (string)$in['token'] : null);
        if (!$u) { setSessionCookie('', time() - 3600); fail($err, $msg, $err === 'session' ? 401 : 403); }
        out(['ok' => true, 'session' => session($u)]);
    }

    case 'logout': {
        setSessionCookie('', time() - 3600);
        out(['ok' => true]);
    }

    case 'unlock': { // proprietário confirma a senha para abrir o painel
        checkLock();
        $p = readToken($in['token'] ?? null, 'app');
        $users = loadUsers();
        $i = $p ? findUser($users, $p['u']) : null;
        if ($i === null || $users[$i]['role'] !== 'owner') fail('forbidden', 'Somente o proprietário acessa o painel de usuários.', 403);
        if (!password_verify((string)($in['pass'] ?? ''), $users[$i]['hash'])) {
            registerFail();
            fail('invalid', 'Senha do proprietário incorreta.', 401);
        }
        clearFails();
        out(['ok' => true, 'adminToken' => makeToken(['u' => $users[$i]['login'], 'scope' => 'admin', 'exp' => time() + ADMIN_TTL])]);
    }

    case 'list': {
        requireAdmin($in);
        out(['ok' => true, 'users' => array_map('publicUser', loadUsers()), 'plans' => array_keys(PLANS)]);
    }

    case 'create': {
        requireAdmin($in);
        $login = trim((string)($in['login'] ?? ''));
        $pass = (string)($in['pass'] ?? '');
        if (!validLogin($login)) fail('login', 'Login deve ter de 3 a 32 caracteres (letras, números, ponto, hífen ou sublinhado).');
        if (strlen($pass) < 6) fail('pass', 'A senha precisa ter pelo menos 6 caracteres.');
        $users = loadUsers();
        if (findUser($users, $login) !== null) fail('exists', 'Já existe um usuário com esse login.');
        $plan = (string)($in['plan'] ?? '1m');
        $users[] = [
            'login' => $login, 'name' => trim((string)($in['name'] ?? $login)) ?: $login, 'role' => 'user',
            'hash' => password_hash($pass, PASSWORD_DEFAULT), 'active' => true,
            'plan' => $plan, 'expires' => expiryFor($plan, null),
            'createdAt' => gmdate('c'), 'lastLogin' => null, 'notes' => trim((string)($in['notes'] ?? '')),
        ];
        saveUsers($users);
        out(['ok' => true, 'users' => array_map('publicUser', $users)]);
    }

    case 'update': { // name, notes, active, pass, plan (renova), fromToday
        requireAdmin($in);
        $users = loadUsers();
        $i = findUser($users, (string)($in['login'] ?? ''));
        if ($i === null) fail('notfound', 'Usuário não encontrado.', 404);
        $u = &$users[$i];
        if (isset($in['name'])) $u['name'] = trim((string)$in['name']) ?: $u['name'];
        if (isset($in['notes'])) $u['notes'] = trim((string)$in['notes']);
        if (isset($in['active'])) {
            if ($u['role'] === 'owner' && !$in['active']) fail('owner', 'O proprietário não pode ser inativado.');
            $u['active'] = (bool)$in['active'];
        }
        if (isset($in['pass']) && $in['pass'] !== '') {
            $min = $u['role'] === 'owner' ? 8 : 6;
            if (strlen((string)$in['pass']) < $min) fail('pass', "A senha precisa ter pelo menos $min caracteres.");
            $u['hash'] = password_hash((string)$in['pass'], PASSWORD_DEFAULT);
        }
        if (isset($in['plan']) && $u['role'] !== 'owner') {
            $plan = (string)$in['plan'];
            $u['expires'] = expiryFor($plan, !empty($in['fromToday']) ? null : $u['expires']);
            $u['plan'] = $plan;
        }
        unset($u);
        saveUsers($users);
        out(['ok' => true, 'users' => array_map('publicUser', $users)]);
    }

    case 'delete': {
        requireAdmin($in);
        $users = loadUsers();
        $i = findUser($users, (string)($in['login'] ?? ''));
        if ($i === null) fail('notfound', 'Usuário não encontrado.', 404);
        if ($users[$i]['role'] === 'owner') fail('owner', 'O proprietário não pode ser excluído.');
        array_splice($users, $i, 1);
        saveUsers($users);
        out(['ok' => true, 'users' => array_map('publicUser', $users)]);
    }

    default:
        fail('action', 'Ação desconhecida.');
}
