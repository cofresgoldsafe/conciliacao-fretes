# CRM Comercial B2B (Sub-aba: `💼 CRM`)

> **Macro-Área:** BI Executivo / Comercial  
> **Identificador DOM:** `#tab-bi-crm` | **Botões:** `#btnTabBiCrm` (`💼 CRM`) e `#mainTabCrm` (`💼 CRM COMERCIAL`)  
> **Permissão RBAC:** `admin`, `diretoria` (visão global) e `vendedor` com permissão `'crm'` + vínculo ativo em `crm_vendedores` (escopo restrito ao próprio `cod_vendedor`)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 14/11/2026 (v8.324 - CRM-21a Integração com o WhatsApp Multi360, lado do portal)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Pipeline comercial nativo de vendas, alternância flexível entre modo **Kanban** (5 fases canônicas: Lead, Contato, Proposta, Negociação, Ganho) e modo **Listagem** tabular com 10 colunas canônicas idênticas ao Pipedrive (`listagem.png`), acompanhamento de Meta Mensal (individual por vendedor e consolidada da equipe para a diretoria), geração de propostas comerciais em PDF por empresa emissora (`14`, `15`, `16`) com revisões imutáveis (`<id>-R<rev>`), envio por e-mail com PDF anexado e rastreamento via link público (`/p/:token`), gestão de clientes B2B com espelhamento Just-in-Time da base Protheus (`SA1010`) para o Super Banco (`crm_clientes`), e atividades de follow-up.
- **Personas Atendidas:** `admin`, `diretoria` (visão global de toda a equipe e cadastro de empresas emitentes) e `vendedor` habilitado com permissão `'crm'` (escopo isolado na própria carteira de oportunidades e propostas).

---

## 2. Arquitetura de Código & Componentes
- **Frontend (View):** `public/crm.html` (`/crm`) e `public/index.html` (aba `#tab-bi-crm`, atalho `#mainTabCrm`, containers `#crmKanbanContainer` e `#crmListagemContainer`, card `#crmKpiMetaBox`, botão `#btnCrmEmpresas`, modais `#modalCrmOportunidade`, `#modalCrmDetalhes` com `#btnCrmPropostaDoDetalhes`, `#modalCrmCliente`, `#modalCrmPropostas`, `#modalCrmPropostaEmail` e `#modalCrmEmpresas`).
- **Frontend (Controller):** `public/js/crm.js` (estado `crmMe`, `crmVendedoresCatalog`, `dealViewMode`, `loadCrmMe`, `applyRoleVisibility`, `updateMetaKpiCard`, `renderListagemBoard`, `renderKanbanBoard`, `renderUltimaPropostaBadge`, `abrirModalPropostas`, `abrirModalPropostaEmail`, `abrirModalEmpresasEmitentes`, `abrirModalCliente`, sincronização e filtros por `cod_vendedor`).
- **Backend / Rotas:** `crm_routes.js` (`requireCrmAccess`, `scopeByOwner`, `requireCrmAdmin`, `/api/bi/crm/deals`, `/api/bi/crm/clientes`, `/api/bi/crm/vendedores`, `/api/bi/crm/me`, `/api/bi/crm/meta`, `/api/bi/crm/empresas-emitentes`, `/api/bi/crm/deals/:id/propostas`), `crm_propostas.js`, `crm_vendedores.js`, `crm_engine.js`, `mailer.js` (`sendPropostaEmail`), `server.js` (`GET /p/:token` e `POST /api/cron/crm-propostas-vencendo`), `postgres_db.js`.
- **Banco de Dados & Scripts:** `sql/bi/11_tabela_crm_vendedores.sql` (`crm_vendedores` com RLS e grants `service_role`), `sql/bi/12_tabelas_crm_propostas.sql` (`crm_empresas_emitentes` e `crm_propostas` com RLS e grants `service_role`), `.github/workflows/crm_propostas_vencendo.yml` (cron diário às 08h BRT) e `scripts/crm19_normalizar_vendedores.js` (saneamento de `cod_vendedor`/`nome_vendedor` com `--dry-run` e `--apply`).

---

## 3. Identificadores DOM & Controles da Interface
- **Barra de Busca e Filtros de Deals:**
  - `#crmSearchInput`: Busca textual dinâmica com debounce e sanitização.
  - `#crmFilterVendedor`: Seletor de proprietário/vendedor (exclui Diretoria, focado em vendedores operacionais).
  - `#crmFilterStatus`: Seletor de status com 6 opções canônicas: `ABERTAS` ("Oportunidades Abertas"), `TODOS` ("Todas (inclui Perdidos)"), `GANHO` ("Somente Ganhas"), `GANHO_HOJE` ("Ganhas Hoje"), `GANHO_ONTEM` ("Ganhas Ontem") e `PERDIDO` ("Somente Perdidos").
  - `#btnCrmLimparFiltros`: Botão de reset rápido, restaurando status para `ABERTAS` e vendedor para `TODOS`.
- **Ações Rápidas de Cliente & Faturamento no Modal de Oportunidades & Detalhes:**
  - `#crmSelectFaturadoPor`: Seletor de empresa faturadora no Bloco 1 (📌 Identificação da Oportunidade) com as 3 empresas canônicas (`14 - METAL PLENO`, `15 - GSI COFRES`, `16 - OACO`). Rótulo obrigatório `Faturado Por: *` e atributo `required`. A opção inicial `"Selecione a empresa..."` possui `value="" disabled selected`, sendo inválida para salvar.
  - `#btnSalvarCrmOportunidade`: Botão de salvar com controle dinâmico de inatividade (`disabled = true`). Permanece inativo até que todos os 4 campos obrigatórios estejam preenchidos com valores válidos: **Título da Oportunidade: \***, **Vendedor Responsável: \***, **Cliente: \*** e **Faturado Por: \*** (`isDealFormValid()`). Ao ser desabilitado, exibe tooltip orientativo e cursor `not-allowed`.
  - `#crmDetalhesFaturadoPorBadge` / `#crmDetalhesFaturadoPor`: Exibição explícita da empresa de faturamento na modal de visualização e detalhes (`#modalCrmDetalhes`), visível no cabeçalho da oportunidade e na grade de Condições Comerciais & Faturamento.
  - `#btnCrmNovoClienteFromDeal`: Renomeado para `➕ Add Cliente` (abre modal de cadastro rápido sem sair da oportunidade).
  - `#btnCrmEditarClienteFromDeal`: Botão compacto `✏️ Editar` ao lado do autocomplete de cliente em `#modalCrmOportunidade`, permitindo editar o cadastro comercial do cliente selecionado.
  - `#btnCrmEditarClienteDoDetalhes`: Botão compacto `✏️ Editar` ao lado do nome da organização no cabeçalho do `#modalCrmDetalhes`.
  - `#crmInputValor`: Campo inalterável de resumo fiscal e comercial exibindo **Valor Total NFe:** com largura ajustada para `100px` (`readonly disabled tabindex="-1"` com `cursor: not-allowed`, padding compacto `4px 6px` e estilo cinza translúcido idêntico a P. Tabela e Desc(%), com recálculo reativo automático, prevenindo corte dos centavos).
  - `#crmInputDescontoTotalGeral`: Campo inalterável exibindo **Desconto Total Geral (%):** na mesma linha de Valor Total NFe (`width: 70px`, `readonly disabled tabindex="-1"`, `cursor: not-allowed`, padding compacto `4px 6px`, coloração dinâmica por faixa de margem e cálculo determinístico oficial do BI de Autorizações).
- **Inteligência Preditiva & Diagnóstico Comercial (IA de Vendas):**
  - `#crmDetalhesScoreCard`: Bloco dedicado de diagnóstico preditivo no `#modalCrmDetalhes` posicionado antes das condições comerciais.
  - `#crmDetalhesScoreNumero`: Mostrador de probabilidade percentual (Score 0-100) com cor dinâmica (Verde >=70%, Amarelo 40-69%, Vermelho <40%).
  - `#crmDetalhesScoreClassificacao`: Classificação semântica de potencial de fechamento (`Probabilidade ALTA`, `MÉDIA` ou `BAIXA`).
  - `#crmDetalhesScoreBar`: Barra de progresso animada proporcional à probabilidade de fechamento.
  - `#crmDetalhesScorePills`: Contêiner com badge numérico de probabilidade e alerta pulsante `🚨 Esfriando` quando o negócio estiver estagnado há mais de 12 dias.
  - `#crmDetalhesFatoresContainer`: Pílulas explicáveis (estilo SHAP) com impactos percentuais positivos (ex: `✅ +35% Cliente Fidelidade na Raiz do CNPJ`, `✅ +40% Cliente Diamante VIP`) e negativos (ex: `⚠️ -25% Nenhuma anotação registrada após 7 dias`, `⚠️ -35% Negócio estagnado há 30 dias`).
  - `#crmDetalhesRecomendacaoBox` / `#crmDetalhesRecomendacaoTexto`: Caixa com orientação acionável direta da IA para o vendedor agir naquele dia.
  - `.badge-score-preditivo`: Pílula compacta de probabilidade exibida na linha de meta dos cards do Kanban e na coluna de status da Listagem Tabular.
- **Toggles de Exibição de Oportunidades:**
  - `#btnCrmViewModeKanban`: Ativa modo de exibição em funil Kanban.
  - `#btnCrmViewModeListagem`: Ativa modo de exibição em tabela de listagem.
- **Estrutura da Listagem de Deals:**
  - `#crmListagemContainer`: Container com `.table-responsive` e scroll vertical `max-height: 68vh`.
  - `#crmDealsTable`: Tabela com cabeçalho sticky (`position: sticky; top: 0`).
  - `#crmDealsTableTbody`: Linhas de negócios paginadas com sanitização XSS estrita.
- **Controles de Paginação Compulsória (Pilar 1 do GEMINI.md):**
  - `#crmDealsLimitSelect`: Seletor de registros por página (25, 50, 100).
  - `#btnCrmDealsPrev`: Botão de navegação para página anterior.
  - `#btnCrmDealsNext`: Botão de navegação para próxima página.
  - `#crmDealsCurrentPage` / `#crmDealsTotalPages`: Indicador de página ativa e total.
  - `#crmListagemContador`: Contador de oportunidades listadas (`N oportunidades (exibindo X–Y)`).
  - `#crmListagemValorTotal`: Somatório monetário formatado em verde (`#10b981`).

---

## 4. As 10 Colunas Canônicas da Listagem
| Coluna | Descrição | Comportamento |
| :--- | :--- | :--- |
| **Ação** | Ações Rápidas | Botões compactos: Lápis `✏️` (abre edição da oportunidade) e Lupa `🔍` (abre visualização de detalhes) |
| **Título** | Nome da Oportunidade | Link verde (`#10b981`) que abre modal de detalhes da oportunidade |
| **🤝** | Fidelidade Raiz CNPJ | Histórico de compras consolidadas nas 7 empresas do Grupo GSI: `⭐ X` para 1 a 5 compras; `💎 X` para 6+ compras (VIP); célula vazia se não houver compras |
| **Valor** | Valor total negociado | Formatado em reais (`R$ X.XXX,XX`) com destaque verde |
| **Nome do Cliente** | Razão Social / Nome do Cliente | Exibição com tooltip e ellipsis para nomes longos (substitui antiga coluna Organização) |
| **Status** | Estágio atual do pipeline | Destaque verde para `Ganho`, vermelho para `Perdido` |
| **Faturado Por** | Filial de faturamento Protheus | Ex: `16 - OACO`, `14 - METAL PLENO`, `15 - GOLD SAFE` |
| **Cond. Pgto** | Condição de Pagamento negociada | Ex: `053-1X PIX`, `31 - PAGAR ME (LINK ...)`, `28 DDL` |
| **ID** | Código identificador do deal | Link verde (`#10b981`) que abre modal de detalhes |
| **Proprietário** | Vendedor responsável | Nome do vendedor responsável pela oportunidade |

---

## 5. Regras de Negócio & Cálculos Chave
- **Fidelidade por Raiz de CNPJ (🤝):** Análise histórica de faturamento cruzando as notas fiscais emitidas (`SF2010`, `SF2040`, `SF2050`, `SF2090`, `SF2140`, `SF2150`, `SF2160`) e clientes `SA1010` dos 7 ambientes Protheus (empresas inativas 01, 04, 05, 09 e ativas 14, 15, 16) agrupadas pelos 8 primeiros dígitos do CNPJ/CPF (`A1_CGC`). Total de 28.974 raízes catalogadas com persistência no Supabase (`crm_clientes_raiz_cnpj`) e cache atômico em `data/crm_clientes_raiz_cnpj_cache.json`.
- **Badges Visuais de Fidelidade (⭐ / 💎):**
  - **1 a 5 compras:** Selo dourado com estrela (`⭐ X`) com tooltip explicativo.
  - **6 ou mais compras:** Selo roxo VIP com diamante (`💎 X`) para grandes compradores recorrentes do grupo.
  - **0 compras ou desconhecido:** Espaço limpo/vazio (princípio da Navalha de Texto e design minimalista sem poluição).
  - **Pontos de Exibição:** Coluna `🤝` na listagem tabular (`#crmDealsTable`), card do funil Kanban (`.crm-card-client`), cabeçalho da ficha de detalhes (`#crmDetalhesFaseBadge` logo após contagem de itens) e formulário de oportunidade (`#crmDealClienteFidelidadeBadge` ao lado do rótulo `Cliente: *`) atualizado em tempo real via autocomplete ou edição.
- **Sincronização Mensal Incremental:** Script agendável `scripts/sync_mensal_raizes_cnpj.js` que atualiza as notas fiscais das empresas ativas (14, 15, 16) de forma incremental e idempotente.
- **Persistência de Preferência:** Armazenada em `localStorage` (`gsi_crm_deal_view_mode`), preservando a escolha do usuário entre reloads.
- **Busca e Filtros Unificados:** Termo digitado em `#crmSearchInput`, vendedor em `#crmFilterVendedor` e status em `#crmFilterStatus` filtram os negócios e resetam a página para `1`.
- **Filtro de Status Especializado:**
  - `ABERTAS`: Exibe apenas negócios em andamento no funil (`LEAD`, `CONTATO`, `PROPOSTA`, `NEGOCIACAO`), excluindo estritamente `GANHO` e `PERDIDO`.
  - `GANHO`: Retorna todas as oportunidades ganhas independentemente do período.
  - `GANHO_HOJE`: Retorna oportunidades ganhas na data atual (fuso `America/Sao_Paulo`, com suporte tanto a timestamps ISO quanto DateOnly).
  - `GANHO_ONTEM`: Retorna oportunidades ganhas no dia anterior (fuso `America/Sao_Paulo`).
  - `PERDIDO`: Retorna somente oportunidades com status de perda.
  - `TODOS`: Exibe a base completa de oportunidades sem restrição de estágio.
- **Filtro de Proprietário:** "Diretoria" é excluída do seletor operacional `#crmFilterVendedor`, mantendo apenas vendedores comerciais ativos.
- **Prevenção de Custo Duplo de Renderização:** O pipeline só renderiza no DOM o modo ativo (`kanban` ou `listagem`), poupando ciclos de CPU.
- **Preservação de Dados em Edição:** `contatoNome` e `faturadoPor` são preservados durante atualizações ou salvamento de oportunidades.
- **Sanitização XSS:** Todos os valores interpolados passam por `escapeHtml()` e valores numéricos por `parseFloat()`.
- **Catálogo de Produtos Espelhado (`crm_produtos`):** Base unificada no PostgreSQL Supabase com sincronização em lote de `SB1090` e `SB1160` (1.883 produtos reais), contingência em `data/crm_produtos_cache.json` e atualização sob demanda via `#btnCrmSyncProdutos`.
- **Autocomplete Instantâneo de Produtos (< 10ms):** Busca dinâmica no modal de oportunidades por código ou descrição com ordenação por relevância (código exato > prefixo de código > prefixo de descrição), dropdown flutuante `#crmProductSuggestionsDropdown` e sanitização T-SQL/SQLi estrita.
- **Enriquecimento Automático de Itens Cotados:** Ao selecionar o produto, preenche automaticamente Código, Descrição, Preço de Tabela, Preço Negociado sugerido, NCM (`B1_POSIPI`), Peso Líquido (`B1_PESO`), Peso Bruto (`B1_PESBRU`) e Unidade de Medida (`B1_UM`), posicionando o foco diretamente no campo de quantidade.
- **Cálculo de Peso Total em Tempo Real:** Mostrador `#crmItensPesoTotalDisplay` calcula dinamicamente o peso acumulado da proposta (`Σ (quantidade * pesoLiquido)`), permitindo cotação instantânea de fretes.
- **Imutabilidade e Snapshot Histórico:** Itens cotados são salvos como snapshot imutável no JSONB `itens_cotados` de `crm_deals`, preservando a auditoria e os valores da proposta independentemente de alterações cadastrais futuras no ERP.
- **Espelhamento Just-in-Time Protheus ➔ Super Banco (`crm_clientes`):** Ao consultar um cliente por código ou CNPJ (ou ao editar de uma oportunidade), se o cliente residir apenas na tabela `SA1010` do ERP Protheus, o motor `obterClientePorId` executa um espelhamento sob demanda (*Just-in-Time Mirroring*) atômico no PostgreSQL (`crm_clientes`) e cache de contingência (`crm_clientes_cache.json`), mapeando razão social, CNPJ, contatos, dados de faturamento/NFS-e e o nome do vendedor (`getNomeVendedor(A1_VEND)`).
- **Resolução Multi-Chave & Pad Numérico:** Suporte a busca por ID interno (`CLI-...`), código Protheus exato (`004128`), código sem zeros (`4128` com `padStart(6, '0')`) e dígitos de CNPJ.
- **Sincronização Reativa do Negócio:** Ao salvar alterações do cliente a partir de um deal existente, o backend atualiza automaticamente o negócio vinculado e aciona `renderDealsViews()`, sincronizando o card do Kanban e da Listagem sem necessidade de recarregar a página.
- **Fallback Resiliente no Modal:** Se o identificador procurado não existir no banco nem no Protheus, o modal não abre vazio: os dados conhecidos do deal (`nome`, `cnpj`, `vendedor`) são pré-carregados para cadastro imediato.
- **Navalha de Texto em Itens Cotados:** Remoção do rótulo redundante "UM: UN" na exibição dos itens cotados da modal de oportunidade, no modal de detalhes e nas sugestões de produtos, mantendo a interface enxuta e focada em NCM e Peso.
- **Coluna Ação com Acesso Rápido:** Primeira coluna da listagem tabular de oportunidades reservada para ações rápidas com botões de Lápis `✏️` (abre edição) e Lupa `🔍` (abre visualização de detalhes), alinhando a coluna "Nome do Cliente" (antiga Organização) e eliminando a coluna "Contato".
- **Cálculo Automático do Valor Total NFe:** O campo `#crmInputValor` computa dinamicamente a soma canônica $\text{Valor Total NFe} = \text{Soma Itens} + \text{Frete Cobrado}$. O Frete Embutido é rigorosamente excluído dessa soma por já constar incorporado no preço negociado dos produtos. O campo é inalterável e recalculado em tempo real em todas as interações (digitação de frete cobrado, alteração de quantidades, preços negociados, adição/remoção de itens e seleção no autocomplete do catálogo Protheus).
- **Cálculo Determinístico do Desconto Total Geral (%):** O campo inalterável `#crmInputDescontoTotalGeral` computa em tempo real a regra canônica oficial do BI de Autorizações (`bi_autorizacoes_engine.js`): Valor Líquido = Soma Itens Negociados - Frete Embutido (R$); Desconto (R$) = Soma Itens Tabela - Valor Líquido; Desconto Total Geral (%) = (Desconto R$ / Soma Itens Tabela) * 100. Possui divisão defensiva contra tabela zerada (`somaTabela > 0`) e coloração dinâmica: vermelho (`#ef4444`) para desconto > 10%, amarelo (`#f59e0b`) entre 6% e 10%, e verde (`#10b981`) para desconto <= 6%. Sincronizado reativamente com alterações nos itens cotados e digitação de Frete Embutido e Cobrado.
- **Inteligência Preditiva de Oportunidades & Score Integrado com Raiz de CNPJ:** O motor `crm_scoring_engine.js` (calibrado via Regressão Logística L2 sobre 6.000 negócios históricos do Pipedrive com ROC-AUC de 98.5% e acurácia de 94.8%) é alimentado diretamente pelo histórico real de compras na raiz de CNPJ (`fidelidade_compras` das 7 empresas Protheus). Clientes com compras anteriores (`total_compras >= 1`) recebem bônus de recorrência imediata (+35%), enquanto compradores Diamante VIP (`total_compras >= 6`) recebem calibração de boost máximo (+40%). A oportunidade é avaliada em tempo real quanto a: (1) Ticket e porte monetário, (2) Quantidade de anotações registradas, (3) Dias de estagnação no funil, (4) Perfil do vendedor responsável, e (5) Alerta de Esfriamento (negócios com >12 dias sem anotações ativam indicador `🚨 Esfriando`, mitigando 44% das perdas históricas por abandono). O diagnóstico é exibido em pílulas compactas nos cards do funil Kanban, na coluna de status da Listagem Tabular e no bloco dedicado `#crmDetalhesScoreCard` do modal de detalhes.

---

## 6. Endpoints REST da API
- `GET /api/bi/crm/me`: Retorna o perfil e o escopo resolvido do usuário autenticado (`isAdmin`, `cod_vendedor`, `nome_vendedor`, `meta_mensal`).
- `GET /api/bi/crm/meta`: Apuração de meta mensal realizada vs objetivo (`escopo: 'vendedor'` para vendedor ou filtro específico; `escopo: 'equipe'` consolidando os vendedores com meta > 0 para o administrador). Reaproveita `metaBaseVendas = R$ 120.000,00` de `getConfigMetasVendasDB()` quando `crm_vendedores.meta_mensal IS NULL`.
- `GET /api/bi/crm/deals`: Listagem dos negócios do funil respeitando `req.crmScope`, com filtros e enriquecimento com `score_preditivo` e `fidelidade_compras`.
- `GET /api/bi/crm/deals/:id`: Consulta individual de negócio com diagnóstico preditivo e atividades (retorna 404 + auditoria `CRM_DEAL_ACESSO_NEGADO` se o deal pertencer a outro vendedor).
- `GET /api/bi/crm/vendedores`: Lista de vendedores ativos (retorna apenas o próprio vendedor quando `scope.all === false`, ou todos os vendedores ativos para o admin).
- `POST /api/bi/crm/deals`: Criação de nova oportunidade comercial (força `cod_vendedor` e `nome_vendedor` da sessão quando chamado por vendedor; quando chamado por admin sem `cod_vendedor`/`nome_vendedor` informado no payload, assume o próprio admin resolvido pelo `username`).
- `PUT /api/bi/crm/deals/:id`: Edição de oportunidade existente (preserva ownership para vendedor e preenche `data_fechamento_real` ao mudar para `ganho`).
- `PATCH /api/bi/crm/deals/:id/stage`: Transição atômica de estágio no escopo permitido.
- `DELETE /api/bi/crm/deals/:id` e `POST /api/bi/crm/deals/:id/restore`: Soft delete e restauração de negócios (restrito a `requireCrmAdmin`).
- `GET /api/bi/crm/clientes`: Listagem paginada de clientes comerciais (compartilhada para consulta/edição; exclusão restrita ao admin).
- `GET /api/bi/crm/clientes/:id`: Consulta multi-chave de cliente (ID interno, Código Protheus ou CNPJ) com espelhamento Just-in-Time automático do Protheus `SA1010` para o super banco.
- `POST /api/bi/crm/clientes`: Criação ou edição com distinção estrita de espelhamento e inserção idempotente `ON CONFLICT (id) DO UPDATE`.
- `GET /api/bi/crm/clientes/raiz-cnpj/:cnpj`: Consulta de fidelidade da raiz de CNPJ nas 7 empresas do grupo.
- `GET /api/bi/crm/produtos/autocomplete`: Busca instantânea de produtos no catálogo espelhado com suporte a termo `q`, `limite` e `apenasAtivos`.
- `POST /api/bi/crm/produtos/sync`: Sincronização em lote do catálogo oficial Protheus (`SB1090`/`SB1160`) com o Supabase e cache local (`requireCrmAdmin`).
- `GET /api/bi/crm/produtos/status`: Telemetria de total de produtos ativos, bloqueados, última sincronização e origem.
- `GET /api/bi/crm/transportadoras/autocomplete`: Busca inteligente de transportadoras homologadas no Protheus por código, razão social, fantasia ou CNPJ.
- `POST /api/bi/crm/transportadoras/sync`: Sincronização manual e sob demanda do cadastro Protheus (`SA4010`/`SA4160`) para o Super Banco (`requireCrmAdmin`).
- `GET /api/bi/crm/transportadoras/status`: Telemetria de transportadoras ativas, bloqueadas e data da última sincronização.
- `GET /api/bi/crm/empresas-emitentes`: Lista o cadastro das 3 empresas emissoras (`14`, `15`, `16`) para cabeçalho e rodapé das propostas comerciais.
- `PUT /api/bi/crm/empresas-emitentes/:codigo`: Atualiza os dados cadastrais, bancários e logomarca (PNG/JPEG <= 200 KB) da empresa emissora (`requireCrmAdmin`).
- `POST /api/bi/crm/deals/:id/propostas/previa`: Gera prévia em PDF (rascunho não gravado, `application/pdf`) respeitando `dealEditavel`.
- `POST /api/bi/crm/deals/:id/propostas`: Gera e grava revisão oficial imutável (`<id>-R<rev>`, ex.: `29001-R2`) em transação `FOR UPDATE`, atualiza `custom.ultima_proposta`, cria atividade `proposta_gerada` e move estágio `lead`/`contato` para `proposta`.
- `GET /api/bi/crm/deals/:id/propostas`: Lista as revisões da oportunidade sem trafegar o binário `BYTEA` (`dealVisivel`).
- `GET /api/bi/crm/deals/:id/propostas/:revisao/pdf`: Retorna o PDF binário (`inline` ou `attachment` via `?download=1`, `dealVisivel`).
- `POST /api/bi/crm/deals/:id/propostas/:revisao/email`: Envia a revisão por e-mail com PDF anexado e link público (`/p/:token`), `Reply-To` do vendedor (`crm_vendedores.email` com fallback em `users.email`) e limite de 20 envios/h por usuário (`dealEditavel`).
- `GET /p/:token`: Rota pública (sem login, `propostaPublicaLimiter` 30 req/min/IP) que exibe o PDF inline, aplica filtro anti-bot/anti-prévia (2 min pós-envio e dedup de 10 min por IP) e registra atividade `proposta_visualizada` na 1ª abertura humana.
- `POST /api/cron/crm-propostas-vencendo`: Rota protegida por `requireCronAuth` que gera atividade pendente `proposta_vencendo` para a última revisão enviada que vence em até 2 dias em negócios abertos.

---

## 7. Testes Automatizados Vinculados
- Execução da suíte completa de testes:
```bash
node test_crm_propostas.js
node test_crm_rbac_vendedor.js
node test_crm_preditivo_integrado.js
node test_crm_scoring_engine.js
node test_crm_raizes_cnpj.js
node test_crm_standalone.js
node test_crm_transportadoras.js
node test_crm_produtos.js
node test_crm_filtros.js
node test_crm_listagem.js
node test_crm_module.js
node test_crm_clientes.js
```

---

## 8. Histórico & Evolução da Tela
- **v8.324 (14/11/2026):** CRM-21a — Integração com o WhatsApp Multi360, lado do portal: vínculo deal ↔ conversa (`crm_deal_conversas`), API servidor-a-servidor `/api/integracoes/whatsapp/crm` (contexto por telefone com e sem o nono dígito, criar oportunidade idempotente por `origem_ref`, vincular conversas), protegida por `CRM_INTEGRACAO_SECRET` e pelo escopo do CRM-19; botão 💬 Conversar no modal de detalhes abre o painel com `&deal=<id>` (o painel usa o parâmetro a partir do CRM-21b). Especificação em [crm21a_whatsapp_portal.md](crm21a_whatsapp_portal.md); testes em `test_crm_whatsapp_integracao.js`.
- **v8.323 (14/11/2026):** CRM-23 — Motivo de perda em lista fechada (Preço, Prazo de Entrega, Produto Não Atende, Compra Cancelada, Sem Resposta, Crédito Negado, Transferido para Outro Vendedor; sem "Outro" e sem concorrente) gravado em `motivo_perda_cod`; oportunidade aceita contato avulso (nome + telefone) sem cliente e CPF/CNPJ passa a ser exigido só para marcar Ganho; botões ↩️ Reabrir (perdido ou ganho, mantém o número e volta ao estágio anterior) e 📑 Clonar (número novo) no modal de detalhes; a mudança de estágio na tela é desfeita quando o servidor recusa. Especificação em [crm23_perda_lead_reabrir.md](crm23_perda_lead_reabrir.md); testes em `test_crm_perda_reabrir.js`.
- **v8.322 (13/11/2026):** CRM-20 — Proposta Comercial em PDF por Empresa Emissora (`14`, `15`, `16`), Revisões Imutáveis, Envio por E-mail, Link Público e Lembrete de Validade:
  - **Tabelas e Segurança (`sql/bi/12_tabelas_crm_propostas.sql`):** Criação de `crm_empresas_emitentes` (seed inicial para `14` Metal Pleno, `15` GSI e `16` OAÇO) e `crm_propostas` (revisões imutáveis `<id>-R<rev>`, snapshot JSONB, binário `BYTEA` e `token_publico` de 43 caracteres base64url), com RLS estrito, `REVOKE ALL` de `anon`/`authenticated` e `GRANT ALL` explícito para `service_role` e `postgres`.
  - **Motor de Propostas e Sigilo de Desconto (`crm_propostas.js`):** Geração de PDF A4 em memória via `pdfmake` utilizando exclusivamente `precoNegociado` como Valor Unitário e omitindo Preço de Tabela, Desconto % e Frete Embutido. Transação PostgreSQL `BEGIN` + `SELECT ... FOR UPDATE` no deal garantindo revisões sequenciais sem colisão, atualização de `custom.ultima_proposta`, criação de atividade `proposta_gerada` e avanço automático de `lead`/`contato` para `proposta` após o `COMMIT`.
  - **Envio de E-mail, Link Público e Cron (`mailer.js`, `server.js` & `.github/workflows/crm_propostas_vencendo.yml`):** Nova função `sendPropostaEmail` (Mailjet HTTP API v3.1 com anexo Base64, `ReplyTo` e `Cc`, mais fallback SMTP), resolução do e-mail do vendedor com fallback automático no usuário do portal (`users.email`), rate limit de 20 e-mails/hora em memória, rota pública `GET /p/:token` (30 req/min/IP, cabeçalhos `no-store`/`nosniff`/`noindex`/`no-referrer`, filtro de bots, janela de 2 min pós-envio e dedup de 10 min por IP com IPv4 mascarado) e job diário `POST /api/cron/crm-propostas-vencendo` às 08h BRT.
  - **Interface e Testes (`public/js/crm.js`, `public/crm.html`, `public/index.html` & `test_crm_propostas.js`):** Botões `📄 Proposta` no detalhe do negócio e `🏢 Empresas` (admin) no topo, modais `#modalCrmPropostas`, `#modalCrmPropostaEmail` e `#modalCrmEmpresas`, selos de última proposta nos cards do Kanban e na Listagem, ícones dedicados na timeline e suíte `test_crm_propostas.js` com os 21 cenários da especificação.
- **v8.321 (13/11/2026):** CRM-19 — Abertura do CRM Comercial aos Vendedores com RBAC por Proprietário, Tabela `crm_vendedores` e Meta Mensal:
  - **RBAC e Escopo por Proprietário (`crm_routes.js` & `crm_engine.js`):** Substituição de `requireAdminOrAlexandre` por `requireCrmAccess` + `scopeByOwner`, resolvendo o vendedor exclusivamente por `crm_vendedores.username_portal` (`ativo = true`) e exigindo permissão `'crm'` na conta do usuário. Oportunidades de outros vendedores retornam `404 DEAL_NOT_FOUND` (anti-enumeração) com registro de auditoria `CRM_DEAL_ACESSO_NEGADO`. Operações destrutivas e de sincronização permanecem protegidas por `requireCrmAdmin`.
  - **Tabela `crm_vendedores` e Meta Mensal (`sql/bi/11_tabela_crm_vendedores.sql` & `crm_vendedores.js`):** Cadastro central dos 4 códigos Protheus (`000074` Juliana, `000064` Andrea, `000004` Figueiredo, `000001` Alexandre com `meta_mensal = 0`). Cálculo de meta mensal reaproveitando `metaBaseVendas = R$ 120.000,00` de `getConfigMetasVendasDB()` quando `meta_mensal IS NULL` e excluindo vendedores com `meta_mensal = 0` da soma da equipe (`R$ 360.000,00`).
  - **Saneamento e Correções Técnicas:** Script `scripts/crm19_normalizar_vendedores.js` (`--dry-run` / `--apply` com transação `BEGIN`/`COMMIT`/`ROLLBACK` e auditoria `updated_by = 'migracao_crm19'`), fallback em `criarDeal` para admin sem vendedor informado (assume o próprio admin pelo `username`), correção da chamada `listarAtividadesDeal` em `obterDealPorId`, gravação de `data_fechamento_real` ao transicionar para `ganho` via `atualizarDeal`, isolamento do cache `localStorage` por `username` (`gsi_crm_deals_cache_<username>` e `gsi_crm_activities_<username>_<dealId>`, desabilitado enquanto `crmMe` for `null`), remoção de mocks locais em respostas HTTP 200 vazias em `public/js/crm.js`, e suíte `test_crm_rbac_vendedor.js` com 18 cenários aprovados.
- **v8.278 (26/09/2026):** Status Limpo e Calibração Anti-Inflação de 99% no Score Preditivo do CRM:
  - **Eliminação de Porcentagem em Vendas Ganhas/Perdidas:** Remoção do badge preditivo `${renderScoreBadge}` para negócios com fase `GANHO` ou `PERDIDO` na listagem tabular (`renderListagemBoard`) e nos cards do funil Kanban (`renderKanbanBoard`). Negócios finalizados exibem estritamente seu status soberano (`Ganho` em verde `#10b981` ou `Perdido` em vermelho `#ef4444`), eliminando a confusão de exibir probabilidade de fechamento futuro em vendas já consolidadas.
  - **Identificação e Correção de Data Leakage no Treino:** Detecção de vazamento temporal no script de treino (`scripts/ml_pipedrive_train.js`), onde a vitória do próprio negócio alimentava o contador de vitórias anteriores da organização (`hasWonPrior`), inflando o coeficiente $w_6$ para abusivos `+4.13586`.
  - **Recalibração do Motor Preditivo de IA (`crm_scoring_engine.js`):** Ajuste dos pesos oficiais do modelo ($w_6$ reduzido para `+0.75`, $w_0$ balanceado para `-0.10`), conferindo distribuição de probabilidades rica, realista e progressiva (15% a 85%) para negócios em aberto, impedindo que o histórico de compras na raiz de CNPJ das 7 empresas Protheus force distorção artificial de 99% em quase toda a base de clientes. Retorno conclusivo atômico (100% Ganho / 0% Perdido).
  - **Suíte de Testes Automatizados:** 6 novos testes em `test_crm_score_calibrado_status.js`, 8 testes mantidos em `test_crm_scoring_engine.js`, 5 em `test_crm_preditivo_integrado.js` e 134 em `test_crm_standalone.js` com 100% de aprovação.
- **v8.277 (25/09/2026):** Inteligência Preditiva de Oportunidades & Score Integrado com Raiz de CNPJ nas 7 Empresas Protheus:
  - **Alimentação Real do Motor Preditivo:** O modelo de Regressão Logística L2 (`crm_scoring_engine.js`) passou a consumir diretamente o histórico das 7 empresas Protheus via `fidelidade_compras` da raiz de CNPJ (`total_compras >= 1` concede bônus de recorrência de +35% e `total_compras >= 6` Diamante VIP concede bônus de +40%).
  - **Enriquecimento Dinâmico em Camadas:** O backend `crm_engine.js` calcula em tempo real o `score_preditivo` para todas as oportunidades em `listarDeals` e `obterDealPorId`, agregando anotações e atividades concluídas em consultas em memória $O(1)$ sem impacto de latência (< 0.05 ms por deal).
  - **Ergonomia e Navalha de Texto na Interface:**
    - *Cards do Kanban (`renderKanbanBoard`):* Pílula compacta de probabilidade preditiva `.badge-score-preditivo` (ex: `🟢 85%`) e badge `🚨 Esfriando` quando a oportunidade estiver sem anotações há mais de 12 dias no funil.
    - *Listagem Tabular (`renderListagemBoard`):* Exibição discreta do badge de probabilidade na célula de status, preservando estritamente as 10 colunas canônicas da tabela.
    - *Ficha de Detalhes (`#modalCrmDetalhes`):* Novo bloco `#crmDetalhesScoreCard` exibindo termômetro de probabilidade (Score 0-100), barra de progresso, pílulas explicáveis (estilo SHAP) com os fatores determinantes e caixa de recomendação acionável para o vendedor agir naquele dia.
  - **Suíte de Testes:** 5 novos testes de integração em `test_crm_preditivo_integrado.js`, 8 testes mantidos em `test_crm_scoring_engine.js`, 33 em `test_crm_raizes_cnpj.js`, 134 em `test_crm_standalone.js` e suite `npm test` 100% verde cobrindo 30 arquivos de teste.
- **v8.276 (25/09/2026):** Inteligência de Fidelidade por Raiz de CNPJ nas 7 Empresas Protheus, Coluna 🤝 e Badges Visuais:
  - **Carga Inicial Consolidada das 7 Empresas:** Extração de 48.782 notas fiscais de saída cruzadas com `SA1010` nas 4 empresas inativas (`01`, `04`, `05`, `09`) e nas 3 empresas ativas (`14`, `15`, `16`) via `scripts/carga_inicial_raizes_cnpj.js`. Agrupamento rigoroso pelos 8 primeiros dígitos de `A1_CGC` gerando 28.974 raízes consolidadas no PostgreSQL Supabase (`crm_clientes_raiz_cnpj`) e cache atômico em `data/crm_clientes_raiz_cnpj_cache.json` (7.7 MB) com consultas em memória $O(1)$ (< 0.001 ms).
  - **Badges Visuais de Fidelidade (⭐ / 💎):** Classificação automática: 1 a 5 compras faturadas = estrela dourada (`⭐ X`); 6 ou mais compras = diamante VIP (`💎 X`); 0 compras ou cliente novo = célula vazia sem poluição visual (Navalha de Texto / YAGNI).
  - **Exibição Multitela:**
    - *Listagem Tabular (`#crmDealsTable`):* Nova coluna `🤝` posicionada estritamente entre Título e Valor com alinhamento centralizado e tooltip explicativo.
    - *Cards do Kanban (`.crm-card-client`):* Badge visual elegante acoplado ao lado do nome da empresa compradora.
    - *Ficha de Detalhes (`#modalCrmDetalhes`):* Badge inserido em `#crmDetalhesFaseBadge` imediatamente após o bloco de itens cotados (ex: `#1001 — TITULO 📦 2 itens 💎 12`).
    - *Modal de Oportunidades (`#modalCrmOportunidade`):* Contêiner `#crmDealClienteFidelidadeBadge` posicionado ao lado do rótulo `Cliente: *`, renderizado reativamente ao selecionar clientes no autocomplete ou na edição.
  - **Sincronização Mensal Automática:** Script incremental idempotente `scripts/sync_mensal_raizes_cnpj.js` para atualização periódica das empresas ativas (14, 15, 16).
  - **API REST Protegida:** Endpoint `GET /api/bi/crm/clientes/raiz-cnpj/:cnpj` com autenticação JWT Zero-Trust, validação de dígitos e envelopes RFC.
  - **Suíte de Testes:** 33 testes aprovados em `test_crm_raizes_cnpj.js`, 134 testes mantidos com 100% de aprovação em `test_crm_standalone.js` e 6 em `test_crm_scoring_engine.js`.
- **v8.275 (25/09/2026):** Ajuste Ergonômico de Largura do Valor Total NFe (`100px`):
  - **Acomodação dos Centavos:** Ampliação da largura do input `#crmInputValor` de `70px` para `100px` em `public/crm.html` e `public/index.html`. O valor de 70px cortava o último zero após a vírgula em valores formatados (ex: `1.250,00`). A largura de 100px garante visualização nítida de valores de até 6 dígitos com folga e sem quebra de layout na barra de resumo.
  - **Suíte de Testes:** 134 testes mantidos com 100% de aprovação em `test_crm_standalone.js`.
- **v8.274 (25/09/2026):** Redução da largura de Valor Total NFe pela metade (70px) e novo campo inalterável Desconto Total Geral (%) no modal de Oportunidades:
  - **Redução Ergonômica:** O campo `#crmInputValor` teve sua largura reduzida de 140px para 70px com padding compacto 4px 6px em `public/crm.html` e `public/index.html`, liberando espaço horizontal na barra de resumo.
  - **Novo Campo Inalterável Desconto Total Geral (%):** Adicionado `#crmInputDescontoTotalGeral` na mesma linha, com `readonly disabled tabindex="-1"` e `cursor: not-allowed`.
  - **Regra Canônica Oficial:** Implementação em `public/js/crm.js` da fórmula determinística idêntica a Autorizações de Desconto (`bi_autorizacoes_engine.js`): Valor Líquido = Soma Negociado - Frete Embutido; Desconto R$ = Soma Tabela - Valor Líquido; Desconto % = (Desconto R$ / Soma Tabela) * 100.
  - **Coloração Dinâmica por Faixa de Margem:** >10% Vermelho (`#ef4444`), >6% e <=10% Amarelo (`#f59e0b`), <=6% Verde (`#10b981`).
  - **Reatividade Plena:** Recálculo em tempo real disparado por eventos `input`/`change` em Frete Embutido, Frete Cobrado e na edição de itens cotados.
  - **Suíte de Testes:** 134 testes aprovados em `test_crm_standalone.js` (com a nova bateria 13 cobrindo layout, inalterabilidade, precisão matemática e cores).
- **v8.273 (25/09/2026):** Eliminação do fechamento prematuro do Dropdown de Produtos do CRM ao rolar a lista ou usar a barra de rolagem:
  - **Causa Raiz & Remoção de Listener Invasivo:** Remoção do listener global de captura `window.addEventListener('scroll', ..., true)` em `public/js/crm.js`. Anteriormente, qualquer rolagem disparada pela caixa interna do dropdown (`#crmProductSuggestionsDropdown`) era interceptada na janela global e fechava o dropdown no milissegundo em que o operador tentava rolar para ver os últimos itens.
  - **Rolagem Livre e Fluida:** A listagem de produtos agora suporta rolagem completa com a rodinha do mouse (*wheel*) e arrasto da barra de rolagem sem fechamento indevido.
  - **Fechamento Seguro por Ação Exclusiva:** O dropdown agora só se fecha quando o usuário clicar fora dele e dos campos de itens (`crm-item-code` / `crm-item-desc`), selecionar um produto da lista, pressionar `Esc` ou fechar o modal.
  - **Suíte de Testes:** 7 baterias completas aprovadas em `test_crm_produtos.js`, 8 em `test_crm_id_sequencial.js` e 8 em `test_crm_listagem.js`.
- **v8.272 (25/09/2026):** Reconfiguração do Piso Sequencial de Oportunidades do CRM para `29000` (vinte e nove mil):
  - **Margem de Segurança Anti-Colisão:** Piso inicial de novas oportunidades configurado para `29000` (`crm_deals_seq START WITH 29000`, `cache.next_deal_seq = 29000`), garantindo margem segura em relação à base do CRM anterior/Pipedrive (que atingiu ~26.700 negócios), prevenindo duplicidade de numeração na futura migração/importação.
  - **Sincronização em Camadas:** PostgreSQL `setval('crm_deals_seq', 29000, false)` / `max_num >= 29000`, contingência atômica no cache local (`cache.next_deal_seq >= 29000`), piso em `obterProximoIdDeal()` e fallback offline no frontend (`crm.js` com base `28999` gerando `maxLocalId + 1 = 29000`).
  - **Suíte de Testes:** 8 testes aprovados em `test_crm_id_sequencial.js`, 107 em `test_crm_standalone.js` e 8 em `test_crm_listagem.js`.
- **v8.270 (25/09/2026):** Migração Estrita dos IDs de Oportunidades Legadas para seus 4 Dígitos Finais (ex: `CRM-1790341501167-9273` ➔ `9273`, `CRM-1789051276950-2715` ➔ `2715`):
  - **Extração Fiel dos 4 Dígitos Finais:** Atualização do motor de migração no PostgreSQL e Cache Local (`migrarDealsLegadosParaSequencial`) para extrair exatamente o sufixo numérico final de cada oportunidade antiga (`-([0-9]+)$`), mantendo a identidade original desejada pelo operador.
  - **Propagação em Cascata no Banco (ON UPDATE CASCADE):** Reconfiguração defensiva da foreign key `crm_atividades_deal_id_fkey` para `ON UPDATE CASCADE`, permitindo que a alteração da PK `crm_deals.id` propague instantaneamente para todas as atividades de follow-up (`crm_atividades.deal_id`) sem violação de integridade referencial.
  - **Endpoint Administrativo e Auto-Execução:** Inclusão do endpoint `POST /api/bi/crm/deals/migrate-ids` e execução automática garantida tanto no boot (`initCrmTables`) quanto na consulta de deals (`listarDeals`).
  - **Busca Defensiva e Retrocompatível:** `obterDealPorId` atualizado para resolver requisições passadas tanto com o ID limpo (`9273`) quanto com o ID legado longo (`CRM-...-9273`).
  - **Suíte de Testes:** 8 testes aprovados em `test_crm_id_sequencial.js` (incluindo teste com os IDs exatos `9273` e `2715`).
- **v8.269 (25/09/2026):** Adoção de ID Sequencial Limpo de 4 Dígitos para Oportunidades no CRM (`#1001`, `#1002`...) e Migração Automática de Oportunidades Gravadas:
  - **Fim dos IDs Longos Aleatórios:** Substituição da fórmula anterior (`CRM-` + `Date.now()` + 4 dígitos) por sequência atômica profissional iniciando em `1001`, utilizando `CREATE SEQUENCE IF NOT EXISTS crm_deals_seq START WITH 1001` no PostgreSQL e fallback resiliente com persistência atômica no cache local (`cache.next_deal_seq`).
  - **Migração Automática das Oportunidades Gravadas:** Migração idempotente das oportunidades legadas para IDs sequenciais de 4 dígitos (ordenadas cronologicamente por `created_at ASC`), com atualização automática e atômica das atividades de follow-up vinculadas (`crm_atividades.deal_id`).
  - **Exibição Visual Limpa e Ergonômica:** Exibição do ID sequencial no título dos cards do Kanban (`#1001`), ajuste perfeito na coluna ID da Listagem (largura de `80px` sem overflow ou quebra), no título da modal de edição (`✏️ Editar Oportunidade #1001`) e no modal de detalhes (`#1001 — Título`).
  - **Suíte de Testes:** 7 testes aprovados na nova bateria `test_crm_id_sequencial.js` e 107 testes mantidos com 100% de aprovação em `test_crm_standalone.js`.
- **v8.268 (25/09/2026):** Ajuste cromático e ergonômico no Preço Negociado nos Itens Cotados do CRM:
  - **Contraste & Legibilidade:** Substituição da cor do texto no campo de entrada da coluna Preço Negociado (`.crm-item-pnegociado`), alterando de azul claro (`#38bdf8`) para preto sólido (`#000000`).
  - **Especificidade em Camadas:** Aplicação inline no gerador de linhas de `renderItensCotadosTable()` em `public/js/crm.js` e reforço na folha de estilos `public/style.css` (`.crm-itens-cotados-table .crm-item-pnegociado`), garantindo leitura nítida e contraste padrão para o vendedor durante a cotação.
  - **Suíte de Testes:** 107 testes aprovados em `test_crm_standalone.js` (com asserções dedicadas para `#000000` e rejeição de `#38bdf8`).
- **v8.267 (25/09/2026):** Campo `Valor Total NFe` inalterável e cálculo automático no modal de Oportunidades do CRM:
  - **Navalha de Texto / Rótulo:** Substituição de `Valor Oportunidade:` por `Valor Total NFe:` em `public/crm.html` e `public/index.html`.
  - **Inalterabilidade Defensiva:** Campo `#crmInputValor` transformado em input inalterável (`readonly disabled tabindex="-1"` com `cursor: not-allowed` e estilo cinza translúcido idêntico a P. Tabela e Desc(%)), prevenindo divergências de digitação manual de valores com a NFe.
  - **Cálculo Automático & Reativo:** Implementação de `recalcularTotalNfeOportunidade()` aplicando estritamente $\text{Valor Total NFe} = \text{Soma Itens} + \text{Frete Cobrado}$, com exclusão do Frete Embutido (já embutido nos produtos). Recálculo dinâmico disparado por eventos nos itens cotados e digitação de Frete Cobrado (`input` / `change`).
  - **Defesas Red Team Adicionadas:** Proteção contra frete cobrado negativo (`Math.max(0, ...)`), monitoramento de fretes no dirty check (`isDealFormDirty()`), preservação de valor legado e parsing pt-BR no salvamento (`parseNumberPtBr`).
  - **Suíte de Testes:** 104 testes aprovados em `test_crm_standalone.js` (Teste 12 com 9 asserções dedicadas).
- **v8.266 (25/09/2026):** Inclusão da coluna `Desc(%)` na tabela de Itens Cotados na edição de oportunidades (`#modalCrmOportunidade`):
  - **Cálculo Automático de Desconto:** Implementação de `calcularDescontoPercent(pTab, pNeg)`, computando o percentual de desconto sobre o Preço de Tabela quando o Preço Negociado for menor que a tabela ($((P_{tab} - P_{neg}) / P_{tab}) \times 100$), exibindo `0,00` quando não houver desconto ou se o preço negociado for maior/igual à tabela.
  - **Formato Brasileiro Padronizado:** Exibição com 2 casas decimais no formato `99,99` via `formatNumberPtBr()` (ex: `15,00`, `22,50`, `0,00`).
  - **Reatividade em Tempo Real:** Recálculo instantâneo do desconto e do subtotal no evento `input` de digitação do Preço Negociado, sem perda de foco.
  - **Design Consistente & Inalterável:** Campo com largura compacta de `75px`, `readonly disabled tabindex="-1"`, alinhamento à direita e estilo idêntico a P. Tabela.
  - **Ajuste Ergonômico de Largura:** Redução da largura mínima do campo de descrição do produto de `340px` para `265px` no CSS (`public/style.css`), acomodando perfeitamente a nova coluna de `75px` sem gerar overflow horizontal no modal.
  - **Suíte de Testes:** 86 testes aprovados em `test_crm_standalone.js`.
- **v8.265 (25/09/2026):** Otimização ergonômica da tabela de Itens Cotados na edição de oportunidades (`#modalCrmOportunidade`), formatação brasileira com 2 casas decimais e inativação de preço de tabela:
  - **Navalha de Texto / Limpeza Visual:** Remoção da informação visual de NCM e Peso abaixo da descrição do produto na tabela de edição de itens (`renderItensCotadosTable()`), preservando integralmente os metadados fiscais e logísticos no modelo de dados do item (`item.ncm`, `item.pesoLiquido`) para relatórios, fichas e integração futura.
  - **Diminuição Compacta de Colunas:** Coluna Qtd reduzida para `55px` (adequada para 1 a 3 dígitos), P. Tabela reduzida para `95px` (adequada para até R$ 99.999,00), P. Negociado reduzida para `105px` (adequada para totais até R$ 999.000,00) e Total reduzida para `110px`, liberando folga horizontal planejada na tabela para a futura adição de nova coluna solicitada pelo usuário.
  - **P. Tabela Inalterável:** Campo cinza inabilitado de edição (`readonly disabled tabindex="-1"`, `background: rgba(148, 163, 184, 0.12)`, `cursor: not-allowed`) no 1º item e em todos os demais itens adicionados, impedindo alteração indevida de preço de tabela pelo vendedor.
  - **Formato Numérico Brasileiro (pt-BR):** Implementação de `formatNumberPtBr()` (duas casas decimais e separador de milhar brasileiro) para P. Tabela e P. Negociado, `parseNumberPtBr()` para parsing decimal flexível em tempo real na digitação, autoformatação em `blur` e seleção automática de texto em `focus` (67 testes aprovados em `test_crm_standalone.js`).
- **v8.264 (25/09/2026):** Validação compulsória dos 4 campos obrigatórios do Deal no modal de oportunidades (`Título da Oportunidade: *`, `Vendedor Responsável: *`, `Cliente: *`, `Faturado Por: *`). Rótulo com asterisco em Faturado Por: * e inclusão de atributo required. Rejeição do placeholder inicial "Selecione a empresa..." configurado com `value="" disabled selected`. Botão Salvar Oportunidade (`#btnSalvarCrmOportunidade`) mantido dinamicamente inativo (`disabled` com tooltip orientativo e cursor `not-allowed`) via `isDealFormValid()` e `updateDealSaveButtonState()` enquanto qualquer um dos 4 campos estiver ausente ou com placeholder, com reatividade imediata a eventos de digitação, seleção de vendedor, autocomplete de cliente e seleção de empresa (48 testes aprovados em `test_crm_standalone.js`).
- **v8.263 (25/09/2026):** Reposicionamento ergonômico no cabeçalho do CRM Comercial (`/crm` / `public/crm.html`), colocando o botão principal com fundo azul claro `➕ Nova Oportunidade` imediatamente antes do alternador de abas `📊 Funil de Oportunidades` e `👥 Clientes Cadastrados`, alinhando a ordem de leitura ocidental (Ação Principal ➔ Modos de Visualização ➔ Atualizar ➔ Utilidades) (34 testes aprovados em `test_crm_standalone.js`).
- **v8.262 (25/09/2026):** Unificação do Cabeçalho do CRM Comercial (`public/crm.html`), Eliminação da 2ª Faixa Informativa (Navalha de Texto / YAGNI) e Padronização dos Botões na Topbar com Destaque Exclusivo:
  - **Navalha de Texto no Título:** Redução do título para `Plataforma GSI — CRM Comercial`, eliminando o badge `Página Dedicada` e o subtítulo `Pipeline de Vendas, Cotações e Clientes B2B`.
  - **Eliminação da 2ª Faixa:** Remoção completa do container intermediário (`Pipeline Comercial Nativo — Gestão de oportunidades de vendas, cotações, carteira de clientes e follow-up`), reduzindo altura morta e trazendo o conteúdo analítico/pipeline imediatamente abaixo da barra superior.
  - **Elevação dos Controles Operacionais:** Os botões `#btnCrmViewKanban` (📊 Funil de Oportunidades), `#btnCrmViewClientes` (👥 Clientes Cadastrados), `#btnCrmNovaOportunidade` (➕ Nova Oportunidade) e `#btnCrmRefresh` (🔄 Atualizar) foram unificados na Topbar superior (`.crm-standalone-header`).
  - **Padronização Visual em 34px:** Todos os botões da barra superior foram padronizados com altura de `34px`, tipografia `0.8rem` e espaçamento equilibrado, idênticos a `☀️ Modo Claro` e `🏠 Voltar ao Portal`.
  - **Destaque Cromático Exclusivo:** O botão `➕ Nova Oportunidade` é o **único elemento com preenchimento azul claro (`var(--accent-blue, #38bdf8)`)**, texto de alto contraste `#0f172a` e sombra suave, direcionando o foco do operador para a ação mais frequente sem concorrência visual dos alternadores de visão ativos (que utilizam destaque neutro translúcido/branco).
  - **Suíte de Testes:** 33 testes aprovados em `test_crm_standalone.js`.
- **v8.261 (25/09/2026):** Implementação da **Página Dedicada Exclusiva (`/crm` / `public/crm.html`)** e do layout **Opção B (Modal Amplo com Seções Horizontais e Botão Maximizar / Tela Cheia estilo HubSpot)**:
  - **Página Standalone (`/crm`):** Rota Express canônica com `res.sendFile`, Auth Guard síncrono no `<head>` com redirecionamento inteligente pós-login (`?redirect=/crm`), heartbeat autenticado a cada 5 minutos, alternador nativo de Tema Claro/Escuro (`#btnToggleThemeCrmPage`), botão de retorno `🏠 Voltar ao Portal` e avatar do usuário logado. O botão `#btnTabBiCrm` no Portal GSI agora abre `/crm` em nova aba via `window.open('/crm', '_blank')` com fallback no DOM.
  - **Opção B (Modal Amplo Maximizável):** Modal `#modalCrmOportunidade` reestruturado em 3 blocos horizontais compactos (1. Identificação, 2. Condições Comerciais & Faturamento, 3. Tabela de Itens Cotados Protheus 100% da largura). Botão Maximizar `#btnCrmToggleMaximizeDealModal` comutando `.modal-maximized` (`calc(100vw - 16px)` × `calc(100vh - 16px)`) com expansão vertical da tabela para `48vh`.
  - **Proteção Anti-Queda Acidental no Backdrop:** Clique no overlay não fecha os modais (`modalCrmOportunidade`, `modalCrmDetalhes`, `modalCrmCliente`, `modalCrmPerdido`); em vez disso, aplica micro-animação `.crm-modal-shake` no `.modal-content` fornecendo feedback tátil e visual imediato.
  - **Proteção de Descarte (Dirty-Check):** Função `isDealFormDirty()` com comparação profunda de itens cotados (`JSON.stringify`) e campos comerciais; `closeModal(modal, force)` solicita confirmação antes de descartar dados preenchidos, com bypass automático `force = true` no salvamento (20 testes aprovados em `test_crm_standalone.js`).
- **v8.260 (24/09/2026):** Espelhamento e sincronização completa de transportadoras homologadas do Protheus (`SA4010` e `SA4160`, 1.151 registros) para o Super Banco de Dados (`crm_transportadoras` / Supabase Postgres + cache local atômico `crm_transportadoras_cache.json`). Campo "Transportadora Indicada" (`#crmInputTransportadora`) transformado em componente com autocomplete estrito (< 10ms) e botão `🔄 Atualizar` (`#btnCrmSyncTransportadoras`). Vinculação e persistência do código Protheus (`transportadora_cod` / `A4_COD`) em campo oculto `#crmInputTransportadoraCod` para preparo direto da migração do pedido de venda Protheus (`SC5.C5_TRANSP`), sem poluir a interface visual do vendedor. Suporte nativo à opção `000009 - CLIENTE RETIRA` para frete de retirada física independente do tipo FOB/CIF, validação estrita bloqueando nomes não homologados e preservação visual limpa no modal de detalhes `#crmDetalhesTransportadora` (10 testes aprovados em `test_crm_transportadoras.js`).
- **v8.259 (24/09/2026):** Adição do seletor "Faturado Por" (`#crmSelectFaturadoPor`) com as 3 empresas (`14 - METAL PLENO`, `15 - GSI COFRES`, `16 - OACO`) no Bloco 1 (Identificação da Oportunidade) do modal `#modalCrmOportunidade`. O campo Cliente foi redimensionado (`grid-template-columns: 2fr 1fr; gap: 12px;`) mantendo autocomplete e botões de atalho. O campo também passou a ser exibido no cabeçalho e na grade de condições comerciais do modal de visualização `#modalCrmDetalhes`, com persistência plena e normalização inteligente (8 testes aprovados em `test_crm_listagem.js`).
- **v8.258 (24/09/2026):** Remoção do checkbox inútil da listagem de oportunidades (`#crmDealsCheckAll` no cabeçalho e `.crm-deal-checkbox` nas linhas). Como não havia ações em massa implementadas, a coluna representava sobre-engenharia e poluição visual (YAGNI/Navalha de Design). A listagem agora consolida 9 colunas canônicas diretas, com a coluna "Ação" (Lápis e Lupa) sendo seguida imediatamente por "Título" (7 testes aprovados em `test_crm_listagem.js`).
- **v8.257 (24/09/2026):** Reformulação da tabela de Oportunidades do CRM e aplicação da Navalha de Texto: criação da coluna "Ação" em 1º lugar com botões de Lápis `✏️` (abre edição) e Lupa `🔍` (abre visualização), renomeação da coluna "Organização" para "Nome do Cliente", eliminação da coluna "Contato" e remoção da exibição do rótulo desnecessário "UM: UN" nos itens de propostas e produtos cotados (7 testes aprovados em `test_crm_listagem.js`).
- **v8.256 (24/09/2026):** Espelhamento Just-in-Time (*under-the-hood*) de clientes Protheus (`SA1010`) para o Super Banco (`crm_clientes` / Supabase Postgres + cache atômico). Novos clientes cadastrados diretamente no Super Banco; clientes localizados no Protheus são persistidos no Super Banco de forma transparente sem escrita em `SA1010` (somente-leitura estrito). Adicionados botões de ação rápida `#btnCrmEditarClienteFromDeal` (`✏️ Editar`) em `#modalCrmOportunidade` e `#btnCrmEditarClienteDoDetalhes` (`✏️ Editar`) em `#modalCrmDetalhes`. Botão `#btnCrmNovoClienteFromDeal` renomeado para `➕ Add Cliente`. Resolução multi-chave por ID, código Protheus (com pad de 6 dígitos) e CNPJ, tradução automática de vendedor `A1_VEND` para nome, fallback com pré-preenchimento do deal caso o cliente não exista, sincronização reativa com persistência no deal e atualização em tempo real de Kanban/Listagem (13 testes aprovados em `test_crm_clientes.js` e 10 em `test_crm_module.js`).
- **v8.255 (24/09/2026):** Ordenação estritamente decrescente na Linha do Tempo e Follow-up de Atividades (`#crmActivitiesTimeline`). Implementação do algoritmo central `sortActivitiesDesc` com critério cronológico decrescente (`dateB - dateA`) e desempate determinístico por ID, autocura automática (*self-healing*) de históricos prévios salvos desordenados no `localStorage` do navegador, ordenação defensiva em camadas (`saveActivitiesLocal`, `loadActivitiesLocal`, `loadDealActivities`, `handleAddActivity`, `renderActivitiesList`), secundária determinística no Postgres e fallback local no backend, e extensão da suíte de testes com validação matemática de timestamps (10 baterias aprovadas em `test_crm_module.js`).
- **v8.254 (24/09/2026):** Catálogo de Produtos Protheus (`SB1090`/`SB1160`) espelhado no Supabase PostgreSQL (`crm_produtos`) e cache local de contingência (`crm_produtos_cache.json`). Autocomplete inteligente (< 10ms) na tabela de itens cotados do modal de oportunidades, preenchimento automático de código, descrição, preço de tabela, NCM fiscal, peso líquido/bruto e UM, cálculo em tempo real de Peso Total da Proposta (`Σ qtd * peso`), botão `🔄 Sync Produtos` e RLS restrita (7 baterias completas aprovadas em `test_crm_produtos.js`).
- **v8.253 (24/09/2026):** Implementação dos novos filtros de status e proprietário no CRM Comercial: remoção da opção "Diretoria" do filtro de vendedores operacionais, renomeação de "Oportunidades Ativas" para "Oportunidades Abertas" (excluindo ganhos e perdidos), adição dos filtros "Somente Ganhas", "Ganhas Hoje" e "Ganhas Ontem" com tratamento resiliente de fuso horário UTC-3 (ISO e DateOnly), reset para "ABERTAS" no botão limpar e adição de acessibilidade `aria-label` (10 testes aprovados em `test_crm_filtros.js`).
- **v8.251 (24/09/2026):** Implementação da visualização em **Listagem** com seletor toggle `[ 📊 Kanban ]` / `[ 📋 Listagem ]`, persistência em `localStorage`, tabela paginada com 10 colunas canônicas alinhadas ao `listagem.png`, thead sticky, sanitização XSS estrita e preservação de campos `faturadoPor` e `contatoNome` (6 baterias funcionais aprovadas em `test_crm_listagem.js`).
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
