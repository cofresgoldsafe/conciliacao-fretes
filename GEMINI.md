# GEMINI.md — Memoria de Projeto & Diretrizes Operacionais

> **Projeto:** Gemini-Cli (Hub de Integracoes Financeiras, Logistica, BI Executivo e ERP - Plataforma de Apoio GSI)  
> **Status:** Estável / Operacional em Produção (Vulnerabilidades Críticas P0 Mitigadas, RLS Habilitado, Faróis SRE, Módulo BI Executivo e Análise de Crédito Homologados em Produção & 12 Suítes de Testes Automatizados 100% Aprovadas)  
> **Data da Última Auditoria:** 01/09/2026 12:28 (v9.13 - Filtro por Empresa [MP, GSI, OACO], Reorganização da Barra de Filtros em Linha Única Compacta e Botão de Exportação Completa de Todas as Páginas para Excel [CSV BOM UTF-8] na tela Saldos em Estoque - 12 Suítes Automatizadas, 83 Testes 100% Aprovados)  

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
11. [x] **Sub-aba Saldos em Estoque no Módulo Vendedores com Filtro por Empresa, Barra em Linha Única, Exportação Completa para Excel e Job Supabase (`protheus_db.js`, `postgres_db.js`, `server.js`, `public/index.html`, `public/app.js`, `test_saldos_estoque.js`, `test_frontend_modules.js`):**
   - **Consolidação Multi-Empresa e Catálogo PA:** Leitura combinada de catálogo `SB1` (produtos acabados PA, descartando `XXX`, `X` e tipo diferente de PA), saldos físicos `SB2` (`SB2140` Metal Pleno 14, `SB2150` GSI 15, `SB2160` OACO 16), vendas em carteira não faturadas `SC6` (`SC6140`, `SC6150`, `SC6160`) e compras em aberto `SC7` (`SC7140`, `SC7150`, `SC7160`).
   - **Filtro por Empresa Reativo & KPIs Dedicados:**
     - Dropdown `🏢 Empresa` com opções: *Todas as Empresas*, *Metal Pleno (14)*, *GSI (15)* e *OACO (16)*.
     - Ao selecionar uma empresa específica, a tabela, a ordenação e os 3 KPIs do topo (*Itens em Estoque*, *Itens sem Estoque*, *Valor Total em Estoque*) recalculam instantaneamente com base nos números específicos da filial (`detalhes_empresas`).
   - **Barra de Filtros Compacta em Linha Única:**
     - Layout em Grid responsivo com 6 elementos alinhados horizontalmente: `🔍 Buscar Produto`, `🏢 Empresa`, `🏷️ Grupo`, `📊 Disponibilidade`, `🧹 Limpar` e `📥 Exp. Excel`.
     - Ajuste das larguras mínimas dos seletores para encaixe perfeito em 1 linha sem quebra indesejada.
   - **Exportação Completa para Excel (`📥 Exp. Excel`):**
     - Exportação da **totalidade dos produtos filtrados em todas as páginas** (não apenas a página atual).
     - Formatação universal CSV com BOM UTF-8 (`\uFEFF`) e delimitador ponto-e-vírgula (`;`), abrindo diretamente no Microsoft Excel com acentuação e números corretos.
     - 12 Colunas Oficiais: *Código, Descrição, Grupo, Preço Unitário (R$), Saldo Total (Físico), Saldo Total (R$), Saldo Metal Pleno (14), Saldo GSI (15), Saldo OACO (16), Qtd Vendas (SC6), Qtd Compras (SC7), Ponto de Pedido*.
   - **Job de Background & Sincronização Agendada (Supabase + Fallback JSON):**
     - Rotina periódica a cada 60 min no horário comercial de Brasília (07h às 19h).
     - Persistência e normalização de metadados na tabela relacional `produtos_saldo_estoque` e `estoque_sync_logs` com status, duração e contadores.
     - Fallback gracioso para cache local `data/estoque_saldos_cache.json`.
   - **Modal Drilldown Multi-Empresa com 3 Guias:**
     - Clique na linha do produto abre modal com 4 mini KPIs, resumo por filial, compras em aberto (SC7) e vendas em aberto (SC6).
   - **Segurança RBAC, Prevenção de Erros de Sintaxe & Testes:**
     - Proteção JWT obrigatória em `/api/vendedores/estoque/saldos` e `/api/vendedores/estoque/sync`.
     - Unificação rigorosa de variáveis DOM em `public/app.js` prevenindo colisões de escopo (`SyntaxError: Identifier has already been declared`).
     - Inclusão do **Teste 6** em `test_frontend_modules.js` validando a integridade léxica/sintática de `public/app.js` via Node.js `vm.Script` em pipeline automatizado.
     - 12 Suítes automatizadas com 84 testes 100% aprovados.
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
   - **Suíte de Testes Automatizados:** Script `test_serasa_pdf_parser.js` com 10 asserções automatizadas cobrindo laudos reais (WDM, DASS, AP Elettro, EQUIPSEA, Itambé Minas, Prevent Senior), laudos expirados (Optimus Pharma), rejeição de não-Serasa, motor de score e endpoint HTTP `POST /api/financeiro/analise-credito/parse-serasa-pdf` (100% de aprovação).
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
18. [x] **Clareza nos Rótulos de Divergência Cadastral e Sincronização Dinâmica de Seletores (`public/index.html`, `public/app.js`, `test_score_config.js`):**
   - **Eliminação de Ambiguidade de Notação Lógica (`!=`):**
     - Substituição dos rótulos técnicos nas Configurações de Score (`Razão != FGTS` ➔ `Razão Divergente do FGTS (-pts)`, `Cadastro != Receita Federal` ➔ `Cadastro Divergente da Receita (-pts)`, `Entrega != Cadastro` ➔ `Entrega Divergente do Cadastro (-pts)`), deixando 100% claro que a penalidade se aplica exclusivamente quando houver divergência cadastral.
   - **Sincronização Dinâmica dos Menus Seletores (`<select>`):**
     - Implementação da função reativa `atualizarRotulosSelectsCredito(cfg)` em `public/app.js`, atualizando instantaneamente os textos de pontuação (+X pts / -Y pts) de todas as 28 opções de seletores do formulário sempre que as configurações forem salvas, carregadas ou restauradas.
   - **Suíte de Testes:** Script `test_score_config.js` com 5 asserções automatizadas cobrindo pesos customizados, persistência, clareza textual e sincronização dinâmica.
19. [x] **Mitigacao de DOM-based XSS (`public/app.js`, `test_dom_xss_and_secrets.js`):**
   - Implementada função global `escapeHtml()` no topo do escopo da SPA para sanitização rigorosa de caracteres perigosos (`<`, `>`, `"`, `'`, `&`).
   - Sanitização completa em 100% das renderizações dinâmicas de tabelas e modais: Feed de Atividades de auditoria (`auditActivitiesTableBody`), Resumo de Usuários (`auditUsersTableBody`), Histórico de Integrações (`historyModalBody`), cabeçalhos de faturas (`sumCnpj`), status ViPP (`vippStatusText`) e mensagens de erro de API.
   - **Extinção de Senhas em Texto Puro:** Removido o objeto `defaultSeeds` com senhas em texto puro de `server.js` e substituídas as sementes de `postgres_db.js` por hashes bcrypt seguros (`$2b$10$...`), garantindo que 100% das senhas em memória, no Postgres e no JSON sejam criptografadas com bcrypt (salt 10).
   - **Proteção de Chaves de API:** Leitura dinâmica e segura de `PROTHEUS_API_KEY` / `RAILWAY_API_KEY` via variáveis de ambiente.
21. [x] **Eliminação de Concorrência em Arquivos JSON (`safe_json_storage.js`, `postgres_db.js`, `server.js`, `analise_credito_engine.js`, `test_resilience_sre.js`):**
   - **Fila Assíncrona Sequencial por Arquivo (FIFO Promise Queue):** Criação do módulo `safe_json_storage.js` com enfileiramento de operações de escrita por caminho absoluto (`writeQueues = new Map()`), garantindo ordem estrita e eliminando condições de corrida (*race conditions*) e perdas de atualização (*lost updates*).
   - **Substituição Atômica Resiliente (Windows NTFS / POSIX):** Gravação em arquivo temporário único (`.tmp.<timestamp>_<hex>`) seguido de `atomicRenameAsync` / `atomicRenameSync` com até 5 micro-retries para bloqueios transitórios de filesystem (`EPERM`/`EBUSY`) e fallback gracioso para cópia atômica com limpeza do temporário.
   - **Leitura Segura com Fallback:** Funções `safeReadJson` e `safeReadJsonSync` que retornam valores padrão em arquivos ausentes ou corrompidos sem derrubar a aplicação.
   - **Cobertura Completa do Repositório:** Migração de 100% das gravações de arquivos planos (`users.json`, `history.json`, `inter_webhooks.json`, `analise_credito_history.json`, `score_config.json`, `vipp_config.json`, `estoque_saldos_cache.json`).
22. [x] **Circuit Breaker & Retries com Backoff Exponencial e Jitter (`circuit_breaker.js`, `inter_api.js`, `test_resilience_sre.js`):**
   - **Padrão Circuit Breaker com 3 Estados:** Módulo `circuit_breaker.js` implementando classe `CircuitBreaker` com estados `CLOSED` (operação normal), `OPEN` (bloqueio imediato com `CircuitBreakerOpenError` e fail-fast por 30s de cooldown após 4 falhas consecutivas) e `HALF_OPEN` (sondagem com canary request restaurando o circuito para `CLOSED` em caso de sucesso).
   - **Circuitos Isolados por Empresa:** Instâncias dedicadas de Circuit Breaker para as 3 empresas bancárias (Empresa 14 Metal Pleno `Inter_MetalPleno_14`, Empresa 15 GSI `Inter_GSI_15`, Empresa 16 OAÇO `Inter_OACO_16`) e função de exportação de métricas `getCircuitBreakersStatus()`.
   - **Política de Retries Inteligentes:** Função `executeWithRetry` com classificação rigorosa de erros transitórios (Timeouts, `ETIMEDOUT`, `ECONNRESET`, status HTTP 429, 500, 502, 503, 504) e cálculo de backoff exponencial `min(maxDelay, baseDelay * 2^attempt) + jitter (0-200ms)`. Erros determinísticos (400, 401, 403, 404) falham imediatamente sem retentativas.
   - **Proteção Completa Banco Inter:** Aplicação em `requestOAuthToken`, `consultarSaldoInter` e `consultarExtratoInter`.
23. [x] **Gestão de Memória e Event Delegation no Frontend (`public/app.js`, `test_resilience_sre.js`):**
   - **Eliminação de Acumuladores de Event Listeners:** Substituição de múltiplos `addEventListener` adicionados repetidamente dentro de loops de renderização por **Event Delegation** centralizado nos containers pais (`tbody`).
   - **Tabelas Otimizadas:** Gestão de eventos delegados via `e.target.closest(...)` em `usersTableBody` (edição e exclusão), `vendPedidosTableBody` (links de pedidos e detalhes), `pedidosAbertosTableBody` (links diretos), `historicoCreditoTableBody` (botão de abertura de ficha) e `estoqueTableBody` (drilldown de produto).
   - **Prevenção de Memory Leaks:** Eliminação de listeners redundantes no DOM, garantindo estabilidade e baixo consumo de memória na SPA após milhares de interações.
24. [x] **Testes Unitários para Conciliação Bancária & Matching N:1 (`protheus_db.js`, `test_conciliacao_bancaria.js`):**
   - Suíte com asserções cobrindo Casamento 1:1 Direto (Créditos/Débitos com tolerância de até 2 dias), Casamento de Cartão Líquido (Crédito Bruto - Taxa MDR = Líquido no Banco), Aglutinação N:1 com Subset-Sum, Arredondamento e Tolerância de Centavos (0.01) e segregação de itens órfãos Protheus/Banco com resumo estatístico.
25. [x] **Testes de Parsers Python com Pytest (`parser_correios.py`, `parser_rodonaves.py`, `parser_tipo2.py`, `test_parsers.py`):**
   - Suíte com 7 testes em Pytest cobrindo extração analítica dos Correios SFE (SEDEX, PAC, PAC Reverso), tabelas CT-e Rodonaves com padding de 9 dígitos nas NFs (`\d+` com `zfill(9)`), parsing de arquivos CSV/TXT do ViPP com múltiplos delimitadores e isolamento estrito contra rejeição de formatos incompatíveis (`isWrongFormat: True`).
26. [x] **Testes Ponta a Ponta (E2E) com Playwright Headless Chromium (`test_playwright_e2e.js`):**
   - Suíte com 6 fluxos E2E cobrindo inicialização e branding da SPA, autenticação com token JWT/2FA, navegação reativa entre as 4 abas principais, alternância e persistência de Tema Claro/Escuro nos Vendedores (`localStorage`), filtros e KPIs de Saldos em Estoque e formulário de Análise de Crédito Comercial.
27. [x] **Validação Rigorosa de Schemas Zod para Webhooks Bancários (`webhook_validator.js`, `server.js`, `test_webhook_schemas.js`):**
   - Schemas Zod com tipagem estrita para Pix individual (`PixEventSchema`), lotes Pix (`PixBatchSchema`), Boletos bancários (`BoletoEventSchema`) e extrato bancário (`BankingEventSchema`).
   - Coerção automática de strings monetárias para float (`transform`), sanitização e middleware no endpoint `/api/webhooks/inter` rejeitando requisições malformadas com HTTP 400.
28. [x] **Automação do Campo Registro.Br Confere via RDAP & Comparação de Raiz de CNPJ (`server.js`, `public/index.html`, `public/app.js`, `test_registro_br_automacao.js`):**
   - **Consulta Oficial RDAP do NIC.br:** Consumo da API REST JSON oficial (`https://rdap.registro.br/domain/<dominio>`) com extração determinística do documento do titular (`publicIds` ou `handle`) e razão social/nome (`vcardArray` / `legalRepresentative`).
   - **Comparação pela Raiz do CNPJ (8 Primeiros Dígitos):** Suporte nativo à compra por Filiais cujo domínio foi registrado pela Matriz (ou vice-versa). O algoritmo confronta os 8 primeiros dígitos numéricos do CNPJ do cliente com o CNPJ do Registro.br (`cnpjClienteRaiz === cnpjRegistroBrRaiz`).
   - **Preenchimento 100% Automático & Feedback Visual:** Campo `cr_registro_br` preenchido automaticamente como `'S'` (Sim) quando a raiz confere e `'N'` (Não) quando diverge ou sob CPF. Remoção do asterisco (`*`) de campo manual na UI, exibição de badge contextual (`✓ Raiz Confere: CNPJ (Titular)` / `⚠️ Divergente`), persistência na Ficha do Pedido e restauração pelo histórico.
   - **Suíte de Testes Automatizados:** Script `test_registro_br_automacao.js` com 8 asserções cobrindo matriz x filial, matriz x matriz, divergências, CPFs, domínios internacionais (.com) e pontuação de score de crédito (100% de aprovação).
29. [x] **Novos Critérios Antifraude (Alteração Recente de Sócios & Aumento Expressivo de Capital) e Consulta Assistida 1-Clique na Caixa FGTS (`analise_credito_engine.js`, `public/index.html`, `public/app.js`, `server.js`, `postgres_db.js`, `test_novos_criterios_credito.js`):**
   - **Critérios de Combate à Fraude da Empresa Dorminhoca (*Shelf Company Hijacking*):**
     - **Alteração Recente de Sócios (`alteracao_recente_socios`):** Penalidade de **-8 pts** (`peso_alteracao_recente_socios_sim`) caso a empresa antiga tenha sofrido alteração de sócios/controle societário recente (indicativo de laranjas assumindo CNPJs inativos).
     - **Aumento Expressivo de Capital (`aumento_expressivo_capital`):** Penalidade severa de **-20 pts** (`peso_aumento_expressivo_capital_sim`) caso a empresa tenha inflado artificialmente o capital social sem lastro operacional.
     - **Incorporação na Matriz de Risco:** Ambos os novos pesos são somados no cálculo de detecção de fraudes (`subGolpe`), direcionando imediatamente para `GOLPE` / `ENTRADA OU A VISTA` quando acionados.
   - **Botão de Consulta Assistida 1-Clique na Caixa Econômica Federal (CRF FGTS):**
     - Botão destacado no Bloco 6 (`#btnConsultarFgtsCaixa`): `🌐 Consultar FGTS na Caixa (1-Clique)`.
     - Ao clicar, o sistema copia automaticamente o CNPJ sanitizado (apenas números, ex: `02021647000125`) para a Área de Transferência (`navigator.clipboard.writeText`) com feedback visual e abre a página oficial da Caixa (`https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf`) em nova aba, agilizando o preenchimento para poucos segundos.
   - **Calibração de Pesos, Ficha Auditável e Sincronização Dinâmica:**
     - Inclusão dos novos campos na aba de Configurações de Score (`#tab-config-score`) para parametrização livre pelo gestor.
     - Renderização de badges explicativos na Ficha do Pedido e linhas discriminadas no Extrato de Conferência Matemática do Score.
     - Sincronização dinâmica de rótulos (`atualizarRotulosSelectsCredito`) e persistência segura tanto no PostgreSQL (`dados_completos JSONB`) quanto no backup local em disco (`analise_credito_history.json`).
30. [x] **Automação da Consulta FGTS / CRF Caixa via API InfoSimples (`server.js`, `analise_credito_engine.js`, `public/index.html`, `public/app.js`, `test_infosimples_fgts.js`):**
   - **Integração REST JSON com API InfoSimples:**
     - Consumo do endpoint oficial da Caixa CRF (`POST https://api.infosimples.com/api/v2/consultas/caixa/crf`) de forma assíncrona e paralela com as demais consultas de inteligência no Protheus.
     - Suporte a credencial flexível via `INFOSIMPLES_TOKEN` (variável de ambiente) ou campo dedicado em tela na aba **Configurações de Score (`#tab-config-score`)**.
   - **Novas Regras de Pontuação Antifraude para o FGTS:**
     - **Empresa Regular com Razão Social Idêntica:** `fgts_situacao_regular = 'S'` (0 pts) e `razao_fgts_igual = 'S'` (**`+3 pts`**).
     - **Empresa Localizada com Razão Social Divergente (Empresa Alterada/Comprada):** `razao_fgts_igual = 'N'` (**`-15 pts`**).
     - **Empresa Não Localizada no FGTS (Sem Histórico de Empregados / Empresa Fantasma):** `fgts_situacao_regular = 'NE'` (`0 pts`) e `razao_fgts_igual = 'NE'` (**`-5 pts`**), concentrando a penalidade na ausência de registro/divergência.
   - **Remoção de Campos Descontinuados & Limpeza Estrutural:**
     - Remoção total do campo **Google Maps Fachada** (`google_maps`) do formulário, motor de cálculo, configurações e extrato/ficha.
     - Remoção total do campo **3 NFs Confirmadas?** (`tres_nfs_confirmadas` / `peso_boletos`) de todo o fluxo operacional.
   - **Interface Reativa, Badges e Botão Dedicado:**
     - Botão `⚡ Consultar FGTS (InfoSimples)` no Bloco 6 permitindo reconsultas sob demanda sem recarregar o pedido.
     - Badge informativo automático com Razão Social histórica retornada pela Caixa, situação cadastral e validade do CRF.
     - Botão assistido 1-Clique na Caixa mantido como contingência operacional.
   - **Suíte de Testes:** Script `test_infosimples_fgts.js` com 8 asserções automatizadas cobrindo todos os cenários de score, persistência de token string e rota HTTP `POST /api/financeiro/analise-credito/consultar-fgts`.
31. [x] **Aprimoramento Visual e Rastreabilidade na Tabela de Histórico de Crédito (`public/index.html`, `public/app.js`):**
   - **Compactação e Abreviatura de Empresa:**
     - Cabeçalho reduzido de `Empresa` para **`Emp`** com alinhamento centralizado e largura otimizada (`55px`).
   - **Coluna de Operador com Avatar Circular (`👤`):**
     - Inclusão da coluna **`👤`** com badge circular tipo avatar estilizado em degradê ciano/índigo (`24px`).
     - Renderização da **primeira letra do usuário em maiúsculo** (ex: `A` para Alexandre, `R` para Rubens, `J` para Juliana), derivado do campo auditável `item.usuario`.
     - Tooltip nativo informativo (`Registrado por: <Nome>`) ao posicionar o cursor sobre o avatar.
   - **Ajuste de Colunas e Empty State:**
     - Atualização do `colspan="11"` para manter o grid perfeitamente balanceado em estados vazios ou filtrados.
32. [x] **Painel de Faróis de Conectividade Externa (SRE), Telemetria em Tempo Real & Arquitetura Fail-Neutral na Análise de Crédito (`server.js`, `analise_credito_engine.js`, `serasa_pdf_parser.js`, `public/index.html`, `public/style.css`, `public/app.js`, `test_farois_resiliencia_credito.js`):**
   - **Painel Visual com 6 Faróis de Status em Tempo Real (`#creditoFaroisConectividade`):**
     - Indicadores dinâmicos com LEDs luminosos animados (`.farol-pulse-dot`, `.farol-ok`, `.farol-alert`, `.farol-error`, `.farol-info`, `.farol-neutral`) exibidos no topo da Análise de Crédito cobrindo 100% dos serviços externos:
       1. **Receita Federal / CNPJ:** Status da BrasilAPI e ReceitaWS com latência em ms e detecção de contingência.
       2. **RDAP Registro.br:** Status da consulta do NIC.br, idade do domínio e confronto de raiz de CNPJ.
       3. **Wayback Machine:** Primeiro snapshot histórico arquivado no Archive.org ou aviso de ausência de registros.
       4. **Servidor de E-mail (DNS MX):** Tipo de servidor identificado (Google Workspace, Microsoft 365, Hospedagem) com tempo de resolução.
       5. **FGTS Caixa Econômica:** Regularidade do CRF e conformidade de Razão Social via InfoSimples com motivo detalhado.
       6. **ERP TOTVS Protheus:** Status da conexão Railway SQL, tempo de resposta e importação de títulos SE1/pedidos SC5.
   - **Eliminação de Falhas Silenciosas & Arquitetura Fail-Neutral:**
     - **Registro.br e DNS MX Fail-Neutral:** Caso o RDAP ou DNS sofram timeout ou erro de rede, o sistema atribui pontuação neutra (`0 pts`) com tag explicativa `[INDISPONÍVEL]`, eliminando penalizações indevidas de **-7 pts** ou **-4 pts** sobre clientes legítimos.
     - **Fim da Falsa Conformidade de Endereço:** Caso as APIs da Receita Federal estejam offline, o campo `cadastro_igual_receita` não assume falsamente `'S'`; o sistema exibe alerta e exige conferência manual (`RECEITA OFFLINE - CONFERIR ENDEREÇO`).
     - **Feedback Explícito no FGTS no Auto-Fetch:** Caso a API InfoSimples oscile durante o carregamento do pedido, o badge não desaparece silenciosamente; exibe badge informativo com o motivo retornado pela API.
     - **Diferenciação de Erros no Protheus:** Tratamento refinado no frontend distinguindo `404 - Pedido Inexistente` de `500/504 - Falha de Conexão com o ERP Protheus (Railway SQL)`.
     - **Timeout de Segurança no Parser Serasa:** Inclusão de timer com timeout de 15 segundos no spawn do interpretador Python para proteção contra processos zumbis ou travamentos em PDFs corrompidos.
   - **Suíte de Testes Automatizados:** Script `test_farois_resiliencia_credito.js` com 9 asserções cobrindo regras fail-neutral, payload de telemetria, componentes de interface e proteções de processos (100% de aprovação).
33. [x] **Hardening do Ciclo de Autenticação Frontend & Salvaguarda contra Regressões de Sintaxe no Monolito SPA (`public/app.js`, `public/index.html`):**
   - **Causa Raiz & Resolução do Bloqueio de Login:** Identificada declaração duplicada e não fechada de listener de evento no monolito SPA que gerava `SyntaxError: Unexpected end of input`, impedindo a execução de `DOMContentLoaded` e a ocultação do `#loginOverlay`.
   - **Salvaguarda Preventiva:** Incorporação obrigatória de linting/checagem de sintaxe via `node -c public/app.js` em todos os ciclos de release antes de commits.
   - **Invalidação Agressiva de Cache (`v=8.89`):** Parâmetros de cache-busting sincronizados em `style.css?v=8.89` e `app.js?v=8.89` com atualização da tag de versão para `27/08/2026 18:00`.
34. [x] **Módulo de BI Executivo Embutido — Metabase Embedded Analytics (`services/bi_service.js`, `public/js/bi.js`, `sql/bi/`, `docs/metabase/`, `server.js`, `public/index.html`, `public/app.js`, `public/style.css`, `test_bi_embed.js`):**
   - **Arquitetura Modular e Desacoplamento:**
     - Criação do serviço backend `services/bi_service.js` e do módulo frontend `public/js/bi.js`, mantendo `server.js` e `app.js` limpos e desacoplados com importações mínimas.
   - **Infraestrutura em Nuvem (Render Pro & Supabase Canada):**
     - Instância dedicada no Render (`bi-gsi.onrender.com`) rodando Metabase `v0.49.13` em container Pro com **2 GB de RAM e 1 CPU dedicada**, garantindo inicialização veloz, zero crash por exaustão de memória e disponibilidade 24/7.
     - Conexão segura e direta com o banco de dados PostgreSQL no Supabase (Região Canadá `ca-central-1` no host `aws-0-ca-central-1.pooler.supabase.com:5432`).
   - **Segurança RBAC Estrita e Signed JWT Embedding:**
     - Endpoint protegido `/api/bi/dashboard-executivo` restrito a `admin` e usuário master `alexandre` (`requireAuth`, `requireRole('admin')`). Bloqueio 403 para perfis operacionais e vendedores.
     - Geração de token JWT assinado criptograficamente com `METABASE_SECRET_KEY` (HMAC-SHA256) e TTL efêmero de 10 minutos para incorporação segura (*Signed Embed*).
     - Integração de Single Sign-On transparente via `conciliacao_fretes_session` sem necessidade de redigitar credenciais.
   - **Interface Seamless & Experiência Centralizada no Portal GSI:**
     - Nova aba principal `📊 BI EXECUTIVO` exibida exclusivamente para a diretoria (`#tab-bi-executivo` / `mainTabBi`).
     - Container de iframe responsivo em tela cheia (`82vh`), sincronização de temas claro/escuro, botão de tela cheia (`⛶`) e botão de recarregamento instantâneo (`🔄`).
     - Assistente visual de configuração (*Setup Guide*) integrado para monitoramento do status das variáveis de ambiente (`METABASE_SITE_URL`, `METABASE_SECRET_KEY`, `METABASE_EXEC_DASHBOARD_ID`).
   - **Modelagem Analítica SQL & Cobertura dos 33 Grupos do Protheus (`SBM010`):**
     - Script DDL e Seeding `sql/bi/00_tabela_grupos_sbm.sql` cobrindo 100% dos **33 Grupos Oficiais do Protheus Empresa 01** (`001 - Cofres` até `091 - Insumos Produção Cofres`), garantindo suporte total a vendas passadas e presentes.
     - Scripts SQL de Views analíticas em `sql/bi/`: `01_vw_produtos_estoque.sql` (Saldos por empresa MP 14/GSI 15/OACO 16, preços, valor total de estoque, SC6, SC7 e rupturas), `02_vw_analise_credito.sql` (Histórico de crédito, scores, riscos e decisões), `03_vw_atividades_auditoria.sql` (Telemetria de operadores) e `04_vw_demandas_grupos_comerciais.sql` (Demandas e faturamento por grupo comercial).
    - **Documentação e Esteira de Auditoria Completa:**
      - Guia completo de implantação em `docs/metabase/GUIA_SETUP_METABASE.md` e manual de arquitetura corporativa em `docs/metabase/ARQUITETURA_BI_EXECUTIVO.md`.
      - **Esteira Completa de IA (5 Auditores Especializados):** Suíte de testes automatizados `test_bi_embed.js` expandida com **19 asserções cobrindo os 5 vetores**:
        1. *Auditor de Segurança & Red Team:* Zero-Trust, bloqueios RBAC (401/403/200) e integridade de token HMAC-SHA256 com TTL efêmero.
        2. *Auditor de Serviço & Criptografia:* Normalização e protocolo seguro de URL, signed JWT com dashboard ID e parâmetros.
        3. *Auditor de Clean Code:* Modularização IIFE estrita em `public/js/bi.js` e desacoplamento backend em `services/bi_service.js`.
        4. *Auditor de SRE & Resiliência:* Proteção contra DOM XSS com `escapeHtml`, `referrerpolicy="no-referrer"`, acessibilidade WCAG (`title`), bloqueio anti-concorrência `isBiLoading` e degradação graciosa para Setup Guide.
        5. *Auditor de UI/UX & Acessibilidade:* Integridade estrutural do DOM no `index.html`, estilos CSS responsivos e tela cheia `bi-fullscreen-active` (100% de aprovação).
35. [x] **Correção da Renderização de HTML/CSS na Coluna "Último Acesso Ativo" em Auditoria (`public/app.js`, `public/index.html`, `test_dom_xss_and_secrets.js`):**
    - **Causa Raiz & Resolução:** A função `formatTimeAgo()` gera marcação HTML segura (badges com cor, borda e timestamp legível). Na interpolação da tabela `auditUsersTableBody`, o resultado estava envolvido por `escapeHtml(...)`, convertendo tags como `<span>` e `<small>` em entidades textuais visíveis (`&lt;span...&gt;`).
    - **Correção Aplicada:** Remoção do `escapeHtml` sobre o retorno de `formatTimeAgo` em `auditUsersTableBody`, calibração visual dos badges com bordas suaves (`border: 1px solid rgba(16, 185, 129, 0.3)`) e inclusão de salvaguarda contra pequenas variações de relógio (`diffSec < 0`).
    - **Suíte de Testes:** Atualização em `test_dom_xss_and_secrets.js` validando que a tabela renderiza `formatTimeAgo` sem escape e preserva 100% das regras de sanitização XSS.
36. [x] **Módulo de Faturamento Mês a Mês & Vendas por Grupo de Produto no BI Executivo (`sql/bi/05_tabela_e_views_faturamento.sql`, `protheus_db.js`, `postgres_db.js`, `server.js`, `test_bi_faturamento.js`):**
    - **Extração Histórica Multi-Empresa Protheus:**
      - Consulta unificada e limpa de itens de notas fiscais faturadas (`SD2140` / `SF2140` Metal Pleno 14, `SD2150` / `SF2150` GSI 15 e `SD2160` / `SF2160` OACO 16), cruzando com `SB1010` (catálogo) e `SA1010` (clientes).
      - Filtros de integridade fiscal: exclusão estrita de canceladas e devoluções (`F2_TIPO IN ('N', 'C')`, `D_E_L_E_T_ = ' '`).
    - **Data Warehouse Analítico & Views no Supabase:**
      - Tabela `faturamento_itens_historico` com chave primária e constraint única determinística (`empresa_cod, nota_doc, nota_serie, item_num`), datas nativas (`data_emissao DATE`, `mes_ano VARCHAR(7)`), índices B-Tree e RLS ativo.
      - **View `vw_bi_faturamento_mensal`:** Faturamento bruto de mercadorias, volume de notas fiscais, clientes atendidos, total de unidades e cálculo de ticket médio por nota mês a mês.
      - **View `vw_bi_faturamento_grupo_mes`:** Vendas e faturamento discriminados mês a mês por cada um dos 33 Grupos de Produtos do Protheus (`SBM010` — Cofres, Fragmentadoras, Plastificação, Armários, etc.).
      - **View `vw_bi_faturamento_vendedor_mes`:** Desempenho e volume faturado mensal por consultor comercial.
    - **Segurança RBAC, Endpoints & Testes Automatizados:**
      - Endpoints `/api/bi/sync-faturamento` e `/api/bi/faturamento-stats` protegidos por autenticação JWT e restritos a administradores.
      - Suíte automatizada `test_bi_faturamento.js` com 11 asserções cobrindo mapeamento de grupos, persistência com fallback em cache JSON, DDLs e controle de acesso RBAC (100% de aprovação).
37. [x] **Sub-abas no BI Executivo, Módulo de Índices Financeiros de Liquidez & Integração Metabase (`sql/bi/06_tabelas_indices_liquidez.sql`, `bi_indices_engine.js`, `postgres_db.js`, `server.js`, `public/index.html`, `public/app.js`, `public/js/bi_indices.js`, `public/style.css`, `test_bi_indices.js`):**
    - **Navegação de 2 Sub-abas no BI Executivo:**
      - Sub-aba 1 (Default): `📊 Índices` (`#tab-bi-indices` / `btnTabBiIndices`) exibindo os índices de liquidez, cartões de componentes e tabela comparativa multi-empresa.
      - Sub-aba 2: `📈 Metabase Analytics` (`#tab-bi-metabase` / `btnTabBiMetabase`) mantendo a integração embedded do painel analítico Metabase.
    - **Fórmulas Matemáticas Oficiais de Liquidez Auditáveis:**
      - **Liquidez Corrente ($LC$):** $\frac{\text{Ativo Circulante}}{\text{Passivo Circulante}} = \frac{\text{Estoque (Custo PA)} + \text{Disponibilidades Bancárias (SE8)} + \text{Receber Válido (}\le\text{5d)}}{\text{Passivo Circulante (SE2 com PR)}}$.
      - **Liquidez Seca ($LS$):** $\frac{\text{Ativo Circulante} - \text{Estoque}}{\text{Passivo Circulante}} = \frac{\text{Disponibilidades Bancárias (SE8)} + \text{Receber Válido (}\le\text{5d)}}{\text{Passivo Circulante (SE2 com PR)}}$.
      - **Liquidez Imediata ($LI$):** $\frac{\text{Disponibilidades Bancárias (SE8)}}{\text{Passivo Circulante (SE2 com PR)}}$.
    - **Regras Contábeis & Fiscais Estritas:**
      - **Estoque PA:** Leitura combinada de `SB2` com `SB1` usando custo unitário (`B1_VLUNIT`) de produtos tipo `PA` com quantidade $> 0$.
      - **Saldos Bancários (SE8):** Extração particionada por banco/agência/conta com `ROW_NUMBER() OVER (PARTITION BY E8_BANCO, E8_AGENCIA, E8_CONTA ORDER BY E8_DTSALAT DESC)` para obter o último saldo real disponível de cada uma das 22 contas bancárias.
      - **Contas a Receber (SE1):** Considera títulos em aberto com saldo $> \text{R\$\ 0,01}$ e exclusão automática de títulos inadimplentes com vencimento superior a 5 dias de atraso (`dias_vencido > 5`).
      - **Contas a Pagar (SE2):** Considera títulos com saldo pendente $> \text{R\$\ 0,01}$ (suportando títulos com baixa parcial considerando o saldo residual real), inclusão integral de provisórios do tipo `PR` e **exclusão expressa de pagamentos antecipados `PA`** (pois o valor já foi desembolsado e não constitui passivo futuro).
    - **Preservação de Títulos Provisórios (`PR`) via `RECNO` Físico Protheus:**
      - Títulos provisórios (`PR`) não possuem número de nota (`E2_NUM = '000000000'`). Para evitar colisões e perda de títulos, a extração e o banco utilizam a coluna física `recno` (`R_E_C_N_O_`), preservando 100% dos 141 títulos reais (39 MP + 46 GSI + 56 OAÇO, totalizando `R$ 475.747,40`).
      - Remoção das constraints únicas legadas conflitantes `uq_contas_a_pagar` e `uq_contas_a_receber` no PostgreSQL.
    - **Snapshot Diário por Upsert & View Analítica para o Metabase (`vw_indices_liquidez_diario`):**
      - Índice único `uq_indices_hist_dia_empresa ON indices_liquidez_historico(data_registro, empresa_cod)` com `ON CONFLICT DO UPDATE` e deduplicação diária no cache JSON, assegurando exatamente 1 snapshot consolidado por dia por empresa (evitando dentes de serra e repetições intraday).
      - View SQL `vw_indices_liquidez_diario` particionada por `ROW_NUMBER() OVER (PARTITION BY data_registro, empresa_cod ORDER BY timestamp_registro DESC)` para visualização limpa e linear nos gráficos e dashboards do Metabase.
    - **Tabelas Relacionais no Supabase & RLS:**
      - Criação das tabelas `estoque`, `contas_a_receber`, `contas_a_pagar`, `saldos_bancarios`, `indices_sync_logs` e `indices_liquidez_historico` com Row-Level Security (RLS) habilitado.
    - **UX e Drilldown Interativo:**
      - 3 Cards principais de Liquidez com badges de saúde financeira (*Excelente*, *Saudável*, *Atenção*) e fórmulas matemáticas exibidas.
      - 4 Cards de componentes (Estoque PA, Bancos SE8, Contas a Receber, Contas a Pagar).
      - Tabela comparativa multi-empresa (Metal Pleno 14, GSI 15, OAÇO 16 e Consolidado).
      - Modal de Drilldown com 5 guias internas (Extrato Matemático passo a passo, Saldos Bancários, Títulos a Receber, Títulos a Pagar, Estoques PA) e busca instantânea.
    - **Segurança RBAC e Suíte de Testes:**
      - Endpoints `/api/bi/indices`, `/api/bi/indices/sync`, `/api/bi/indices/drilldown` e `/api/bi/indices/historico` protegidos por JWT e restritos a administradores.
      - Suíte automatizada `test_bi_indices.js` com 18 asserções aprovadas com 100% de sucesso.
38. [x] **Desbloqueio de Visão Unificada para Vendedores & Coluna Nome em Comissões (`protheus_db.js`, `server.js`, `public/index.html`, `public/app.js`, `test_vendedores_desbloqueio.js`, `test_pedidos_abertos.js`):**
    - **Desativação da Trava Restritiva de Vendedores:**
      - Remoção do bloqueio/override de isolamento (`codVend = user.vendorCode`) nas rotas `/api/vendedores/pedidos/abertos`, `/api/vendedores/comissoes` e `/api/vendedores/pedidos/detalhes`.
      - Usuários com perfil `vendedor` agora podem consultar e visualizar comissões e pedidos em aberto de todos os vendedores ou filtrar interativamente por qualquer vendedor pelo menu seletor.
      - Remoção do bloqueio de formulário na função `ajustarEscopoVendedor` no frontend (`public/app.js`), mantendo os seletores `#comisVendorSelect` e `#pedidosAbertosVendedorFilter` habilitados e editáveis por qualquer operador.
    - **Nova Coluna "Nome" no Relatório de Comissões:**
      - Consulta Protheus em `protheus_db.js` (`buscarComissoesPeriodo`) atualizada com `LEFT JOIN SA1010 A1` cruzando o código do cliente (`E3_CODCLI` com `A1_COD`).
      - Extração e truncamento do nome do cliente (`A1_NOME`) nas **primeiras 20 letras (incluindo espaços)** (`nomeCliente: rawNome.substring(0, 20)`), com preservação do nome completo no tooltip (`title="${item.nomeClienteCompleto}"`).
      - Tabela de Comissões atualizada em `public/index.html` e `public/app.js` com 8 colunas: inserção da coluna `Nome` (22% de largura) imediatamente ao lado de `Cliente` (11%) e redução da coluna `Vendedor` (de 16% para 12%) para distribuição harmônica do layout da tabela. Empty state ajustado para `colspan="8"`.
39. [x] **Sub-abas "Ped. pra Faturar" (MATA460A) e "Ped. Bloq Estoque" na Aba 📦 LOGÍSTICA (`protheus_db.js`, `server.js`, `public/index.html`, `public/app.js`, `openapi.json`, `test_pedidos_faturar.js`):**
    - **Reestruturação da Navegação da Aba Logística (4 Sub-abas):**
      - Sub-aba 1 (Padrão/Inicial): `🟢 Ped. pra Faturar` (`#tab-pedidos-faturar` / `btnTabPedidosFaturar`).
      - Sub-aba 2: `🔴 Ped. Bloq Estoque` (`#tab-pedidos-bloq-estoque` / `btnTabPedidosBloqEstoque`).
      - Sub-aba 3: `📄 Upload Fatura Transp.` (`#tab-upload` / `btnTabUploadTransp`).
      - Sub-aba 4: `📦 Fatura Correios & ViPP` (`#tab-correios` / `btnTabCorreios`).
    - **Regras de Negócio Oficiais do Protheus MATA460A (Legenda Verde - Prontos para Faturar):**
      - Consulta T-SQL multi-empresa (`SC9` + `SC5` + `SC6` + `SA4` + `SF2` nas empresas OACO 16, GSI 15 e Metal Pleno 14).
      - Filtro de liberação: `C9_BLEST NOT IN ('02')`, `C9_BLCRED NOT IN ('01')`, `C9_BLOQUEI = ''`, `C9_QTDLIB > 0`, sem NF ativa em `SF2` (`F2_DOC IS NULL` ou `C9_NFISCAL = ''`) e `C5_NOTA` não faturada/reaberta (`XXXXXXXXX`).
      - Na **OACO (16)**: Retorna exclusivamente o pedido **`000221`** (MOHAMMED NAHED RAJAB KHDAIR - R$ 515,07), cuja NF antiga `000132` foi cancelada/excluída (`SF2.D_E_L_E_T_ = '*'`).
      - Na **GSI (15)**: Retorna 4 pedidos liberados (`001887`, `001886`, `000257`, `001845`).
      - Na **MP (14)**: 0 pedidos.
    - **Regras de Negócio para Pedidos Bloqueados por Estoque (`C9_BLEST = '02'`):**
      - Identifica pedidos com pendência de estoque retidos no Protheus.
      - Na **OACO (16)**: Lista com precisão os **8 pedidos** bloqueados (`000723`, `000729`, `000736`, `000754`, `000755`, `000762`, `000763`, `000764`).
      - Na **MP (14)**: 4 pedidos bloqueados (`000338`, `000354`, `000346`, `000200`).
      - Na **GSI (15)**: 0 pedidos bloqueados.
    - **Interface, KPIs, Ordenação, Isolamento Estrito & Links Pipedrive:**
      - 3 Cards KPIs por sub-aba (*Pedidos Prontos/Bloqueados*, *Total de Peças*, *Valor Total R$*).
      - Barra de filtros com busca instantânea textual, seletor de empresa e botão de limpeza.
      - **Isolamento Estrito de Abas:** Classe `hidden` aplicada na tag `#tab-conciliacao-bancaria` e salvaguarda no startup em `public/app.js` e em `switchMainTab` para ocultar 100% dos painéis inativos, eliminando vazamento visual de abas não selecionadas.
      - **URL Oficial do CRM Pipedrive:** Links de `CodWeb` gerados via helper `formatPipedriveDealLink` apontando para o subdomínio oficial `https://benetroncomercial.pipedrive.com/deal/${digits}`.
      - Integração seamless com o modal `#pedidoDetalhesModal` via clique no Pedido de Venda.
    - **Segurança RBAC e Suíte de Testes Automatizados:**
      - Endpoints `/api/logistica/pedidos-faturar` e `/api/logistica/pedidos-bloq-estoque` protegidos por JWT e auditados em `user_activities`.
      - Suíte automatizada `test_pedidos_faturar.js` com 11 asserções aprovadas com 100% de sucesso.
40. [x] **Sub-aba "Ped. Lib Estoque" com Fila Sequencial FIFO (MATA455 / MATA456) na Aba 📦 LOGÍSTICA (`protheus_db.js`, `server.js`, `public/index.html`, `public/app.js`, `public/style.css`, `test_pedidos_lib_estoque.js`):**
    - **Reestruturação da Navegação da Aba Logística (5 Sub-abas):**
      - Sub-aba 1 (Padrão/Inicial): `🟢 Ped. pra Faturar` (`#tab-pedidos-faturar` / `btnTabPedidosFaturar`).
      - Sub-aba 2: `📋 Ped. Lib Estoque` (`#tab-pedidos-lib-estoque` / `btnTabPedidosLibEstoque`).
      - Sub-aba 3: `🔴 Ped. Bloq Estoque` (`#tab-pedidos-bloq-estoque` / `btnTabPedidosBloqEstoque`).
      - Sub-aba 4: `📄 Upload Fatura Transp.` (`#tab-upload` / `btnTabUploadTransp`).
      - Sub-aba 5: `📦 Fatura Correios & ViPP` (`#tab-correios` / `btnTabCorreios`).
    - **Algoritmo de Fila Sequencial FIFO por Produto contra SB2:**
      - Consulta multi-empresa (`SC9` + `SC5` + `SC6` + `SA4` + `SF2` + `SB2` nas empresas OACO 16, GSI 15 e Metal Pleno 14) filtrando `C9_BLEST = '02'` e pedidos em aberto.
      - Saldo disponível calculado por filial e produto em `SB2`: `saldoDisponivel = Math.max(0, B2_QATU - B2_RESERVA - B2_QEMP)`.
      - Ordenação estrita da fila de atendimento por produto:
        1. **1º Critério:** Data de Liberação (`C9_DATALIB`) mais antiga (formato `YYYYMMDD`, fallback `C5_EMISSAO`).
        2. **2º Critério (Desempate):** Número do Pedido (`C9_PEDIDO`) menor/mais antigo (ordem numérica crescente).
        3. **3º Critério:** Sequência do Item (`C9_ITEM` / `C9_SEQUEN`).
      - Alocação virtual sequencial que deduz o saldo disponível item a item, calculando: `qtdAlocada`, `saldoFaltante`, `posicaoFila` e status do item (`TOTAL`, `PARCIAL`, `SEM_SALDO`).
    - **Classificação Inteligente do Status do Pedido:**
      - `🟢 Ped. Pronto pra Ser Liberado` (`badge-lib-pronto`): 100% dos itens do pedido com saldo suficiente em estoque alocado pela fila FIFO (ex: Pedido `000346` na MP 14).
      - `🟡 Lib Parcial` (`badge-lib-parcial`): Pedido com múltiplos itens (ou item parcial) onde parte possui estoque disponível e parte ainda aguarda entrada de produção/NF (ex: Pedido `000763` na OACO 16, com saldo 6 para demanda de 11).
      - `🔴 Aguardando Estoque` (`badge-lib-aguardando`): Nenhum item possui saldo disponível no momento.
    - **Indicação da Rotina Protheus Sugerida:**
      - `MATA455 (Liberação de Estoque)`: Para pedidos com bloqueio de estoque puro.
      - `MATA456 (Liberação Crédito e Estoque)`: Para pedidos que também possuem pendência financeira/crédito (`C9_BLCRED = '01'`).
    - **Interface, KPIs, Ordenação & Modal Drilldown:**
      - 4 Cards KPIs no topo (*Prontos p/ Liberar*, *Liberação Parcial*, *Aguardando Estoque*, *Total em Fila*).
      - Barra de filtros com busca textual em tempo real, seletor de empresa, seletor de status e botão de limpeza.
      - Modal interativo `#modalLibEstoqueItens` detalhando a auditoria da fila FIFO por item: Código, Descrição, Qtd Bloqueada, Saldo Físico `SB2`, Qtd Alocada, Saldo Faltante, Posição na Fila (`#1`, `#2`, `#3`...) e Status do Item.
    - **Segurança RBAC e Suíte de Testes Automatizados:**
      - Endpoint `/api/logistica/pedidos-lib-estoque` protegido por JWT e registrado em `user_activities` (`CONSULTA_PEDIDOS_LIB_ESTOQUE`).
      - Suíte automatizada `test_pedidos_lib_estoque.js` com 8 asserções cobrindo algoritmo FIFO, desempates, cenários parciais, integração HTTP e integridade visual do DOM (100% aprovada).
41. [x] **Auditoria Completa da Sub-aba Análise de Crédito na Esteira de IA (`analise_credito_engine.js`, `public/js/credito.js`, `sql/bi/02_vw_analise_credito.sql`, `public/app.js`, `server.js`, 12 Suítes de Testes):**
    - **Correção Crítica de Reatribuição no Histórico:** Eliminação de erro de runtime na renderização do histórico de crédito substituindo reatribuição indevida de constante por variável mutável (`let sugestoes = item.sugestoes_lista || []` em `public/app.js`), assegurando renderização fluida e sem interrupções das análises registradas.
    - **Contratos de API Padronizados em `public/js/credito.js`:** Modularização e desacoplamento do cliente HTTP no frontend com contratos REST canônicos (`consultarCreditoProtheus`, `parseSerasaPdf`, `carregarScoreConfig`, `salvarScoreConfig`, `salvarAnaliseCredito`, `carregarHistoricoCredito`) consumindo endpoints same-origin com Bearer token JWT.
    - **Modelagem Analítica BI SQL com Suporte JSONB Híbrido (`vw_bi_analise_credito`):** Atualização da view analítica no PostgreSQL Supabase (`sql/bi/02_vw_analise_credito.sql`) suportando leitura transparente de schemas legados planos e novos esquemas aninhados (`dados_completos->'protheus'`, `dados_completos->'receita'`, `dados_completos->'serasa'`, `dados_completos->'fgts'`) com castings defensivos via regex (`~ '^[0-9.]+$'`) para prevenção de exceções de conversão de tipos em campos numéricos.
    - **Mascaramento e Segurança de Tokens de Integração:** Proteção do token de API InfoSimples no frontend e logs, prevenindo exposição acidental de credenciais em relatórios ou payloads de telemetria.
    - **Robustez Numérica e Decimais com Ponto:** Tratamento defensivo em pontuações de score, idades decimais (ex: 24.3 meses, anos de fundação) e valores monetários com ponto flutuante, eliminando distorções de arredondamento.
    - **Homologação Completa em 12 Suítes Automatizadas (78 Testes 100% Aprovados):**
      1. `test_analise_credito_detalhes.js` (4 asserções - Imutabilidade e consistência matemática de pontuação)
      2. `test_capital_social_isento.js` (5 asserções - Pontuação neutra e liberação de cadastro)
      3. `test_deteccao_entrega.js` (10 asserções - Detecção semântica em `C5_MENNOTA` e transportadora `000009`)
      4. `test_farois_resiliencia_credito.js` (9 asserções - Matriz FMEA fail-neutral e timeouts)
      5. `test_infosimples_fgts.js` (8 asserções - Integração InfoSimples REST e regras antifraude)
      6. `test_novos_criterios_credito.js` (8 asserções - Alteração de sócios, aumento de capital e 1-clique Caixa)
      7. `test_registro_br_automacao.js` (8 asserções - Consulta RDAP NIC.br e confronto de raiz CNPJ)
      8. `test_score_config.js` (5 asserções - Calibração de pesos e sincronização dinâmica de rótulos)
      9. `test_serasa_pdf_parser.js` (10 asserções - Validação temporal &le; 4 meses, default e travas)
      10. `test_totais_pedido.js` (4 asserções - Segregação de frete normal `C5_FRETE` vs frete embutido `C5_VLR_FRT`)
      11. `test_frontend_modules.js` (5 asserções - Contratos ES6 e rotas de crédito)
      12. `test_dom_xss_and_secrets.js` (2 asserções - Sanitização XSS e integridade de armazenamento de crédito)

### Prioridade 1 (Resiliencia/SRE)
1. [x] **Eliminacao de Concorrencia em Arquivos JSON (`data/*.json`):** Módulo `safe_json_storage.js` com filas FIFO sequenciais, substituição atômica `.tmp` + rename resiliente em 100% dos arquivos locais.
2. [x] **Resiliencia e Circuit Breaker nas Integracoes Bancarias:** Circuit Breakers isolados por empresa, retries com backoff exponencial, jitter aleatório e timeouts explícitos em `circuit_breaker.js` e `inter_api.js`.
3. [x] **Tratamento de Exaustao de Memoria no Frontend:** Event Delegation nos `tbody` de todas as tabelas em `public/app.js`, eliminando acumuladores de eventos no DOM.
4. [x] **Health Check, Reconexão e Keep-Alive Supabase (`postgres_db.js`):** Implementada rotina automática de Keep-Alive periódico (a cada 2 horas via `SELECT 1;`) e reconexão automática em background, prevenindo congelamento por inatividade de 7 dias no plano gratuito da Supabase.
5. [x] **Configuração de Subdomínio Personalizado no Render:** Implementado suporte no CORS dinâmico em `server.js` para o subdomínio oficial `portal.gsicofres.com.br`, `conciliacao.gsicofres.com.br`, `portal.gsi.com.br`, `portal.oaco.com.br` e variáveis de ambiente `CUSTOM_DOMAIN` / `ALLOWED_ORIGINS`. CNAME validado e provisionamento automático de certificado SSL Let's Encrypt gerenciado pelo Render.

### Prioridade 2 (Qualidade & Testes)
1. [x] **Testes Unitarios para Conciliacao e Regras de Negocio:** Suíte unitária em `test_conciliacao_bancaria.js` validando cálculos 1:1, cartão líquido, N:1 subset-sum e tolerâncias monetárias.
2. [x] **Testes de Parsers Logicos (Python):** Suíte em `pytest` (`test_parsers.py`) cobrindo edge cases de layouts dos Correios, Rodonaves e ViPP Tipo 2.
3. [x] **Mapeamento de Casos Infelizes (Unhappy Paths & E2E):** Cobertura E2E via Playwright (`test_playwright_e2e.js`) e suíte de testes de regressão de segurança, 2FA e conexões offline.
4. [x] **Validacao Rigorosa de Schemas:** Schemas Zod em `webhook_validator.js` cobrindo 100% dos formatos de eventos de webhook do Banco Inter (Pix, Boleto, Banking).

28. [x] **Modularização ES6 da Arquitetura do Frontend (`public/js/*.js`, `test_frontend_modules.js`):**
   - Decomposição modular da SPA em 8 submódulos ES6 univalentes: `utils.js` (sanitização XSS, formatação BRL, datas e `apiFetch` same-origin), `auth.js` (sessão, 2FA, RBAC e heartbeat), `vendedores.js` (estoque Power BI, pedidos abertos SC9, compras SC7 e alternância de temas), `credito.js` (análise de crédito, score e Serasa PDF), `financeiro.js` (conciliação bancária e extratos), `logistica.js` (faturas e fretes), `config.js` (auditoria e gestão de usuários) e `index.js` (barrel export central).
29. [x] **Documentação de Contratos de API OpenAPI 3.0 & Swagger UI (`openapi.json`, `server.js`, `test_frontend_modules.js`):**
   - Especificação OpenAPI 3.0 completa cobrindo 100% dos contratos das rotas de autenticação, 2FA, vendedores, análise de crédito, conciliação bancária, faturas e webhooks com esquemas de requisição e resposta.
   - Disponibilização interativa via Swagger UI nos endpoints `/api-docs` e `/api/docs`, e JSON bruto em `/api/openapi.json`.
30. [x] **Detecção Automática de Endereço de Entrega Diferente (`C5_MENNOTA` e `C5_TRANSP = '000009'`) (`protheus_db.js`, `server.js`, `public/index.html`, `public/app.js`, `test_deteccao_entrega.js`):**
   - **Dupla Regra Semântica e Transportadora Especial:**
     - **Regra 1 (`C5_TRANSP = '000009'`):** Detecta pedidos com transportadora `000009` (Cliente Retira / Redespacho Próprio).
     - **Regra 2 (`C5_MENNOTA`):** Parser semântico com expressões regulares capturando marcadores de endereço de entrega alternativo (`END ENTREGA`, `ENDERECO DE ENTREGA`, `END DE ENTREGA`, `LOCAL DE ENTREGA`, `ENTREGAR EM/NA/NO/PARA`) e descartando falsos positivos operacionais (apenas menção de horários como `8H AS 18H`).
   - **Automação no Motor de Análise de Crédito & Redução de Esforço Manual:**
     - Preenchimento automático do seletor `Entrega = Cadastro?` como **"Não"** (aplicando a penalidade de risco `-9.0 pts` e ativando `PERIGO CHECAGEM REVERSA` para pedidos a prazo) se qualquer uma das duas regras for atendida, ou como **"Sim"** (`+2.0 pts`) se o endereço for compatível.
     - Remoção do asterisco (`*`) do campo `Entrega = Cadastro?` em `public/index.html`, preservando asteriscos exclusivamente nos 11 campos estritamente manuais.
     - Renderização de badge de alerta inteligente no Bloco 3 (`#cr_entrega_diferente_badge`) informando o motivo e o endereço extraído para auditoria imediata.
   - **Alerta Visual nos Detalhes do Pedido (`#pedidoDetalhesModal`):**
     - Exibição de badge destacado em vermelho/âmbar no cabeçalho de logística ao visualizar detalhes de qualquer pedido com entrega diferente, prevenindo erros na expedição/vendas.
   - **Suíte de Testes Automatizados:** Script `test_deteccao_entrega.js` com 10 asserções automatizadas cobrindo variações de códigos de transportadora, múltiplos padrões de texto em `C5_MENNOTA`, filtragem de falsos positivos e pontuação integrada no motor de crédito.
31. [x] **Disponibilização Unificada de Saldos em Estoque na Aba Logística (`public/index.html`, `test_frontend_modules.js`, `test_playwright_e2e.js`):**
   - **Arquitetura DRY (Single Source of Truth / Fonte Única da Verdade):**
     - Inclusão da sub-aba `btnTabLogSaldosEstoque` no grupo de navegação `#subGroupLogistica` apontando diretamente para o container DOM compartilhado `tab-vend-saldos-estoque`.
     - Zero duplicação de marcação HTML, classes CSS ou funções JavaScript: qualquer melhoria, adição de colunas, novos filtros ou customizações visuais feitas na tela refletem instantânea e simultaneamente em ambas as abas (Vendedores e Logística).
   - **Acessibilidade para Perfis Operacionais:**
     - Usuários com acesso restrito à aba Logística (ex: operadores de expedição) agora podem consultar em tempo real os saldos físicos multi-empresa (Metal Pleno 14, GSI 15, OACO 16), compras pendentes SC7, vendas em carteira SC6 e abrir o modal de drilldown.
   - **Validação Automatizada Completa:** Cobertura por testes unitários e testes E2E Playwright validando a navegação, visibilidade e garantia de elemento DOM único.

### Prioridade 3 (Divida Tecnica & Manutenibilidade)
1. [x] **Modularizacao de `public/app.js`:** Decomposição modular concluída em 8 módulos ES6 em `public/js/` com validação automatizada de integridade sintática e testes unitários.
2. **Conclusao da Migracao para PostgreSQL:** Descontinuar leitura/escrita em `data/*.json` e migrar integralmente as entidades (Usuarios, Atividades, Webhooks, Historico) para tabelas relacionais com migrations controladas.
3. **Padronizacao de Tipagem e Tratamento de Erros:** Adicionar Type Hints nos scripts Python e padronizar o logging estruturado em JSON com codificacao UTF-8 nativa.
4. [x] **Documentacao de Contratos de API:** Especificação OpenAPI 3.0.3 gerada em `openapi.json` e documentação interativa Swagger UI servida em `/api-docs`.
5. **Separação da Autenticação em Página Dedicada (`public/login.html`):** Isolar o fluxo de login e 2FA em uma página HTML/JS própria (~80 linhas), eliminando o elemento `#loginOverlay` do `index.html` e garantindo que erros de renderização ou scripts em outras views nunca congelem o modal de login.


---

## 4. Matriz FMEA de Resiliência das Consultas Externas & Faróis SRE

A tabela abaixo define o comportamento formal de cada serviço externo consumido no módulo de Análise de Crédito, prevenindo falhas silenciosas e distorções matemáticas de pontuação:

| Serviço / Provedor | Timeout Técnico | Comportamento em Falha de Rede / Queda | Pontuação no Score (Fail-Neutral) | Indicador no Farol SRE | Ação Operacional Exigida |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Receita Federal** *(BrasilAPI / ReceitaWS)* | 8.000 ms | Fallback BrasilAPI ➔ ReceitaWS. Se ambas falharem, retorna `receita_offline = true`. | `0 pts` (Não assume `'S'` falso nem penaliza) | 🔴 Vermelho (`farol-error`) | Exibe `RECEITA OFFLINE - CONFERIR ENDEREÇO` no cabeçalho e orienta conferência manual. |
| **Registro.br (RDAP)** *(NIC.br)* | 6.000 ms | Captura erro de socket/timeout e sinaliza `idade_dominio_rdap_erro = true`. | `0 pts` (Elimina penalidade de `-7 pts`) | 🔴 Vermelho ou 🟡 Alerta | Informa `Indisponível (Registro.br)` no campo de idade do domínio. |
| **Wayback Machine** *(Archive.org)* | 5.000 ms | Captura erro HTTP/timeout e sinaliza `wayback_offline = true`. | `0 pts` (Neutro) | 🔴 Vermelho ou 🟡 Alerta | Informa `Indisponível (Archive.org)` na maturidade digital. |
| **Servidor MX** *(DNS Resolution)* | 5.000 ms | Captura `SERVFAIL`/`ETIMEOUT` e sinaliza `servidor_mx_offline = true`. | `0 pts` (Elimina penalidade de `-4 pts`) | 🔴 Vermelho | Informa `Falha DNS` sem taxar o domínio corporativo como inexistente. |
| **FGTS Caixa** *(InfoSimples REST API)* | 25.000 ms | Retorna `executado = false` com mensagem descritiva do motivo da recusa/latência. | `0 pts` (Neutro) | 🟡 Alerta ou 🔵 Info | Renderiza badge explicativo em amarelo com motivo (`Token não configurado`, `Timeout Caixa`) em vez de ocultar. |
| **ERP TOTVS Protheus** *(Railway SQL Relay)* | 15.000 ms | Distingue `404` (Pedido não existe) de `500/504` (Instabilidade de infraestrutura). | N/A (Bloqueia consulta) | 🔴 Vermelho (`farol-error`) | Exibe banner informativo de erro de rede sem induzir operador a crer que digitou pedido errado. |
| **Parser Serasa PDF** *(Python in-memory)* | 15.000 ms | Processo Python cancelado com `SIGKILL` após 15s se PDF travar ou for corrompido. | N/A | N/A | Exibe mensagem de erro orientando reenvio de PDF válido. |

---

## 5. Diretrizes Operacionais para Agentes de IA

Qualquer agente de IA que atue neste repositorio deve seguir estritamente as regras abaixo:

1. **Codificacao UTF-8 Obrigatoria:** Todo script, leitura/escrita de arquivo e manipulacao de I/O (PowerShell, Python, Node.js) deve forcar explicitamente o encoding UTF-8 (`-Encoding utf8`, `encoding='utf-8'`, `[System.Text.Encoding]::UTF8`).
2. **Seguranca Zero-Trust no Frontend:** Nunca delegue decisoes de autorizacao ou autenticacao ao navegador. Nao inclua tokens de admin ou credenciais em variaveis de escopo global no client-side.
3. **Desacoplamento e YAGNI:** Ao criar novas funcionalidades ou refatorar, nao crie novas dependencias de runtime caso as bibliotecas padrao ou estruturas existentes resolvam o problema.
4. **Tratamento de Excecoes e Resiliencia:** Toda chamada assincrona ou I/O externo deve conter blocos `try/catch` estruturados, com log contextual e degradacao graciosa (sem interrupcao abrupta do processo pai).
5. **Preservacao de Memoria e Documentacao:** Todas as alteracoes arquiteturais relevantes ou correcoes no fluxo de integracao bancaria/ERP devem ser registradas neste arquivo (`GEMINI.md`) e nas notas tecnicas de versao.
6. **Validacao Obrigatoria de Sintaxe JS (`node -c public/app.js`):** Antes de qualquer commit envolvendo o frontend, e compulsorio validar a sintaxe JavaScript de todos os arquivos modificados para evitar quebras silenciosas no ciclo de autenticacao e no carregamento da SPA.
7. **Atualizacao Obrigatoria de Versao e Cache Buster (`bump_version.js`):** Toda entrega ou modificacao concluida no sistema DEVE obrigatoriamente atualizar o carimbo de data/hora e a descricao no topo da pagina executando `node bump_version.js "<descricao da mudanca>"` (ou `npm run version:bump`). Isso garante a atualizacao automatica da tag `Última Versão: DD/MM/AAAA HH:mm (<descricao>)` e a invalidacao de cache dos navegadores (`?v=X.XX`) em `public/index.html`.

---

## 6. Diretrizes Mandatórias de Arquitetura para Novos Projetos e Expansões (Portal GSI & Novos Módulos)

Todo novo projeto, módulo ou expansão arquitetural desenvolvido no ecossistema **Portal GSI / Gemini-Cli** deve obrigatoriamente aderir aos três pilares de engenharia abaixo:

### Pilar 1: Paginação Compulsória em Todas as Consultas e Buscas
1. **Sem Buscas Irrestritas:** Nenhuma consulta de listagem ou busca em banco de dados (PostgreSQL, Supabase, ERP TOTVS Protheus MSSQL/Oracle ou APIs externas) pode retornar conjuntos de dados sem limite e paginação definidos no backend.
2. **Envelope Padrão de Resposta REST:**
   ```json
   {
     "items": [ ... ],
     "pagination": {
       "page": 1,
       "limit": 50,
       "total": 1240,
       "totalPages": 25,
       "hasNext": true
     }
   }
   ```
3. **Estratégia Offset vs Cursor (Keyset):**
   - Para tabelas de catálogo ou listagens administrativas com navegação direta por página, utilizar paginação com `LIMIT` e `OFFSET` padronizada (padrão de 50 registros por página).
   - Para tabelas de alto volume ou registros sequenciais/históricos (extratos bancários, logs de auditoria, faturamento `faturamento_itens_historico`, títulos `SE1`/`SD2`), utilizar **Keyset/Cursor Pagination** (`WHERE id < :ultimo_id ORDER BY id DESC LIMIT 50`) para garantir tempo de resposta constante $O(1)$ sem degradação em páginas profundas.
4. **Prevenção da Armadilha de `COUNT(*)`:** Em tabelas gigantes do ERP Protheus, desacoplar a contagem total da query principal de registros ou usar contagem estimada/sob demanda para não atrasar a resposta da primeira página.
5. **Componentização no Frontend:** Interfaces de listagem devem incorporar controles reutilizáveis de paginação (resumo `Exibindo X a Y de Z`, navegação `Primeira`, `Anterior`, `Próxima`, `Última`, páginas numéricas e seletor configurável de itens por página).

### Pilar 2: Indexação Estratégica Obrigatória em Banco de Dados
1. **Índices Planejados por Padrão de Acesso:** Nenhuma tabela em banco relacional pode entrar em produção sem índices B-Tree estrategicamente criados para as colunas presentes em cláusulas `WHERE`, `ORDER BY`, `JOIN` e chaves estrangeiras (`FOREIGN KEY`).
2. **Índices Compostos Direcionados:** A ordem das colunas em índices compostos deve seguir rigorosamente a seletividade e a frequência dos filtros de negócio (ex: `(empresa_cod, data_emissao, status)`).
3. **Índices Parciais no PostgreSQL / Supabase:** Em tabelas com grande volume de dados inativos, finalizados ou históricos, priorizar índices parciais com filtro condicional (ex: `CREATE INDEX idx_pedidos_abertos ON pedidos (empresa, emissao) WHERE status <> 'FATURADO'`), economizando memória RAM e cache do banco.
4. **Harmonização com ERP TOTVS Protheus:**
   - Respeitar estritamente os índices nativos do Protheus mantidos pelo dicionário de dados (`SIX`) e as chaves primárias de recno (`R_E_C_N_O_`).
   - Não criar índices diretos em tabelas padrão do Protheus que possam ser removidos ou entrar em colisão durante migrações de release (`APSRDU`/`UPDISTR`). Consultas customizadas devem se alinhar à ordem das chaves do `SIX`.
5. **Contenção de Sobrecarga de Escrita:** Evitar criação redundante de índices em tabelas de alto volume transacional de escrita (`INSERT`/`UPDATE`) para não degradar a taxa de processamento (IOPS).

### Pilar 3: Modularização e Separação de Código (>1 View / Telas Complexas)
1. **Fim dos Arquivos Monolíticos:** É estritamente proibido concentrar múltiplas telas, fluxos de regras de negócio ou lógicas de visualização em arquivos únicos com milhares de linhas. Sempre que um projeto possuir mais de uma view/sub-aba, o código deve ser decomposto em submódulos independentes.
2. **Padrão de Fatias Verticais (Feature-Based / Vertical Slice):**
   - Organização de arquivos segregada por domínio funcional:
     ```text
     public/
     ├── app.js                   (Router, Auth e inicialização geral)
     ├── core/
     │   ├── api.js               (Cliente HTTP Same-Origin com Bearer token)
     │   ├── ui.js                (Modais, Toasts, Paginador compartilhado)
     │   └── theme.js             (Controle unificado de Tema Claro/Escuro)
     └── modules/
         ├── credito/             (View, regras e renderização de Análise de Crédito)
         ├── vendedores/          (Saldos de estoque, pedidos abertos, compras)
         ├── financeiro/          (Conciliação bancária, extratos e webhooks)
         └── logistica/           (Importação de faturas e cálculo de fretes)
     ```
3. **Uso de ES Modules Nativos (`import` / `export`):** No frontend, utilizar módulos nativos JavaScript (`<script type="module">`) para garantir isolamento de escopo e eliminar poluição de variáveis globais no objeto `window`.
4. **Ciclo de Vida Limpo e Desacoplado:** Cada submódulo de view deve exportar métodos explícitos de ciclo de vida:
   - `initView()`: Inicializa listeners de eventos, busca dados iniciais e monta o estado local.
   - `destroyView()`: Limpa timers/intervals, desassina observadores e libera memória para evitar vazamentos (*memory leaks*).
5. **Comunicação Inter-Módulos sem Acoplamento:** A troca de dados e sinalizações entre módulos distintos deve ocorrer por eventos desacoplados (ex: `EventTarget` nativo ou padrão Pub/Sub customizado), nunca por mutação direta de variáveis globais de outros módulos.
6. **Backend Modularizado:** Rotas e serviços do servidor Node.js/Express devem residir em controllers e rotas dedicadas por domínio (`routes/vendedores.js`, `routes/credito.js`, `routes/financeiro.js`), mantendo `server.js` apenas como orquestrador de middlewares e bootstrap.
