# WMS Expedição — passagem de contexto para Claude Code

Documento atualizado em **12/08/2026**. Ele resume as alterações realizadas no WMS, o comportamento esperado em produção e os pontos que precisam ser preservados em futuras mudanças.

> **Correção importante:** a exclusão CG automática foi suspensa após evidência de que o status `Não lido` e o grupo `PASTA1/PASTA2` não identificam, isoladamente, a operação responsável. O fechamento voltou a excluir apenas CG manual até existir uma fonte inequívoca para a operação do produto.

---

# Parte 1 — visão não técnica

## 1. Objetivo do sistema

O WMS é usado principalmente em celulares pela equipe de expedição do barracão **Seco**. Os operadores bipam os pedidos durante a descida, registram uma fotografia e recebem a orientação da doca. No final do turno, o supervisor compara os pedidos previstos com os que realmente foram bipados.

Endereço de produção:

- `https://wms.bemvindoalourencoalimentos.com/`

## 2. Fechamento do turno

Foi criada uma área de fechamento que mostra:

- pedidos previstos;
- pedidos bipados;
- pedidos não bipados;
- pedidos bipados sem correspondência na base;
- leituras duplicadas;
- percentual de conclusão;
- progresso por rota;
- rotas sem doca definida;
- data do turno e data da entrega;
- exportação para Excel.

A regra operacional é:

- pedido trabalhado em **11/08** normalmente possui entrega em **12/08**;
- sexta-feira considera a próxima segunda-feira;
- o relatório deve considerar somente a base referente à data de entrega correspondente ao turno;
- pedidos de outras datas não podem aparecer misturados.

O relatório se atualiza automaticamente na tela a cada 15 segundos.

## 3. Exclusões do relatório do Seco

Os seguintes pedidos não entram nas pendências do Seco:

- descrições contendo `PEDIDO PESSOAL`;
- descrições contendo `REDES KA`;
- pedidos classificados manualmente como `CG` por supervisor/admin;
- não há exclusão automática por produto ativa neste momento.

Não se deve classificar um pedido como congelado pelo nome ou número da rota. Essa regra foi testada e removida porque uma rota chamada “Congelado” pode conter produtos secos ou pedidos mistos.

## 4. Investigação de Seco e Congelados — automação suspensa

A regra abaixo chegou a ser implementada e testada, mas **não deve ser usada para excluir pedidos atualmente**:

1. O sistema abre o pedido no Mapa de Carga do EasyLog.
2. Considera somente os itens com status **Não lido**.
3. Consulta o grupo de cada produto:
   - grupo iniciado por `PASTA1` = Seco;
   - grupo iniciado por `PASTA2` = Congelados;
   - qualquer outro grupo ou produto ausente = desconhecido.
4. O pedido só é removido das pendências do Seco quando:
   - existe pelo menos um item Não lido;
   - todos os itens Não lidos são `PASTA2*`;
   - não existe item `PASTA1*`;
   - não existe produto/grupo desconhecido.
5. Qualquer dúvida mantém o pedido no Seco. Essa é uma proteção intencional.

Pedidos mistos continuam pendentes se ainda houver algum item Seco não lido.

Exemplo validado:

- pedido `2173828` ficou como **Seco**;
- na consulta executada havia quatro itens Não lidos classificados como `PASTA1`;
- resultado gravado: `dry`, 4 itens secos, 0 congelados e 0 desconhecidos.

Uma nova evidência mostrou o pedido `2173828` visto pelo Seco com Stroopwafel `OK` e quatro Kombuchas `Não lido`. Ao mesmo tempo, o arquivo de produtos retornou `PASTA1` para essas Kombuchas. Isso contradiz a interpretação simples `PASTA1 = produto Seco`. Os 114 pedidos anteriormente excluídos automaticamente foram restaurados para `unknown` e o filtro automático foi retirado do fechamento.

O botão manual `CG` continua disponível para o supervisor corrigir exceções. Também existe a opção de desfazer uma marcação manual.

## 5. Resultado da investigação automática

Na primeira execução em produção:

- 561 pedidos pendentes foram consultados;
- 114 foram classificados como Congelados;
- 40 foram classificados como Seco;
- 407 permaneceram como desconhecidos por segurança;
- não houve falha de consulta;
- após a nova evidência, os 114 foram restaurados para `unknown`;
- estado seguro final: 40 `dry`, 521 `unknown` e zero exclusões automáticas.

## 6. Atualização automática da base

O computador do usuário funciona como ponte porque `easylog.local` só é acessível na rede local.

A cada 10 minutos ele:

1. entra no EasyLog com credenciais protegidas;
2. baixa a base atual;
3. envia a base para o WMS na VPS;
4. consulta os pedidos pendentes do turno;
5. verifica os itens Não lidos;
6. envia as classificações para a VPS.

O arquivo temporário da base é substituído e apagado depois do envio. O log local é limitado para não ocupar o armazenamento indefinidamente.

## 7. Registro diário de docas

Foi criado o **Registro de doca diária**:

- as rotas do dia são carregadas automaticamente da base;
- o supervisor não precisa decorar o número da rota;
- o sistema mostra código e descrição da rota;
- o supervisor define apenas `frente` ou `trás`;
- ao bipar, o operador recebe a orientação da doca correspondente.

Exemplo: Limeira atrás; Piracicaba na frente.

## 8. Operação de bipagem

O bloqueio que impedia bipar pedidos antes de eles aparecerem na base foi removido. A equipe pode bipar normalmente, e os dados de rota, lote, volume e peso são completados quando uma base posterior contém o pedido.

A prevenção de duplicidade continua existindo. Também foram incluídos avisos e validações para reduzir erros humanos, sem impedir a operação normal.

## 9. Celular, leitor e navegação

Foram feitos ajustes para:

- melhorar a leitura da lista de pendências em telas pequenas;
- exibir os pedidos como cartões no celular em vez de uma tabela espremida;
- aumentar a tolerância e qualidade da leitura de código de barras;
- corrigir atualização direta da página, que antes mostrava `Token ausente`;
- liberar para supervisor as telas de importação e registro de docas;
- restaurar a abertura das imagens antigas após a mudança de banco/infraestrutura;
- invalidar cache antigo das imagens e da interface.

## 10. Importação e contagens

Foram corrigidos:

- erro HTTP `413 Content Too Large` ao importar bases grandes;
- mistura de pedidos de períodos diferentes;
- consolidação de bases parciais por data de entrega;
- contagem de pedidos bipados do turno;
- identificação separada de pedidos bipados que não pertencem à base ativa;
- exibição das datas do turno e da entrega.

Pedidos “fora da base” não reduzem as pendências previstas. Eles aparecem como alerta para conferência.

## 11. Estado operacional atual

- aplicação publicada na VPS;
- sincronização automática ativa no computador `Suporte02`;
- tarefa agendada: `WMS - Sincronizar EasyLog`;
- intervalo: 10 minutos;
- última execução verificada com código de sucesso `0`;
- botão CG manual mantido;
- classificação automática CG suspensa; somente CG manual afeta o fechamento.

---

# Parte 2 — visão técnica

## 12. Repositório e infraestrutura

- Repositório: `Suporte-LA/WMS-Expedi-o`
- Branch de produção: `main`
- Workspace local: `C:\Users\Suporte02\WMS-Expedi-o`
- VPS: `deploy@179.197.235.29`
- Chave SSH local: `%USERPROFILE%\.ssh\crm_vps_ed25519`
- Código na VPS: `/home/deploy/wms-expedicao-code`
- Compose na VPS: `/home/deploy/wms-expedicao/docker-compose.yml`
- Containers:
  - `wms_backend_wms`
  - `wms_frontend_wms`
  - `wms_postgres`
- Banco PostgreSQL real: `wms_expedicao`
- Cloudflare Tunnel: configuração existente em `/home/deploy/crm/cloudflared/config.yml`

Não colocar credenciais, senha do EasyLog, chave de sincronização ou senha do banco em commits ou neste documento.

## 13. Arquitetura relevante

- Frontend: React + TypeScript + Vite.
- Backend: Express + TypeScript.
- Banco: PostgreSQL 15.
- Deploy: Docker Compose na VPS.
- A VPS não acessa `easylog.local`; a integração precisa rodar no computador Windows da rede local.

## 14. Commits principais desta etapa

Ordem cronológica aproximada, do mais recente ao mais antigo:

- `b7f8635` — corrige serialização do lote de classificações EasyLog;
- `bebeb6f` — classificação CG pelos produtos Não lidos e grupos;
- `af873b7` — remove classificação incorreta de congelado pela rota;
- `a93bbe8` — separa a operação seca no fechamento;
- `512011d` — evita acúmulo de arquivos na sincronização;
- `037ad3d` — sincronização automática do EasyLog;
- `dd4c314` — libera bipagem antes da importação da base;
- `e903902` — melhora pendências no celular;
- `35f9fd7` — classificação manual CG no fechamento;
- `3fc9a50` — consolida bases parciais por data de entrega;
- `0e69d76` — proteções contra erro humano;
- `5a7cf72` e `7a9804c` — correções de imagens e cache;
- `8189a24` — aumenta limite de upload;
- `18e347c` — exclui Pedido Pessoal e Redes KA;
- `8ffbc3b` — fechamento e pedidos fora da base;
- `6a42933` — acessos do supervisor e cache;
- `5d8f448` — leitura de código de barras;
- `abe2bc8` e `3fc30f2` — descrição e carga automática das rotas;
- `6b0bda5` — registro diário de docas;
- `23b1f80`, `e52caa5` e `053f8e4` — base do fechamento do turno.

## 15. Arquivos principais alterados

### Backend

- `backend/src/routes/descents.ts`
  - bipagem e consolidação com catálogo;
  - rotas/docas diárias;
  - relatório de fechamento;
  - filtros por data, pedido, rota e lote;
  - exclusões Pedido Pessoal, Redes KA e CG manual;
  - exportação Excel;
  - API de marcação/desmarcação CG manual.
- `backend/src/routes/imports.ts`
  - importação manual e automática;
  - autenticação por chave para o sincronizador;
  - detecção de arquivo idêntico por hash;
  - endpoint de candidatos EasyLog;
  - recebimento das classificações de produtos.
- `backend/src/services/importParser.ts`
  - tratamento das datas do `ExportFileOut`;
  - leitura e normalização da base de pedidos.
- `backend/src/services/uploads.ts`
  - persistência e acesso às imagens.
- `backend/src/app.ts` / rotas e middleware
  - fallback e autenticação relacionados aos acessos corrigidos.

### Frontend

- `frontend/src/pages/DescentReportsPage.tsx`
  - fechamento, cartões, exceções, CG manual, exportação e layout mobile.
- `frontend/src/pages/DescentsPage.tsx`
  - fluxo de bipagem, orientação de doca e operação sem bloqueio da base.
- `frontend/src/components/BarcodeScannerModal.tsx`
  - melhorias na leitura dos códigos.
- `frontend/src/pages/ImportsPage.tsx`
  - importações e mensagens de validação.
- `frontend/src/App.tsx`, `frontend/src/lib/api.ts` e configuração do frontend/nginx
  - navegação, permissões e refresh de rota.
- `frontend/src/index.css`
  - responsividade e legibilidade em celular.

### Automação e deploy

- `scripts/easylog-sync.ps1`
- `scripts/setup-easylog-sync.ps1`
- `deploy/Dockerfile.backend`
- `deploy/Dockerfile.frontend`
- `deploy/docker-compose.yml`

## 16. Banco de dados adicionado

### `daily_dock_assignments`

Migration: `backend/sql/020_daily_dock_assignments.sql`.

Armazena a relação diária entre rota, descrição e posição da doca (`frente`/`tras`).

### `frozen_order_classifications`

Migration: `backend/sql/022_frozen_order_classifications.sql`.

Armazena marcações CG manuais, incluindo usuário responsável e data. É usada como auditoria e permite desfazer a classificação.

### `easylog_order_classifications`

Migration: `backend/sql/023_easylog_order_classifications.sql`.

Chave primária:

- `work_date`
- `order_number`

Campos importantes:

- `classification`: `dry`, `frozen` ou `unknown`;
- `unread_count`;
- `dry_unread_count`;
- `frozen_unread_count`;
- `unknown_unread_count`;
- `checked_at`.

Esta tabela continua armazenando resultados da investigação, mas o fechamento não deve usá-la para excluir pedidos até a operação do produto ser identificada de forma inequívoca.

## 17. Endpoints EasyLog usados

Base local:

- `http://easylog.local`

Login:

- `POST /ajax/acesso.php`
- os tokens ocultos `f`, `m`, `t` e `s` são extraídos da página inicial;
- empresa, e-mail e senha são enviados no formulário.

Download da base:

- `GET /admin/easylog/ajax/export_file_out.php`

Consulta de pedido no Mapa de Carga:

- `POST /admin/easylog/modal/mapadecarga_buscapedido.php`
- body: `pedido=<numero>`;
- a resposta JSON contém `status`, `lote` e `html`;
- o HTML contém código, descrição, quantidade, separador, data e status `OK`/`Não lido`.

Endpoint alternativo de itens descoberto:

- `GET /admin/easylog/ajax/pedidos_itens_ver_carregar.php?codPedido=<numero>...`
- retorna código, descrição e quantidade;
- não foi usado para classificar porque não trouxe o status `Não lido` na consulta testada.

Cadastro/localização de produtos investigado:

- `GET /admin/easylog/ajax/produtosl_carregar.php`
- exportação: `/admin/easylog/export/export_prod_local_posicao.php`
- localização por rua não foi adotada como regra de operação.

## 18. Endpoints adicionados no WMS

Todos os endpoints de automação exigem o header:

- `X-EasyLog-Sync-Key: <chave>`

Endpoints:

- `POST /api/imports/base`
  - recebe `multipart/form-data` com `file`;
  - aceita automação por chave;
  - compara SHA-256 e devolve `unchanged: true` quando a base já foi importada.
- `GET /api/imports/easylog/candidates?date=YYYY-MM-DD`
  - devolve pedidos previstos, ainda não bipados e não marcados manualmente como CG;
  - aplica os filtros Pedido Pessoal/Redes KA.
- `POST /api/imports/easylog/classifications`
  - recebe `workDate` e lista de classificações;
  - faz upsert em `easylog_order_classifications`.
- `GET /api/descents/closing-report`
- `GET /api/descents/closing-report/export`
- `POST /api/descents/closing-report/cg`
- `DELETE /api/descents/closing-report/cg/:orderNumber?date=YYYY-MM-DD`

## 19. Sincronizador Windows

### Arquivos locais

- Configuração protegida: `%LOCALAPPDATA%\WMS-Expedicao\easylog-sync.json`
- Grupos de produtos: `%LOCALAPPDATA%\WMS-Expedicao\product-groups.json`
- Log: `%LOCALAPPDATA%\WMS-Expedicao\easylog-sync.log`
- Arquivo temporário: `%LOCALAPPDATA%\WMS-Expedicao\ExportFileOut.xls`

Senha e chave são protegidas por DPAPI através de `ConvertFrom-SecureString`. A configuração só funciona normalmente para o mesmo usuário Windows que a criou.

### Tarefa agendada

- Nome: `WMS - Sincronizar EasyLog`
- Executável: Windows PowerShell
- Script: `C:\Users\Suporte02\WMS-Expedi-o\scripts\easylog-sync.ps1`
- Frequência: 10 minutos
- Usuário: `Suporte02`, modo interativo

### Proteções de armazenamento

- `ExportFileOut.xls` é apagado no bloco `finally`;
- o próximo download substitui o anterior;
- o log é reduzido para as últimas 500 linhas quando ultrapassa 1 MB.

## 20. Mapa de grupos de produtos

Fonte usada:

- `C:\Users\Suporte02\Desktop\produtos.xlsx`

Estrutura validada:

- colunas: `Cod`, `produto`, `grupo`;
- 5.071 produtos;
- nenhum código duplicado;
- nenhum conflito de grupo por código.

O arquivo foi convertido para `product-groups.json` no diretório local da automação. Ele **não contém preços nem credenciais**, apenas código → grupo.

Distribuição observada inclui, entre outros:

- `PASTA1`;
- `PASTA2`;
- `PASTA2 CG`;
- `PASTA2 RF`;
- `TROCA1`, `TROCA2`;
- `COMODATO1`, `COMODATO2`;
- grupos em análise.

Somente prefixos `PASTA1` e `PASTA2` são reconhecidos automaticamente. Os demais viram `unknown`.

### Normalização do código

Os códigos retornados nos itens podem possuir dois dígitos de sufixo. O sincronizador tenta:

1. código completo;
2. se não encontrar, código sem os dois últimos dígitos.

Exemplos observados:

- `619706` → `6197`;
- `146101` → `1461`;
- `1148406` → `11484`.

## 21. Regra SQL do fechamento

A data esperada da entrega é calculada a partir da data operacional:

```sql
$1::date + CASE EXTRACT(ISODOW FROM $1::date)::int
  WHEN 5 THEN 3
  WHEN 6 THEN 2
  ELSE 1
END
```

O catálogo é filtrado por `c.base_date = delivery_date` e pelas exclusões. A presença em `descents` deve usar simultaneamente:

- mesmo `order_number`;
- mesmo `work_date`.

Não voltar a contar todas as descidas históricas do pedido sem limitar a data do turno.

## 22. Imagens e refresh de página

As imagens são persistidas no volume Docker `wms_uploads`. O backend deve continuar servindo o caminho de uploads e o proxy do frontend deve encaminhá-lo corretamente.

Rotas SPA como `/descents` precisam retornar `index.html` no refresh. A API deve permanecer sob `/api`; não deixar o fallback da SPA capturar chamadas da API, nem deixar o middleware de autenticação tratar uma rota frontend como endpoint protegido.

## 23. Limite de upload

O erro `413 Content Too Large` foi corrigido aumentando os limites do proxy para bases grandes. Ao alterar nginx/frontend Docker, preservar a configuração de tamanho máximo do corpo da requisição.

## 24. Deploy recomendado

Fluxo usado:

```powershell
git push origin main
ssh -i "$env:USERPROFILE\.ssh\crm_vps_ed25519" deploy@179.197.235.29
```

Na VPS:

```bash
cd /home/deploy/wms-expedicao-code
git pull --ff-only origin main
cd /home/deploy/wms-expedicao
docker compose up -d --build wms_backend wms_frontend
```

O container do backend executa as migrations compiladas na inicialização. Após deploy, verificar:

```bash
docker logs --tail 100 wms_backend_wms
docker compose ps
```

Observação: executar `docker compose run --rm wms_backend npm run db:migrate` falhou porque a imagem final não contém `tsx`. O fluxo correto é reconstruir/iniciar o backend, cujo `CMD` executa `node dist/scripts/migrate.js` antes do servidor.

## 25. Estado do worktree e cuidados com Git

O worktree local possui muitas alterações antigas já staged e arquivos não rastreados que pertencem ao usuário. Não usar:

- `git reset --hard`;
- `git checkout -- .`;
- limpeza ampla do repositório;
- commits com `git add .` sem revisar.

Nas alterações recentes foi usado:

```bash
git commit --only <arquivos-da-tarefa> -m "mensagem"
```

Na VPS também existem alterações locais, como `backend/src/db.ts`, e Dockerfiles não rastreados. O `git pull --ff-only` funcionou porque não houve conflito, mas esses arquivos não devem ser apagados sem investigação.

## 26. Pontos de atenção e próximos passos possíveis

1. **Mapa de produtos estático:** `product-groups.json` foi gerado a partir de `produtos.xlsx`. Se o cadastro mudar, o JSON precisa ser regenerado. Uma melhoria futura é automatizar a exportação dos grupos, caso seja encontrado um endpoint confiável no EasyLog.
2. **407 desconhecidos na primeira execução:** isso é esperado pela regra conservadora. Investigar grupos/códigos antes de ampliar a classificação automática.
3. **Carga no EasyLog:** a primeira execução consultou 561 pedidos e levou cerca de um minuto. Atualmente os candidatos ainda pendentes podem ser consultados novamente a cada ciclo. Se o volume crescer, adicionar cache/TTL sem usar uma classificação antiga para excluir pedido incorretamente.
4. **Computador como ponte:** se o PC estiver desligado, desconectado da rede local ou sem sessão adequada, a base e as classificações não atualizam. O WMS online continua funcionando com a última base.
5. **Falha segura:** qualquer erro de consulta vira `unknown`; nunca converter falha em `frozen`.
6. **Rotas não definem operação:** não reintroduzir filtro por nome/número de rota.
7. **Pedido sem itens Não lidos:** deve ficar `unknown`, não `frozen`.
8. **Grupos:** não usar `PASTA1/PASTA2` isoladamente para excluir pedidos. A evidência do pedido `2173828` contradiz a interpretação inicial.

## 27. Checklist de validação após mudanças

- Build do backend: `npm run build -w backend`.
- Build do frontend: `npm run build -w frontend`.
- Validar sintaxe do PowerShell.
- Confirmar logs do backend sem erro de migration.
- Conferir a tarefa agendada com `Get-ScheduledTaskInfo`.
- Executar sincronização manual e verificar as últimas linhas de `easylog-sync.log`.
- Confirmar que pedidos `frozen` possuem:
  - `unread_count > 0`;
  - `dry_unread_count = 0`;
  - `unknown_unread_count = 0`;
  - `frozen_unread_count = unread_count`.
- Testar um pedido misto conhecido.
- Testar refresh direto de `/descents`.
- Testar imagens antigas e novas.
- Testar importação de uma base grande.
- Testar a tela em celular real.

## 28. Regra de ouro

O sistema pode manter um pedido a mais como pendente para o supervisor conferir, mas não deve retirar automaticamente um pedido do Seco com informação incompleta. Toda automação CG deve continuar sendo **conservadora, auditável e reversível**.
