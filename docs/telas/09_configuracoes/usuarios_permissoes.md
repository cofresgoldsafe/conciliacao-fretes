# Usuários & Permissões (RBAC)

> **Macro-Área:** Configurações  
> **Identificador DOM:** `#tab-configuracoes` | **Botão:** `#btnTabConfiguracoes`  
> **Permissão RBAC:** admin exclusivo  
> **Status:** Operacional em Produção  
> **Última Atualização:** 08/11/2026 (v8.320 - Hardening estrito de CORS e aprovação no Vibesane)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Administração de contas de acesso, autenticação de dois fatores (2FA TOTP), hash de senha bcrypt, políticas de segurança perimetral (CORS com allowlist corporativa estrita) e atribuição granular de permissões RBAC.
- **Personas Atendidas:** admin exclusivo

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `server.js, postgres_db.js`
- **Segurança Perimetral / CORS:** Middleware `cors` configurado em `server.js` com allowlist explícita (`allowedOrigins`), rejeição estrita via `callback(null, false)`, extração segura de hostname por `new URL().hostname` para subdomínios autorizados (`.gsicofres.com.br`, `.gsi.com.br`, `.oaco.com.br`) e bloqueio preventivo de subdomínios arbitrários do Render (`.onrender.com`).

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (users, user_roles, user_2fa_secrets), Fallback data/users.json

---

## 4. Regras de Negócio & Cálculos Chave
- Senhas com salt e hash bcrypt. Suporte a 2FA com QR Code. Permissões dinâmicas autodescobertas no DOM (SYSTEM_TABS_REGISTRY). Associação de código de vendedor.
- **Política de CORS Zero-Trust:** Quando `credentials: true` está ativo, nenhuma origem não autorizada pode ter o cabeçalho `Access-Control-Allow-Origin` refletido. Rejeição com omissão de cabeçalhos contra ataques cross-origin autenticados.

---

## 5. Endpoints REST da API
- `GET /api/usuarios, POST /api/usuarios, PUT /api/usuarios/:id, POST /api/usuarios/:id/toggle-status`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_2fa.js, node test_rbac_dynamic_permissions.js, node test_security.js
```
- Cobertura de CORS em `test_security.js`: validação de localhost, produção Render oficial, subdomínios corporativos e rejeição de atacantes/wildcards.

---

## 7. Histórico & Evolução da Tela
- **v8.320 (08/11/2026):** Hardening de segurança de CORS em `server.js` contra reflexão indevida de cabeçalhos de origem (`callback(null, false)`), remoção de wildcard vulnerável do Render e validação aprovada no scanner Vibesane (`/seg`) e suíte de segurança (`test_security.js` com 28/28 testes aprovados).
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
