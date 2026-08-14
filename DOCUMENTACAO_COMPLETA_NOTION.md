# 📘 Documentação Completa: Plataforma de Apoio GSI Multi-Empresas & Protheus

> **Documento de Gestão, Arquitetura e Aperfeiçoamento**  
> **Status:** Versão 1.0 Operacional e Publicada na Nuvem 24/7  
> **Segurança:** Documento público/privado livre de senhas, tokens ou chaves de acesso.

---

## 🏛️ 1. Arquitetura do Sistema e Portais Envolvidos

O ecossistema do Portal de Conciliação de Fretes é composto por 4 módulos principais interconectados na nuvem:

```
[ Usuário / Equipe ]
         │
         ▼
 1. Portal Web de Conciliação (Render)
    https://conciliacao-fretes.onrender.com
    (Leitura de PDF/CSV + Interface Visual + Grid Editável)
         │
         ▼ (Requisições HTTP REST com X-API-Key)
 2. API Protheus em Nuvem (Railway)
    https://protheus-api-production.up.railway.app
    (Backend Python FastAPI + Conector ODBC)
         │
         ▼ (Consulta SQL nativa via T-SQL)
 3. Banco de Dados SQL Server Protheus (Empresas 14, 15 e 16)
    Database: CNVYB3_184594_PR_PD
    Tabelas de Vendas: SD2160/SC5160 (OACO), SD2150/SC5150 (GSI), SD2140/SC5140 (MP)
         │
         ▼ (Homologação Futura)
 4. Servidor Protheus AppServer (ERP TOTVS)
    Rotina REST ADVPL: REST_AMARFRET.PRW / MATA116 (ExecAuto)
```

---

### 🌐 Resumo dos Portais e Links do Projeto:

| Componente / Portal | URL / Endereço | Descrição & Função |
| :--- | :--- | :--- |
| **Portal Web (Render)** | `https://conciliacao-fretes.onrender.com` | Interface web 24/7 onde a equipe faz upload de faturas, edita notas e confere os valores. |
| **Repositório GitHub** | `https://github.com/cofresgoldsafe/conciliacao-fretes` | Código-fonte versionado contendo a interface em HTML/CSS/JS, o servidor Express e os parsers Python. |
| **API Protheus (Railway)** | `https://protheus-api-production.up.railway.app` | Serviço backend em Python FastAPI que executa queries SQL de leitura no banco Protheus. |
| **Banco de Dados Protheus** | `CNVYB3_184594_PR_PD` (SQL Server) | Base de dados oficial do ERP Protheus contendo os registros de saída (`SD2`) e vendas (`SC5`). |

---

## 💡 2. Funcionalidades Desenvolvidas (Entregas Concluídas)

### 📄 A. Extração Inteligente de Faturas (Parsers Python)
- **Faturas Rodonaves (Tipo 1 - PDF):** O extrator Plumber (`parser_rodonaves.py`) lê PDFs multipáginas da Rodonaves, extraindo CT-es, NFs originárias, valores orçados/cobrados e identificando o pagador.
- **Faturas VIPP Visualset / Correios (Tipo 2 - CSV/TXT):** O parser (`parser_tipo2.py`) lê relatórios de frete e postagem em formato texto ou separado por vírgulas.
- **Faturas Correios SFE (Extrato Analítico PDF - Aba 2):** O parser nativo (`parser_correios.py`) lê faturas analíticas mensais dos Correios, extraindo todas as etiquetas de rastreamento (`AD...BR`, `AP...BR`), valores de frete, serviços (`SEDEX`/`PAC`), pesos e datas de postagem.
- **Detecção Automática do Pagador & Empresa:** Identificação automática da empresa pagadora no cabeçalho da fatura:
  - **OACO PRODUTOS DE ACO LTDA** ➔ Empresa 16
  - **GSI BW EQUIPAMENTOS DE ACO LTDA** ➔ Empresa 15
  - **METAL PLENO EQUIPAMENTOS DE ACO LTDA** ➔ Empresa 14

### 🔌 B. Conexão ao Protheus & Roteamento Dinâmico de Tabelas
- **JOIN em Tempo Real (`SD2` + `SC5`):** Relaciona os itens da NF de saída (`D2_DOC`) com o Pedido de Venda (`D2_PEDIDO`) e o valor do frete negociado no pedido.
- **Unificação da Coluna de Frete (`Cobrado Cli.`):** Soma o Frete Cobrado no Pedido (`C5_FRETE`) e o Frete Embutido (`C5_VLR_FRT`), exibindo o valor total unificado para o cliente em uma coluna limpa.
- **Roteamento de Tabelas por Empresa:**
  - **Empresa 16 (OACO):** `SD2160` (Itens) + `SC5160` (Pedidos)
  - **Empresa 15 (GSI):** `SD2150` (Itens) + `SC5150` (Pedidos)
  - **Empresa 14 (Metal Pleno):** `SD2140` (Itens) + `SC5140` (Pedidos)

### 💻 C. Grid de Conferência Interativo na Web
- **Edição Viva de NF (`Doc (NF)`):** A equipe pode corrigir qualquer número de nota fiscal na tela. Ao alterar, o sistema reconsulta o Protheus via API no mesmo instante.
- **Batimento da Fatura:** Indicador percentual que confirma se a soma dos CT-es bate 100% com o valor total da fatura.
- **Exportação CSV:** Download imediato da tabela conciliada com todas as colunas formatadas.

---

## 📍 3. Onde Paramos (Status Atual - Versão 1.1)

1. **Aplicação Publicada na Nuvem 24/7:** O sistema está hospedado e funcionando no Render (`https://conciliacao-fretes.onrender.com`).
2. **Aba 1 (Faturas Rodonaves / Transportadoras):** 🟢 **100% Operacional** com parsers PDF e consulta SQL Protheus.
3. **Aba 2 — Fatura Correios & ViPP Visualset (Status: Aguardando Token):**
   - **Construído e Testado:** Parser PDF Correios (`parser_correios.py`), módulo cliente SOAP/REST ViPP (`vipp_api.py`), tela e modal de configuração (`#vippConfigModal`) e endpoints `/api/vipp/config`.
   - **Status de Espera:** Aguardando o envio do **Token da API WebService ViPP** solicitado à VisualSet Tecnologia.
   - **Ação Futura:** Assim que a empresa fornecer a chave, basta cadastrá-la no botão `⚙️ Configurar Token API ViPP` do portal para que a busca automática Etiqueta $\rightarrow$ NF no ERP seja ativada.
4. **Aba 3 — Vendedores (Status: 🟢 Concluído):**
   - **Sub-aba 1 (Consulta Pedido):** Busca multi-empresa por `CodWeb`, `Número do Pedido` ou `Nome do Cliente`. Modal de detalhamento completo com cadastro, entrega, condições de pagamento e itens da tabela `SC6`.
   - **Sub-aba 2 (Comissões):** Consulta de comissões por período (ciclo 26 a 25) nas tabelas `SE3`, com totalizadores em destaque, limitação de 60 dias e isolamento por vendedor (`juliana`, `andrea`, `figueiredo`).
5. **Aba 4 — Configurações & Gerenciamento de Usuários (Status: 🟢 Concluído):**
   - **Estrutura de 2 Níveis:** 4 Abas principais (`📦 LOGÍSTICA`, `🔍 CONSULTA PED/NF`, `💼 VENDEDORES`, `⚙️ CONFIGURAÇÕES`) com sub-abas internas.
   - **Controle de Acesso:** Permissões granulares cadastradas por usuário (`logistica`, `consulta`, `vendedores`, `configuracoes`).
   - **Usuários Ativos:** `alexandre` (Admin), `erica`, `wallerson` (Operadores), `juliana`, `andrea`, `figueiredo` (Vendedores).
6. **Botão "Lançar Fretes" Inabilitado:** O botão de gravação no Protheus foi mantido visivelmente **desabilitado (`disabled`)** em tom cinza, aguardando a publicação do endpoint REST no Protheus.

---

## 🚀 4. Plano de Aperfeçoamento e Próximos Passos (Roadmap)

### 🔹 Fase 1: Homologação da Gravação no Protheus (MATA116 / ExecAuto)
- Compilação do arquivo REST ADVPL ([`REST_AMARFRET.PRW`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/REST_AMARFRET.PRW)) no AppServer do Protheus.
- Habilitação do botão de gravação para efetivar a inclusão automática dos fretes via ExecAuto.

### 🔹 Fase 2: Autenticação e Controle de Acesso por Usuário 🟢 (Concluído)
- Tela de Login com persistência de 7 dias no `localStorage`.
- Gerenciamento completo de permissões de abas por perfil e reset de senhas.

### 🔹 Fase 3: Regras Automáticas de Divergência
- Alerta visual imediato caso a diferença entre o frete cobrado pela transportadora e o frete cobrado do cliente exceda uma tolerância configurável (ex: ± R$ 5,00).

### 🔹 Fase 4: Expansão para Novas Transportadoras
- Adição de modelos de leitura para novas transportadoras (Jamef, Braspress, TNT, etc.).

---

## 🛡️ 5. Segurança e Proteção de Dados
- Nenhuma chave de API, token ou senha de banco de dados foi inserida neste documento ou comitada no repositório.
- Todas as credenciais confidenciais permanecem protegidas exclusivamente em **Variáveis de Ambiente (`Environment Variables`)** no painel da nuvem.
