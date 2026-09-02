# TODO.md — Lista de Pendências, Entregas e Próximos Passos

## 🔴 Segurança & Hardening
- [x] [SEC-01] Implementar autenticação via JWT (`jsonwebtoken`) com RBAC (`admin`, `user`, `vendedor`) nas rotas `/api/admin/*` e `/api/vipp/*`.
- [x] [SEC-02] Criptografar senhas com `bcryptjs` e remover senhas em texto puro de `postgres_db.js`, `server.js` e `data/users.json`.
- [x] [SEC-03] Blindar consultas SQL no Protheus contra SQL Injection (sanitização de `cleanTerm`, `codWeb`, `numNF`, `numPed`, `nomeCli`).
- [x] [SEC-04] Extrair segredos e credenciais fixas para variáveis de ambiente (`.env`).
- [x] [SEC-05] Limitar uploads no `multer` (15MB max, whitelist de `.pdf`, `.csv`, `.txt`, `.xlsx`, `.xls`).
- [x] [SEC-06] Incluir pacote `pypdf` na instalação Python do `Dockerfile`.
- [x] [SEC-07] Restringir origens no CORS e sanitizar mensagens de erro 500.
- [x] [SEC-08] Implementar autenticação 2FA por e-mail com tokens de 4 dígitos via Mailjet REST API (HTTPS 443) / SMTP e rate limiting.
- [x] [SEC-09] Habilitação de Row-Level Security (RLS) e FORCE RLS em 100% das tabelas públicas no Supabase PostgreSQL, revogação de acessos anônimos (`REVOKE ALL`) no PostgREST, isolamento da extensão `citext` no schema `extensions` e script de remediação `sql/fix_supabase_rls_security.sql`, zerando 100% dos alertas críticos do Security Advisor.
- [x] [SEC-10] Processamento efêmero de relatórios PDF Serasa Experian em memória sem gravação em disco e trava cruzada de CNPJs.
- [x] [SEC-11] Mitigação de DOM-based XSS: Função global `escapeHtml()` no topo da SPA e sanitização de 100% dos dados dinâmicos em tabelas e modais.
- [x] [SEC-12] Criptografia e Proteção de Segredos: Eliminação de caminhos fixos de drive em `inter_api.js`, remoção de senhas em texto puro e migração 100% para variáveis de ambiente seguras no Render.

## 🟡 Resiliência & SRE
- [x] [SRE-01] Adicionar tratamento de reconexão e timeouts no pool PostgreSQL (`postgres_db.js`).
- [x] [SRE-02] Implementar idempotência e deduplicação de webhooks do Banco Inter com chave única composta `(empresa_codigo, event_id)`.
- [x] [SRE-03] Configurar `express-rate-limit` em rotas sensíveis de autenticação e login/2FA.
- [x] [SRE-04] Rotina de Keep-Alive periódico a cada 2h para prevenir congelamento de banco inativo no Supabase.
- [x] [SRE-05] Job agendado de sincronização de estoque Protheus x Supabase a cada 60 min no horário comercial com fallback JSON e cooldown de 2 min.
- [x] [SRE-06] Implementar política de retries com backoff exponencial, jitter e Circuit Breaker com 3 estados nas chamadas do Banco Inter (`circuit_breaker.js` e `inter_api.js`).
- [x] [SRE-07] Eliminar concorrência e corrupção em arquivos JSON (`data/*.json`) via serialização assíncrona FIFO e atomicRename (`safe_json_storage.js`).
- [x] [SRE-08] Prevenir vazamento de memória e acumuladores de eventos no frontend através de Event Delegation nos containers `tbody` (`public/app.js`).

## 💼 Funcionalidades & Módulos de Negócio
- [x] [VEND-01] Sub-aba Consulta Ped Venda: Pesquisa multi-empresa (14, 15, 16) com integração `SA1010`, máscaras e itens `SC6`.
- [x] [VEND-02] Sub-aba Ped Vendas Abertos: Listagem multi-empresa não faturada com regras de bloqueio `SC9` e CRM Pipedrive.
- [x] [VEND-03] Sub-aba Prod x Ped Compras: Consulta de compras em aberto (`SC7`) de produtos `PA` com fornecedores `SA2010`.
- [x] [VEND-04] Sub-aba Saldos em Estoque: Visual Power BI, consolidação `SB1`/`SB2`/`SC6`/`SC7`, KPIs, filtros comerciais (Grupos 001, 002, 010, 018), isolamento dos catálogos operacionais ativos (`SB1090`, `SB1160`), descarte de `SB1010` legado da Empresa 01 e expurgo estrito de produtos bloqueados (`B1_MSBLQL IN ('1', 'S', 's')`), paginação dinâmica e drilldown multi-empresa.
- [x] [VEND-05] Sub-aba Comissões & Metas: Apuração periódica `SE3` com cálculo dinâmico de Meta Atingida proporcional (R$ 120k / R$ 360k).
- [x] [VEND-06] Autocura de `vendorCode`, fallback resiliente no login/2FA e campo de código de vendedor no painel administrativo.
- [x] [VEND-07] Tema Claro/Escuro unificado para todas as 5 sub-abas dos Vendedores e modais com persistência `localStorage`.
- [x] [VEND-08] Desbloqueio de Visão Unificada para Vendedores em Pedidos Abertos e Comissões (visualização global da equipe comercial sem travas restritivas).
- [x] [VEND-09] Nova Coluna "Nome" no Relatório de Comissões (primeiras 20 letras com espaços via `SA1010`) e redistribuição harmônica de larguras (Vendedor 12%).
- [x] [COMP-01] Nova Aba Principal COMPRAS com 4 Sub-Abas Reaproveitadas (DRY): Disponibilização de Saldos em Estoque, Consulta Ped Venda, Ped Vendas Abertos e Prod x Ped Compras com zero duplicação de DOM/CSS, sincronização em tempo real, controle granular RBAC (`compras`) e alternância de Tema Claro/Escuro.
- [x] [CRED-01] Módulo de Análise de Crédito Comercial: Motor de Score, maturidade digital (RDAP/Wayback/MX) e extrato auditável.
- [x] [CRED-02] Leitura de PDF Serasa Experian com validação de validade (&le; 4 meses), trava de consulta e expansão de métricas do Bloco 5.
- [x] [CRED-03] Tratamento de Capital Social Não Informado / Isento (0 pts) com checkbox e pontuação neutra.
- [x] [CRED-04] Painel de Calibração de Pesos do Score em 6 blocos com sincronização dinâmica de rótulos dos seletores.
- [x] [CRED-05] Auditoria Completa da Sub-aba Análise de Crédito: 12 suítes automatizadas, 78 testes 100% aprovados, resolução de reatribuição de const no histórico, contratos de API em `credito.js`, view BI SQL híbrida JSONB, mascaramento de token InfoSimples e robustez de decimais com ponto flutuante.
- [ ] [INT-01] Ativação da gravação contábil direta no ERP Protheus via rotina AdvPL ExecAuto (`REST_AMARFRET.PRW` / `MATA116`) no AppServer TOTVS.

## 🌐 Infraestrutura & Domínio
- [x] [INFRA-01] Configuração de Subdomínio Personalizado no Render (`portal.gsicofres.com.br` / CNAME para `conciliacao-fretes.onrender.com`, provisionamento SSL Let's Encrypt e inclusão explícita no CORS dinâmico em `server.js`).

## 🟢 Testes & Qualidade
- [x] [QA-01] Criar suíte de testes de segurança e regressão (`test_security.js` e `test_webhooks.js` via `npm test`).
- [x] [QA-02] Suíte de testes automatizados para Pedidos Abertos (`test_pedidos_abertos.js`).
- [x] [QA-03] Suíte de testes automatizados para Pedidos Compras (`test_pedidos_compras.js`).
- [x] [QA-04] Suíte de testes automatizados para Saldos em Estoque, Grupos, Bloqueios, Paginação e Job Supabase (`test_saldos_estoque.js`).
- [x] [QA-05] Suíte de testes automatizados para Autocura de Vendedores e Preservação de `vendorCode` (`test_vendor_autoheal.js`).
- [x] [QA-06] Suíte de testes automatizados para Tema Claro/Escuro nos Vendedores (`test_theme_toggle.js`).
- [x] [QA-07] Suíte de testes automatizados para Totais de Pedido de Venda e Frete Embutido (`test_totais_pedido.js`).
- [x] [QA-08] Suíte de testes automatizados para Parser de PDF Serasa Experian e Validação Temporal (`test_serasa_pdf_parser.js`).
- [x] [QA-09] Suíte de testes automatizados para Capital Social Isento e Calibração de Score (`test_capital_social_isento.js` e `test_score_config.js`).
- [x] [QA-10] Suíte de testes automatizados para DOM XSS e Proteção de Segredos (`test_dom_xss_and_secrets.js`).
- [x] [QA-11] Criar testes E2E com Playwright para fluxos de navegação, 2FA, abas, estoque e crédito (`test_playwright_e2e.js`).
- [x] [QA-12] Suíte de testes automatizados para Resiliência, SRE, Circuit Breaker, Retries e Concorrência JSON (`test_resilience_sre.js`).
- [x] [QA-13] Suíte de testes unitários para Conciliação Bancária, Cartão Líquido e Matching N:1 (`test_conciliacao_bancaria.js`).
- [x] [QA-14] Suíte de testes em Pytest para Parsers de Frete Correios, Rodonaves e ViPP Tipo 2 (`test_parsers.py`).
- [x] [QA-15] Suíte de validação de Schemas Zod para Webhooks Bancários do Banco Inter (`test_webhook_schemas.js`).
- [x] [QA-16] Suíte de testes para Arquitetura Modular ES6 e Documentação OpenAPI (`test_frontend_modules.js`).
- [x] [QA-17] Suíte de testes automatizados para Desbloqueio de Vendedores e Coluna Nome em Comissões (`test_vendedores_desbloqueio.js`).
- [x] [QA-18] Suíte de testes automatizados da Análise de Crédito cobrindo 12 vetores de integridade (78 asserções 100% aprovadas).
- [x] [QA-19] Suíte de testes automatizados para a Aba Principal Compras e Sub-Abas DRY (`test_compras_tab.js` - 6 asserções 100% aprovadas).
- [x] [QA-20] Suíte de testes automatizados para a Central de Tarefas e Delegação (`test_minhas_tarefas.js` - 20 asserções 100% aprovadas).

## 💼 Central de Tarefas & Delegação
- [x] [TASK-01] Central de Delegação e Checagem "Minhas Tarefas": Criação e delegação de demandas operacionais, listagem de colaboradores ativos via `GET /api/auth/users`, unificação de prioridades (`Normal` default, `Alta`, `Urgente`), governança de status, comentários atômicos em JSONB e painel de KPIs em linha única compacta.

## 🛠️ Dívida Técnica, Arquitetura & Manutenibilidade
- [x] [TECH-01] Decomposição e Modularização ES6 do Frontend em 8 submódulos desacoplados em `public/js/*.js` (`utils.js`, `auth.js`, `vendedores.js`, `credito.js`, `financeiro.js`, `logistica.js`, `config.js`, `index.js`).
- [ ] [TECH-03] Descontinuação progressiva de arquivos JSON planos após consolidação exclusiva no PostgreSQL Supabase.
- [ ] [TECH-04] Separação da Autenticação em Página Dedicada (`public/login.html` e `public/js/login-page.js` isolados), removendo o `#loginOverlay` do `index.html` e eliminando travamentos de tela causados por erros em scripts de outras views.

