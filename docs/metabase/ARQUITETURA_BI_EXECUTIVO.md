# Arquitetura e Manual do Módulo de BI Executivo (Metabase + Supabase)

> **Módulo:** BI Executivo & Análise Estratégica (Single Sign-On Metabase Embedding)  
> **Data de Homologação em Produção:** 28/08/2026  
> **Status:** 100% Operacional e Integrado ao Portal GSI  
> **Público-Alvo:** CEO, CFO e Administradores da Plataforma GSI  

---

## 1. Visão Geral e Propósito Executivo
O módulo de **BI Executivo** é um hub de inteligência estratégica integrado diretamente na **Plataforma de Apoio GSI (Gemini-Cli)**. Ele fornece ao CEO e CFO monitoramento em tempo real de:
1. **Saldos Físicos e Financeiros de Estoque Multi-Empresa** (Metal Pleno 14, GSI 15 e OACO 16).
2. **Vendas em Carteira (SC6) vs. Compras em Aberto (SC7)** com detecção de rupturas e ponto de pedido.
3. **Concentração e Demanda por Grupos de Produtos** cobrindo 100% dos 33 Grupos do Protheus (`SBM010`).
4. **Histórico de Análise de Crédito Comercial & Motor de Risco** (Scores, limites monetários e decisões).
5. **Trilhas de Auditoria, Segurança e Telemetria de Operadores** (Logins, 2FA, consultas).

A integração utiliza o padrão **JWT Signed Embedding** do Metabase, permitindo que o painel seja renderizado dentro da aba `📊 BI EXECUTIVO` do portal sem exigir nova digitação de usuário ou senha, com segurança ponta a ponta.

---

## 2. Mapa de Infraestrutura e Arquitetura em Nuvem

```mermaid
graph TD
    User["👨‍💼 CEO / CFO (Navegador)"]
    Portal["🌐 Portal GSI (conciliacao-fretes.onrender.com)"]
    BackendNode["⚙️ Backend Node.js (services/bi_service.js)"]
    MetabaseApp["📊 Metabase BI (bi-gsi.onrender.com - 2GB RAM / 1 CPU)"]
    SupabaseDB["🐘 Supabase PostgreSQL (ca-central-1 Canadá)"]
    ProtheusERP["🏢 TOTVS Protheus ERP (SQL Server Cloud)"]

    User -->|"1. Acessa Aba BI Executivo"| Portal
    Portal -->|"2. GET /api/bi/dashboard-executivo (JWT Auth)"| BackendNode
    BackendNode -->|"3. Gera URL com Token HMAC-SHA256 (exp: 10 min)"| Portal
    Portal -->|"4. Renderiza iFrame Seguro"| MetabaseApp
    MetabaseApp -->|"5. Executa Consultas SQL Analíticas"| SupabaseDB
    SupabaseDB <-->|"Sincronização Periódica de Vendas/Estoque/Compras"| ProtheusERP
```

### Componentes de Nuvem
1. **Portal GSI (`conciliacao-fretes.onrender.com`):**
   * Web Service Node.js no Render com Single Page Application (SPA).
2. **Metabase BI Engine (`bi-gsi.onrender.com`):**
   * Container Docker oficial (`metabase/metabase:v0.49.13`) rodando em instância Pro com **2 GB de RAM e 1 CPU**.
3. **Data Warehouse Analítico (`Supabase PostgreSQL`):**
   * Região: `ca-central-1` (Canadá).
   * Host Pooler: `aws-0-ca-central-1.pooler.supabase.com:5432`.
   * Banco relacional com Row-Level Security (RLS) e Views Analíticas otimizadas.

---

## 3. Estrutura Modular do Código-Fonte

O código do módulo de BI foi desenvolvido de forma 100% desacoplada para não inflar os arquivos principais do sistema:

```text
Gemini-Cli/
├── services/
│   └── bi_service.js               # Serviço backend: Geração de URLs assinadas JWT (HMAC-SHA256)
├── public/
│   ├── js/
│   │   └── bi.js                   # Controlador frontend do BI (iFrame, loading, fullscreen, SSO)
│   ├── index.html                  # Botão 'mainTabBi' e container da aba '#tab-bi-executivo'
│   ├── app.js                      # Roteamento de abas e controle de permissões RBAC
│   └── style.css                   # Estilos com escopo isolado (.bi-wrapper, .bi-iframe-wrapper, etc.)
├── sql/
│   └── bi/
│       ├── 00_tabela_grupos_sbm.sql                 # Tabela e seeding dos 33 grupos do Protheus SBM010
│       ├── 01_vw_produtos_estoque.sql               # View multi-empresa de saldos, SC6, SC7 e rupturas
│       ├── 02_vw_analise_credito.sql                # View de histórico de análise de crédito e scores
│       ├── 03_vw_atividades_auditoria.sql           # View de telemetria, segurança e logs de operadores
│       └── 04_vw_demandas_grupos_comerciais.sql     # View agregada por grupos comerciais (001 a 091)
├── docs/
│   └── metabase/
│       ├── GUIA_SETUP_METABASE.md                   # Guia passo a passo de deploy e setup
│       └── ARQUITETURA_BI_EXECUTIVO.md              # Este documento de arquitetura consolidada
└── test_bi_embed.js                # Suíte de testes automatizados com 7 asserções
```

---

## 4. Camada de Dados no Supabase (DDL & SQL Views)

### 4.1 Tabela de Cadastro dos 33 Grupos Oficiais (`SBM010`)
* **Tabela:** `grupos_produtos_sbm`
* **Campos:** `codigo VARCHAR(10) PRIMARY KEY`, `descricao VARCHAR(100)`, `ativo BOOLEAN`, `created_at TIMESTAMP`.
* **Grupos Mapeados:**
  * `001 - COFRES`
  * `002 - FRAGMENTADORAS`
  * `003 - CONTADORAS`
  * `004 - DESUMIDIFICADORES`
  * `005 - DETECTORES DE METAL`
  * `006 - ENCADERNACAO`
  * `007 - GUILHOTINAS`
  * `008 - GUARDA VOLUMES`
  * `009 - LIXEIRAS`
  * `010 - PLASTIFICACAO`
  * `011 - PORTA CHAVES`
  * `012 - REFILADORAS`
  * `013 - SELADORAS`
  * `014 - ERGONOMICOS`
  * `015 - SUPORTES P/ PASTA SUSPENSA`
  * `016 - VENTILADORES E CLIMATIZADORES`
  * `017 - RACKS`
  * `018 - MOBILIARIO / ARMARIOS`
  * `019 - ARMAZENAMENTO STORAGE`
  * `020 - CARRINHOS DE CARGA`
  * `021 - PORTAS BLINDADAS`
  * `022 - FILME PLASTICO P/ EMBALAGEM`
  * `023 - ORGANIZACAO E TRANSPORTE DE VALORES`
  * `024 - CACA E CAMPING`
  * `025 - ACESSORIOS PARA VEICULOS`
  * `026 - ESPORTE E LAZER`
  * `027 - MATERIAL DE ESCRITORIO`
  * `028 - BEBEDOUROS`
  * `029 - LIMPEZA MAQ E SUPRIMENTOS`
  * `030 - INDUSTRIA ALIMENTICIA`
  * `044 - INFORMATICA`
  * `090 - INSUMOS EM GERAL`
  * `091 - INSUMOS PRODUCAO COFRES`

### 4.2 Views Analíticas Criadas
1. **`vw_bi_produtos_estoque`:**
   * Detalha produto a produto com preço unitário, saldo total físico, valor em estoque (R$), vendas em carteira SC6 (qtd e R$), compras em aberto SC7 (qtd e R$), ponto de pedido e saldos discriminados de **Metal Pleno 14**, **GSI 15** e **OACO 16**.
   * Indicadores automáticos: `status_disponibilidade` (*Com Saldo / Zerado*) e `status_abastecimento` (*Ruptura com Pedido Pendente / Abaixo do Ponto de Pedido / Estoque Normal*).
2. **`vw_bi_demandas_grupos_comerciais`:**
   * Agrupa e totaliza produtos cadastrados, produtos com saldo, produtos zerados, valor financeiro em estoque, valor de vendas pendentes e valor de compras em aberto por grupo comercial.
3. **`vw_bi_analise_credito`:**
   * Extrai o histórico imutável das análises de crédito: número do pedido, cliente, CNPJ, valor total do pedido, score final (0 a 100), classificação de risco (*Risco Mínimo, Baixo, Médio, Alto, Crítico*), decisão operacional do analista (*Liberado, Liberar com Entrada, Bloqueado, etc.*), identificação do analista e flags Serasa/Receita/FGTS.
4. **`vw_bi_atividades_auditoria`:**
   * Consolida a telemetria operacional dos operadores: logins, 2FA, consultas de crédito, gravações e sincronizações manuais com data e hora.
5. **`vw_bi_faturamento_mensal`:**
   * Evolução temporal do faturamento mês a mês: receita de mercadorias (R$), volume de notas fiscais emitidas, total de clientes atendidos, total de unidades faturadas e cálculo de ticket médio por NF.
6. **`vw_bi_faturamento_grupo_mes`:**
   * Faturamento e vendas mês a mês categorizado pelos 33 Grupos de Produtos do Protheus (`SBM010` — Cofres, Fragmentadoras, etc.), volume de peças e pedidos faturados.
7. **`vw_bi_faturamento_vendedor_mes`:**
   * Faturamento mês a mês aberto por consultor comercial (vendedor), total de pedidos e ticket médio individual.

---

## 5. Segurança, Criptografia & JWT Signed Embedding

A incorporação do Metabase segue as melhores práticas de segurança de dados (Zero-Trust):

```mermaid
sequenceDiagram
    participant Browser as "Navegador do Usuário"
    participant PortalAPI as "API GSI (/api/bi/dashboard-executivo)"
    participant Metabase as "Metabase Server (bi-gsi)"

    Browser->>PortalAPI: GET /api/bi/dashboard-executivo (Authorization: Bearer <JWT_GSI>)
    Note over PortalAPI: Valida identidade do usuário.<br/>Exige role === 'admin' ou alexandre (RBAC).
    PortalAPI->>PortalAPI: Gera Token JWT com METABASE_SECRET_KEY<br/>Payload: { resource: { dashboard: 1 }, params: {}, exp: +10min }
    PortalAPI-->>Browser: Retorna { success: true, embedUrl: "https://bi-gsi.onrender.com/embed/dashboard/eyJhbGciOi..." }
    Browser->>Metabase: Carrega iframe com token assinado
    Metabase->>Metabase: Valida assinatura HMAC-SHA256 e expiração
    Metabase-->>Browser: Renderiza painel seguro (sem bordas e sem cabeçalhos)
```

### Regras de Segurança Aplicadas:
* **Validade Efêmera:** Os tokens de incorporação expiram em **10 minutos** (`exp: Math.floor(Date.now() / 1000) + 600`), prevenindo reutilização de URLs em histórico.
* **Bloqueio Anti-IDOR / RBAC:** Usuários com perfil `vendedor` ou `user` recebem **HTTP 403 Forbidden** ao tentar acessar a rota `/api/bi/dashboard-executivo`.
* **Interface Restrita:** O botão `mainTabBi` só é visível no DOM caso `user.role === 'admin'` ou `user.username === 'alexandre'`.
* **Limpeza de UI (Seamless UX):** O iframe é gerado com os parâmetros `#bordered=false&titled=false&theme=<light|night>`, integrando-se visualmente como se fosse um componente nativo da SPA.

---

## 6. Variáveis de Ambiente de Produção

### No Serviço Principal (`conciliacao-fretes` no Render):
| Variável | Descrição | Exemplo |
| :--- | :--- | :--- |
| **`METABASE_SITE_URL`** | URL base do servidor Metabase | `https://bi-gsi.onrender.com` |
| **`METABASE_SECRET_KEY`** | Chave secreta de 64 caracteres gerada no Metabase | `9f8a7b6c5d4e3f...` |
| **`METABASE_EXEC_DASHBOARD_ID`** | ID do Dashboard principal no Metabase | `1` |
| **`DATABASE_URL`** | String de conexão do pooler Supabase | `postgresql://postgres.kxcfqjupakdaqshnhxlx:[SENHA]@aws-0-ca-central-1.pooler.supabase.com:5432/postgres` |
| **`DATABASE_PASS`** | Senha do banco PostgreSQL Supabase | *(Senha segura configurada)* |

### No Serviço Metabase (`bi-gsi` no Render):
| Variável | Descrição | Valor |
| :--- | :--- | :--- |
| **`PORT`** | Porta de escuta da aplicação | `3000` |
| **`MB_JETTY_PORT`** | Porta interna do servidor Jetty | `3000` |
| **`MB_PLUGINS_DIR`** | Diretório de drivers desnecessários | `/tmp/empty` |
| **`JAVA_OPTS`** | Parâmetros de alocação de memória da JVM | `-Xmx1200m -Xms512m` |

---

## 7. Suíte de Testes Automatizados (`test_bi_embed.js`)

Para assegurar estabilidade contínua e prevenir regressões, foi criada uma suíte de testes com **7 asserções automatizadas**:

1. `Detecta status não configurado graciosamente quando envs estão ausentes`
2. `Detecta status configurado corretamente e gera URL assinada`
3. `Rejeita acesso não autenticado com 401 Unauthorized`
4. `Bloqueia acesso de Vendedor com 403 Forbidden`
5. `Bloqueia acesso de Usuário Operador com 403 Forbidden`
6. `Permite acesso de Administrador (CEO/CFO) com 200 OK e URL assinada`
7. `Endpoint /api/bi/status retorna metadados de configuração para admin`

Para rodar a suíte localmente:
```bash
node test_bi_embed.js
```

---

## 8. Guia Rápido de Operação e Criação de Novos Dashboards

1. **Acesso Direto ao Metabase para Edição:** [https://bi-gsi.onrender.com](https://bi-gsi.onrender.com)
2. **Adicionar Novos Gráficos:**
   * Clique em **`+ Novo`** > **`Pergunta`** > Escolha **`Supabase GSI`**.
   * Selecione uma das views (ex: `vw_bi_demandas_grupos_comerciais`).
   * Escolha a visualização (*Barras, Linhas, Pizza, Indicador Numérico, Tabela com Barras de Progresso*).
   * Salve e adicione ao **Dashboard 1**.
3. **Visualização Executiva Consolidada:**
   * Acesse o Portal GSI em **[https://conciliacao-fretes.onrender.com](https://conciliacao-fretes.onrender.com)**.
   * Clique na aba **`📊 BI EXECUTIVO`**.
   * Use o botão **`⛶ Tela Cheia`** para apresentações ou reuniões de diretoria.
   * Use o botão **`🔄 Atualizar`** para forçar sincronização instantânea dos dados.
