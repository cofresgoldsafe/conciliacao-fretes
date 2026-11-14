# CRM-23 — Motivo de perda fechado, lead sem cliente, reabrir e clonar

Especificação executável · versão alvo **v8.323** · tamanho P (até 2 dias)
Fonte: `docs/telas/08_bi_executivo/crm_plano_v2.md` (seção 8 e roadmap da seção 9), decisões do Alexandre de 14/11/2026 (seção 9 abaixo). Levantamento sobre o código em 14/11/2026 (`main` em `6e810b4`), inventário do Antigravity conferido pelo Claude.

## 0. Objetivo e limites

Ao fim do CRM-23:
1. Marcar uma oportunidade como **Perdida** exige escolher um de **7 motivos fixos**; o motivo fica gravado como código, permitindo BI de perdas.
2. Uma oportunidade pode nascer só com **contato avulso** (nome + telefone), sem cliente. **CPF ou CNPJ só é obrigatório para marcar Ganho.**
3. Deal **perdido ou ganho** pode ser **reaberto** pelo dono ou admin, **com o mesmo número**, voltando ao estágio anterior. Isso evita pedido de venda duplicado.
4. Qualquer deal pode ser **clonado** em uma nova oportunidade (número novo) para uma nova compra.

**Fora do escopo:**
- tabela `crm_contatos` e aviso de CNPJ repetido (CRM-24);
- trava de ganho com pedido no Protheus e gravação SC5/SC6 (CRM-26);
- relatório/BI de perdas: o CRM-23 só grava o código; o painel vem depois;
- campo de concorrente: **não existe** (decisão de 14/11);
- mudança na proposta em PDF: ela continua exigindo CPF/CNPJ (`CLIENTE_INCOMPLETO`, `crm_propostas.js:680-688`).

**Regras de ouro:**
1. Regras no **servidor** (`crm_engine.js`), no Postgres **e** no fallback de cache JSON. O front só ajuda.
2. Escopo do CRM-19 em todas as rotas novas: `obterDealPorId(id, req.crmScope)` e `dealEditavel`; deal de outro vendedor → 404.
3. Reabrir **nunca** cria número novo. Clonar **sempre** cria.

## 1. Estado atual (inventário conferido)

| Onde | Hoje | Mudança |
| --- | --- | --- |
| `crm_engine.js:616` | `motivo_perda TEXT` | Continua (rótulo legível); nasce `motivo_perda_cod` |
| `crm_engine.js:1701-1808` `atualizarEstagioDeal` | Grava `motivo_perda = COALESCE($5, motivo_perda)`; não valida motivo; aceita qualquer transição; zera `data_fechamento_real` ao sair de ganho/perdido | Valida motivo ao ir para perdido; limpa motivo ao sair de perdido; exige CPF/CNPJ ao ir para ganho |
| `crm_engine.js:1508-1555, 1588` `atualizarDeal` (PUT) | Também pode mudar estágio (inclusive para ganho/perdido) e gravar `motivo_perda` | Mesmas regras de perdido e ganho |
| `crm_routes.js:386-424` PATCH `/deals/:id/stage` | Lê `novoEstagio`, `justificativa`, `motivoPerda` | Passa também `motivoPerdaCod` |
| `public/crm.html:698-706` | 7 motivos diferentes da decisão, gravados como texto | Lista nova vinda do servidor |
| `public/js/crm.js:1420-1426` | Observações da perda vão como `justificativa` (só no histórico) | Mantém |
| `crm_engine.js:1272-1274` | `criarDeal` exige `cliente_nome` | Aceita contato avulso no lugar |
| `crm_engine.js:601` | `cliente_nome VARCHAR(255) NOT NULL` | **Sem ALTER**: contato avulso grava `cliente_nome = ''` |
| `public/js/crm.js:1539-1550` `isDealFormValid` | Exige cliente | Cliente **ou** contato (nome + telefone) |
| Modal de oportunidade (`public/crm.html:324-515`) | Sem campos de contato avulso | Ganha Nome do contato e Telefone |
| Reabrir / clonar | Não existem; deals perdidos nem aparecem no Kanban (`crm.js:11-17`) | Rotas e botões novos |
| `crm_engine.js:368-426` `obterProximoIdDeal` | `nextval('crm_deals_seq')`, piso 29000; fallback no cache | Clonar usa o `criarDeal` existente |

## 2. Banco de dados

Novo arquivo `sql/bi/13_crm23_motivo_perda.sql` **e** o mesmo trecho em `initCrmTables()` (depois do `CREATE TABLE crm_deals`):

```sql
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS motivo_perda_cod VARCHAR(40);
DO $$ BEGIN
  ALTER TABLE crm_deals ADD CONSTRAINT crm_deals_motivo_perda_cod_check CHECK (
    motivo_perda_cod IS NULL OR motivo_perda_cod IN (
      'preco','prazo_entrega','produto_nao_atende','compra_cancelada',
      'sem_resposta','credito_negado','transferido_outro_vendedor'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_crm_deals_motivo_perda_cod ON crm_deals (motivo_perda_cod) WHERE estagio = 'perdido';
```

Deals perdidos antigos ficam com `motivo_perda_cod = NULL` e o texto antigo em `motivo_perda` (sem migração de texto para código). `mapDealRow` passa a devolver `motivo_perda_cod`.

## 3. Motivos de perda (fonte única)

Constante exportada em `crm_engine.js`:

```js
const MOTIVOS_PERDA = [
  { cod: 'preco',                      label: 'Preço' },
  { cod: 'prazo_entrega',              label: 'Prazo de Entrega' },
  { cod: 'produto_nao_atende',         label: 'Produto Não Atende' },
  { cod: 'compra_cancelada',           label: 'Compra Cancelada' },
  { cod: 'sem_resposta',               label: 'Sem Resposta' },
  { cod: 'credito_negado',             label: 'Crédito Negado' },
  { cod: 'transferido_outro_vendedor', label: 'Transferido para Outro Vendedor' }
];
function resolverMotivoPerda(valor) // aceita cod ou label (sem acento/caixa); devolve { cod, label } ou null
```

Exatamente estes 7, nesta ordem. **Sem "Outro" e sem campo de concorrente.**

Rota nova `GET /api/bi/crm/motivos-perda` → `{ success: true, data: MOTIVOS_PERDA }` (vendedor e admin). O front monta o select a partir dela.

## 4. Regras de estágio (servidor)

Função única `validarTransicao(existente, estagioNovo, dados)` usada por `atualizarEstagioDeal` **e** por `atualizarDeal` quando o estágio muda:

| Transição | Regra | Erro |
| --- | --- | --- |
| qualquer → `perdido` | `motivoPerdaCod` (ou `motivoPerda`) resolve em `MOTIVOS_PERDA` | 400 `MOTIVO_PERDA_OBRIGATORIO` ("Escolha o motivo da perda.") |
| qualquer → `ganho` | `cliente_nome` preenchido **e** `cliente_cnpj` com 11 (CPF) ou 14 (CNPJ) dígitos | 400 `CLIENTE_DOC_OBRIGATORIO_GANHO` ("Para marcar como ganho, informe o cliente com CPF ou CNPJ.") |
| `perdido` → outro estágio | grava `motivo_perda = NULL`, `motivo_perda_cod = NULL` (o motivo antigo fica no histórico) | — |

Ao ir para `perdido`: grava `motivo_perda_cod = cod` e `motivo_perda = label`. A justificativa do histórico fica `"Perdido: <label>"` + `" — <observações>"` quando houver.

A troca do `COALESCE($5, motivo_perda)` por atribuição direta precisa valer no Postgres **e** no cache (`crm_engine.js:1798`).

`criarDeal` com `estagio = 'ganho'` ou `'perdido'` aplica as mesmas regras.

Os erros saem por `sendRfcError` com `err.status` e `err.code` (o código chega em `json.error.code`).

## 5. Lead sem cliente (contato avulso)

`criarDeal` e `atualizarDeal`:
- Aceita `cliente_nome` vazio **se** houver contato com nome e telefone: `contatos[0].nome` e (`contatos[0].telefone` ou `cliente_telefone`).
- Sem cliente e sem contato completo → 400 `CLIENTE_OU_CONTATO_OBRIGATORIO` ("Informe o cliente ou o nome e o telefone do contato.").
- Grava `cliente_nome = ''` (a coluna é `NOT NULL`; vazio é aceito). Contato em `contatos` no formato que já existe: `{ nome, telefone }` (`test_crm_module.js:94-96`). Telefone só com dígitos.
- Nenhum estágio além de `ganho` exige cliente.

**Front:**
- Modal de oportunidade: dois campos novos, **Nome do contato** (`#crmInputContatoNome`) e **Telefone do contato** (`#crmInputContatoTelefone`), logo abaixo do cliente. Na edição, preenchidos a partir de `contatos[0]`.
- `isDealFormValid`: título, vendedor e Faturado Por como hoje; **cliente OU (nome do contato E telefone)**.
- Card do Kanban e linha da listagem: sem cliente, mostrar `👤 <nome do contato>` no lugar do nome do cliente.
- Marcar Ganho sem CPF/CNPJ: mostrar a mensagem do servidor e abrir a edição do deal.

## 6. Reabrir (mesmo número)

`POST /api/bi/crm/deals/:id/reabrir` → `reabrirDeal(id, usuario, scope)` em `crm_engine.js`:
- Deal precisa estar em `perdido` ou `ganho`; senão 409 `DEAL_NAO_FECHADO`.
- Dono ou admin (`dealEditavel`); outro vendedor → 404.
- Estágio de destino: a última entrada de `historico_estagios` com `estagio_novo` igual ao estágio atual → seu `estagio_anterior`. Se não houver, ou se ele for `ganho`/`perdido`/vazio → `negociacao` quando o deal era ganho e `lead` quando era perdido.
- Executa pelo `atualizarEstagioDeal` existente, com justificativa `"Reaberto por <username> (estava <ganho|perdido>[: <motivo>])"`. Isso já zera `data_fechamento_real` (a meta do mês deixa de contar o ganho) e limpa o motivo (seção 4).
- **O `id` não muda.** Telemetria `CRM_DEAL_REABERTO` com `deal_id`, `de`, `para`, `cod_vendedor`, `role`.
- Vendedor reabre o próprio ganho livremente (decisão de 14/11). Depois de reaberto, edita itens e condições pelo fluxo normal e marca Ganho de novo.

**Front:** botão `#btnCrmReabrirDoDetalhes` "↩️ Reabrir" no rodapé do modal de detalhes, visível só quando o deal está perdido ou ganho. Esconder "❌ Marcar como Perdido" e "🏆 Marcar como Ganho" nesse caso. Depois de reabrir: toast "Oportunidade #<id> reaberta em <estágio>", recarregar a lista.

## 7. Clonar (número novo)

`POST /api/bi/crm/deals/:id/clonar` → `clonarDeal(id, usuario, scope)`:
- Deal precisa ser visível (`obterDealPorId(id, scope)`); senão 404.
- Chama o `criarDeal` existente com, copiados do original: `titulo` + `" (cópia)"`, `cliente_cod`, `cliente_loja`, `cliente_nome`, `cliente_cnpj`, `cliente_email`, `cliente_telefone`, `cliente_cidade`, `cliente_uf`, `valor_total` (obrigatório: a tela grava `precoNegociado` e o `criarDeal` soma `preco_unitario`, então sem ele o clone nasce com R$ 0), `cond_pgto`, `tipo_frete`, `frete_cobrado`, `frete_embutido`, `transportadora`, `transportadora_cod`, `prazo_entrega`, `itens_cotados`, `contatos`, `observacoes`, `custom.faturadoPor`, `custom.transportadora_cod`.
- **Não copia:** estágio (nasce `lead`), histórico, `motivo_perda*`, `data_fechamento_*`, `num_pedido_compra`, `obs_nfe`, `custom.ultima_proposta`, propostas, atividades.
- Dono: vendedor → ele mesmo (escopo do CRM-19 já força); admin → o mesmo `cod_vendedor` do original.
- `custom.clonado_de = <id original>`; justificativa do histórico inicial `"Clonado da oportunidade #<id>"`. Telemetria `CRM_DEAL_CLONADO`.
- Resposta 201 com o deal novo.

**Front:** botão "📑 Clonar" no rodapé do modal de detalhes (sempre visível para quem edita o deal). Após clonar: abre o deal novo em edição.

## 8. Testes

**Novo `test_crm_perda_reabrir.js`**, incluído no `npm test` logo depois do `test_crm_propostas.js`. Mesmo padrão dos testes do CRM (funções reais do `crm_engine.js` e rotas reais do `crm_routes.js`; nada de cópias). Rodar com e sem `DATABASE_URL`.

| # | Cenário | Esperado |
| --- | --- | --- |
| 1 | `GET /motivos-perda` | 7 itens, exatamente os códigos da seção 3, nesta ordem |
| 2 | PATCH stage → perdido sem motivo | 400 `MOTIVO_PERDA_OBRIGATORIO`; estágio não muda |
| 3 | PATCH stage → perdido com `motivoPerda: 'Outro'` ou `'concorrente'` | 400 `MOTIVO_PERDA_OBRIGATORIO` |
| 4 | PATCH stage → perdido com `motivoPerdaCod: 'credito_negado'` e justificativa | 200; `motivo_perda_cod = 'credito_negado'`, `motivo_perda = 'Crédito Negado'`; histórico com "Perdido: Crédito Negado — …" |
| 5 | PUT do deal com `estagio: 'perdido'` sem motivo | 400 `MOTIVO_PERDA_OBRIGATORIO` |
| 6 | `criarDeal` sem cliente e sem contato | 400 `CLIENTE_OU_CONTATO_OBRIGATORIO` |
| 7 | `criarDeal` sem cliente, com contato `{ nome, telefone }` | 201; `cliente_nome = ''`; contato gravado; estágio lead |
| 8 | Deal sem cliente → proposta → negociacao | 200 nos dois |
| 9 | Deal sem cliente/CNPJ → ganho (PATCH e PUT) | 400 `CLIENTE_DOC_OBRIGATORIO_GANHO` |
| 10 | Deal com CPF (11 dígitos) → ganho | 200; `data_fechamento_real` gravado |
| 11 | Reabrir perdido que veio de negociacao | 200; mesmo `id`; estágio `negociacao`; `motivo_perda_cod` e `motivo_perda` nulos; histórico com "Reaberto por" |
| 12 | Reabrir ganho que veio de proposta | 200; mesmo `id`; estágio `proposta`; `data_fechamento_real = null`; `/meta` deixa de contar o valor |
| 13 | Reabrir deal aberto | 409 `DEAL_NAO_FECHADO` |
| 14 | Juliana reabre/clona deal da Andrea | 404 nos dois |
| 15 | Juliana reabre o próprio ganho | 200 |
| 16 | Clonar deal ganho com itens no formato da tela (`precoNegociado`) e proposta | 201; id novo ≥ 29000 e diferente; estágio lead; itens, cliente e `valor_total` iguais; sem `ultima_proposta`, sem motivo, sem histórico antigo; `custom.clonado_de` = original; original inalterado |
| 17 | Admin clona deal da Juliana | dono do clone = `000074` |
| 18 | Cenários 4, 7, 11 e 16 sem Postgres (fallback JSON) | Mesmo resultado |

**Ordem das checagens:** escopo primeiro (deal alheio → 404), depois motivo/documento (400). Assim o Cenário 8 do `test_crm_rbac_vendedor.js:215` (PERDIDO sem motivo em deal alheio) continua recebendo 404 sem alteração. Ajustar só os testes que marcam o **próprio** deal como perdido sem motivo válido, para mandar `motivoPerdaCod`. Rodar `npm test` completo; nada pode quebrar. Restaurar `data/` com `git checkout -- data/`.

## 9. Decisões do Alexandre (14/11/2026)

| Questão | Decisão |
| --- | --- |
| Motivos de perda | Só estes 7: Preço, Prazo de Entrega, Produto Não Atende, Compra Cancelada, Sem Resposta, Crédito Negado, Transferido para Outro Vendedor. **Sem "Outro".** Concorrente **nunca** é pedido |
| CPF/CNPJ obrigatório | **Só para marcar Ganho.** Antes disso, contato avulso (nome + telefone) basta |
| Reabrir perdido | Volta ao estágio anterior à perda |
| Reabrir ganho | **Liberado ao vendedor.** O pedido pode já estar no Protheus e o cliente pedir pequena alteração (quantidade, forma de pagamento); ou o ganho foi clicado por engano. Reabrir **mantém o número** da oportunidade, para não duplicar pedido de venda |
| Clonar | Para nova compra, com número novo |

Ponto em aberto para o Alexandre: a proposta em PDF continua exigindo CPF/CNPJ (decisão do CRM-20). Se quiser emitir proposta para contato sem documento, é uma mudança à parte.

## 10. Ordem de execução (fatias do Antigravity)

1. Schema: seção 2 (`initCrmTables` + `sql/bi/13`), `mapDealRow`.
2. Regras: seções 3, 4, 5 (servidor), 6 e 7 (motor e rotas), com os testes da seção 8.
3. UI: seções 5, 6 e 7 (front) + versão v8.323 (`bump_version.js`).
4. Red Team do Claude, PR, merge do Alexandre (o merge publica no Render).

## 11. Pronto quando

- [ ] `motivo_perda_cod` com CHECK nos 7 códigos; nenhum outro motivo aceito.
- [ ] Perdido sem motivo e Ganho sem CPF/CNPJ recusados no PATCH, no PUT e no `criarDeal`, com Postgres e sem.
- [ ] Lead com contato avulso criado e movido até negociação.
- [ ] Reabrir mantém o `id`; clonar cria `id` novo.
- [ ] Os 18 cenários do `test_crm_perda_reabrir.js` passam, e o `npm test` inteiro também.
- [ ] `TODO.md` com a linha `[CRM-23]`, changelog no `crm_comercial.md`, versão v8.323.
