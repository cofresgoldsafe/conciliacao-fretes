# Consulta NFe, Pedido ou CodWeb

> **Macro-Área:** Busca Multi-Empresa  
> **Identificador DOM:** `#tab-consulta` | **Botão:** `#btnTabConsulta`  
> **Permissão RBAC:** admin, user (Consulta)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Busca unificada multi-empresa por Código Web Pipedrive, Número de Pedido Protheus, Chave/Número de NF ou Razão Social do Cliente.
- **Personas Atendidas:** admin, user (Consulta)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `protheus_db.js, server.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus ERP MSSQL (SC5, SC6, SF2, SA1010, SD2 nas empresas 14, 15, 16 e 09)

---

## 4. Regras de Negócio & Cálculos Chave
- Detecção inteligente do tipo de chave inserida. Enriquecimento temporal: Data de Ganho Comercial, Data de Migração Protheus e Data de Emissão Fiscal.

---

## 5. Endpoints REST da API
- `GET /api/busca/unificada?termo=:termo`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_busca_codweb_ped_nf.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
