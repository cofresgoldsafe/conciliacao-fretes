# Armadilhas do agente (Antigravity) neste repositório

Uma linha por erro já cometido. Todo pedido ao agente cita as linhas que valem para a fatia.

- Dados de empresa (CNPJ, IE, endereço, telefone, razão social) vêm só de `danfe_protheus.js` DADOS_EMITENTES ou de `crm_empresas_emitentes`; nunca inventar (CRM-20).
- Texto comercial ou jurídico (garantia, impostos, estoque, aceite, condições padrão) só se o Alexandre fornecer; nunca inventar (CRM-20).
- Escopo do CRM é `{ all: true }` ou `{ all: false, codVendedor, codigosLeitura }` (`crm_routes.js` scopeByOwner); não existem `isAdmin`, `codigoVendedor`, `scope.username` (CRM-20).
- `crm_deals.id` é VARCHAR(64): IDs de deal são texto; nunca `Number(id)` (CRM-20).
- Vendedor: tabela `crm_vendedores` (`cod_vendedor`, `nome`, `username_portal`, `email`); não existem `nome_exibicao` nem `codigo_protheus` (CRM-20).
- `atualizarEstagioDeal(id, novoEstagio, usuario, justificativa, motivoPerda, scope)` em `crm_engine.js`; conferir a assinatura antes de chamar (CRM-20).
- Testes devem importar os handlers reais usados no `server.js`/`crm_routes.js`, nunca cópias das rotas (CRM-20).
- Remetente de e-mail é `SMTP_from`/`SMTP_FROM` no `mailer.js`; não passar `from` à mão nem inventar endereço (CRM-20).
- Segredos (`CRON_SECRET` etc.) só por variável de ambiente; nunca valor de reserva no código ou no workflow (CRM-20).
- `sendRfcError` devolve o código em `json.error.code`, não em `json.code`.
- Estágios válidos de deal: lead, contato, proposta, negociacao, ganho, perdido.
- Não subir o `server.js` no PC: ele liga jobs reais (Protheus, e-mail, cron).
- Nunca pôr no código de produção exceção por nome de cliente de teste nem CNPJ real (ex.: `cliente_nome === 'CLIENTE JULIANA LTDA' ? '14061778000115'`). Teste que quebra com regra nova ajusta o fixture do próprio teste, com documento fictício (`11.222.333/0001-81`) (CRM-23).
- Validação de transição (`validarTransicao`) só roda quando o estágio muda; editar um deal sem mudar de estágio não pode exigir motivo de novo (CRM-23).
- Ao copiar ou clonar um deal, levar `valor_total` do original: itens gravados pela tela usam `precoNegociado` e o `criarDeal` soma `preco_unitario`, então recalcular dá R$ 0 (CRM-23).
- Os modais do CRM existem em DOIS arquivos: `public/crm.html` (/crm) e `public/index.html` (sub-aba #tab-bi-crm), com o mesmo `crm.js`. Toda mudança de HTML do CRM vai nos dois (CRM-23).
