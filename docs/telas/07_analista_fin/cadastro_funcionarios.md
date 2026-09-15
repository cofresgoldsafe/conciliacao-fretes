# Cadastro Geral de Colaboradores DP

> **Macro-Área:** Analista Fin  
> **Identificador DOM:** `#tab-funcionarios` | **Botão:** `#btnTabFuncionarios`  
> **Permissão RBAC:** admin, user (Analista Fin)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Manutenção cadastral de funcionários, sócios e prestadores PJ, cargos, salários, admissões, desligamentos e dados bancários/Pix.
- **Personas Atendidas:** admin, user (Analista Fin)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/funcionarios_dp.js, public/index.html`
- **Backend / Rotas:** `routes/funcionarios.js, server.js, postgres_db.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (colaboradores_dp)

---

## 4. Regras de Negócio & Cálculos Chave
- Deduplicação inteligente por CPF e chave composta. Gestão de status ATIVO vs DESLIGADO com filtro padrão ATIVO. Histórico de alterações salariais.

---

## 5. Endpoints REST da API
- `GET /api/dp/funcionarios, POST /api/dp/funcionarios, PUT /api/dp/funcionarios/:id`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_funcionarios_dp.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
