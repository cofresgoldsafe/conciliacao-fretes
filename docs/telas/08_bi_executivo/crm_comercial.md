# CRM Comercial B2B

> **Macro-Área:** BI Executivo  
> **Identificador DOM:** `#tab-bi-crm` | **Botão:** `#btnTabBiCrm`  
> **Permissão RBAC:** admin, diretoria (BI)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 24/09/2026 (v8.253 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Pipeline comercial nativo de vendas, alternância flexível entre modo **Kanban** (5 fases canônicas: Lead, Contato, Proposta, Negociação, Ganho) e modo **Listagem** tabular com 10 colunas canônicas idênticas ao Pipedrive (`listagem.png`), gestão de clientes B2B e atividades de follow-up.
- **Personas Atendidas:** admin, diretoria (BI)

---

## 2. Arquitetura de Código & Componentes
- **Frontend (View):** `public/index.html` (aba `#tab-bi-crm`, containers `#crmKanbanContainer` e `#crmListagemContainer`).
- **Frontend (Controller):** `public/js/crm.js` (estado `dealViewMode`, `setDealViewMode`, `renderListagemBoard`, `renderKanbanBoard`, paginação e filtros).
- **Backend / Rotas:** `crm_routes.js` (prefixo `/api/bi/crm/deals`, `/api/bi/crm/clientes`), `crm_engine.js`, `postgres_db.js`.

---

## 3. Identificadores DOM & Controles da Interface
- **Barra de Busca e Filtros de Deals:**
  - `#crmSearchInput`: Busca textual dinâmica com debounce e sanitização.
  - `#crmFilterVendedor`: Seletor de proprietário/vendedor (exclui Diretoria, focado em vendedores operacionais).
  - `#crmFilterStatus`: Seletor de status com 6 opções canônicas: `ABERTAS` ("Oportunidades Abertas"), `TODOS` ("Todas (inclui Perdidos)"), `GANHO` ("Somente Ganhas"), `GANHO_HOJE` ("Ganhas Hoje"), `GANHO_ONTEM` ("Ganhas Ontem") e `PERDIDO` ("Somente Perdidos").
  - `#btnCrmLimparFiltros`: Botão de reset rápido, restaurando status para `ABERTAS` e vendedor para `TODOS`.
- **Toggles de Exibição de Oportunidades:**
  - `#btnCrmViewModeKanban`: Ativa modo de exibição em funil Kanban.
  - `#btnCrmViewModeListagem`: Ativa modo de exibição em tabela de listagem.
- **Estrutura da Listagem de Deals:**
  - `#crmListagemContainer`: Container com `.table-responsive` e scroll vertical `max-height: 68vh`.
  - `#crmDealsTable`: Tabela com cabeçalho sticky (`position: sticky; top: 0`).
  - `#crmDealsTableTbody`: Linhas de negócios paginadas com sanitização XSS estrita.
  - `#crmDealsCheckAll`: Checkbox no `thead` para seleção individual/lote.
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
| **`[ ]`** | Checkbox de Seleção | Permite seleção individual ou global via cabeçalho |
| **Título** | Nome da Oportunidade | Link verde (`#10b981`) que abre modal de detalhes da oportunidade |
| **Valor** | Valor total negociado | Formatado em reais (`R$ X.XXX,XX`) com destaque verde |
| **Organização** | Razão Social / Nome do Cliente | Exibição com tooltip e ellipsis para nomes longos |
| **Contato** | Pessoa de Contato Principal | Nome do contato comercial do cliente |
| **Status** | Estágio atual do pipeline | Destaque verde para `Ganho`, vermelho para `Perdido` |
| **Faturado Por** | Filial de faturamento Protheus | Ex: `16 - OACO`, `14 - METAL PLENO`, `15 - GOLD SAFE` |
| **Cond. Pgto** | Condição de Pagamento negociada | Ex: `053-1X PIX`, `31 - PAGAR ME (LINK ...)`, `28 DDL` |
| **ID** | Código identificador do deal | Link verde (`#10b981`) que abre modal de detalhes |
| **Proprietário** | Vendedor responsável | Nome do vendedor responsável pela oportunidade |

---

## 5. Regras de Negócio & Cálculos Chave
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

---

## 6. Endpoints REST da API
- `GET /api/bi/crm/deals`: Listagem dos negócios do funil com filtros.
- `GET /api/bi/crm/vendedores`: Lista de vendedores operacionais ativos (sem Diretoria).
- `POST /api/bi/crm/deals`: Criação de nova oportunidade comercial.
- `PUT /api/bi/crm/deals/:id`: Edição de oportunidade existente.
- `PUT /api/bi/crm/deals/:id/stage`: Transição atômica de estágio.
- `GET /api/bi/crm/clientes`: Listagem paginada de clientes comerciais.
- `GET /api/bi/crm/produtos/autocomplete`: Busca instantânea de produtos no catálogo espelhado com suporte a termo `q`, `limite` e `apenasAtivos`.
- `POST /api/bi/crm/produtos/sync`: Sincronização em lote do catálogo oficial Protheus (`SB1090`/`SB1160`) com o Supabase e cache local.
- `GET /api/bi/crm/produtos/status`: Telemetria de total de produtos ativos, bloqueados, última sincronização e origem.

---

## 7. Testes Automatizados Vinculados
- Execução da suíte completa de testes:
```bash
node test_crm_produtos.js
node test_crm_filtros.js
node test_crm_listagem.js
node test_crm_module.js
node test_crm_clientes.js
```

---

## 8. Histórico & Evolução da Tela
- **v8.255 (24/09/2026):** Ordenação estritamente decrescente na Linha do Tempo e Follow-up de Atividades (`#crmActivitiesTimeline`). Implementação do algoritmo central `sortActivitiesDesc` com critério cronológico decrescente (`dateB - dateA`) e desempate determinístico por ID, autocura automática (*self-healing*) de históricos prévios salvos desordenados no `localStorage` do navegador, ordenação defensiva em camadas (`saveActivitiesLocal`, `loadActivitiesLocal`, `loadDealActivities`, `handleAddActivity`, `renderActivitiesList`), secundária determinística no Postgres e fallback local no backend, e extensão da suíte de testes com validação matemática de timestamps (10 baterias aprovadas em `test_crm_module.js`).
- **v8.254 (24/09/2026):** Catálogo de Produtos Protheus (`SB1090`/`SB1160`) espelhado no Supabase PostgreSQL (`crm_produtos`) e cache local de contingência (`crm_produtos_cache.json`). Autocomplete inteligente (< 10ms) na tabela de itens cotados do modal de oportunidades, preenchimento automático de código, descrição, preço de tabela, NCM fiscal, peso líquido/bruto e UM, cálculo em tempo real de Peso Total da Proposta (`Σ qtd * peso`), botão `🔄 Sync Produtos` e RLS restrita (7 baterias completas aprovadas em `test_crm_produtos.js`).
- **v8.253 (24/09/2026):** Implementação dos novos filtros de status e proprietário no CRM Comercial: remoção da opção "Diretoria" do filtro de vendedores operacionais, renomeação de "Oportunidades Ativas" para "Oportunidades Abertas" (excluindo ganhos e perdidos), adição dos filtros "Somente Ganhas", "Ganhas Hoje" e "Ganhas Ontem" com tratamento resiliente de fuso horário UTC-3 (ISO e DateOnly), reset para "ABERTAS" no botão limpar e adição de acessibilidade `aria-label` (10 testes aprovados em `test_crm_filtros.js`).
- **v8.251 (24/09/2026):** Implementação da visualização em **Listagem** com seletor toggle `[ 📊 Kanban ]` / `[ 📋 Listagem ]`, persistência em `localStorage`, tabela paginada com 10 colunas canônicas alinhadas ao `listagem.png`, thead sticky, sanitização XSS estrita e preservação de campos `faturadoPor` e `contatoNome` (6 baterias funcionais aprovadas em `test_crm_listagem.js`).
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
