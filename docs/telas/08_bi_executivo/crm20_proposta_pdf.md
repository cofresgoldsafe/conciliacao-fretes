# CRM-20 — Proposta em PDF por empresa emissora

Especificação executável · versão alvo **v8.322** · tamanho G (1 a 2 semanas)
Fonte: `docs/telas/08_bi_executivo/crm_plano_v2.md`, seção 3 e roadmap da seção 9. Levantamento feito sobre o código em 13/11/2026 (`main` em `f20f95b`, v8.321).

## 0. Objetivo e limites

Ao fim do CRM-20, quem pode editar um deal (dono ou admin) abre o deal, clica em **📄 Proposta**, confere a prévia e gera uma **revisão imutável** em PDF (`29001-R1`, `29001-R2`…), com o visual da empresa do **Faturado Por** (14 Metal Pleno, 15 GSI, 16 OACO). A revisão pode ser baixada, enviada por e-mail com o PDF anexo ou compartilhada por um link público que registra as aberturas. Dois dias antes de vencer, o vendedor recebe uma atividade de lembrete.

**Fora do escopo** (não implementar aqui):
- envio pelo WhatsApp (CRM-22) — mas a geração do PDF já sai como função reutilizável (`gerarPdfProposta`), que o CRM-22 vai chamar;
- trava de deal ganho com pedido no Protheus e geração de SC5/SC6 (CRM-26);
- tabela `crm_contatos` (CRM-24): o A/C da proposta vem do contato que o deal já tem hoje;
- upload de logo pela tela: a logo entra pelo repositório (`public/logos/`) e o caminho é editado na tabela;
- score e "Minha manhã" (CRM-25): o CRM-20 só grava `visualizada_em`/`aberturas`, que o score vai ler depois.

**Regras de ouro:**
1. **A proposta impressa nunca mostra desconto** (decisão de 10/11): só o preço negociado por item. Nem `precoTabela`, nem `descontoPercent`, nem a palavra "desconto" entram no PDF ou no e-mail.
2. Proposta segue o **escopo do deal** (CRM-19): toda rota de proposta começa com `obterDealPorId(id, req.crmScope)`; se `null` → 404.
3. Revisão gerada **não muda nunca**: o PDF fica gravado em bytes e os dados em snapshot. Mudou o deal? Gera R(n+1).

## 1. Estado atual (o que o código faz hoje)

| Onde | O que acontece | Consequência para o CRM-20 |
| --- | --- | --- |
| `package.json` | Nenhuma biblioteca de PDF. `playwright` só em `devDependencies` | **Não existe pipeline de PDF no servidor** |
| `public/js/holerites.js:235, 1103` | Holerite "imprime" com `window.print()` no navegador | O plano v2 dizia "reaproveitar o pipeline dos holerites"; ele não serve: e-mail e WhatsApp precisam do arquivo no servidor |
| `Dockerfile` / `Procfile` | `node:20-slim` sem Chromium; Render roda `node server.js` | Gerar PDF via Chromium/Playwright exigiria ~300 MB a mais no deploy. **Decisão: `pdfmake@0.2`** (JS puro, sobre pdfkit, fontes Roboto embutidas, tabelas e cores declarativas). Testado em Node 20: gera PDF com acentuação correta |
| `danfe_protheus.js:17` `DADOS_EMITENTES` | Razão social, fantasia, CNPJ, IE, endereço e telefone das empresas 14, 15 e 16 | Fonte da carga inicial de `crm_empresas_emitentes` |
| `public/logos/` | `logo-gsi.png` (175×45) e `logo-oaco.png` (144×131). **Não há logo da Metal Pleno** | Metal Pleno sai com cabeçalho só em texto até a logo chegar |
| `crm_engine.js:595-636` `crm_deals` | Tem `cond_pgto`, `tipo_frete`, `frete_cobrado`, `frete_embutido`, `transportadora`, `prazo_entrega`, `itens_cotados` (JSONB), `contatos` (JSONB), `cliente_*`, `custom` | Tudo o que a proposta precisa já está no deal |
| `crm_engine.js:1335` e `public/js/crm.js:1466` | Faturado Por vive em `custom.faturadoPor` como texto (`"15 - GSI COFRES"`) | Código da empresa = 2 primeiros dígitos, normalizados como no `normalizeFaturadoPor` do front |
| `public/js/crm.js:1983-1997` | Item cotado: `codigo`, `descricao`, `quantidade`, `precoTabela`, `precoNegociado`, `descontoPercent`, `total`, `ncm`, `pesoLiquido`, `pesoBruto`, `unidade`, `grupo` | Snapshot copia só os campos permitidos (seção 4.2); `precoTabela` e `descontoPercent` ficam fora |
| `crm_engine.js:1300-1312` | O motor soma `preco_unitario`/`preco_unit`, mas o front grava `precoNegociado` | Na proposta, preço do item = `precoNegociado ?? preco_unitario ?? preco_unit`. Não mexer no cálculo do deal aqui |
| `public/js/crm.js:322` | Contato do deal = `custom.contatoNome` ou `contatos[0].nome` | É o A/C da proposta |
| `mailer.js:34` `sendViaMailjetHttpApi` | Envia por Mailjet (API HTTP) ou SMTP; **sem anexo e sem Reply-To**; exporta só funções de 2FA e alerta | Precisa de `sendPropostaEmail` com anexo e `ReplyTo` |
| `crm_vendedores.js:32-57` | `email`, `telefone_whatsapp`, `assinatura` existem mas estão `null` | E-mail do vendedor precisa ser preenchido no ⚙️ Vendedores antes do primeiro envio |
| `server.js:421` `requireCronAuth` + `.github/workflows/*.yml` | Jobs agendados = GitHub Actions chamando `POST /api/cron/...` com `CRON_SECRET` | O lembrete de validade usa o mesmo padrão |
| `crm_engine.js:1469` `recordTelemetry` | Auditoria do CRM (`CRM_CRIAR_DEAL` etc.) | Eventos novos da seção 5.4 usam a mesma função |
| `public/crm.html:656-672` | Rodapé do modal de detalhes: Perdido, Ganho, Editar, Fechar | Botão **📄 Proposta** entra ao lado de Editar |

## 2. Banco de dados

Novo arquivo `sql/bi/12_tabelas_crm_propostas.sql` (ao lado do `11_tabela_crm_vendedores.sql`) **e** o mesmo DDL dentro de `initCrmTables()`.

```sql
CREATE TABLE IF NOT EXISTS crm_empresas_emitentes (
  codigo                VARCHAR(2) PRIMARY KEY,          -- '14', '15', '16'
  razao_social          VARCHAR(200) NOT NULL,
  nome_fantasia         VARCHAR(150) NOT NULL,
  cnpj                  VARCHAR(14) NOT NULL,
  ie                    VARCHAR(20),
  endereco              VARCHAR(300),                    -- linha única já formatada
  telefone              VARCHAR(30),
  email_contato         VARCHAR(200),
  site                  VARCHAR(150),
  logo_path             VARCHAR(200),                    -- relativo a public/, ex. 'logos/logo-gsi.png'; NULL = cabeçalho em texto
  cor_primaria          VARCHAR(7) NOT NULL DEFAULT '#0b3d91',
  cor_secundaria        VARCHAR(7) NOT NULL DEFAULT '#f59e0b',
  texto_rodape          TEXT,                            -- condições gerais, garantia
  texto_email           TEXT,                            -- corpo padrão do e-mail
  dados_bancarios_pix   TEXT,
  validade_padrao_dias  SMALLINT NOT NULL DEFAULT 7 CHECK (validade_padrao_dias BETWEEN 1 AND 60),
  blocos_opcionais      JSONB NOT NULL DEFAULT '{"mostrar_ncm": false, "mostrar_peso": false}'::jsonb,
  ativo                 BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by            VARCHAR(100)
);

INSERT INTO crm_empresas_emitentes (codigo, razao_social, nome_fantasia, cnpj, ie, endereco, telefone, logo_path) VALUES
  ('14', 'METAL PLENO EQUIPAMENTOS DE ACO LTDA', 'Metal Pleno', '48758821000118', '145707309111',
         'Rua Maria José, 119 · Bela Vista · São Paulo/SP · 01324-010', '(11) 3141-9000', NULL),
  ('15', 'GSI BW EQUIPAMENTOS DE ACO COFRES E ARMARIOS LTDA', 'GSI Brasil', '14061778000115', 'ISENTO',
         'Rua Maria José, 119 · Bela Vista · São Paulo/SP · 01324-010', '(11) 3141-9000', 'logos/logo-gsi.png'),
  ('16', 'OACO PRODUTOS DE ACO LTDA', 'OAÇO / Cofres Gold Safe', '61237790000118', '535132321110',
         'Rua Maria José, 119 · Bela Vista · São Paulo/SP · 01324-010', '(11) 3141-9000', 'logos/logo-oaco.png')
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS crm_propostas (
  id               BIGSERIAL PRIMARY KEY,
  deal_id          VARCHAR(64) NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  revisao          SMALLINT NOT NULL,
  numero           VARCHAR(80) NOT NULL UNIQUE,         -- '29001-R2'
  empresa_codigo   VARCHAR(2) NOT NULL REFERENCES crm_empresas_emitentes(codigo),
  cod_vendedor     VARCHAR(20) NOT NULL,
  snapshot         JSONB NOT NULL,                       -- tudo o que foi impresso (seção 4.2)
  valor_total      NUMERIC(15,2) NOT NULL,
  validade_ate     DATE NOT NULL,
  pdf              BYTEA NOT NULL,
  pdf_sha256       CHAR(64) NOT NULL,
  token_publico    VARCHAR(64) NOT NULL UNIQUE,          -- 32 bytes aleatórios em base64url
  gerada_por       VARCHAR(100) NOT NULL,
  gerada_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enviada_via      VARCHAR(20)[] NOT NULL DEFAULT '{}',  -- 'email', 'download', 'link' (CRM-22 acrescenta 'whatsapp')
  enviada_em       TIMESTAMPTZ,                          -- primeiro envio
  visualizada_em   TIMESTAMPTZ,                          -- primeira abertura válida do link
  aberturas        INTEGER NOT NULL DEFAULT 0,
  ultima_abertura_em TIMESTAMPTZ,
  UNIQUE (deal_id, revisao)
);
CREATE INDEX IF NOT EXISTS idx_crm_propostas_deal ON crm_propostas (deal_id, revisao DESC);
CREATE INDEX IF NOT EXISTS idx_crm_propostas_validade ON crm_propostas (validade_ate);
```

- RLS igual ao de `crm_transportadoras` (`crm_engine.js:841-859`): habilitar, forçar, policy só para `service_role`/`postgres`, `REVOKE` de `anon` e `authenticated`. Isso vale para as duas tabelas; o PDF e o token não podem vazar pela API REST do Supabase.
- **Por que BYTEA e não Supabase Storage:** o portal não usa Storage em lugar nenhum (só `pg` com `DATABASE_URL`). Um PDF tem 20 a 100 KB; algumas centenas por mês cabem no banco sem nova credencial nem novo serviço. Listagens **nunca** selecionam a coluna `pdf` (só a rota de download).
- **Sem fallback de cache JSON:** proposta exige Postgres. Banco fora → 503 `PROPOSTAS_INDISPONIVEIS` ("Propostas indisponíveis no momento. O restante do CRM continua funcionando."). O resto do CRM segue com o fallback que já existe.

## 3. Geração do PDF — novo `crm_propostas.js`

Módulo próprio (como `crm_vendedores.js`), para não engordar o `crm_engine.js`. Dependência nova: **`pdfmake@^0.2.23`** em `dependencies` (fixar a 0.2; a 0.3 mudou a API de Node). Fontes: Roboto do `pdfmake/build/vfs_fonts`.

```js
// Funções puras (testáveis sem banco)
montarSnapshot(deal, empresa, vendedor, opcoes)        // → objeto da seção 4.2
montarDocDefinition(snapshot, { previa = false })      // → docDefinition do pdfmake
gerarPdf(docDefinition)                                // → Promise<Buffer>

// Com banco
listarEmpresas({ incluirInativas })                    // cache 5 min, invalida em salvarEmpresa
obterEmpresa(codigo)
salvarEmpresa(codigo, dados, usuario)                  // admin; evento CRM_EMPRESA_EDITADA (antes/depois)
previaProposta(dealId, opcoes, scope)                  // → Buffer, NÃO grava
gerarRevisao(dealId, opcoes, usuario, scope)           // → { proposta } sem o pdf
listarPropostas(dealId, scope)                         // sem a coluna pdf
obterPdf(dealId, revisao, scope)                       // → { numero, pdf }
enviarPorEmail(dealId, revisao, dadosEnvio, usuario, scope)
registrarAbertura(token, { userAgent, ip })            // rota pública
gerarLembretesValidade(hoje)                           // job
```

`opcoes` = `{ validadeDias?, observacoesCliente? }`. A empresa **não** é opção: sai sempre do Faturado Por do deal (ver decisão pendente na seção 11).

### 3.1 Layout (ordem fixa, A4 retrato, margens 40 pt)

1. **Cabeçalho:** logo (altura máx. 50 pt) à esquerda ou, sem logo, nome fantasia em `cor_primaria`; à direita razão social, CNPJ formatado, IE, endereço, telefone, site. Filete em `cor_primaria`.
2. **Título:** "PROPOSTA COMERCIAL Nº 29001-R2" · data de emissão · "Válida até 20/11/2026".
3. **Cliente:** razão social, CNPJ, A/C (contato), cidade/UF, e-mail e telefone do cliente quando houver.
4. **Itens:** tabela com cabeçalho em `cor_primaria` e linhas zebradas: Código · Descrição · Qtd · UM · Unitário · Total. NCM e Peso só se ligados em `blocos_opcionais`. Unitário = preço negociado. Cabeçalho da tabela se repete em quebra de página (`headerRows: 1`).
5. **Totais** (alinhados à direita): Subtotal dos itens · Frete (só se `frete_cobrado > 0`) · **Total**. `frete_embutido` não aparece (já está no preço).
6. **Condições:** Condição de pagamento · Prazo de entrega · Frete (CIF/FOB) e Transportadora.
7. **Observações** (só se `observacoesCliente` preenchido). **Não** usar `deal.observacoes` nem `obs_nfe`, que são internos.
8. **Dados para pagamento** (só se `dados_bancarios_pix` preenchido).
9. **Vendedor:** nome, e-mail, WhatsApp, `assinatura`.
10. **Rodapé** em todas as páginas: `texto_rodape` + "Página X de Y".

Prévia: marca d'água diagonal "PRÉVIA — SEM VALOR" (`watermark` do pdfmake) e número "29001-R? (prévia)".

Formatação: moeda `pt-BR` com `R$`, datas `dd/mm/aaaa` no fuso `America/Sao_Paulo`, CNPJ `00.000.000/0000-00`. Logo lida do disco (`path.join(__dirname, 'public', logo_path)`), com checagem de que o caminho resolvido continua dentro de `public/logos` (sem `..`). Logo ausente no disco → cabeçalho em texto + `console.warn`, nunca erro.

### 3.2 Validações antes de gerar (prévia e revisão)

| Regra | Erro |
| --- | --- |
| Deal visível e editável no escopo | 404 `DEAL_NOT_FOUND` |
| Deal com `estagio = 'perdido'` | 409 `DEAL_PERDIDO` ("Reabra a oportunidade para emitir proposta") |
| Faturado Por resolve para 14, 15 ou 16 e a empresa está ativa | 400 `EMPRESA_EMITENTE_INVALIDA` |
| `cliente_nome` e `cliente_cnpj` preenchidos | 400 `CLIENTE_INCOMPLETO` |
| Ao menos 1 item com `quantidade > 0` e preço > 0; nenhum item com preço ≤ 0 | 400 `ITENS_INVALIDOS` (lista os itens) |
| `validadeDias` entre 1 e 60 | 400 `VALIDADE_INVALIDA` |

Deal `ganho` pode gerar nova revisão no CRM-20 (a trava vem no CRM-26).

## 4. Revisões

### 4.1 Numeração sem corrida

Em transação: `SELECT COALESCE(MAX(revisao),0)+1 FROM crm_propostas WHERE deal_id = $1 FOR UPDATE` não trava linhas inexistentes, então usar `SELECT ... FROM crm_deals WHERE id = $1 FOR UPDATE` primeiro (trava o deal), depois calcular a próxima revisão e inserir. O `UNIQUE (deal_id, revisao)` é a segunda barreira: em violação, repetir uma vez.

### 4.2 Snapshot (o que fica gravado)

```json
{
  "numero": "29001-R2",
  "emitida_em": "2026-11-20T14:05:00-03:00",
  "validade_ate": "2026-11-27",
  "empresa": { "codigo": "15", "razao_social": "...", "nome_fantasia": "...", "cnpj": "...", "ie": "...", "endereco": "...", "telefone": "...", "site": "...", "logo_path": "...", "cor_primaria": "#0b3d91", "cor_secundaria": "#f59e0b", "texto_rodape": "...", "dados_bancarios_pix": "...", "blocos_opcionais": {} },
  "cliente": { "nome": "...", "cnpj": "...", "contato": "Maria – Compras", "cidade": "...", "uf": "SP", "email": "...", "telefone": "..." },
  "itens": [ { "codigo": "AT-45", "descricao": "...", "quantidade": 2, "unidade": "UN", "preco_unitario": 6200.00, "total": 12400.00, "ncm": "...", "peso_kg": 180 } ],
  "subtotal": 12400.00, "frete_cobrado": 0, "total": 12400.00,
  "cond_pgto": "28 DDL", "prazo_entrega": "15 dias úteis", "tipo_frete": "CIF", "transportadora": "...",
  "observacoes_cliente": "...",
  "vendedor": { "codigo": "000074", "nome": "Juliana", "email": "...", "telefone_whatsapp": "...", "assinatura": "..." }
}
```

`montarSnapshot` usa **lista de campos permitidos** (não copia o item inteiro e apaga campos). Teste obrigatório: nenhum `precoTabela`, `descontoPercent`, `desconto`, `custo`, `margem` no snapshot nem no texto do PDF. `total` do item = `quantidade × preco_unitario` arredondado a 2 casas; `valor_total` da proposta = soma + frete cobrado. Se divergir de `deal.valor_total` em mais de R$ 0,01, gerar mesmo assim e registrar `console.warn` (o deal pode ter valor digitado à mão).

### 4.3 Efeitos de gerar uma revisão

- Grava `crm_propostas` com `pdf`, `pdf_sha256`, `token_publico` (`crypto.randomBytes(32).toString('base64url')`).
- Cria atividade no deal: `tipo = 'proposta_gerada'`, `status = 'concluida'`, assunto "Proposta 29001-R2 gerada", `custom = { proposta_numero, revisao, valor_total, validade_ate }`.
- Se o deal está em `lead` ou `contato`, move para `proposta` pelo `atualizarEstagioDeal` existente (grava o histórico com justificativa "Proposta 29001-R2 gerada"). Em `proposta`, `negociacao` ou `ganho`, não mexe no estágio.
- `custom.ultima_proposta = { numero, revisao, validade_ate, enviada_em: null, visualizada_em: null }` no deal, para o card e a listagem mostrarem sem consultar `crm_propostas`. Atualizado também por envio e abertura.

## 5. Rotas

### 5.1 Em `crm_routes.js` (autenticadas, já passam por `requireCrmAccess` + `scopeByOwner`)

| Rota | Vendedor | Admin | Resposta |
| --- | --- | --- | --- |
| `GET /empresas-emitentes` | Sim (leitura) | Sim; `?inativas=1` | Linha inteira (nenhum campo é sigiloso) |
| `PUT /empresas-emitentes/:codigo` | 403 `FORBIDDEN_CRM_ADMIN` | Sim | Valida cores `#RRGGBB`, `logo_path` dentro de `logos/`, validade 1–60 |
| `POST /deals/:id/propostas/previa` | Se dono | Sim | `application/pdf`, `Content-Disposition: inline`, sem gravar |
| `POST /deals/:id/propostas` | Se dono | Sim | 201 com a proposta (sem `pdf`) |
| `GET /deals/:id/propostas` | Se dono | Sim | Lista de revisões, mais nova primeiro, sem `pdf`, **com** o link público montado |
| `GET /deals/:id/propostas/:revisao/pdf` | Se dono | Sim | PDF; `?download=1` → `attachment` e acrescenta `'download'` em `enviada_via` |
| `POST /deals/:id/propostas/:revisao/email` | Se dono | Sim | Seção 5.3 |

Deal de outro vendedor em qualquer uma → 404 (mesma regra do CRM-19), com `CRM_DEAL_ACESSO_NEGADO`. Respostas de PDF: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, nome do arquivo `Proposta-29001-R2-GSI-Brasil.pdf` (sem acento nem espaço).

Prévia e geração são `POST` porque recebem `validadeDias` e `observacoesCliente` no corpo.

### 5.2 Link público em `server.js` (sem login)

`GET /p/:token`, registrado **antes** dos middlewares de autenticação, com limitador próprio (`propostaPublicaLimiter`: 30 req/min por IP).

- Token fora do formato (`^[A-Za-z0-9_-]{43}$`) ou inexistente → 404 com página simples "Proposta não encontrada" (mesma resposta para os dois casos).
- Encontrado → serve o PDF `inline` com `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`.
- Proposta vencida continua abrindo (o cliente pode querer consultar); o PDF já diz a validade.
- **Contagem de aberturas** (`registrarAbertura`), ignorando:
  - `User-Agent` de robôs de pré-visualização e antivírus de e-mail: `/bot|crawler|spider|preview|facebookexternalhit|WhatsApp|TelegramBot|Slackbot|SafeLinks|Proofpoint|Mimecast|Barracuda|urldefense/i`;
  - aberturas nos **2 minutos seguintes a um envio** (scanner de e-mail corporativo abre o link logo que a mensagem chega);
  - repetição do mesmo IP em menos de 10 minutos (conta uma).
- Primeira abertura válida: grava `visualizada_em`, cria atividade `proposta_visualizada` ("Cliente abriu a proposta 29001-R2") e atualiza `custom.ultima_proposta`. Aberturas seguintes só somam `aberturas` e `ultima_abertura_em` (sem nova atividade, para não poluir a timeline).
- Telemetria `CRM_PROPOSTA_ABERTA` com IP mascarado (últimos dois octetos zerados).

O botão "Ver" dentro do CRM usa a rota autenticada (5.1), **nunca** o link público, para o próprio vendedor não inflar as aberturas.

### 5.3 E-mail

`mailer.js` ganha `sendPropostaEmail({ to, cc, replyTo, fromName, subject, text, html, attachment: { filename, contentBase64 } })`:

- Mailjet: `Attachments: [{ ContentType: 'application/pdf', Filename, Base64Content }]`, `ReplyTo: { Email, Name }`, `Cc`.
- SMTP (nodemailer): `attachments`, `replyTo`, `cc`.
- **Remetente:** o endereço de `SMTP_from` (domínio já verificado no Mailjet), com o **nome** do vendedor e da empresa ("Juliana · GSI Brasil"). Resposta do cliente vai para o e-mail do vendedor pelo `Reply-To`, e o vendedor recebe cópia. Mandar com o e-mail do vendedor no `From` seria bloqueado por SPF/DKIM se o domínio dele não estiver verificado.
- Corpo: `texto_email` da empresa com marcadores `{cliente}`, `{contato}`, `{numero}`, `{validade}`, `{vendedor}`; padrão se vazio: "Olá {contato}, segue em anexo a proposta {numero}, válida até {validade}. Também é possível abrir pelo link: {link}. Fico à disposição. {vendedor}". Assinatura do vendedor ao final. O texto **não** cita valores nem desconto.
- Corpo da requisição: `{ para, cc?, assunto?, mensagem? }`. `para` aceita até 5 e-mails separados por vírgula, validados com `isValidEmail`. Padrão do `para` no front: `deal.cliente_email`.
- Bloqueios: vendedor sem e-mail em `crm_vendedores` → 409 `VENDEDOR_SEM_EMAIL` ("Cadastre seu e-mail em ⚙️ Vendedores"); proposta vencida → 409 `PROPOSTA_VENCIDA` ("Gere uma nova revisão"); limite de 20 envios por usuário por hora → 429.
- Sucesso: `enviada_via += 'email'`, `enviada_em` se vazio, atividade `proposta_enviada` com `custom = { proposta_numero, via: 'email', para }`, telemetria `CRM_PROPOSTA_ENVIADA`.
- Falha do Mailjet/SMTP → 502 `EMAIL_FALHOU` com a mensagem do provedor no log, nada gravado como enviado.

### 5.4 Auditoria

Via `recordTelemetry`, com `deal_id`, `cod_vendedor`, `role` no metadata: `CRM_PROPOSTA_GERADA`, `CRM_PROPOSTA_ENVIADA`, `CRM_PROPOSTA_BAIXADA`, `CRM_PROPOSTA_ABERTA`, `CRM_EMPRESA_EDITADA`.

## 6. Lembrete de validade

`POST /api/cron/crm-propostas-vencendo` em `server.js`, protegido por `requireCronAuth`, chama `gerarLembretesValidade(hoje)`:

- Para cada deal aberto (`estagio NOT IN ('ganho','perdido')`, `ativo`), pega **só a revisão mais nova**; se `validade_ate = hoje + 2 dias` (fuso São Paulo), cria atividade `tipo = 'proposta_vencendo'`, `status = 'pendente'`, `data_agendada = hoje 09:00`, responsável = dono do deal, assunto "Proposta 29001-R2 vence em 2 dias — confirmar ou renovar".
- Idempotente: não cria se já existe atividade `proposta_vencendo` com o mesmo `custom.proposta_numero`.
- Retorna `{ verificadas, criadas }`.

Workflow novo `.github/workflows/crm_propostas_vencendo.yml`, cópia do `sync_nfe_central.yml`, cron `0 11 * * *` (8h em São Paulo), mesmo segredo.

## 7. Front-end

**`public/crm.html`**
- Rodapé do modal de detalhes: botão `#btnCrmPropostaDoDetalhes` "📄 Proposta", antes de "✏️ Editar". Escondido quando o deal está perdido.
- Novo modal `#modalCrmPropostas` (padrão visual dos modais existentes, caber em 390 px):
  - Topo: "Emitida por **GSI Brasil**" (somente leitura, vem do Faturado Por, com dica "para trocar, edite o Faturado Por da oportunidade") · Validade (dias, padrão da empresa) · Observações para o cliente (textarea, 500 caracteres).
  - Botões: **Pré-visualizar** (abre o PDF em nova aba via `blob:`), **Gerar R{n}**.
  - Lista de revisões: número · data · valor · validade (vermelho se vencida) · selos "Enviada por e-mail" / "Aberta 3× · última 18/11 14:02" · ações **Ver**, **Baixar**, **E-mail**, **Copiar link**.
- Mini-modal de e-mail `#modalCrmPropostaEmail`: Para (pré-preenchido), Cc, Assunto ("Proposta 29001-R2 — GSI Brasil"), Mensagem (pré-preenchida, editável), Enviar.
- Botão admin "🏢 Empresas" ao lado do "⚙️ Vendedores": tabela das 3 empresas com edição de todos os campos da seção 2, prévia de cores, e um botão "Ver proposta de exemplo" que gera prévia com dados fictícios.

**`public/js/crm.js`**
1. Abrir `#modalCrmPropostas` carrega `GET /deals/:id/propostas` e `GET /empresas-emitentes` (cache na sessão da página).
2. Antes de gerar, se o modal de edição tiver alterações não salvas, avisar "Salve a oportunidade antes de gerar a proposta" (a proposta usa o que está gravado no servidor).
3. Erros 400/409 da seção 3.2 e 5.3 viram mensagens claras no próprio modal, não `alert`.
4. PDF autenticado: `fetch` com o token, `blob`, `URL.createObjectURL`, `window.open`; revogar a URL depois.
5. Card do Kanban e linha da listagem: selo curto vindo de `custom.ultima_proposta`: "R2 · vence 27/11" e um 👁 quando aberta. Sem consulta extra.
6. Timeline do deal: ícones para `proposta_gerada` 📄, `proposta_enviada` 📧, `proposta_visualizada` 👁, `proposta_vencendo` ⏰.

**Versão:** `bump_version.js` para v8.322 (atualiza os `?v=` do `crm.html` e `index.html`).

## 8. Testes

**Novo `test_crm_propostas.js`**, incluído no `npm test` logo depois do `test_crm_rbac_vendedor.js`. Mesmo padrão (`generateToken`, `makeRequest`). As funções puras rodam sem banco; as de rota usam Postgres quando houver e, sem ele, verificam o 503.

| # | Cenário | Esperado |
| --- | --- | --- |
| 1 | `montarSnapshot` com itens contendo `precoTabela` e `descontoPercent` | Snapshot sem esses campos; `preco_unitario` = `precoNegociado` |
| 2 | Texto do `docDefinition` serializado | Não contém "desconto", "Desc", "%" de desconto, nem o `precoTabela` |
| 3 | `gerarPdf` | Buffer começa com `%PDF-`, tamanho < 300 KB, sem exceção com acentos (ç, ã, é, —) |
| 4 | Empresa 14 sem logo e logo com caminho `../../server.js` | Gera com cabeçalho em texto; caminho fora de `logos/` é ignorado |
| 5 | `frete_cobrado = 0` e `frete_embutido > 0` | Linha de frete não aparece; total = soma dos itens |
| 6 | 25 itens | Mais de uma página, cabeçalho da tabela repetido, "Página 2 de 2" |
| 7 | Juliana gera proposta no próprio deal | 201, `numero = <id>-R1`, atividade `proposta_gerada`, deal `contato` → `proposta` |
| 8 | Juliana gera de novo | `-R2`; R1 continua com o mesmo `pdf_sha256` |
| 9 | Duas gerações simultâneas no mesmo deal | R1 e R2, nenhuma duplicada |
| 10 | Juliana em prévia, geração, lista, PDF e e-mail no deal da Andrea | 404 em todos |
| 11 | Deal perdido / sem CNPJ / item com preço 0 / Faturado Por vazio | 409 `DEAL_PERDIDO` / 400 `CLIENTE_INCOMPLETO` / 400 `ITENS_INVALIDOS` / 400 `EMPRESA_EMITENTE_INVALIDA` |
| 12 | Prévia | Não grava em `crm_propostas`, PDF com marca "PRÉVIA" |
| 13 | E-mail com vendedor sem e-mail | 409 `VENDEDOR_SEM_EMAIL` |
| 14 | E-mail com `sendPropostaEmail` simulado (stub) | Payload com anexo PDF, `ReplyTo` = e-mail do vendedor, `From` = `SMTP_from`; `enviada_via` contém `email`; atividade `proposta_enviada` |
| 15 | `GET /p/<token>` com UA de navegador, 3 min após envio | 200 PDF, `aberturas = 1`, `visualizada_em` gravado, uma atividade `proposta_visualizada` |
| 16 | Mesmo token com UA `WhatsApp/2.23` e com UA `Microsoft SafeLinks` | 200 PDF, `aberturas` não muda |
| 17 | `GET /p/<token inválido>` e `GET /p/<43 chars inexistente>` | 404 idêntico nos dois |
| 18 | Vendedor em `PUT /empresas-emitentes/15` | 403 `FORBIDDEN_CRM_ADMIN` |
| 19 | Admin em `PUT /empresas-emitentes/15` com cor `red` | 400 |
| 20 | `gerarLembretesValidade` rodado duas vezes no mesmo dia | Cria uma atividade por proposta, só para a revisão mais nova, nenhuma para deals ganhos/perdidos |
| 21 | `POST /api/cron/crm-propostas-vencendo` sem segredo | 401 |

**Rodar** `npm test` completo; nada dos arquivos atuais pode quebrar. Restaurar `data/*.json` alterados pelos testes com `git checkout --`.

**Conferência visual (Claude):** gerar uma proposta de cada empresa com um deal real de teste do Alexandre, abrir os 3 PDFs e conferir cabeçalho, quebra de página, totais e rodapé antes do PR.

## 9. Ordem de execução e liberação

1. Backend: `crm_propostas.js` + DDL + `sendPropostaEmail` + rotas + link público + cron (seções 2 a 6), com os testes 1 a 21.
2. Front (seção 7).
3. Conferência visual dos 3 PDFs.
4. PR, merge pelo Alexandre, deploy no Render. Conferir no log a criação das duas tabelas e a carga das 3 empresas.
5. Alexandre (admin) preenche em produção: seu e-mail em ⚙️ Vendedores; em 🏢 Empresas, rodapé, PIX e cores, se quiser.
6. Alexandre gera uma proposta de teste para um deal dele e envia para o próprio e-mail: confere anexo, Reply-To, link e contagem de abertura (abrir de outro aparelho, 2 min depois).
7. Criar o segredo/variável do workflow novo no GitHub, se o existente não servir, e disparar o job manualmente uma vez.

Vendedores continuam sem a permissão `crm` até janeiro/2027 (decisão de 13/11). **Reverter:** o botão 📄 Proposta pode ser escondido por front; as tabelas novas não afetam nada existente.

## 10. Pronto quando

- [ ] `pdfmake@0.2.x` em `dependencies`; nenhum Chromium no deploy.
- [ ] Tabelas `crm_empresas_emitentes` (3 linhas) e `crm_propostas` criadas, com RLS.
- [ ] Nenhuma ocorrência de `precoTabela`, `descontoPercent` ou "desconto" em `montarDocDefinition` e no corpo do e-mail.
- [ ] Os 21 cenários do `test_crm_propostas.js` passam, e o `npm test` inteiro também.
- [ ] 3 PDFs (14, 15, 16) conferidos visualmente.
- [ ] Alexandre recebeu a proposta de teste por e-mail e o link registrou a abertura.
- [ ] Workflow `crm_propostas_vencendo.yml` rodou uma vez com sucesso.
- [ ] `TODO.md` com a linha `[CRM-20]`, changelog no `crm_comercial.md` (seções 3, 6 e 8), versão v8.322.

## 11. Decisões pendentes do Alexandre

Se não houver resposta, vale o **padrão**.

| Questão | Padrão |
| --- | --- |
| Logo da Metal Pleno: existe? Há versões maiores das logos GSI e OACO (as atuais têm 175×45 e 144×131 px e podem sair borradas)? | Metal Pleno com cabeçalho em texto; GSI e OACO com as logos atuais |
| Texto de condições gerais / garantia para o rodapé | Rodapé em branco (editável depois em 🏢 Empresas) |
| Validade de 7 dias para as 3 empresas | 7 dias corridos, o vendedor pode mudar por proposta (1 a 60) |
| A empresa da proposta pode ser diferente do Faturado Por? O plano v2 dizia "pode ser trocada na hora de imprimir", mas no CRM-26 o pedido sai na empresa do Faturado Por | **Não**: proposta sempre na empresa do Faturado Por; para trocar, edita-se o deal |
| A empresa 15 é a "GSI BW EQUIPAMENTOS DE ACO COFRES E ARMARIOS LTDA", IE isenta. É ela mesma que emite proposta de produtos, com esse nome? | Sim, com os dados do `DADOS_EMITENTES` |
| Gerar a 1ª proposta move o deal de Lead/Contato para Proposta automaticamente? | Sim, com registro no histórico |
| Cores de cada empresa | Azul `#0b3d91` e laranja `#f59e0b` nas 3 até ele escolher |
