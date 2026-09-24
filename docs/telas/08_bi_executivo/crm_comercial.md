# CRM Comercial B2B

> **Macro-Área:** BI Executivo  
> **Identificador DOM:** `#tab-bi-crm` | **Botão:** `#btnTabBiCrm`  
> **Permissão RBAC:** admin, diretoria (BI)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 24/09/2026 (v8.251 - Homologado)  

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
- **Prevenção de Custo Duplo de Renderização:** O pipeline só renderiza no DOM o modo ativo (`kanban` ou `listagem`), poupando ciclos de CPU.
- **Preservação de Dados em Edição:** `contatoNome` e `faturadoPor` são preservados durante atualizações ou salvamento de oportunidades.
- **Sanitização XSS:** Todos os valores interpolados passam por `escapeHtml()` e valores numéricos por `parseFloat()`.

---

## 6. Endpoints REST da API
- `GET /api/bi/crm/deals`: Listagem dos negócios do funil com filtros.
- `POST /api/bi/crm/deals`: Criação de nova oportunidade comercial.
- `PUT /api/bi/crm/deals/:id`: Edição de oportunidade existente.
- `PUT /api/bi/crm/deals/:id/stage`: Transição atômica de estágio.
- `GET /api/bi/crm/clientes`: Listagem paginada de clientes comerciais.

---

## 7. Testes Automatizados Vinculados
- Execução da suíte completa de testes:
```bash
node test_crm_listagem.js
node test_crm_module.js
node test_crm_clientes.js
```

---

## 8. Histórico & Evolução da Tela
- **v8.251 (24/09/2026):** Implementação da visualização em **Listagem** com seletor toggle `[ 📊 Kanban ]` / `[ 📋 Listagem ]`, persistência em `localStorage`, tabela paginada com 10 colunas canônicas alinhadas ao `listagem.png`, thead sticky, sanitização XSS estrita e preservação de campos `faturadoPor` e `contatoNome` (6 baterias funcionais aprovadas em `test_crm_listagem.js`).
- **v8.219 (15/09/2026):** Documentação modular segregada sob arquitetura Hub-and-Spoke. Histórico consolidado e integrado ao Portal GSI.
