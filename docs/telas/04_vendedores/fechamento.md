# Fechamento Mensal Comercial

> **Macro-Área:** Vendedores  
> **Identificador DOM:** `#tab-vend-fechamento` | **Botão:** `#btnTabVendFechamento`  
> **Permissão RBAC:** admin, vendedor, user  
> **Status:** Operacional em Produção  
> **Última Atualização:** 30/09/2026 (v8.281 - Botão Recalcular Fechamento direto na tela de Vendedores)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Consolidação mensal de desempenho comercial por vendedor, apuração de metas atingidas, comissões gamificadas e ranking.
- **Personas Atendidas:** admin, vendedor, user

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/fechamento_vendedores.js, public/index.html` (botões `#btnRecalcularFechamentoVend`, `#btnImprimirFechamento`)
- **Backend / Rotas:** `fechamento_vendedores_engine.js, server.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (`fechamento_vendedor`, `metas_vendedores`), Protheus (`SF2`, `SE3`, `SC5`, `SE1`)

---

## 4. Regras de Negócio & Cálculos Chave
- Dropdown de 12 ciclos predefinidos (dia 26 a dia 25). Cards gamificados com faixas de metas. Elegibilidade de bônus de frete atrelada a atingimento de >=85% da meta de vendas. Dedução de fretes embutidos (SC5) e títulos inadimplentes (SE1).
- **Recálculo Sob Demanda:** Botão `🔄 Recalcular Fechamento` disponível diretamente na barra de ferramentas da tela para sincronização instantânea em caso de alterações de comissões ou baixas de títulos no Protheus.

---

## 5. Endpoints REST da API
- `GET /api/vendedores/fechamento/atual, GET /api/vendedores/fechamento/historico, GET /api/vendedores/fechamento/ciclo/:cicloId, POST /api/vendedores/fechamento/gerar`

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_fechamento_vendedores.js && node test_fechamento_cards_gamificados.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.281 (30/09/2026):** Inclusão do botão de ação direta `🔄 Recalcular Fechamento` (`#btnRecalcularFechamentoVend`) na barra superior da tela de Fechamento de Vendedores, permitindo a qualquer operador/gestor sincronizar e reprocessar os dados do Protheus instantaneamente sem necessidade de intervenção técnica ou navegação até a aba de configurações.
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
