# CRM Comercial B2B

> **Macro-Área:** BI Executivo  
> **Identificador DOM:** `#tab-bi-crm` | **Botão:** `#btnTabBiCrm`  
> **Permissão RBAC:** admin, diretoria (BI)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 25/09/2026 (v8.263 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Pipeline comercial nativo de vendas, alternância flexível entre modo **Kanban** (5 fases canônicas: Lead, Contato, Proposta, Negociação, Ganho) e modo **Listagem** tabular com 10 colunas canônicas idênticas ao Pipedrive (`listagem.png`), gestão de clientes B2B com espelhamento Just-in-Time da base Protheus (`SA1010`) para o Super Banco (`crm_clientes`), e atividades de follow-up.
- **Personas Atendidas:** admin, diretoria (BI)

---

## 2. Arquitetura de Código & Componentes
- **Frontend (View):** `public/index.html` (aba `#tab-bi-crm`, containers `#crmKanbanContainer` e `#crmListagemContainer`, modais `#modalCrmOportunidade`, `#modalCrmDetalhes` e `#modalCrmCliente`).
- **Frontend (Controller):** `public/js/crm.js` (estado `dealViewMode`, `setDealViewMode`, `renderListagemBoard`, `renderKanbanBoard`, `abrirModalCliente`, sincronização e filtros).
- **Backend / Rotas:** `crm_routes.js` (prefixo `/api/bi/crm/deals`, `/api/bi/crm/clientes`), `crm_engine.js`, `postgres_db.js`.

---

## 3. Identificadores DOM & Controles da Interface
- **Barra de Busca e Filtros de Deals:**
  - `#crmSearchInput`: Busca textual dinâmica com debounce e sanitização.
  - `#crmFilterVendedor`: Seletor de proprietário/vendedor (exclui Diretoria, focado em vendedores operacionais).
  - `#crmFilterStatus`: Seletor de status com 6 opções canônicas: `ABERTAS` ("Oportunidades Abertas"), `TODOS` ("Todas (inclui Perdidos)"), `GANHO` ("Somente Ganhas"), `GANHO_HOJE` ("Ganhas Hoje"), `GANHO_ONTEM` ("Ganhas Ontem") e `PERDIDO` ("Somente Perdidos").
  - `#btnCrmLimparFiltros`: Botão de reset rápido, restaurando status para `ABERTAS` e vendedor para `TODOS`.
- **Ações Rápidas de Cliente & Faturamento no Modal de Oportunidades & Detalhes:**
  - `#crmSelectFaturadoPor`: Seletor de empresa faturadora no Bloco 1 (📌 Identificação da Oportunidade) com as 3 empresas canônicas (`14 - METAL PLENO`, `15 - GSI COFRES`, `16 - OACO`). O container do Cliente foi redimensionado (`grid-template-columns: 2fr 1fr; gap: 12px;`) para acomodar o seletor com alinhamento vertical e harmonia visual.
  - `#crmDetalhesFaturadoPorBadge` / `#crmDetalhesFaturadoPor`: Exibição explícita da empresa de faturamento na modal de visualização e detalhes (`#modalCrmDetalhes`), visível no cabeçalho da oportunidade e na grade de Condições Comerciais & Faturamento.
  - `#btnCrmNovoClienteFromDeal`: Renomeado para `➕ Add Cliente` (abre modal de cadastro rápido sem sair da oportunidade).
  - `#btnCrmEditarClienteFromDeal`: Botão compacto `✏️ Editar` ao lado do autocomplete de cliente em `#modalCrmOportunidade`, permitindo editar o cadastro comercial do cliente selecionado.
  - `#btnCrmEditarClienteDoDetalhes`: Botão compacto `✏️ Editar` ao lado do nome da organização no cabeçalho do `#modalCrmDetalhes`.
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

## 4. As 9 Colunas Canônicas da Listagem
| Coluna | Descrição | Comportamento |
| :--- | :--- | :--- |
| **Ação** | Ações Rápidas | Botões compactos: Lápis `✏️` (abre edição da oportunidade) e Lupa `🔍` (abre visualização de detalhes) |
| **Título** | Nome da Oportunidade | Link verde (`#10b981`) que abre modal de detalhes da oportunidade |
| **Valor** | Valor total negociado | Formatado em reais (`R$ X.XXX,XX`) com destaque verde |
| **Nome do Cliente** | Razão Social / Nome do Cliente | Exibição com tooltip e ellipsis para nomes longos (substitui antiga coluna Organização) |
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
- **Espelhamento Just-in-Time Protheus ➔ Super Banco (`crm_clientes`):** Ao consultar um cliente por código ou CNPJ (ou ao editar de uma oportunidade), se o cliente residir apenas na tabela `SA1010` do ERP Protheus, o motor `obterClientePorId` executa um espelhamento sob demanda (*Just-in-Time Mirroring*) atômico no PostgreSQL (`crm_clientes`) e cache de contingência (`crm_clientes_cache.json`), mapeando razão social, CNPJ, contatos, dados de faturamento/NFS-e e o nome do vendedor (`getNomeVendedor(A1_VEND)`).
- **Resolução Multi-Chave & Pad Numérico:** Suporte a busca por ID interno (`CLI-...`), código Protheus exato (`004128`), código sem zeros (`4128` com `padStart(6, '0')`) e dígitos de CNPJ.
- **Sincronização Reativa do Negócio:** Ao salvar alterações do cliente a partir de um deal existente, o backend atualiza automaticamente o negócio vinculado e aciona `renderDealsViews()`, sincronizando o card do Kanban e da Listagem sem necessidade de recarregar a página.
- **Fallback Resiliente no Modal:** Se o identificador procurado não existir no banco nem no Protheus, o modal não abre vazio: os dados conhecidos do deal (`nome`, `cnpj`, `vendedor`) são pré-carregados para cadastro imediato.
- **Navalha de Texto em Itens Cotados:** Remoção do rótulo redundante "UM: UN" na exibição dos itens cotados da modal de oportunidade, no modal de detalhes e nas sugestões de produtos, mantendo a interface enxuta e focada em NCM e Peso.
- **Coluna Ação com Acesso Rápido:** Primeira coluna da listagem tabular de oportunidades reservada para ações rápidas com botões de Lápis `✏️` (abre edição) e Lupa `🔍` (abre visualização de detalhes), alinhando a coluna "Nome do Cliente" (antiga Organização) e eliminando a coluna "Contato".

---

## 6. Endpoints REST da API
- `GET /api/bi/crm/deals`: Listagem dos negócios do funil com filtros.
- `GET /api/bi/crm/vendedores`: Lista de vendedores operacionais ativos (sem Diretoria).
- `POST /api/bi/crm/deals`: Criação de nova oportunidade comercial.
- `PUT /api/bi/crm/deals/:id`: Edição de oportunidade existente.
- `PUT /api/bi/crm/deals/:id/stage`: Transição atômica de estágio.
- `GET /api/bi/crm/clientes`: Listagem paginada de clientes comerciais.
- `GET /api/bi/crm/clientes/:id`: Consulta multi-chave de cliente (ID interno, Código Protheus ou CNPJ) com espelhamento Just-in-Time automático do Protheus `SA1010` para o super banco.
- `POST /api/bi/crm/clientes`: Criação ou edição com distinção estrita de espelhamento e inserção idempotente `ON CONFLICT (id) DO UPDATE`.
- `GET /api/bi/crm/produtos/autocomplete`: Busca instantânea de produtos no catálogo espelhado com suporte a termo `q`, `limite` e `apenasAtivos`.
- `POST /api/bi/crm/produtos/sync`: Sincronização em lote do catálogo oficial Protheus (`SB1090`/`SB1160`) com o Supabase e cache local.
- `GET /api/bi/crm/produtos/status`: Telemetria de total de produtos ativos, bloqueados, última sincronização e origem.
- `GET /api/bi/crm/transportadoras/autocomplete`: Busca inteligente de transportadoras homologadas no Protheus por código, razão social, fantasia ou CNPJ.
- `POST /api/bi/crm/transportadoras/sync`: Sincronização manual e sob demanda do cadastro Protheus (`SA4010`/`SA4160`) para o Super Banco.
- `GET /api/bi/crm/transportadoras/status`: Telemetria de transportadoras ativas, bloqueadas e data da última sincronização.

---

## 7. Testes Automatizados Vinculados
- Execução da suíte completa de testes:
```bash
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
