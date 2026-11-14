<!-- Fonte viva (Claude Docs): https://claude.ai/artifact/QLZD5XXii7aXuonidWk5CJ — exportado em 2026-11-10 21:30 (America/Sao_Paulo). Decisões do Alexandre registradas na seção 9. -->

# CRM GSI — Plano Aprimorado v2

Nov 10, 2026 · @Alexandre

## Resumo executivo

O CRM já tem a base certa (catálogo, clientes, fidelidade por raiz de CNPJ, numeração, cotação). O que falta para o vendedor viver nele o dia inteiro são seis coisas, nesta ordem: abrir o CRM ao perfil vendedor com escopo por proprietário; proposta em PDF por empresa emissora; vínculo conversa ↔ oportunidade com o WhatsApp Multi360; transferência de carteira; score v2 baseado no comportamento do cliente (não do vendedor); e regras claras para cliente repetido e vendedores concorrentes.

Principais descobertas ao ler o código atual:

- `crm_routes.js` bloqueia `role = vendedor` com 403 em todas as rotas (`requireAdminOrAlexandre`). Hoje só Alexandre e admins usam o CRM. Tudo o que vem abaixo depende de resolver isso primeiro.
- O SSO com o painel WhatsApp já existe (`/api/auth/whatsapp-ticket`, passe de 60 s, troca servidor-a-servidor). O painel já sabe o `username` do portal, então o vínculo com o vendedor do CRM vem de graça.
- O modelo de score atual carrega pesos por identidade do vendedor (`isAndrea = -0,85`, `isJuliana = +1,45`, `isLuiz = +0,20`). Isso penaliza negócios de uma pessoa independentemente do que ela faz e quebra quando a equipe muda. Deve sair.
- `created_by` e `updated_by` têm `DEFAULT 'alexandre'` no schema, e `crm_engine.js` fixa `000074`/`000004` como vendedor padrão. Ambos precisam vir do usuário logado (`req.user.vendorCode`), que o portal já resolve em `server.js`.
- `motivo_perda` é texto livre. Sem lista fechada não há BI de perdas nem sinal para o score.

Princípio para manter simples: cada funcionalidade nova deve caber em uma tabela nova ou uma coluna nova, um endpoint e um botão. Nada de módulos paralelos.

## 1. Pré-requisito: abrir o CRM ao vendedor com escopo por proprietário

Trocar `requireAdminOrAlexandre` por dois middlewares: `requireCrmAccess` (admin, diretoria ou vendedor com permissão `crm` em Abas Permitidas) e `scopeByOwner`, que injeta `req.crmScope = { all: true }` ou `{ codVendedor: req.user.vendorCode }`. Toda query de deals e atividades recebe `AND cod_vendedor = $scope` no servidor. O filtro de vendedor que vem do front vira só um refinamento para quem tem `all`.

Regras que evitam vazamento sem complicar:

| Situação | Comportamento |
| --- | --- |
| Vendedor pede `GET /deals/:id` de outro | Responde 404, não 403 (não confirma que o ID existe) |
| Vendedor cria deal | `cod_vendedor` forçado = `req.user.vendorCode`; campo Vendedor do modal vira somente leitura |
| Vendedor edita deal | Só se `cod_vendedor` bate com o dele; `updated_by = username` |
| Diretoria/admin | Vê tudo, pode filtrar por vendedor, pode transferir |
| Clientes (`crm_clientes`) | Leitura compartilhada por todos (espelho do Protheus); edição livre, mas auditada |
| Painel WhatsApp consulta o portal | Mesmo escopo: a API servidor-a-servidor recebe o `username` do passe e aplica `scopeByOwner` |

Cadastro mínimo necessário: uma tabela `crm_vendedores` (`cod_vendedor`, `username_portal`, `nome`, `email`, `telefone_whatsapp`, `ativo`, `assinatura`, meta mensal em R$, herda\_historico\_de). Ela substitui o `DEFAULT_VENDOR_CODES` do `server.js`, alimenta o rodapé das propostas (seção 3) e é a lista de destino das transferências (seção 6). Vendedor inativo some dos filtros mas continua aparecendo no histórico.

Auditoria: o portal já tem `logAction` (ex.: `ACESSO_WHATSAPP`). Registrar `CRM_DEAL_CRIADO`, `CRM_DEAL_EDITADO`, `CRM_DEAL_TRANSFERIDO`, `CRM_DEAL_ACESSO_NEGADO` com `deal_id` e `username`. Isso resolve a pergunta "quem mexeu nisso?" sem tabela nova.

## 2. Integração CRM ↔ WhatsApp Multi360

O vínculo é N:N e vive numa tabela única no Supabase do portal; o painel WhatsApp nunca grava no CRM diretamente, só chama a API do portal com o mesmo mecanismo de passe que o SSO já usa. Um cliente recorrente terá uma conversa e várias oportunidades ao longo do tempo; um negócio grande pode ter dois contatos (comprador e financeiro). Por isso a chave não pode ser `deal.conversa_id`.

**Tabela `crm_deal_conversas`**

| Coluna | Uso |
| --- | --- |
| `deal_id` | FK `crm_deals.id` |
| `conversa_id` | ID da conversa no Multi360 (texto) |
| `telefone_e164` | `5511999998888`, normalizado; é a chave de busca |
| `linha_whatsapp` | Número da empresa/instancia que atende (14, 15, 16 ou linha compartilhada) |
| `principal` | Booleano: a conversa que o botão Conversar abre |
| `vinculado_por`, `vinculado_em` | Auditoria |
| `ativo` | Falso quando o deal fecha; a conversa pode ser vinculada a um novo deal |

**Os três botões**

1. No CRM, botão Conversar no card e no modal de detalhes: chama `/api/auth/whatsapp-ticket` com `?deal=29001` e o painel abre direto na conversa `principal`. Sem conversa vinculada, abre nova conversa com o telefone do contato do deal já preenchido e grava o vínculo no primeiro envio.
2. No painel WhatsApp, painel lateral da conversa (o painel já tem o `username`; o portal devolve o `vendorCode`): mostra cliente resolvido pelo telefone, selo de fidelidade (⭐/💎), oportunidades abertas do vendedor logado para aquele CNPJ e dois botões: Criar oportunidade e Vincular a existente.
3. Criar oportunidade em um clique: `POST /api/crm/integracoes/whatsapp/deals` com `{telefone, conversa_id, nome_contato, cliente_cod?}`. O portal gera título `"{Nome do contato} — dd/mm"`, `origem = 'whatsapp'`, `cod_vendedor` do usuário, estágio Lead, e responde com o link `/crm#deal=29001`. Idempotência por `origem_ref = conversa_id + timestamp do clique` para não duplicar com duplo clique.

**Resolver quem é o cliente pelo telefone**

Ordem de busca: `crm_clientes.celular_whatsapp` e `telefone`; depois `crm_deals.contatos` (JSONB); depois `SA1010.A1_TEL`. Normalizar sempre para E.164 e tentar as duas formas com e sem o nono dígito, porque IDs antigos do WhatsApp ainda aparecem com 8 dígitos. Telefone desconhecido vira lead sem CNPJ (seção 8) e não bloqueia o vendedor.

**Resumo diário da conversa no histórico do deal**

Um job no Multi360 (19h, ou sob demanda pelo botão Resumir) percorre as conversas vinculadas com mensagens no dia, gera o resumo com LLM e envia `POST /api/crm/integracoes/whatsapp/deals/:id/resumo`. O portal grava em `crm_atividades` com `tipo = 'whatsapp_resumo'`, uma linha por dia, e o `custom` leva os campos estruturados que o score vai consumir:

```json
{
  "conversa_id": "abc123",
  "data": "2026-11-10",
  "msgs_cliente": 6,
  "msgs_vendedor": 4,
  "ultima_msg_cliente_em": "2026-11-10T16:42:00-03:00",
  "tempo_resposta_cliente_min": 35,
  "intencoes": ["preco", "prazo_entrega"],
  "objecoes": ["frete_caro"],
  "sentimento": "positivo",
  "proximo_passo": "Cliente pediu proposta revisada com frete FOB",
  "data_prometida": "2026-11-13"
}
```

Na timeline do deal aparece só a linha curta: "10/11 · WhatsApp · Cliente pediu revisão com frete FOB; retorno prometido para 13/11". O texto completo da conversa fica no Multi360; o CRM guarda só o resumo (menos dado pessoal, menos custo).

**Enviar a proposta pela conversa**

O botão Enviar por WhatsApp no CRM manda o PDF da proposta (seção 3) para o Multi360, que o entrega na conversa `principal` e devolve o ID da mensagem. O CRM registra atividade `proposta_enviada`. Esse é o ponto onde as duas telas deixam de ser duas.

**Mesmo CNPJ no WhatsApp**

Se o telefone pertence a uma empresa com oportunidade aberta de outro vendedor, o painel lateral mostra "CNPJ já possui oportunidade aberta (Juliana, contato Maria – Compras)" sem valores, e o botão Criar oportunidade continua ativo. O vendedor decide; a regra completa está na seção 5. Como as linhas de WhatsApp são por vendedor, a conversa pertence a quem atende; o vínculo em `crm_deal_conversas` guarda qual linha foi usada.

## 3. Impressão e envio de propostas

Um único template HTML com tema por empresa, renderizado no servidor para PDF (o portal já imprime holerites; reaproveitar o mesmo pipeline). A empresa emissora vem do campo Faturado Por (14 Metal Pleno, 15 GSI Cofres, 16 OACO) e pode ser trocada na hora de imprimir. Os dados do vendedor vêm de `crm_vendedores`.

**Tabela `crm_empresas_emitentes`** (3 linhas, editável pelo admin sem deploy)

| Coluna | Exemplo |
| --- | --- |
| `codigo` | `15` |
| `razao_social`, `cnpj`, `ie`, `endereco`, `telefone`, `site` | Cabeçalho |
| `logo_path` | `public/logos/gsi.png` |
| `cor_primaria`, `cor_secundaria` | `#0b3d91`, `#f59e0b` |
| `texto_rodape` | Condições gerais, garantia, validade |
| `dados_bancarios_pix` | Chave PIX e banco |
| `validade_padrao_dias` | `7` |
| `blocos_opcionais` | JSON: `{"mostrar_desconto": false, "mostrar_ncm": true}` |

O que varia entre empresas fica em dados (logo, cores, rodapé, blocos ligados ou desligados). O que não varia (tabela de itens, totais, frete, condição de pagamento, prazo, transportadora) fica no template. Assim um ajuste de layout vale para as três.

**Cada impressão é uma revisão imutável**

Tabela `crm_propostas`: `deal_id`, `revisao` (1, 2, 3…), `numero` (`29001-R2`), `empresa_codigo`, `cod_vendedor`, `itens_snapshot` (JSONB copiado de `itens_cotados` naquele momento), `valor_total`, `validade_ate`, `pdf_path` (Supabase Storage), `enviada_via` (email, whatsapp, download), `enviada_em`, `visualizada_em`. O deal mostra "Proposta R2 enviada 10/11, vence 17/11". Quando o cliente negocia, o vendedor gera R3 sem perder o que foi prometido em R2.

**Envio e rastreio**

- Botão E-mail: `mailer.js` com remetente e assinatura do vendedor, PDF anexo, texto padrão por empresa. Registra `proposta_enviada`.
- Botão WhatsApp: via Multi360 (seção 2).
- Link público opcional `/p/{token}` que abre o PDF e grava `visualizada_em` e contagem de aberturas. Cliente que abriu três vezes e não respondeu é sinal forte para o score e para a ação "ligar hoje". Para não ser bloqueado: link no domínio do próprio portal, sem encurtador, sem pixel externo; o PDF vai sempre anexo e o link é um extra.
- Validade vencendo em 2 dias gera atividade automática para o vendedor.

**Conteúdo da proposta** (ordem fixa): cabeçalho da empresa · número e revisão · dados do cliente (razão, CNPJ, contato, cidade/UF) · tabela de itens (código, descrição, qtd, UM, unitário, total; NCM e peso opcionais) · subtotal, frete cobrado, total · condição de pagamento, prazo de entrega, tipo de frete e transportadora · observações · validade · vendedor (nome, e-mail, WhatsApp) · rodapé da empresa. A proposta impressa nunca mostra desconto, só o preço negociado por item (decisão de 10/11); o Desc(%) fica interno ao CRM e ao BI de Autorizações.

## 4. Permissões e visibilidade: quem vê o quê

A seção 1 descreve o mecanismo; esta é a matriz de decisão. Oportunidades e atividades são privadas do proprietário; clientes e catálogo são da empresa.

| Objeto | Vendedor (dono) | Vendedor (outro) | Diretoria / Admin |
| --- | --- | --- | --- |
| Deal: ver | Sim | Não (404) | Sim |
| Deal: editar, mover estágio, ganhar/perder | Sim | Não | Sim |
| Deal: excluir / restaurar | Não (só marcar perdido) | Não | Sim |
| Deal: transferir | Pode entregar o seu | Não | Sim, qualquer um |
| Atividades e resumos WhatsApp do deal | Sim | Não | Sim |
| Propostas (PDFs) do deal | Sim | Não | Sim |
| Existe deal aberto de outro vendedor para este CNPJ? | Vê só "sim, de Fulano" | — | Vê tudo |
| Clientes (`crm_clientes`) | Ler todos, editar | Ler todos, editar | Tudo |
| Catálogo, transportadoras, empresas emissoras | Ler | Ler | Editar |
| Filtro Proprietário na listagem | Oculto | Oculto | Visível |
| Score e diagnóstico | Só dos seus | — | Todos + ranking |
| Deal perdido: reabrir | Sim (também os herdados; o deal passa ao nome dele) | Não | Sim |
| Deal ganho com pedido no Protheus | Somente leitura | Não | Somente leitura; reverter só com motivo e registro |

Dois pontos que costumam ser esquecidos: a busca global (`#crmSearchInput`) e o autocomplete de clientes também passam pelo escopo, senão o vendedor descobre deals alheios pelo título; e exportações (CSV, BI `#tab-bi-crm`) respeitam o mesmo filtro no servidor.

## 5. Mesmo cliente, várias oportunidades, vendedores concorrentes

A regra que todos os CRMs usam: CNPJ identifica a organização, não o negócio. Uma organização tem N oportunidades, cada uma é um evento de compra (cofre para a sala 1, porta blindada para a filial). O Pipedrive mostra isso como "3 negócios abertos" na ficha da organização; o HubSpot como associação empresa → negócios. O CRM GSI já está modelado assim (`crm_deals.cliente_cnpj` sem unique), então o problema não é a chave, é a disciplina e o aviso.

**Mesmo vendedor, mesmo CNPJ**

Permitido e normal. O que evitar é a duplicação acidental. Ao selecionar o cliente no modal, mostrar logo abaixo: "Você já tem 2 oportunidades abertas aqui: #29001 Proposta R$ 12.400 · #29008 Lead", com link para abrir em vez de criar. Padronizar o título como `Objeto — Cliente` ("Cofre AT-45 — Prevent Senior") para que a lista faça sentido. Na ficha do cliente, aba Oportunidades com o histórico completo.

**Vendedores diferentes, mesmo CNPJ: modelo livre** (decidido em 10/11)

O cadastro de clientes é geral e compartilhado; a oportunidade é particular. Qualquer vendedor pode abrir oportunidade para qualquer CNPJ, porque concorrer pelo mesmo cliente é normal na GSI. Carteira fixa (`A1_VEND`) e proteção temporária por raiz foram descartadas: travariam essa concorrência.

O que o sistema faz é avisar, nunca bloquear. Ao selecionar um CNPJ que já tem oportunidade aberta de outro vendedor, o modal mostra "CNPJ já possui oportunidade aberta (Juliana, desde 03/11, contato Maria – Compras)", sem título nem valor, e o botão Criar continua ativo. O mesmo aviso aparece no painel lateral do WhatsApp. A diretoria tem um painel Mesmo CNPJ que lista raizes com deals abertos de dois ou mais vendedores, só para acompanhar.

**Uma empresa, várias pessoas: tabela `crm_contatos`**

Hoje o contato vive no JSONB `contatos` de cada deal, então duas pessoas da mesma empresa atendidas por dois vendedores não se enxergam. A pessoa passa a ser um registro do cadastro geral, compartilhado como o cliente.

| Coluna | Uso |
| --- | --- |
| `id`, `cliente_id` | FK `crm_clientes.id`; uma empresa tem N contatos |
| `nome`, `cargo_setor` | "Maria – Compras", "Carlos – Financeiro" |
| `telefone_e164` | Único no cadastro: é a chave que liga WhatsApp → contato → cliente |
| `email` | Único quando preenchido |
| `criado_por`, `criado_em`, `ativo` | Quem cadastrou fica registrado; ninguém exclui, só inativa |

O deal ganha `contato_id` (o JSONB `contatos` existente migra para a tabela). Regras: cada deal tem um contato principal, que sai na proposta impressa como A/C; dois vendedores com deals na mesma empresa veem os mesmos contatos, mas cada um vê só o próprio deal; ao criar oportunidade pelo WhatsApp, se o telefone não existe, o contato é criado na hora e ligado ao cliente escolhido; o aviso de CNPJ repetido informa o contato do outro deal, o que ajuda a perceber se é a mesma compra ou outra.

Quando o deal é ganho e vira pedido no Protheus, o `C5_VEND` é o `cod_vendedor` do deal. Comissão segue o dono do deal, não o `A1_VEND` do cadastro, e isso encerra a disputa na origem.

## 6. Transferência de oportunidades, clientes e saída de vendedor

Duas operações, um mesmo motor: `transferirPropriedade({ escopo, de, para, opcoes, motivo, executadoPor })`. A individual é o motor com escopo de um deal; a saída do vendedor é o motor com escopo "tudo". Toda transferência roda em transação e grava uma linha em `crm_transferencias` com o antes e o depois, o que permite desfazer.

**Transferência individual** (botão Transferir no modal de detalhes)

- Admin transfere qualquer deal; o dono pode entregar o seu.
- Atualiza `cod_vendedor` e `nome_vendedor`, adiciona entrada em `historico_estagios` ("Transferido de Andrea para Luiz por Alexandre: férias") e cria atividade para o novo dono.
- Conversas em `crm_deal_conversas` seguem o deal. Como as linhas são por vendedor, a conversa antiga não muda de mão: fica vinculada ao deal como histórico (ativo = false) e o novo dono inicia conversa pela linha dele, que vira a principal no primeiro envio. O painel do Multi360 mostra ao antigo dono que o deal foi transferido.
- Propostas já emitidas não mudam (o PDF R2 continua com o nome de quem emitiu). A próxima revisão sai com o novo vendedor.

**Saída de vendedor** (tela Admin → Vendedores → Transferir tudo)

Assistente em três passos: escolher origem e destino; prévia com contagens; confirmar. A prévia mostra exatamente o que vai mudar e deixa o admin desmarcar:

| Item | Padrão | Observação |
| --- | --- | --- |
| Deals abertos (Lead a Negociação) | Transferir | É o que importa operacionalmente |
| Deals ganhos e perdidos | Ficam no nome do antigo, com leitura compartilhada ao novo | Campo herda\_historico\_de em crm\_vendedores: o novo dono vê ganhos e perdidos do antigo. Perdidos ele pode reabrir, e o deal passa para o nome dele com registro no histórico. Ganhos já migrados para o ERP ficam bloqueados para edição |
| Atividades pendentes | Transferir | Concluídas ficam como estão |
| Clientes com `vendedor_responsavel` = origem | Transferir | Pode distribuir entre vários destinos por UF ou por raiz |
| Conversas WhatsApp vinculadas | Transferir | Idem individual |
| `A1_VEND` no Protheus | Não tocar | É ERP; gerar lista para o cadastro ajustar, ou script separado com aprovação |
| Usuário do portal | Desativar | `crm_vendedores.ativo = false`; nome continua no histórico |

Depois de confirmar: executa, grava em `crm_transferencias` (`lote_id`, lista de IDs, estado anterior), manda resumo por e-mail ao admin e ao novo dono, e mostra o botão Desfazer por 7 dias.

**Distribuição de leads sem dono**

Se o Multi360 tiver uma linha compartilhada (atendimento geral), as conversas novas não têm vendedor. O mesmo motor serve para "atribuir": fila round-robin entre vendedores ativos, com regra simples por UF ou por raiz já em carteira (seção 5). Quem recebe o lead vê a atividade "Novo lead do WhatsApp" e tem 24 h para o primeiro contato; se não, volta para a fila.

## 7. Score v2: medir o cliente, não o vendedor

O modelo atual acerta ao usar fidelidade por raiz de CNPJ e tempo no funil, mas tem quatro defeitos que explicam por que ele não convence: (1) pesos por identidade do vendedor; (2) `notes_count` mede o esforço do vendedor, não o interesse do cliente, e é manipulável (anotar mais sobe o score); (3) dias no funil penaliza igual um Lead de 20 dias e uma Negociação de 20 dias; (4) foi treinado em dados do Pipedrive, cuja semântica de notas e atividades não é a do novo CRM. Cada deal mostra 15 % a 85 %, mas o número não muda quando o cliente responde ou some, que é o que o vendedor sente no dia a dia.

**Proposta: três camadas, cada uma com poucos sinais**

| Camada | Pergunta | Sinais | Fonte |
| --- | --- | --- | --- |
| Fit (quem é) | Este cliente costuma comprar de nós? | Compras na raiz (⭐/💎); recência da última NF (< 12 meses); ticket médio histórico vs. valor do deal; títulos vencidos no `SE1`; score de crédito do módulo de análise | `crm_clientes_raiz_cnpj`, Protheus, `analise_credito_engine.js` |
| Engajamento (o que ele faz) | O cliente está se mexendo? | Dias desde a última mensagem do cliente (não do vendedor); mensagens do cliente nos últimos 7 dias; tempo de resposta do cliente; proposta visualizada e quantas vezes; intenções detectadas (prazo, pagamento, frete = sinal de compra); objeções (preço, concorrente); sentimento | Resumo diário WhatsApp (seção 2), `crm_propostas` |
| Momentum (como anda) | Está andando no ritmo esperado? | Dias no estágio atual vs. mediana histórica daquele estágio; número de revisões da proposta (2 = negociando; 4 = enrolando); validade da proposta vencendo; `data_fechamento_esperada` passada; data prometida pelo cliente passada | `crm_deals`, `historico_estagios`, `crm_propostas` |

**Fase A (já): pontuação por regras, transparente**

Cada sinal vale pontos positivos ou negativos numa tabela `crm_score_config` editável pelo admin, no mesmo padrão que o score de crédito já usa (`test_score_config.js`). Exemplo de partida:

| Sinal | Pontos |
| --- | --- |
| Cliente 💎 (6+ compras) | +25 |
| Cliente ⭐ (1 a 5 compras) | +15 |
| Última NF há menos de 12 meses | +10 |
| Título vencido há mais de 30 dias no grupo | −20 |
| Valor do deal > 3× ticket médio do cliente | −10 |
| Cliente respondeu nas últimas 48 h | +15 |
| Cliente sem responder há 5 dias após mensagem do vendedor | −20 |
| Cliente perguntou prazo, pagamento ou frete | +15 |
| Objeção de preço ou concorrente registrada | −10 |
| Proposta visualizada 2+ vezes | +10 |
| Proposta enviada e não visualizada em 3 dias | −10 |
| Dias no estágio acima do p75 histórico | −15 |
| Proposta vence em até 2 dias | +5 (urgência; vira ação) |
| Data prometida pelo cliente passou sem contato | −15 |

A soma vira temperatura (Quente ≥ 40, Morno 10 a 39, Frio < 10). O vendedor vê a temperatura e os pontos no card do Kanban, na listagem e em Minha manhã, para saber o que está mais quente, e continua vendo os fatores explicáveis que o card `#crmDetalhesScoreCard` já mostra. Nenhum sinal usa o nome do vendedor nem quantas notas ele escreveu.

**Próxima ação, não só número**

O mesmo motor emite uma ação recomendada por deal, por regra direta: "cliente abriu a proposta 3× e não respondeu → ligar hoje"; "sem resposta há 5 dias → enviar follow-up (modelo pronto)"; "proposta vence amanhã → confirmar ou renovar"; "data prometida passou → perguntar status". A tela Minha manhã do vendedor lista os deals ordenados por `temperatura × valor × urgência`, com a ação ao lado e o botão Conversar. Isso é o que torna o CRM útil às 8h, e pode ser enviado como mensagem diária ao próprio vendedor pelo WhatsApp ou Telegram.

**Fase B (após 6 a 12 meses de dados nativos): retreinar**

Quando houver algumas centenas de deals fechados com esses sinais gravados, retreinar a regressão logística do `crm_scoring_engine.js` sobre as mesmas features (sem identidade de vendedor), validar com o backtest que já existe (`test_score_backtest.js`) e só então trocar os pontos manuais por pesos aprendidos. A tabela de config continua como override. Para medir se o score serve: a cada mês, comparar taxa de ganho real dos deals que estavam Quentes, Mornos e Frios 30 dias antes. Se Quente não ganha mais que Frio, os pontos estão errados.

Duas cautelas: o score orienta prioridade, não comissão nem avaliação do vendedor; e o motivo de perda estruturado (seção 8) é obrigatório para a Fase B funcionar.

## 8. Pontos cegos que não estavam no plano

| Ponto | Por que importa | Solução enxuta |
| --- | --- | --- |
| Motivo de perda estruturado | Texto livre não gera BI nem alimenta o score | Lista fechada: preço, prazo, concorrente (qual), sem resposta, desistiu, crédito negado, comprou outro produto. Campo `motivo_perda_cod` + `concorrente` + texto opcional. Obrigatório ao marcar Perdido |
| Lead sem CNPJ | Do WhatsApp chega "João, (11) 9…" e nada mais; hoje Cliente é obrigatório | Estágio Lead aceita contato avulso (nome + telefone). CNPJ vira obrigatório para entrar em Proposta. O botão Add Cliente já resolve o resto |
| Ganho → pedido Protheus | Hoje o vendedor redigita o pedido no ERP; o deal ganho precisa virar pedido sem retrabalho | Botão Gerar pedido: itens (`B1_COD`), cond. pagamento, transportadora (`A4_COD` já gravado), `C5_VEND` = dono do deal. Grava `num_pedido_protheus` no deal. Deal ganho é pedido real: ao marcar Ganho, o CRM grava SC5/SC6 na empresa do Faturado Por e só confirma o Ganho se o Protheus aceitar o pedido (decisão de 10/11) |
| Fechamento automático por NF | Deal fica aberto depois que a NF saiu | Job diário: NF emitida para o CNPJ com itens iguais aos cotados nos últimos 60 dias sugere marcar Ganho; vendedor confirma em um clique |
| Reabrir e clonar | Cliente volta 3 meses depois pedindo o mesmo | Clonar deal (itens, cliente, transportadora) com novo número; perdido pode ser reaberto com registro no histórico; ganho com pedido no Protheus fica bloqueado e, se houver nova compra, é clonado |
| Follow-ups com lembrete | `data_agendada` existe mas ninguém é avisado | Lembrete pelo Telegram (já existe agente) ou WhatsApp para o próprio vendedor, às 8h, com os itens do dia |
| Metas e painel da diretoria | Sem meta não há cobrança objetiva | Meta mensal por vendedor em `crm_vendedores`; painel com conversão por estágio, ciclo médio, motivos de perda, funil por empresa emissora. O BI já é ponto forte do portal |
| LGPD e retenção | Resumos de conversa são dado pessoal | CRM guarda resumo, não transcrição; retenção de 24 meses para deals perdidos; exclusão de contato avulso a pedido |
| Falha do portal durante atendimento | Vendedor no WhatsApp não pode travar se o portal cair | Multi360 enfileira criações e resumos e reenvia; painel lateral mostra "CRM indisponível" sem bloquear a conversa |
| Nono dígito e formatos de telefone | Telefone é a chave do vínculo | Função única `normalizarTelefoneBR()` usada no portal e no Multi360; busca tenta as duas formas |
| Celular | Vendedor em visita ou na régua do WhatsApp no celular | Kanban já é web; garantir que Minha manhã e o modal de detalhes funcionem em 390 px. Sem app nativo |

## 9. Roadmap sugerido e decisões a tomar

A ordem segue dependência e valor: nada do WhatsApp faz sentido antes do vendedor poder entrar no CRM, e o score v2 só tem sinais depois que resumos e propostas existem.

| Entrega | Escopo | Depende de | Tamanho |
| --- | --- | --- | --- |
| CRM-19 | RBAC vendedor + `scopeByOwner` + `crm_vendedores` + auditoria + meta mensal por vendedor (campo em crm\_vendedores e barra de meta no topo do funil) | — | M |
| CRM-20 | Proposta PDF por empresa + `crm_propostas` (revisões) + envio por e-mail | CRM-19 | G |
| CRM-21 | `crm_deal_conversas` + API servidor-a-servidor + botão Conversar + painel lateral no Multi360 (criar / vincular) | CRM-19 | G |
| CRM-22 | Resumo diário estruturado na timeline + envio de proposta pelo WhatsApp | CRM-20, CRM-21 | M |
| CRM-23 | Motivo de perda estruturado + lead sem CNPJ + clonar/reabrir | CRM-19 | P |
| CRM-24 | Transferência individual e em massa + herança de histórico (herda\_historico\_de) + painel Mesmo CNPJ + tabela crm\_contatos | CRM-19 | M |
| CRM-25 | Score v2 por regras + `crm_score_config` + Minha manhã + lembrete diário | CRM-22, CRM-23 | M |
| CRM-26 | Ganho → pedido real no Protheus (SC5/SC6) + fechamento automático por NF | CRM-20 | G |
| CRM-27 | Score v3 retreinado com dados nativos + backtest mensal | 6 a 12 meses de CRM-25 | M |

P = até 2 dias, M = 3 a 5 dias, G = 1 a 2 semanas, no ritmo atual das entregas v8.x.

**Decisões tomadas em 10/11/2026**

| Questão | Decisão | Efeito no plano |
| --- | --- | --- |
| Proteção de carteira por raiz de CNPJ | Não há: modelo livre. Cadastro de clientes geral, oportunidade particular, aviso "CNPJ já possui oportunidade aberta" sem bloquear | Seção 5 reescrita; tabela `crm_contatos` para várias pessoas por empresa |
| Vendedor entrega o próprio deal sem diretoria | Sim, com registro | Mantido |
| Ganhos e perdidos de quem saiu | Ficam no nome do antigo, com leitura compartilhada ao novo | `herda_historico_de` em `crm_vendedores` |
| Desconto na proposta impressa | Nunca aparece | Bloco removido do template |
| Link público de visualização | Sim, se simples e não bloqueado | Link no domínio do portal, PDF sempre anexo |
| Resumo diário do WhatsApp | Automático | Job às 19h no Multi360 |
| Linhas de WhatsApp | Por vendedor | Conversa não muda de mão na transferência; novo dono abre conversa pela linha dele |
| Pedido Protheus | Ganho é pedido real, migra para o ERP | CRM-26 vira SC5/SC6 direto, Ganho só confirma com pedido gravado |
| Score visível ao vendedor | Sim, temperatura e pontos | Card, listagem e Minha manhã |
| Metas mensais | Já no CRM-19 | Campo em `crm_vendedores` + barra de meta no funil |
| Reabrir e editar deals antigos | Perdidos podem ser reabertos; ganhos já migrados para o ERP ficam bloqueados para edição | Matriz da seção 4 e regra de herança na seção 6 |
| Edição do cadastro de cliente | Livre para todos os vendedores | Já previsto na matriz da seção 4; fica auditado |

**O que precisa do lado do Gemini-Whatsapp-Multi360** (para o próximo plano daquele repositório): endpoint `/auth/callback?ticket=&deal=` que abre a conversa certa; painel lateral com consulta ao portal; fila de envio para criação de deal e resumo; job de resumo diário com saída no JSON da seção 2; envio de arquivo PDF numa conversa a partir de chamada do portal; `normalizarTelefoneBR()` compartilhada.
