# Space Hub — Bot Discord + API de licencas

Sistema para vender licencas individuais por prazo com vinculo ao HWID reportado pelo executor. O source Lua so sai da API apos a verificacao da key. **Nao e um DRM infalivel:** um executor pode falsificar o HWID, e o codigo Lua recebido pelo cliente pode ser extraido.

## Requisitos
- Node.js 24.15 ou mais recente (usa `node:sqlite`)
- Bot do Discord com scope `bot` e `applications.commands`
- Servidor HTTPS com armazenamento persistente para o banco e source

## Instalacao
1. Extraia o ZIP, abra a pasta no VS Code.
2. Execute `npm install`.
3. Copie `.env.example` para `.env` e preencha DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, ADMIN_USER_IDS, HWID_PEPPER, PUBLIC_API_URL.
4. Coloque sua source completa no caminho `private/SpaceHub.lua` (nao no GitHub publico).
5. Execute `npm start`.
6. Hospede a API com HTTPS publico (VPS, Render com disco persistente, etc.). Nao use hospedagem com disco efemero para guardar o SQLite.
7. Abra `loader.lua` e mude `https://SEU-DOMINIO.com/v1/script` para seu endereco publico HTTPS. Hospede APENAS o loader publicamente.
8. Antes de executar o loader, o comprador configura a propria key: `getgenv().SpaceKey = "SPACE-ID-SEGREDO"`.

## Discord: comandos de administrador
- `/key-criar dias:30 cliente:@usuario` gera key unica. Ela aparece apenas uma vez em resposta visivel somente para voce.
- `/key-info id:XXXXXXXXXXXX` consulta prazo, vinculo e uso.
- `/key-reset id:XXXXXXXXXXXX` remove o HWID vinculado, permitindo trocar de dispositivo.
- `/key-revogar id:XXXXXXXXXXXX` bloqueia uma key imediatamente para futuras validacoes.
- `/key-estender id:XXXXXXXXXXXX dias:30` adiciona dias.

Por seguranca, os comandos aceitam somente IDs definidos em `ADMIN_USER_IDS`, mesmo que outro administrador do servidor tenha permissao de comandos.

## Comportamento
- Ativacao inicial de uma key valida fixa um hash HMAC do HWID na licenca.
- Validacoes futuras exigem o mesmo HWID. Nenhuma key universal e usada.
- Keys tem expiracao; revogacao e reset pelo Discord.
- O banco guarda apenas SHA-256 da key e HMAC do HWID, nao os valores originais.
- Limite simples de 30 requisicoes/minuto por IP por processo.
- Use HTTPS; nunca envie keys por HTTP.
- O HWID depende do executor. Se nao existir uma API compativel, o loader bloqueia e avisa.
- O endpoint responde com Lua apenas apos validacao. Depois de carregado, revogacoes nao encerram execucoes ja iniciadas.

## Sobre acesso ao codigo
Como o script eh executado no dispositivo do comprador, nao existe garantia de impedir dumps, remocao de verificacoes locais ou spoofing de HWID. Para protecao adicional, mantenha logica sensivel no backend e revise taxas/limites de ativacao.

## Nova source obfuscada (15/11/2026)
- A source enviada pelo usuario foi adicionada sem modificacao em `private/SpaceHub.lua`.
- Nunca publique a pasta `private/`, o arquivo `.env` nem o banco de keys.
- O loader publico e `loader.lua`; configure API, Discord e dominio HTTPS antes de distribuir.
- A source obfuscada pode ter verificacoes internas e dependencias que nao foram auditadas; este pacote nao garante sua compatibilidade de runtime.
- SHA-256 da source: 1a0008ba7ae1c5762c534397527e797bd9bb7506cacada6d2cd36adfb7007a74
