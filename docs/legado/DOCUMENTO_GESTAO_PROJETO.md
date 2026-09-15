# 📘 Documento de Gestão, Arquitetura e Aperfeiçoamento do Projeto
## Plataforma de Apoio GSI Multi-Empresas (Integração Protheus & Nuvem)

> **Status Atual:** Operacional na Nuvem 24/7 (Alta Disponibilidade com Supabase RLS, Autenticação 2FA e Sincronização Agendada)  
> **Link de Produção:** `https://conciliacao-fretes.onrender.com`  
> **Repositório GitHub:** `https://github.com/cofresgoldsafe/conciliacao-fretes`  
> **Segurança:** Documento livre de credenciais sensíveis, senhas ou tokens de API.

---

## 1. 🎯 Objetivos e Escopo da Plataforma
Prover um portal corporativo integrado na nuvem, multi-empresa e multi-perfil (Operadores, Administradores, Controladoria Financeira e Equipe Comercial), centralizando:
1. **Logística & Conciliação de Fretes:**
   - **Saldos em Estoque Unificado (DRY):** Disponibilização direta do painel consolidado de produtos acabados PA, saldos físicos `SB2`, compras pendentes `SC7` e vendas em carteira `SC6` para a equipe operacional de logística, sincronizado com a aba comercial.
   - **Conciliação e Faturas:** Leitura de faturas Rodonaves (PDF) e Correios/VIPP (PDF SFE e integração FTP), cruzando automaticamente com fretes cobrados no ERP Protheus (`C5_FRETE + C5_VLR_FRT`) e identificação de Ordens de Serviço (OS) e divergências.
2. **Consulta Rápida e Unificada de Pedidos & NFs:** Localização instantânea em tempo real nas 3 empresas do grupo (Metal Pleno 14, GSI 15 e OACO 16) por `CodWeb`, `Número do Pedido` ou `Número da Nota Fiscal (Doc)`.
3. **Módulo Comercial Completo (Vendedores):**
   - **Saldos em Estoque:** Painel estilo Power BI com consolidação de catálogo de Produtos Acabados (`PA`), saldos físicos `SB2`, pedidos de venda `SC6`, pedidos de compra `SC7`, KPIs de estoque, filtros de grupos comerciais (001, 002, 010, 018), paginação inteligente e sincronização agendada com o Supabase.
   - **Consulta de Pedidos com SA1010:** Modal detalhado com endereço completo, contatos, condições comerciais, grade de itens `SC6` e impressão.
   - **Pedidos Abertos (SC5/SC9):** Acompanhamento de pedidos não faturados com regras de bloqueio de estoque e crédito aderentes ao Power BI e links para o CRM Pipedrive.
   - **Pedidos Compras (SC7):** Acompanhamento de pedidos de compra em aberto de produtos PA com fornecedores `SA2010` e previsões de entrega.
   - **Comissões & Metas (SE3):** Fechamento de comissões periódico (ciclo 26 a 25) com indicador dinâmico proporcional de Meta Atingida (R$ 120k individual / R$ 360k global).
4. **Assistente Financeiro & Análise de Crédito:**
   - **Conciliação Bancária Inter 077:** Batimento de extratos bancários com `SE8` e movimentações `SE5`, compensação automática de taxas de cartão/adquirentes, diagnóstico inteligente de agrupamento N:1 e recepção de webhooks com chave de idempotência.
   - **Análise de Crédito Comercial com Motor de Score:** Leitura efêmera em memória de relatórios PDF Serasa Experian (com validação estrita de modelo e validade &le; 4 meses), consulta automática de histórico financeiro multi-empresa `SE1`, validação de endereços Protheus x Receita, maturidade digital (RDAP Registro.br, Wayback Machine, DNS MX), extrato auditável e calibração de pesos.
5. **Governança, Segurança & Auditoria:**
   - Autenticação JWT com RBAC por perfil e permissões granulares por abas.
   - Autenticação em Dois Fatores (2FA) por e-mail com códigos de 4 dígitos via Mailjet REST API (HTTPS 443) / SMTP.
   - Telemetria de atividades em tempo real (`user_activities`), heartbeat de sessão e autocura de códigos de vendedores.
   - Tema Claro / Escuro (Light/Dark Mode) com paleta de alto contraste WCAG 2.1 e persistência perene.

---

## 2. 🏛️ Arquitetura do Sistema e Topologia em Nuvem

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

## 3. 🧭 Estrutura Completa de Navegação (6 Abas Principais & 17 Sub-Abas)

### 📦 1. ABA LOGÍSTICA
* **`[ Ped. pra Faturar ]` (Página Inicial / Padrão):** Listagem em tempo real de pedidos liberados para faturamento no Protheus aderente às regras oficiais da rotina **MATA460A (Legenda Verde)** (`SC9` liberado sem bloqueio de estoque/crédito, sem nota fiscal ativa em `SF2` e `C5_NOTA` em aberto/reaberto). Multi-empresa (MP 14, GSI 15, OACO 16 com pedido `000221`), KPIs de pedidos, peças e valor total, link oficial para CRM Pipedrive (`https://benetroncomercial.pipedrive.com/deal/...`) e clique no pedido com modal de detalhes completos.
* **`[ Ped. Lib Estoque ]`:** Fila Sequencial FIFO e análise inteligente de liberação de pedidos bloqueados por estoque (`C9_BLEST = '02'`) contra saldos `SB2`. Critérios estritos: 1º Data Liberação (`C9_DATALIB`) ASC > 2º Número do Pedido (`C9_PEDIDO`) ASC > 3º Item (`C9_ITEM`). Classificação em `🟢 Ped. Pronto pra Ser Liberado` (100%), `🟡 Lib Parcial` (itens mistos/parciais) e `🔴 Aguardando Estoque`, com indicação da rotina (`MATA455` ou `MATA456`) e modal de auditoria item a item.
* **`[ Ped. Bloq Estoque ]`:** Listagem geral de pedidos de venda retidos no Protheus por pendência física de saldo em estoque (`C9_BLEST = '02'`). Identifica com exatidão os 8 pedidos de OACO 16 (`000723`..`000764`) e 4 pedidos de MP 14, com KPIs, filtros e ordenação bidirecional.
* **`[ Upload Fatura Transp. ]`:** Processamento de Faturas Rodonaves (PDF multi-páginas via `parser_rodonaves.py`) e Faturas em CSV/TXT (`parser_tipo2.py`). Batimento automático com o frete cobrado no pedido (`C5_FRETE + C5_VLR_FRT`), cartões estatísticos de divergência, tolerância configurável em R$, coluna editável `Doc (NF)` e exportação em CSV.
* **`[ Fatura Correios & ViPP ]`:** Leitura e extração analítica de Faturas PDF Correios SFE (`parser_correios.py`) com identificação de etiquetas (`AD...BR`, `AP...BR`), cruzamento em tempo real com relatórios do servidor FTP ViPP (`vipp_ftp.js`), auto-sync incremental no upload, categorização inteligente de Ordens de Serviço (`🔧 OS (Sem Cobrança)`) e batimento de frete Protheus.

### 🔍 2. ABA CONSULTA PED/NF
* **`[ Consulta NFe ou Pedido ]`:** Busca tripartite na mesma linha com exclusão mútua (`Código Web Pipe`, `Número do Pedido de Venda` ou `Número da NFe`), consulta simultânea nas tabelas das 3 empresas (14, 15 e 16), retorno com visualização de frete cobrado e link direto para detalhes.

### 💼 3. ABA VENDEDORES
* **`[ Saldos em Estoque ]` (Visual Power BI):** Acompanhamento consolidado de catálogo de Produtos Acabados (`PA`), saldos físicos `SB2`, vendas em carteira `SC6` e compras em aberto `SC7`. Cálculo de `SALDO_TOTAL = (SALDO * PREÇO)`, KPIs no topo, filtros por grupos comerciais (001, 002, 010, 018), isolamento dos catálogos operacionais ativos (`SB1090` e `SB1160`), descarte do catálogo legado `SB1010` da Empresa 01 e expurgo estrito de produtos bloqueados (`B1_MSBLQL IN ('1', 'S', 's')`), busca rápida, paginação inteligente (25, 50, 100 itens), modal drilldown multi-empresa com 3 guias e botão de sincronização manual com Cooldown.
* **`[ Consulta Ped Venda ]`:** Busca multi-critério por CodWeb, número do pedido ou nome do cliente. Modal completo com dados cadastrais mestres da `SA1010` (CNPJ/CPF, endereço com complemento, CEP, contato, telefone com máscaras), grade de produtos `SC6` e botão para impressão.
* **`[ Ped Vendas Abertos ]`:** Listagem multi-empresa de pedidos não faturados (`C5_NOTA = ''` e não cancelados), agregação de bloqueios de estoque (`C9_BLEST`) e crédito (`C9_BLCRED`) padrão Power BI, link para CRM Pipedrive, ordenação interativa e **visão unificada desbloqueada** para todos os vendedores consultarem a carteira global ou filtrarem por vendedor.
* **`[ Prod x Ped Compras ]`:** Consulta em tempo real de pedidos de compra em aberto (`SC7`) de produtos acabados `PA` (`001...` a `019...`), saldo a receber (`C7_QUANT - C7_QUJE > 0`), identificador `PedCom` (ex: `MP000207`, `GSI000150`, `OACO000320`), busca de fornecedores em `SA2010` e cards de resumo.
* **`[ Comissões & Metas ]`:** Apuração periódica `SE3` (ciclo padrão de 26 a 25) com visão unificada para toda a equipe comercial, **nova coluna Nome** truncada em 20 letras (com espaços) via `SA1010` e tooltip completo, card de **Meta Atingida (%)** dinâmico proporcional (R$ 120.000,00 individual / R$ 360.000,00 global), totalizadores de base faturada e trava de segurança de 60 dias.
* **Tema Claro/Escuro:** Botão seletor no cabeçalho `#btnToggleThemeVendedores` aplicando instantaneamente a paleta de alto contraste em todas as 5 sub-abas e modais com persistência em `localStorage`.

### 🛒 4. ABA COMPRAS
* **`[ Saldos em Estoque ]`:** Acesso unificado ao painel de estoques multi-empresa (MP 14, GSI 15, OACO 16), rupturas e pedidos pendentes (DRY).
* **`[ Consulta Ped Venda ]`:** Consulta rápida de pedidos de venda e clientes.
* **`[ Ped Vendas Abertos ]`:** Monitoramento da carteira de vendas em aberto e demandas pendentes.
* **`[ Ped Compras Aberto ]`:** Listagem consolidada multi-empresa de pedidos de compras pendentes (`SC7`), com **destaque em evidência de prazos de entrega vencidos (`< hoje`)** para renegociação imediata com o fornecedor, 4 cards de KPIs (*Pedidos em Aberto*, *Pedidos Atrasados*, *Peças a Receber*, *Valor Total em Aberto R$*), filtros por empresa e status do prazo, e **Modal Rico de Detalhes (`#modalPedidoCompraDetalhes`)** trazendo dados cadastrais e de contato do fornecedor (`SA2010`), condição de pagamento (`SE4010`) e grade completa de itens.
* **`[ Prod x Ped Compras ]`:** Consulta de pedidos de compra de produtos acabados `PA` com saldo e previsões.
* **Tema Claro/Escuro:** Botão dedicado `#btnToggleThemeCompras` sincronizado com todo o módulo.

### 💰 5. ABA ASSIST. FINANC.
* **`[ Conciliação Bancária ]`:** Conciliação sob demanda do Banco Inter 077 confrontando `SE8` e `SE5` nas contas correntes das 3 empresas (14, 15 e 16). Motor de compensação de taxas de cartão/adquirentes (bruto - taxa = líquido), diagnóstico micro com algoritmo de agrupamento N:1 para lotes de pagamento, identificação de faltantes com *Cliente Provável (Extrato)* e receptor de webhooks com idempotência estrita.
* **`[ Análise de Crédito ]`:** Motor de Score de Crédito Comercial com:
  - Leitura obrigatória de PDF Serasa Experian em buffer efêmero na memória (sem gravação em disco) com validação de modelo oficial e validade &le; 4 meses.
  - Trava no botão de consulta Protheus e validação cruzada de CNPJs.
  - Consulta automática de pedidos de venda (`SC5`/`SC6`), cadastro `SA1`, condições de pagamento `SE4` e histórico financeiro unificado `SE1` nas empresas 09, 14, 15 e 16.
  - Comparação tolerante de endereços Protheus x Receita Federal.
  - Maturidade digital em tempo real (RDAP Registro.br, Wayback Machine, DNS MX de provedor corporativo).
  - Checkbox para Capital Social Não Informado / Isento (0 pts).
  - Ficha do Pedido e Extrato Matemático do Score com snapshots imutáveis de pontuação (`detalhes_pontos`), auditoria do usuário analista e botão `⚡ Carregar no Formulário`.

### ⚙️ 6. ABA CONFIGURAÇÕES
* **`[ Usuários & Permissões ]`:** Gestão completa de operadores, perfis RBAC, permissões granulares por aba, alteração de senhas, campo dedicado de código de vendedor Protheus (`vendor_code`) e autenticação 2FA por e-mail (Mailjet HTTPS 443 / SMTP).
* **`[ Atividades & Auditoria ]`:** Telemetria e auditoria de engajamento em tempo real, status de *Último Acesso Ativo Relativo* (*Online agora*, *Há X min*), heartbeat de sessão a cada 5 min e feed dos últimos eventos.
* **`[ Análise de Crédito (Configuração) ]`:** Painel de calibração administrativa em 6 blocos com 100% dos parâmetros e pesos do motor de score, sincronização dinâmica dos rótulos dos seletores e botão de restauração para padrões oficiais.

---

## 4. 🗄️ Estrutura Técnica de Persistência & Bancos de Dados

### Tabelas PostgreSQL (Supabase Nuvem) — `postgres_db.js`
1. **`users`:** Usuários, perfis (`admin`, `user`, `vendedor`), hashes bcrypt, e-mail, permissões JSON e `vendor_code` Protheus.
2. **`user_2fa_tokens`:** Tokens numéricos de 4 dígitos para 2FA, hasheados em bcrypt, TTL de 5 min e bloqueio após 3 tentativas.
3. **`produtos_saldo_estoque`:** Tabela relacional com saldos consolidados de estoque multi-empresa, preços, carteira SC6 e compras SC7.
4. **`estoque_sync_logs`:** Logs de auditoria do job de sincronização de estoque (duração, contadores e gatilho).
5. **`analise_credito_history`:** Histórico de análises de crédito com identificação do analista, pontuação, decisão, snapshots imutáveis e payload JSON.
6. **`user_activities`:** Feed de auditoria de uso com eventos de login, consultas, gravações de crédito e sincronizações.
7. **`inter_webhook_events`:** Eventos bancários do Banco Inter com chave única composta `(empresa_codigo, event_id)` para idempotência estrita.
8. **`system_configs`:** Configurações globais persistentes (incluindo calibração de pesos de score).
9. **`history`:** Histórico de conciliações e operações legadas.
* **Segurança:** Row-Level Security (RLS) habilitado em 100% das tabelas públicas.

### Tabelas Protheus (SQL Server Nuvem) — `protheus_db.js`
* **Pedidos de Venda:** `SC5140` (MP), `SC5150` (GSI), `SC5160` (OACO)
* **Itens do Pedido:** `SC6140` (MP), `SC6150` (GSI), `SC6160` (OACO)
* **Pedidos de Compras:** `SC7140` (MP), `SC7150` (GSI), `SC7160` (OACO)
* **Saldos em Estoque:** `SB2140` (MP), `SB2150` (GSI), `SB2160` (OACO)
* **Catálogo de Produtos:** `SB1010` (Compartilhado)
* **Liberações / Bloqueios:** `SC9140` (MP), `SC9150` (GSI), `SC9160` (OACO)
* **Contas a Receber (Histórico Financeiro):** `SE1090`, `SE1140`, `SE1150`, `SE1160`
* **Comissões:** `SE3140` (MP), `SE3150` (GSI), `SE3160` (OACO)
* **Movimentações Bancárias:** `SE5140` (MP), `SE5150` (GSI), `SE5160` (OACO)
* **Saldos Bancários:** `SE8140` (MP), `SE8150` (GSI), `SE8160` (OACO)
* **Itens de Saída (NFe):** `SD2140` (MP), `SD2150` (GSI), `SD2160` (OACO)
* **Cabeçalho de NFe:** `SF2140` (MP), `SF2150` (GSI), `SF2160` (OACO)
* **Cadastro de Clientes:** `SA1010` (Compartilhado)
* **Cadastro de Fornecedores:** `SA2010` (Compartilhado)
* **Condições de Pagamento:** `SE4010` (Compartilhado)

---

## 5. 📍 Matriz de Status Atual dos Módulos

| Módulo / Funcionalidade | Status | Observações |
| :--- | :---: | :--- |
| **Aba 1 (Logística: Rodonaves & Correios/ViPP FTP)** | 🟢 100% Concluído | Operacional com auto-sync FTP, regras de OS e batimento T-SQL. |
| **Aba 2 (Consulta: Pedidos e NFs Multi-Empresa)** | 🟢 100% Concluído | Operacional com busca tripartite unificada nas empresas 14, 15 e 16. |
| **Aba 3 (Vendedores: Estoque, Pedidos, Compras, Comissões)** | 🟢 100% Concluído | 5 sub-abas operacionais, visual Power BI, job Supabase, CRM Pipedrive e tema claro/escuro. |
| **Aba 4 (Assist. Financ.: Conciliação Inter & Análise Crédito)** | 🟢 100% Concluído | Conciliação N:1, webhooks, motor de score, Serasa PDF efêmero e extrato auditável. |
| **Aba 5 (Configurações: Usuários, Auditoria, Score)** | 🟢 100% Concluído | RBAC, 2FA por e-mail, autocura de vendedor, telemetria e calibração de pesos. |
| **Lançamento Direto no Protheus (ExecAuto)** | 🔵 Pronto / Aguarda AppServer | Rotina AdvPL ([`REST_AMARFRET.PRW`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/REST_AMARFRET.PRW)) pronta, botão aguardando ativação no AppServer TOTVS. |

---

## 6. 🛡️ Backlog de Próximos Passos & Infraestrutura

1. **Subdomínio Personalizado no Render (`[INFRA-01]`):** Apontamento CNAME (ex: `portal.gsi.com.br`), emissão de SSL e liberação no CORS de [`server.js`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/server.js).
2. **Suíte E2E Playwright (`[QA-06]`):** Automação ponta a ponta dos fluxos de autenticação 2FA, filtros de estoque e conciliação de fretes.
3. **Publicação da Rotina AdvPL no AppServer:** Compilação do `REST_AMARFRET.PRW` para gravação de amarrações contábeis de frete no ERP Protheus.
