# Apuração de Gordura de Frete

> **Macro-Área:** Vendedores  
> **Identificador DOM:** `#tab-vend-gordura-frete` | **Botão:** `#btnTabVendGorduraFrete`  
> **Permissão RBAC:** admin, vendedor, user  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Cálculo de margem e sobrepreço embutido de frete negociado versus custo efetivo de tabela de transporte no ciclo comercial (dia 26 ao 25).
- **Personas Atendidas:** admin, vendedor, user

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/gordura_frete.js, public/index.html`
- **Backend / Rotas:** `routes/gordura_frete.js, server.js, protheus_db.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** Protheus (SC5, SF2), PostgreSQL Supabase (tabelas_frete_negociado)

---

## 4. Regras de Negócio & Cálculos Chave
- Ciclo fechado 26/Mês-1 a 25/Mês-Atual. Comparação de C5_VLR_FRT embutido vs custo real de tabela.

---

## 5. Endpoints REST da API
- `GET /api/vendedores/gordura-frete`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_gordura_frete.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
