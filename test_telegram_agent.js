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
  } finally {
    telegramAgent.setFetchImpl(null);
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
