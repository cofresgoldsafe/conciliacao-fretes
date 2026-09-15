# Atividades & Auditoria (Audit Trail)

> **Macro-Área:** Configurações  
> **Identificador DOM:** `#tab-config-logs` | **Botão:** `#btnTabConfigLogs`  
> **Permissão RBAC:** admin exclusivo  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Trilha de auditoria em tempo real de ações operacionais, login, logout, alterações cadastrais, sessões ativas e heartbeats.
- **Personas Atendidas:** admin exclusivo

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `server.js, postgres_db.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (user_activities), Fallback data/activities.json

---

## 4. Regras de Negócio & Cálculos Chave
- Log append-only com timestamp ISO, IP de origem, agente do usuário e payload resumido de auditoria. Paginação por cursor keyset O(1).

---

## 5. Endpoints REST da API
- `GET /api/auditoria/logs`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_security.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
