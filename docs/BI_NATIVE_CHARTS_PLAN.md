# Plano de Implementação: Gráficos Nativos no BI Executivo (Substituição Metabase)

> **Módulo:** 📊 BI EXECUTIVO -> Sub-aba 📈 Gráficos & Tendências (Substituição de Metabase Iframe)  
> **Objetivo:** Eliminar de forma definitiva os erros de *Embedding Secret Key* e dependência de contêiner externo (Metabase no Render), implementando visualização gráfica executiva nativa em HTML5 Canvas com **Chart.js**.

---

## 1. Contexto e Justificativa Arquitetural
A sub-aba *Metabase Analytics* enfrentava recorrentemente o erro `The embedding secret key has not been set`. Esse erro decorre do ciclo de vida volátil do contêiner Docker do Metabase hospedado no Render, que consome 1 a 2 GB de RAM e perde suas variáveis internas de incorporação ao reiniciar sem armazenamento permanente.

Além disso, a demanda do usuário é cirúrgica:
- **Hoje:** Gráfico de linha interativo e responsivo (série histórica de Liquidez e Finanças).
- **Futuro:** Gráficos de colunas/barras (comparativo entre empresas e meses).

Ao adotar **Chart.js** nativo:
- **Zero latência:** O gráfico carrega em milissegundos.
- **Zero instabilidade:** Não depende de terceiros ou contêineres externos.
- **Visual integrado:** Compatibilidade nativa com tema claro e escuro.
- **Custo zero de servidor:** Executado 100% no navegador do cliente consumindo as APIs REST já existentes no backend Node.js (`/api/bi/indices/historico`).

---

## 2. Escopo da Solução

### 2.1 Componentes e Arquitetura
1. **Biblioteca Gráfica Local (`public/js/chart.umd.min.js`):**
   - Vendor local da versão 4.4.x do Chart.js para eliminar dependência de CDN externa.
   - Importação no `public/index.html` com versionamento de cache (`?v=8.216`).

2. **Frontend UI (`public/index.html` & `public/style.css`):**
   - Sub-aba atualizada: `📈 Gráficos & Tendências` (mantendo seletor `#tab-bi-metabase` para compatibilidade).
   - Barra de Filtros e Controles:
     - **Métricas:** *Índices de Liquidez (LC, LS, LI)*, *Ativo vs Passivo Circulante*, *Disponibilidades & Recebíveis*.
     - **Empresa:** *Consolidado (ALL)*, *Metal Pleno (14)*, *GSI (15)*, *OACO (16)*.
     - **Período:** *7 dias*, *30 dias*, *90 dias*, *Todos*.
     - **Tipo de Gráfico:** Alternância instantânea entre *📈 Linha* e *📊 Coluna/Barras*.
   - Área do Gráfico: `<canvas id="biExecutiveChart">` em container responsivo.
   - Mini Cards de KPIs no topo do gráfico com os valores do snapshot mais recente.
   - Botões de Ação mantidos: `📊 Sync Índices`, `📥 Sync Faturamento`, `🔄 Atualizar`, `↗️ Abrir Metabase Externo` e `⛶ Tela Cheia`.

3. **Controlador Frontend (`public/js/bi.js`):**
   - Módulo encapsulado (IIFE) gerenciando o ciclo de vida do gráfico.
   - Chamada assíncrona para `/api/bi/indices/historico`.
   - Renderização dinâmica com suporte a gradientes, tooltips formatados (moeda `R$` e índices `0,0000`).
   - Detecção reativa de mudança de tema (claro/escuro) com re-renderização automática de cores de grid e eixos.

4. **Backend (`server.js` & `bi_indices_engine.js`):**
   - Ajustes de flexibilidade em `/api/bi/indices/historico` para garantir suporte a filtros multi-empresa e ordenação temporal consistente.

---

## 3. Critérios Verificáveis de Aceite
- [ ] Script `public/js/chart.umd.min.js` baixado e referenciado localmente sem erros de MIME type.
- [ ] Gráfico de Linha renderizado com sucesso na abertura da sub-aba.
- [ ] Alternância para Gráfico de Coluna/Barras funcionando instantaneamente.
- [ ] Filtro por Empresa (Consolidado, MP, GSI, OACO) e Período (7d, 30d, 90d) recalculando e atualizando a tela sem refresh.
- [ ] Compatibilidade com tema escuro e tema claro comprovada.
- [ ] Testes automatizados em `test_bi_embed.js` executados e 100% aprovados.
