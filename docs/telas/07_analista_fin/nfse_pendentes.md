# NFS-e Pendentes

> **Macro-Área:** Analista Fin  
> **Identificador DOM:** `#tab-nfse-pendentes` | **Botão:** `#btnTabNfsePendentes`  
> **Permissão RBAC:** admin, user (Analista Fin)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 28/09/2026 (v8.279 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Gestão fiscal de notas fiscais de serviço (NFS-e) recebidas de fornecedores com conciliação automática contra documentos Protheus SF1.
- **Personas Atendidas:** admin, user (Analista Fin)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/nfse_pendentes.js, public/index.html`
- **Backend / Rotas:** `routes/nfse.js, server.js, protheus_db.js`
- **Job Externo de Ingestão:** `claude-job-nfse` (`src/job.js`, cron GitHub Actions seg/qua/sex às 06h via ADN Nacional)

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (nfse_recebidas), Protheus (SF1, SA2010)

---

## 4. Regras de Negócio & Cálculos Chave
- Matching em 3 níveis: Match Exato (CNPJ + Número NF), Match por Alias e Match por Raiz de CNPJ (8 dígitos). Ingestão contínua via webhook com push autenticado por API key.
- **Resiliência do Job ADN (claude-job-nfse v2.2.0):** Socket timeout adaptativo de 45s a 60s contra lentidão na Receita Federal (`adn.nfse.gov.br`), retries com backoff de 5s a 25s e humanização de instabilidades temporárias de conexão.

---

## 5. Endpoints REST da API
- `GET /api/fiscal/nfse-pendentes, POST /api/fiscal/nfse-conciliar, POST /api/analista-fin/nfse/ingest`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_nfse_pendentes.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.279 (28/09/2026):** Homologação de resiliência e estabilidade do job externo de captura ADN (`claude-job-nfse` v2.2.0): ampliação de socket timeout para 60s progressivo (45s..60s), backoff de 5s a 25s e humanização de erros de timeout governamental, eliminando travamentos intermitentes no workflow do GitHub Actions.
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
