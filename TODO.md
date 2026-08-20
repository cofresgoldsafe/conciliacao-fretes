# TODO.md — Lista de Pendências e Próximos Passos

## 🔴 Segurança & Hardening (Prioridade Máxima)
- [x] [SEC-01] Implementar autenticação via JWT (jsonwebtoken) com RBAC (admin/operador) nas rotas /api/admin/* e /api/vipp/*
- [x] [SEC-02] Criptografar senhas com bcryptjs e remover senhas em texto puro de postgres_db.js, server.js e data/users.json
- [x] [SEC-03] Blindar consultas SQL no Protheus contra SQL Injection (sanitização de cleanTerm, codWeb, numNF, numPed, nomeCli)
- [x] [SEC-04] Extrair segredos e credenciais fixas para variáveis de ambiente (.env)
- [x] [SEC-05] Limitar uploads no multer (15MB max, whitelist de .pdf, .csv, .txt, .xlsx, .xls)
- [x] [SEC-06] Incluir pacote pypdf na instalação Python do Dockerfile
- [x] [SEC-07] Restringir origens no CORS e sanitizar mensagens de erro 500

## 🟡 Resiliência & SRE (Média Prioridade)
- [ ] [SRE-01] Adicionar tratamento de reconexão e timeouts no pool PostgreSQL (postgres_db.js)
- [x] [SRE-02] Implementar idempotência e deduplicação de webhooks do Banco Inter
- [ ] [SRE-03] Configurar express-rate-limit em rotas sensíveis de autenticação

## 🟢 Testes & Qualidade
- [x] [QA-01] Criar suíte de testes de segurança e regressão (test_security.js e test_webhooks.js via npm test)
- [ ] [QA-02] Criar testes E2E com Playwright para fluxos de navegação e conciliação
