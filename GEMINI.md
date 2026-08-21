# GEMINI.md — Memória de Projeto & Diretrizes Técnicas

> **Projeto:** Portal de Conciliação de Frete, Consulta Operacional e Gestão Financeira  
> **Repositório:** C:\Users\Alexandre\Documents\Gemini-Cli  
> **Última Atualização:** 21 de Agosto de 2026  
> **Status:** Em Produção no Render (https://conciliacao-fretes.onrender.com) com integrações ativas (Protheus ERP / Supabase / Banco Inter / ViPP FTP).

---

## 1. Visão Geral do Sistema & Domínio de Negócio

O sistema é uma plataforma multi-empresas integrada para operações de logística, consulta de pedidos/notas fiscais e conciliação bancária/frete:
1. **Consulta Multi-Empresas (Aba 1):** Busca unificada de Notas Fiscais e Pedidos no ERP TOTVS Protheus (tabelas SC5, SC6, SF2, SD2, SA1, SE1, SE2) para empresas **OACO**, **GSI** e **MP**. Conexão intermediada via API FastAPI na Railway ( pi-protheus-production.up.railway.app).
2. **Conciliação de Fretes (Aba 2):** Processamento e auditoria de faturas de transportadoras (Correios, Rodonaves, TNT, Braspress, etc.) cruzando faturas em PDF/CSV/TXT com os CTEs e pedidos faturados. Parsers dedicados em Python (parser_correios.py, parser_rodonaves.py, parser_tipo2.py) com validação estrita de formatos e assinaturas digitais.
3. **Configurações & Gestão de Acessos (Aba 3):** Gestão de operadores, credenciais ViPP ( ipp_api.py), tabelas de parâmetros e regras de frete.
4. **Módulo Financeiro & Extratos (Aba 4):** Integração com API v2 do **Banco Inter** (inter_api.js) com mTLS (certificados .crt/.key), emissão de Pix, boletos, extratos bancários e recepção de webhooks.
5. **Telemetria & Auditoria:** Armazenamento de logs de ações, buscas e auditorias de conciliação no banco de dados **PostgreSQL / Supabase** (postgres_db.js).

---

## 2. Stack Tecnológica & Arquitetura

- **Backend:** Node.js (Express), CommonJS (server.js, postgres_db.js, protheus_db.js, inter_api.js, vipp_ftp.js).
- **Frontend:** HTML5, CSS3/Tailwind, JavaScript Vanilla (public/index.html, public/app.js).
- **Bancos de Dados:** 
  - PostgreSQL (Supabase / local pool pg) para dados operacionais, auditoria e usuários.
  - Microsoft SQL Server (TOTVS Protheus) via túnel FastAPI/Railway.
- **Hospedagem:** Render Web Service (Dockerfile, Procfile).
- **Scripts Auxiliares:** Python 3 (pdfplumber, pypdf, requests, vipp_ftp_sync.py).
- **AdvPL / TOTVS:** Fontes de integração Protheus (AMARFRET.PRW, REST_AMARFRET.PRW).

---

## 3. Backlog Crítico Consolidado (Auditoria de Segurança & SRE)

As seguintes pendências foram identificadas na auditoria completa e devem ser priorizadas nas próximas sessões:

### 🔴 Alta Prioridade / Segurança Crítica (Red Team & Hardening)
- [x] **[SEC-01] Autenticação Real & JWT:** Autenticação via `jsonwebtoken` (JWT) com verificação de papéis (`admin`/`operador`) nas rotas `/api/admin/*` e `/api/vipp/*`.
- [x] **[SEC-02] Criptografia de Senhas (Bcrypt):** Senhas criptografadas com `bcryptjs` (salt 10) no cadastro/login e eliminadas senhas em texto puro de `server.js`, `postgres_db.js` e `data/users.json`.
- [x] **[SEC-03] Blindagem T-SQL Injection:** Sanitização estrita de parâmetros de busca em `protheus_db.js` (`cleanTerm`, `codWeb`, `numNF`, `numPed`, `nomeCli`).
- [x] **[SEC-04] Secret Scanning:** Segredos isolados e suporte a credenciais em variáveis de ambiente (`.env` / Render).
- [x] **[SEC-05] Proteção de Uploads (Multer):** Restrição de tamanho máximo (15 MB) e whitelist de extensões (`.pdf`, `.csv`, `.txt`, `.xlsx`, `.xls`) nas rotas de upload do `server.js`.
- [x] **[SEC-06] Python no Dockerfile:** Inclusão do pacote `pypdf` no `Dockerfile`.
- [x] **[SEC-07] CORS Restritivo & Sanitização de Erros:** CORS restrito às origens oficiais e mascaramento de detalhes técnicos em respostas HTTP 500.

### 🟡 Média Prioridade / Resiliência & SRE
- [x] **[SRE-01] Resiliência de Conexões (Pool PG):** Pool PostgreSQL parametrizado com TCP KeepAlive, timeouts estritos (`connectionTimeoutMillis`, `query_timeout`, `statement_timeout`), wrapper `safeQuery` com retries automáticos para erros transitórios e rotina de auto-reconexão/health check em background.
- [x] **[SRE-02] Idempotência em Pagamentos/Webhooks:** Idempotência estrita implementada e testada no receptor de webhooks do Banco Inter.
- [x] **[SRE-03] Rate Limiting:** Configurado `express-rate-limit` com `trust proxy` (Render) e proteção anti brute-force na rota `/api/auth/login` (30 req / 15 min com HTTP 429).
- [x] **[SRE-04] Automação FTP ViPP & Conciliação Correios:** Módulo de conexão FTP nativo (`vipp_ftp.js` / `vipp_ftp_sync.py`) com sincronização incremental de CSVs (`/Retorno`), classificação de **Ordem de Serviço (OS)** vs **Nota Fiscal (NF)**, suporte expandido para `ORDEM DE SERVIÇO 1258`, tratamento de `Sem Info` e edição manual com busca instantânea no Protheus.

### 🟢 Testes & Qualidade (QA & Tech Lead)
- [x] **[QA-01] Testes Automatizados:** Suíte completa de testes de segurança, webhooks e FTP ViPP (`test_security.js`, `test_webhooks.js`, `test_vipp_ftp.js`).
- [x] **[QA-02] Testes E2E (Fluxos & Navegação):** Suíte completa de testes ponta a ponta (`test_e2e.js`) cobrindo autenticação, entrega da SPA, RBAC admin/user, uploads, health check, validação cruzada de faturas e APIs financeiras com 100% de aprovação (52/52 testes passando).

---

## 4. Regras Operacionais para o Gemini CLI / Antigravity

1. **Nunca quebrar integrações existentes:** Toda modificação em protheus_db.js ou inter_api.js deve preservar a compatibilidade de contratos com o ERP e a API bancária.
2. **Preservação de Documentação:** Mantenha atualizados os arquivos de checkpoint (DOCUMENTO_CHECKPOINT_*.md) e este GEMINI.md a cada alteração arquitetural.
3. **Higiene de Segredos:** Nunca grave credenciais reais de produção, senhas ou tokens nos arquivos rastreados pelo Git. Utilize .env.
4. **Versionamento & Cache-Busting Obrigatório Antes de Commitar:** ANTES de qualquer `git commit` / push, o agente é **ESTRITAMENTE OBRIGADO** a executar `node bump_version.js "<Descrição das alterações>"` (ou `npm run version:bump`). Isso atualiza a data/hora exata no cabeçalho do `public/index.html` e incrementa o parâmetro `?v=X.Y` para evitar que o navegador do usuário carregue versões defasadas em cache. Nunca realizar commit sem essa atualização.
