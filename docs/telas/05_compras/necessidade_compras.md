# Necessidade de Compras Protheus

> **Macro-Área:** Compras  
> **Identificador DOM:** `#tab-compras-necessidade` | **Botão:** `#btnTabComprasNecessidade`  
> **Permissão RBAC:** admin, user (Compras)  
> **Status:** Operacional em Produção  
> **Última Atualização:** 01/10/2026 (v8.289 - Homologado)  

---

## 1. Propósito da Tela & Personas
- **Objetivo:** Apuração analítica e ágil das necessidades de ressuprimento de produtos acabados por empresa (`14 - Metal Pleno`, `15 - GSI` e `16 - OAÇO`), com batimento fiel ao módulo de compras do TOTVS Protheus (`necessidade-empresa-16.png`), controle de novas necessidades vs pendentes, isolamento operacional estrito por empresa e exportação Excel.
- **Personas Atendidas:** Analistas de Compras, Gestores de Suprimentos, Controladoria e Diretoria Operacional.

---

## 2. Arquitetura de Código & Componentes
- **Frontend:**
  - Script isolado: `public/js/compras_necessidade.js` (com sincronização de tema claro/escuro, seletor de linha de produtos, centralização compulsória de números, coloração de déficit/sobra e omissão de itens com 0 em vendas e compras)
  - Estrutura HTML: `public/index.html` (aba `#btnTabComprasNecessidade`, seletor `#selGrupoNecessidade` e painel `#tab-compras-necessidade`)
  - Estilização Protheus Style: `public/style.css` (classes `.table-protheus-necessidade`, `.necessidade-val-falta`, `.necessidade-val-destaque`, `.necessidade-val-zero`, `.row-selected` e suporte dinâmico a tema Claro/Escuro sem sobrescrita inline)
  - Orquestração de abas: `public/app.js` (`VENDEDORES_SUB_TABS` e inicialização) e `public/js/vendedores.js` (`aplicarTemaVendedores`)
- **Backend / Rotas:**
  - Controlador REST: `routes/compras_necessidade.js` (`GET /api/compras/necessidade`)
  - Bootstrap: `server.js`
  - Motor de banco de dados: `protheus_db.js` (`consultarNecessidadeComprasProtheus`)

---

## 3. Banco de Dados & Modelagem
- **Catálogo de Produtos:** `SB1090` (compartilhado), filtrando produtos acabados (`B1_TIPO = 'PA'`), ativos (`B1_MSBLQL <> '1'`) com Ponto de Pedido configurado (`B1_EMIN > 0`).
- **Vínculo Operacional Estrito:** Cláusula `EXISTS` no SQL que restringe aos produtos que possuam atividade comprovada na filial (`SD3` movimentações internas, `SD2` vendas, `SC7` ordens de compra ou `SB2` com saldo ativo `B2_QATU <> 0`). Garante que a Empresa 14 (Metal Pleno) nunca liste cofres, e que cada empresa opere exclusivamente suas linhas de negócio.
- **Filtro de Atividade Comercial e Suprimentos:** Omissão compulsória de produtos que tenham `Ped Vendas === 0` e `Ped Compras === 0` (`pedVendas <= 0 && pedCompras <= 0`). Apenas itens que possuam pedidos de venda abertos ou ordens de compra em andamento (`> 0`) são exibidos na grade.
- **Saldos Físicos (SB2):** `SB2140` (MP), `SB2150` (GSI), `SB2160` (OAÇO) via `SUM(B2_QATU)`.
- **Vendas em Aberto (SC6):** `SC6140`, `SC6150`, `SC6160` via `SUM(C6_QTDVEN)` para pedidos não faturados e sem resíduo.
- **Compras em Aberto (SC7):** `SC7140`, `SC7150`, `SC7160` via `SUM(C7_QUANT - C7_QUJE)` com saldo pendente e sem cancelamento.
- **Fornecedores (SA2):** `SA2010` via join em `B1_PROC = A2_COD` para extração dos primeiros 15 dígitos da Razão Social.

---

## 4. Regras de Negócio & Cálculos Chave

### 4.1 Fórmula Oficial
$$\text{Necessidade} = (-\text{Ped Vendas}) + \text{Ped Compras} + \text{Saldo Estoque} - \text{Ponto de Pedido}$$

- **Valores Negativos (ex: `-3`):** Indicam déficit de estoque / necessidade real de compra, destacados em vermelho (`.necessidade-val-falta`).
- **Valor Zero (`0`):** Indica equilíbrio exato com o ponto de pedido, em cor neutra (`.necessidade-val-zero`).
- **Valores Positivos (ex: `1`):** Indicam sobra / estoque coberto pelas compras em relação ao ponto de pedido, em destaque azul celeste (`.necessidade-val-destaque`).

### 4.2 Regra de Omissão de Itens Zerados (0 e 0)
- **Critério Mandatório:** Se $\text{Ped Vendas} = 0$ **E** $\text{Ped Compras} = 0$, o produto é compulsoriamente omitido da listagem.
- **Objetivo Operacional:** Focar a visão da equipe de compras exclusivamente em produtos com demanda de clientes represada ($\text{Ped Vendas} > 0$) ou com ressuprimento já contratado com fornecedores ($\text{Ped Compras} > 0$), eliminando ruídos visuais de itens estagnados.

### 4.3 Seletores de Parâmetros
- **Empresa:** 14 - Metal Pleno, 15 - GSI, 16 - OAÇO.
- **Linha de Produtos:** Todas as Linhas Operadas (`todos`), Armários Corta Fogo (`018`), Cofres (`001`), Racks & Gabinetes (`017`).
- **Visualização das Necessidades:**
  - **Somente Novas Necessidades (`novas`):** Exibe exclusivamente produtos com carência real não suprida pelas ordens de compra em trânsito ($\text{Necessidade} < 0$).
  - **Mostra Necessidades Novas e Pendentes (`todas`):** Exibe todas as necessidades ativas que tenham vendas > 0 ou compras > 0.

### 4.3 Colunas da Listagem & Alinhamento
1. `[ ]` (Checkbox centralizado individual e master no cabeçalho)
2. `Produto` (Código Protheus alinhado à esquerda, ex: `01801080801B001`)
3. `Descricao` (Descrição expandida responsiva alinhada à esquerda sem limite rígido de largura para evitar quebras excessivas de linha)
4. `Ped<br>Vendas` (Total em pedidos de venda, centralizado)
5. `Ped<br>Compras` (Total em ordens de compra pendentes, centralizado)
6. `Saldo<br>Estoque` (Saldo físico em estoque, centralizado, destacando negativos em vermelho)
7. `Ponto<br>de Ped` (Estoque mínimo / Ponto de pedido, centralizado)
8. `Necessid.` (Quantidade calculada conforme a fórmula oficial com coloração contextual, centralizada)
9. `Cod<br>Fornec` (Código do fornecedor principal `B1_PROC`, centralizado)
10. `Nome Fornec` (Primeiros 15 caracteres do nome do fornecedor em `SA2010`, alinhado à esquerda)

### 4.4 Barra de Ações
- **Gerar Pedido:** Desabilitado (`disabled="disabled"`) com tooltip indicando módulo futuro de gravação no ERP.
- **Atualizar:** Reexecuta a consulta mantendo os filtros selecionados para refletir pedidos recém-entrados.
- **Exporta p/ Excel:** Gera download instantâneo de arquivo CSV (delimitador `;` e BOM UTF-8) com o nome padronizado `necessidade_compras_empresa_{cod}_grupo_{grupo}_{modo}_{data}.csv`.
- **Sair:** Limpa a listagem e os seletores, retornando a tela ao estado inicial vazio.

---

## 5. Endpoints REST da API
- `GET /api/compras/necessidade`
  - Query Params:
    - `empresa`: `'14'` | `'15'` | `'16'` (Obrigatório)
    - `modo`: `'novas'` | `'todas'` (Opcional, default: `'novas'`)
    - `grupo`: `'todos'` | `'018'` | `'001'` | `'017'` (Opcional, default: `'todos'`)
  - Payload de Resposta:
    ```json
    {
      "success": true,
      "empresa": "16",
      "empresaNome": "OAÇO (16)",
      "modo": "novas",
      "grupo": "todos",
      "total": 9,
      "itens": [
        {
          "produto": "01801080801B001",
          "descricao": "ARMARIO CORTA FOGO GSI 80X40X35 CM - VERMELHO PAREDE",
          "grupo": "018",
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
Execução da suite de regressão com 10 asserções automatizadas cobrindo todas as empresas e regras:
```bash
node test_compras_necessidade.js
```

---

## 7. Histórico & Evolução da Tela
- **v8.284 (30/09/2026):** Criação da tela de Necessidade de Compras Protheus no Portal GSI com batimento exato contra a rotina do ERP Protheus (`necessidade-empresa-16.png`), suporte multi-empresa (14, 15, 16), coluna estendida de Fornecedor (15 dígitos), modos de filtro (Novas vs Novas e Pendentes) e exportação para Excel.
- **v8.285 (30/09/2026):** Homologação inicial e correções de sessão de usuário na aba.
- **v8.286 (30/09/2026):** Ajuste de contraste Dark Mode, centralização e compactação de cabeçalhos das colunas numéricas.
- **v8.287 (01/10/2026):** Vínculo operacional obrigatório por filial (eliminação de cofres na Metal Pleno 14) e inclusão do seletor Linha de Produtos (Cofres 001, Armários 018, Racks 017 e Todos).
- **v8.288 (01/10/2026):** Adoção da fórmula oficial `(- Ped Vendas) + (Ped Compras) + (Saldo Estoque) - (Ponto de Pedido)` com cores semânticas (vermelho para déficit, azul para excedente e neutro para equilíbrio).
- **v8.289 (01/10/2026):** Omissão compulsória de produtos com Ped Vendas e Ped Compras zerados (0 e 0) no backend (`protheus_db.js`), frontend (`compras_necessidade.js`) e exportação Excel, eliminando itens estagnados.
