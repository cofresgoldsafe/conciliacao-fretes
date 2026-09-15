# Usuários & Permissões (RBAC)

> **Macro-Área:** Configurações  
> **Identificador DOM:** `#tab-configuracoes` | **Botão:** `#btnTabConfiguracoes`  
> **Permissão RBAC:** admin exclusivo  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Administração de contas de acesso, autenticação de dois fatores (2FA TOTP), hash de senha bcrypt e atribuição granular de permissões RBAC.
- **Personas Atendidas:** admin exclusivo

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `server.js, postgres_db.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (users, user_roles, user_2fa_secrets), Fallback data/users.json

---

## 4. Regras de Negócio & Cálculos Chave
- Senhas com salt e hash bcrypt. Suporte a 2FA com QR Code. Permissões dinâmicas autodescobertas no DOM (SYSTEM_TABS_REGISTRY). Associação de código de vendedor.

---

## 5. Endpoints REST da API
- `GET /api/usuarios, POST /api/usuarios, PUT /api/usuarios/:id, POST /api/usuarios/:id/toggle-status`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_2fa.js, node test_rbac_dynamic_permissions.js, node test_security.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
