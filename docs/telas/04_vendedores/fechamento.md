# Fechamento Mensal Comercial

> **Macro-Área:** Vendedores  
> **Identificador DOM:** `#tab-vend-fechamento` | **Botão:** `#btnTabVendFechamento`  
> **Permissão RBAC:** admin, vendedor, user  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Consolidação mensal de desempenho comercial por vendedor, apuração de metas atingidas, comissões gamificadas e ranking.
- **Personas Atendidas:** admin, vendedor, user

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/fechamento_vendedores.js, public/index.html`
- **Backend / Rotas:** `routes/fechamento.js, server.js, services/cron_fechamento.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (fechamento_mensal, metas_vendedores), Protheus (SF2, SE3)

---

## 4. Regras de Negócio & Cálculos Chave
- Dropdown de 12 ciclos predefinidos. Cards gamificados com faixas de metas. Elegibilidade de bônus de frete atrelada a atingimento de >=85% da meta de vendas.

---

## 5. Endpoints REST da API
- `GET /api/vendedores/fechamento, POST /api/vendedores/fechamento/consolidar`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_fechamento_vendedores.js, node test_fechamento_cards_gamificados.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
