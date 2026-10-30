/**
 * test_telegram_agent.js
 *
 * Suíte de Testes Automatizados para o Agente Mobile Multi-Projeto 24/7 no Telegram:
 * 1. GET /api/telegram/status retorna os 5 projetos e status booleano das variáveis sem expor segredos.
 * 2. POST /api/telegram/webhook rejeita com 401 quando TELEGRAM_WEBHOOK_SECRET diverge e 403 quando chat.id não está em TELEGRAM_ALLOWED_CHAT_ID.
 * 3. Primeira mensagem sem projeto selecionado salva pendingQuestion e responde pedindo para escolher entre os 5 projetos (inline_keyboard).
 * 4. Clique no botão select_project:portal-gsi seleciona o projeto e processa a pergunta pendente automaticamente.
 * 5. isSensitiveFilePath bloqueia .env, certs/inter.key, certs/inter.crt, etc.
 * 6. Fluxo completo de propose_file_edit -> gera preview com botões -> confirm_patch executa PUT na API do GitHub (usando setFetchImpl mockado) e retorna o commit hash.
 * 7. Fluxo de cancel_patch descarta a alteração sem chamar PUT no GitHub.
 */

const assert = require('assert');
const http = require('http');
const app = require('./server');
const telegramAgent = require('./routes/telegram_agent');

let passedTests = 0;
let failedTests = 0;

function report(name, success, error) {
  if (success) {
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${name}: ${error}`);
    failedTests++;
  }
}

function request(baseUrl, method, reqPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, baseUrl);
    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function createJsonResponse(status, obj) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
    text: async () => JSON.stringify(obj)
  };
}

async function runTelegramAgentTests() {
  console.log('\n=============================================================');
  console.log('🧪 SUÍTE DE TESTES: AGENTE MOBILE MULTI-PROJETO 24/7 (TELEGRAM)');
  console.log('=============================================================\n');

  // Configura variáveis de ambiente de teste
  process.env.TELEGRAM_BOT_TOKEN = '123456:TEST_BOT_TOKEN_SECRET';
  process.env.TELEGRAM_ALLOWED_CHAT_ID = '999888777, 111222333';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'super_secret_webhook_token_2026';
  process.env.GEMINI_API_KEY = 'AIzaSyTestFakeKeyForUnitTesting';
  process.env.GITHUB_PAT = 'ghp_TestFakeGithubPatTokenForUnitTesting';

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // -------------------------------------------------------------
    // Teste 1: GET /api/telegram/status
    // -------------------------------------------------------------
    console.log('--- 1. Diagnóstico Seguro (GET /api/telegram/status) ---');
    try {
      const res = await request(baseUrl, 'GET', '/api/telegram/status');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(Array.isArray(res.body.projects), true);
      assert.strictEqual(res.body.projects.length, 5, 'Deve retornar exatamente os 5 projetos');
      assert.strictEqual(res.body.prompt.loaded, true, 'Prompt desacoplado deve estar carregado');

      // Verifica que os valores são estritamente booleanos e não vazam segredos
      for (const [k, v] of Object.entries(res.body.configured)) {
        assert.strictEqual(typeof v, 'boolean', `Campo configured.${k} deve ser boolean`);
        assert.strictEqual(v, true, `Campo configured.${k} deve ser true no ambiente de teste`);
      }
      const rawJson = JSON.stringify(res.body);
      assert.strictEqual(rawJson.includes('TEST_BOT_TOKEN_SECRET'), false, 'Não pode vazar TELEGRAM_BOT_TOKEN');
      assert.strictEqual(rawJson.includes('ghp_TestFake'), false, 'Não pode vazar GITHUB_PAT');

      report('GET /api/telegram/status retorna os 5 projetos e booleans sem expor segredos', true);
    } catch (err) {
      report('GET /api/telegram/status retorna os 5 projetos e booleans sem expor segredos', false, err.message);
    }

    // -------------------------------------------------------------
    // Teste 2: Segurança Zero-Trust (401 Secret Inválido e 403 Chat Não Autorizado)
    // -------------------------------------------------------------
    console.log('--- 2. Segurança Zero-Trust no Webhook (401 e 403) ---');
    try {
      const res401 = await request(
        baseUrl,
        'POST',
        '/api/telegram/webhook',
        { 'x-telegram-bot-api-secret-token': 'token_errado' },
        { message: { chat: { id: 999888777 }, from: { id: 999888777 }, text: 'oi' } }
      );
      assert.strictEqual(res401.status, 401, 'Deve rejeitar com 401 quando secret token diverge');
      assert.strictEqual(res401.body.ok, false);

      const res403 = await request(
        baseUrl,
        'POST',
        '/api/telegram/webhook',
        { 'x-telegram-bot-api-secret-token': 'super_secret_webhook_token_2026' },
        { message: { chat: { id: 555555555 }, from: { id: 555555555 }, text: 'oi invasor' } }
      );
      assert.strictEqual(res403.status, 403, 'Deve rejeitar com 403 quando chat.id não está autorizado');
      assert.strictEqual(res403.body.ok, false);

      report('POST /api/telegram/webhook bloqueia token inválido (401) e chat_id não autorizado (403)', true);
    } catch (err) {
      report('POST /api/telegram/webhook bloqueia token inválido (401) e chat_id não autorizado (403)', false, err.message);
    }

    // -------------------------------------------------------------
    // Teste 3: Primeira mensagem sem projeto selecionado salva pendingQuestion e exibe 5 projetos
    // -------------------------------------------------------------
    console.log('--- 3. Seleção Obrigatória de Projeto & Memória de Pergunta Pendente ---');
    const telegramSentMessages = [];
    telegramAgent.resetSessions();
    telegramAgent.setFetchImpl(async (url, opts) => {
      if (url.includes('api.telegram.org') && url.endsWith('/sendMessage')) {
        const body = JSON.parse(opts.body);
        telegramSentMessages.push(body);
        return createJsonResponse(200, { ok: true, result: { message_id: 10 } });
      }
      if (url.includes('api.telegram.org') && url.endsWith('/answerCallbackQuery')) {
        return createJsonResponse(200, { ok: true });
      }
      throw new Error(`URL inesperada no Teste 3: ${url}`);
    });

    try {
      const resAsk = await request(
        baseUrl,
        'POST',
        '/api/telegram/webhook',
        { 'x-telegram-bot-api-secret-token': 'super_secret_webhook_token_2026' },
        {
          message: {
            chat: { id: 999888777 },
            from: { id: 999888777 },
            text: 'Qual o status atual do servidor?'
          }
        }
      );

      assert.strictEqual(resAsk.status, 200);
      assert.strictEqual(resAsk.body.ok, true);
      assert.strictEqual(resAsk.body.action, 'ask_project');
      assert.strictEqual(resAsk.body.pendingQuestion, 'Qual o status atual do servidor?');

      assert.strictEqual(telegramSentMessages.length, 1, 'Deve ter enviado 1 mensagem ao Telegram');
      const sent = telegramSentMessages[0];
      assert.strictEqual(sent.text.includes('Sobre qual projeto você quer tratar agora?'), true);
      assert.ok(sent.reply_markup && Array.isArray(sent.reply_markup.inline_keyboard));

      const allButtons = sent.reply_markup.inline_keyboard.flat();
      assert.strictEqual(allButtons.length, 5, 'O inline_keyboard deve conter os 5 projetos');
      assert.strictEqual(allButtons.some(b => b.callback_data === 'select_project:portal-gsi'), true);
      assert.strictEqual(allButtons.some(b => b.callback_data === 'select_project:assistencia'), true);
      assert.strictEqual(allButtons.some(b => b.callback_data === 'select_project:leilao'), true);
      assert.strictEqual(allButtons.some(b => b.callback_data === 'select_project:whatsapp'), true);
      assert.strictEqual(allButtons.some(b => b.callback_data === 'select_project:loja-pipedrive'), true);

      report('Primeira mensagem sem projeto salva pendingQuestion e envia inline_keyboard com 5 projetos', true);
    } catch (err) {
      report('Primeira mensagem sem projeto salva pendingQuestion e envia inline_keyboard com 5 projetos', false, err.message);
    }

    // -------------------------------------------------------------
    // Teste 4: Clique em select_project:portal-gsi seleciona o projeto e processa pendingQuestion
    // -------------------------------------------------------------
    console.log('--- 4. Callback select_project:portal-gsi Processa Pergunta Pendente ---');
    try {
      telegramSentMessages.length = 0;
      let geminiCallCount = 0;

      telegramAgent.setFetchImpl(async (url, opts) => {
        if (url.includes('api.telegram.org')) {
          if (url.endsWith('/sendMessage')) {
            telegramSentMessages.push(JSON.parse(opts.body));
          }
          return createJsonResponse(200, { ok: true });
        }

        if (url.includes('generativelanguage.googleapis.com')) {
          geminiCallCount++;
          if (geminiCallCount === 1) {
            return createJsonResponse(200, {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        functionCall: {
                          name: 'get_server_status',
                          args: {}
                        }
                      }
                    ]
                  }
                }
              ]
            });
          }
          return createJsonResponse(200, {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: '✅ Servidor 24/7 online e saudável no projeto Portal GSI.'
                    }
                  ]
                }
              }
            ]
          });
        }

        throw new Error(`URL inesperada no Teste 4: ${url}`);
      });

      const resSelect = await request(
        baseUrl,
        'POST',
        '/api/telegram/webhook',
        { 'x-telegram-bot-api-secret-token': 'super_secret_webhook_token_2026' },
        {
          callback_query: {
            id: 'cbq_1',
            from: { id: 999888777 },
            message: { chat: { id: 999888777 } },
            data: 'select_project:portal-gsi'
          }
        }
      );

      assert.strictEqual(resSelect.status, 200);
      assert.strictEqual(resSelect.body.ok, true);
      assert.strictEqual(resSelect.body.action, 'project_selected_and_processed');
      assert.strictEqual(resSelect.body.project, 'portal-gsi');
      assert.strictEqual(resSelect.body.processedQuestion, 'Qual o status atual do servidor?');
      assert.strictEqual(geminiCallCount, 2, 'Deve ter chamado Gemini (tool call + resposta final)');
      assert.strictEqual(
        telegramSentMessages.some(m => m.text.includes('Servidor 24/7 online')),
        true,
        'Deve ter enviado a resposta final da pergunta pendente ao Telegram'
      );

      report('Clique em select_project:portal-gsi ativa projeto e processa pendingQuestion automaticamente', true);
    } catch (err) {
      report('Clique em select_project:portal-gsi ativa projeto e processa pendingQuestion automaticamente', false, err.message);
    }

    // -------------------------------------------------------------
    // Teste 5: Guardrail isSensitiveFilePath
    // -------------------------------------------------------------
    console.log('--- 5. Proteção de Arquivos Sensíveis (isSensitiveFilePath) ---');
    try {
      const blockedPaths = [
        '.env',
        '.env.local',
        'config/.env.production',
        'certs/inter.key',
        'certs/inter.crt',
        'certs/certificado.pfx',
        'certs/private.pem',
        '~/.ssh/id_rsa',
        'config/credentials.json',
        'data/secrets.txt',
        '../etc/passwd'
      ];
      for (const p of blockedPaths) {
        assert.strictEqual(
          telegramAgent.isSensitiveFilePath(p),
          true,
          `Caminho sensível deveria ser bloqueado: ${p}`
        );
      }

      const allowedPaths = [
        'server.js',
        'routes/pgtos_desconhecidos.js',
        'public/js/credito.js',
        'docs/telas/01_tarefas/minhas_tarefas.md'
      ];
      for (const p of allowedPaths) {
        assert.strictEqual(
          telegramAgent.isSensitiveFilePath(p),
          false,
          `Caminho seguro deveria ser permitido: ${p}`
        );
      }

      report('isSensitiveFilePath bloqueia .env, .key, .crt, .pfx, secrets e permite arquivos de código', true);
    } catch (err) {
      report('isSensitiveFilePath bloqueia .env, .key, .crt, .pfx, secrets e permite arquivos de código', false, err.message);
    }

    // -------------------------------------------------------------
    // Teste 6: Fluxo Completo propose_file_edit -> Preview -> confirm_patch (PUT GitHub)
    // -------------------------------------------------------------
    console.log('--- 6. Fluxo propose_file_edit + confirm_patch (GitHub PUT) ---');
    try {
      telegramSentMessages.length = 0;
      let githubGetCalled = false;
      let githubPutPayload = null;
      let geminiTurn = 0;

      telegramAgent.setFetchImpl(async (url, opts = {}) => {
        if (url.includes('api.telegram.org')) {
          if (url.endsWith('/sendMessage')) {
            telegramSentMessages.push(JSON.parse(opts.body));
          }
          return createJsonResponse(200, { ok: true });
        }

        if (url.includes('api.github.com/repos/cofresgoldsafe/conciliacao-fretes/contents/README.md')) {
          if (!opts.method || opts.method === 'GET') {
            githubGetCalled = true;
            const originalText = '# Portal GSI\nVersao Antiga = 1.0\n';
            return createJsonResponse(200, {
              name: 'README.md',
              path: 'README.md',
              sha: 'sha_antigo_123456',
              content: Buffer.from(originalText, 'utf-8').toString('base64')
            });
          }

          if (opts.method === 'PUT') {
            githubPutPayload = JSON.parse(opts.body);
            return createJsonResponse(200, {
              commit: {
                sha: '9f8e7d6c5b4a3210fedcba9876543210abcdef12',
                html_url: 'https://github.com/cofresgoldsafe/conciliacao-fretes/commit/9f8e7d6c5b4a3210fedcba9876543210abcdef12'
              }
            });
          }
        }

        if (url.includes('generativelanguage.googleapis.com')) {
          geminiTurn++;
          if (geminiTurn === 1) {
            return createJsonResponse(200, {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        functionCall: {
                          name: 'propose_file_edit',
                          args: {
                            path: 'README.md',
                            target: 'Versao Antiga = 1.0',
                            replacement: 'Versao Nova = 2.0',
                            commitMessage: 'docs: atualizar versao no README'
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            });
          }
          return createJsonResponse(200, {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: 'Preparei o diff acima. Clique em Comitar e Publicar para confirmar.'
                    }
                  ]
                }
              }
            ]
          });
        }

        throw new Error(`URL inesperada no Teste 6: ${url}`);
      });

      // 6.1 Solicita alteração no projeto já ativo (portal-gsi)
      const resPropose = await request(
        baseUrl,
        'POST',
        '/api/telegram/webhook',
        { 'x-telegram-bot-api-secret-token': 'super_secret_webhook_token_2026' },
        {
          message: {
            chat: { id: 999888777 },
            from: { id: 999888777 },
            text: 'Atualize a versao no README.md para 2.0'
          }
        }
      );

      assert.strictEqual(resPropose.status, 200);
      assert.strictEqual(githubGetCalled, true, 'Deve buscar arquivo e SHA atual no GitHub');

      const previewMessage = telegramSentMessages.find(
        m => m.reply_markup && m.reply_markup.inline_keyboard
      );
      assert.ok(previewMessage, 'Deve ter enviado mensagem com botões de confirmação');
      const patchButtons = previewMessage.reply_markup.inline_keyboard.flat();
      assert.strictEqual(patchButtons.some(b => b.callback_data === 'confirm_patch'), true);
      assert.strictEqual(patchButtons.some(b => b.callback_data === 'cancel_patch'), true);

      // 6.2 Clica em [✅ Comitar e Publicar] (confirm_patch)
      const resConfirm = await request(
        baseUrl,
        'POST',
        '/api/telegram/webhook',
        { 'x-telegram-bot-api-secret-token': 'super_secret_webhook_token_2026' },
        {
          callback_query: {
            id: 'cbq_confirm_1',
            from: { id: 999888777 },
            message: { chat: { id: 999888777 } },
            data: 'confirm_patch'
          }
        }
      );

      assert.strictEqual(resConfirm.status, 200);
      assert.strictEqual(resConfirm.body.ok, true);
      assert.strictEqual(resConfirm.body.action, 'patch_confirmed');
      assert.strictEqual(resConfirm.body.commitSha, '9f8e7d6c5b4a3210fedcba9876543210abcdef12');
      assert.ok(githubPutPayload, 'Deve ter executado PUT na API do GitHub');
      assert.strictEqual(githubPutPayload.sha, 'sha_antigo_123456');
      assert.strictEqual(githubPutPayload.message, 'docs: atualizar versao no README');
      const decodedNewContent = Buffer.from(githubPutPayload.content, 'base64').toString('utf-8');
      assert.strictEqual(decodedNewContent, '# Portal GSI\nVersao Nova = 2.0\n');

      report('Fluxo propose_file_edit -> preview diff -> confirm_patch realiza PUT no GitHub e retorna commit hash', true);
    } catch (err) {
      report('Fluxo propose_file_edit -> preview diff -> confirm_patch realiza PUT no GitHub e retorna commit hash', false, err.message);
    }

    // -------------------------------------------------------------
    // Teste 7: Fluxo cancel_patch descarta alteração sem chamar PUT no GitHub
    // -------------------------------------------------------------
    console.log('--- 7. Fluxo cancel_patch Descarta Alteração Sem Comitar ---');
    try {
      let putCalledOnCancel = false;
      const session = telegramAgent.getSessions().get('999888777');
      session.pendingPatch = {
        id: 'patch_to_cancel',
        projectKey: 'portal-gsi',
        projectLabel: '🏢 Portal GSI',
        repo: 'cofresgoldsafe/conciliacao-fretes',
        branch: 'main',
        path: 'README.md',
        sha: 'sha_123',
        newContent: 'conteudo descartado',
        commitMessage: 'chore: teste cancelamento',
        diffPreview: '- a\n+ b',
        createdAt: Date.now()
      };

      telegramAgent.setFetchImpl(async (url, opts = {}) => {
        if (opts.method === 'PUT') {
          putCalledOnCancel = true;
        }
        return createJsonResponse(200, { ok: true });
      });

      const resCancel = await request(
        baseUrl,
        'POST',
        '/api/telegram/webhook',
        { 'x-telegram-bot-api-secret-token': 'super_secret_webhook_token_2026' },
        {
          callback_query: {
            id: 'cbq_cancel_1',
            from: { id: 999888777 },
            message: { chat: { id: 999888777 } },
            data: 'cancel_patch'
          }
        }
      );

      assert.strictEqual(resCancel.status, 200);
      assert.strictEqual(resCancel.body.ok, true);
      assert.strictEqual(resCancel.body.action, 'patch_cancelled');
      assert.strictEqual(putCalledOnCancel, false, 'Não deve chamar PUT no GitHub ao cancelar');
      assert.strictEqual(session.pendingPatch, null, 'pendingPatch deve ser limpo da sessão');

      report('Fluxo cancel_patch descarta pendingPatch sem chamar PUT no GitHub', true);
    } catch (err) {
      report('Fluxo cancel_patch descarta pendingPatch sem chamar PUT no GitHub', false, err.message);
    }

    // -------------------------------------------------------------
    // Teste 8, 9 e 10: Autorização de Desconto & Margem via Bot Telegram (Deal #26851)
    // -------------------------------------------------------------
    console.log('--- 8. Encaminhamento de Mensagem de Vendedor (Deal #26851) Sem Projeto Selecionado ---');
    try {
      telegramSentMessages.length = 0;
      telegramAgent.resetSessions();

      const { calcularMargemEDesconto, formatarNotaPipedrive } = require('./bi_autorizacoes_engine');
      let lastAnalisarCallOptions = null;
      let gravarNotaCalls = [];
      let saveDbCalls = [];

      telegramAgent.setFetchImpl(async (url, opts = {}) => {
        if (url.includes('api.telegram.org')) {
          if (url.endsWith('/sendMessage')) {
            telegramSentMessages.push(JSON.parse(opts.body));
          }
          return createJsonResponse(200, { ok: true });
        }
        throw new Error(`URL inesperada nos Testes 8-10: ${url}`);
      });

      telegramAgent.setAutorizacoesDeps({
        analisarDealCompleto: async (dealIdInput, options = {}) => {
          lastAnalisarCallOptions = options;
          const precoTabelaTotal = 39845.00; // 5 x 7.969,00
          const custoTotal = 18612.80;       // 5 x 3.722,56
          const valorVendaOriginalPipedrive = 39845.00; // Vendedor ainda não alterou no Pipedrive
          const valorVendaFinal = options.proposta || valorVendaOriginalPipedrive;
          const freteEmbutido = options.freteEmbutidoOverride !== undefined ? options.freteEmbutidoOverride : 0.00;
          const condPgtoLabel = options.condPgtoLabelOverride || '028-1X BOL 28 D';

          const calc = calcularMargemEDesconto({
            valorVendaTotal: valorVendaFinal,
            precoTabelaTotal,
            custoTotal,
            freteEmbutido
          });

          return {
            dealId: Number(dealIdInput),
            dealTitle: 'Deal 26851 - 05 Armários Azul',
            clienteNome: 'Indústria Metalúrgica ABC Ltda',
            solicitanteNome: 'Carlos Vendedor',
            dealStatus: 'open',
            condPgtoOptionId: 28,
            condPgtoLabel,
            tipoFrete: freteEmbutido > 0 ? 'CIF (Embutido)' : 'FOB (Cliente)',
            freteEmbutido: calc.freteEmbutido,
            isRevenda: false,
            hasItensSemCusto: false,
            isAlertaDesconto: calc.descontoPct > 11,
            isValorPropostoCustom: Boolean(options.proposta),
            valorVendaOriginalPipedrive,
            valorVendaFinal: calc.valorVenda,
            precoUnitarioAutorizadoMedio: Number((calc.valorVenda / 5).toFixed(2)),
            totalQuantidade: 5,
            precoTabelaTotal: calc.precoTabelaTotal,
            custoTotal: calc.custoTotal,
            valorLiquido: calc.valorLiquido,
            descontoReais: calc.descontoReais,
            descontoPct: calc.descontoPct,
            lucroBruto: calc.lucroBruto,
            margemPct: calc.margemPct,
            itens: [
              {
                productId: 777,
                rawCode: '15-001020304',
                protheusCode: '001020304',
                nomePipedrive: 'Armário 200x100x45 Azul',
                descricaoProtheus: 'ARMARIO DE ACO 200X100X45 AZUL',
                quantidade: 5,
                precoUnitarioDeal: 7969.00,
                precoUnitarioTabela: 7969.00,
                custoUnitario: 3722.56,
                totalDeal: 39845.00,
                totalTabela: 39845.00,
                totalCusto: 18612.80,
                encontradoProtheus: true
              }
            ],
            fraseAutorizacao: formatarNotaPipedrive({
              dealId: Number(dealIdInput),
              descontoPct: calc.descontoPct,
              condPgtoLabel,
              freteEmbutido: calc.freteEmbutido,
              valorTotal: calc.valorVenda,
              autorizado: true
            }),
            fraseNaoAutorizado: formatarNotaPipedrive({
              dealId: Number(dealIdInput),
              descontoPct: calc.descontoPct,
              condPgtoLabel,
              freteEmbutido: calc.freteEmbutido,
              valorTotal: calc.valorVenda,
              autorizado: false
            })
          };
        },
        gravarNotaPipedrive: async (dealId, nota) => {
          gravarNotaCalls.push({ dealId, nota });
          return { success: true };
        },
        saveAutorizacaoDescontoDB: async (payload) => {
          saveDbCalls.push(payload);
          return { id: 501, deal_id: payload.dealId, status: payload.status };
        }
      });

      const msgVendedor = [
        'Condição: 1x Boleto para 28 dias',
        'Produto: 05 armários (200x100x45) na cor AZUL',
        'Preço original: R$ 7.969,00 cada',
        'Preço com desconto: R$ 7.451,08 cada (frete CIF embutido)',
        'Valor do frete: R$ 684,00 por unidade',
        '',
        'Segue o link:',
        'https://benetroncomercial.pipedrive.com/deal/26851'
      ].join('\n');

      const resDeal = await request(
        baseUrl,
        'POST',
        '/api/telegram/webhook',
        { 'x-telegram-bot-api-secret-token': 'super_secret_webhook_token_2026' },
        {
          message: {
            chat: { id: 999888777 },
            from: { id: 999888777 },
            text: msgVendedor
          }
        }
      );

      assert.strictEqual(resDeal.status, 200);
      assert.strictEqual(resDeal.body.ok, true);
      assert.strictEqual(resDeal.body.action, 'deal_analyzed');
      assert.strictEqual(resDeal.body.dealId, 26851);
      assert.strictEqual(resDeal.body.hasTextDivergence, true, 'Deve detectar que o texto do vendedor tem desconto/frete ainda não refletidos no Deal');

      const sessionAfterDeal = telegramAgent.getSessions().get('999888777');
      assert.strictEqual(sessionAfterDeal.activeProjectKey, 'portal-gsi', 'Deve selecionar portal-gsi automaticamente');
      assert.ok(sessionAfterDeal.pendingDealAuthorization, 'Deve salvar pendingDealAuthorization na sessão');

      assert.strictEqual(telegramSentMessages.length, 1);
      const sentCard = telegramSentMessages[0];
      assert.strictEqual(sentCard.text.includes('Deal #26851'), true);
      const cardButtons = sentCard.reply_markup.inline_keyboard.flat();
      assert.strictEqual(cardButtons.some(b => b.callback_data === 'decide_deal:AUTORIZADO'), true);
      assert.strictEqual(cardButtons.some(b => b.callback_data === 'decide_deal:NAO_AUTORIZADO'), true);
      assert.strictEqual(cardButtons.some(b => b.callback_data === 'decide_deal:USE_TEXT_VALUES'), true);

      report('Mensagem de vendedor com link do Pipedrive analisa Deal #26851 direto sem pedir projeto', true);

      // -------------------------------------------------------------
      // Teste 9: Clique em decide_deal:USE_TEXT_VALUES recalcula com valores do texto (5 x 7.451,08 e 5 x 684,00)
      // -------------------------------------------------------------
      console.log('--- 9. Callback decide_deal:USE_TEXT_VALUES Recalcula c/ Valores do Texto ---');
      telegramSentMessages.length = 0;

      const resRecalc = await request(
        baseUrl,
        'POST',
        '/api/telegram/webhook',
        { 'x-telegram-bot-api-secret-token': 'super_secret_webhook_token_2026' },
        {
          callback_query: {
            id: 'cbq_recalc_26851',
            from: { id: 999888777 },
            message: { chat: { id: 999888777 } },
            data: 'decide_deal:USE_TEXT_VALUES'
          }
        }
      );

      assert.strictEqual(resRecalc.status, 200);
      assert.strictEqual(resRecalc.body.ok, true);
      assert.strictEqual(resRecalc.body.action, 'deal_analyzed');
      assert.strictEqual(resRecalc.body.usedTextValues, true);
      assert.strictEqual(lastAnalisarCallOptions.proposta, 37255.40, '5 x 7.451,08 = 37.255,40');
      assert.strictEqual(lastAnalisarCallOptions.freteEmbutidoOverride, 3420.00, '5 x 684,00 = 3.420,00');
      assert.strictEqual(resRecalc.body.analise.descontoPct, 15.08, 'Desconto ponderado deve ser 15,08%');
      assert.strictEqual(resRecalc.body.analise.margemPct, 40.86, 'Margem bruta deve ser 40,86%');

      report('decide_deal:USE_TEXT_VALUES recalcula com proposta R$ 37.255,40 e frete R$ 3.420,00 (Desc: 15,08%, Margem: 40,86%)', true);

      // -------------------------------------------------------------
      // Teste 10: Clique em decide_deal:AUTORIZADO fixa nota no Pipedrive e grava no banco
      // -------------------------------------------------------------
      console.log('--- 10. Callback decide_deal:AUTORIZADO Grava Nota no Pipedrive e Persiste no Banco ---');
      telegramSentMessages.length = 0;

      const resAuth = await request(
        baseUrl,
        'POST',
        '/api/telegram/webhook',
        { 'x-telegram-bot-api-secret-token': 'super_secret_webhook_token_2026' },
        {
          callback_query: {
            id: 'cbq_auth_26851',
            from: { id: 999888777 },
            message: { chat: { id: 999888777 } },
            data: 'decide_deal:AUTORIZADO'
          }
        }
      );

      assert.strictEqual(resAuth.status, 200);
      assert.strictEqual(resAuth.body.ok, true);
      assert.strictEqual(resAuth.body.action, 'deal_decided');
      assert.strictEqual(resAuth.body.decision, 'AUTORIZADO');
      assert.strictEqual(resAuth.body.notaPipedriveEnviada, true);
      assert.strictEqual(
        resAuth.body.nota,
        'Deal 26851 | Desconto Medio Ponderado do Pedido: 15,08% | Forma de Pagamento: 028-1X BOL 28 D | Frete Embutido: R$ 3.420,00 | Total dos produtos com desconto 37.255,40 - ok autorizado'
      );

      assert.strictEqual(gravarNotaCalls.length, 1, 'Deve chamar gravarNotaPipedrive 1 vez');
      assert.strictEqual(gravarNotaCalls[0].dealId, 26851);
      assert.strictEqual(saveDbCalls.length, 1, 'Deve chamar saveAutorizacaoDescontoDB 1 vez');
      assert.strictEqual(saveDbCalls[0].status, 'AUTORIZADO');
      assert.strictEqual(saveDbCalls[0].valorTotal, 37255.40);
      assert.strictEqual(saveDbCalls[0].freteEmbutido, 3420.00);
      assert.strictEqual(sessionAfterDeal.pendingDealAuthorization, null, 'Deve limpar pendingDealAuthorization após decisão');

      report('decide_deal:AUTORIZADO grava nota oficial no Pipedrive, salva no banco e confirma no Telegram', true);

      // -------------------------------------------------------------
      // Teste 11: Sanitização Markdown (* e _), Fallback HTTP 400 e Resiliência de Banco / Duplo Clique
      // -------------------------------------------------------------
      console.log('--- 11. Sanitização Markdown (* e _), Fallback HTTP 400 e Resiliência de Banco ---');
      telegramSentMessages.length = 0;
      gravarNotaCalls.length = 0;

      assert.strictEqual(
        telegramAgent.escapeTelegramMarkdown('ARMARIO_ACO 200*100*45 [AZUL]'),
        'ARMARIO\\_ACO 200\\*100\\*45 \\[AZUL]'
      );

      let simulatedMarkdown400Once = false;
      telegramAgent.setFetchImpl(async (url, opts = {}) => {
        if (url.includes('api.telegram.org') && url.endsWith('/sendMessage')) {
          const body = JSON.parse(opts.body);
          if (body.parse_mode === 'Markdown' && !simulatedMarkdown400Once) {
            simulatedMarkdown400Once = true;
            return createJsonResponse(400, { ok: false, description: "Bad Request: can't parse entities" });
          }
          telegramSentMessages.push(body);
          return createJsonResponse(200, { ok: true });
        }
        return createJsonResponse(200, { ok: true });
      });

      telegramAgent.setAutorizacoesDeps({
        analisarDealCompleto: async (dealIdInput) => ({
          dealId: Number(dealIdInput),
          dealTitle: 'Deal 26900',
          clienteNome: 'METAL_PLENO * MATRIZ',
          solicitanteNome: 'Vendedor_1',
          dealStatus: 'open',
          condPgtoOptionId: 28,
          condPgtoLabel: '028-1X_BOL*28D',
          tipoFrete: 'FOB (Cliente)',
          freteEmbutido: 0,
          isRevenda: false,
          hasItensSemCusto: false,
          isAlertaDesconto: false,
          isValorPropostoCustom: false,
          valorVendaOriginalPipedrive: 5000,
          valorVendaFinal: 5000,
          precoUnitarioAutorizadoMedio: 5000,
          totalQuantidade: 1,
          precoTabelaTotal: 5000,
          custoTotal: 2500,
          valorLiquido: 5000,
          descontoReais: 0,
          descontoPct: 0,
          lucroBruto: 2500,
          margemPct: 50,
          itens: [
            {
              productId: 1,
              rawCode: '15-001',
              protheusCode: '001',
              nomePipedrive: 'ARMARIO_ACO 200*100*45',
              descricaoProtheus: 'ARMARIO_ACO 200*100*45',
              quantidade: 1,
              precoUnitarioDeal: 5000,
              precoUnitarioTabela: 5000,
              custoUnitario: 2500,
              totalDeal: 5000,
              totalTabela: 5000,
              totalCusto: 2500,
              encontradoProtheus: true
            }
          ],
          fraseAutorizacao: 'Deal 26900 | Desconto Medio Ponderado do Pedido: 0,00% - ok autorizado',
          fraseNaoAutorizado: 'Deal 26900 | Desconto Medio Ponderado do Pedido: 0,00% - NAO AUTORIZADO'
        }),
        gravarNotaPipedrive: async (dealId, nota) => {
          gravarNotaCalls.push({ dealId, nota });
          return { success: true };
        },
        saveAutorizacaoDescontoDB: async () => {
          throw new Error('Timeout simulado no banco PostgreSQL');
        }
      });

      const resEdgeAnalyze = await request(
        baseUrl,
        'POST',
        '/api/telegram/webhook',
        { 'x-telegram-bot-api-secret-token': 'super_secret_webhook_token_2026' },
        {
          message: {
            chat: { id: 999888777 },
            from: { id: 999888777 },
            text: 'https://benetroncomercial.pipedrive.com/deal/26900'
          }
        }
      );

      assert.strictEqual(resEdgeAnalyze.status, 200);
      assert.strictEqual(simulatedMarkdown400Once, true, 'Deve ter acionado o fallback sem parse_mode após HTTP 400');
      assert.strictEqual(telegramSentMessages.length, 1, 'Mensagem deve ser entregue via fallback sem perda');
      assert.strictEqual(telegramSentMessages[0].parse_mode, undefined, 'Fallback envia sem parse_mode');
      assert.strictEqual(telegramSentMessages[0].text.includes('ARMARIO\\_ACO 200\\*100\\*45'), true);

      // Decisão mesmo com falha no banco não deve lançar erro nem duplicar nota no Pipedrive em duplo clique
      const resEdgeDecide1 = await request(
        baseUrl,
        'POST',
        '/api/telegram/webhook',
        { 'x-telegram-bot-api-secret-token': 'super_secret_webhook_token_2026' },
        {
          callback_query: {
            id: 'cbq_edge_1',
            from: { id: 999888777 },
            message: { chat: { id: 999888777 } },
            data: 'decide_deal:AUTORIZADO'
          }
        }
      );

      assert.strictEqual(resEdgeDecide1.status, 200);
      assert.strictEqual(resEdgeDecide1.body.ok, true);
      assert.strictEqual(resEdgeDecide1.body.notaPipedriveEnviada, true);
      assert.strictEqual(resEdgeDecide1.body.savedInDb, false);
      assert.strictEqual(gravarNotaCalls.length, 1);

      // Segundo clique consecutivo não deve gravar segunda nota no Pipedrive
      const resEdgeDecide2 = await request(
        baseUrl,
        'POST',
        '/api/telegram/webhook',
        { 'x-telegram-bot-api-secret-token': 'super_secret_webhook_token_2026' },
        {
          callback_query: {
            id: 'cbq_edge_2',
            from: { id: 999888777 },
            message: { chat: { id: 999888777 } },
            data: 'decide_deal:AUTORIZADO'
          }
        }
      );

      assert.strictEqual(resEdgeDecide2.status, 200);
      assert.strictEqual(resEdgeDecide2.body.ok, false);
      assert.strictEqual(gravarNotaCalls.length, 1, 'Não pode duplicar nota no Pipedrive em duplo clique');

      report('Sanitização Markdown, fallback HTTP 400, resiliência de falha DB e proteção contra duplo clique', true);
    } catch (err) {
      report('Fluxo de Autorização de Desconto via Telegram (Testes 8-11)', false, err.message);
    }
  } finally {
    telegramAgent.setFetchImpl(null);
    telegramAgent.setAutorizacoesDeps(null);
    await new Promise(resolve => server.close(resolve));
  }

  console.log('\n=============================================================');
  console.log(`📊 RESULTADO FINAL: ${passedTests} aprovados, ${failedTests} falharam`);
  console.log('=============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTelegramAgentTests().catch(err => {
  console.error('❌ Erro fatal na execução dos testes:', err);
  process.exit(1);
});
