# Holerites DP

> **Macro-Área:** Analista Fin  
> **Identificador DOM:** `#tab-holerites` | **Botão:** `#btnTabHolerites`  
> **Permissão RBAC:** admin, user (Analista Fin)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Emissão, personalização de logos base64 (GSI, OAÇO, Sem Registro) e distribuição digital de holerites para assinatura via plataformas como ZapSign.
- **Personas Atendidas:** admin, user (Analista Fin)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/holerites.js, public/index.html`
- **Backend / Rotas:** `routes/holerites.js, server.js, services/holerite_pdf.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (holerites_gerados, colaboradores_dp)

---

## 4. Regras de Negócio & Cálculos Chave
- Tabela de proventos e descontos alinhada. Espaçamento ampliado para assinatura eletrônica (+80%). Geração segura de PDFs protegidos.

---

## 5. Endpoints REST da API
- `POST /api/holerites/gerar, GET /api/holerites/listar`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_holerites_api.js, node test_holerites_visual_signature.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
