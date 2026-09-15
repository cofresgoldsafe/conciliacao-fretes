# Ponto de Pedido — COFRE ELETRONICO BOX 2.0 16X30X20 (AXLXP) BLACK

**Código Protheus:** `00101010102B009`
**Código Pipedrive:** `11569` (`B1_XCODPD`)
**Data do cálculo:** 10/09/2026
**Fonte:** SD2 (NF de saída) empresas 14/15/16 + SB1090 + SB2 + SC6 — via Railway API `/query` (dados ao vivo)

---

## Resposta

| Métrica | Valor |
|---|---|
| Vendas 12 meses (10/09/2025 – 10/09/2026) | **45 un** |
| Média mensal | 3,75 un/mês |
| Média diária | 0,123 un/dia |
| Run rate recente (mai–ago/26) | 4,75 un/mês |
| Lead time de reposição | ~30 dias (não cadastrado — `B1_PE = 0`) |
| **PP pela fórmula oficial do doc** | **4 un** |
| **PP recomendado (run rate recente + ES 95%)** | **8 un** |
| PP cadastrado hoje (`B1_EMIN`) | **0 — não existe ponto de pedido** |
| **Estoque atual (SB2, todas as empresas/armazéns)** | **0 un — RUPTURA** |
| Pedidos de venda em aberto não atendidos | **7 un** (entregas 11/09 a 03/10/2026) |

---

## Dados de venda — SD2, últimos 12 meses

Por empresa (10/09/2025 – 10/09/2026):

| Empresa | Qtde | Linhas de NF | Valor |
|---|---:|---:|---:|
| 14 | 0 | 0 | — |
| 15 | 21 | 20 | R$ 17.121,68 |
| 16 | 24 | 21 | R$ 20.970,24 |
| **TOTAL** | **45** | **41** | **R$ 38.091,92** |

> A operação migrou da empresa 15 para a 16 em **março/2026** — até 03/2026 as saídas são da 15, de 03/2026 em diante da 16. Por isso a análise só faz sentido consolidada.

Mês a mês:

| Mês | Qtde | | Mês | Qtde |
|---|---:|---|---|---:|
| 09/2025 | 6 | | 03/2026 | 4 |
| 10/2025 | 4 | | 04/2026 | 2 |
| 11/2025 | 6 | | 05/2026 | 4 |
| 12/2025 | **0** | | 06/2026 | 5 |
| 01/2026 | 2 | | 07/2026 | 5 |
| 02/2026 | 2 | | 08/2026 | 5 |
| | | | 09/2026 (até dia 10) | **0** |

**Estatística (12 meses set/25–ago/26):** média 3,75 un/mês · desvio-padrão 1,87 un · CV 49,7%

**Tendência:** set/25–fev/26 = 3,33 un/mês → mar–ago/26 = 4,17 un/mês (**+25%**); últimos 4 meses = **4,75 un/mês** e muito estável (4-5-5-5).

**Crescimento anual:** 12M anteriores (set/24–set/25) = **28 un** → 12M atuais = **45 un** → **+61%**

**Qualidade da demanda:** 30 clientes distintos em 41 linhas de NF — demanda pulverizada, sem dependência de cliente único. CFOPs 5102/6102/6108 (venda) + 1 un em 5922 (entrega futura); **nenhuma devolução** no período.

**Histórico completo:** primeira venda em 10/02/2025, 73 un vendidas desde então. Produto novo — só existe 19 meses de histórico.

---

## Cálculo

### 1. Fórmula oficial do doc de referência
```
PP = CEILING( (45 ÷ 365) × 30 ) = CEILING(3,70) = 4 un
```

### 2. Com estoque de segurança sobre a média 12M
```
Demanda no lead time (30 dias) = 3,75 un
Desvio no lead time            = 1,87 un
PP = 3,75 + (z × 1,87)
```

| Nível de serviço | z | Estoque de segurança | **PP** |
|---|---:|---:|---:|
| 90% | 1,28 | 2,4 un | **7 un** |
| 95% | 1,65 | 3,1 un | **7 un** |
| 98% | 2,05 | 3,8 un | **8 un** |

### 3. Com run rate recente + estoque de segurança (recomendado)
A média de 12 meses subestima a demanda atual: o produto cresceu 61% no ano e vem rodando 4,75 un/mês nos últimos 4 meses.

```
PP = 4,75 + (1,65 × 1,87) = 7,83  →  8 un
```

---

## Recomendação

**Cadastrar `B1_EMIN` = 8 unidades** (hoje está em 0 — o produto não tem ponto de pedido nenhum).

**Lote de reposição sugerido: 10 un** (≈ 2 meses de demanda), coerente com o padrão de entradas já praticado (lotes de 5, 7, 10 e 20 un, com reposição a cada 1–2 meses).

Justificativa:

1. **O produto está fora do controle de reposição.** `B1_EMIN = 0` significa que nada dispara compra/produção automaticamente — a reposição vem acontecendo por percepção manual, e o resultado está à vista no item 3.
2. **A fórmula pura da média (4 un) cobre exatamente 1 mês de venda média e zero variação.** Com CV de 49,7% e lead time de 30 dias, ela deixaria o produto em ruptura em metade dos meses.
3. **A demanda cresceu 61% em 12 meses e continua acelerando**, com base pulverizada em 30 clientes — não é pico de um cliente só, é crescimento estrutural.
4. **O capital imobilizado é irrelevante frente ao risco.** 8 un × R$ 352,79 = **R$ 2.822** de custo. Cada unidade vendida gera R$ 494 de lucro bruto (preço médio realizado R$ 846,49 vs. custo R$ 352,79 → margem 58,3%).

### ⚠️ Ação imediata — ruptura em curso

O estoque é **0 un em todas as empresas e armazéns** (SB2 140/150/160/090). A última venda foi em **10/08/2026** e **não houve nenhuma venda em setembro** — não é queda de demanda, é falta de produto.

Há **7 pedidos de venda em aberto sem atendimento**, com entregas prometidas entre 11/09 e 03/10/2026:

| Pedido (SC6160) | Entrega | Qtde |
|---|---|---:|
| 000723 | 11/09/2026 | 1 |
| 000729 | 13/09/2026 | 1 |
| 000736 | 16/09/2026 | 1 |
| 000764 | 26/09/2026 | 1 |
| 000770 | 01/10/2026 | 1 |
| 000771 | 01/10/2026 | 1 |
| 000784 | 03/10/2026 | 1 |

A última entrada foi de **10 un em 30/07/2026** e já foi inteiramente consumida. Com lead time de ~30 dias, **as 7 unidades já estão atrasadas** e a reposição precisa ser disparada hoje — quantidade mínima sugerida: **18 un** (8 de ponto de pedido + 7 dos pedidos em aberto + ~3 de consumo durante o lead time).

---

## Dados de cadastro (SB1090)

| Campo | Valor |
|---|---|
| `B1_DESC` | COFRE ELETRONICO BOX 2.0 16X30X20 (AXLXP) BLACK |
| `B1_TIPO` | PA (produto acabado) |
| `B1_UM` | UN |
| `B1_EMIN` (ponto de pedido) | **0** |
| `B1_VLUNIT` (custo) | R$ 352,79 |
| `B1_PRV1` (preço tabela) | R$ 869,00 |
| `B1_PE` (prazo de entrega) | 0 — não cadastrado |
| `B1_LE` (lote econômico) | 0 — não cadastrado |
| `B1_ESTSEG` | 0 |
| `B1_GRUPO` | 001 |
| `B1_MSBLQL` | 2 (ativo) |

**Campos a preencher além do `B1_EMIN`:** `B1_PE` (lead time real de reposição) e `B1_LE` (lote econômico) estão zerados. Sem eles, qualquer MRP que rode no Protheus vai gerar sugestão sem lastro.

---

## Histórico de entradas (SD3, TM < 500)

| Data | Empresa | TM | Qtde |
|---|---|---|---:|
| 11/12/2024 | 15 | 102 | 10 |
| 18/03/2025 | 15 | 102 | 20 |
| 28/08/2025 | 15 | 102 | 1 |
| 17/09/2025 | 15 | 102 | 7 |
| 13/10/2025 | 15 | 102 | 20 |
| 24/03/2026 | 16 | 102 | 7 |
| 25/03/2026 | 16 | 499 | 5 |
| 05/05/2026 | 16 | 102 | 2 |
| 17/06/2026 | 16 | 499 | 1 |
| 24/06/2026 | 16 | 102 | 5 |
| 30/07/2026 | 16 | 102 | 10 |

Padrão irregular: lotes entre 1 e 20 un, com intervalos de 1 a 5 meses. É o comportamento esperado de um item sem ponto de pedido — reposição reativa, em lotes definidos caso a caso.

---

## Nota técnica

Cálculo feito via Railway API (`POST https://protheus-api-production.up.railway.app/query`), corpo `{"query": "..."}`, chave lida em runtime do `claude_desktop_config.json`. Todas as queries com `D_E_L_E_T_ = ' '`.

Confirmações desta rodada:
- O produto do Pipedrive 11569 corresponde a `00101010102B009` — **não confundir** com `00101010101B060` (COFRE ELETRONICO BOX 2.0 16X30X20, versão não-BLACK, PP cadastrado 15), que é um código distinto e aparece na lista dos 35 produtos com ponto de pedido do doc de referência.
- `SB2140` não tem registro para este produto; `SB2150`, `SB2160` e `SB2090` existem com `B2_QATU = 0`.
