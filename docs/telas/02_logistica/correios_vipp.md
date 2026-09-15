# Fatura Correios & ViPP

> **Macro-Área:** Logística  
> **Identificador DOM:** `#tab-correios` | **Botão:** `#btnTabCorreios`  
> **Permissão RBAC:** admin, user (Logística)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 15/09/2026 (v8.219 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Conciliação e conferência de faturas dos Correios e plataforma ViPP com batimento de postagens, PLPs e códigos de rastreio.
- **Personas Atendidas:** admin, user (Logística)

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/app.js, public/index.html`
- **Backend / Rotas:** `server.js, parser_correios.py, services/vipp_sync.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (faturas_correios, postagens_vipp)

---

## 4. Regras de Negócio & Cálculos Chave
- Batimento entre etiquetas postadas e faturadas. Detecção de divergência de faixa de CEP, peso tarifado vs peso real e serviços adicionais.

---

## 5. Endpoints REST da API
- `POST /api/correios/upload, GET /api/correios/extrato`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_vipp_ftp.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
