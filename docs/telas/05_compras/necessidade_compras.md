# Necessidade de Compras Protheus

> **Macro-Área:** Compras  
> **Identificador DOM:** `#tab-compras-necessidade` | **Botão:** `#btnTabComprasNecessidade`  
> **Permissão RBAC:** admin, user (Compras)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 30/09/2026 (v8.284 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Apuração analítica e ágil das necessidades de ressuprimento de produtos acabados por empresa (`14 - Metal Pleno`, `15 - GSI` e `16 - OAÇO`), com batimento fiel ao módulo de compras do TOTVS Protheus (`necessidade-empresa-16.png`), controle de novas necessidades vs pendentes e exportação Excel.
- **Personas Atendidas:** Analistas de Compras, Gestores de Suprimentos, Controladoria e Diretoria Operacional.

---

## 2. Arquitetura de Código & Componentes
- **Frontend:**
  - Script isolado: `public/js/compras_necessidade.js`
  - Estrutura HTML: `public/index.html` (aba `#btnTabComprasNecessidade` e painel `#tab-compras-necessidade`)
  - Estilização Protheus Style: `public/style.css` (classes `.table-protheus-necessidade`, `.row-selected` e suporte a tema Claro/Escuro)
  - Orquestração de abas: `public/app.js` (`VENDEDORES_SUB_TABS` e inicialização)
- **Backend / Rotas:**
  - Controlador REST: `routes/compras_necessidade.js` (`GET /api/compras/necessidade`)
  - Bootstrap: `server.js`
  - Motor de banco de dados: `protheus_db.js` (`consultarNecessidadeComprasProtheus`)

---

## 3. Banco de Dados & Modelagem
- **Catálogo de Produtos:** `SB1090` (e `SB1160`), filtrando produtos acabados (`B1_TIPO = 'PA'`), ativos (`B1_MSBLQL <> '1'`) com Ponto de Pedido configurado (`B1_EMIN > 0`).
- **Saldos Físicos (SB2):** `SB2140` (MP), `SB2150` (GSI), `SB2160` (OAÇO) via `SUM(B2_QATU)`.
- **Vendas em Aberto (SC6):** `SC6140`, `SC6150`, `SC6160` via `SUM(C6_QTDVEN)` para pedidos não faturados e sem resíduo.
- **Compras em Aberto (SC7):** `SC7140`, `SC7150`, `SC7160` via `SUM(C7_QUANT - C7_QUJE)` com saldo pendente e sem cancelamento.
- **Fornecedores (SA2):** `SA2010` via join em `B1_PROC = A2_COD` para extração dos primeiros 15 dígitos da Razão Social.

---

## 4. Regras de Negócio & Cálculos Chave

### 4.1 Fórmula Oficial Protheus
$$\text{Necessidade Líquida} = (\text{Ponto de Pedido} + \text{Ped Vendas}) - (\text{Saldo Estoque} + \text{Ped Compras})$$
$$\text{Necessidade Bruta} = (\text{Ponto de Pedido} + \text{Ped Vendas}) - \text{Saldo Estoque}$$

### 4.2 Modos de Visualização
- **Somente Novas Necessidades (`novas`):** Exibe apenas produtos onde $\text{Necessidade Líquida} > 0$ (ou seja, compras já efetuadas ainda não cobrem a carência do ponto de pedido).
- **Mostra Necessidades Novas e Pendentes (`todas`):** Exibe todos os produtos com carência de estoque ($\text{Necessidade Bruta} > 0$), incluindo itens com ordens de compra em trânsito.

### 4.3 Colunas da Listagem
1. `[ ]` (Checkbox de seleção individual e master checkbox no cabeçalho)
2. `Produto` (Código Protheus, ex: `01801080801B001`)
3. `Descricao` (Descrição completa do cadastro)
4. `Ped Vendas` (Total em pedidos de venda)
5. `Ped Compras` (Total em ordens de compra pendentes)
6. `Saldo Estoque` (Saldo físico em estoque, destacando negativos em vermelho)
7. `Ponto de Ped` (Estoque mínimo / Ponto de pedido)
8. `Necessidade de Compras` (Quantidade calculada a comprar em destaque azul)
9. `Cod Fornec` (Código do fornecedor principal `B1_PROC`)
10. `Nome Fornec` (Primeiros 15 caracteres do nome do fornecedor em `SA2010`)

### 4.4 Barra de Ações
- **Gerar Pedido:** Desabilitado (`disabled="disabled"`) com tooltip indicando módulo futuro de gravação no ERP.
- **Atualizar:** Reexecuta a consulta mantendo os filtros selecionados para refletir pedidos recém-entrados.
- **Exporta p/ Excel:** Gera download instantâneo de arquivo CSV (delimitador `;` e BOM UTF-8) com o nome padronizado `necessidade_compras_empresa_{cod}_{modo}_{data}.csv`.
- **Sair:** Limpa a listagem e os seletores, retornando a tela ao estado inicial vazio.

---

## 5. Endpoints REST da API
- `GET /api/compras/necessidade`
  - Query Params:
    - `empresa`: `'14'` | `'15'` | `'16'` (Obrigatório)
    - `modo`: `'novas'` | `'todas'` (Opcional, default: `'novas'`)
  - Payload de Resposta:
    ```json
    {
      "success": true,
      "empresa": "16",
      "empresaNome": "OAÇO (16)",
      "modo": "novas",
      "total": 9,
      "itens": [
        {
          "produto": "01801080801B001",
          "descricao": "ARMARIO CORTA FOGO GSI 80X40X35 CM - VERMELHO PAREDE",
          "pedVendas": 0,
          "pedCompras": 0,
          "saldoEstoque": 0,
          "pontoPed": 5,
          "necessidade": 5,
          "codFornec": "120415",
          "nomeFornec": "GSI COMERCIO DE",
          "razaoSocialCompleta": "GSI COMERCIO DE COFRES ARMARIOS E FECHADURAS LTDA",
          "possuiComprasAbertas": false
        }
      ]
    }
    ```

---

## 6. Testes Automatizados Vinculados
Execução da suite de regressão com 7 asserções automatizadas:
```bash
node test_compras_necessidade.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.284 (30/09/2026):** Criação da tela de Necessidade de Compras Protheus no Portal GSI com batimento exato contra a rotina do ERP Protheus (`necessidade-empresa-16.png`), suporte multi-empresa (14, 15, 16), coluna estendida de Fornecedor (15 dígitos), modos de filtro (Novas vs Novas e Pendentes) e exportação para Excel.
