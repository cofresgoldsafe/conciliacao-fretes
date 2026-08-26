# TODO.md — Lista de Pendências e Próximos Passos

## 🔴 Segurança & Hardening (Prioridade Máxima)
- [x] [SEC-01] Implementar autenticação via JWT (jsonwebtoken) com RBAC (admin/operador) nas rotas /api/admin/* e /api/vipp/*
- [x] [SEC-02] Criptografar senhas com bcryptjs e remover senhas em texto puro de postgres_db.js, server.js e data/users.json
- [x] [SEC-03] Blindar consultas SQL no Protheus contra SQL Injection (sanitização de cleanTerm, codWeb, numNF, numPed, nomeCli)
- [x] [SEC-04] Extrair segredos e credenciais fixas para variáveis de ambiente (.env)
- [x] [SEC-05] Limitar uploads no multer (15MB max, whitelist de .pdf, .csv, .txt, .xlsx, .xls)
- [x] [SEC-06] Incluir pacote pypdf na instalação Python do Dockerfile
- [x] [SEC-07] Restringir origens no CORS e sanitizar mensagens de erro 500
- [x] [SEC-08] Implementar autenticação 2FA por e-mail com tokens temporários e rate limiting

## 🟡 Resiliência & SRE (Média Prioridade)
- [x] [SRE-01] Adicionar tratamento de reconexão e timeouts no pool PostgreSQL (postgres_db.js)
- [x] [SRE-02] Implementar idempotência e deduplicação de webhooks do Banco Inter
- [x] [SRE-03] Configurar express-rate-limit em rotas sensíveis de autenticação
- [x] [SRE-04] Rotina de Keep-Alive periódico a cada 2h para prevenir congelamento de banco inativo no Supabase
- [x] [SRE-05] Job agendado de sincronização de estoque Protheus x Supabase com fallback local e cooldown

## 💼 Funcionalidades & Módulos de Negócio
- [x] [VEND-01] Sub-aba Consulta Pedido: Pesquisa multi-empresa (14, 15, 16) com integração SA1010, máscaras e itens SC6
- [x] [VEND-02] Sub-aba Pedidos Abertos: Listagem multi-empresa não faturada com regras de bloqueio SC9 e CRM Pipedrive
- [x] [VEND-03] Sub-aba Pedidos Compras: Consulta de compras em aberto (SC7) de produtos PA com fornecedores SA2010
- [x] [VEND-04] Sub-aba Saldos em Estoque: Visual Power BI, consolidação SB1/SB2/SC6/SC7, KPIs, filtros comerciais (Grupos 001, 002, 010, 018), exclusão de bloqueados (B1_MSBLQL <> '1'), paginação dinâmica e drilldown multi-empresa
- [x] [VEND-05] Sub-aba Comissões & Metas: Apuração periódica SE3 com cálculo dinâmico de Meta Atingida proporcional
- [x] [VEND-06] Autocura de vendorCode, fallback resiliente no login/2FA e campo de código de vendedor no painel administrativo
- [x] [CRED-01] Módulo de Análise de Crédito Comercial: Motor de Score, maturidade digital (RDAP/Wayback/MX) e extrato auditável

## 🌐 Infraestrutura & Domínio
- [ ] [INFRA-01] Configuração de Subdomínio Personalizado no Render (ex: `portal.gsi.com.br` / CNAME para `conciliacao-fretes.onrender.com`, emissão de certificado SSL Let's Encrypt e inclusão explícita no array `allowedOrigins` em `server.js`)

## 🟢 Testes & Qualidade
- [x] [QA-01] Criar suíte de testes de segurança e regressão (test_security.js e test_webhooks.js via npm test)
- [x] [QA-02] Suíte de testes automatizados para Pedidos Abertos (test_pedidos_abertos.js)
- [x] [QA-03] Suíte de testes automatizados para Pedidos Compras (test_pedidos_compras.js)
- [x] [QA-04] Suíte de testes automatizados para Saldos em Estoque, Grupos, Bloqueios, Paginação e Job Supabase (test_saldos_estoque.js)
- [x] [QA-05] Suíte de testes automatizados para Autocura de Vendedores e Preservação de vendorCode (test_vendor_autoheal.js)
- [ ] [QA-06] Criar testes E2E com Playwright para fluxos de navegação e conciliação
