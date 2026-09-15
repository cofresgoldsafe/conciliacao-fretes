# Upload Fatura de Transportadoras

> **Macro-Área:** Logística  
> **Identificador DOM:** `#tab-upload` | **Botão:** `#btnTabUpload`  
> **Permissão RBAC:** admin, user (Logística)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Upload, parsing automatizado de faturas/conhecimentos de frete (Rodonaves e layouts padrão) e geração de amarração contábil no Protheus.
- **Personas Atendidas:** admin, user (Logística)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `server.js, parser_rodonaves.py, parser_tipo2.py, AMARFRET.PRW`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (faturas_frete, itens_fatura_frete), Protheus (SF8, SE2, SF1)

---

## 4. Regras de Negócio & Cálculos Chave
- Extração de CTRC/CT-e, NF de origem, remetente, destinatário, valor cobrado e peso. Comparação com a tabela negociada e validação de divergências.

---

## 5. Endpoints REST da API
- `POST /api/upload-fatura, GET /api/faturas-processadas`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_deteccao_entrega.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
