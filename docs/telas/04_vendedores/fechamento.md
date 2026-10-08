# Fechamento Mensal Comercial

> **Macro-Área:** Vendedores  
> **Identificador DOM:** `#tab-vend-fechamento` | **Botão:** `#btnTabVendFechamento`  
> **Permissão RBAC:** admin, vendedor, user  
> **Status:** Operacional em Produção  
> **Última Atualização:** 08/10/2026 (v8.305 - Padronização de Prefixos de Ciclos & Eliminação de 'Mês Anterior' Duplicado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Consolidação mensal de desempenho comercial por vendedor, apuração de metas atingidas, comissões gamificadas, ranking e acompanhamento em tempo real do ciclo em andamento.
- **Personas Atendidas:** admin, vendedor, user

---

## 2. Arquitetura de Código & Componentes
- **Frontend:** `public/js/fechamento_vendedores.js, public/index.html` (botões `#btnRecalcularFechamentoVend`, `#btnImprimirFechamento`, select `#fechamentoHistoricoSelect`)
- **Backend / Rotas:** `fechamento_vendedores_engine.js, server.js`

---

## 3. Banco de Dados & Modelagem
- **Persistência / Tabelas:** PostgreSQL Supabase (`fechamentos_vendedores`, `metas_vendedores`), Protheus (`SF2`, `SE3`, `SC5`, `SE1`)

---

## 4. Regras de Negócio & Cálculos Chave
- **Ciclo Atual em Andamento (Em Aberto):** O vendedor e a gestão podem acompanhar o ciclo ativo em que a equipe está trabalhando para bater as metas do mês (ex: 26/09/2026 a 25/10/2026). Exibe vendas líquidas até o momento, quanto falta para bater a meta (100%, 150%, 200%), fretes acumulados, dias restantes até o encerramento em dia 25 e ranking dinâmico.
- **Último Ciclo Oficial (Fechado / Default):** Ao abrir a tela, o ciclo exibido por padrão é o último período homologado e fechado (ex: 26/08/2026 a 25/09/2026). O rótulo foi alterado de "Ciclo Atual" para "Último Ciclo" para evitar confusão entre período fechado e período em andamento.
- **Dropdown de Ciclos (Padronização Estrita sem 'Mês Anterior'):**
  - `⚡ Ciclo Atual: 26/09/2026 a 25/10/2026` (Item 0 - Em Andamento / Metas do Mês)
  - `🔒 Último Ciclo: 26/08/2026 a 25/09/2026` (Item 1 - Fechado Oficial / Seleção Padrão)
  - `⏮️ Ciclo: 26/07/2026 a 25/08/2026` (Item 2 - Histórico)
  - `⏮️ Ciclo: 26/06/2026 a 25/07/2026` (Item 3 - Histórico)
  - `⏮️ Ciclo: ...` (Itens subsequentes até 12 ciclos)
  *(Eliminação total do rótulo 'Mês Anterior' para erradicar duplicidades e ambiguidades com o Último Ciclo fechado).*
- **Cards Gamificados & Gatilhos:** Faixas de metas (100% R$ 400, 150% R$ 600, 200% R$ 1.000). Elegibilidade de bônus de frete atrelada a atingimento de >=85% da meta de vendas. Dedução de fretes embutidos (SC5).
- **Relação de Comissões (SE3) como Fonte Única:** A apuração das comissões tem a `SE3` como fonte única e exclusiva de verdade. Títulos em aberto de contas a receber (`SE1`) não são deduzidos diretamente da comissão do vendedor; caso uma inadimplência se confirme ou vá para cartório/perda, o financeiro lança uma comissão negativa na `SE3` que abate organicamente a base e o fechamento do vendedor.
- **Recálculo Sob Demanda:** Botão `🔄 Recalcular Fechamento` disponível diretamente na barra de ferramentas da tela para sincronização instantânea em caso de novos faturamentos no Protheus.

---

## 5. Endpoints REST da API
- `GET /api/vendedores/fechamento/atual`: Retorna o Último Ciclo fechado por padrão com metadados do `cicloAtualEmAndamento`.
- `GET /api/vendedores/fechamento/historico`: Retorna a lista de ciclos iniciando com o Ciclo Atual (em andamento), Último Ciclo e ciclos históricos anteriores.
- `GET /api/vendedores/fechamento/ciclo/:cicloId`: Retorna fechamento por ciclo específico com flags `isEmAndamento` e `diasRestantes`.
- `POST /api/vendedores/fechamento/gerar`: Força recálculo no Protheus sob demanda para o ciclo ativo.

---

## 6. Testes Automatizados Vinculados
- Execução de testes de regressão:
```bash
node test_fechamento_vendedores.js && node test_fechamento_cards_gamificados.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.305 (08/10/2026):** Padronização rigorosa dos prefixos de ciclos no seletor de histórico: Ciclo Atual (`⚡ Ciclo Atual:` no item 0), Último Ciclo (`🔒 Último Ciclo:` no item 1 como seleção padrão) e ciclos históricos (`⏮️ Ciclo:` nos itens 2 em diante), erradicando a duplicidade e ambiguidade do rótulo 'Mês Anterior'.
- **v8.304 (08/10/2026):** Implementação da opção de visualização do Ciclo Atual em andamento (26/09 a 25/10) com metas em tempo real, cálculo de quanto falta para atingir a meta, dias restantes e fretes acumulados. Renomeação do ciclo fechado de "Ciclo Atual" para "Último Ciclo: 26/08/2026 a 25/09/2026" (mantido como seleção padrão ao carregar a tela).
- **v8.292 (05/10/2026):** Resolução do erro de referência no frontend (`ReferenceError: elComisSub is not defined`) que abortava a execução de `renderizarStatCards()` e bloqueava a renderização dos cards subsequentes de Gordura de Frete Líquida, Total de Premiações, Faturamento por Empresa e Benchmarking da Equipe. Adição de resiliência de parsing JSON e cálculo fallback dinâmico de médias da equipe via `todosVendedoresCiclo`.
- **v8.282 (30/09/2026):** Alinhamento da apuração de comissões com a `SE3` como fonte única e exclusiva de comissões. Eliminação da dedução arbitrária de títulos em aberto de contas a receber (`SE1`) que zeravam indevidamente a comissão líquida de vendedores (caso Andrea - NF 250). Inadimplências confirmadas passam a ser abatidas organicamente via lançamentos de comissão negativa na `SE3`.
- **v8.281 (30/09/2026):** Inclusão do botão de ação direta `🔄 Recalcular Fechamento` (`#btnRecalcularFechamentoVend`) na barra superior da tela de Fechamento de Vendedores, permitindo a qualquer operador/gestor sincronizar e reprocessar os dados do Protheus instantaneamente sem necessidade de intervenção técnica ou navegação até a aba de configurações.
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
