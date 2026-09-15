# Consulta Pedidos & NFs de Compras

> **Macro-Área:** Compras  
> **Identificador DOM:** `#tab-compras-consulta-ped-nf` | **Botão:** `#btnTabComprasConsultaPedNf`  
> **Permissão RBAC:** admin, user (Compras)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Busca multi-empresa por Pedido de Compra (SC7), NF de Entrada (SF1), Código de Fornecedor ou Razão Social.
- **Personas Atendidas:** admin, user (Compras)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/compras_consulta_ped_nf.js, public/index.html`
- **Backend / Rotas:** `routes/compras.js, server.js, protheus_db.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus ERP MSSQL (SC7, SF1, SD1, SA2010)

---

## 4. Regras de Negócio & Cálculos Chave
- Trava de segurança de 90 dias para consultas genéricas sem chave estrita, evitando sobrecarga no MSSQL.

---

## 5. Endpoints REST da API
- `GET /api/compras/consulta-ped-nf`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_compras_consulta_ped_nf.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
