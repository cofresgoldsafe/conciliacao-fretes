# Instrução — Análise de Ponto de Pedido (Protheus / Gold Safe)

> Documento operacional para IA. Descreve, passo a passo, como produzir um estudo de ponto de pedido de um produto a partir dos dados vivos do Protheus. Seguir na ordem. Não pular etapa, não estimar número que dá para consultar.

---

## 0. Quando usar

Acionar quando o pedido for do tipo:

- "faz um estudo de ponto de pedido do produto X"
- "esse produto precisa de reposição?"
- "qual o PP adequado para o código Y"
- "revisar o B1_EMIN do produto Z"
- qualquer link de produto do Pipedrive (`benetroncomercial.pipedrive.com/product/{id}`) acompanhado de pergunta sobre estoque/reposição

**Leitura obrigatória antes:** o doc de referência [SD2 e SD3 — Kardex Diário e Saídas por NF](https://www.notion.so/343f832a702d81899084c96c3a1960a4). Ele define as tabelas, a fórmula oficial e as regras de empresa.

---

## 1. Resolver o código do produto — antes de qualquer query

O estudo inteiro depende de acertar o código. Errar aqui produz um relatório coerente e completamente falso.

| Entrada do usuário | O que fazer |
|---|---|
| Código já no formato `00101010102B009` | usar direto |
| Código com prefixo de empresa `15-01801080802B001` | usar **só o que vem depois do hífen** |
| Link/ID de produto do Pipedrive (ex.: `product/11569`) | buscar na SB1090 por `B1_XCODPD = '11569'` |
| Só o nome do produto | buscar por `B1_DESC LIKE '%...%'` e **confirmar com o usuário** antes de seguir |

```sql
SELECT B1_COD, B1_DESC, B1_XCODPD, B1_MSBLQL
FROM SB1090
WHERE D_E_L_E_T_ = ' ' AND B1_FILIAL = '01'
  AND (B1_COD = '<CODIGO>' OR B1_XCODPD = '<ID_PIPEDRIVE>')
```

> ⚠️ **Armadilha real:** existem pares de códigos com descrição quase idêntica — `00101010101B060` (COFRE ELETRONICO BOX 2.0 16X30X20) e `00101010102B009` (…BOX 2.0 16X30X20 **BLACK**) são produtos diferentes, com PP e histórico diferentes. Sempre imprimir a `B1_DESC` retornada e conferir contra o que o usuário pediu.

---

## 2. Conexão

Gateway Railway, chave lida em runtime — **nunca fixada no código**:

```powershell
$c   = Get-Content "$env:APPDATA\Claude\claude_desktop_config.json" -Raw | ConvertFrom-Json
$key = $c.mcpServers.'protheus-cloud'.env.PROTHEUS_API_KEY
$h   = @{ "Content-Type"="application/json"; "X-API-Key"=$key }
function Q($sql){ $b = @{ query = $sql } | ConvertTo-Json
  (Invoke-RestMethod -Uri "https://protheus-api-production.up.railway.app/query" -Method POST -Headers $h -Body $b).rows }
```

Regras fixas:

- o corpo usa o campo **`query`**, não `sql` (`sql` retorna HTTP 422)
- **toda** query leva `D_E_L_E_T_ = ' '`
- tabelas de movimento têm sufixo de empresa: `SD2140`, `SD2150`, `SD2160`
- **produtos vivem só na empresa 09** (`SB1090`, `B1_FILIAL = '01'`)
- rodar do desktop (Windows-MCP / PowerShell). Artifacts do claude.ai são bloqueados por CORS.

Se as ferramentas não estiverem disponíveis, **dizer isso na primeira frase** e oferecer alternativa. Nunca preencher número faltante com estimativa.

---

## 3. Coleta — as seis consultas obrigatórias

Rodar todas. Cada uma responde a uma parte do estudo; omitir qualquer uma produz recomendação sem lastro.

### 3.1 Cadastro (SB1090)

```sql
SELECT B1_COD, B1_DESC, B1_TIPO, B1_UM, B1_EMIN, B1_VLUNIT, B1_PRV1,
       B1_PE, B1_LE, B1_EMAX, B1_ESTSEG, B1_GRUPO, B1_XCODPD, B1_MSBLQL
FROM SB1090
WHERE D_E_L_E_T_ = ' ' AND B1_FILIAL = '01' AND B1_COD = '<COD>'
```

- `B1_EMIN` = ponto de pedido atual. **`0` significa que o produto não tem ponto de pedido nenhum** — é achado relevante, não é "PP igual a zero".
- `B1_PE` (lead time) e `B1_LE` (lote econômico) zerados ⇒ reportar, porque sem eles nenhum MRP do Protheus gera sugestão com lastro.
- `B1_MSBLQL = 1` ⇒ produto bloqueado; parar e avisar.

### 3.2 Vendas mês a mês, 24 meses, 3 empresas (SD2)

```sql
SELECT EMPRESA, LEFT(DT,6) AS MES, SUM(QTD) AS QTD, COUNT(*) AS LINHAS, SUM(TOT) AS VALOR
FROM (
  SELECT '14' AS EMPRESA, D2_EMISSAO AS DT, D2_QUANT AS QTD, D2_TOTAL AS TOT
    FROM SD2140 WHERE D_E_L_E_T_=' ' AND D2_COD='<COD>' AND D2_EMISSAO >= '<AAAAMM01 -24m>'
  UNION ALL
  SELECT '15', D2_EMISSAO, D2_QUANT, D2_TOTAL
    FROM SD2150 WHERE D_E_L_E_T_=' ' AND D2_COD='<COD>' AND D2_EMISSAO >= '<AAAAMM01 -24m>'
  UNION ALL
  SELECT '16', D2_EMISSAO, D2_QUANT, D2_TOTAL
    FROM SD2160 WHERE D_E_L_E_T_=' ' AND D2_COD='<COD>' AND D2_EMISSAO >= '<AAAAMM01 -24m>'
) X
GROUP BY EMPRESA, LEFT(DT,6)
ORDER BY MES, EMPRESA
```

> **SD2, nunca SD3.** SD2 são itens de NF de saída (venda faturada). SD3 são movimentos internos e dão número errado.

> **Sempre as 3 empresas com `UNION ALL`.** A operação de um produto migra de empresa ao longo do tempo (caso real: empresa 15 até 03/2026, empresa 16 daí em diante). Consultar uma empresa isolada corta o histórico pela metade sem nenhum erro visível.

### 3.3 Totais das duas janelas de 12 meses

Janela atual `[hoje-12m, hoje]` e janela anterior `[hoje-24m, hoje-12m-1d]`, para medir crescimento:

```sql
SELECT EMPRESA, SUM(QTD) AS QTD, COUNT(*) AS LINHAS, SUM(TOT) AS VALOR
FROM ( ...mesmo UNION ALL, com D2_EMISSAO BETWEEN '<ini>' AND '<fim>' ... ) X
GROUP BY EMPRESA
```

### 3.4 Sanidade: tipo e CFOP das saídas (excluir devolução)

```sql
SELECT D2_TP AS TP, D2_CF AS CF, SUM(D2_QUANT) AS QTD, COUNT(*) AS N
FROM ( ...UNION ALL das 3 empresas na janela 12M... ) X
GROUP BY TP, CF ORDER BY QTD DESC
```

CFOPs 5102/6102/6108 (venda), 5922/6922 (entrega futura) contam como demanda. Qualquer CFOP de entrada/devolução no resultado ⇒ investigar antes de somar. Contar também **clientes distintos** (`D2_CLIENTE + D2_LOJA`): demanda pulverizada e demanda concentrada em um cliente pedem recomendações diferentes.

### 3.5 Estoque atual (SB2) — todas as empresas e armazéns

```sql
SELECT B2_FILIAL, B2_LOCAL, B2_QATU, B2_QEMP
FROM SB2<EMP> WHERE D_E_L_E_T_=' ' AND B2_COD='<COD>'
```

Varrer os sufixos `140, 150, 160, 090` no mínimo — e todos os 13 se o produto tiver histórico atípico. **Ausência de registro na SB2 = 0, não = "não consultado".** Só afirmar "estoque zero" depois de varrer todos.

### 3.6 Pedidos em aberto (SC6) e entradas (SD3)

Carteira não atendida — é o que transforma "PP baixo" em "ruptura acontecendo agora":

```sql
SELECT C6_NUM, C6_ENTREG, C6_QTDVEN, C6_QTDENT
FROM SC6<EMP>
WHERE D_E_L_E_T_=' ' AND C6_PRODUTO='<COD>'
  AND C6_QTDVEN > C6_QTDENT AND C6_BLQ <> 'R'
```

Entradas, para inferir o lead time e o tamanho de lote realmente praticado:

```sql
SELECT EMP, DT, TM, SUM(QTD) AS QTD
FROM ( SELECT '14' AS EMP, D3_EMISSAO AS DT, D3_TM AS TM, D3_QUANT AS QTD
         FROM SD3140 WHERE D_E_L_E_T_=' ' AND D3_COD='<COD>' AND D3_TM < '500' AND D3_EMISSAO >= '<-24m>'
       UNION ALL ... 15 ... UNION ALL ... 16 ... ) X
GROUP BY EMP, DT, TM ORDER BY DT
```

(`D3_TM` é **character**: usar `< '500'` para entradas, `>= '500'` para saídas.)

---

## 4. Montar a série mensal — o passo que mais gera erro

A query do 3.2 **não retorna linha para mês sem venda**. Preencher os meses ausentes com **0** antes de calcular qualquer estatística.

> Um mês zerado omitido derruba o desvio-padrão e produz um ponto de pedido otimista demais. No caso real do BOX 2.0 BLACK, dez/2025 teve 0 venda: incluí-lo levou o CV de ~38% para 49,7% e o PP de 6 para 8.

Depois de completar a série, calcular:

| Métrica | Como |
|---|---|
| Vendas 12M | soma da janela móvel `[hoje-12m, hoje]` |
| Média mensal | 12M ÷ 12 |
| Média diária | 12M ÷ 365 |
| Desvio-padrão | amostral (÷ n−1) sobre os 12 valores mensais |
| CV | desvio ÷ média |
| Tendência | média dos 6 primeiros meses vs. 6 últimos |
| Run rate recente | média dos últimos 3–4 meses |
| Crescimento anual | 12M atual vs. 12M anterior |

Se a primeira venda do produto for há menos de 24 meses, **dizer explicitamente que o histórico é curto** e que a comparação anual é parcial.

---

## 5. Calcular o ponto de pedido — três cenários, sempre os três

**Lead time:** usar `B1_PE` se preenchido; se for 0, usar **30 dias** (padrão de produção do doc de referência) e **registrar que o lead time não está cadastrado**. Conferir contra o intervalo real entre entradas do 3.6.

### Cenário 1 — fórmula oficial do doc
```
PP = CEILING( (Vendas12M ÷ 365) × LeadTimeDias )
```
Cobre a média e nada mais. Sempre mostrar, porque é a fórmula institucional — e sempre explicar o que ela não cobre.

### Cenário 2 — média 12M + estoque de segurança
```
Demanda no lead time = média_mensal × (LT ÷ 30)
Desvio no lead time  = desvio_mensal × √(LT ÷ 30)
PP = CEILING( demanda_LT + z × desvio_LT )
```
Tabelar z = 1,28 (90%), 1,65 (95%), 2,05 (98%).

### Cenário 3 — run rate recente + estoque de segurança
Mesma fórmula, trocando a média 12M pelo run rate dos últimos 3–4 meses.

### Regra de decisão — qual recomendar

| Situação | Recomendar |
|---|---|
| Demanda estável (CV < 25%) e sem tendência | Cenário 2 a 95% |
| Tendência de alta consistente (> 15% entre semestres) | **Cenário 3 a 95%** |
| Tendência de queda consistente | Cenário 2 a 90%, e sugerir revisão em 3 meses |
| Produto de ticket alto / ruptura cara | subir para 98% |
| CV > 60% ou < 12 meses de histórico | recomendar com ressalva explícita e prazo de reavaliação |

Sugerir também o **lote de reposição** (≈ 2 meses de demanda), ancorado no tamanho de lote que já vem sendo praticado nas entradas do 3.6.

---

## 6. Verificar antes de escrever — checklist

- [ ] A `B1_DESC` retornada bate com o produto que o usuário pediu?
- [ ] Os totais por empresa somam o total consolidado?
- [ ] A série mensal tem 12 valores, com os meses zerados incluídos?
- [ ] Soma da série mensal = total da janela 12M?
- [ ] Nenhum CFOP de devolução entrou na conta?
- [ ] O estoque foi varrido em todas as empresas antes de afirmar o saldo?
- [ ] Existe pedido em aberto sem cobertura de estoque?
- [ ] Todo número do relatório veio de query — nenhum foi estimado?

Se qualquer item falhar, corrigir antes de escrever. Um estudo com número inventado é pior do que nenhum estudo.

---

## 7. Estrutura do entregável

Documento markdown, salvo no projeto via `project_write` em `claude/ponto-de-pedido-<slug-do-produto>.md`, e entregue também no chat.

```
# Ponto de Pedido — <DESCRIÇÃO>

Código Protheus · Código Pipedrive · Data do cálculo · Fonte

## Resposta
Tabela-resumo: vendas 12M, média mensal, média diária, run rate recente,
lead time, PP fórmula oficial, PP recomendado, PP cadastrado hoje,
estoque atual, pedidos em aberto.

## Dados de venda — SD2, últimos 12 meses
Tabela por empresa · tabela mês a mês · estatística (média, desvio, CV)
· tendência · crescimento anual · qualidade da demanda (clientes distintos,
devoluções) · histórico completo (primeira venda).

## Cálculo
Os três cenários, com as contas visíveis.

## Recomendação
Valor de B1_EMIN a cadastrar + lote sugerido + justificativa numerada.
### ⚠️ Ação imediata  (só se houver ruptura ou risco no lead time)

## Dados de cadastro (SB1090)
Tabela de campos, apontando os que estão zerados e precisam ser preenchidos.

## Histórico de entradas (SD3)
Tabela de datas/lotes + leitura do padrão de reposição.

## Nota técnica
Como foi consultado, e qualquer confusão de código evitada.
```

Regras de redação:

- **Números com fonte.** Cada número do resumo aparece também no corpo, com a query que o produziu identificável.
- **Separar o que é fato do que é premissa.** Lead time de 30 dias é premissa quando `B1_PE = 0` — dizer isso.
- **A ação imediata vem antes do detalhamento** quando há ruptura. Enterrar "estoque zero e 7 pedidos atrasados" no meio do relatório é falha de comunicação.
- **Justificar em dinheiro.** Custo do capital imobilizado no PP (`B1_VLUNIT × PP`) vs. lucro bruto perdido por unidade não vendida (`preço médio realizado − B1_VLUNIT`). É o argumento que decide.
- Português do Brasil, R$ com vírgula decimal.

---

## 8. Armadilhas confirmadas em campo

| Sintoma | Causa | Correção |
|---|---|---|
| Volume de vendas muito diferente do esperado | usou SD3 no lugar de SD2 | SD2 = NF de saída |
| Histórico "some" no meio do período | consultou uma empresa só | `UNION ALL` nas 3 sempre |
| Desvio-padrão baixo demais, PP otimista | meses sem venda omitidos da série | preencher com 0 |
| HTTP 422 no gateway | corpo com `{"sql": ...}` | usar `{"query": ...}` |
| Produto não encontrado na SB1 | buscou na empresa da venda | produtos só na `SB1090`, `B1_FILIAL='01'` |
| Produto 404 pelo Pipedrive | usou o código com prefixo `15-` ou o `name` | usar só o trecho após o hífen |
| "Estoque zero" errado | varreu só uma SB2 | varrer 140/150/160/090 |
| Contagem de linhas alta demais | faltou soft delete | `D_E_L_E_T_ = ' '` |
| Confundiu dois produtos parecidos | descrições quase idênticas | conferir `B1_COD` **e** `B1_DESC` |
| `Invalid column name 'D3_DATA'` | campo não existe | `D3_EMISSAO` |
| Entradas contadas como saídas na SD3 | sem filtro de TM | `D3_TM >= '500'` para saída (campo character) |
