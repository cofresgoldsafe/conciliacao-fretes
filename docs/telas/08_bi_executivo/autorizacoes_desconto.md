# Autorizações de Desconto & Margem

> **Macro-Área:** BI Executivo  
> **Identificador DOM:** `#tab-bi-autorizacoes` | **Botão:** `#btnTabBiAutorizacoes`  
> **Permissão RBAC:** admin, diretoria (BI)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Workflow de aprovação executiva de descontos comerciais, margem mínima e frete embutido em negociações integradas entre Pipedrive e Protheus.
- **Personas Atendidas:** admin, diretoria (BI)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/bi_autorizacoes.js, public/index.html`
- **Backend / Rotas:** `routes/bi_autorizacoes.js, server.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (bi_solicitacoes_desconto), Pipedrive API

---

## 4. Regras de Negócio & Cálculos Chave
- Alçadas de aprovação por margem de contribuição. Registro de parecer e notificação instantânea para o vendedor responsável.

---

## 5. Endpoints REST da API
- `GET /api/bi/autorizacoes/pendentes, POST /api/bi/autorizacoes/:id/aprovar`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_bi_autorizacoes.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
