# CRM-19 — Abrir o CRM ao vendedor com escopo por proprietário

Especificação executável · versão alvo **v8.321** · tamanho M (3 a 5 dias)
Fonte: `docs/telas/08_bi_executivo/crm_plano_v2.md`, seções 1, 4 e 9. Levantamento feito sobre o código em 13/11/2026 (último commit `1c7a90a`, v8.320).

## 0. Objetivo e limites

Ao fim do CRM-19, um vendedor com a permissão `crm` entra em `/crm` e vê, cria e edita **só as próprias oportunidades e atividades**. Admin, diretoria e `alexandre` continuam vendo tudo. Cada vendedor tem meta mensal e uma barra de meta no funil.

**Fora do escopo** (não implementar aqui):
- transferência e herança de histórico (CRM-24), mas o escopo já nasce preparado para ela (ver `codigosLeitura` na seção 4);
- aviso "CNPJ já possui oportunidade aberta" (CRM-24);
- trava de deal ganho com pedido no Protheus (CRM-26);
- remoção do `DEFAULT_VENDOR_CODES` do login em `server.js`. O login continua como está; o CRM passa a usar `crm_vendedores`. A remoção vem depois, numa entrega própria, para não mexer no login junto com o RBAC.

**Regra de ouro:** o escopo é aplicado **no servidor**, dentro do `crm_engine.js`, no Postgres e no fallback de cache JSON. O front só esconde controles; nunca é a barreira.

## 1. Estado atual (o que o código faz hoje)

| Onde | O que acontece | Problema |
| --- | --- | --- |
| `crm_routes.js:83-122` | `requireAdminOrAlexandre` aplicado em `router.use`; `role = vendedor` recebe 403 `FORBIDDEN_VENDOR` | Vendedor não usa o CRM |
| `crm_routes.js:790` | `/cep/:cep` repete `requireAuth, requireAdminOrAlexandre` | Redundante; sai junto |
| `crm_routes.js:602-614` | `GET /vendedores` devolve lista fixa (Figueiredo, Andrea, Juliana, Alexandre) | Lista no código |
| `crm_engine.js:1194` | `criarDeal`: sem `cod_vendedor`, cai em `'000074'` (se vendedor) ou `'000004'` | Dono inventado |
| `crm_engine.js:631-632, 650` | `created_by`/`updated_by` com `DEFAULT 'alexandre'` | Autoria falsa se o código esquecer o campo |
| `crm_engine.js:995` `listarDeals` | Filtro `codVendedor` vem só da query string | Sem escopo |
| `crm_engine.js:1131` `obterDealPorId` | Busca por ID sem dono | Qualquer um lê qualquer deal |
| `atualizarDeal`, `atualizarEstagioDeal`, `excluirDeal`, `restaurarDeal`, `listarAtividadesDeal`, `criarAtividadeDeal` | Nenhuma checa o dono | Idem |
| `public/js/crm.js:746` | Filtro envia `codVendedor = "Juliana"` (nome) | **Bug**: o servidor compara com `cod_vendedor` |
| `public/js/crm.js:1936-1937` | Modal envia `cod_vendedor: vendedor` e `nome_vendedor: vendedor`, os dois com o **nome** | **Bug**: deals criados pela tela podem estar com `cod_vendedor = 'Juliana'` no Supabase |
| `public/app.js:358-359` | Botão 💼 CRM fica dentro da aba BI, visível só para `isAdmin` | Vendedor não tem como chegar ao CRM |
| `server.js:1256` | `allowedTabs` do cadastro de usuários não lista `crm`, mas o `tabSlugRegex` aceita | A permissão `crm` já é gravável; falta aparecer na tela |
| `test_crm_module.js:195-201` | Testa que vendedor recebe 403 `FORBIDDEN_VENDOR` | Precisa ser reescrito |

## 2. Banco de dados

Novo arquivo `11_tabela_crm_vendedores.sql` (padrão dos arquivos 07 a 10) **e** o mesmo DDL dentro de `initCrmTables()` em `crm_engine.js`, como já é feito para as outras tabelas.

```sql
CREATE TABLE IF NOT EXISTS crm_vendedores (
  cod_vendedor        VARCHAR(20) PRIMARY KEY,          -- código Protheus, 6 dígitos ('000074')
  username_portal     VARCHAR(100) UNIQUE,              -- login do portal; NULL = vendedor sem acesso
  nome                VARCHAR(100) NOT NULL,
  email               VARCHAR(200),
  telefone_whatsapp   VARCHAR(20),                      -- E.164 sem '+', ex. 5511999998888
  assinatura          TEXT,                             -- rodapé de e-mail/proposta (usado no CRM-20)
  meta_mensal         NUMERIC(15,2) NOT NULL DEFAULT 0,
  herda_historico_de  VARCHAR(20)[] NOT NULL DEFAULT '{}', -- usado no CRM-24
  ativo               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by          VARCHAR(100)
);

INSERT INTO crm_vendedores (cod_vendedor, username_portal, nome, meta_mensal) VALUES
  ('000004', 'figueiredo', 'Figueiredo', 120000),
  ('000064', 'andrea',     'Andrea',     120000),
  ('000074', 'juliana',    'Juliana',    120000),
  ('000001', 'alexandre',  'Alexandre',  0)       -- diretor: pode ser dono de deals, sem meta
ON CONFLICT (cod_vendedor) DO NOTHING;

-- Autoria nunca mais assume 'alexandre'
ALTER TABLE crm_deals      ALTER COLUMN created_by DROP DEFAULT;
ALTER TABLE crm_deals      ALTER COLUMN updated_by DROP DEFAULT;
ALTER TABLE crm_atividades ALTER COLUMN created_by DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_crm_deals_cod_vendedor ON crm_deals (cod_vendedor) WHERE ativo = TRUE;
```

No `CREATE TABLE` de `initCrmTables()`, trocar `DEFAULT 'alexandre'` por nada (mantendo `NOT NULL`). Em `mapDealRow`/`mapAtividadeRow` (`crm_engine.js:913-914, 938`), trocar o fallback `|| 'alexandre'` por `|| ''`.

### 2.1 Saneamento dos deals gravados com nome no lugar do código

**Antes** de liberar qualquer vendedor, rodar no Supabase e guardar o resultado:

```sql
-- Diagnóstico: quantos deals estão com nome em cod_vendedor
SELECT cod_vendedor, nome_vendedor, COUNT(*)
FROM crm_deals
WHERE cod_vendedor !~ '^[0-9]{6}$'
GROUP BY 1, 2 ORDER BY 3 DESC;
```

Correção (em transação, só depois de conferir o diagnóstico):

```sql
BEGIN;
UPDATE crm_deals d
   SET cod_vendedor = v.cod_vendedor,
       nome_vendedor = v.nome,
       updated_at = NOW(),
       updated_by = 'migracao_crm19'
  FROM crm_vendedores v
 WHERE d.cod_vendedor !~ '^[0-9]{6}$'
   AND LOWER(TRIM(d.cod_vendedor)) = LOWER(v.nome);
-- Conferir: deve retornar zero linhas
SELECT id, cod_vendedor, nome_vendedor FROM crm_deals WHERE cod_vendedor !~ '^[0-9]{6}$';
COMMIT;
```

Códigos curtos (`'74'`) também saem como não conformes no diagnóstico; corrigir com `LPAD(cod_vendedor, 6, '0')`. Aplicar a mesma normalização ao `data/crm_deals_cache.json` com um script `scripts/crm19_normalizar_vendedores.js` (lê, corrige, grava com o `safe_json_storage` já usado no projeto, imprime o antes/depois).

## 3. Cadastro de vendedores no motor

No `crm_engine.js` (ou num `crm_vendedores.js` pequeno, se ficar mais limpo):

```js
listarVendedores({ incluirInativos = false } = {})   // ordena por nome
obterVendedorPorUsername(username)                    // case-insensitive
obterVendedorPorCodigo(cod)                           // aceita '74' ou '000074'
resolverCodigoVendedor(valor)                         // aceita código OU nome; devolve '000074' ou null
salvarVendedor(dados, usuario)                        // admin; grava updated_by
```

- Cache em memória de 5 minutos, invalidado no `salvarVendedor`.
- Fallback se o Postgres cair: o `VENDEDORES_MAP` de `protheus_db.js:535`, para o CRM não parar.
- `criarDeal` e `atualizarDeal` passam a obter o nome por `obterVendedorPorCodigo` em vez de `getNomeVendedor`.

## 4. Middlewares em `crm_routes.js`

Substituir `requireAdminOrAlexandre` por três funções. Remover a função antiga.

```js
function isCrmAdmin(user) {
  const u = String(user?.username || '').toLowerCase();
  const r = String(user?.role || '').toLowerCase();
  return u === 'alexandre' || r === 'admin' || r === 'diretoria';
}

// 1) Quem entra no CRM
async function requireCrmAccess(req, res, next) {
  if (isCrmAdmin(req.user)) return next();
  const perms = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
  if (String(req.user?.role).toLowerCase() === 'vendedor' && perms.includes('crm')) {
    const v = await crmEngine.obterVendedorPorUsername(req.user.username);
    if (v && v.ativo) { req.crmVendedor = v; return next(); }
  }
  return sendRfcError(res, { status: 403, title: 'Acesso Proibido',
    detail: 'Seu usuário não tem acesso ao CRM. Peça a liberação ao administrador.',
    code: 'FORBIDDEN_CRM' });
}

// 2) O que ele enxerga
function scopeByOwner(req, res, next) {
  if (isCrmAdmin(req.user)) {
    req.crmScope = { all: true };
  } else {
    const cod = req.crmVendedor.cod_vendedor;
    req.crmScope = {
      all: false,
      codVendedor: cod,          // dono para escrita
      codigosLeitura: [cod]      // CRM-24 acrescenta herda_historico_de aqui
    };
  }
  next();
}

// 3) Operações só de admin
function requireCrmAdmin(req, res, next) {
  if (isCrmAdmin(req.user)) return next();
  return sendRfcError(res, { status: 403, title: 'Acesso Proibido',
    detail: 'Operação restrita à administração.', code: 'FORBIDDEN_CRM_ADMIN' });
}

router.use(requireAuth);
router.use(requireCrmAccess);
router.use(scopeByOwner);
```

Notas:
- O vínculo usuário ↔ vendedor vem de `crm_vendedores.username_portal`, **não** do `vendorCode` do JWT. Assim, inativar o vendedor no CRM corta o acesso na hora, sem esperar novo login. Se o `vendorCode` do JWT divergir do `cod_vendedor` da tabela, vale a tabela; registrar um `console.warn`.
- A permissão `crm` vem do JWT, então só vale a partir do próximo login. Documentar isso na tela de usuários ("a liberação vale no próximo login").

### 4.1 Rotas: quem pode o quê

| Rota | Vendedor | Admin | Mudança |
| --- | --- | --- | --- |
| `GET /deals` | Só os dele | Tudo, com filtro `codVendedor` opcional | Passar `req.crmScope` |
| `POST /deals` | `cod_vendedor` forçado ao dele | Precisa informar vendedor válido | Passar escopo |
| `GET /deals/:id` | Só se for dono; senão **404** | Tudo | Passar escopo |
| `PUT /deals/:id` | Só se for dono; não pode trocar `cod_vendedor` | Pode trocar | Passar escopo |
| `PATCH /deals/:id/stage` | Só se for dono | Tudo | Passar escopo |
| `DELETE /deals/:id`, `POST /deals/:id/restore` | 403 | Sim | `requireCrmAdmin` |
| `GET/POST /deals/:id/activities` | Só se for dono do deal | Tudo | Passar escopo |
| `POST /deals/migrate-ids` | 403 | Sim | `requireCrmAdmin` |
| `POST /produtos/sync`, `POST /transportadoras/sync` | 403 | Sim | `requireCrmAdmin` |
| `GET .../autocomplete`, `GET .../status`, `GET /cep/:cep`, `GET /clientes/raiz-cnpj/:cnpj` | Sim | Sim | Remover o `requireAdminOrAlexandre` duplicado da `/cep` |
| `GET /clientes`, `GET /clientes/:id`, `POST /clientes` | Sim (cadastro compartilhado, auditado) | Sim | Nenhuma |
| `DELETE /clientes/:id`, `POST /clientes/:id/restore` | 403 | Sim | `requireCrmAdmin` |
| `GET /vendedores` | Só ele mesmo | Lista ativa (`?inativos=1` inclui inativos) | Ler de `crm_vendedores` |
| `PUT /vendedores/:codigo` | 403 | Sim | **Nova**; edita nome, username, e-mail, WhatsApp, meta, ativo |
| `GET /me` | Sim | Sim | **Nova**; ver 4.2 |
| `GET /meta?mes=AAAA-MM` | Só a dele | Todas | **Nova**; ver seção 6 |

### 4.2 `GET /api/bi/crm/me`

```json
{
  "success": true,
  "data": {
    "username": "juliana",
    "role": "vendedor",
    "escopoTotal": false,
    "vendedor": { "codigo": "000074", "nome": "Juliana" },
    "podeExcluir": false,
    "podeFiltrarVendedor": false
  }
}
```

O front usa só esta resposta para decidir o que mostrar. Nada de regra de papel espalhada no `crm.js`.

## 5. Mudanças no `crm_engine.js`

Todas as funções de deal e atividade recebem `scope` como **último** parâmetro. Sem `scope` (chamadas internas, jobs, testes antigos), assumem `{ all: true }`, para não quebrar quem já chama.

```js
function dealVisivel(deal, scope) {
  if (!deal) return false;
  if (!scope || scope.all) return true;
  return (scope.codigosLeitura || [scope.codVendedor]).includes(deal.cod_vendedor);
}
function dealEditavel(deal, scope) {
  if (!scope || scope.all) return true;
  return deal.cod_vendedor === scope.codVendedor;
}
```

| Função | Mudança |
| --- | --- |
| `listarDeals(filtros, scope)` | Se `!scope.all`: ignorar `filtros.codVendedor` e aplicar `AND cod_vendedor = ANY($n)` com `codigosLeitura`. Mesmo filtro no fallback de cache. A busca (`busca`) continua igual, mas agora roda dentro do escopo, o que fecha o vazamento pela busca global. Restringir a query de `activityStats` aos IDs retornados (`WHERE deal_id = ANY($1)`) |
| `obterDealPorId(id, scope)` | Buscar como hoje; se `!dealVisivel` → retornar `null` (vira 404). Registrar `CRM_DEAL_ACESSO_NEGADO` com `deal_id`, `username` e o `cod_vendedor` do dono |
| `criarDeal(dados, usuario, scope)` | Se `!scope.all`: `cod_vendedor = scope.codVendedor`, ignorando o que vier no corpo. Se admin: `resolverCodigoVendedor(dados.cod_vendedor)`; se `null`, erro 400 `VENDEDOR_INVALIDO`. Remover o fallback `'000074'`/`'000004'` da linha 1194. `nome_vendedor` sempre da tabela |
| `atualizarDeal(id, dados, usuario, scope)` | `obterDealPorId(id, scope)`; se não for `dealEditavel` → 404. Se `!scope.all`, descartar `cod_vendedor` e `nome_vendedor` do corpo |
| `atualizarEstagioDeal(..., scope)` | Mesma checagem de `dealEditavel` |
| `listarAtividadesDeal(dealId, scope)`, `criarAtividadeDeal(dealId, dados, usuario, scope)` | Checar o deal com `obterDealPorId(dealId, scope)` antes; se `null` → 404 |
| `excluirDeal`, `restaurarDeal` | Sem mudança de lógica; a rota já exige admin |

Auditoria: manter os nomes de evento que já existem (`CRM_CRIAR_DEAL`, `CRM_ATUALIZAR_DEAL`, `CRM_MUDAR_ESTAGIO` etc.), porque já há histórico gravado com eles, e acrescentar `cod_vendedor` e `role` no `metadata` de cada um. Evento novo: `CRM_DEAL_ACESSO_NEGADO`. Evento novo: `CRM_VENDEDOR_EDITADO` no `salvarVendedor`, com o antes e o depois.

Atenção ao `normalizeUser` (`crm_engine.js:554`): quando recebe string, deduz `role` pelo nome. Não usar esse caminho em nenhuma decisão de escopo; o escopo vem sempre de `req.crmScope`.

## 6. Meta mensal

`GET /api/bi/crm/meta?mes=2026-11` (padrão: mês corrente no fuso `America/Sao_Paulo`):

```sql
SELECT v.cod_vendedor, v.nome, v.meta_mensal,
       COALESCE(SUM(d.valor_total), 0) AS realizado,
       COUNT(d.id) AS qtd_ganhos
  FROM crm_vendedores v
  LEFT JOIN crm_deals d
    ON d.cod_vendedor = v.cod_vendedor
   AND d.ativo = TRUE
   AND d.estagio = 'ganho'
   AND d.data_fechamento_real >= $1   -- 1º dia do mês, 00:00 -03
   AND d.data_fechamento_real <  $2   -- 1º dia do mês seguinte
 WHERE v.ativo = TRUE
   AND ($3::varchar[] IS NULL OR v.cod_vendedor = ANY($3))
 GROUP BY 1, 2, 3
 ORDER BY v.nome;
```

`$3` é `NULL` para admin e `[scope.codVendedor]` para vendedor. A resposta inclui `percentual = realizado / meta_mensal` (ou `null` quando a meta é zero).

`atualizarEstagioDeal` já grava `data_fechamento_real` ao mover para `ganho` (conferido em 13/11). Se `atualizarDeal` também puder mudar o estágio para `ganho` pelo `PUT`, garantir que grave o mesmo campo, porque a barra de meta depende dele.

**Tela:** barra fina acima do Kanban e da Listagem: "Meta de novembro: R$ 84.300 de R$ 120.000 (70%)". Vendedor vê a própria. Admin vê a soma da equipe e, ao passar o mouse ou tocar, a lista por vendedor. Cores: abaixo de 50% neutro, de 50% a 99% azul, 100% ou mais verde. Precisa caber em 390 px. Vendedor com meta zero (Alexandre) não aparece na lista por vendedor.

## 7. Front-end

**`public/js/crm.js`**
1. Na carga da página, chamar `GET /me` e guardar em `crmMe`. Se der 403 `FORBIDDEN_CRM`, mostrar "Seu usuário não tem acesso ao CRM" com botão para voltar ao portal.
2. `loadVendedores` (linha ~670): `<option value="000074">Juliana</option>`, ou seja, **valor = código e texto = nome**, nos quatro selects. Isso corrige o bug do filtro.
3. `loadDeals` (linha ~746): enviar `codVendedor` só se `crmMe.podeFiltrarVendedor`.
4. Montagem do payload do modal (linha ~1936): `cod_vendedor` = valor do select (código) e `nome_vendedor` = texto da opção. Remover os campos duplicados `vendedor`/`nome_vendedor` com o mesmo nome, se nada mais os ler (conferir com `grep`).
5. Pré-seleção do vendedor no modal (linha ~1423): usar `crmMe.vendedor.codigo` em vez de comparar com o `username`; remover o fallback `'Alexandre'`.
6. Se `!crmMe.escopoTotal`: esconder `#crmFilterVendedor`; deixar `#crmSelectVendedor` desabilitado com o próprio nome; esconder os botões de excluir e restaurar oportunidade e cliente.
7. Resposta 404 ao abrir um deal: toast "Oportunidade não encontrada" e fechar o modal.
8. Barra de meta (seção 6).

**`public/crm.html` e `public/index.html`:** os mesmos IDs; conferir se a sub-aba `#tab-bi-crm` do `index.html` usa o mesmo `crm.js`. Se usar, as mudanças valem para os dois.

**`public/app.js`:**
- Criar uma entrada para o vendedor chegar ao CRM: botão de topo "💼 CRM" que abre `/crm` em nova aba, visível quando `isAdmin || perms.includes('crm')`. A sub-aba dentro de BI continua só para admin.
- Na tela de cadastro de usuários, incluir a caixa "CRM" na lista de permissões, com a observação "vale a partir do próximo login".

**`server.js:1256`:** acrescentar `'crm'` em `allowedTabs` (hoje passa pelo `tabSlugRegex`, mas a lista explícita documenta a permissão).

**Tela de vendedores (admin):** no `/crm`, um botão "⚙️ Vendedores", visível só para admin, abre um modal com a tabela de `crm_vendedores` (código, nome, usuário do portal, e-mail, WhatsApp, meta mensal, ativo) e grava com `PUT /vendedores/:codigo`. Sem criação nem exclusão nesta entrega: novos vendedores entram por SQL, e inativar substitui excluir.

## 8. Testes

**Novo `test_crm_rbac_vendedor.js`** (no padrão do `test_crm_module.js`, com `generateToken` e `makeRequest`), incluído no `npm test`. Base: dois deals da Juliana (`000074`), um da Andrea (`000064`).

| # | Cenário | Esperado |
| --- | --- | --- |
| 1 | Vendedor sem permissão `crm` em `GET /deals` | 403 `FORBIDDEN_CRM` |
| 2 | Vendedor com `crm`, mas inativo em `crm_vendedores` | 403 `FORBIDDEN_CRM` |
| 3 | Juliana em `GET /deals` | Só os 2 dela |
| 4 | Juliana em `GET /deals?codVendedor=000064` | Ainda só os 2 dela (filtro ignorado) |
| 5 | Juliana em `GET /deals?busca=<título do deal da Andrea>` | Lista vazia |
| 6 | Juliana em `GET /deals/<id da Andrea>` | **404** `DEAL_NOT_FOUND` e evento `CRM_DEAL_ACESSO_NEGADO` |
| 7 | Juliana em `PUT`, `PATCH /stage`, `GET` e `POST /activities` no deal da Andrea | 404 em todos |
| 8 | Juliana em `POST /deals` com `cod_vendedor: '000064'` | 201, gravado com `000074`, `created_by = 'juliana'` |
| 9 | Juliana em `PUT` no próprio deal tentando `cod_vendedor: '000064'` | 200, dono continua `000074` |
| 10 | Juliana em `DELETE /deals/:id`, `POST /restore`, `POST /produtos/sync`, `POST /deals/migrate-ids`, `DELETE /clientes/:id` | 403 `FORBIDDEN_CRM_ADMIN` |
| 11 | Juliana em `GET /clientes`, autocomplete de clientes e produtos | 200 (cadastro compartilhado) |
| 12 | Admin em `GET /deals` | Os 3 |
| 13 | Admin em `GET /deals?codVendedor=000064` | Só o da Andrea |
| 14 | Admin em `POST /deals` sem vendedor válido | 400 `VENDEDOR_INVALIDO` |
| 15 | Admin em `POST /deals` com `cod_vendedor: 'Juliana'` (nome) | 201, gravado com `000074` |
| 16 | `GET /me` como Juliana e como admin | Campos da seção 4.2 corretos |
| 17 | `GET /meta` como Juliana | Uma linha, só a dela |
| 18 | Os cenários 3, 6 e 8 com o Postgres desligado (fallback JSON) | Mesmo resultado |

**Ajustar `test_crm_module.js`:** o teste das linhas 195-201 passa a esperar 403 `FORBIDDEN_CRM` para vendedor **sem** a permissão `crm`; o de `GET /vendedores` (linha ~243) passa a ler da tabela.

**Rodar** `npm test` completo; nenhum dos 30 arquivos atuais pode quebrar.

## 9. Ordem de execução e liberação

1. Alterações locais pendentes (remoção da chave do Protheus do código, de 11/11) vão num PR próprio, separado do CRM-19, conduzido pelo Claude. O `data/bi_os_cache.json` é cache de execução e não entra em nenhum commit. O diff grande do `server.js` era só quebra de linha (CRLF/LF).
2. Rodar o diagnóstico da seção 2.1 no Supabase e mandar o resultado ao Alexandre.
3. Implementar backend (seções 2 a 6) com os testes da seção 8.
4. Implementar front (seção 7).
5. Deploy **sem** dar a permissão `crm` a ninguém. Para admin, nada muda; conferir que o CRM dele continua igual.
6. Rodar a correção da seção 2.1.
7. Dar a permissão `crm` à Juliana, pedir que ela faça login de novo e validar em produção: vê só os dela, cria, edita, move estágio, a meta aparece.
8. Liberar Andrea e Figueiredo.

**Reverter:** retirar a permissão `crm` dos vendedores. O escopo continua ativo e o admin não é afetado, então não precisa reverter o deploy.

## 10. Pronto quando

- [ ] `requireAdminOrAlexandre` não existe mais em `crm_routes.js`.
- [ ] Nenhuma ocorrência de `'000074'`, `'000004'` ou `DEFAULT 'alexandre'` em `crm_engine.js`.
- [ ] Nenhum deal em `crm_deals` com `cod_vendedor` fora do formato de 6 dígitos.
- [ ] Os 18 cenários do `test_crm_rbac_vendedor.js` passam, e o `npm test` inteiro também.
- [ ] Juliana validou em produção.
- [ ] `TODO.md` com a linha `[CRM-19]`, changelog no `crm_comercial.md`, versão v8.321.

## 11. Decisões do Alexandre (13/11/2026)

| Questão | Decisão |
| --- | --- |
| Usernames do portal | `juliana`, `andrea`, `figueiredo` (confirmado) |
| Alexandre (`000001`) nos filtros e como dono de deals | Sim, como hoje |
| Diretoria | Alexandre é o diretor e vê tudo (`isCrmAdmin`) |
| Meta mensal | R$ 120.000 por vendedor (Figueiredo, Andrea, Juliana). Alexandre sem meta. Na visão do admin, a meta da equipe é a soma: R$ 360.000 |
