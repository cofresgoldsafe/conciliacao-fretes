# GEMINI.md — Memoria de Projeto & Diretrizes Operacionais

> **Versão da Documentação:** v8.257 (Homologada em 24/09/2026 17:58)  
> **Projeto:** Gemini-Cli (Hub de Integracoes Financeiras, Logistica, BI Executivo e ERP - Plataforma de Apoio GSI)  
> **Status:** Estável / Operacional em Produção (ARQUITETURA DOCUMENTAL HUB-AND-SPOKE)  
> **Data da Última Auditoria:** 24/09/2026 17:58 (v8.257 - Coluna Ação com Lápis e Lupa, Nome do Cliente, remoção de Contato e Navalha de Texto em Itens Cotados)  

---

## 1. Visao Geral e Dominio do Sistema

O **Gemini-Cli** (Portal GSI) e uma plataforma integrada de gestao operacional, financeira, logistica e inteligencia executiva do Grupo GSI (Cofres Gold Safe / Metal Pleno / OAÇO / GSI). O sistema atua como ponto central de orquestracao entre operacoes bancarias digitais (Banco Inter via API Pix/Webhooks com mTLS, Mercado Pago), processamento e conciliacao de fretes logisticos (Correios, Rodonaves, layouts customizados e ViPP), motor de analise de credito comercial e integracao direta com o ERP TOTVS Protheus via queries de alta performance e rotinas AdvPL (`AMARFRET.PRW`).

### Principais Personas Atendidas
- **Operador Financeiro / Controladoria:** Gestao de extratos, emissao de cobrancas Pix, conciliacao bancaria automatizada N:1 e 1:1, analise de credito com score auditavel, monitoramento de webhooks, contas a pagar multi-empresa e gestao fiscal de NFS-e.
- **Analista de Logistica / Expedicao:** Acompanhamento de pedidos para faturamento, gestao de bloqueios/liberacoes de estoque (SC9), parsing de faturas de transportadoras e geracao de amarracao contabil.
- **Equipe Comercial / Vendedores:** Acompanhamento de saldos fisicos PA multi-empresa, carteira de pedidos abertos, previsao de suprimentos (SC7) e apuracao analitica de comissoes.
- **Gestao de Compras / Suprimentos:** Monitoramento de ordens de compra em aberto com fornecedores, avaliacao de demanda comercial represada, ponto de pedido ideal e movimentacoes de estoque (SD3).
- **Diretoria / Gestao Executiva:** Painel de indices de liquidez, dashboards analiticos integrados no Metabase, governanca de descontos/frete embutido e acompanhamento de CRM Comercial.
- **Administrador do Sistema:** Controle central de acessos com RBAC granular, autenticacao em dois fatores (2FA), gestao de seguranca Zero-Trust e trilha de auditoria.

---

## 2. Stack Tecnologica e Arquitetura

- **Frontend:** SPA modular em Vanilla JavaScript ES6+ (`public/js/*.js` e `public/app.js`), HTML5 responsivo (`index.html`) e CSS com suporte a temas Claro e Escuro.
- **Backend & Integracao:** Node.js (Express) para orquestracao de APIs bancarias mTLS (`inter_api.js`), autenticacao JWT, rate limiting e endpoints REST seguros.
- **Processamento de Dados:** Python 3 (`pypdf`, parsers de frete Correios/Rodonaves/ViPP e extrator de relatorios Serasa em memoria sem gravacao em disco).
- **ERP Corporativo:** TOTVS Protheus AdvPL (`AMARFRET.PRW` / `REST_AMARFRET.PRW`) e consultas parametrizadas ao Protheus MSSQL (`protheus_db.js`).
- **Persistencia de Dados:**
  - *Relacional Transacional (ACID):* PostgreSQL hospedado no Supabase com Row-Level Security (RLS) habilitado e schemas segregados (`postgres_db.js`).
  - *Armazenamento de Apoio:* JSON locais serializados com fila assincrona FIFO e gravacao atomica (`safe_json_storage.js`).
- **APIs Conectadas:** Banco Inter (mTLS Banking v2, Pix, Webhooks), Mercado Pago, Receita Federal (BrasilAPI/ReceitaWS), Registro.br (RDAP), Wayback Machine, InfoSimples (FGTS/PGFN), Mailjet HTTP API v3.1 / SMTP, Metabase Analytics e Pipedrive CRM.

---

## 3. Matriz Geral de Navegação do Portal GSI

A matriz abaixo consolida as 9 macro-areas e as 38 sub-abas ativas no DOM do Portal GSI:

| Macro-Área | Sub-Aba / Tela | Identificador DOM | Perfil RBAC | Descrição Funcional | Documentação Detalhada |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Tarefas** | Painel de Tarefas | `#tab-minhas-tarefas` | Todos (`admin`, `user`, `vendedor`) | Central de tarefas e delegacao operacional com status, prioridades e comentarios JSONB. | [minhas_tarefas.md](docs/telas/01_tarefas/minhas_tarefas.md) |
| **2. Logística** | Ped. pra Faturar | `#tab-pedidos-faturar` | `admin`, `user` (Logística) | Acompanhamento de pedidos prontos para emissao de nota fiscal e faturamento. | [pedidos_faturar.md](docs/telas/02_logistica/pedidos_faturar.md) |
| **2. Logística** | Ped. Lib Estoque | `#tab-pedidos-lib-estoque` | `admin`, `user` (Logística) | Pedidos liberados no estoque fisico para fluxo de separacao e expedicao. | [pedidos_lib_estoque.md](docs/telas/02_logistica/pedidos_lib_estoque.md) |
| **2. Logística** | Ped. Bloq Estoque | `#tab-pedidos-bloq-estoque` | `admin`, `user` (Logística) | Monitoramento de pedidos com pendencia de saldo ou bloqueio SC9 no Protheus. | [pedidos_bloq_estoque.md](docs/telas/02_logistica/pedidos_bloq_estoque.md) |
| **2. Logística** | Saldos em Estoque | `#tab-vend-saldos-estoque` | `admin`, `user` (Logística) | Saldos fisicos PA multi-empresa (14, 15, 16) com KPIs, filtros e drilldown. | [saldos_estoque.md](docs/telas/04_vendedores/saldos_estoque.md) |
| **2. Logística** | Salvar XMLs Faturamento | `#tab-log-xml-faturamento` | `admin`, `logistica`, `analista-fin` | Salvamento direto de XMLs soltos no Google Drive via File System Access API e Job das 18h. | [xmls_faturamento.md](docs/telas/02_logistica/xmls_faturamento.md) |
| **2. Logística** | Upload Fatura Transp. | `#tab-upload` | `admin`, `user` (Logística) | Upload e parsing de faturas de frete de transportadoras rodoviarias parceiras. | [upload_fatura.md](docs/telas/02_logistica/upload_fatura.md) |
| **2. Logística** | Fatura Correios & ViPP | `#tab-correios` | `admin`, `user` (Logística) | Conciliacao de faturas Correios e plataforma ViPP com batimento de postagens. | [correios_vipp.md](docs/telas/02_logistica/correios_vipp.md) |
| **3. Busca Multi-Empresa** | Consulta NFe ou Pedido | `#tab-consulta` | `admin`, `user` (Consulta) | Busca por CodWeb Pipedrive, Pedido Protheus, NF ou Cliente com enriquecimento de datas. | [busca_codweb_ped_nf.md](docs/telas/03_busca/busca_codweb_ped_nf.md) |
| **4. Vendedores** | Saldos em Estoque | `#tab-vend-saldos-estoque` | `admin`, `vendedor`, `user` | Visao de saldos PA com selecao de filial, disponibilidade e exportacao CSV. | [saldos_estoque.md](docs/telas/04_vendedores/saldos_estoque.md) |
| **4. Vendedores** | Consulta Ped Venda | `#tab-vend-pedidos` | `admin`, `vendedor`, `user` | Pesquisa de pedidos de venda (`SC5`/`SC6`), condicoes de pagamento e itens. | [consulta_ped_venda.md](docs/telas/04_vendedores/consulta_ped_venda.md) |
| **4. Vendedores** | Ped Vendas Abertos | `#tab-vend-pedidos-abertos` | `admin`, `vendedor`, `user` | Carteira de pedidos abertos com status de bloqueio SC9 e integracao Pipedrive. | [pedidos_abertos.md](docs/telas/04_vendedores/pedidos_abertos.md) |
| **4. Vendedores** | Prod x Ped Compras | `#tab-vend-pedidos-compras` | `admin`, `vendedor`, `user` | Consulta de ordens de compra em aberto (`SC7`) de produtos PA e previsao de chegada. | [pedidos_compras.md](docs/telas/04_vendedores/pedidos_compras.md) |
| **4. Vendedores** | Consulta Ped/NF Compras | `#tab-compras-consulta-ped-nf` | `admin`, `vendedor`, `user` | Consulta direta de compras e NFs de entrada por pedido, NF ou fornecedor (90 dias). | [consulta_ped_nf_compras.md](docs/telas/05_compras/consulta_ped_nf_compras.md) |
| **4. Vendedores** | Comissões | `#tab-vend-comissoes` | `admin`, `vendedor`, `user` | Apuracao analitica de comissoes SE3 por vendedor e metas proporcionais. | [comissoes.md](docs/telas/04_vendedores/comissoes.md) |
| **4. Vendedores** | Gordura Frete | `#tab-vend-gordura-frete` | `admin`, `vendedor`, `user` | Apuracao de margem e sobrepreco embutido de frete negociado vs custo de tabela. | [gordura_frete.md](docs/telas/04_vendedores/gordura_frete.md) |
| **4. Vendedores** | Fechamento | `#tab-vend-fechamento` | `admin`, `vendedor`, `user` | Resumo de fechamento mensal comercial consolidado por vendedor e filial. | [fechamento.md](docs/telas/04_vendedores/fechamento.md) |
| **5. Compras** | Saldos em Estoque | `#tab-vend-saldos-estoque` | `admin`, `user` (Compras) | Saldos para planejamento de reposicao de estoque multi-empresa (DRY). | [saldos_estoque.md](docs/telas/04_vendedores/saldos_estoque.md) |
| **5. Compras** | Consulta Ped Venda | `#tab-vend-pedidos` | `admin`, `user` (Compras) | Avaliacao de demanda comercial de vendas para compras de insumos (DRY). | [consulta_ped_venda.md](docs/telas/04_vendedores/consulta_ped_venda.md) |
| **5. Compras** | Ped Vendas Abertos | `#tab-vend-pedidos-abertos` | `admin`, `user` (Compras) | Pedidos represados por falta de saldo para priorizacao de reposicao (DRY). | [pedidos_abertos.md](docs/telas/04_vendedores/pedidos_abertos.md) |
| **5. Compras** | Ped Compras em Aberto | `#tab-compras-pedidos-abertos` | `admin`, `user` (Compras) | Gestao de ordens de compra SC7 com saldo pendente nas filiais 14, 15 e 16. | [pedidos_compras_abertos.md](docs/telas/05_compras/pedidos_compras_abertos.md) |
| **5. Compras** | Prod x Ped Compras | `#tab-vend-pedidos-compras` | `admin`, `user` (Compras) | Relacao de produtos acabados com ordens de compra vigentes (DRY). | [pedidos_compras.md](docs/telas/04_vendedores/pedidos_compras.md) |
| **5. Compras** | Ponto de Pedido Ideal | `#tab-compras-ponto-pedido` | `admin`, `user` (Compras) | Calculo estatistico de consumo medio diario, lead time e ressuprimento. | [ponto_pedido_ideal.md](docs/telas/05_compras/ponto_pedido_ideal.md) |
| **5. Compras** | Consulta Ped/NF Compras | `#tab-compras-consulta-ped-nf` | `admin`, `user` (Compras) | Busca multi-empresa por Pedido, NF de Entrada, Fornecedor e Razao Social. | [consulta_ped_nf_compras.md](docs/telas/05_compras/consulta_ped_nf_compras.md) |
| **5. Compras** | Movimentações do Estoque | `#tab-compras-movimentacoes-estoque` | `admin`, `user` (Compras) | Extrato historico de entradas, saidas, requisicoes e transferencias SD3. | [movimentacoes_estoque.md](docs/telas/05_compras/movimentacoes_estoque.md) |
| **6. Assist. Financ.** | Conciliação Bancária | `#tab-conciliacao-bancaria` | `admin`, `user` (Financeiro) | Conciliacao automatica N:1 e 1:1 entre extratos e titulos Protheus (`SE5`/`SE8`). | [conciliacao_bancaria.md](docs/telas/06_assist_financeiro/conciliacao_bancaria.md) |
| **6. Assist. Financ.** | Extrato API Inter | `#tab-inter-extrato` | `admin`, `user` (Financeiro) | Conexao ao vivo mTLS de saldos, extratos e batimento financeiro Banco Inter. | [extrato_api_inter.md](docs/telas/06_assist_financeiro/extrato_api_inter.md) |
| **6. Assist. Financ.** | Webhooks Pix Inter | `#tab-inter-webhooks` | `admin`, `user` (Financeiro) | Receptor de notificacoes Pix instantaneas com chave de deduplicacao idempotente. | [webhooks_pix_inter.md](docs/telas/06_assist_financeiro/webhooks_pix_inter.md) |
| **6. Assist. Financ.** | Análise de Crédito | `#tab-analise-credito` | `admin`, `user` (Financeiro) | Motor de score com Protheus, Receita, RDAP, Wayback, Serasa e InfoSimples. | [analise_credito.md](docs/telas/06_assist_financeiro/analise_credito.md) |
| **6. Assist. Financ.** | Contas a Pagar | `#tab-contas-pagar` | `admin`, `user` (Financeiro) | Consulta de Contas a Pagar SE2/SE5 multi-empresa com batimento de baixas (DRY). | [contas_pagar.md](docs/telas/07_analista_fin/contas_pagar.md) |
| **7. Analista Fin.** | Holerites DP | `#tab-holerites` | `admin`, `user` (Analista Fin) | Emissao e distribuicao digital de holerites do Departamento Pessoal. | [holerites_dp.md](docs/telas/07_analista_fin/holerites_dp.md) |
| **7. Analista Fin.** | Cadastro Funcion. | `#tab-funcionarios` | `admin`, `user` (Analista Fin) | Manutencao cadastral de colaboradores, cargos, salarios e chaves Pix. | [cadastro_funcionarios.md](docs/telas/07_analista_fin/cadastro_funcionarios.md) |
| **7. Analista Fin.** | NFS-e Pendentes | `#tab-nfse-pendentes` | `admin`, `user` (Analista Fin) | Gestao fiscal de NFS-e recebidas com conciliacao automatica Protheus SF1. | [nfse_pendentes.md](docs/telas/07_analista_fin/nfse_pendentes.md) |
| **7. Analista Fin.** | Fechamento Fiscal | `#tab-fechamento-fiscal` | `admin`, `user` (Analista Fin) | Fechamento fiscal periodico, livros de entrada/saida e validacoes de impostos. | [fechamento_fiscal.md](docs/telas/07_analista_fin/fechamento_fiscal.md) |
| **7. Analista Fin.** | Auditoria Protheus x Sefaz | `#tab-auditoria-protheus-sefaz` | `admin`, `user` (Analista Fin) | Batimento fiscal com distincao estrita de CC-e (`tpEvento 110110`) e Inutilizacoes. | [auditoria_protheus_sefaz.md](docs/telas/07_analista_fin/auditoria_protheus_sefaz.md) |
| **7. Analista Fin.** | Contas a Pagar | `#tab-contas-pagar` | `admin`, `user` (Analista Fin) | Consulta unificada de Contas a Pagar SE2/SE5 multi-empresa com batimento financeiro vs compensação. | [contas_pagar.md](docs/telas/07_analista_fin/contas_pagar.md) |
| **8. BI Executivo** | Índices Financeiros | `#tab-bi-indices` | `admin`, `diretoria` (BI) | KPIs executivos de liquidez (Corrente, Seca, Geral) e saude patrimonial. | [indices_financeiros.md](docs/telas/08_bi_executivo/indices_financeiros.md) |
| **8. BI Executivo** | Despesas Análise | `#tab-bi-despesas` | `admin`, `diretoria` (BI) | Espelho SE5 multi-empresa com classificação por natureza, estornos negativos e comparativo 2025x2026. | [despesas_analise.md](docs/telas/08_bi_executivo/despesas_analise.md) |
| **8. BI Executivo** | Gráficos & Tendências | `#tab-bi-metabase` | `admin`, `diretoria` (BI) | Dashboards incorporados do Metabase Analytics sobre data warehouse Supabase. | [graficos_metabase.md](docs/telas/08_bi_executivo/graficos_metabase.md) |
| **8. BI Executivo** | Autorizações de Desconto | `#tab-bi-autorizacoes` | `admin`, `diretoria` (BI) | Workflow de liberacao executiva de margem, frete embutido e descontos fora de alcada. | [autorizacoes_desconto.md](docs/telas/08_bi_executivo/autorizacoes_desconto.md) |
| **8. BI Executivo** | CRM Comercial | `#tab-bi-crm` | `admin`, `diretoria` (BI) | Pipeline comercial em Kanban ou Listagem tabular com 10 colunas, paginação e follow-up. | [crm_comercial.md](docs/telas/08_bi_executivo/crm_comercial.md) |
| **9. Configurações** | Usuários & Permissões | `#tab-configuracoes` | `admin` exclusivo | Gestao de contas, senhas bcrypt, permissoes RBAC, e-mails e 2FA. | [usuarios_permissoes.md](docs/telas/09_configuracoes/usuarios_permissoes.md) |
| **9. Configurações** | Atividades & Auditoria | `#tab-config-logs` | `admin` exclusivo | Trilha de auditoria em tempo real (`user_activities`), sessoes e heartbeats. | [atividades_auditoria.md](docs/telas/09_configuracoes/atividades_auditoria.md) |
| **9. Configurações** | Configuração do Score | `#tab-config-score` | `admin` exclusivo | Calibracao dos pesos parametricos e limites do motor de Score em 6 blocos. | [config_score.md](docs/telas/09_configuracoes/config_score.md) |
| **9. Configurações** | Metas de Vendas | `#tab-config-metas-vendas` | `admin` exclusivo | Parametrizacao de metas mensais por vendedor, piso/teto e comissoes. | [metas_vendas.md](docs/telas/09_configuracoes/metas_vendas.md) |

---

## 4. Diretrizes Mandatórias de Engenharia de Software

### Pilar 1: Paginação Compulsória em Todas as Consultas e Buscas
1. **Sem Consultas Irrestritas:** Nenhuma rota de API ou query em banco relacional pode retornar dados sem limites e paginacao controlados no servidor.
2. **Envelope REST Padronizado:**
   ```json
   {
     "items": [ ... ],
     "pagination": {
       "page": 1,
       "limit": 50,
       "total": 1240,
       "totalPages": 25,
       "hasNext": true
     }
   }
   ```
3. **Estratégia Keyset vs Offset:** Listagens administrativas usam `LIMIT/OFFSET`. Tabelas de alto volume ou logs usam Keyset/Cursor (`WHERE id < :cursor ORDER BY id DESC LIMIT 50`) com tempo de resposta constante $O(1)$.
4. **Proteção de `COUNT(*)`:** Em tabelas volumosas do Protheus, desacoplar a contagem ou empregar estimativas para resposta instantanea na primeira pagina.
5. **Componentização Frontend:** Controles reutilizaveis de paginacao com navegadores, seletor de itens por pagina e resumo visual.

### Pilar 2: Indexação Estratégica Obrigatória em Banco de Dados
1. **Índices Orientados a Padrões de Acesso:** Toda tabela relacional de producao deve possuir indices B-Tree cobrindo colunas em `WHERE`, `JOIN`, `ORDER BY` e chaves estrangeiras (`FK`).
2. **Índices Compostos e Parciais:** Ordem de colunas orientada pela seletividade. No PostgreSQL Supabase, priorizar indices parciais (`WHERE status <> 'FINALIZADO'`) para economizar memoria RAM.
3. **Harmonização com ERP Protheus:** Respeitar indices nativos do dicionario `SIX` e chaves de recno (`R_E_C_N_O_`), sem criar indices concorrentes que colidam com releases (`APSRDU`/`UPDISTR`).

### Pilar 3: Modularização e Separação de Código (>1 View / Telas Complexas)
1. **Fim dos Monólitos:** Proibido acumular regras de multiplas telas em arquivos unicos. Toda divisao com mais de uma view deve ser decomposta em submodulos verticais.
2. **Padrão Vertical Slice:** Segregacao funcional em `public/js/` (`credito.js`, `vendedores.js`, `financeiro.js`, `logistica.js`, `config.js`).
3. **ES Modules Nativos:** Uso de `<script type="module">` com isolamento de escopo sem poluir o objeto `window`.
4. **Ciclo de Vida Limpo:** Cada view exporta metodos explicitos de montagem (`initView`) e desmontagem/limpeza de memoria (`destroyView`).
5. **Backend Modular:** Rotas Express em controllers dedicados (`routes/*.js`), mantendo `server.js` como orquestrador e bootstrap.

### Diretrizes de Segurança, Qualidade e I/O
- **Codificação UTF-8 Obrigatória:** Manipulacoes de arquivo e I/O (Node.js, Python, PowerShell) devem forcar UTF-8 estrito (`encoding='utf-8'`, `-Encoding utf8`, `utf8`).
- **Segurança Zero-Trust:** Validacao de autorizacao no servidor com JWT assinado e RBAC (`requireRole`). Sanitizar inputs contra SQLi e escapar outputs via `escapeHtml()`. Restringir envio de credenciais a origens `same-origin`.
- **Atualização Compulsória de Versão (`bump_version`):** Apos qualquer entrega, rodar `node bump_version.js "<descricao>"` para atualizar a tag de versao e cache buster (`?v=X.XX`) em `index.html`.
- **Validação de Sintaxe JS:** Compulsorio rodar `node -c public/app.js` e scripts alterados antes de commits.

---

## 5. Matriz FMEA de Resiliência & Faróis SRE

Tratamento formal de contingencia e comportamento fail-neutral dos servicos externos integrados:

| Serviço / Provedor | Timeout | Comportamento em Falha / Queda | Score (Fail-Neutral) | Farol SRE | Ação Operacional Exigida |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Receita Federal** *(BrasilAPI / ReceitaWS)* | 8.000 ms | Fallback automatico BrasilAPI ➔ ReceitaWS. Se ambas falharem: `receita_offline = true`. | `0 pts` (Sem penalidade) | 🔴 Vermelho (`farol-error`) | Exibe banner `RECEITA OFFLINE` e orienta conferencia manual de cadastro. |
| **Registro.br (RDAP)** *(NIC.br)* | 6.000 ms | Captura erro de socket/timeout e marca `idade_dominio_rdap_erro = true`. | `0 pts` (Elimina perda de 7 pts) | 🔴 Vermelho / 🟡 Alerta | Registra `Indisponível (Registro.br)` no campo de maturidade. |
| **Wayback Machine** *(Archive.org)* | 5.000 ms | Captura erro HTTP ou timeout e seta `wayback_offline = true`. | `0 pts` (Neutro) | 🔴 Vermelho / 🟡 Alerta | Exibe `Indisponível (Archive.org)` sem impactar pontuacao. |
| **Servidor MX** *(DNS)* | 5.000 ms | Trata `SERVFAIL`/`ETIMEOUT` e seta `servidor_mx_offline = true`. | `0 pts` (Elimina perda de 4 pts) | 🔴 Vermelho | Informa `Falha DNS` sem presumir inexistencia do dominio. |
| **FGTS Caixa** *(InfoSimples)* | 25.000 ms | Retorna `executado = false` com motivo descritivo retornado pelo gateway. | `0 pts` (Neutro) | 🟡 Alerta / 🔵 Info | Badge descritivo amarelo (`Timeout Caixa`, etc.) sem descarte. |
| **PGFN Dívida Ativa** *(InfoSimples)* | 25.000 ms | Retorna `executado = false` com detalhamento retornado pela consulta. | `0 pts` (Neutro) | 🟡 Alerta / 🔵 Info | Badge descritivo amarelo/vermelho sem penalizar pontuacao. |
| **Bolsa Família** *(InfoSimples)* | 25.000 ms | Captura timeouts ou quedas e seta `status = 'ERRO_TECNICO'`. | `0 pts` (Neutro) | 🟡 Alerta / 🔵 Info | Trata como neutro sem penalizar cliente por falhas técnicas de rede. |
| **TOTVS Protheus** *(Railway Relay)* | 15.000 ms | Distingue `404` (inexistente) de instabilidade de infraestrutura `500/504`. | N/A (Bloqueia consulta) | 🔴 Vermelho (`farol-error`) | Banner de erro de rede sem induzir operador a crer em erro de digitacao. |
| **Parser Serasa PDF** *(Python)* | 15.000 ms | Mata subprocesso Python com `SIGKILL` apos 15s em travamentos. | N/A | N/A | Exibe mensagem orientando reenvio de PDF integro. |

---

## 6. Protocolo de Documentação para o `/fui` & Agentes de IA

Para manter a documentacao do ecossistema limpa, leve e modularizada, desenvolvedores e agentes de IA devem seguir este protocolo:

1. **Preservação do `GEMINI.md` Pai Enxuto (< 25 KB):**
   - O `GEMINI.md` na raiz e o guia master de alto nivel (arquitetura, seguranca, navegacao, SRE e governanca).
   - **É estritamente proibido** adicionar changelogs detalhados, payloads extensos ou regras especificas de uma tela neste arquivo.
2. **Atualização Descentralizada em `docs/telas/`:**
   - Ao alterar ou criar fluxos funcionais, documentar detalhes tecnicos, DOM IDs, endpoints e regras no arquivo correspondente em `docs/telas/` (ex: `docs/telas/04_vendedores/saldos_estoque.md`).
3. **Preservação do Histórico Completo em `docs/legado/`:**
   - O historico detalhado dos 77 itens concluidos do backlog e versoes legadas esta mantido em [`docs/legado/GEMINI_HISTORICO.md`](docs/legado/GEMINI_HISTORICO.md).
4. **Checklist Obrigatório de Conclusão (`/fui`):**
   - [ ] Validar sintaxe JavaScript: `node -c public/app.js` e scripts alterados.
   - [ ] Executar suite de testes pertinentes (`npm test`).
   - [ ] Executar bump de versao: `node bump_version.js "<resumo conciso da entrega>"`.
   - [ ] Atualizar status em `TODO.md`.
   - [ ] Documentar especificidades no arquivo da tela em `docs/telas/`.
   - [ ] Registrar apenas 1 a 2 linhas executivas na Secao 7 deste `GEMINI.md`.
5. **Garantia de UTF-8:**
   - Garantir gravacao em disco em UTF-8 puro, sem caracteres corrompidos.

---

## 7. Changelog Executivo Recente

> O historico detalhado dos 77 itens tecnicos concluidos, refatoracoes de seguranca e entregas anteriores esta arquivado em:  
> 🔗 [**docs/legado/GEMINI_HISTORICO.md**](docs/legado/GEMINI_HISTORICO.md)

### Versões Recentes Homologadas:
- **v8.257 (24/09/2026):** Reformulação da tabela de Oportunidades do CRM e aplicação da Navalha de Texto: criação da coluna "Ação" em 1º lugar com botões de Lápis `✏️` (abre edição) e Lupa `🔍` (abre visualização), renomeação da coluna "Organização" para "Nome do Cliente", eliminação da coluna "Contato" e remoção da exibição do rótulo desnecessário "UM: UN" nos itens de propostas e produtos cotados (7 testes aprovados em `test_crm_listagem.js` — detalhado em [crm_comercial.md](docs/telas/08_bi_executivo/crm_comercial.md)).
- **v8.256 (24/09/2026):** Espelhamento Just-in-Time (*under-the-hood*) de clientes Protheus (`SA1010`) para o Super Banco (`crm_clientes`) sem escrita no Protheus. Novos botões de ação rápida no CRM (`#btnCrmEditarClienteFromDeal` e `#btnCrmEditarClienteDoDetalhes`), botão renomeado para "➕ Add Cliente", resolução multi-chave por ID, código (pad 6 dígitos) e CNPJ, tradução de vendedor e sincronização reativa com o deal (13 testes aprovados em `test_crm_clientes.js` e 10 em `test_crm_module.js` — detalhado em [crm_comercial.md](docs/telas/08_bi_executivo/crm_comercial.md)).
- **v8.255 (24/09/2026):** Ordenação estritamente decrescente na Linha do Tempo e Follow-up de Atividades (`#crmActivitiesTimeline`). Algoritmo central `sortActivitiesDesc` por timestamp (`dateB - dateA`) com desempate determinístico por ID, autocura de registros do `localStorage`, ordenação defensiva em todas as camadas e desempate no Postgres/fallback local (10 testes aprovados em `test_crm_module.js` — detalhado em [crm_comercial.md](docs/telas/08_bi_executivo/crm_comercial.md)).
- **v8.254 (24/09/2026):** Catálogo de Produtos Protheus (`SB1090`/`SB1160`) espelhado no Supabase PostgreSQL (`crm_produtos`) e cache local de contingência (`crm_produtos_cache.json` com 1.883 produtos reais). Autocomplete inteligente (< 10ms) na tabela de itens cotados do modal de oportunidades, preenchimento automático de código, descrição, preço de tabela, NCM fiscal (`B1_POSIPI`), peso líquido/bruto (`B1_PESO`/`B1_PESBRU`) e UM, cálculo em tempo real de Peso Total da Proposta (`Σ qtd * peso`), botão `🔄 Sync Produtos` sob demanda e RLS restrita (7 baterias completas aprovadas em `test_crm_produtos.js` — detalhado em [crm_comercial.md](docs/telas/08_bi_executivo/crm_comercial.md) e [crm_produtos_arquitetura.md](docs/telas/08_bi_executivo/crm_produtos_arquitetura.md)).
- **v8.253 (24/09/2026):** Novos filtros de status e proprietário no CRM Comercial (`#tab-bi-crm`): remoção de "Diretoria" do filtro de vendedores operacionais, renomeação de "Oportunidades Ativas" para "Oportunidades Abertas" (excluindo ganhos e perdidos), inclusão dos filtros "Somente Ganhas", "Ganhas Hoje" e "Ganhas Ontem" com tratamento imune a Timezone Shift UTC-3 (ISO e DateOnly), reset para "ABERTAS" no botão limpar e acessibilidade `aria-label` (10 testes aprovados em `test_crm_filtros.js` — detalhado em [crm_comercial.md](docs/telas/08_bi_executivo/crm_comercial.md)).
- **v8.252 (24/09/2026):** Correção da detecção de bloqueios SC9 em `formatBadgeBloqCredito` e `formatBadgeBloqEstoque` e estilização de badges liberados ("SEM BLOQ") com fundo verde claro (`#dcfce7`) e letra verde escuro (`#14532d`), mantendo vermelho para bloqueio de crédito e amarelo para bloqueio de estoque (20 testes aprovados em `test_pedidos_abertos.js` — detalhado em [pedidos_abertos.md](docs/telas/04_vendedores/pedidos_abertos.md)).
- **v8.251 (24/09/2026):** Implementação da visualização em **Listagem** com alternância Kanban x Tabela no CRM Comercial (`#tab-bi-crm`), persistência em `localStorage`, tabela paginada com 10 colunas canônicas alinhadas ao `listagem.png`, thead sticky, sanitização XSS e preservação de campos `faturadoPor` e `contatoNome` (6 baterias funcionais aprovadas em `test_crm_listagem.js` — detalhado em [crm_comercial.md](docs/telas/08_bi_executivo/crm_comercial.md)).
- **v8.250 (23/09/2026):** Inclusão da sub-tela `Despesas Análise` no BI Executivo (`#tab-bi-despesas`) com espelhamento SE5 multi-empresa (14, 15, 16) desde Jan/2025, enriquecimento hierárquico por Natureza Financeira SED010 (Pai/Filho), dedução matemática de estornos (`-valor`), segregação de transferências internas/CDBs (2.10/TR/TE), comparativo mensal 2025 vs 2026 lado a lado, sincronização inteligente com janela retroativa de 10 dias e exportação CSV sanitizada (15 testes aprovados em `test_bi_despesas.js` — detalhado em [despesas_analise.md](docs/telas/08_bi_executivo/despesas_analise.md)).
- **v8.247 (22/09/2026):** Homologação ao vivo da API InfoSimples Bolsa Família com chave real: ajuste do endpoint oficial para `portal-transparencia/bolsa`, inclusão do parâmetro obrigatório de data com janela de até 12 meses (`data_inicio` e `data_fim` ISO YYYY-MM-DD), reconhecimento nativo do Código 612 como `NADA_CONSTA` e exportação de `consultarBolsaFamiliaInfoSimples` e `validarCpf` em `server.js` (homologado em tempo real com CPF 273.897.148-24).
- **v8.246 (22/09/2026):** Extração de quadro societário e CPFs de sócios/administradores do laudo Serasa Experian PDF (100% RAM stream via `serasa_pdf_parser.py`); integração com a API `portal-transparencia-bolsa` da InfoSimples para antifraude de sócios laranjas (-25 pts com validação prévia Módulo 11 anti-erro 606); suporte neutro (0 pts) a empresas públicas e S.A. sem sócios PF; integração de Inscrição Estadual (Ativa +2 pts, Inapta -15 pts, Isenta 0 pts neutro); calibração dinâmica dos 7 pesos em `#tab-config-score` e backtest com 100% de aprovação (detalhado em [analise_credito.md](docs/telas/06_assist_financeiro/analise_credito.md)).
- **v8.244 (22/09/2026):** Tratamento especializado do Código 620 da InfoSimples (`permanent_error` na Caixa Econômica Federal) e Fallback Automático para CNPJ Matriz no FGTS Caixa (`consultarFgtsInfoSimples`). Filiais com recolhimento de FGTS centralizado na matriz (como filial 0321 do Madero) agora consultam e herdam a certidão CRF da matriz (`0001`), e empresas sem cadastro de FGTS passam a ser categorizadas como `ALERTA` (amarelo, `NE`) em vez de erro técnico de sistema (homologado com testes aprovados em `test_infosimples_620_matriz.js` e na suíte `test_infosimples_fgts.js` — detalhado em [analise_credito.md](docs/telas/06_assist_financeiro/analise_credito.md)).
- **v8.243 (22/09/2026):** Motor Dual-Engine no Wayback Machine (`consultarWayback`) com priorização da API CDX Server (`web.archive.org/cdx/search/cdx`), imune ao rate limit 429 de `/wayback/available` e com fallback secundário automático, garantindo identificação do primeiro snapshot real na Análise de Crédito (`#tab-analise-credito`). Categorização explícita de servidores corporativos de e-mail Sophos como `PREMIUM` (`Sophos Email Security`) em `consultarMx`, eliminando hostnames brutos no Farol MX (homologado com sucesso na suíte de testes de resiliência e maturidade digital — detalhado em [analise_credito.md](docs/telas/06_assist_financeiro/analise_credito.md)).
- **v8.242 (22/09/2026):** Consolidação de Histórico Financeiro em `SE1` por Raiz de CNPJ (8 dígitos) e CPF (11 dígitos) na Análise de Crédito (`#tab-analise-credito`), unificando todos os códigos de cliente (`A1_COD`) em `SA1010` da mesma matriz/filiais em `SE1090`, `SE1140`, `SE1150` e `SE1160` em paralelo via `Promise.all`. Expurgo de compras com parcelas abertas, deduplicação por documento contábil e correção dos campos "Comprou e Pagou 2x+ (+pts)", "Comprou < 2x (-pts)" e "Comprou e Pagou 5x+ (+pts)" (homologado no pedido #000822 empresa 16 Madero: consolidou 10 compras pagas de R$ 170.484,12 e bonificação de +32 pts em vez de penalidade de -3 pts, ganho líquido de +35 pts de score, com 17 testes aprovados em `test_cnpj_matriz_fundacao.js` — detalhado em [analise_credito.md](docs/telas/06_assist_financeiro/analise_credito.md)).
- **v8.241 (22/09/2026):** Resolução automática de CNPJ Matriz via Módulo 11 da RFB e data de fundação matriz na Análise de Crédito (`#tab-analise-credito`), corrigindo a apuração de idade de filiais recém-abertas para a fundação original da matriz (homologado no pedido #000822 empresa 16 Madero, revertendo penalização de -6 pts para pontuação real de +4 pts, com cache de 1h e 15 testes aprovados em `test_cnpj_matriz_fundacao.js` — detalhado em [analise_credito.md](docs/telas/06_assist_financeiro/analise_credito.md)).
- **v8.240 (18/09/2026):** Correção de impressão e exportação em PDF de holerites/recibos (`#modalHoleritePreview`, `#btnImprimirModalHolerite`), eliminando a tela em branco e a 2ª página vazia através de isolamento `@media print`, eliminação de `break-after` órfão no último item e visibilidade ativa com suporte a lotes (4 testes aprovados em `test_holerites_impressao.js` — detalhado em [holerites_dp.md](docs/telas/07_analista_fin/holerites_dp.md)).
- **v8.239 (18/09/2026):** Emissão Manual PF na tela Holerites DP (`#btnManualPfHolerite`, `#modalHoleriteManualPf`) para colaboradores sem registro (13º 1ª e 2ª parc, salário, adiantamento, férias, etc.), gerando recibos limpos sem logos corporativos e sem CNPJ, com valor por extenso, quitação formal e integração à base de colaboradores (4 novos testes e 25 da suíte holerites aprovados — detalhado em [holerites_dp.md](docs/telas/07_analista_fin/holerites_dp.md)).
- **v8.238 (18/09/2026):** Nova tela de Consulta de Contas a Pagar com acesso duplo em Assist. Financ. e Analista Fin (`#tab-contas-pagar`) sobre SE2140/150/160, batimento de baixas financeiras (SE5 com banco) vs compensações de carteira (PA/CMP/DEV), paginação no servidor, KPIs e modal de histórico detalhado (13 testes aprovados em `test_contas_pagar.js` — detalhado em [contas_pagar.md](docs/telas/07_analista_fin/contas_pagar.md)).
- **v8.237 (18/09/2026):** Unificação de autenticação Cron externa (GitHub Actions / Webhooks) via validador de tempo constante (`validarSegredoCron` com `crypto.timingSafeEqual`) e fallback automático para o segredo canônico compartilhado (`CANONICAL_CRON_SECRET`), eliminando o erro HTTP 403 no agendamento do job `sync-nfe-central` e no fechamento mensal mesmo sem a variável `CRON_SECRET` configurada no Render (14 testes aprovados em `test_cron_fechamento.js` — detalhado em [fechamento_fiscal.md](docs/telas/07_analista_fin/fechamento_fiscal.md)).
