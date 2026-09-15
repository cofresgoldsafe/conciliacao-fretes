# Ponto de Pedido Ideal

> **Macro-Área:** Compras  
> **Identificador DOM:** `#tab-compras-ponto-pedido` | **Botão:** `#btnTabComprasPontoPedido`  
> **Permissão RBAC:** admin, user (Compras)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Cálculo estatístico e analítico de consumo médio diário, lead time de fornecedores e cálculo de ressuprimento ideal multi-empresa.
- **Personas Atendidas:** admin, user (Compras)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/compras_ponto_pedido.js, public/index.html`
- **Backend / Rotas:** `routes/ponto_pedido.js, server.js, protheus_db.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus (SB1, SB2, SD2 histórico 24M com UNION ALL 14, 15, 16, SC7, SC6)

---

## 4. Regras de Negócio & Cálculos Chave
- Cálculo de Demanda Média Diária (DMD) ponderada, Estoque de Segurança e Ponto de Pedido: PP = (DMD * LeadTime) + EstSeguranca. Modal explicativo com drilldown.

---

## 5. Endpoints REST da API
- `GET /api/compras/ponto-pedido-ideal`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_compras_ponto_pedido.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
