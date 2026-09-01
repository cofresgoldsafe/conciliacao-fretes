# 📘 Documentação Completa: Plataforma de Apoio GSI Multi-Empresas & Protheus

> **Documento de Gestão, Arquitetura e Aperfeiçoamento (Pronto para Notion)**  
> **Status:** Operacional e Publicado na Nuvem 24/7 (Alta Disponibilidade com Supabase RLS, Autenticação 2FA e Job de Estoque)  
> **Link do Sistema:** `https://conciliacao-fretes.onrender.com`  
> **Repositório GitHub:** `https://github.com/cofresgoldsafe/conciliacao-fretes`  
> **Segurança:** Documento livre de credenciais sensíveis, senhas ou tokens de API.

---

## 🏛️ 1. Arquitetura do Sistema e Topologia em Nuvem

O ecossistema da **Plataforma de Apoio GSI Multi-Empresas** é composto por serviços integrados em nuvem com alta resiliência e fail-safe:

```
[ Usuários / Equipe Comercial / Financeiro / Logística ]
                          │
                          ▼ (HTTPS / JWT / 2FA)
┌─────────────────────────────────────────────────────────────┐
│ 1. Portal Web & Backend Node.js Express (Render)            │
│    https://conciliacao-fretes.onrender.com                  │
│    ├─ Single Page Application (HTML5 / Vanilla JS / CSS)    │
│    ├─ Middlewares JWT, RBAC, Rate Limiting, CORS            │
│    ├─ Motor de Análise de Crédito & Score Comercial         │
│    ├─ Sincronizador Agendado de Estoque (Job 60min)         │
│    ├─ Integração mTLS Banco Inter & Webhooks idempotentes   │
│    └─ Driver de E-mail 2FA (Mailjet REST API 443 / SMTP)   │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼ (TCP Pooler SSL)              ▼ (REST API / X-API-Key)
┌──────────────────────────────┐ ┌──────────────────────────────┐
│ 2. PostgreSQL (Supabase)     │ │ 3. API Protheus (Railway)    │
│    ├─ users (RBAC, 2FA, vend)│ │    FastAPI + ODBC SQL Server │
│    ├─ produtos_saldo_estoque │ └──────────────┬───────────────┘
│    ├─ estoque_sync_logs      │                │
│    ├─ analise_credito_history│                ▼ (Consultas Otimizadas)
│    ├─ user_activities        │ ┌──────────────────────────────┐
│    ├─ user_2fa_tokens        │ │ 4. Banco SQL Server Protheus │
│    ├─ inter_webhook_events   │ │    Base: CNVYB3_184594_PR_PD │
│    ├─ system_configs         │ │    Empresas: 14 (MP),        │
│    └─ history                │ │              15 (GSI),       │
│    * Row-Level Security (RLS)│ │              16 (OACO)       │
└──────────────────────────────┘ └──────────────────────────────┘
```

---

### 🌐 Resumo dos Serviços e Links do Ecossistema:

| Componente / Portal | URL / Endereço | Descrição & Função |
| :--- | :--- | :--- |
| **Portal Web & API (Render)** | `https://conciliacao-fretes.onrender.com` | Interface Web 24/7 com autenticação JWT/2FA, conciliação, estoque, pedidos, crédito e comissões. |
| **Ambiente Local** | `http://localhost:3000` | Servidor Node.js de desenvolvimento e testes. |
| **Repositório GitHub** | `https://github.com/cofresgoldsafe/conciliacao-fretes` | Código-fonte versionado em Node.js, HTML5, CSS3, JavaScript e Python. |
| **API Protheus (Railway)** | `https://protheus-api-production.up.railway.app` | Backend FastAPI que executa queries seguras de leitura no banco SQL Server Protheus. |
| **Banco Protheus (SQL Server)** | `CNVYB3_184594_PR_PD` | Base de dados do ERP Protheus contendo as empresas Metal Pleno (14), GSI (15) e OACO (16). |
| **Banco Relacional (Supabase)** | PostgreSQL Nuvem com Pooler SSL | Persistência de usuários, tokens 2FA, saldos de estoque sincronizados, auditoria e crédito com RLS. |

---

## 🧭 2. Estrutura de Navegação da Plataforma (6 Abas Principais & 17 Sub-Abas)

---

### 📦 1. ABA LOGÍSTICA
* **Sub-aba `[ Ped. pra Faturar ]` (Página Inicial / Padrão):**
  * Listagem em tempo real de pedidos liberados para faturamento no Protheus aderente às regras oficiais da rotina **MATA460A (Legenda Verde)** (`SC9` liberado sem bloqueio de estoque/crédito, sem nota fiscal ativa em `SF2` e `C5_NOTA` em aberto/reaberto).
  * Multi-empresa (MP 14, GSI 15, OACO 16 com pedido `000221`), KPIs de pedidos, peças e valor total, link oficial para CRM Pipedrive (`https://benetroncomercial.pipedrive.com/deal/...`) e clique no pedido com modal de detalhes completos.
* **Sub-aba `[ Ped. Lib Estoque ]`:**
  * Cruzamento inteligente em tempo real entre pedidos com bloqueio de estoque (`C9_BLEST = '02'`) e saldos disponíveis em estoque (`SB2: B2_QATU - B2_RESERVA - B2_QEMP`).
  * **Algoritmo de Fila Sequencial FIFO por Produto:** 1º Data Liberação (`C9_DATALIB`) mais antiga > 2º Número do Pedido (`C9_PEDIDO`) menor/mais antigo > 3º Item (`C9_ITEM`).
  * **Classificação Automática de Liberação:**
    * `🟢 Ped. Pronto pra Ser Liberado`: 100% dos itens atendidos pelo saldo atual (ex: Pedido `000346` na MP 14).
    * `🟡 Lib Parcial`: Pedido com múltiplos itens (ou item parcial) onde parte possui estoque disponível e parte aguarda reposição (ex: Pedido `000763` na OACO 16).
    * `🔴 Aguardando Estoque`: Nenhum item possui saldo disponível no momento.
  * **Indicação de Rotina:** `MATA455` (Liberação de Estoque) ou `MATA456` (Liberação Crédito e Estoque se houver `C9_BLCRED = '01'`).
  * **Modal Drilldown de Auditoria FIFO (`#modalLibEstoqueItens`):** Auditoria item a item com Código, Descrição, Qtd Bloqueada, Saldo Físico `SB2`, Qtd Alocada, Faltante, Fila FIFO (`#1`, `#2`...) e Status.
* **Sub-aba `[ Ped. Bloq Estoque ]`:**
  * Listagem geral de pedidos de venda retidos no Protheus por pendência física de saldo em estoque (`C9_BLEST = '02'`).
  * Identifica com exatidão os 8 pedidos de OACO 16 (`000723`..`000764`) e 4 pedidos de MP 14, com KPIs, filtros e ordenação bidirecional.
* **Sub-aba `[ Saldos em Estoque ]` (Unificada / DRY):**
  * Consulta consolidada de catálogo de Produtos Acabados (`PA`), saldos físicos `SB2` (Metal Pleno 14, GSI 15, OACO 16), compras pendentes `SC7`, vendas em carteira `SC6`, KPIs em tempo real, filtros por grupo comercial e drilldown modal compartilhado com a aba Vendedores (fonte única da verdade).
* **Sub-aba `[ Upload Fatura Transp. ]`:**
  * Processamento de Faturas Rodonaves (PDF multi-páginas via `parser_rodonaves.py`) e Faturas em CSV/TXT (`parser_tipo2.py`).
  * Batimento automático T-SQL no Protheus somando **Frete Cobrado no Pedido (`C5_FRETE`)** + **Frete Embutido (`C5_VLR_FRT`)**.
  * **Painel de Divergências:** Cartões estatísticos de resumo (Prejuízo, Não Encontrados, OK, Total da Fatura), chips de filtro rápido e tolerância flexível em R$.
  * Coluna editável `Doc (NF)` com recálculo em tempo real e botão de Exportação em CSV.
* **Sub-aba `[ Fatura Correios & ViPP ]`:**
  * Leitura e extração analítica de Faturas PDF Correios SFE (`parser_correios.py`) com identificação de etiquetas (`AD...BR`, `AP...BR`), valores, serviços e datas.
  * Cruzamento em tempo real com relatórios do servidor FTP ViPP (`vipp_ftp.js`), com auto-sync sob demanda ao enviar a fatura.
  * Identificação automática de **Ordens de Serviço (`🔧 OS (Sem Cobrança)`)**, Notas Fiscais e itens Sem Info com campo de digitação manual.

---

### 🔍 2. ABA CONSULTA PED/NF
* **Busca Tripartite em Linha com Exclusão Mútua (OU):**
  * `Código Web Pipe` (`C5_CODWEB`) | `Número do Pedido de Venda` (`C5_NUM` / `D2_PEDIDO`) | `Número da NFe (Doc)` (`D2_DOC` / `F2_DOC`).
  * Bloqueio automático dos demais campos ao digitar em um deles.
  * Disposição harmoniosa dos 3 campos na mesma linha com atalho de tecla `Enter`.
* **Roteamento Dinâmico Multi-Empresa:**
  * Consulta simultânea nas tabelas das 3 empresas: Metal Pleno (14), GSI (15) e OACO (16) cruzando `SC5`, `SD2` e `SF2`.
* **Grid de Resultados com 7 Colunas:**
  * `Empresa` | `CodWeb` (`C5_CODWEB`) | `Ped Venda` | `NF` | `Vlr NF` (`F2_VALBRUT` / `D2_TOTAL`) | `Vlr Frete Cob.` (`C5_FRETE` + `C5_VLR_FRT`) | `Nome Cli` (`C5_NOMECLI`).

---

### 💼 3. ABA VENDEDORES
* **Tema Claro / Escuro Unificado (Light/Dark Mode):**
  * Alternância dinâmica através dos seletores `#btnToggleThemeVendedores` (no cabeçalho das sub-abas) e `#btnToggleThemeEstoque` (no painel de estoque).
  * Sincronização em todas as 5 sub-abas e nos modais (*Drilldown de Estoque* e *Detalhes do Pedido*).
  * Paleta de Alto Contraste WCAG 2.1 com persistência em `localStorage` (`theme_vendedores`).
* **Sub-aba `[ Saldos em Estoque ]` (Visual Power BI):**
  * Catálogo de Produtos Acabados (`PA`), saldos físicos `SB2` (14, 15, 16), pedidos de venda `SC6` e pedidos de compra `SC7`.
  * Cálculo de `SALDO_TOTAL = (SALDO * PREÇO)` e 3 KPIs no topo (*Itens em Estoque*, *Itens sem Estoque*, *Valor Total em Estoque*).
  * Filtros por grupos comerciais oficiais (**001 - Cofres**, **002 - Fragmentadoras**, **010 - Plastificação**, **018 - Armários & Carrinhos**) e exclusão de bloqueados (`B1_MSBLQL <> '1'`).
  * Paginação inteligente configurável (25, 50, 100 itens) e busca instantânea.
  * Job automático de sincronização Protheus x Supabase a cada 60 min no horário comercial com fallback JSON e Cooldown de 2 min no botão manual.
  * Modal Drilldown Multi-Empresa com 3 guias (*Resumo por Empresa*, *Compras em Aberto SC7*, *Vendas em Aberto SC6*).
* **Sub-aba `[ Consulta Pedido ]`:**
  * Pesquisa multi-critério (`CodWeb`, `Número do Pedido`, `Nome do Cliente`) nas 3 empresas.
  * Modal rico com dados mestres de `SA1010` (CNPJ/CPF, endereço, CEP, telefone com máscara), grade `SC6`, totais e botão para impressão.
* **Sub-aba `[ Pedidos Abertos ]`:**
  * Pedidos não faturados (`C5_NOTA = ''` e não cancelados) nas 3 empresas (`SC5`).
  * Mapeamento de Bloqueios de Estoque (`C9_BLEST`) e Crédito (`C9_BLCRED`) da tabela `SC9` aderente às regras de negócio oficiais do Power BI.
  * Integração externa inteligente com o CRM Pipedrive (`deal/{digits}`) e abertura da modal do pedido.
  * **Visão Unificada e Desbloqueio de Vendedores:** Permite que qualquer vendedor visualize os pedidos em aberto de toda a equipe ou filtre por empresa/vendedor específico.
* **Sub-aba `[ Pedidos Compras ]`:**
  * Consulta em tempo real de pedidos de compra em aberto (`SC7140`, `SC7150`, `SC7160`) com saldo a receber (`C7_QUANT - C7_QUJE > 0`) e previsão (`C7_DATPRF`).
  * Faixa estrita de produtos acabados `PA` (`001...` a `019...`) e fornecedores `SA2010`.
  * Identificador `PedCom` formatado com sigla (`MP000207`, `GSI000150`, `OACO000320`) e cards de resumo.
* **Sub-aba `[ Comissões & Metas ]`:**
  * Consulta periódica nas tabelas `SE3140`, `SE3150` e `SE3160` (ciclo oficial do dia 26 ao dia 25) com visão unificada para toda a equipe comercial.
  * **Nova Coluna Nome:** Extração de `A1_NOME` via `LEFT JOIN SA1010` com truncamento nas primeiras **20 letras (incluindo espaços)** e tooltip com o nome completo.
  * **Card "Meta Atingida (%)":**
    * *Meta Individual:* **R$ 120.000,00** por vendedor.
    * *Meta Global:* **R$ 360.000,00** para a equipe.
    * *Fórmula:* `Meta Atingida (%) = (Total Faturado / Meta Proporcional) * 100`.
  * De-Para de vendedores: `000004` (Figueiredo), `000064` (Andrea), `000074` (Juliana).
  * Trava de intervalo de 60 dias para proteção do banco de dados.

---

### 💰 4. ABA ASSIST. FINANC.
* **Sub-aba `[ Conciliação Bancária ]`:**
  * Conciliação sob demanda do Banco Inter 077 confrontando `SE8` e `SE5` nas contas 14 (Metal Pleno), 15 (GSI) e 16 (OAÇO).
  * Motor de compensação de taxas de cartão/adquirentes (bruto - taxa = líquido).
  * Diagnóstico micro com algoritmo de agrupamento N:1 para despesas/boletos agrupados em lote.
  * Identificação de *Cliente Provável (Extrato)* em lançamentos faltantes no Protheus.
  * Receptor de webhooks bancários (`POST /api/webhooks/inter/:empresa`) com chave única composta `(empresa_codigo, event_id)` e resposta imediata.
* **Sub-aba `[ Análise de Crédito ]`:**
  * **Processamento Efêmero de PDF Serasa Experian em Memória:** Stream direto via Python `pypdf` sem gravação em disco.
  * **Validação de Modelo e Validade:** Rejeita arquivos não reconhecidos e laudos com mais de 4 meses de emissão.
  * **Trava de Consulta Protheus e Confronto de CNPJ:** Desbloqueio condicional após leitura do Serasa e alerta de divergência de CNPJ.
  * **Consulta Automática Protheus:** Pedido de venda (`SC5`/`SC6`), cadastro `SA1`, condições `SE4` e histórico financeiro multi-empresa `SE1` (empresas 09, 14, 15 e 16).
  * **Maturidade Digital:** RDAP Registro.br (idade do domínio), Wayback Machine (primeiro snapshot histórico) e DNS MX de provedor corporativo.
  * **Capital Social Isento:** Checkbox para filiais/S.A./entidades sem capital social com pontuação neutra (0 pts).
  * **Extrato & Ficha do Pedido:** Snapshots imutáveis de pontuação (`detalhes_pontos`), auditoria do analista logado e botão `⚡ Carregar no Formulário`.

---

### ⚙️ 5. ABA CONFIGURAÇÕES & AUDITORIA
* **Sub-aba `[ Usuários & Permissões ]`:**
  * Gestão de contas, senhas hasheadas em bcrypt e permissões granulares para as abas (`logistica`, `consulta`, `vendedores`, `financeiro`, `configuracoes`).
  * Autenticação em Dois Fatores (2FA) por e-mail com códigos de 4 dígitos via Mailjet REST API (HTTPS 443) / SMTP.
  * Campo dedicado e rotina de autocura de código de vendedor Protheus (`vendor_code`).
  * Modal de Alteração de Senha do próprio usuário logado (`#myPasswordModal`).
* **Sub-aba `[ Atividades & Auditoria ]`:**
  * Painel de telemetria em tempo real com métricas de engajamento, status de *Último Acesso Ativo Relativo* (*Online agora*, *Há X min*), heartbeat a cada 5 min (`/api/auth/session-ping`) e feed de eventos.
* **Sub-aba `[ Análise de Crédito (Configuração) ]`:**
  * Painel de calibração em 6 blocos cobrindo 100% dos parâmetros e pesos do motor de score com sincronização dinâmica de rótulos e restauração para os padrões oficiais.

---

## 👥 3. Tabela de Perfis e Usuários Cadastrados

| Usuário | Perfil | Código Vendedor | Abas Autorizadas |
| :--- | :---: | :---: | :--- |
| **`alexandre`** | Administrador | *(Geral)* | `📦 Logística`, `🔍 Consulta`, `💼 Vendedores`, `💰 Assist. Financ.`, `⚙️ Configurações` (Acesso Total) |
| **`juliana`** | Vendedor | `000074` | `💼 Vendedores` (Visão Unificada: Estoque, Compras, Pedidos Abertos e Comissões de toda a equipe) |
| **`andrea`** | Vendedor | `000064` | `💼 Vendedores` (Visão Unificada: Estoque, Compras, Pedidos Abertos e Comissões de toda a equipe) |
| **`figueiredo`** | Vendedor | `000004` | `💼 Vendedores` (Visão Unificada: Estoque, Compras, Pedidos Abertos e Comissões de toda a equipe) |
| **`rubens`** | Operador | - | `💰 Assist. Financ.` (Acesso focado na conciliação e financeiro) |
| **`erica`** | Operador | - | `📦 Logística`, `🔍 Consulta` |
| **`wallerson`** | Operador | - | `📦 Logística`, `🔍 Consulta` |

---

## 🗄️ 4. Mapeamento de Tabelas Protheus & Supabase

### Tabelas Protheus (SQL Server):
* **Pedidos de Venda:** `SC5140` (MP), `SC5150` (GSI), `SC5160` (OACO)
* **Itens do Pedido:** `SC6140` (MP), `SC6150` (GSI), `SC6160` (OACO)
* **Pedidos de Compras:** `SC7140` (MP), `SC7150` (GSI), `SC7160` (OACO)
* **Saldos em Estoque:** `SB2140` (MP), `SB2150` (GSI), `SB2160` (OACO)
* **Catálogo de Produtos:** `SB1010` (Compartilhado)
* **Liberações / Bloqueios:** `SC9140` (MP), `SC9150` (GSI), `SC9160` (OACO)
* **Contas a Receber (Histórico):** `SE1090`, `SE1140`, `SE1150`, `SE1160`
* **Comissões:** `SE3140` (MP), `SE3150` (GSI), `SE3160` (OACO)
* **Movimentações Bancárias:** `SE5140` (MP), `SE5150` (GSI), `SE5160` (OACO)
* **Saldos Bancários:** `SE8140` (MP), `SE8150` (GSI), `SE8160` (OACO)
* **Itens de Saída (NFe):** `SD2140` (MP), `SD2150` (GSI), `SD2160` (OACO)
* **Cabeçalho de NFe:** `SF2140` (MP), `SF2150` (GSI), `SF2160` (OACO)
* **Cadastro de Clientes:** `SA1010` (Compartilhado)
* **Cadastro de Fornecedores:** `SA2010` (Compartilhado)
* **Condições de Pagamento:** `SE4010` (Compartilhado)

### Tabelas Supabase (PostgreSQL Nuvem com RLS):
1. **`users`:** Autenticação, RBAC, e-mail, permissões JSON, `vendor_code` e hashes bcrypt.
2. **`user_2fa_tokens`:** Tokens numéricos de 4 dígitos para 2FA com TTL de 5 min.
3. **`produtos_saldo_estoque`:** Tabela consolidada de saldos de estoque multi-empresa.
4. **`estoque_sync_logs`:** Registro de execuções do job de sincronização de estoque.
5. **`analise_credito_history`:** Histórico completo de análises de crédito com extrato auditável.
6. **`user_activities`:** Feed de auditoria de uso e telemetria.
7. **`inter_webhook_events`:** Eventos bancários idempotentes com chave composta `(empresa_codigo, event_id)`.
8. **`system_configs`:** Configurações dinâmicas e calibração de pesos de score.
9. **`history`:** Histórico de conciliações e uploads.

---

## 📍 5. Status de Entregas & Próximos Passos

1. 🟢 **Aba 1 (Logística - Rodonaves & Correios/ViPP):** 100% Concluída com auto-sync FTP e regras de OS.
2. 🟢 **Aba 2 (Consulta - Ped/NF Multi-Empresa):** 100% Concluída com busca tripartite.
3. 🟢 **Aba 3 (Vendedores - Estoque, Pedidos, Compras, Comissões):** 100% Concluída com visual Power BI, job Supabase, CRM Pipedrive e tema claro/escuro.
4. 🟢 **Aba 4 (Assist. Financ. - Conciliação Inter & Análise Crédito):** 100% Concluída com agrupamento N:1, webhooks, Serasa PDF efêmero, maturidade digital e extrato auditável.
5. 🟢 **Aba 5 (Configurações - Usuários, 2FA, Auditoria, Score):** 100% Concluída com 2FA via Mailjet HTTPS 443 / SMTP, telemetria e calibração de pesos.
6. 🔵 **Gravação Direta no Protheus (ExecAuto):** Rotina AdvPL ([`REST_AMARFRET.PRW`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/REST_AMARFRET.PRW)) pronta, botão aguardando ativação no AppServer TOTVS.
7. 🌐 **Subdomínio no Render (`[INFRA-01]`):** Configuração de CNAME `portal.gsi.com.br` e SSL.
