# Publicar o Terra CAD na Hostinger

O Terra CAD online é um site **sem banco de dados**:

- **O app roda no navegador.** Pontos, DWG/DXF, malhas, volumes e exportações são processados no computador de quem usa. Nenhum desenho é enviado ao servidor.
- **Os projetos ficam no PC do usuário.** Use **Salvar** (gera o `.json`) e **Abrir** no app. O servidor não guarda projetos.
- **O servidor só controla o acesso.** O arquivo PHP `api/auth.php` guarda as contas, senhas (bcrypt) e licenças em `api/data/*.json`. O `gate.php` só entrega o app para quem tem sessão válida.

## 1. Requisitos

- Plano de hospedagem da Hostinger com PHP 7.4 ou superior (todos os planos Web/Cloud atuais atendem).
- Domínio ou subdomínio com **SSL ativo**. No hPanel: *Segurança → SSL → Instalar*, depois ative *Forçar HTTPS*. O login só funciona com HTTPS.

## 2. Gerar o pacote (no seu computador)

Na pasta do projeto (`C:\Users\Codex SEG\Documents\TerraCADCalculator`), instale as dependências:

```bash
npm ci
```

Gere o pacote:

```bash
npm run build:hostinger
```

O comando cria:

- `pacote-hostinger\terracad-hostinger.zip`: o arquivo que vai para a Hostinger;
- `pacote-hostinger\public_html\`: a mesma coisa em pasta, se preferir enviar por FTP.

## 3. Enviar para a Hostinger

1. No hPanel: *Sites → Gerenciar → Arquivos → Gerenciador de Arquivos*.
2. Abra `public_html`, ou a pasta do subdomínio. Também funciona numa subpasta, por exemplo `public_html/terracad/`.
3. Se existir o arquivo de boas-vindas `default.php` da Hostinger, apague.
4. Clique em **Enviar** (Upload) e escolha `terracad-hostinger.zip`.
5. Clique com o botão direito no zip → **Extrair** → extraia **na própria pasta** (não crie subpasta).
6. Apague o zip depois de extrair.

A pasta fica assim:

```
public_html/
├── .htaccess            regras: HTTPS, login liberado, resto pelo porteiro
├── gate.php             porteiro: confere a licença e entrega o app
├── login.html/.js/.css  tela de entrada e de instalação
├── auth-client.js       cliente de login
├── api/auth.php         contas e licenças (cria api/data/ sozinho)
├── app/                 o Terra CAD compilado (bloqueado para acesso direto)
├── LICENSE.txt          licença GPL-3.0
└── LEIA-ME-HOSTINGER.txt
```

## 4. Primeiro acesso: conta do proprietário

Não existe senha padrão.

1. Abra `https://SEU-DOMINIO/`. Aparece a tela **Instalação**.
2. No Gerenciador de Arquivos, abra `api/data/codigo-instalacao.txt` e copie o código (ex.: `F620-67DE-91E1`).
3. Na tela de instalação, informe o código, seu nome, um login e uma senha de no mínimo 8 caracteres.
4. O app abre. O arquivo do código é apagado automaticamente.

Só quem tem acesso ao hPanel consegue ler o código. Ninguém que encontre o site antes de você consegue se tornar o proprietário.

## 5. Gerenciar usuários e licenças

No app, clique no seu nome (canto superior direito) → **Usuários e licenças** → confirme sua senha. O painel fica liberado por 20 minutos.

- **Nova conta:** login, nome, senha (o botão *Gerar* cria uma) e plano (1 dia, 1 semana, 1 mês, trimestral, semestral, anual, vitalícia). Login e senha são copiados para a área de transferência.
- **Renovar:** escolha o plano e clique *Renovar*. O prazo soma a partir do vencimento atual. Marque **de hoje** para contar a partir de hoje.
- **Ativo/Inativo:** bloqueia o acesso na hora. O usuário é barrado na próxima página que abrir ou na revalidação automática (a cada 20 min).
- **Nova senha:** gera e copia uma senha nova.
- **Excluir:** remove a conta. O proprietário não pode ser excluído nem inativado.

O que o usuário vê:

- aviso quando faltam 7 dias ou menos para vencer;
- licença vencida ou conta inativa recusa o login com a data e a orientação;
- se a sessão cair durante o uso, aparece **Acesso encerrado**, com o botão **Salvar projeto** para não perder o trabalho aberto;
- depois de 8 senhas erradas, o IP fica bloqueado por 15 minutos.

## 6. Atualizar para uma versão nova

1. Gere um novo pacote: `npm run build:hostinger`.
2. No Gerenciador de Arquivos, apague a pasta **`app/`**. Ela só tem o app compilado; isso evita acumular arquivos antigos.
3. Envie e extraia o novo zip, substituindo os arquivos.

**Nunca apague `api/data/`.** É onde ficam as contas, as licenças e a chave secreta das sessões. O zip não contém essa pasta, então extrair por cima é seguro.

## 7. Backup e recuperação

- Baixe de vez em quando `api/data/users.json` (e `secret.key`) pelo Gerenciador de Arquivos e guarde em local seguro. O arquivo contém as senhas criptografadas, não em texto.
- **Esqueceu a senha do proprietário:**
  1. Renomeie `api/data/users.json` para `users.bak.json`.
  2. Abra o site: ele volta para a Instalação, com um código novo em `codigo-instalacao.txt`.
  3. Crie o proprietário de novo.

  As outras contas ficam no `users.bak.json`. Para recuperá-las, restaure o backup.

## 8. Segurança e limites

- **Sessão:** vale 12 h e vai num cookie `HttpOnly`/`Secure`. Os arquivos do app (`app/`) só saem pelo `gate.php` depois de conferir conta ativa e licença no prazo.
- **Arquivos já abertos:** como o app roda no navegador, quem já tem acesso válido pode guardar os arquivos que recebeu. O controle de licença decide *quem entra no site*.
- **GPL-3.0:** o Terra CAD usa a LibreDWG para ler DWG. O código-fonte deve ficar disponível para quem usa (o rodapé do login aponta para a licença). Considere colocar o link do repositório público ali.

## 9. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Login diz "O servidor não respondeu como esperado (PHP desativado?)" | `api/auth.php` não executa | Confira se a pasta `api/` foi extraída e se o PHP está ativo (hPanel → Avançado → Configuração do PHP) |
| Página "Acesso negado"/403 em tudo | `mod_rewrite` ou `.htaccess` ausente | Confira se o `.htaccess` foi extraído (arquivos ocultos: ative "mostrar ocultos") |
| Redireciona sem parar | HTTPS atrás de proxy/CDN | Ative o SSL no hPanel; se usar Cloudflare, use o modo SSL "Full" |
| Volta sempre para o login | Cookie bloqueado ou site aberto por `http://` | Use `https://` e permita cookies do site |
| DWG não abre online | Servidor não entregou o `.wasm` | Confira se `app/assets/*.wasm` existe; o `gate.php` já envia `application/wasm` |
| "Não foi possível criar a pasta de dados" | Permissão de escrita | Dê permissão 755 à pasta `api/` no Gerenciador de Arquivos |

## 10. Testar o pacote no seu computador (opcional)

Precisa do PHP instalado. Gere o pacote:

```bash
npm run build:hostinger
```

Inicie o servidor do PHP:

```bash
php -S 127.0.0.1:8080 -t pacote-hostinger/public_html scripts/hostinger-local-router.php
```

Abra http://127.0.0.1:8080/ e siga a Instalação. Neste teste local, o código fica em `pacote-hostinger/public_html/api/data/codigo-instalacao.txt`. O servidor embutido do PHP não lê `.htaccess`; o roteador de `scripts/` reproduz essas regras.

O uso local sem login continua igual: `npm run dev`, ou `npm run build` seguido de `npm start`.
