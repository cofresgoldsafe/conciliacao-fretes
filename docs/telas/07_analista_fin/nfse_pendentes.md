# NFS-e Pendentes

> **Macro-Área:** Analista Fin  
> **Identificador DOM:** `#tab-nfse-pendentes` | **Botão:** `#btnTabNfsePendentes`  
> **Permissão RBAC:** admin, user (Analista Fin)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Gestão fiscal de notas fiscais de serviço (NFS-e) recebidas de fornecedores com conciliação automática contra documentos Protheus SF1.
- **Personas Atendidas:** admin, user (Analista Fin)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/nfse_pendentes.js, public/index.html`
- **Backend / Rotas:** `routes/nfse.js, server.js, protheus_db.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (nfse_recebidas), Protheus (SF1, SA2010)

---

## 4. Regras de Negócio & Cálculos Chave
- Matching em 3 níveis: Match Exato (CNPJ + Número NF), Match por Alias e Match por Raiz de CNPJ (8 dígitos). Job contínuo de ingestão via webhook.

---

## 5. Endpoints REST da API
- `GET /api/fiscal/nfse-pendentes, POST /api/fiscal/nfse-conciliar`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_nfse_pendentes.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
