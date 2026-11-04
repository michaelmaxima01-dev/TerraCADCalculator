// Monta o pacote de publicação na Hostinger a partir de dist-hostinger/ (gerado por `npm run build:hostinger`).
// Resultado: pacote-hostinger/public_html/ (pasta pronta) e pacote-hostinger/terracad-hostinger.zip
// (extrair dentro de public_html no Gerenciador de Arquivos). Só módulos nativos do Node.
import {cp, mkdir, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import zlib from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist-hostinger'), out = join(root, 'pacote-hostinger'), site = join(out, 'public_html');
const COMPRESS = /\.(js|mjs|css|html|wasm|svg|json|txt)$/i;

async function walk(dir) {
  const list = [];
  for (const e of await readdir(dir, {withFileTypes: true})) {
    const p = join(dir, e.name);
    if (e.isDirectory()) list.push(...await walk(p)); else list.push(p);
  }
  return list;
}

try { await stat(join(dist, 'index.html')); } catch { console.error('dist-hostinger/ ausente. Rode: npm run build:hostinger'); process.exit(1); }
await rm(out, {recursive: true, force: true});
await mkdir(site, {recursive: true});
await cp(join(root, 'hostinger'), site, {recursive: true});
await cp(dist, join(site, 'app'), {recursive: true});
await cp(join(root, 'src', 'auth', 'auth-client.js'), join(site, 'auth-client.js'));
await cp(join(root, 'LICENSE'), join(site, 'LICENSE.txt'));
await writeFile(join(site, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#0b131b"/><path d="M12 4l8 14H4z" fill="none" stroke="#5fd4a6" stroke-width="1.8" stroke-linejoin="round"/></svg>\n');

// versões .gz dos arquivos do app (o gate.php entrega a compactada quando o navegador aceita)
let gz = 0;
for (const f of await walk(join(site, 'app'))) {
  if (!COMPRESS.test(f)) continue;
  const data = await readFile(f);
  if (data.length < 1024) continue;
  await writeFile(f + '.gz', zlib.gzipSync(data, {level: 9})); gz++;
}

const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
await writeFile(join(site, 'LEIA-ME-HOSTINGER.txt'), `Terra CAD ${version} — pacote para a Hostinger
Gerado em ${new Date().toISOString()}

1. No hPanel: Arquivos > Gerenciador de Arquivos > public_html (ou a pasta do subdomínio).
2. Envie terracad-hostinger.zip e use "Extrair" aqui mesmo (os arquivos ficam direto em public_html).
3. Abra https://SEU-DOMINIO/ — aparece a tela de Instalação.
4. No Gerenciador de Arquivos, abra api/data/codigo-instalacao.txt, copie o código e crie a conta do proprietário.
5. Pronto: entre e cadastre os usuários em Conta > Usuários e licenças.

Ao atualizar o site, NUNCA apague api/data/ (contas e chave secreta).
Guia completo: PUBLICAR-HOSTINGER.md no repositório.
`);

// ZIP (deflate) sem dependências
const files = (await walk(site)).sort();
const chunks = [], central = []; let offset = 0;
const dosTime = d => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
const dosDate = d => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
const now = new Date();
for (const f of files) {
  const name = Buffer.from(relative(site, f).split(sep).join('/'), 'utf8'), data = await readFile(f);
  const store = /\.(gz|png|jpg|webp|woff2)$/i.test(f), body = store ? data : zlib.deflateRawSync(data, {level: 9}), crc = zlib.crc32(data);
  const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(store ? 0 : 8, 8);
  h.writeUInt16LE(dosTime(now), 10); h.writeUInt16LE(dosDate(now), 12); h.writeUInt32LE(crc >>> 0, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
  chunks.push(h, name, body);
  const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x031e, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(store ? 0 : 8, 10);
  c.writeUInt16LE(dosTime(now), 12); c.writeUInt16LE(dosDate(now), 14); c.writeUInt32LE(crc >>> 0, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28);
  c.writeUInt32LE((0o100644 << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
  central.push(c, name);
  offset += h.length + name.length + body.length;
}
const cd = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
const zipPath = join(out, 'terracad-hostinger.zip');
await writeFile(zipPath, Buffer.concat([...chunks, cd, end]));
const size = (await stat(zipPath)).size;
console.log(`Pacote pronto: ${relative(root, zipPath)} (${(size / 1048576).toFixed(1)} MB, ${files.length} arquivos, ${gz} pré-compactados)\nPasta equivalente: ${relative(root, site)}${sep}`);
