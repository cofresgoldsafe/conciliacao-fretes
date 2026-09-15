# Fechamento Fiscal Mensal — Analista Financeiro & Fiscal

> **Documentação Técnica Modular — Portal GSI**  
> Módulo de Fechamento Fiscal, Apuração de Faturamento Bruto, RBT12 e Gestão de NFS-e Nota Paulistana SP.

---

## 📋 Identificação da Tela

| Atributo | Especificação |
| :--- | :--- |
| **Macro-Área / Pasta** | `docs/telas/07_analista_fin/` (Analista Financeiro & Fiscal) |
| **Nome da Tela** | Fechamento Fiscal Mensal Multiempresa & Apuração RBT12 |
| **Tab ID DOM** | `#tab-fechamento-fiscal` |
| **Botão de Acesso DOM** | `#btnTabFechamentoFiscal` |
| **Permissão RBAC** | `analista-fin`, `admin` |
| **Versão / Data** | v2.4 — Setembro/2026 |
| **Status Operacional** | 🟢 Produção Homologada (Batimento 100% com OACO 08/2026) |

---

## 1. Propósito da Tela & Personas

### 1.1 Objetivo de Negócio
A tela de **Fechamento Fiscal Mensal** foi desenvolvida para automatizar, consolidar e auditar toda a apuração de entradas, saídas e faturamento tributável das três filiais do grupo econômico:
- **Empresa 14:** Metal Pleno Comércio de Fechaduras e Ferragens
- **Empresa 15:** GSI Brasil Prestação de Serviços e Manutenção de Cofres
- **Empresa 16:** OACO Indústria e Comércio de Cofres

Historicamente, essa apuração exigia exportações manuais massivas do ERP Totvs Protheus para planilhas eletrônicas (como a planilha homologada `REL GERAL OACO AGOSTO 2026.xlsx`), demandando horas de conciliação entre tipos de documento (`SPED`, `CTR`, `NFS`, `IMP`), tratamento manual de devoluções com formulário próprio e exclusão artesanal de romaneios internos (`ROMA`). 

A funcionalidade consolida em segundos:
1. **Total Tributado Real:** Faturamento contábil tributável para geração das guias do Simples Nacional (DAS) ou apuração do Lucro Presumido.
2. **Histórico RBT12:** Acumulado das 12 competências anteriores contínuas para enquadramento nas faixas de alíquota do Simples Nacional.
3. **Módulo de NFS-e Nota Paulistana (SP):** Captura direta via mTLS, importação em lote e exportação de XMLs em arquivo compactado `.zip` para a Empresa 15.

### 1.2 Personas Envolvidas
- **Analista Fiscal / Financeiro (ex: Érica):** Responsável primária pelo fechamento mensal, auditoria de notas fiscais, verificação de CFOPs e envio dos relatórios consolidados à contabilidade.
- **Gerente Financeiro / Controladoria (ex: Rubens / Alexandre):** Validação dos valores de faturamento bruto, margem tributária e aprovação final da consolidação mensal.
- **Contabilidade Externa (Escritório Contábil):** Consumidor final das informações apuradas, arquivos XML de NFS-e e relatórios para geração das guias de tributos federais e municipais.

### 1.3 Fluxo Operacional Típico
1. O analista seleciona a **Empresa** (`14 - Metal Pleno`, `15 - GSI Brasil` ou `16 - OACO`).
2. O sistema sugere automaticamente o intervalo de datas do **mês anterior completo** (ex: `01/08/2026` a `31/08/2026`).
3. O usuário seleciona o critério de data para Entradas: **Data de Emissão** (padrão contábil) ou **Data de Digitação** (registro no Protheus).
4. Clica em **"Consultar Fechamento"**: os dados são extraídos em tempo real do banco MSSQL do Protheus, totalizados e exibidos no painel de KPIs e grid de notas.
5. (Se Empresa 15) O usuário aciona **"Sincronizar NFS-e SP"** ou faz upload de arquivo `.xml` / `.txt` da Prefeitura de São Paulo para incorporar serviços prestados.
6. O analista revisa os cards de KPIs (Saídas, Devoluções, Remessas, Serviços, Entradas, CTRs, Impostos e RBT12).
7. Clica em **"Consolidar Fechamento"** para congelar o período e registrar o log de auditoria no PostgreSQL/Supabase.
8. Clica em **"Exportar CSV"** ou **"Baixar Lote XML (.zip)"** para enviar o pacote de apuração à contabilidade.

---

## 2. Arquitetura de Código & Componentes

```mermaid
flowchart TD
    UI["Frontend: public/js/fechamento_fiscal.js<br/>DOM: #tab-fechamento-fiscal"] -->|HTTP GET /api/analista-fin/fechamento-fiscal| SRV["Backend: server.js<br/>requireAuth (RBAC: analista-fin)"]
    SRV -->|Consultar SF1/SF2/SD1/SD2/SA1/SA2| PROTHEUS["protheus_db.js<br/>ERP Totvs Protheus MSSQL"]
    SRV -->|Consultar/Salvar Fechamento Consolidado| PG["postgres_db.js<br/>Supabase / PostgreSQL"]
    SRV -->|Ingestão/Sync NFS-e SP| PAULISTANA["paulistana_client.js<br/>WebService Pref. São Paulo (mTLS)"]
    SRV -->|Geração de Pacote ZIP| ZIP["zip_util.js<br/>Buffer ZIP Nativo em Memória"]
```

### 2.1 Estrutura Frontend
- **Arquivo de Script:** [`public/js/fechamento_fiscal.js`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/public/js/fechamento_fiscal.js) (902 linhas, estruturado em IIFE modular estrita).
- **Container DOM:** `#tab-fechamento-fiscal` em [`public/index.html`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/public/index.html).
- **Componentes Visuais Chave:**
  - `#selFechamentoEmpresa`: Seletor de empresa (`14`, `15`, `16`).
  - `#inputFechamentoDataDe` e `#inputFechamentoDataAte`: Seletores de data com inicialização automatizada para o primeiro e último dia do mês anterior.
  - `#selCriterioDataEntrada`: Alternância entre `EMISSAO` (F1_EMISSAO) e `DIGITACAO` (F1_DTDIGIT).
  - `#inputBuscaFechamento`: Campo de busca rápida no grid (busca por número de NF, razão social, CNPJ/CPF ou CFOP).
  - `#selFiltroFluxoFechamento` e `#selFiltroTipoFechamento`: Filtros instantâneos por fluxo (`TODOS`, `SAÍDA`, `ENTRA`) e tipo (`TODOS`, `VENDA_TRIBUTADA`, `SERVICO`, `DEVOLUCAO`, `REMESSA`, `CTR`, `IMPOSTO`).
  - Grid de Resultados: Tabela com `#tbodyFechamentoFiscal`, colunas com badges coloridos de operação e indicador explícito de incidência tributária (`Gera Imposto: Sim/Não`).
  - Painel de Metadados Consolidados: Exibição de carimbo com data, hora e usuário responsável pela última consolidação.

### 2.2 Estrutura Backend & Serviços
- **Servidor HTTP:** Endpoints sob o prefixo `/api/analista-fin/fechamento-fiscal` no [`server.js`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/server.js).
- **Middleware de Proteção:** `requireAuth` validando token Bearer e verificando se a lista de permissões do usuário contém `analista-fin` ou o papel de `admin`.
- **Motor Protheus:** Funções `consultarFechamentoFiscalProtheus` e `obterHistoricoFaturamento12MesesProtheus` no [`protheus_db.js`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/protheus_db.js).
- **Cliente Nota Paulistana:** [`paulistana_client.js`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/paulistana_client.js) para conexão mTLS SOAP com a Prefeitura de São Paulo e parsers XML/TXT de lote.
- **Utilitário de Compressão:** [`zip_util.js`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/zip_util.js) gerador de arquivos ZIP com CRC-32 nativo sem binários nativos ou dependências do sistema operacional.
- **Repositório Relacional:** [`postgres_db.js`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/postgres_db.js) para persistência em Supabase com fallback JSON local (`data/fechamentos_fiscais.json`).

---

## 3. Banco de Dados & Modelagem

### 3.1 Protheus ERP (MSSQL)

A consulta ao Protheus integra tabelas fiscais nativas com saneamento de exclusões lógicas (`D_E_L_E_T_ = ' '`):

```mermaid
erDiagram
    SF2 ||--|{ SD2 : "contem itens"
    SF1 ||--|{ SD1 : "contem itens"
    SD2 }|--|| SF4 : "avalia duplicata"
    SF2 ||--|| SA1 : "vincula cliente"
    SF1 ||--o| SA2 : "vincula fornecedor"
    SF1 ||--o| SA1 : "vincula cliente em devolucao"
    
    SF2 {
        string F2_FILIAL
        string F2_DOC
        string F2_SERIE
        string F2_EMISSAO
        float F2_VALBRUT
        string F2_TIPO
        string F2_ESPECIE
        string F2_CHVNFE
    }
    SD2 {
        string D2_CFOP
        string D2_TES
    }
    SF4 {
        string F4_DUPLIC
    }
    SF1 {
        string F1_FILIAL
        string F1_DOC
        string F1_SERIE
        string F1_EMISSAO
        string F1_DTDIGIT
        float F1_VALBRUT
        string F1_TIPO
        string F1_ESPECIE
        string F1_FORNECE
        string F1_LOJA
        string F1_NFORIG
        string F1_SERORIG
    }
```

#### Destaques de Mapeamento SQL:
1. **Saídas (SF2 + SD2 + SF4 + SA1):**
   - Agrupamento por documento (`F2_DOC`, `F2_SERIE`, `F2_CLIENTE`, `F2_LOJA`).
   - Avaliação do campo `SF4.F4_DUPLIC`: determina se a TES gera duplicata financeira, critério indispensável para diferenciar Venda Faturada de Remessa em garantia/conserto.
2. **Entradas (SF1 + SD1 + SA2 / SA1):**
   - Suporte ao duplo critério de data: `F1_EMISSAO` (data fiscal) ou `F1_DTDIGIT` (data de entrada contábil).
   - **Formulário Próprio MATA103:** Quando a empresa emite a própria nota fiscal de devolução referente a uma mercadoria retornada por pessoa física ou cliente sem inscrição (`F1_TIPO = 'D'`), o cadastro de parceiro é extraído da tabela de Clientes (`SA1010` via `F1_FORNECE = A1_COD AND F1_LOJA = A1_LOJA`), garantindo a exibição do CPF/CNPJ e Razão Social legítimos do cliente.

### 3.2 PostgreSQL / Supabase

#### Tabela `fechamento_fiscal_consolidado`
Persiste o fechamento congelado e auditado:
- `id`: UUID (Primary Key).
- `empresa_cod`: VARCHAR(10) (`14`, `15` ou `16`).
- `ano_mes`: VARCHAR(6) (ex: `202608`).
- `data_inicio`: DATE.
- `data_fim`: DATE.
- `totais`: JSONB estruturado contendo a soma consolidada de todas as categorias.
- `rbt12`: NUMERIC(15,2) (Receita Bruta dos 12 meses acumulada).
- `usuario`: VARCHAR(100) (Nome ou e-mail do operador responsável).
- `consolidado_em`: TIMESTAMP WITH TIME ZONE DEFAULT NOW().

#### Tabela `nfse_emitidas_sp`
Persiste as notas fiscais de serviços tomados ou prestados na capital paulista (GSI - Empresa 15):
- `chave_acesso`: VARCHAR(60) (Primary Key).
- `numero_nfse`: VARCHAR(20).
- `serie_nfse`: VARCHAR(10).
- `empresa_cod`: VARCHAR(10) (Estritamente `15`).
- `data_emissao`: TIMESTAMP WITH TIME ZONE.
- `valor_servicos`: NUMERIC(15,2).
- `valor_liquido`: NUMERIC(15,2).
- `tomador_cnpj_cpf`: VARCHAR(20).
- `tomador_razao`: VARCHAR(255).
- `discriminacao`: TEXT.
- `xml_conteudo`: TEXT (Armazenamento íntegro do XML assinado pela prefeitura).
- `status`: VARCHAR(20) (`CONCILIADO`, `PENDENTE`, `CANCELADO`).

---

## 4. Regras de Negócio & Cálculos Chave

### 4.1 Classificação Determinística de Saídas
Toda nota de saída registrada no Protheus (`SF2`) é processada pela função determinística de classificação fiscal:

```javascript
// Algoritmo de Classificação de Saída
if (tipo === 'D' || cfop.startsWith('52') || cfop.startsWith('62') || cfop.startsWith('72')) {
  tipoOperacao = 'DEVOLUCAO';
  geraImposto = false;
} else if (
  tipo === 'S' ||
  ['NFS', 'RPS', 'NFPS', 'SE', 'NFSE', 'NFS-E'].includes(esp) ||
  cfop === '5933' || cfop === '6933' ||
  tes === '594' || tes === '099' || tes === '108' ||
  descrTes.includes('VENDA DE SERV') || descrTes.includes('PRESTACAO DE SERV')
) {
  tipoOperacao = 'SERVICO';
  geraImposto = true;
} else if (
  tipo === 'B' ||
  cfop === '5554' ||
  (cfop.startsWith('59') && cfop !== '5922') ||
  (cfop.startsWith('69') && cfop !== '6922') ||
  cfop === '5117' || cfop === '6117' ||
  geraDuplic !== 'S'
) {
  tipoOperacao = 'REMESSA';
  geraImposto = false;
} else if (
  (tipo === 'N' || tipo === 'C') &&
  geraDuplic === 'S' &&
  (cfop.startsWith('51') || cfop.startsWith('54') || cfop.startsWith('61') || cfop.startsWith('64') || cfop.startsWith('71') || cfop === '5922' || cfop === '6922')
) {
  tipoOperacao = 'VENDA_TRIBUTADA';
  geraImposto = true;
}
```

### 4.2 Exclusão Estrita de Documentos ROMA
Documentos com espécie ou tipo `ROMA` representam romaneios de movimentação interna de fábrica e depósitos.
- **Regra:** Devem ser descartados sumariamente da apuração contábil de Entradas.
- **Caso Homologado OACO 08/2026:** Foram filtrados e descartados exatamente 6 romaneios internos, totalizando 60 notas fiscais válidas de entrada (em vez de 66 registros brutos).

### 4.3 Total Tributado
O **Total Tributado** representa a base de cálculo exata para a geração das guias de recolhimento:
$$\text{Total Tributado} = \sum \text{Vendas Tributadas} + \sum \text{Serviços Prestados}$$

- Na **OACO (16)** em 08/2026: Não houve notas de serviço, totalizando R$ 182.680,74 em 70 NFs tributadas.
- Na **GSI (15)**: O Total Tributado soma as notas de venda mercantil Protheus às NFS-e de prestação de serviços capturadas no lote da Prefeitura de São Paulo.

### 4.4 Apuração do RBT12 (Receita Bruta dos 12 Meses Anteriores)
Conforme a Lei Complementar 123/2006, o enquadramento no Simples Nacional é determinado pela soma da receita bruta acumulada dos 12 meses anteriores ao período de apuração:
$$\text{RBT12} = \sum_{m = \text{Mês}-12}^{\text{Mês}-1} \text{Total Tributado}(m)$$

- Exemplo: Para o fechamento da competência `202608`, o sistema apura sequencialmente o faturamento de `202508` até `202607`.
- **Isolamento de Filiais:** As empresas `14` e `16` calculam seu faturamento mercantil puro no Protheus. A empresa `15` incorpora automaticamente os serviços NFS-e municipais no histórico de 12 meses.

---

## 5. Endpoints REST da API

### 5.1 `GET /api/analista-fin/fechamento-fiscal`
- **Descrição:** Retorna a apuração completa de notas de saída, devoluções, remessas e entradas do Protheus.
- **Autenticação:** `Bearer JWT` (Permissão: `analista-fin` ou `admin`).
- **Query Params:**
  - `empresa`: Código da empresa (`14`, `15` ou `16`).
  - `dataDe`: Data de início (`AAAA-MM-DD`).
  - `dataAte`: Data final (`AAAA-MM-DD`).
  - `criterioDataEntrada`: `EMISSAO` ou `DIGITACAO`.
- **Exemplo de Resposta (HTTP 200):**
  ```json
  {
    "ok": true,
    "empresa": "OACO",
    "empresaCodigo": "16",
    "periodo": { "de": "2026-08-01", "ate": "2026-08-31" },
    "totais": {
      "totalSaidas": { "qtd": 70, "valor": 182680.74 },
      "totalTributado": { "qtd": 70, "valor": 182680.74 },
      "totalDevolucao": { "qtd": 1, "valor": 607.00, "entradas": { "qtd": 1, "valor": 607.00 }, "saidas": { "qtd": 0, "valor": 0.00 } },
      "totalRemessa": { "qtd": 0, "valor": 0.00 },
      "totalServico": { "qtd": 0, "valor": 0.00 },
      "totalEntradas": { "qtd": 60, "valor": 89963.79 },
      "totalCtr": { "qtd": 37, "valor": 6468.36 },
      "totalImpostos": { "qtd": 3, "valor": 15818.17 },
      "totalNfe": { "qtd": 10, "valor": 25282.46 }
    },
    "itens": [ ... ]
  }
  ```

### 5.2 `GET /api/analista-fin/fechamento-fiscal/historico-12m`
- **Descrição:** Retorna as 12 competências anteriores consecutivas e o montante consolidado do RBT12.
- **Query Params:** `empresa=16&anoMes=202608`.

### 5.3 `POST /api/analista-fin/fechamento-fiscal/consolidar`
- **Descrição:** Congela a apuração do mês e registra no PostgreSQL/Supabase com carimbo de usuário.
- **Request Body:** Objeto completo de apuração (`empresa`, `anoMes`, `totais`, `rbt12`).

### 5.4 `POST /api/analista-fin/nfse-emitidas/sync`
- **Descrição:** Dispara consulta ao WebService da Nota Paulistana (SP) via mTLS para capturar NFS-e da Empresa 15.

### 5.5 `POST /api/analista-fin/nfse-emitidas/upload`
- **Descrição:** Upload multipart/form-data de arquivo `.xml` ou lote `.txt` emitido na Prefeitura de SP.

### 5.6 `GET /api/analista-fin/nfse-emitidas/exportar-zip`
- **Descrição:** Faz o download em lote de todos os XMLs de NFS-e do período selecionado compactados em arquivo `.zip`.

---

## 6. Testes Automatizados Vinculados

A conformidade contábil e a estabilidade da tela são verificadas por duas suítes dedicadas:

| Arquivo de Teste | Quantidade de Cenários | Foco da Validação |
| :--- | :--- | :--- |
| [`test_fechamento_fiscal.js`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/test_fechamento_fiscal.js) | 11 Testes | Batimento OACO 08/2026, exclusão de ROMA, classificação de serviços, devoluções MATA103, RBT12 e persistência relacional. |
| [`test_nfse_paulistana_fechamento.js`](file:///C:/Users/Alexandre/Documents/Gemini-Cli/test_nfse_paulistana_fechamento.js) | 8 Testes | Parsers XML/TXT da Nota Paulistana, integridade ZIP sem corrupção, isolamento entre filiais e fail-closed security. |

### Comandos de Execução dos Testes:
```bash
node test_fechamento_fiscal.js
node test_nfse_paulistana_fechamento.js
```

---

## 7. Histórico Recente da Tela

| Versão | Data | Autor | Principais Alterações |
| :--- | :--- | :--- | :--- |
| **v2.4** | 2026-09-15 | Alexandre / Equipe GSI | Implementação de exportação em lote ZIP nativa em memória (`zip_util.js`) para notas da Prefeitura de SP. |
| **v2.3** | 2026-09-12 | Alexandre / Equipe GSI | Inclusão de suporte e tratamento a formulário próprio no MATA103 (NFe 000660 OACO) resolvendo cliente via SA1. |
| **v2.2** | 2026-09-08 | Alexandre / Equipe GSI | Ajuste de classificação de serviços na saída (CFOP 5933, TES 594 e espécie NFS) e soma no Total Tributado. |
| **v2.1** | 2026-09-04 | Alexandre / Equipe GSI | Exclusão estrita de romaneios internos (`ROMA`) na apuração de Entradas para validação da homologação OACO. |
| **v2.0** | 2026-09-01 | Alexandre / Equipe GSI | Lançamento oficial da sub-aba Fechamento Fiscal com suporte multiempresa (14, 15, 16) e cálculo de RBT12. |
