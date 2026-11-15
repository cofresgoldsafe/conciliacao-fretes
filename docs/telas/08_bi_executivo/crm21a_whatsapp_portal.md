# CRM-21a — Integração CRM ↔ WhatsApp Multi360 (lado do portal)

Especificação executável · versão **v8.324** · tamanho M
Fonte: `docs/telas/08_bi_executivo/crm_plano_v2.md` seção 2 e roadmap da seção 9. Fatiamento decidido pelo Alexandre em 14/11/2026: **CRM-21a = portal** (este documento); **CRM-21b = Multi360** (callback com `deal`, painel lateral criar/vincular), em outro chat. Inventário do Antigravity (Flash 3.8) conferido pelo Claude sobre `main` em `7bf1488`. A seção 12 registra como ficou a implementação.

## 0. Objetivo e limites

Ao fim do CRM-21a, o portal tem tudo o que o Multi360 vai chamar no CRM-21b:
1. Tabela `crm_deal_conversas` (vínculo N:N deal ↔ conversa do WhatsApp) e coluna `crm_deals.origem_ref` (idempotência).
2. `normalizarTelefoneBR` e `variantesTelefoneBR` (`telefone_br.js`), cópia fiel de `Gemini-Whatsapp-Multi360/src/phone.ts`.
3. API **servidor-a-servidor** (sem JWT) em `/api/integracoes/whatsapp/crm`, autenticada por segredo compartilhado + usuário do portal, com o **mesmo escopo do CRM-19**: contexto por telefone, criar oportunidade, vincular conversa, listar vínculos.
4. Botão **💬 Conversar** no modal de detalhes do deal, que abre o painel WhatsApp pelo SSO existente levando `&deal=<id>` (o painel passa a usar o parâmetro no CRM-21b; até lá abre na tela inicial).

**Fora do escopo:** mudanças no Multi360 (CRM-21b); resumo diário e proposta pelo WhatsApp (CRM-22); `crm_contatos`, aviso de CNPJ de outro vendedor e telefone do Protheus `SA1010.A1_TEL` (CRM-24); fallback de cache JSON (a integração exige Postgres).

**Regras de ouro:**
1. Escopo no servidor: deal de outro vendedor → 404.
2. Segredo só em `process.env.CRM_INTEGRACAO_SECRET`; sem ele, a API responde 503 e nada mais muda.
3. Nunca inventar coluna (fontes na seção 1).

## 1. Fontes (inventário conferido)

| Item | Fonte |
| --- | --- |
| Rotas do CRM | `server.js` `app.use('/api/bi/crm', crmRoutes)`; `crm_routes.js` `requireCrmAccess`, `scopeByOwner`, `requireCrmAdmin` |
| Motor | `crm_engine.js` `listarDeals(filtros, scope)` → `{ source, total, deals }`, `obterDealPorId(id, scope)`, `criarDeal(dados, usuario, scope)`, `criarAtividadeDeal(dealId, dados, usuario, scope)` |
| Colunas de deal | `crm_deals.origem`, `custom`, `contatos`, `cliente_telefone`; `origem_ref` nasce aqui |
| Clientes | `crm_clientes.id`, `protheus_cod`, `protheus_loja`, `nome_razao`, `cnpj_cpf`, `telefone`, `celular_whatsapp`, `contato_financeiro_tel`, `updated_at`, `deleted_at` (`sql/bi/08_tabela_crm_clientes.sql`) |
| Fidelidade | `crm_engine.js` `obterFidelidadeRaiz`, tabela `crm_clientes_raiz_cnpj` |
| Usuários | tabela `users` (`postgres_db.js`): `username`, `name`, `pass`, `role`, `vendor_code`, `permissions`, `active` |
| SSO | `POST /api/auth/whatsapp-ticket`, `/redeem`; `userHasWhatsappAccess` no `server.js` |
| Multi360 | `src/phone.ts`; `contacts.phone_key` com 55; `conversations.id` UUID; `conversations.channel_id` UUID |

## 2. Banco de dados

`sql/bi/14_crm21_deal_conversas.sql` e o mesmo trecho em `initCrmTables()`:

```sql
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS origem_ref VARCHAR(120);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_deals_origem_ref ON crm_deals (origem_ref) WHERE origem_ref IS NOT NULL;
CREATE TABLE IF NOT EXISTS crm_deal_conversas (
  id BIGSERIAL PRIMARY KEY,
  deal_id VARCHAR(64) NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  conversa_id VARCHAR(64) NOT NULL,        -- conversations.id do Multi360
  telefone_e164 VARCHAR(15) NOT NULL,      -- só dígitos, com 55
  linha_whatsapp VARCHAR(64),              -- conversations.channel_id do Multi360
  principal BOOLEAN NOT NULL DEFAULT FALSE,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  vinculado_por VARCHAR(100) NOT NULL,
  vinculado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (deal_id, conversa_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_deal_conversas_tel ON crm_deal_conversas (telefone_e164) WHERE ativo;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_deal_conversas_principal ON crm_deal_conversas (deal_id) WHERE principal AND ativo;
```

RLS como em `crm_propostas` (habilitada e forçada, policy só `service_role`/`postgres`, `REVOKE` de `anon`/`authenticated`). `mapDealRow` devolve `origem_ref`. `criarDeal` grava `origem_ref` e, se o índice único recusar, lança 409 `ORIGEM_REF_DUPLICADA` em vez de cair no cache JSON.

## 3. Autenticação servidor-a-servidor (`crm_integracao_whatsapp.js`)

Montado em `server.js` como `app.use('/api/integracoes/whatsapp/crm', require('./crm_integracao_whatsapp')({ userHasWhatsappAccess }))`, sem JWT, limitador de 120 req/min. Middleware, nesta ordem:
1. `CRM_INTEGRACAO_SECRET` vazio → 503 `INTEGRACAO_DESATIVADA`.
2. `Authorization: Bearer <segredo>` com `crypto.timingSafeEqual`; errado → 401 `INTEGRACAO_NAO_AUTORIZADA` + telemetria `CRM_INTEGRACAO_NEGADA` (sem o valor).
3. `X-Portal-User` = username do portal, buscado em `getUsers()`; inexistente ou sem WhatsApp → 403 `USUARIO_SEM_ACESSO`.
4. Acesso e escopo por `resolverAcessoCrm(user)`, exportado de `crm_routes.js` e usado também pelo `requireCrmAccess` (uma regra só); erro → 403 `FORBIDDEN_CRM`.
5. Sem `getPool()` → 503 `INTEGRACAO_INDISPONIVEL`.

## 4. Rotas da integração

| Rota | O que faz |
| --- | --- |
| `GET /contexto?telefone=` | `{ telefone_e164, cliente \| null, clientes_alternativos, deals_abertos, vinculos }`. Variantes com e sem o nono dígito, com e sem 55. Ordem: vínculos ativos (`telefone_e164 = ANY(variantes)`), `crm_clientes` (3 colunas de telefone, mais recente primeiro), deals abertos **do escopo** pelo CNPJ do cliente ou pelo telefone em `contatos`/`cliente_telefone`. Vínculos filtrados pelos deals visíveis. Telefone inválido → 400 `TELEFONE_INVALIDO` |
| `POST /deals` | `{ telefone, conversa_id, nome_contato, cliente_cod?, cliente_loja?, linha_whatsapp?, origem_ref }`. `criarDeal` com título `"<nome> — dd/mm"`, estágio lead, `origem = 'whatsapp'`, contato avulso; dono pelo escopo. Grava o vínculo principal logo depois (`ON CONFLICT DO NOTHING`). `origem_ref` existente (ou corrida) → 200 `criado:false` com o mesmo deal. 201 `{ deal, link, criado:true }` |
| `POST /deals/:id/conversas` | Deal editável no escopo (senão 404). Em transação: primeiro vínculo vira principal; `principal:true` desmarca o anterior; upsert por `(deal_id, conversa_id)`. Atividade `whatsapp_vinculo` |
| `GET /deals/:id/conversas` | Vínculos ativos do deal visível, principal primeiro |

Telemetria: `CRM_WHATSAPP_DEAL_CRIADO`, `CRM_WHATSAPP_VINCULO`.

## 5. Botão Conversar (com JWT)

- Handler do `POST /api/auth/whatsapp-ticket` extraído para `whatsapp_sso.js` (`criarHandlerWhatsappTicket`), usado no `server.js` e nos testes. Aceita `{ deal }`: escopo por `resolverAcessoCrm` com o usuário do banco; fora do escopo → 404 `DEAL_NOT_FOUND`; OK → `redirectUrl` com `&deal=<id>`. Sem `deal`, igual a antes. `/redeem` não mudou.
- `GET /api/bi/crm/deals/:id/conversas` (JWT) usa `listarVinculosDeal`.
- `#btnCrmConversarDoDetalhes` "💬 Conversar" e `#crmDetalhesConversasInfo` ("💬 N conversa(s) vinculada(s)") no modal de detalhes, em `public/crm.html` e `public/index.html`; `textContent`, nunca `innerHTML`.

## 6. Testes

`test_telefone_br.js` (cenários 1 e 2) e `test_crm_whatsapp_integracao.js` (cenários 3 a 17), no `npm test` depois de `test_crm_perda_reabrir.js`. Usuários e vendedores fictícios (`999074`, `999064`), limpos no fim; sem `DATABASE_URL`, cenários de banco viram SKIP.

| # | Cenário |
| --- | --- |
| 3–4 | Sem segredo 503; segredo errado/ausente 401 |
| 5–6 | Usuário sem WhatsApp 403 `USUARIO_SEM_ACESSO`; vendedor sem `crm` 403 `FORBIDDEN_CRM` |
| 7–9 | Cliente achado pela forma sem o 9, com fidelidade; telefone desconhecido → `cliente: null`; vendedor não vê deal de outro |
| 10–13 | Criação com dono e vínculo principal; `origem_ref` em paralelo gera um deal só; 404 em deal alheio; só um principal ativo + atividade |
| 14–16 | Ticket com `deal` próprio → `&deal=`; alheio → 404; sem `deal` → igual a antes |
| 17 | Vínculo gravado com 9 achado pelo `/contexto` sem o 9 |

## 7. Liberação

- Depois do merge, criar `CRM_INTEGRACAO_SECRET` no Render (`conciliacao-fretes`). Sem ele a API fica em 503 e nada mais muda. O mesmo valor vai para o Multi360 no CRM-21b.
- Vendedores continuam sem a permissão `crm` até janeiro/2027.
- Reverter: apagar a variável desliga a integração.

## 8. Decisões (14/11/2026)

| Questão | Decisão |
| --- | --- |
| Fatiamento | Portal primeiro (CRM-21a); Multi360 no CRM-21b |
| Botão Conversar antes do CRM-21b | Entra já; o painel abre na tela inicial até o CRM-21b |
| Segredo | `CRM_INTEGRACAO_SECRET`, só no ambiente |
| Telefone no Protheus | CRM-24 |

## 12. Como ficou (diferenças em relação ao plano original)

- A função de escopo chama `resolverAcessoCrm` (devolve `{ crmUser, crmScope }`), não `resolverEscopoCrm`.
- O vínculo do `POST /deals` é gravado logo depois do `criarDeal`, não na mesma transação; a idempotência por `origem_ref` + `ON CONFLICT` cobre a repetição.
- O handler do ticket SSO saiu do `server.js` para `whatsapp_sso.js`, para ser testado sem subir o servidor.
- Red Team do Claude (server.js real no container): achou que o vínculo não era encontrado pelo número sem o nono dígito; corrigido e coberto pelo cenário 17.
