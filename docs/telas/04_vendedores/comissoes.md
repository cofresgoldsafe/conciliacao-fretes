# Apuração de Comissões de Vendas

> **Macro-Área:** Vendedores  
> **Identificador DOM:** `#tab-vend-comissoes` | **Botão:** `#btnTabVendComissoes`  
> **Permissão RBAC:** admin, vendedor, user  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Apuração analítica de comissões de vendedores baseada nos lançamentos Protheus (`SE3`), vinculados à liquidação de títulos (`SE1`).
- **Personas Atendidas:** admin, vendedor, user

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `protheus_db.js, server.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus ERP MSSQL (SE3, SE1, SA3010)

---

## 4. Regras de Negócio & Cálculos Chave
- Visão unificada por vendedor, coluna de identificação de nome comercial e filtros por período de liquidação.

---

## 5. Endpoints REST da API
- `GET /api/vendedores/comissoes`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_vendedores_desbloqueio.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
