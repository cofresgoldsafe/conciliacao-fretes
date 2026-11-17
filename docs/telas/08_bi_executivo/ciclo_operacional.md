# Documentação de Tela: Ciclo Operacional & Capital de Giro

> **Identificador DOM:** `#tab-bi-ciclo-operacional`  
> **Módulo:** BI Executivo (Macro-Área 8)  
> **Perfil de Acesso (RBAC):** `admin`, `diretoria` (BI)  
> **Controlador Frontend:** `public/js/bi_ciclo_operacional.js`  
> **Motor Backend:** `bi_ciclo_operacional_engine.js`  
> **Endpoints REST:** `GET /api/bi/ciclo-operacional`, `POST /api/bi/ciclo-operacional/sync`

---

## 1. Visão Geral e Finalidade

A sub-aba **Ciclo Operacional** apresenta os indicadores de saúde operacional, fluxo de caixa e gestão de capital de giro das empresas do Grupo GSI (14 - Metal Pleno, 15 - GSI Cofres, 16 - OAÇO e Consolidado Grupo GSI), integrados diretamente com o ERP TOTVS Protheus MSSQL.

Os indicadores respondem de forma executiva às três perguntas cruciais da controladoria:
1. *Quanto tempo a mercadoria leva para girar e se transformar em dinheiro no banco?* (**Ciclo Operacional**)
2. *Durante quantos dias a empresa precisa financiar suas operações com recursos próprios antes de receber dos clientes?* (**Ciclo Financeiro / Caixa**)
3. *Qual é o montante financeiro em R$ necessário para manter a operação girando com segurança?* (**Necessidade de Capital de Giro - NCG**)

---

## 2. Indicadores e Memória de Cálculo

### 2.1 PME (Prazo Médio de Estocagem)
- **Definição:** O tempo médio em dias que os produtos ou insumos permanecem no estoque antes de serem vendidos.
- **Fórmula:** 
  $$\text{PME} = \left( \frac{\text{Estoque PA Atual a Custo (SB2 + SB1)}}{\text{CMV Diário dos últimos 365 dias (SD2)}} \right)$$
- **Filtro Protheus:** `B2_QATU > 0`, produtos tipo `PA`, valorizado pelo custo unitário (`B1_VLUNIT` / `B2_CM1`). CMV baseado em itens com CFOP de venda (`5.1xx, 6.1xx, 5.4xx, 6.4xx`).

### 2.2 PMRV (Prazo Médio de Recebimento de Vendas)
- **Definição:** O prazo médio concedido aos clientes para pagamento das vendas efetuadas.
- **Fórmula:**
  $$\text{PMRV} = \left( \frac{\text{Contas a Receber Operacionais (SE1)}}{\text{Faturamento Diário de Vendas dos últimos 365 dias (SF2)}} \right)$$
- **Filtro Protheus:** Títulos em aberto (`E1_SALDO > 0.01`), tipos operacionais (`NF`, `DP`, `DU`, `FT`), confrontado com o faturamento líquido de saídas (`SF2` tipo `N` com CFOPs de faturamento).

### 2.3 PMPC (Prazo Médio de Pagamento de Compras)
- **Definição:** O prazo médio que os fornecedores concedem para que a empresa pague as mercadorias e matérias-primas adquiridas.
- **Fórmula:**
  $$\text{PMPC} = \left( \frac{\text{Contas a Pagar Fornecedores (SE2)}}{\text{Compras Diárias dos últimos 365 dias (SF1)}} \right)$$
- **Filtro Protheus:** Títulos em aberto (`E2_SALDO > 0.01`), excluindo adiantamentos (`PA`), provisórios (`PR`) e impostos (`TX`), confrontado com as notas fiscais de entrada de insumos (`SF1` com CFOPs `1.1xx, 2.1xx, 1.4xx, 2.4xx`).

### 2.4 CO (Ciclo Operacional)
- **Definição:** Compreende a duração total da operação produtiva e comercial (desde a entrada da mercadoria em estoque, passando pela venda, até o recebimento do cliente).
- **Fórmula:**
  $$\text{CO} = \text{PME} + \text{PMRV}$$

### 2.5 CF (Ciclo Financeiro / Ciclo de Caixa)
- **Definição:** O período descoberto entre o pagamento aos fornecedores e o recebimento das vendas.
- **Fórmula:**
  $$\text{CF} = \text{CO} - \text{PMPC} = (\text{PME} + \text{PMRV}) - \text{PMPC}$$
- **Tratamento de Eficiência ($CF \le 0$):** Quando o prazo concedido por fornecedores é maior que o ciclo operacional total, a operação é **autofinanciada por terceiros**, exibindo badge verde de máxima eficiência no caixa.

### 2.6 NCG (Necessidade de Capital de Giro)
- **Visão Patrimonial Operacional:**
  $$\text{NCG}_{patrimonial} = (\text{Estoque Total} + \text{Duplicatas a Receber}) - \text{Fornecedores a Pagar}$$
- **Visão Financeira de Caixa:**
  $$\text{Se } CF > 0 \implies \text{NCG}_{giro} = CF \times \text{CMV Diário}$$
  $$\text{Se } CF \le 0 \implies \text{NCG}_{giro} = \text{R\$ 0,00 (Operação coberta por fornecedores)}$$

---

## 3. Topologia e Performance

- **Cache Híbrido:** Leitura em **< 100ms** utilizando o Supabase PostgreSQL (`bi_ciclo_operacional_cache`) e fallback JSON atômico local (`data/bi_ciclo_operacional_cache.json`).
- **Sincronização:** Botão "Sincronizar Protheus" dispara consulta parametrizada via Oracle Cloud IP Fixo / Railway Relay, com cooldown de 60 segundos anti-sobrecarga.
- **Multi-Empresa:** Seletor de visualização consolidada do Grupo ou isolada por empresa (14 - Metal Pleno, 15 - GSI Cofres, 16 - OAÇO).
