/**
 * routes/telegram_agent.js
 *
 * Agente Mobile Multi-Projeto 24/7 via Telegram (DevOps & Inspeção Remota)
 * Opera no servidor 24/7 (Render Starter) utilizando apenas recursos nativos do Node.js:
 * - Express Router, fs, path, crypto, fetch nativo com AbortController (timeout 12000ms).
 * - Segurança Zero-Trust: Validação de x-telegram-bot-api-secret-token (timingSafeEqual)
 *   e whitelist estrita de TELEGRAM_ALLOWED_CHAT_ID.
 * - Seleção obrigatória de projeto ("Sobre qual projeto você quer tratar?") com memória de
 *   pergunta pendente (pendingQuestion) e aprovação humana para commits (pendingPatch).
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  analisarDealCompleto,
  formatarNotaPipedrive,
  gravarNotaPipedrive,
  extrairDadosMensagemVendedor,
  normalizarValorNumerico
} = require('../bi_autorizacoes_engine');
const { saveAutorizacaoDescontoDB } = require('../postgres_db');

const PROMPT_FILE_PATH = path.join(__dirname, '..', 'prompts', 'telegram_devops_agent.v1.md');
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutos
const DEFAULT_FETCH_TIMEOUT_MS = 12000;
const MAX_FILE_CHARS = 12000;
const MAX_TOOL_ITERATIONS = 4;

/**
 * Catálogo Canônico dos 5 Projetos do Ecossistema GSI
 */
const PROJECTS = {
  'portal-gsi': {
    key: 'portal-gsi',
    label: '🏢 Portal GSI',
    repo: 'cofresgoldsafe/conciliacao-fretes',
    branch: 'main'
  },
  'assistencia': {
    key: 'assistencia',
    label: '🔧 Assistência Técnica',
    repo: 'cofresgoldsafe/gsi-assistencia-portal',
    branch: 'main'
  },
  'leilao': {
    key: 'leilao',
    label: '🏠 Leilão de Imóveis',
    repo: 'cofresgoldsafe/gemini-leilao-imoveis',
    branch: 'main'
  },
  'whatsapp': {
    key: 'whatsapp',
    label: '💬 WhatsApp Multi360',
    repo: 'cofresgoldsafe/gemini-whatsapp-multi360',
    branch: 'main'
  },
  'loja-pipedrive': {
    key: 'loja-pipedrive',
    label: '🛒 Loja x Pipedrive',
    repo: 'cofresgoldsafe/integracao-loja-pipedrive',
    branch: 'main'
  }
};

/**
 * Armazenamento em memória das sessões por chatId com TTL de 30 minutos
 */
const sessions = new Map();

/**
 * Implementação de fetch e dependências de autorização injetáveis para testes automatizados
 */
let currentFetchImpl = global.fetch;

const defaultAutorizacoesDeps = {
  analisarDealCompleto,
  gravarNotaPipedrive,
  saveAutorizacaoDescontoDB
};
let autorizacoesDeps = { ...defaultAutorizacoesDeps };

function setFetchImpl(fn) {
  currentFetchImpl = typeof fn === 'function' ? fn : global.fetch;
}

function setAutorizacoesDeps(customDeps) {
  if (!customDeps) {
    autorizacoesDeps = { ...defaultAutorizacoesDeps };
    return;
  }
  autorizacoesDeps = {
    ...defaultAutorizacoesDeps,
    ...customDeps
  };
}

function resetSessions() {
  sessions.clear();
}

function getSessions() {
  return sessions;
}

/**
 * Executa requisição HTTP usando fetch nativo (ou mock injetado) com AbortController e timeout de 12000ms
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fetchFn = currentFetchImpl || global.fetch;
    const response = await fetchFn(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Carrega o prompt desacoplado em UTF-8
 */
function loadSystemPrompt() {
  try {
    if (fs.existsSync(PROMPT_FILE_PATH)) {
      return fs.readFileSync(PROMPT_FILE_PATH, 'utf-8');
    }
  } catch (err) {
    console.warn('⚠️ [Telegram Agent] Falha ao ler prompt desacoplado:', err.message);
  }
  return 'Você é o Agente DevOps Mobile 24/7 do Grupo GSI. Responda de forma curta e objetiva em UTF-8.';
}

/**
 * Guardrail Zero-Trust: Bloqueia leitura ou edição de arquivos sensíveis e certificados
 */
function isSensitiveFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return true;
  const normalized = filePath.trim().replace(/\\/g, '/').toLowerCase();
  if (!normalized || normalized.includes('..')) return true;

  const segments = normalized.split('/').filter(Boolean);
  const baseName = segments[segments.length - 1] || '';

  // Bloqueio de arquivos .env e variantes
  if (
    baseName === '.env' ||
    baseName.startsWith('.env.') ||
    baseName.endsWith('.env')
  ) {
    return true;
  }

  // Bloqueio de extensões de chaves privadas e certificados
  const forbiddenExtensions = ['.pem', '.key', '.crt', '.pfx', '.p12', '.jks'];
  if (forbiddenExtensions.some(ext => baseName.endsWith(ext))) {
    return true;
  }

  // Bloqueio de nomes e pastas sensíveis de credenciais/segredos
  const forbiddenKeywords = ['id_rsa', 'id_ed25519', 'credentials', 'secrets', '.git'];
  for (const seg of segments) {
    if (
       forbiddenKeywords.includes(seg) ||
      seg.includes('credentials') ||
      seg.includes('secret') ||
      seg.includes('id_rsa')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Gera preview conciso de diff para leitura mobile no Telegram
 */
function generateUnifiedDiffPreview(filePath, originalContent, newContent, target, replacement) {
  const cleanTarget = String(target || '').trim();
  const cleanReplacement = String(replacement || '').trim();

  const removedLines = cleanTarget
    .split(/\r?\n/)
    .slice(0, 12)
    .map(l => `- ${l}`)
    .join('\n');

  const addedLines = cleanReplacement
    .split(/\r?\n/)
    .slice(0, 12)
    .map(l => `+ ${l}`)
    .join('\n');

  const preview = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    removedLines,
    addedLines
  ].join('\n');

  return preview.length > 1800 ? preview.slice(0, 1800) + '\n... [diff truncado]' : preview;
}

/**
 * Obtém ou cria sessão com expiração automática de 30 minutos
 */
function getOrCreateSession(chatId) {
  const key = String(chatId);
  const now = Date.now();
  const existing = sessions.get(key);

  if (existing && (now - existing.updatedAt) < SESSION_TTL_MS) {
    existing.updatedAt = now;
    return existing;
  }

  const fresh = {
    chatId: key,
    activeProjectKey: null,
    pendingQuestion: null,
    pendingPatch: null,
    pendingDealAuthorization: null,
    history: [],
    updatedAt: now
  };
  sessions.set(key, fresh);
  return fresh;
}

/**
 * Validação em tempo constante do header x-telegram-bot-api-secret-token
 */
function validateWebhookSecret(req) {
  const configuredSecret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (!configuredSecret) return true;

  const provided = String(req.headers['x-telegram-bot-api-secret-token'] || '').trim();
  if (!provided) return false;

  const bufExpected = Buffer.from(configuredSecret, 'utf-8');
  const bufProvided = Buffer.from(provided, 'utf-8');
  if (bufExpected.length !== bufProvided.length) return false;

  return crypto.timingSafeEqual(bufExpected, bufProvided);
}

/**
 * Valida se o chatId ou userId está autorizado em TELEGRAM_ALLOWED_CHAT_ID
 */
function isAllowedTelegramChat(chatId, userId) {
  const rawAllowed = (process.env.TELEGRAM_ALLOWED_CHAT_ID || '').trim();
  if (!rawAllowed) return false;

  const allowedList = rawAllowed
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  if (allowedList.length === 0) return false;

  const chatStr = chatId !== undefined && chatId !== null ? String(chatId).trim() : '';
  const userStr = userId !== undefined && userId !== null ? String(userId).trim() : '';

  return (chatStr && allowedList.includes(chatStr)) || (userStr && allowedList.includes(userStr));
}

/**
 * Escapa caracteres especiais do Markdown v1 do Telegram em textos dinâmicos externos
 */
function escapeTelegramMarkdown(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/([_*`\[])/g, '\\$1');
}

/**
 * Envia mensagem para o Telegram via Bot API (com fallback sem parse_mode se o Markdown falhar)
 */
async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    return { ok: false, skipped: true, reason: 'TELEGRAM_BOT_TOKEN not set' };
  }

  const safeText = String(text || '').slice(0, 4000);
  const payload = {
    chat_id: chatId,
    text: safeText,
    parse_mode: 'Markdown'
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    let res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      // Fallback resiliente: reenvia em texto puro (sem parse_mode) para jamais perder a mensagem
      const fallbackPayload = {
        chat_id: chatId,
        text: safeText
      };
      if (replyMarkup) {
        fallbackPayload.reply_markup = replyMarkup;
      }
      res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(fallbackPayload)
      });
    }

    const data = await res.json().catch(() => ({}));
    return data;
  } catch (err) {
    console.warn('⚠️ [Telegram Agent] Erro ao enviar mensagem ao Telegram:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Responde callback_query do Telegram para remover o loading do botão
 */
async function answerTelegramCallback(callbackQueryId, text = '') {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token || !callbackQueryId) return;

  const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
  try {
    await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text ? String(text).slice(0, 180) : undefined
      })
    });
  } catch (_) {}
}

/**
 * Monta o teclado inline com os 5 projetos
 */
function buildProjectSelectionKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: PROJECTS['portal-gsi'].label, callback_data: 'select_project:portal-gsi' },
        { text: PROJECTS['assistencia'].label, callback_data: 'select_project:assistencia' }
      ],
      [
        { text: PROJECTS['leilao'].label, callback_data: 'select_project:leilao' },
        { text: PROJECTS['whatsapp'].label, callback_data: 'select_project:whatsapp' }
      ],
      [
        { text: PROJECTS['loja-pipedrive'].label, callback_data: 'select_project:loja-pipedrive' }
      ]
    ]
  };
}

/**
 * Envia o menu "Sobre qual projeto você quer tratar agora?"
 */
async function promptProjectSelection(chatId) {
  const msg = '📱 *Sobre qual projeto você quer tratar agora?*\nEscolha uma opção abaixo:';
  const keyboard = buildProjectSelectionKeyboard();
  await sendTelegramMessage(chatId, msg, keyboard);
  return { message: msg, reply_markup: keyboard };
}

/**
 * Helper de cabeçalhos para a API REST do GitHub
 */
function getGithubHeaders() {
  const pat = (process.env.GITHUB_PAT || '').trim();
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'GSI-Telegram-DevOps-Agent',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (pat) {
    headers['Authorization'] = `Bearer ${pat}`;
  }
  return headers;
}

/**
 * Tool 1: get_server_status
 */
async function toolGetServerStatus(session) {
  const mem = process.memoryUsage();
  const activeProj = session.activeProjectKey ? PROJECTS[session.activeProjectKey] : null;
  return {
    ok: true,
    status: 'ONLINE_24_7',
    nodeVersion: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    memoryMb: {
      rss: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10
    },
    activeProject: activeProj
      ? { key: activeProj.key, label: activeProj.label, repo: activeProj.repo, branch: activeProj.branch }
      : null,
    timestamp: new Date().toISOString()
  };
}

/**
 * Tool 2: list_repo_files
 */
async function toolListRepoFiles(session, args = {}) {
  const project = PROJECTS[session.activeProjectKey];
  if (!project) {
    return { ok: false, error: 'Nenhum projeto selecionado na sessão.' };
  }

  const rawPath = String(args.path || '').trim().replace(/^\/+|\/+$/g, '');
  if (rawPath && isSensitiveFilePath(rawPath)) {
    return { ok: false, error: `Acesso bloqueado por segurança Zero-Trust ao caminho sensível: ${rawPath}` };
  }

  const encodedPath = rawPath
    ? rawPath.split('/').map(encodeURIComponent).join('/')
    : '';
  const url = `https://api.github.com/repos/${project.repo}/contents/${encodedPath}?ref=${encodeURIComponent(project.branch)}`;

  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: getGithubHeaders()
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: `Falha ao listar diretório no GitHub (${res.status}): ${errText.slice(0, 200)}` };
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    return {
      ok: true,
      repo: project.repo,
      path: rawPath || '/',
      items: [{ name: data.name, path: data.path, type: data.type, size: data.size }]
    };
  }

  const items = data
    .filter(item => !isSensitiveFilePath(item.path || item.name))
    .slice(0, 80)
    .map(item => ({
      name: item.name,
      path: item.path,
      type: item.type,
      size: item.size || 0
    }));

  return {
    ok: true,
    repo: project.repo,
    branch: project.branch,
    path: rawPath || '/',
    totalListed: items.length,
    items
  };
}

/**
 * Tool 3: read_repo_file
 */
async function toolReadRepoFile(session, args = {}) {
  const project = PROJECTS[session.activeProjectKey];
  if (!project) {
    return { ok: false, error: 'Nenhum projeto selecionado na sessão.' };
  }

  const cleanPath = String(args.path || '').trim().replace(/^\/+/, '');
  if (!cleanPath || isSensitiveFilePath(cleanPath)) {
    return { ok: false, error: `Leitura bloqueada por segurança Zero-Trust: arquivo sensível ou inválido (${cleanPath || 'vazio'}).` };
  }

  const encodedPath = cleanPath.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${project.repo}/contents/${encodedPath}?ref=${encodeURIComponent(project.branch)}`;

  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: getGithubHeaders()
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: `Arquivo não encontrado ou erro no GitHub (${res.status}): ${errText.slice(0, 200)}` };
  }

  const fileData = await res.json();
  if (!fileData || typeof fileData.content !== 'string') {
    return { ok: false, error: 'O caminho informado não é um arquivo de texto válido.' };
  }

  const fullText = Buffer.from(fileData.content.replace(/\s/g, ''), 'base64').toString('utf-8');
  const allLines = fullText.split(/\r?\n/);
  const totalLines = allLines.length;

  const startLine = Math.max(1, parseInt(args.startLine, 10) || 1);
  const endLine = Math.min(totalLines, parseInt(args.endLine, 10) || Math.min(totalLines, startLine + 249));

  let slicedText = allLines.slice(startLine - 1, endLine).join('\n');
  let chunkNotice = null;

  if (slicedText.length > MAX_FILE_CHARS) {
    slicedText = slicedText.slice(0, MAX_FILE_CHARS);
    chunkNotice = `[Chunking Semântico: exibindo primeiros ${MAX_FILE_CHARS} caracteres das linhas ${startLine}-${endLine} de ${totalLines}. Use startLine/endLine para ler os próximos blocos.]`;
  } else if (endLine < totalLines || startLine > 1) {
    chunkNotice = `[Exibindo linhas ${startLine} a ${endLine} de ${totalLines}]`;
  }

  return {
    ok: true,
    repo: project.repo,
    path: cleanPath,
    sha: fileData.sha,
    totalLines,
    startLine,
    endLine,
    chunkNotice,
    content: slicedText
  };
}

/**
 * Tool 4: propose_file_edit
 */
async function toolProposeFileEdit(chatId, session, args = {}) {
  const project = PROJECTS[session.activeProjectKey];
  if (!project) {
    return { ok: false, error: 'Nenhum projeto selecionado na sessão.' };
  }

  const cleanPath = String(args.path || '').trim().replace(/^\/+/, '');
  const target = String(args.target || '');
  const replacement = String(args.replacement ?? '');
  const commitMessage = String(args.commitMessage || `chore(telegram): update ${cleanPath}`).trim();

  if (!cleanPath || isSensitiveFilePath(cleanPath)) {
    return { ok: false, error: `Edição bloqueada por segurança Zero-Trust: arquivo sensível (${cleanPath || 'vazio'}).` };
  }

  if (!target) {
    return { ok: false, error: 'O parâmetro target (trecho original a substituir) é obrigatório.' };
  }

  const encodedPath = cleanPath.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${project.repo}/contents/${encodedPath}?ref=${encodeURIComponent(project.branch)}`;

  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: getGithubHeaders()
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: `Não foi possível ler o arquivo no GitHub (${res.status}): ${errText.slice(0, 200)}` };
  }

  const fileData = await res.json();
  if (!fileData || typeof fileData.content !== 'string' || !fileData.sha) {
    return { ok: false, error: 'Resposta inválida do GitHub ao obter SHA e conteúdo do arquivo.' };
  }

  const originalContent = Buffer.from(fileData.content.replace(/\s/g, ''), 'base64').toString('utf-8');

  let newContent = null;
  if (originalContent.includes(target)) {
    newContent = originalContent.replace(target, replacement);
  } else {
    // Fallback com normalização CRLF -> LF
    const normOriginal = originalContent.replace(/\r\n/g, '\n');
    const normTarget = target.replace(/\r\n/g, '\n');
    if (normOriginal.includes(normTarget)) {
      newContent = normOriginal.replace(normTarget, replacement.replace(/\r\n/g, '\n'));
    }
  }

  if (newContent === null) {
    return {
      ok: false,
      error: `O trecho 'target' não foi encontrado em ${cleanPath}. Leia o arquivo com read_repo_file antes de propor a edição.`
    };
  }

  const diffPreview = generateUnifiedDiffPreview(cleanPath, originalContent, newContent, target, replacement);

  session.pendingPatch = {
    id: crypto.randomBytes(6).toString('hex'),
    projectKey: project.key,
    projectLabel: project.label,
    repo: project.repo,
    branch: project.branch,
    path: cleanPath,
    sha: fileData.sha,
    newContent,
    commitMessage,
    diffPreview,
    createdAt: Date.now()
  };

  const confirmationKeyboard = {
    inline_keyboard: [
      [
        { text: '✅ Comitar e Publicar', callback_data: 'confirm_patch' },
        { text: '❌ Cancelar', callback_data: 'cancel_patch' }
      ]
    ]
  };

  const previewMsg = [
    `🛠️ *Alteração Pronta para Revisão*`,
    `• *Projeto:* ${project.label} (\`${project.repo}\`)`,
    `• *Arquivo:* \`${cleanPath}\``,
    `• *Commit:* \`${commitMessage}\``,
    '',
    '```diff',
    diffPreview,
    '```',
    'Deseja comitar na branch `main` e acionar o deploy automático?'
  ].join('\n');

  await sendTelegramMessage(chatId, previewMsg, confirmationKeyboard);

  return {
    ok: true,
    status: 'pending_confirmation',
    repo: project.repo,
    path: cleanPath,
    commitMessage,
    diffPreview
  };
}

/**
 * Helper de formatação monetária BRL (1.234,56)
 */
function formatBRL(val) {
  return (parseFloat(val) || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Processa a análise de um Deal (Pipedrive + Protheus SB1090) e envia card interativo no Telegram
 */
async function handleDealAuthorizationMessage(chatId, session, text, parsedDealInfo, overrideWithTextValues = false) {
  if (!session.activeProjectKey || !PROJECTS[session.activeProjectKey]) {
    session.activeProjectKey = 'portal-gsi';
  }
  session.updatedAt = Date.now();

  try {
    const options = {};
    if (!overrideWithTextValues) {
      if (parsedDealInfo.propostaTotalExplicita !== null && parsedDealInfo.propostaTotalExplicita !== undefined) {
        options.proposta = parsedDealInfo.propostaTotalExplicita;
      }
    } else {
      const prevAnalise = session.pendingDealAuthorization && session.pendingDealAuthorization.dealId === parsedDealInfo.dealId
        ? session.pendingDealAuthorization.analise
        : null;
      const qty = parsedDealInfo.quantidadeTexto || (prevAnalise && prevAnalise.totalQuantidade) || 1;

      if (parsedDealInfo.propostaTotalExplicita !== null && parsedDealInfo.propostaTotalExplicita !== undefined) {
        options.proposta = parsedDealInfo.propostaTotalExplicita;
      } else if (parsedDealInfo.precoUnitarioComDesconto !== null && parsedDealInfo.precoUnitarioComDesconto !== undefined) {
        options.proposta = Number((parsedDealInfo.precoUnitarioComDesconto * qty).toFixed(2));
      }

      if (parsedDealInfo.freteValorTexto !== null && parsedDealInfo.freteValorTexto !== undefined) {
        options.freteEmbutidoOverride = parsedDealInfo.fretePorUnidade
          ? Number((parsedDealInfo.freteValorTexto * qty).toFixed(2))
          : Number(parsedDealInfo.freteValorTexto.toFixed(2));
      }

      if (parsedDealInfo.condicaoTexto && (!prevAnalise || prevAnalise.condPgtoLabel === 'Não informada')) {
        options.condPgtoLabelOverride = parsedDealInfo.condicaoTexto;
      }
    }

    const analise = await autorizacoesDeps.analisarDealCompleto(parsedDealInfo.dealId, options);

    const qty = parsedDealInfo.quantidadeTexto || analise.totalQuantidade || 1;
    const vendaTextoTotal = parsedDealInfo.propostaTotalExplicita !== null && parsedDealInfo.propostaTotalExplicita !== undefined
      ? Number(parsedDealInfo.propostaTotalExplicita.toFixed(2))
      : (parsedDealInfo.precoUnitarioComDesconto !== null && parsedDealInfo.precoUnitarioComDesconto !== undefined
        ? Number((parsedDealInfo.precoUnitarioComDesconto * qty).toFixed(2))
        : null);

    const freteTextoTotal = parsedDealInfo.freteValorTexto !== null && parsedDealInfo.freteValorTexto !== undefined
      ? Number(((parsedDealInfo.fretePorUnidade ? parsedDealInfo.freteValorTexto * qty : parsedDealInfo.freteValorTexto)).toFixed(2))
      : null;

    const hasVendaDivergence = vendaTextoTotal !== null && Math.abs(vendaTextoTotal - analise.valorVendaFinal) > 0.05;
    const hasFreteDivergence = freteTextoTotal !== null && Math.abs(freteTextoTotal - analise.freteEmbutido) > 0.05;
    const hasTextDivergence = hasVendaDivergence || hasFreteDivergence;

    session.pendingDealAuthorization = {
      dealId: analise.dealId,
      analise,
      parsedDealInfo,
      rawText: text,
      usedTextValues: Boolean(overrideWithTextValues),
      createdAt: Date.now()
    };

    const revendaBadge = analise.isRevenda ? ' 🏢 *(REVENDA)*' : '';
    const itensLines = (analise.itens || []).slice(0, 6).map(it => {
      const statusCusto = it.encontradoProtheus && it.custoUnitario > 0 ? `R$ ${formatBRL(it.custoUnitario)}` : '⚠️ S/ Custo';
      const safeDesc = escapeTelegramMarkdown(it.descricaoProtheus || it.nomePipedrive || '');
      const safeCode = String(it.protheusCode || it.rawCode || '').replace(/`/g, "'");
      return `• *${it.quantidade}x* ${safeDesc} (\`${safeCode}\`)\n  Deal: R$ ${formatBRL(it.precoUnitarioDeal)} | Tab: R$ ${formatBRL(it.precoUnitarioTabela)} | Custo: ${statusCusto}`;
    });

    const alertLines = [];
    if (overrideWithTextValues) {
      alertLines.push(`ℹ️ *Simulação ativa com os valores informados no texto do vendedor.*`);
    } else if (hasTextDivergence) {
      const divParts = [];
      if (hasVendaDivergence) {
        divParts.push(`Venda Texto: R$ ${formatBRL(vendaTextoTotal)} vs Pipedrive: R$ ${formatBRL(analise.valorVendaFinal)}`);
      }
      if (hasFreteDivergence) {
        divParts.push(`Frete Texto: R$ ${formatBRL(freteTextoTotal)} vs Pipedrive: R$ ${formatBRL(analise.freteEmbutido)}`);
      }
      alertLines.push(`⚠️ *Divergência Texto x Pipedrive:* ${divParts.join(' | ')}`);
    }
    if (analise.hasItensSemCusto) {
      alertLines.push(`⚠️ *Atenção:* Há item(ns) não localizado(s) ou com custo zero na SB1090.`);
    }
    if (analise.descontoPct > 11 && !analise.isRevenda) {
      alertLines.push(`🔴 *Fora da Alçada Comercial:* Desconto acima de 11% (${analise.descontoPct.toFixed(2).replace('.', ',')}%).`);
    }

    const safeCliente = escapeTelegramMarkdown(analise.clienteNome);
    const safeSolicitante = escapeTelegramMarkdown(analise.solicitanteNome);
    const safeCondPgto = escapeTelegramMarkdown(analise.condPgtoLabel);
    const safeFraseAutorizacao = String(analise.fraseAutorizacao || '').replace(/`/g, "'");

    const msgLines = [
      `🎯 *Análise de Desconto — Deal #${analise.dealId}*`,
      `• *Cliente:* ${safeCliente}${revendaBadge}`,
      `• *Vendedor:* ${safeSolicitante} | *Pagto:* ${safeCondPgto}`,
      '',
      `📦 *Itens (${analise.totalQuantidade} un):*`,
      ...itensLines,
      '',
      `💰 *Resumo Financeiro:*`,
      `• *Tabela Total:* R$ ${formatBRL(analise.precoTabelaTotal)}`,
      `• *Venda Final:* R$ ${formatBRL(analise.valorVendaFinal)} (Unit. Médio: R$ ${formatBRL(analise.precoUnitarioAutorizadoMedio)})`,
      `• *Frete (${analise.tipoFrete}):* R$ ${formatBRL(analise.freteEmbutido)}`,
      `• *Valor Líquido:* R$ ${formatBRL(analise.valorLiquido)} | *Custo Total:* R$ ${formatBRL(analise.custoTotal)}`,
      `• *Desconto Ponderado:* *${analise.descontoPct.toFixed(2).replace('.', ',')}%* (R$ ${formatBRL(analise.descontoReais)})`,
      `• *Lucro Bruto:* *R$ ${formatBRL(analise.lucroBruto)}* | *Margem Bruta:* *${analise.margemPct.toFixed(2).replace('.', ',')}%*`
    ];

    if (alertLines.length > 0) {
      msgLines.push('', ...alertLines);
    }

    msgLines.push(
      '',
      `📌 *Nota Oficial Pipedrive:*`,
      `\`${safeFraseAutorizacao}\``
    );

    const inlineKeyboardRows = [
      [
        { text: '✅ Autorizar no Pipedrive', callback_data: 'decide_deal:AUTORIZADO' },
        { text: '❌ Negar Desconto', callback_data: 'decide_deal:NAO_AUTORIZADO' }
      ]
    ];

    if (hasTextDivergence && !overrideWithTextValues) {
      inlineKeyboardRows.push([
        { text: '🔄 Recalcular c/ Valores do Texto', callback_data: 'decide_deal:USE_TEXT_VALUES' }
      ]);
    }

    inlineKeyboardRows.push([
      { text: '🗑️ Cancelar', callback_data: 'decide_deal:CANCEL' }
    ]);

    const replyMarkup = { inline_keyboard: inlineKeyboardRows };
    await sendTelegramMessage(chatId, msgLines.join('\n'), replyMarkup);

    return {
      ok: true,
      action: 'deal_analyzed',
      dealId: analise.dealId,
      usedTextValues: Boolean(overrideWithTextValues),
      hasTextDivergence,
      analise
    };
  } catch (err) {
    const safeErrMsg = String(err.message || 'Erro desconhecido').replace(/`/g, "'");
    const errMsg = `⚠️ *Erro ao analisar Deal #${parsedDealInfo.dealId}:*\n\`${safeErrMsg}\``;
    await sendTelegramMessage(chatId, errMsg);
    return {
      ok: false,
      action: 'deal_analysis_error',
      dealId: parsedDealInfo.dealId,
      error: err.message
    };
  }
}

/**
 * Registra a decisão executiva (AUTORIZADO ou NAO_AUTORIZADO) no Pipedrive e no PostgreSQL/Supabase
 */
async function confirmDealDecision(chatId, session, decisaoRaw) {
  const pending = session.pendingDealAuthorization;
  if (!pending || !pending.analise) {
    const msg = 'ℹ️ Não há nenhuma análise de Deal pendente nesta sessão. Envie o link ou número do Deal primeiro.';
    await sendTelegramMessage(chatId, msg);
    return { ok: false, error: 'No pending deal authorization' };
  }

  // Limpa imediatamente para prevenir duplo clique / retry do webhook gerando nota duplicada
  session.pendingDealAuthorization = null;

  const decisaoLimpa = String(decisaoRaw || '').trim().toUpperCase() === 'AUTORIZADO' ? 'AUTORIZADO' : 'NAO_AUTORIZADO';
  const isAutorizado = decisaoLimpa === 'AUTORIZADO';
  const { analise } = pending;

  const notaFormatada = formatarNotaPipedrive({
    dealId: analise.dealId,
    descontoPct: analise.descontoPct,
    condPgtoLabel: analise.condPgtoLabel,
    freteEmbutido: analise.freteEmbutido,
    valorTotal: analise.valorVendaFinal,
    autorizado: isAutorizado
  });

  let notaGravadaPipedrive = false;
  let erroPipedrive = null;
  try {
    await autorizacoesDeps.gravarNotaPipedrive(analise.dealId, notaFormatada);
    notaGravadaPipedrive = true;
  } catch (errNota) {
    erroPipedrive = errNota.message;
    console.warn(`⚠️ [Telegram Autorizações] Falha ao fixar nota no Pipedrive (${errNota.message}), salvando no banco...`);
  }

  let record = null;
  let savedInDb = false;
  let erroDb = null;
  try {
    record = await autorizacoesDeps.saveAutorizacaoDescontoDB({
      dealId: analise.dealId,
      solicitanteNome: analise.solicitanteNome,
      clienteNome: analise.clienteNome,
      valorTotal: analise.valorVendaFinal,
      precoUnitarioAutorizado: analise.precoUnitarioAutorizadoMedio,
      margemPct: analise.margemPct,
      lucroBruto: analise.lucroBruto,
      descontoPct: analise.descontoPct,
      descontoReais: analise.descontoReais,
      condPgtoLabel: analise.condPgtoLabel,
      tipoFrete: analise.tipoFrete,
      freteCliente: 0.00,
      freteEmbutido: analise.freteEmbutido,
      status: decisaoLimpa,
      usuarioDecisor: 'alexandre',
      usuarioDecisorNome: 'Alexandre (Telegram)',
      observacoes: pending.usedTextValues
        ? 'Aprovado via Bot Telegram (com valores do texto do vendedor)'
        : 'Decidido via Bot Telegram',
      notaPipedrive: notaFormatada,
      dadosCompletos: {
        analise,
        notaGravadaPipedrive,
        canal: 'TELEGRAM_BOT',
        decididoEm: new Date().toISOString()
      }
    });
    savedInDb = true;
  } catch (errDb) {
    erroDb = errDb.message;
    console.warn(`⚠️ [Telegram Autorizações] Falha ao salvar autorização no banco (${errDb.message}).`);
  }

  const statusEmoji = isAutorizado ? '✅ *DESCONTO AUTORIZADO*' : '❌ *DESCONTO NÃO AUTORIZADO*';
  const safeErroPipedrive = String(erroPipedrive || '').replace(/`/g, "'");
  const safeErroDb = String(erroDb || '').replace(/`/g, "'");

  let pipedriveStatus = '📌 Nota oficial fixada no Deal do Pipedrive e gravada no Portal GSI.';
  if (!notaGravadaPipedrive && savedInDb) {
    pipedriveStatus = `⚠️ Gravado no Portal GSI (Aviso Pipedrive: \`${safeErroPipedrive}\`).`;
  } else if (notaGravadaPipedrive && !savedInDb) {
    pipedriveStatus = `📌 Nota fixada no Pipedrive (⚠️ Aviso Banco: \`${safeErroDb}\`).`;
  } else if (!notaGravadaPipedrive && !savedInDb) {
    pipedriveStatus = `⚠️ Falha ao persistir no Pipedrive (\`${safeErroPipedrive}\`) e Banco (\`${safeErroDb}\`).`;
  }

  const safeClienteConfirm = escapeTelegramMarkdown(analise.clienteNome);
  const safeNotaBloco = String(notaFormatada || '').replace(/`/g, "'");

  const confirmMsg = [
    `${statusEmoji} — *Deal #${analise.dealId}*`,
    `• *Cliente:* ${safeClienteConfirm}`,
    `• *Desconto:* ${analise.descontoPct.toFixed(2).replace('.', ',')}% | *Margem:* ${analise.margemPct.toFixed(2).replace('.', ',')}% | *Lucro:* R$ ${formatBRL(analise.lucroBruto)}`,
    pipedriveStatus,
    '',
    '```',
    safeNotaBloco,
    '```'
  ].join('\n');

  await sendTelegramMessage(chatId, confirmMsg);

  return {
    ok: true,
    action: 'deal_decided',
    dealId: analise.dealId,
    decision: decisaoLimpa,
    nota: notaFormatada,
    notaPipedriveEnviada: notaGravadaPipedrive,
    savedInDb,
    autorizacao: record
  };
}

/**
 * Cancela a análise pendente de Deal
 */
async function cancelDealAuthorization(chatId, session) {
  const hadPending = Boolean(session.pendingDealAuthorization);
  const dealId = hadPending ? session.pendingDealAuthorization.dealId : null;
  session.pendingDealAuthorization = null;

  const msg = hadPending
    ? `🗑️ *Análise do Deal #${dealId} descartada.* Nenhuma nota foi enviada ao Pipedrive.`
    : 'ℹ️ Nenhuma análise de Deal pendente para cancelar.';

  await sendTelegramMessage(chatId, msg);
  return {
    ok: true,
    action: 'deal_cancelled',
    dealId
  };
}

/**
 * Tool 5: analyze_deal_discount
 */
async function toolAnalyzeDealDiscount(chatId, session, args = {}) {
  const dealId = parseInt(args.dealId, 10);
  if (!dealId || isNaN(dealId)) {
    return { ok: false, error: 'dealId numérico é obrigatório.' };
  }
  const parsedDealInfo = {
    dealId,
    quantidadeTexto: null,
    precoUnitarioComDesconto: null,
    precoOriginalUnitario: null,
    freteValorTexto: args.freteEmbutido !== undefined ? normalizarValorNumerico(args.freteEmbutido) : null,
    fretePorUnidade: false,
    propostaTotalExplicita: args.propostaTotal !== undefined ? normalizarValorNumerico(args.propostaTotal) : null,
    condicaoTexto: null
  };
  const override = parsedDealInfo.freteValorTexto !== null;
  return await handleDealAuthorizationMessage(chatId, session, `Deal ${dealId}`, parsedDealInfo, override);
}

/**
 * Declaração das Tools para o Gemini Function Calling
 */
const GEMINI_TOOLS_DECLARATION = [
  {
    functionDeclarations: [
      {
        name: 'get_server_status',
        description: 'Retorna o status operacional do servidor 24/7 (uptime, memória RAM, versão do Node e projeto ativo).'
      },
      {
        name: 'list_repo_files',
        description: 'Lista os arquivos e pastas de um diretório no repositório GitHub do projeto ativo.',
        parameters: {
          type: 'OBJECT',
          properties: {
            path: {
              type: 'STRING',
              description: 'Caminho do diretório no repositório (vazio ou "/" para a raiz).'
            }
          }
        }
      },
      {
        name: 'read_repo_file',
        description: 'Lê o conteúdo UTF-8 de um arquivo no repositório GitHub do projeto ativo.',
        parameters: {
          type: 'OBJECT',
          properties: {
            path: {
              type: 'STRING',
              description: 'Caminho completo do arquivo no repositório (ex: "server.js" ou "routes/pgtos_desconhecidos.js").'
            },
            startLine: {
              type: 'INTEGER',
              description: 'Linha inicial (1-indexed, opcional).'
            },
            endLine: {
              type: 'INTEGER',
              description: 'Linha final (inclusiva, opcional).'
            }
          },
          required: ['path']
        }
      },
      {
        name: 'propose_file_edit',
        description: 'Prepara uma alteração em um arquivo do repositório ativo e envia um preview de diff com botões de confirmação no Telegram.',
        parameters: {
          type: 'OBJECT',
          properties: {
            path: {
              type: 'STRING',
              description: 'Caminho do arquivo a ser editado no repositório.'
            },
            target: {
              type: 'STRING',
              description: 'Trecho exato atual que será substituído.'
            },
            replacement: {
              type: 'STRING',
              description: 'Novo trecho que substituirá o target.'
            },
            commitMessage: {
              type: 'STRING',
              description: 'Mensagem semântica do commit (ex: "fix: ajustar validação").'
            }
          },
          required: ['path', 'target', 'replacement', 'commitMessage']
        }
      },
      {
        name: 'analyze_deal_discount',
        description: 'Analisa um Deal do Pipedrive cruzando com o Protheus (SB1090/SA1010) para cálculo de desconto ponderado, lucro bruto e margem, enviando botões de Autorizar/Negar no Telegram.',
        parameters: {
          type: 'OBJECT',
          properties: {
            dealId: {
              type: 'INTEGER',
              description: 'ID numérico do Deal no Pipedrive (ex: 26851).'
            },
            propostaTotal: {
              type: 'NUMBER',
              description: 'Valor total proposto com desconto (opcional).'
            },
            freteEmbutido: {
              type: 'NUMBER',
              description: 'Valor total do frete CIF embutido pago pela empresa (opcional).'
            }
          },
          required: ['dealId']
        }
      }
    ]
  }
];

/**
 * Executa uma tool solicitada pelo modelo Gemini
 */
async function executeAgentTool(name, args, session, chatId) {
  switch (name) {
    case 'get_server_status':
      return await toolGetServerStatus(session);
    case 'list_repo_files':
      return await toolListRepoFiles(session, args);
    case 'read_repo_file':
      return await toolReadRepoFile(session, args);
    case 'propose_file_edit':
      return await toolProposeFileEdit(chatId, session, args);
    case 'analyze_deal_discount':
      return await toolAnalyzeDealDiscount(chatId, session, args);
    default:
      return { ok: false, error: `Tool desconhecida: ${name}` };
  }
}

/**
 * Chama a API Gemini (primário gemini-2.5-flash, fallback gemini-2.0-flash)
 */
async function callGeminiModel(contents, systemPrompt) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY não configurada no ambiente.');
  }

  const models = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash'];
  let lastError = null;

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }]
          },
          contents,
          tools: GEMINI_TOOLS_DECLARATION,
          generationConfig: {
            temperature: 0.2
          }
        })
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        lastError = new Error(`Gemini HTTP ${res.status} (${model}): ${errBody.slice(0, 200)}`);
        continue;
      }

      const data = await res.json();
      return data;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Falha ao comunicar com a API Gemini.');
}

/**
 * Processa a pergunta do usuário no contexto do projeto selecionado
 */
async function handleUserPrompt(chatId, session, userText) {
  const project = PROJECTS[session.activeProjectKey];
  const systemPrompt = [
    loadSystemPrompt(),
    '',
    `## Contexto da Sessão Atual`,
    `- Projeto Ativo: ${project.label} (key: ${project.key})`,
    `- Repositório GitHub: ${project.repo} (branch: ${project.branch})`
  ].join('\n');

  const contents = [
    ...session.history.slice(-6),
    {
      role: 'user',
      parts: [{ text: userText }]
    }
  ];

  let patchProposedInTurn = false;
  let finalReplyText = '';

  try {
    for (let step = 0; step < MAX_TOOL_ITERATIONS; step++) {
      let data;
      try {
        data = await callGeminiModel(contents, systemPrompt);
      } catch (errStep) {
        if (patchProposedInTurn) {
          // O preview do patch já foi enviado ao Telegram com botões; conclui graciosamente
          break;
        }
        throw errStep;
      }

      const candidate = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
      const modelContent = candidate && candidate.content ? candidate.content : null;
      const parts = modelContent && Array.isArray(modelContent.parts) ? modelContent.parts : [];

      if (parts.length === 0) {
        break;
      }

      const functionCalls = parts.filter(p => p && p.functionCall);
      if (functionCalls.length === 0) {
        finalReplyText = parts
          .map(p => p.text || '')
          .join('\n')
          .trim();
        break;
      }

      // Registra a chamada do modelo no histórico da rodada
      contents.push({
        role: 'model',
        parts
      });

      const responseParts = [];
      for (const fcPart of functionCalls) {
        const { name, args } = fcPart.functionCall;
        if (name === 'propose_file_edit') {
          patchProposedInTurn = true;
        }
        const toolResult = await executeAgentTool(name, args || {}, session, chatId);
        responseParts.push({
          functionResponse: {
            name,
            response: { result: toolResult }
          }
        });
      }

      contents.push({
        role: 'user',
        parts: responseParts
      });
    }
  } catch (err) {
    const errMsg = `⚠️ *Erro ao processar solicitação em ${project.label}:*\n\`${err.message}\``;
    await sendTelegramMessage(chatId, errMsg);
    return { ok: false, error: err.message };
  }

  // Atualiza histórico curto da sessão
  session.history.push(
    { role: 'user', parts: [{ text: userText }] },
    { role: 'model', parts: [{ text: finalReplyText || '[Ação executada via tool]' }] }
  );
  if (session.history.length > 10) {
    session.history = session.history.slice(-10);
  }

  if (finalReplyText && !patchProposedInTurn) {
    await sendTelegramMessage(chatId, finalReplyText);
  } else if (finalReplyText && patchProposedInTurn) {
    await sendTelegramMessage(chatId, finalReplyText);
  } else if (!finalReplyText && !patchProposedInTurn) {
    finalReplyText = `✅ Solicitação processada no projeto *${project.label}*.`;
    await sendTelegramMessage(chatId, finalReplyText);
  }

  return {
    ok: true,
    project: project.key,
    patchProposed: patchProposedInTurn,
    answer: finalReplyText
  };
}

/**
 * Confirma e publica o pendingPatch no GitHub via PUT /repos/{repo}/contents/{path}
 */
async function confirmPendingPatch(chatId, session) {
  const patch = session.pendingPatch;
  if (!patch) {
    const msg = 'ℹ️ Não há nenhuma alteração pendente para comitar nesta sessão.';
    await sendTelegramMessage(chatId, msg);
    return { ok: false, error: 'No pending patch' };
  }

  const encodedPath = patch.path.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${patch.repo}/contents/${encodedPath}`;

  try {
    const res = await fetchWithTimeout(url, {
      method: 'PUT',
      headers: {
        ...getGithubHeaders(),
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        message: patch.commitMessage,
        content: Buffer.from(patch.newContent, 'utf-8').toString('base64'),
        sha: patch.sha,
        branch: patch.branch
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const failMsg = `❌ *Falha ao publicar commit no GitHub (${res.status}):*\n\`${errText.slice(0, 250)}\``;
      await sendTelegramMessage(chatId, failMsg);
      return { ok: false, status: res.status, error: errText };
    }

    const data = await res.json();
    session.pendingPatch = null;

    const commitSha = (data && data.commit && data.commit.sha) ? data.commit.sha : 'unknown';
    const shortSha = commitSha.slice(0, 7);
    const commitUrl = (data && data.commit && data.commit.html_url)
      ? data.commit.html_url
      : `https://github.com/${patch.repo}/commit/${commitSha}`;

    const successMsg = [
      `🚀 *Commit Publicado com Sucesso!*`,
      `• *Projeto:* ${patch.projectLabel} (\`${patch.repo}\`)`,
      `• *Arquivo:* \`${patch.path}\``,
      `• *Hash:* [\`${shortSha}\`](${commitUrl})`,
      `• *Status:* Auto-deploy acionado na branch \`${patch.branch}\`.`
    ].join('\n');

    await sendTelegramMessage(chatId, successMsg);

    return {
      ok: true,
      action: 'patch_confirmed',
      repo: patch.repo,
      path: patch.path,
      commitSha,
      commitUrl
    };
  } catch (err) {
    const errMsg = `❌ *Erro de rede ao comitar no GitHub:*\n\`${err.message}\``;
    await sendTelegramMessage(chatId, errMsg);
    return { ok: false, error: err.message };
  }
}

/**
 * Cancela e descarta o pendingPatch
 */
async function cancelPendingPatch(chatId, session) {
  const hadPatch = Boolean(session.pendingPatch);
  const discardedPath = hadPatch ? session.pendingPatch.path : null;
  session.pendingPatch = null;

  const msg = hadPatch
    ? `🗑️ *Alteração descartada.* Nenhum commit foi realizado em \`${discardedPath}\`.`
    : 'ℹ️ Nenhuma alteração pendente para cancelar.';

  await sendTelegramMessage(chatId, msg);
  return {
    ok: true,
    action: 'patch_cancelled',
    discardedPath
  };
}

/**
 * ============================================================================
 * ROTAS REST DO AGENTE TELEGRAM
 * ============================================================================
 */

/**
 * GET /api/telegram/status
 * Diagnóstico seguro (retorna apenas booleans para variáveis sensíveis)
 */
router.get('/status', (req, res) => {
  const promptExists = fs.existsSync(PROMPT_FILE_PATH);
  return res.json({
    ok: true,
    service: 'telegram-devops-agent-24x7',
    configured: {
      TELEGRAM_BOT_TOKEN: Boolean((process.env.TELEGRAM_BOT_TOKEN || '').trim()),
      TELEGRAM_ALLOWED_CHAT_ID: Boolean((process.env.TELEGRAM_ALLOWED_CHAT_ID || '').trim()),
      TELEGRAM_WEBHOOK_SECRET: Boolean((process.env.TELEGRAM_WEBHOOK_SECRET || '').trim()),
      GEMINI_API_KEY: Boolean((process.env.GEMINI_API_KEY || '').trim()),
      GITHUB_PAT: Boolean((process.env.GITHUB_PAT || '').trim())
    },
    prompt: {
      path: 'prompts/telegram_devops_agent.v1.md',
      loaded: promptExists
    },
    projects: Object.values(PROJECTS),
    activeSessionsCount: sessions.size
  });
});

/**
 * POST /api/telegram/setup-webhook
 * Registra a URL do webhook na API do Telegram
 */
router.post('/setup-webhook', async (req, res) => {
  if (!validateWebhookSecret(req)) {
    return res.status(401).json({ ok: false, error: 'Invalid webhook secret token' });
  }

  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    return res.status(400).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN não configurado no servidor.' });
  }

  const webhookUrl = String((req.body && req.body.webhookUrl) || process.env.TELEGRAM_WEBHOOK_URL || 'https://conciliacao-fretes.onrender.com/api/telegram/webhook').trim();
  const secretToken = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();

  const payload = { url: webhookUrl };
  if (secretToken) {
    payload.secret_token = secretToken;
  }

  try {
    const tgRes = await fetchWithTimeout(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const tgData = await tgRes.json().catch(() => ({}));
    return res.status(tgRes.ok ? 200 : 502).json({
      ok: Boolean(tgData.ok),
      webhookUrl,
      telegramResponse: tgData
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/telegram/webhook
 * Recebe updates de mensagens e callback_queries do Telegram
 */
router.post('/webhook', async (req, res) => {
  // 1. Validação Zero-Trust do Secret Token
  if (!validateWebhookSecret(req)) {
    return res.status(401).json({ ok: false, error: 'Invalid webhook secret token' });
  }

  const update = req.body || {};
  const message = update.message || update.edited_message || null;
  const callbackQuery = update.callback_query || null;

  const chatId = message && message.chat
    ? message.chat.id
    : (callbackQuery && callbackQuery.message && callbackQuery.message.chat
      ? callbackQuery.message.chat.id
      : (callbackQuery && callbackQuery.from ? callbackQuery.from.id : null));

  const userId = message && message.from
    ? message.from.id
    : (callbackQuery && callbackQuery.from ? callbackQuery.from.id : null);

  // 2. Validação Zero-Trust da Whitelist TELEGRAM_ALLOWED_CHAT_ID
  if (!isAllowedTelegramChat(chatId, userId)) {
    return res.status(403).json({ ok: false, error: 'Unauthorized Telegram chat_id' });
  }

  const session = getOrCreateSession(chatId);

  // 3. Tratamento de cliques em botões Inline (callback_query)
  if (callbackQuery) {
    const data = String(callbackQuery.data || '').trim();
    await answerTelegramCallback(callbackQuery.id);

    if (data.startsWith('select_project:')) {
      const projectKey = data.slice('select_project:'.length).trim();
      const selectedProject = PROJECTS[projectKey];

      if (!selectedProject) {
        await sendTelegramMessage(chatId, '⚠️ Projeto inválido.');
        return res.json({ ok: false, error: 'Invalid project key' });
      }

      session.activeProjectKey = projectKey;
      session.updatedAt = Date.now();

      // Se havia uma pergunta guardada antes da escolha do projeto, responde imediatamente
      if (session.pendingQuestion) {
        const questionToRun = session.pendingQuestion;
        session.pendingQuestion = null;
        await sendTelegramMessage(chatId, `✅ Projeto selecionado: *${selectedProject.label}*\n⏳ Analisando sua solicitação: _"${questionToRun}"_...`);
        const result = await handleUserPrompt(chatId, session, questionToRun);
        return res.json({
          ok: true,
          action: 'project_selected_and_processed',
          project: projectKey,
          processedQuestion: questionToRun,
          result
        });
      }

      const confirmMsg = `✅ Projeto ativo definido para *${selectedProject.label}* (\`${selectedProject.repo}\`).\nO que você deseja consultar ou alterar neste projeto?`;
      await sendTelegramMessage(chatId, confirmMsg);
      return res.json({
        ok: true,
        action: 'project_selected',
        project: projectKey
      });
    }

    if (data === 'confirm_patch') {
      const confirmResult = await confirmPendingPatch(chatId, session);
      return res.json(confirmResult);
    }

    if (data === 'cancel_patch') {
      const cancelResult = await cancelPendingPatch(chatId, session);
      return res.json(cancelResult);
    }

    if (data.startsWith('decide_deal:')) {
      const subAction = data.slice('decide_deal:'.length).trim().toUpperCase();
      if (subAction === 'USE_TEXT_VALUES') {
        if (!session.pendingDealAuthorization || !session.pendingDealAuthorization.parsedDealInfo) {
          await sendTelegramMessage(chatId, 'ℹ️ Nenhuma análise de Deal pendente para recalcular.');
          return res.json({ ok: false, error: 'No pending deal authorization' });
        }
        const recalcRes = await handleDealAuthorizationMessage(
          chatId,
          session,
          session.pendingDealAuthorization.rawText || '',
          session.pendingDealAuthorization.parsedDealInfo,
          true
        );
        return res.json(recalcRes);
      }

      if (subAction === 'CANCEL') {
        const cancelDealRes = await cancelDealAuthorization(chatId, session);
        return res.json(cancelDealRes);
      }

      if (subAction === 'AUTORIZADO' || subAction === 'NAO_AUTORIZADO') {
        const decisionRes = await confirmDealDecision(chatId, session, subAction);
        return res.json(decisionRes);
      }
    }

    return res.json({ ok: true, action: 'unknown_callback' });
  }

  // 4. Tratamento de mensagens de texto
  if (message && typeof message.text === 'string') {
    const text = message.text.trim();
    const lower = text.toLowerCase();

    // Comandos explícitos de troca/seleção de projeto
    const isProjectSwitchCmd =
      lower === '/start' ||
      lower.startsWith('/start@') ||
      lower === '/projeto' ||
      lower.startsWith('/projeto@') ||
      lower === 'trocar projeto' ||
      lower === '/trocar';

    if (isProjectSwitchCmd) {
      session.activeProjectKey = null;
      session.pendingQuestion = null;
      const promptRes = await promptProjectSelection(chatId);
      return res.json({
        ok: true,
        action: 'ask_project',
        pendingQuestion: null,
        prompt: promptRes
      });
    }

    if (lower === '/cancelar' || lower === 'cancelar') {
      if (session.pendingDealAuthorization) {
        const cancelDealRes = await cancelDealAuthorization(chatId, session);
        return res.json(cancelDealRes);
      }
      const cancelResult = await cancelPendingPatch(chatId, session);
      return res.json(cancelResult);
    }

    // Atalho determinístico: Solicitação de Análise/Autorização de Desconto (Deal Pipedrive)
    const parsedDealInfo = extrairDadosMensagemVendedor(text);
    if (parsedDealInfo && parsedDealInfo.dealId) {
      const dealResult = await handleDealAuthorizationMessage(chatId, session, text, parsedDealInfo, false);
      return res.json(dealResult);
    }

    // Se ainda não há projeto selecionado na sessão, salva a pergunta e pergunta qual projeto
    if (!session.activeProjectKey || !PROJECTS[session.activeProjectKey]) {
      session.pendingQuestion = text;
      const promptRes = await promptProjectSelection(chatId);
      return res.json({
        ok: true,
        action: 'ask_project',
        pendingQuestion: session.pendingQuestion,
        prompt: promptRes
      });
    }

    // Processa a pergunta no projeto ativo
    const result = await handleUserPrompt(chatId, session, text);
    return res.json({
      ok: true,
      action: 'processed',
      project: session.activeProjectKey,
      result
    });
  }

  return res.json({ ok: true, action: 'ignored' });
});

// Anexa helpers exportados para testes unitários e de integração
router.PROJECTS = PROJECTS;
router.isSensitiveFilePath = isSensitiveFilePath;
router.escapeTelegramMarkdown = escapeTelegramMarkdown;
router.setFetchImpl = setFetchImpl;
router.setAutorizacoesDeps = setAutorizacoesDeps;
router.resetSessions = resetSessions;
router.getSessions = getSessions;
router.generateUnifiedDiffPreview = generateUnifiedDiffPreview;

module.exports = router;
