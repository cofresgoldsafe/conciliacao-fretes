# 📘 Documentação Completa: Plataforma de Apoio GSI Multi-Empresas & Protheus

> **Documento de Gestão, Arquitetura e Aperfeiçoamento (Pronto para Notion)**  
> **Status:** Versão 1.3 Operacional e Publicada na Nuvem 24/7  
> **Link do Sistema:** `https://conciliacao-fretes.onrender.com`  
> **Repositório GitHub:** `https://github.com/cofresgoldsafe/conciliacao-fretes`  
> **Segurança:** Documento livre de credenciais sensíveis, senhas ou tokens de API.

---

## 🏛️ 1. Arquitetura do Sistema e Portais Envolvidos

O ecossistema da **Plataforma de Apoio GSI Multi-Empresas** é composto por 4 módulos interconectados na nuvem:

```
[ Usuário / Equipe Comercial / Logística ]
                    │
                    ▼
    1. Portal Web Multi-Empresas (Render)
       https://conciliacao-fretes.onrender.com
       (Interface Web 24/7 + Upload Faturas + Gestão Vendedores)
                    │
                    ▼ (Requisições HTTP REST com X-API-Key)
    2. API Protheus em Nuvem (Railway)
       https://protheus-api-production.up.railway.app
       (Backend Python FastAPI + Driver ODBC SQL Server)
                    │
                    ▼ (Consultas T-SQL Nativas e Otimizadas)
    3. Banco de Dados SQL Server Protheus Multi-Empresas
       Database: CNVYB3_184594_PR_PD
       ├─ Pedidos de Venda: SC5160 (OACO), SC5150 (GSI), SC5140 (MP)
       ├─ Itens de Pedido: SC6160 (OACO), SC6150 (GSI), SC6140 (MP)
       ├─ Cadastro Mestre de Clientes: SA1010 (Compartilhado)
       ├─ Comissões de Vendedores: SE3160 (OACO), SE3150 (GSI), SE3140 (MP)
       └─ Itens de Saída / NF: SD2160 (OACO), SD2150 (GSI), SD2140 (MP)
                    │
                    ▼ (Homologação Futura)
    4. Servidor Protheus AppServer (ERP TOTVS)
       Rotina REST ADVPL: REST_AMARFRET.PRW / MATA116 (ExecAuto)
```

---

### 🌐 Resumo dos Portais e Links do Projeto:

| Componente / Portal | URL / Endereço | Descrição & Função |
| :--- | :--- | :--- |
| **Portal Web (Render)** | `https://conciliacao-fretes.onrender.com` | Interface Web 24/7 com autenticação, upload de faturas, consulta de pedidos e comissões. |
| **Ambiente Local** | `http://localhost:3000` | Servidor Node.js local de desenvolvimento e testes. |
| **Repositório GitHub** | `https://github.com/cofresgoldsafe/conciliacao-fretes` | Código-fonte versionado em Node.js, HTML5, CSS3, JavaScript e scripts Python. |
| **API Protheus (Railway)** | `https://protheus-api-production.up.railway.app` | Backend FastAPI que executa queries seguras de leitura no banco SQL Server Protheus. |
| **Banco de Dados Protheus** | `CNVYB3_184594_PR_PD` (SQL Server) | Base de dados oficial do ERP Protheus contendo as empresas 14, 15 e 16. |

---

## 🧭 2. Estrutura de Navegação da Plataforma (4 Abas Principais)

### 📦 1. ABA LOGÍSTICA
* **Sub-aba `[ Upload Faturas ]`:**
  * Processamento de Faturas Rodonaves (PDF multi-páginas via `parser_rodonaves.py`) e Faturas em CSV/TXT (`parser_tipo2.py`).
  * Batimento automático T-SQL no Protheus somando **Frete Cobrado no Pedido (`C5_FRETE`)** + **Frete Embutido (`C5_VLR_FRT`)**.
  * **Painel de Divergências:** Cartões estatísticos no topo (Prejuízo, Não Encontrados, OK, Total da Fatura), chips de filtro rápido e tolerância flexível em R$.
  * Coluna editável `Doc (NF)` com recálculo em tempo real e botão de Exportação em CSV.
* **Sub-aba `[ Correios & ViPP ]`:**
  * Leitura e extração analítica de Faturas PDF Correios SFE (`parser_correios.py`) com identificação de etiquetas (`AD...BR`, `AP...BR`), valores, serviços e datas.
  * Módulo WebService SOAP/REST ViPP (`vipp_api.py`) e tela de parametrização de token (`#vippConfigModal`).
  * *Status:* Aguardando fornecimento do Token oficial pela VisualSet Tecnologia.

---

### 🔍 2. ABA CONSULTA PED/NF
* **Busca Tripartite em Linha com Exclusão Mútua (OU):**
  * `Código Web Pipe` (`C5_CODWEB`) | `Número do Pedido de Venda` (`C5_NUM` / `D2_PEDIDO`) | `Número da NFe (Doc)` (`D2_DOC` / `F2_DOC`).
  * Bloqueio automático dos demais campos ao digitar em um deles.
  * Disposição harmoniosa dos 3 campos na mesma linha com atalho de tecla `Enter`.
* **Roteamento Dinâmico Multi-Empresa:**
  * Consulta simultânea nas tabelas das 3 empresas: OACO (16), GSI (15) e Metal Pleno (14) cruzando `SC5`, `SD2` e `SF2`.
* **Grid de Resultados com 7 Colunas:**
  * `Empresa` | `CodWeb` (`C5_CODWEB`) | `Ped Venda` | `NF` | `Vlr NF` (`F2_VALBRUT` / `D2_TOTAL`) | `Vlr Frete Cob.` (`C5_FRETE` + `C5_VLR_FRT`) | `Nome Cli` (`C5_NOMECLI`).

---

### 💼 3. ABA VENDEDORES
* **Sub-aba `[ Consulta Pedido ]`:**
  * **Busca Multi-Critério:** 4 campos (`CodWeb`, `Número do Pedido`, `Nome do Cliente` + Botão `Buscar`).
  * **Suporte Multi-Empresa:** Consulta simultânea nas tabelas `SC5160` (OACO), `SC5150` (GSI) e `SC5140` (Metal Pleno).
  * **Grid Unificada de Resultados:** Colunas `Empresa`, `CodWeb`, `Número do Pedido`, `Nome do Cliente` e `Ações`.
  * **Modal de Detalhamento Completo (`#pedidoDetalhesModal`):**
    * **Dados Cadastrais do Cliente:** Busca centralizada na tabela mestra **`SA1010`** (`A1_NOME`, `A1_CGC`, `A1_END`, `A1_COMPLEM`, `A1_BAIRRO`, `A1_MUN`, `A1_EST`, `A1_CEP`, `A1_TEL`, `A1_EMAIL`, `A1_CONTATO`).
    * **Máscaras e Formatação Automática:** CNPJ (`00.000.000/0000-00`), CPF (`000.000.000-00`), CEP (`00000-000`) e Telefones com DDD.
    * **Dados Comerciais & Transporte:** Transportadora, Condição de Pagamento, Vendedor e Observações da Nota (`C5_MENNOTA`).
    * **Grade de Produtos (`SC6`):** Código do Produto, Descrição, Quantidade, Valor Unitário, Valor Total e Previsão de Entrega.
    * **Quadro de Totais:** Subtotal dos Produtos, Frete (Cobrado + Embutido), Descontos e Total Geral do Pedido.
    * Botão para **🖨️ Imprimir Pedido**.
* **Sub-aba `[ Comissões & Metas ]`:**
  * **Regra de Fechamento de Ciclo:** Sugere automaticamente o período de fechamento oficial (**do dia 26 do mês anterior ao dia 25 do mês atual**).
  * **Trava de Segurança:** Limite máximo de **60 dias** entre as datas para preservar o desempenho do banco Protheus.
  * **Cards de Resumo & Indicadores no Topo:**
    * **Card "Meta Atingida (%)":** Indicador percentual de atingimento de meta de faturamento, substituindo o antigo totalizador de valor em R$ a pagar pela porcentagem atingida de faturamento.
      * *Meta Individual:* **R$ 120.000,00** por vendedor (aplicada quando filtrado por vendedor específico ou vendedor logado).
      * *Meta Global da Equipe:* **R$ 360.000,00** ($3 \times \text{R\$\ } 120.000,00$, aplicada na seleção "Todos os Vendedores" com os 3 vendedores do grupo).
      * *Fórmula de Cálculo Dinâmico Proporcional:*
        $$\text{Meta Atingida (\%)} = \left( \frac{\text{Total Faturado (Soma } E3\_BASE)}{\text{Meta Proporcional}} \right) \times 100$$
    * **Total Faturado / Base de Vendas (R$):** Soma acumulada dos valores base de faturamento (`E3_BASE`) no período apurado.
    * **Qtd. de Lançamentos / Vendas:** Contagem de registros e pedidos apurados no período.
  * **Grid de Apuração (`SE3160`, `SE3150`, `SE3140`):**
    * Colunas: `Vendedor` | `Empresa` (`MP`, `GSI` ou `OACO`) | `Emissão` | `Pedido` | `Cliente` | `Valor Base` (`E3_BASE`) | `Comissão` (`E3_COMIS`).
    * De-Para oficial de Vendedores: `000004` ➔ **Figueiredo** | `000064` ➔ **Andrea** | `000074` ➔ **Juliana**.
    * Isolamento por Perfil: Usuários vendedores logados visualizam estritamente suas próprias comissões e sua respectiva meta individual.

---

### ⚙️ 4. ABA CONFIGURAÇÕES & AUDITORIA DE USO
* **Sub-aba 1 `[ Usuários & Permissões ]`:**
  * Gestão completa de contas, alteração de senhas e edição de permissões por abas (`logistica`, `consulta`, `vendedores`, `configuracoes`).
  * Modal de Alteração de Senha do próprio usuário logado (`#myPasswordModal`).
  * Sessão persistente por **7 dias** via `localStorage`.
* **Sub-aba 2 `[ Atividades & Auditoria ]`:**
  * **Painel de Adoção e Telemetria em Tempo Real:** Monitora o uso efetivo por operadores e vendedores (não apenas logins).
  * **Cards Estatísticos:** Usuários Ativos e Total de Ações Realizadas.
  * **Tabela de Resumo por Usuário:** Login, Nome, Perfil, Status, **Último Acesso Ativo Relativo** (*"Online agora"*, *"Há X min"*, *"Há X h"*) e Contador de Ações.
  * **Feed de Atividades (Últimos 100 Eventos):** Registro em tempo real com badges semânticos para Login, Consulta de Pedido, Detalhes de Pedido, Fechamento de Comissões e Upload de Fatura.
  * **Persistência em Nuvem (Supabase PostgreSQL):** Tabela `user_activities` com auto-criação de schema e fallback gracioso local via `postgres_db.js`.

---

## 👥 3. Tabela de Perfis e Usuários Cadastrados

| Usuário | Perfil | Código Vendedor | Abas Autorizadas |
| :--- | :---: | :---: | :--- |
| **`alexandre`** | Administrador | *(Geral)* | `📦 Logística`, `🔍 Consulta`, `💼 Vendedores`, `⚙️ Configurações` (Acesso Total) |
| **`juliana`** | Vendedor | `000074` | `💼 Vendedores` (Filtro e comissões restritas à Juliana) |
| **`andrea`** | Vendedor | `000064` | `💼 Vendedores` (Filtro e comissões restritas à Andrea) |
| **`figueiredo`** | Vendedor | `000004` | `💼 Vendedores` (Filtro e comissões restritas ao Figueiredo) |
| **`erica`** | Operador | - | `📦 Logística`, `🔍 Consulta` |
| **`wallerson`** | Operador | - | `📦 Logística`, `🔍 Consulta` |

---

## 🗄️ 4. Mapeamento Técnico de Tabelas do Protheus (SQL Server)

| Empresa | Tabela Pedidos (`SC5`) | Tabela Itens (`SC6`) | Tabela Comissões (`SE3`) | Tabela Saídas (`SD2`) | Tabela Clientes (`SA1`) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Metal Pleno (14)** | `SC5140` | `SC6140` | `SE3140` | `SD2140` | `SA1010` (Mestre) |
| **GSI (15)** | `SC5150` | `SC6150` | `SE3150` | `SD2150` | `SA1010` (Mestre) |
| **OACO (16)** | `SC5160` | `SC6160` | `SE3160` | `SD2160` | `SA1010` (Mestre) |

### 📌 Dicionário de Campos Chave Utilizados:
* **Pedidos (`SC5`):** `C5_NUM` (Número Pedido), `C5_CODWEB` (Código Web), `C5_NOMECLI` (Nome Cliente), `C5_CLIENTE` (Código Cliente), `C5_LOJACLI` (Loja), `C5_EMISSAO` (Data Emissão), `C5_VEND1` (Vendedor), `C5_TRANSP` (Transportadora), `C5_CONDPAG` (Condição de Pagamento), `C5_FRETE` (Frete Cobrado), `C5_VLR_FRT` (Frete Embutido), `C5_DESCONT` (Desconto), `C5_MENNOTA` (Observações).
* **Itens do Pedido (`SC6`):** `C6_ITEM` (Item), `C6_PRODUTO` (Código Produto), `C6_DESCRI` (Descrição), `C6_QTDVEN` (Quantidade), `C6_PRCVEN` (Preço Unitário), `C6_VALOR` (Total do Item), `C6_ENTREG` (Previsão de Entrega).
* **Cadastro de Clientes (`SA1010`):** `A1_COD` (Código), `A1_LOJA` (Loja), `A1_NOME` (Razão Social), `A1_CGC` (CNPJ/CPF), `A1_END` (Logradouro), `A1_COMPLEM` (Complemento), `A1_BAIRRO` (Bairro), `A1_MUN` (Município), `A1_EST` (UF), `A1_CEP` (CEP), `A1_TEL` (Telefone), `A1_EMAIL` (E-mail), `A1_CONTATO` (Pessoa de Contato).
* **Comissões (`SE3`):** `E3_VEND` (Código Vendedor), `E3_EMISSAO` (Data Emissão), `E3_PEDIDO` (Número Pedido), `E3_CODCLI` (Código do Cliente), `E3_BASE` (Valor Base de Venda), `E3_PORC` (Percentual de Comissão), `E3_COMIS` (Valor da Comissão em R$).

---

## 📍 5. Status Atual de Entregas & Próximos Passos

1. 🟢 **Aba 1 (Logística - Upload Faturas):** 100% Concluída com regras de divergência, cartões estatísticos e filtros.
2. 🟡 **Aba 2 (Logística - Correios & ViPP):** Parser concluído e testado. Aguardando fornecimento do Token ViPP pela VisualSet.
3. 🟢 **Aba 3 (Vendedores - Pedidos, Comissões & Metas):** 100% Concluída e homologada com as 3 empresas, dados mestres de `SA1010` e indicador dinâmico proporcional de Meta Atingida.
4. 🟢 **Aba 4 (Configurações & Usuários):** 100% Concluída com controle granular de acesso e 6 usuários ativos.
5. 🔵 **Gravação Direta no Protheus (Fase Final):** Rotina AdvPL ([`REST_AMARFRET.PRW`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/REST_AMARFRET.PRW)) estruturada com `MATA116`/ExecAuto, com botão desabilitado na interface aguardando publicação no AppServer.

---

## 🛡️ 6. Diretrizes de Segurança
* Nenhuma senha, token ou chave confidencial está exposta no código ou nesta documentação.
* Toda a comunicação com a API de banco de dados utiliza criptografia HTTPS e cabeçalho de autenticação `X-API-Key`.
