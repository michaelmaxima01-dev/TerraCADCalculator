import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
const root=fileURLToPath(new URL('./dist/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm'};
try{await stat(resolve(root,'index.html'));}catch{console.error('Pasta dist ausente. Copie o pacote completo ou execute npm install e npm run build.');process.exit(1);}
const port=Number(process.env.PORT||4173);
createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const path=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!path.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(403);return res.end('Acesso negado');}const body=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(body);}catch{res.writeHead(404);res.end('Arquivo nao encontrado');}}).on('error',e=>{console.error(e.code==='EADDRINUSE'?`Porta ${port} ocupada. Feche a outra instancia ou defina PORT antes de iniciar.`:e.message);process.exitCode=1;}).listen(port,'127.0.0.1',()=>console.log(`Terra CAD 4 pronto: http://127.0.0.1:${port}\nAbra esse endereco no navegador e mantenha este terminal aberto.\nCtrl+C encerra o programa. Nao precisa de npm install para usar este pacote compilado.`));
