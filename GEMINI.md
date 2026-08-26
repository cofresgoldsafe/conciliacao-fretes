# GEMINI.md — Memoria de Projeto & Diretrizes Operacionais

> **Projeto:** Gemini-Cli (Hub de Integracoes Financeiras, Logistica e ERP)  
> **Status:** Atencao Critica (Vulnerabilidades de Seguranca P0 e Alto Acoplamento Monolitico no Frontend)  
> **Data de Auditoria:** 24/08/2026  

---

## 1. Visao Geral e Dominio do Sistema
O **Gemini-Cli** e uma plataforma integrada de gestao operacional, financeira e logistica. O sistema atua como ponto central de orquestracao entre operacoes bancarias digitais (Banco Inter via API Pix/Webhooks, Mercado Pago), calculo e processamento de tabelas de frete (Correios, Rodonaves, layouts customizados) e integracao direta com o ERP TOTVS Protheus via rotinas AdvPL (`AMARFRET.PRW`).

### Principais Personas Atendidas
- **Operador Financeiro / Controladoria:** Gestao de extratos, emissao de cobrancas Pix/Boleto, conciliacao bancaria automatizada e monitoramento de webhooks.
- **Analista de Logistica / Expedicao:** Importacao, parsing e conciliacao de faturas/tabelas de frete de transportadoras e geracao de amarracao contabil/fiscal.
- **Administrador do Sistema:** Controle de acessos, configuracao de credenciais de integracao, visualizacao de trilhas de auditoria e logs de atividades.

---

## 2. Stack Tecnologica e Arquitetura
- **Frontend:** Single Page Application (SPA) monolitica em Vanilla JavaScript (`public/app.js` com ~3.000 linhas), HTML5 (`index.htm`) e CSS customizado.
- **Backend & Servicos de Integracao:** Node.js (JavaScript ES6+/CommonJS) para consumo de APIs bancarias (`inter_api.js`, `consultar_extrato_mp.js`) e sincronizacao de dados.
- **Processamento e Extracao de Dados:** Python 3 (`parser_correios.py`, `parser_rodonaves.py`, `parser_tipo2.py`) para parsing de planilhas e arquivos de retorno de frete.
- **ERP Legacy & Extensoes:** TOTVS Protheus AdvPL (`AMARFRET.PRW`) para validacao e gravacao de amarracoes de frete em tabelas de producao.
- **Persistencia de Dados:**
  - *Legado / Arquivos Planos:* JSON locais (`data/activities.json`, `data/history.json`, `data/inter_webhooks.json`, `data/users.json`).
  - *Relacional (Em transicao):* PostgreSQL (`postgres_db.js`).
- **Padrao Arquitetural:** Hibrido (Micro-scripts + SPA monolito), em fase de transicao para arquitetura modular orientada a servicos e persistencia ACID.

---

## 3. Backlog Consolidado de Pendencias Priorizadas

### Prioridade 0 (Critico/Seguranca)
1. [x] **Remocao do Interceptor Global de Fetch Inseguro (`app.js`):** Implementada funcao `isSameOriginUrl(url)` para restringir o envio de tokens Bearer/credenciais exclusivamente a endpoints de mesma origem (`same-origin`), prevenindo vazamento de tokens para APIs externas.
2. [x] **Eliminacao de Bypass de Permissoes e Backdoors (`server.js`):** Extintos fallbacks insecure de `x-user-username` sem assinatura e pseudo-tokens `auth-token-*`. Autorizacao RBAC (`requireRole`) e identidade (`requireAuth`) 100% ancoradas na verificacao criptografica de JWT assinado no backend.
3. [x] **Correcao de IDOR/BOLA na Troca de Senha (`/api/auth/change-password`):** Criado endpoint dedicado com validacao obrigatoria da senha atual via bcrypt e derivacao estrita da identidade a partir do JWT decodificado no servidor, impedindo alteracoes nao autorizadas ou manipulacao de IDs de terceiros.
4. [x] **Substituicao de Headers de Identidade Injetados (`x-user-*`):** Extinta a emissao e consumo de headers customizados nao assinados (`x-user-username`, `x-user-name`). Autenticacao e autorizacao padronizadas 100% no header RFC `Authorization: Bearer <token>` com verificacao criptografica de JWT.
5. [x] **Autenticação em Dois Fatores (2FA) por E-mail (`mailer.js`, `postgres_db.js`, `server.js`):**
   - **Fluxo com Código de 4 Dígitos:** Códigos de 4 dígitos numéricos criptograficamente aleatórios (`crypto.randomInt(1000, 10000)`), hasheados com bcrypt (salt 10) e armazenados com TTL de 5 minutos na tabela `user_2fa_tokens` (Postgres / Map em memória).
   - **Proteção Anti-Brute Force:** Limite estrito de 3 tentativas incorretas por token com bloqueio imediato do token (`BLOCKED`).
   - **Rate Limiting Dedicado:** `verify2FALimiter` (20 req / 5 min) e `resend2FALimiter` (máx 2 req / 45s).
   - **Prevenção de Vazamento PII:** Função `maskEmail` para ofuscar o e-mail no payload e na interface do usuário (ex: `al*******@oaco.com.br`).
   - **Gestão de Usuários com E-mail:** Atualização de cadastro de usuários com campo `email` no frontend e validação sintática RFC 5322 no backend.
   - **Aviso Informativo de Latência de E-mail:** Inclusão de aviso destacado em negrito no modal 2FA informando que o e-mail pode demorar até 60 segundos para entrega via Mailjet/SMTP, evitando confusão ou abandono de tela pelo operador.
6. [x] **Módulo de E-mails Resiliente e Aprendizados de Nuvem (`mailer.js`):**
   - **Driver Híbrido SMTP / Mailjet REST API (HTTPS 443):** Provedores de nuvem (Render, AWS) bloqueiam portas SMTP clássicas (25, 465, 587) por padrão. Para máxima resiliência, implementou-se envio direto via **Mailjet HTTP API v3.1** (`https://api.mailjet.com/v3.1/send` na porta 443 via módulo `https` nativo) utilizando Basic Auth com as credenciais já existentes (`SMTP_login` e `SMTP_pass`).
   - **Compatibilidade SMTP Corporativo:** Suporte a `tls: { rejectUnauthorized: false }` para certificados autoassinados/intermediários e flexibilidade de variáveis (`SMTP_server`, `SMTP_login`, `SMTP_pass`, `SMTP_port`, `SMTP_from`, `SMTP_secure`).
   - **Ferramenta de Diagnóstico em Tempo Real:** Endpoint `/api/auth/diag-smtp` para testes imediatos de conectividade e validação de remetentes.
7. [x] **Integração Bancária mTLS Banco Inter — Metal Pleno / S4BW (`inter_api.js`):**
   - **Autenticação mTLS Multi-Empresas:** Suporte a credenciais mTLS no Render via `MP_clientId`, `MP_clientSecret`, `MP_cert` e `MP_key` (Empresa 14 - Metal Pleno / S4BW - Conta `3974073-9`).
   - **Decodificação Resiliente de Certificados:** Normalização automática de quebras de linha `\n` escapadas e suporte a certificados codificados em Base64 ou texto puro PEM.
   - **Conciliação e Saldo em Tempo Real:** Consulta ao vivo de saldo (`/banking/v2/saldo`) confrontado com `SE8140` e extrato (`/banking/v2/extrato`) com agrupamento inteligente N:1 e 1:1 contra `SE5140`.
8. [x] **Módulo de Análise de Crédito Comercial & Motor de Risco (`analise_credito_engine.js`, `postgres_db.js`, `server.js`, `public/app.js`):**
   - **Integração Completa ERP Protheus:** Consulta automática de pedidos de venda (`SC5`/`SC6`), cadastro de clientes (`SA1`), condições de pagamento (`SE4`) e histórico financeiro unificado multi-empresa (`SE1` nas empresas 09, 14, 15 e 16).
   - **Comparação Inteligente de Endereços:** Algoritmo tolerante a variações Protheus x Receita Federal com limpeza de números com zeros à esquerda (`00099` -> `99`), inclusão de complementos e suporte a logradouros equivalentes.
   - **Maturidade Digital Automática (Substituição ScamAdviser):** Consulta em tempo real da idade do domínio no RDAP Registro.br, primeiro snapshot histórico no Wayback Machine (Archive.org) e identificação de provedor de e-mail via DNS MX (Google Workspace, Microsoft 365, Servidores Dedicados).
   - **Automação de E-mails e Site:** Detecção automática de e-mails corporativos, múltiplos e-mails no cadastro (`A1_EMAIL`) para confirmação de contato financeiro, filtragem de provedores genéricos (@gmail, @uol, @terra) e validação de site corporativo.
   - **UX Diferenciada Manual vs Automático & Filtros Temporais:** Asterisco (`*`) restrito aos 11 campos de preenchimento manual do analista (Entrega=Cadastro, Maps Fachada, Registro.Br, Score Serasa, Protestos, Valor Protestos, PFIN, Cheques, FGTS Regular, Razão=FGTS, 3 NFs), removido dos campos automáticos, e filtro por período temporal ("Últimos 7 dias" e "Últimos 30 dias") na listagem do histórico.
   - **Calibração Total de Pesos e Critérios do Score:** Painel de configuração em 6 blocos na aba Configurações (`#tab-config-score`) cobrindo 100% dos critérios avaliados no motor (Limites Monetários, Condições Comerciais, Cadastrais RF/Protheus, Estudo de E-mails/RDAP/Wayback/MX, Idade/Capital Social e Serasa/Protestos/Certidões) com sincronização em tempo real e restauração para os padrões oficiais.
   - **Snapshots Imutáveis de Pontuação & Ficha com Extrato de Score:** Gravação em texto/JSON de todos os pontos atribuídos a cada parâmetro no ato da consulta (`detalhes_pontos`), garantindo imutabilidade histórica mesmo com rebalanceamento futuro dos pesos. Renderização de badges de pontuação (`+X pts`, `-Y pts`, `0 pts`) ao lado de cada parâmetro na Ficha do Pedido e inclusão do bloco de Extrato & Conferência Matemática do Score com validação 100% auditável.
   - **Validação de Decisão Final do Analista:** Estado inicial do select configurado como `Decisão (atenção ao gravar)`. Gravações no banco são bloqueadas no frontend e no backend se o analista não selecionar uma decisão operacional concreta (*Liberado, Liberar com Entrada, Só À Vista, Bloqueado, Cancelado*).
   - **Auditoria de Usuário & Fallback Gracioso:** Persistência automática do analista autenticado (via token JWT ou payload) na tabela `analise_credito_history` (`usuario VARCHAR(100)`), dados_completos e JSON local. Exibição da identificação do analista no cabeçalho da Ficha (`Empresa: XX | Cliente: ... | Data: ... | Usuário: <nome/login>`), com fallback automático para `"Sistema"` exclusivamente em registros legados gravados antes da existência do campo ou em rotinas automatizadas sem sessão humana. Suporte a filtro por operador no histórico.
   - **Carga e Reanálise via Ficha do Pedido:** O botão `⚡ Carregar no Formulário` da modal restaura integralmente os dados cadastrais, comerciais e de maturidade digital (RDAP, Wayback, MX), preenche o campo de busca superior (`creditoNumPedido`) e dispara instantaneamente o recálculo do Score em Tempo Real (`atualizarScoreEmTempoReal()`).
   - **Rastreamento Contínuo de Atividades & Heartbeat de Sessão:** O sistema agora registra as ações de consulta ao Protheus (`CONSULTA_CREDITO`) e gravação (`GRAVACAO_CREDITO`) no feed de auditoria (`user_activities`), além de manter heartbeat ativo a cada 5 minutos via `/api/auth/session-ping`, atualizando em tempo real o status de engajamento (*Último Acesso Ativo*) de cada operador logado.
9. [x] **Sub-aba Pedidos Abertos no Módulo Vendedores (`protheus_db.js`, `server.js`, `public/index.html`, `public/app.js`, `test_pedidos_abertos.js`):**
   - **Listagem Multi-Empresa de Pedidos Não Faturados:** Consulta unificada de pedidos em aberto (`C5_NOTA = ''` e não cancelados) nas 3 empresas (Metal Pleno 14, GSI 15 e OACO 16).
   - **Mapeamento de Bloqueios SC9 (Power BI):** Agregação condicional de itens com precedência estrita de bloqueio contra mascaramento ASCII (`C9_BLEST = '02'` ➔ `BLOQ POR ESTOQUE`; `C9_BLCRED = '01'` ➔ `BLOQ NO CREDITO`; `10` ou ausência de bloqueio ➔ `SEM BLOQ ESTOQ` / `SEM BLOQ CREDITO`).
   - **Segurança Fail-Closed e Proteção Anti-IDOR/BOLA:** Autenticação JWT obrigatória em todos os endpoints de vendedores (`/api/vendedores/pedidos/*`), propagação de `vendorCode` em `getUserFromReq` e bloqueio estrito (403) caso vendedor tente acessar pedidos de terceiros.
   - **Integração Externa Pipedrive e Detalhes:** Coluna `CODWEB` com link inteligente para o CRM Pipedrive (`target="_blank" rel="noopener noreferrer"`) e clique no número do pedido abrindo a modal de detalhes de itens e faturamento (`SC6`/`SF4`).
   - **Filtros Dinâmicos, Ordenação & UX:** Filtros reativos por Empresa (`MP`, `GSI`, `OACO`) e Vendedor (`Figueiredo`, `Andrea`, `Juliana`), ordenação interativa crescente/decrescente com comparação numérica nas colunas `CodWeb` e `Ped. Venda`, badges de status em alto contraste e suíte de testes com 18 asserções automatizadas.
10. [x] **Sub-aba Pedidos Compras no Módulo Vendedores (`protheus_db.js`, `server.js`, `public/index.html`, `public/app.js`, `test_pedidos_compras.js`):**
   - **Consulta de Compras em Aberto (SC7):** Extração unificada nas tabelas `SC7140` (MP), `SC7150` (GSI) e `SC7160` (OACO) de itens com saldo positivo (`C7_QUANT - C7_QUJE > 0`) e resíduo ativo (`C7_RESIDUO <> 'S'`).
   - **Filtro Estrito de Produtos PA & Faixa de Códigos:** Filtragem direta no campo `C7_PRODUTO` entre `001000000000000` e `019999999999999` (faixa correspondente aos produtos acabados `PA`), descartando insumos, matérias-primas e serviços (`090...`) tanto na query T-SQL do backend quanto na camada reativa do frontend.
   - **Mapeamento e Identificadores:** Identificador visual `PedCom` com prefixo da empresa (ex: `MP000207`, `GSI000150`, `OACO000320`), data de previsão `C7_DATPRF` formatada e busca de fornecedor via subselect em `SA2010`.
   - **Busca Instantânea & Métricas:** Filtro instantâneo conforme digitação por produto, código, pedido ou fornecedor, filtro por empresa, cards de métricas (**`Ped Compras em Aberto`**, saldo total e previsão mais próxima), ordenação de 4 colunas e 10 testes automatizados.
11. [x] **Sub-aba Saldos em Estoque no Módulo Vendedores com Job Supabase & Visual Power BI (`protheus_db.js`, `postgres_db.js`, `server.js`, `public/index.html`, `public/app.js`, `test_saldos_estoque.js`):**
   - **Consolidação Multi-Empresa e Catálogo PA:** Leitura combinada de catálogo `SB1` (produtos acabados PA, descartando `XXX`, `X` e tipo diferente de PA), saldos físicos `SB2` (`SB2140` Metal Pleno 14, `SB2150` GSI 15, `SB2160` OACO 16), vendas em carteira não faturadas `SC6` (`SC6140`, `SC6150`, `SC6160`) e compras em aberto `SC7` (`SC7140`, `SC7150`, `SC7160`).
   - **Cálculo Matemático e Fórmulas:** Cálculo em tempo real de `SALDO_TOTAL = (SALDO * PREÇO)` com arredondamento monetário e agregação por empresa.
   - **Job de Background & Sincronização Agendada (Supabase + Fallback JSON):**
     - Rotina de execução periódica (cron/timer a cada 60 min no horário comercial: segunda a sexta, 07h às 19h horário de Brasília - `America/Sao_Paulo`).
     - Carga inicial inteligente no startup (`JOB_STARTUP`) se a base/cache estiver vazia.
     - Persistência na tabela relacional PostgreSQL / Supabase `produtos_saldo_estoque` e logs de auditoria `estoque_sync_logs` com duração em ms e gatilho (`JOB_AUTO`, `JOB_STARTUP`, `MANUAL`).
     - Fallback gracioso automático para cache JSON em disco (`data/estoque_saldos_cache.json`) em caso de oscilação ou indisponibilidade de conexão com o banco.
   - **Visual Power BI, Experiência do Usuário (UX) & Paginação:**
     - 3 Cards KPIs principais no topo: *Itens em Estoque (Saldo > 0)*, *Itens sem Estoque (Saldo = 0)* e *Valor Total em Estoque (R$)* calculados sobre a totalidade da base comercial.
     - Tabela responsiva com 7 colunas (`DESCRIÇÃO`, `PREÇO`, `SALDO`, `SALDO_TOTAL`, `C6 QTD VENDAS`, `QTD COMPRAS`, `PONTO PED`).
     - Ordenação interativa bidirecional em todas as colunas com formatação numérica e monetária BRL.
     - **Filtros Comerciais Estritos:**
       - Catálogo Protheus restrito exclusivamente a Produtos Acabados (`B1_TIPO = 'PA'`), descartando códigos com `X` ou descrições com `XXX`.
       - Exclusão de itens bloqueados no ERP Protheus (`B1_MSBLQL <> '1'`).
       - Escopo estrito dos 4 Grupos Comerciais Oficiais: **Grupo 001 - Cofres**, **Grupo 002 - Fragmentadoras**, **Grupo 010 - Plastificação** e **Grupo 018 - Armários & Carrinhos** (eliminando grupos de TI como `017` e o grupo `020`).
     - **Barra de Filtros Compacta e Reativa:**
       - Campo de busca instantânea textual por código ou descrição com layout compacto (34px de altura).
       - Select dropdown dedicado por **Grupo do Produto** (*Todos os Grupos Comerciais, 001, 002, 010, 018*).
       - Select por **Disponibilidade** (*Todos, Somente com Saldo, Somente sem Estoque, Com Vendas SC6, Com Compras SC7*).
       - Botão **🧹 Limpar** para reset simultâneo de todos os critérios de busca.
     - **Paginação Dinâmica Inteligente:**
       - Resumo visual no rodapé: `Exibindo X a Y de Z produtos`.
       - Seletor de itens por página configurável (**50 por página** como padrão, com opções para **25**, **100** e **Todos**).
       - Botões de navegação rápida (`« Primeira`, `‹ Anterior`, `Próxima ›`, `Última »`) e botões numéricos com destaque visual na página ativa.
       - A paginação atua no client-side garantindo que ordenação e busca reflitam instantaneamente nos 368 produtos ativos sem requisições desnecessárias.
     - Badge de status da sincronização com indicador verde/amarelo, timestamp da última execução e botão de disparo manual com Cooldown de 2 minutos (`429 Too Many Requests`).
   - **Modal Drilldown Multi-Empresa com 3 Guias:**
     - Clique na linha do produto abre modal com 4 mini KPIs (*Preço Unitário, Saldo Físico Total, Valor em Estoque, Ponto de Pedido*).
     - Subtítulo com identificação clara: `Código Protheus: XXXXX | Grupo: XXX`.
     - Guia 1: *Resumo por Empresa* (saldos, vendas e compras discriminados por Metal Pleno 14, GSI 15 e OACO 16).
     - Guia 2: *Compras em Aberto (SC7)* (pedido com sigla, fornecedor, quantidade comprada, entregue, saldo pendente e data de previsão).
     - Guia 3: *Vendas em Aberto (SC6)* (pedido, CodWeb, cliente, vendedor, quantidade pedida e previsão).
   - **Segurança RBAC, Auditoria & Testes:**
     - Proteção JWT obrigatória nos endpoints `/api/vendedores/estoque/saldos` e `/api/vendedores/estoque/sync`.
     - Registro de auditoria em `user_activities` para ações de consulta (`CONSULTA_SALDOS_ESTOQUE`) e sincronização manual (`SYNC_SALDOS_ESTOQUE`).
     - Cobertura por suíte automatizada em `test_saldos_estoque.js` validando fórmulas matemáticas, filtros de PA, bloqueios `MSBLQL`, grupos comerciais, gravação/leitura no Postgres/JSON e segurança de rotas HTTP com isolamento de testes e restauração de cache.
12. [x] **Habilitação de Row-Level Security (RLS) no Supabase (`postgres_db.js`):** Ativação de RLS em todas as tabelas públicas (`users`, `history`, `system_configs`, `user_activities`, `user_2fa_tokens`, `inter_webhook_events`, `analise_credito_history`, `produtos_saldo_estoque`, `estoque_sync_logs`), bloqueando acesso anônimo/não autenticado via PostgREST / Supabase REST API direta sem afetar a conexão direta TCP pooler do backend Node.js.
13. [x] **Autocura e Gestão de Código de Vendedor no Perfil Comercial (`postgres_db.js`, `server.js`, `public/index.html`, `public/app.js`, `test_vendor_autoheal.js`):**
   - **Causa Raiz & Resolução:** Correção do bloqueio 403 (*"Acesso negado: Perfil de vendedor sem código de vendedor associado"*) enfrentado por vendedores ao acessar pedidos de venda abertos.
   - **Autocura e DDL Supabase:** Adicionado `ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_code VARCHAR(20)` e rotina DML de autocura no startup (`initDB`) para restaurar códigos de vendedores cadastrados (`juliana: '000074'`, `andrea: '000064'`, `figueiredo: '000004'`).
   - **Fallback Resiliente no Login / 2FA & `getUserFromReq`:** Tratamento transparente na decodificação do JWT e no login tradicional/2FA para associar o código Protheus e salvar correções em background sem quebrar sessões ativas.
   - **Campo no Painel Administrativo:** Inclusão do input `Código do Vendedor no Protheus` no modal de gerenciamento de usuários (`#userModal`) com exibição condicional ao selecionar perfil `Vendedor`, validação e preservação do código anterior em edições.
14. [x] **Seletor de Tema Claro/Escuro em Todo o Módulo Vendedores & Modais (`public/style.css`, `public/index.html`, `public/app.js`, `test_theme_toggle.js`):**
   - **Expansão Modular (Fase 2):** Botão seletor no cabeçalho geral das sub-abas dos Vendedores (`#btnToggleThemeVendedores`) e no cabeçalho de estoque (`#btnToggleThemeEstoque`), alternando e sincronizando instantaneamente o tema em todas as 5 sub-abas:
     1. *Saldos em Estoque* (`#tab-vend-saldos-estoque`)
     2. *Consulta Pedido* (`#tab-vend-pedidos`)
     3. *Pedidos Abertos* (`#tab-vend-pedidos-abertos`)
     4. *Pedidos Compras* (`#tab-vend-pedidos-compras`)
     5. *Comissões* (`#tab-vend-comissoes`)
   - **Sincronização com Modais:** Aplicação automática do tema claro nos modais de *Drilldown de Estoque* (`#modalEstoqueDetalhes`) e *Detalhes do Pedido de Venda* (`#pedidoDetalhesModal`), mantendo legibilidade total nos itens de grade SC6, faturas SE1, mini KPIs e dados de entrega.
   - **Paleta de Alto Contraste WCAG 2.1 (AA/AAA):** Calibração de tokens claros (`.tab-theme-light`, `.modal-theme-light`) com fundo `#ffffff`, textos `#0f172a`, bordas `#e2e8f0`, saldos positivos em verde esmeralda (`#059669`), compras/totais em azul céu (`#0284c7`) e vendas em âmbar escuro (`#d97706`), eliminando riscos de textos ilegíveis em fundos brancos.
   - **Persistência Perene:** Armazenamento da preferência no `localStorage.setItem('theme_vendedores', mode)` e `theme_saldos_estoque`, restaurado automaticamente sem flash de tela (Zero-FOUC).
   - **Suite de Testes Automatizados:** Script `test_theme_toggle.js` com 5 asserções cobrindo elementos de UI, regras de CSS com escopo, persistência em disco e funções de alternância em JS para as 5 sub-abas e modais.
15. [x] **Regra de Cálculo de Frete no Total do Pedido de Venda (`protheus_db.js`, `server.js`, `public/app.js`, `test_totais_pedido.js`):**
   - **Causa Raiz & Resolução:** O total do pedido de venda em Análise de Crédito e detalhes de pedidos somava incorretamente o campo de Frete Embutido (`C5_VLR_FRT`). Como o valor de `C5_VLR_FRT` já está embutido/incluído no preço dos produtos (`SC6`), somá-lo causava duplicidade no valor total do pedido (`totalGeral`).
   - **Regra Estrita Aplicada:**
     - **Frete Normal (`C5_FRETE`):** Soma normalmente ao total geral do pedido (`totalProdutos + C5_FRETE - C5_DESCONT`).
     - **Frete Embutido (`C5_VLR_FRT`):** Permanece como campo informativo (`freteEmbutido`) no payload e na interface, mas **NÃO** é somado ao total geral do pedido de venda.
   - **Ajustes de UI:** Modal de Detalhes do Pedido (`#pedidoDetalhesModal`) agora discrimina *Frete Cobrado* e exibe *Frete Embutido (Incluso)* apenas de forma informativa e contextual quando presente.
   - **Cobertura de Testes:** Suíte dedicada `test_totais_pedido.js` cobrindo cenários de frete cobrado puro, frete embutido puro, misto com descontos e integração de payload com Análise de Crédito (100% aprovados).
16. [x] **Leitura Obrigatória de PDF Serasa Experian, Validação de Validade (máx. 4 meses), Trava na Consulta Protheus & Expansão do Bloco 5 (`serasa_pdf_parser.py`, `serasa_pdf_parser.js`, `analise_credito_engine.js`, `server.js`, `public/index.html`, `public/app.js`, `test_serasa_pdf_parser.js`):**
   - **Processamento Efêmero em Memória (Sem Gravação em Disco):**
     - O sistema processa o arquivo PDF de análise Serasa em buffer de memória efêmero (`multer.memoryStorage()`) e stream direto via stdin/stdout com o interpretador Python (`pypdf`), garantindo que nenhum documento confidencial seja gravado no disco do servidor.
   - **Validação Estrita de Modelo & Regra de 4 Meses de Validade:**
     - **Modelo Serasa Oficial:** Verificação determinística de assinaturas de cabeçalho do Serasa Experian (Relatório Básico). Arquivos não reconhecidos (ex: estudos internos, manuais) são rejeitados com erro `MODELO_INVALIDO`.
     - **Validade Temporal (&le; 4 meses):** Cálculo da idade do laudo a partir da data de emissão extraída (`data_emissao`). Se o laudo possuir mais de 4 meses (ex: laudo de 2024 contra 2026 = 24.3 meses), o upload é rejeitado com erro `LAUDO_EXPIRADO`, bloqueando consultas com laudos defasados.
   - **Trava de Segurança na Consulta Protheus (Passo 1 ➔ Passo 2):**
     - O botão `⚡ Iniciar Consulta Protheus` inicia desabilitado (`disabled="true"`, opacidade 60%, cursor bloqueado).
     - Só é desbloqueado após a validação e leitura bem-sucedida de um laudo Serasa válido.
     - **Validação Cruzada de CNPJs:** Ao consultar o Protheus, o sistema confronta o CNPJ da empresa consultada no ERP com o CNPJ extraído do laudo Serasa. Caso divirjam (ex: analista leu o Serasa de uma filial/empresa diferente), um alerta visual destacado em vermelho/âmbar é exibido no cabeçalho.
   - **Extração Completa de Métricas e Expansão do Bloco 5:**
     - Preenchimento 100% automático de: Score Numérico, Probabilidade de Inadimplência (`PD %`), Protestos (quantidade e valor total somado), PEFIN (quantidade e valor), REFIN Bancário (quantidade e valor), Dívidas Vencidas, Cheques Sem Fundo, Sócios com Restrição/Anotação no Bureau, Densidade de Consultas Recentes (`consultas/dia`), Consultas de Fomento Mercantil / Securitizadora e Documentos Roubados/Extraviados.
   - **Rebalanceamento Equilibrado do Score & Prevenção Anti-Golpe:**
     - O Serasa limpo **não possui sobrepeso excessivo** (+8 a +14 pts), impedindo que empresas antigas adquiridas por estelionatários burlem o motor de risco. Indicadores digitais e comportamentais (divergência de entrega, ausência de site/domínio recente, e-mail gratuito, pedidos anômalos) continuam sobrepondo-se e classificando como `GOLPE`.
     - **Casos Críticos de Default e Fraude:** Identificação de laudos sem score numérico com estado `DEFAULT / Múltiplos Eventos` (penalidade -30 pts e direcionamento automático para `SÓ À VISTA / ANTECIPADO`) e detecção de `Documento Extraviado/Roubado` (penalidade -25 pts e classificação como `FRAUDE-DOCUMENTO`).
   - **Calibração Administrativa de Pesos & Ficha Imutável:**
     - Inclusão dos novos parâmetros de calibração na aba Configurações (`#tab-config-score`): `cfg_peso_serasa_default`, `cfg_peso_refin_sim`, `cfg_peso_dividas_vencidas_sim`, `cfg_peso_densidade_consultas_alta`, `cfg_peso_consultantes_fomento_sim`, `cfg_peso_socios_restricao_sim`, `cfg_peso_doc_extraviado_sim`.
     - Extrato e Ficha do Pedido com badges de pontuação auditáveis, conferência matemática e restauração completa no formulário via botão `⚡ Carregar no Formulário`.
   - **Suíte de Testes Automatizados:** Script `test_serasa_pdf_parser.js` com 9 asserções automatizadas cobrindo laudos reais (WDM, DASS, AP Elettro, EQUIPSEA, Itambé Minas), laudos expirados (Optimus Pharma), rejeição de não-Serasa, motor de score e endpoint HTTP `POST /api/financeiro/analise-credito/parse-serasa-pdf` (100% de aprovação).
17. [x] **Tratamento de Capital Social Não Informado / Isento (Filiais, S.A., Sem Fins Lucrativos) (`analise_credito_engine.js`, `public/index.html`, `public/app.js`, `server.js`, `postgres_db.js`, `test_capital_social_isento.js`):**
   - **Checkbox de Seleção Rápida & Desbloqueio de Gravação:**
     - Inclusão do checkbox `[ ] Não informado / Isento` (`#cr_sem_capital_social`) ao lado do campo Capital Social.
     - Ao ser marcado, o campo `cr_capital_social` é desabilitado com opacidade e placeholder explicativo, liberando a trava de validação de campos obrigatórios (`camposObrigatorios`) e permitindo o registro da análise no banco sem bloqueios.
   - **Preenchimento Automático Protheus / Receita:**
     - Ao consultar pedidos de filiais ou entidades onde a Receita/Protheus não lista capital social (ou vem nulo/zerado), o sistema marca o checkbox e ajusta o formulário automaticamente.
   - **Pontuação Neutra & Calibração Parametrizada (`0 pts`):**
     - Empresas sem capital social recebem pontuação neutra (`0 pts`), evitando tanto a bonificação indevida de grandes aportes quanto a penalização injusta de microempresas (`-7 pts`).
     - Criação do parâmetro `cfg_peso_capital_nao_informado` na aba Configurações de Score (`#tab-config-score`) para customização livre pelo administrador.
   - **Ficha do Pedido, Extrato e Restauração Perfeita:**
     - Exibição de `Capital Social: Não informado / Isento (0 pts)` na Ficha e no Extrato de Auditoria, com suporte completo a recarga no formulário via `⚡ Carregar no Formulário`.
   - **Suíte de Testes:** Script `test_capital_social_isento.js` com 5 testes automatizados aprovados com 100% de sucesso.
18. **Mitigacao de DOM-based XSS:** Substituir atribuicoes diretas de `innerHTML` por `textContent` ou sanitizadores rigorosos (ex: DOMPurify) na renderizacao de historico e webhooks.
19. **Criptografia e Protecao de Segredos:** Migrar credenciais, senhas e certificados bancarios mTLS armazenados em arquivos planos (`users.json`, scripts) para variaveis de ambiente seguras (`.env`) e hashes fortes (bcrypt/argon2).

### Prioridade 1 (Resiliencia/SRE)
1. **Eliminacao de Concorrencia em Arquivos JSON (`data/*.json`):** Eliminar a gravacao concorrente em arquivos planos sem file locking, mitigando risco critico de corrupcao de dados em escritas simultaneas de webhooks.
2. **Resiliencia e Circuit Breaker nas Integracoes Bancarias:** Implementar politica de retries com backoff exponencial, jitter e timeout explicito nas chamadas para a API do Banco Inter e Mercado Pago (`inter_api.js`).
3. **Tratamento de Exaustao de Memoria no Frontend:** Corrigir acumuladores globais de eventos (`window.addEventListener`) e renderizacao de listas pesadas sem virtualizacao no `app.js`.
4. [x] **Health Check, Reconexão e Keep-Alive Supabase (`postgres_db.js`):** Implementada rotina automática de Keep-Alive periódico (a cada 2 horas via `SELECT 1;`) e reconexão automática em background, prevenindo congelamento por inatividade de 7 dias no plano gratuito da Supabase.
5. **Configuração de Subdomínio Personalizado no Render:** Implementar subdomínio próprio (ex: `portal.gsi.com.br` com CNAME para `conciliacao-fretes.onrender.com`), provisionamento automático de certificado SSL/TLS (HTTPS) pelo Render e inclusão explícita no array de `allowedOrigins` em `server.js`.

### Prioridade 2 (Qualidade & Testes)
1. **Testes Unitarios para Conciliacao e Regras de Negocio:** Criar suite de testes em Jest para os calculos de juros, multas, conciliacao de Pix e validacao de status bancarios em `inter_api.js`.
2. **Testes de Parsers Logicos (Python):** Desenvolver testes em `pytest` cobrindo casos limites (*edge cases*) e formatos corrompidos de tabelas dos Correios e Rodonaves.
3. **Mapeamento de Casos Infelizes (Unhappy Paths):** Cobrir cenarios de queda de rede, retorno de payload incompleto do ERP Protheus e duplicidade de envio de webhooks bancarios (idempotencia).
4. **Validacao Rigorosa de Schemas:** Implementar validacao de schema (ex: Zod ou Joi) para todas as entradas de webhooks recebidas em `inter_webhooks.json`.

### Prioridade 3 (Divida Tecnica & Manutenibilidade)
1. **Modularizacao de `public/app.js`:** Decompor o monolitico script de 3.000 linhas em modulos ES6 univalentes (`auth.js`, `dashboard.js`, `inter-service.js`, `freight-ui.js`, `utils.js`).
2. **Conclusao da Migracao para PostgreSQL:** Descontinuar leitura/escrita em `data/*.json` e migrar integralmente as entidades (Usuarios, Atividades, Webhooks, Historico) para tabelas relacionais com migrations controladas.
3. **Padronizacao de Tipagem e Tratamento de Erros:** Adicionar Type Hints nos scripts Python e padronizar o logging estruturado em JSON com codificacao UTF-8 nativa.
4. **Documentacao de Contratos de API:** Gerar especificacao OpenAPI/Swagger para todas as rotas internas e payloads de webhook.

---

## 4. Diretrizes Operacionais para Agentes de IA

Qualquer agente de IA que atue neste repositorio deve seguir estritamente as regras abaixo:

1. **Codificacao UTF-8 Obrigatoria:** Todo script, leitura/escrita de arquivo e manipulacao de I/O (PowerShell, Python, Node.js) deve forcar explicitamente o encoding UTF-8 (`-Encoding utf8`, `encoding='utf-8'`, `[System.Text.Encoding]::UTF8`).
2. **Seguranca Zero-Trust no Frontend:** Nunca delegue decisoes de autorizacao ou autenticacao ao navegador. Nao inclua tokens de admin ou credenciais em variaveis de escopo global no client-side.
3. **Desacoplamento e YAGNI:** Ao criar novas funcionalidades ou refatorar, nao crie novas dependencias de runtime caso as bibliotecas padrao ou estruturas existentes resolvam o problema.
4. **Tratamento de Excecoes e Resiliencia:** Toda chamada assincrona ou I/O externo deve conter blocos `try/catch` estruturados, com log contextual e degradacao graciosa (sem interrupcao abrupta do processo pai).
5. **Preservacao de Memoria e Documentacao:** Todas as alteracoes arquiteturais relevantes ou correcoes no fluxo de integracao bancaria/ERP devem ser registradas neste arquivo (`GEMINI.md`) e nas notas tecnicas de versao.
6. **Atualizacao Obrigatoria de Versao e Cache Buster (`bump_version.js`):** Toda entrega ou modificacao concluida no sistema DEVE obrigatoriamente atualizar o carimbo de data/hora e a descricao no topo da pagina executando `node bump_version.js "<descricao da mudanca>"` (ou `npm run version:bump`). Isso garante a atualizacao automatica da tag `Última Versão: DD/MM/AAAA HH:mm (<descricao>)` e a invalidacao de cache dos navegadores (`?v=X.XX`) em `public/index.html`.
