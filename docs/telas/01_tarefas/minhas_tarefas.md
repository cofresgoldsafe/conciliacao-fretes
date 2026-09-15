# Painel de Tarefas

> **Macro-Área:** Tarefas  
> **Identificador DOM:** `#tab-minhas-tarefas` | **Botão:** `#btnTabMinhasTarefas`  
> **Permissão RBAC:** Todos (admin, user, vendedor)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Central de tarefas operacionais, delegação entre colaboradores, acompanhamento de prazos, kanban/listagem de status e histórico de comentários JSONB.
- **Personas Atendidas:** Todos (admin, user, vendedor)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/tarefas.js, public/index.html`
- **Backend / Rotas:** `routes/tarefas.js, server.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (tarefas, comentarios_tarefa), Fallback local data/tarefas.json

---

## 4. Regras de Negócio & Cálculos Chave
- Transições de status (Pendente, Em Andamento, Concluída, Cancelada, Reaberta). Filtro default ativo "Pendente / Reaberta". Delegação com notificação e trilha de auditoria em user_activities.

---

## 5. Endpoints REST da API
- `GET /api/tarefas, POST /api/tarefas, PUT /api/tarefas/:id, POST /api/tarefas/:id/comentarios`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_minhas_tarefas.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
