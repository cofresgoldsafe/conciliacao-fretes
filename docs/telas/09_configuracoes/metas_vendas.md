# Configuração de Metas de Vendas

> **Macro-Área:** Configurações  
> **Identificador DOM:** `#tab-config-metas-vendas` | **Botão:** `#btnTabConfigMetasVendas`  
> **Permissão RBAC:** admin exclusivo  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Parametrização de metas mensais por vendedor, faixas de premiação, limites de gordura de frete e regras comissionamento.
- **Personas Atendidas:** admin exclusivo

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `routes/fechamento.js, server.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (metas_vendedores, ciclos_fechamento)

---

## 4. Regras de Negócio & Cálculos Chave
- Pisos e tetos de bonificação. Configuração da meta de vendas e meta de gordura de frete para apuração mensal automática.

---

## 5. Endpoints REST da API
- `GET /api/config/metas-vendas, POST /api/config/metas-vendas`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_fechamento_cards_gamificados.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
