const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { execFile } = require('child_process');
const { safeWriteJsonSync, safeReadJsonSync } = require('./safe_json_storage');
const { validateWebhookPayload } = require('./webhook_validator');
const { 
  consultarProtheusNF, 
  buscarProtheusMultiEmpresa,
  buscarPedidosVendedores,
  buscarPedidosAbertosVendedores,
  buscarPedidosCompras,
  buscarPedidosProntosFaturar,
  buscarPedidosBloqueadosEstoque,
  buscarPedidosAnaliseLibEstoque,
  sincronizarSaldosEstoqueProtheus,
  consultarFaturamentoHistorico,
  sincronizarFaturamentoConsolidado,
  formatarDataProtheus,
  calcularStatusBloqueioEstoque,
  calcularStatusBloqueioCredito,
  detectarEnderecoEntregaDiferente,
  obterDetalhesPedido,
  buscarComissoesPeriodo,
  VENDEDORES_MAP,
  getNomeVendedor,
  EMPRESAS_FINANCEIRO,
  consultarSaldoSE8,
  consultarExtratoSE5,
  algoritmoMatchingConciliacao
} = require('./protheus_db');

const {
  CONTAS_INTER,
  getInterConfigStatus,
  consultarSaldoInter,
  consultarExtratoInter
} = require('./inter_api');

const {
  syncVippFtp,
  getVippIndex,
  getPostingByEtiqueta,
  getFtpStatus,
  enrichCorreiosItems
} = require('./vipp_ftp');

const {
  initPostgres,
  safeQuery,
  getUsers: getUsersDB,
  saveUser: saveUserDB,
  deleteUser: deleteUserDB,
  hashPassword,
  verifyPassword,
  create2FAToken,
  verify2FAToken,
  resend2FAToken,
  getHistory: getHistoryDB,
  saveHistoryItem: saveHistoryItemDB,
  logUserActivity,
  touchUserActivity,
  getAuditSummary,
  getDiagnosticInfo,
  saveInterWebhookEvent,
  getInterWebhookEvents,
  saveAnaliseCreditoDB,
  getHistoricoCreditoDB,
  saveSaldosEstoqueDB,
  getSaldosEstoqueDB,
  getUltimoSyncEstoqueLog,
  saveFaturamentoHistoricoDB,
  getFaturamentoHistoricoStats,
  getUltimoSyncFaturamentoLog,
  isPostgresConnected
} = require('./postgres_db');

const {
  send2FACodeEmail,
  maskEmail,
  isValidEmail,
  testSmtpConnection
} = require('./mailer');

const {
  getMetabaseConfigStatus,
  generateSignedDashboardUrl
} = require('./services/bi_service');

const {
  obterDadosIndicesCalculados,
  sincronizarIndicesCompleto,
  obterDetalhesIndicesDrilldown,
  obterHistoricoIndices
} = require('./bi_indices_engine');

const app = express();
app.set('trust proxy', 1); // Suporte para proxy reverso no Render

// Rate Limiter para rotas de autenticação (proteção contra brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 30, // máximo 30 tentativas por IP em 15 minutos
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      message: 'Muitas tentativas de login a partir deste IP. Por favor, tente novamente em alguns minutos.'
    });
  }
});

// Rate Limiter para Verificação de Código 2FA
const verify2FALimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 20, // máximo 20 tentativas por IP em 5 minutos
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      message: 'Muitas tentativas de validação 2FA a partir deste IP. Por favor, aguarde alguns instantes.'
    });
  }
});

// Rate Limiter para Reenvio de Código 2FA (anti-flooding de e-mail)
const resend2FALimiter = rateLimit({
  windowMs: 45 * 1000, // 45 segundos
  max: 2, // máximo 2 solicitações por IP em 45 segundos
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      message: 'Por favor, aguarde 45 segundos antes de solicitar um novo envio de código.'
    });
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';

const DEFAULT_VENDOR_CODES = {
  'juliana': '000074',
  'andrea': '000064',
  'figueiredo': '000004'
};

function getUserFromReq(req) {
  if (req.user && req.user.username) {
    const uName = String(req.user.username).toLowerCase().trim();
    const uRole = req.user.role || 'user';
    const vCode = req.user.vendorCode || (uRole === 'vendedor' ? (DEFAULT_VENDOR_CODES[uName] || null) : null);
    return { 
      username: uName, 
      name: String(req.user.name || req.user.username).trim(),
      role: uRole,
      permissions: req.user.permissions || [],
      vendorCode: vCode
    };
  }
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
      if (decoded && decoded.username) {
        const uName = String(decoded.username).toLowerCase().trim();
        const uRole = decoded.role || 'user';
        const vCode = decoded.vendorCode || (uRole === 'vendedor' ? (DEFAULT_VENDOR_CODES[uName] || null) : null);
        return {
          username: uName,
          name: String(decoded.name || decoded.username).trim(),
          role: uRole,
          permissions: decoded.permissions || [],
          vendorCode: vCode
        };
      }
    } catch {}
  }
  return { 
    username: 'sistema', 
    name: 'Sistema',
    role: 'anonymous',
    permissions: [],
    vendorCode: null
  };
}

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.startsWith('Bearer ')) 
    ? authHeader.slice(7) 
    : (req.headers['x-auth-token'] || req.query.token);

  if (!token) {
    return res.status(401).json({ success: false, message: 'Autenticação necessária. Faça login para continuar.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Sessão expirada ou token inválido.' });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.role || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Acesso negado. Privilégios insuficientes.' });
    }
    next();
  };
}

function handleServerError(res, err, defaultMsg = 'Ocorreu um erro interno ao processar a solicitação.') {
  console.error('❌ [Server Error]:', err);
  return res.status(500).json({
    success: false,
    message: defaultMsg,
    error: process.env.NODE_ENV === 'development' ? (err.message || String(err)) : defaultMsg
  });
}

// Configuração de Origens Permitidas (CORS) com suporte a Subdomínio Personalizado e Render
const envCustomDomain = (process.env.CUSTOM_DOMAIN || '').trim();
const envAllowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const allowedOrigins = [
  'https://conciliacao-fretes.onrender.com',
  'https://portal.gsicofres.com.br',
  'http://portal.gsicofres.com.br',
  'https://conciliacao.gsicofres.com.br',
  'https://portal.gsi.com.br',
  'http://portal.gsi.com.br',
  'https://conciliacao.gsi.com.br',
  'https://portal.oaco.com.br',
  'https://conciliacao.oaco.com.br',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  ...(envCustomDomain ? [`https://${envCustomDomain.replace(/^https?:\/\//, '')}`, `http://${envCustomDomain.replace(/^https?:\/\//, '')}`] : []),
  ...envAllowedOrigins
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    const isAllowed = 
      allowedOrigins.includes(origin) ||
      origin.endsWith('.onrender.com') ||
      origin.endsWith('.gsicofres.com.br') ||
      origin.endsWith('.gsi.com.br') ||
      origin.endsWith('.oaco.com.br') ||
      (envCustomDomain && origin.includes(envCustomDomain.replace(/^https?:\/\//, '')));

    if (isAllowed) {
      return callback(null, true);
    }
    
    console.warn(`⚠️ [CORS] Origem não explicitamente autorizada: ${origin}`);
    return callback(null, true); // Fallback permissivo com aviso em log
  },
  credentials: true
}));
app.use(express.json());

// Documentação OpenAPI 3.0 & Swagger UI
try {
  const swaggerUi = require('swagger-ui-express');
  const openApiSpec = require('./openapi.json');
  app.use(['/api-docs', '/api/docs'], swaggerUi.serve, swaggerUi.setup(openApiSpec));
  app.get('/api/openapi.json', (req, res) => res.json(openApiSpec));
} catch (errSwagger) {
  console.warn('⚠️ [Swagger UI] Não foi possível carregar swagger-ui-express:', errSwagger.message);
}

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0
}));

// Configure uploads and data directories
const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
const vippConfigFile = path.join(dataDir, 'vipp_config.json');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function getVippConfig() {
  const loaded = safeReadJsonSync(vippConfigFile, null);
  if (loaded && typeof loaded === 'object') {
    return loaded;
  }
  return {
    usuario: process.env.VIPP_USUARIO || 'financeiro@oaco.com.br',
    token: process.env.VIPP_TOKEN || '',
    idPerfil: process.env.VIPP_ID_PERFIL || '179551',
    contrato: process.env.VIPP_CONTRATO || '9912742673',
    ativo: !!process.env.VIPP_TOKEN
  };
}

function saveVippConfig(cfg) {
  safeWriteJsonSync(vippConfigFile, cfg);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 15 * 1024 * 1024 // Limite máximo de 15MB
  },
  fileFilter: function (req, file, cb) {
    const allowedExts = ['.pdf', '.csv', '.txt', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não permitido. Envie apenas PDF, CSV, TXT ou XLSX.'));
    }
  }
});

// Storage em memória para arquivos efêmeros que NÃO são gravados no disco (ex: laudos Serasa PDF)
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // Limite de 10MB
  },
  fileFilter: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Formato inválido. Apenas arquivos .pdf são aceitos para leitura do laudo Serasa.'));
    }
  }
});

function runPythonParser(scriptName, filePath) {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, scriptName);
    // Suporte multiplataforma (Windows: python | Linux/Docker: python3)
    const pythonBin = process.platform === 'win32' ? 'python' : 'python3';

    execFile(pythonBin, [pythonScript, filePath], (error, stdout, stderr) => {
      if (error) {
        console.error(`Exec Error with ${pythonBin}:`, error, stderr);
        // Tenta fallback para 'python' se python3 falhar
        if (pythonBin === 'python3') {
          return execFile('python', [pythonScript, filePath], (err2, out2, errOut2) => {
            if (err2) return reject(err2);
            try {
              resolve(JSON.parse(out2));
            } catch (e) {
              reject(new Error('Falha ao ler saída: ' + out2));
            }
          });
        }
        return reject(error);
      }
      try {
        const jsonResult = JSON.parse(stdout);
        resolve(jsonResult);
      } catch (err) {
        reject(new Error('Falha ao ler saída do analisador: ' + stdout));
      }
    });
  });
}

// Enriquecer itens de CT-e com consulta dinâmica por Empresa no Protheus (OACO = 16/SD2160, GSI = 15/SD2150, METAL PLENO = 14/SD2140)
async function enrichItemsWithProtheus(items, empresaKey = 'OACO') {
  if (!items || !Array.isArray(items)) return items;

  const empCodigo = empresaKey === 'METAL_PLENO' ? '14' : empresaKey === 'GSI' ? '15' : '16';

  for (const item of items) {
    const rawDoc = String(item.docOriginario || '').trim();
    if (!rawDoc || rawDoc === 'Sem Info' || rawDoc === 'Pendente (Vínculo ViPP)') {
      item.docOriginario = 'Sem Info';
      item.pedVenda = 'Sem Info';
      item.codCli = '';
      item.freteCobradoProtheus = 0.00;
      item.freteEmbutidoProtheus = 0.00;
      item.freteProtheusTotal = 0.00;
      item.protheusEncontrado = false;
      item.status = 'Sem Info';
      item.empresaKey = empresaKey;
      item.tabela = `SD2${empCodigo}0`;
      continue;
    }

    if (rawDoc.toUpperCase().startsWith('OS')) {
      item.tipoDoc = 'OS';
      item.pedVenda = 'N/A (OS)';
      item.codCli = '';
      item.freteCobradoProtheus = 0.00;
      item.freteEmbutidoProtheus = 0.00;
      item.freteProtheusTotal = 0.00;
      item.protheusEncontrado = true;
      item.status = 'OS Identificada';
      item.empresaKey = empresaKey;
      item.tabela = `SD2${empCodigo}0`;
      continue;
    }

    try {
      const protheusData = await consultarProtheusNF(item.docOriginario, empresaKey);
      item.pedVenda = protheusData.pedVenda || 'N/A';
      item.codCli = protheusData.codCli || '';
      item.freteCobradoProtheus = protheusData.freteCobrado || 0.00;
      item.freteEmbutidoProtheus = protheusData.freteEmbutido || 0.00;
      item.freteProtheusTotal = protheusData.freteProtheusTotal || (item.freteCobradoProtheus + item.freteEmbutidoProtheus);
      item.protheusEncontrado = protheusData.encontrado;
      item.empresaKey = protheusData.empresa || empresaKey;
      item.tabela = protheusData.tabela || `SD2${empCodigo}0`;
      if (protheusData.encontrado && protheusData.nomeCli && (!item.cliente || item.cliente.includes('DEFINIR'))) {
        item.cliente = protheusData.nomeCli;
      }
    } catch (err) {
      console.error(`Erro ao consultar Protheus para NF ${item.docOriginario}:`, err.message);
      item.pedVenda = 'Erro Consulta';
      item.codCli = '';
      item.freteCobradoProtheus = 0.00;
      item.freteEmbutidoProtheus = 0.00;
      item.freteProtheusTotal = 0.00;
      item.protheusEncontrado = false;
      item.empresaKey = empresaKey;
      item.tabela = `SD2${empCodigo}0`;
    }
  }
  return items;
}

// API: Auth Login com Permissões por Usuário e JWT (com Rate Limiting)
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const cleanUser = String(username || '').trim().toLowerCase();
    const cleanPass = String(password || '').trim();

    if (!cleanUser || !cleanPass) {
      return res.status(400).json({ success: false, message: 'Usuário e senha são obrigatórios.' });
    }

    console.log('API Login Attempt for user:', cleanUser);

    const allUsers = await getUsersDB();
    const userFound = allUsers.find(u => String(u.username || '').trim().toLowerCase() === cleanUser && u.active !== false);

    let authenticatedUser = null;

    if (userFound) {
      const isMatch = await verifyPassword(cleanPass, userFound.pass);
      if (isMatch) {
        let userVendorCode = userFound.vendorCode || (userFound.role === 'vendedor' || DEFAULT_VENDOR_CODES[cleanUser] ? (DEFAULT_VENDOR_CODES[cleanUser] || null) : null);
        if (!userFound.vendorCode && userVendorCode) {
          saveUserDB({ ...userFound, vendorCode: userVendorCode, role: 'vendedor' }).catch(() => {});
        }

        authenticatedUser = {
          username: userFound.username,
          name: userFound.name,
          role: userFound.role || (cleanUser === 'alexandre' ? 'admin' : (DEFAULT_VENDOR_CODES[cleanUser] ? 'vendedor' : 'user')),
          vendorCode: userVendorCode,
          permissions: userFound.permissions || (cleanUser === 'alexandre' ? ['logistica', 'consulta', 'vendedores', 'financeiro', 'configuracoes'] : ['logistica', 'consulta'])
        };

        // Migração silenciosa para hash bcrypt se senha estiver em texto puro
        if (userFound.pass && !String(userFound.pass).startsWith('$2')) {
          saveUserDB({ ...userFound, pass: cleanPass }).catch(() => {});
        }
      }
    }

    if (!authenticatedUser) {
      return res.status(401).json({ success: false, message: 'Usuário ou senha incorretos ou usuário inativo.' });
    }

    // Identifica e-mail cadastrado para 2FA
    const targetEmail = (userFound && userFound.email) || authenticatedUser.email || (cleanUser === 'alexandre' ? 'alexandre@oaco.com.br' : null);

    // Se o usuário possui e-mail cadastrado válido, inicia o Desafio 2FA com código de 4 dígitos
    if (targetEmail && isValidEmail(targetEmail)) {
      const code4Digits = String(crypto.randomInt(1000, 10000));
      const { tempToken, expiresAt: tempExpiresAt } = await create2FAToken(authenticatedUser.username, code4Digits, 5);

      // Dispara envio do e-mail de forma assíncrona
      send2FACodeEmail({
        to: targetEmail,
        code: code4Digits,
        name: authenticatedUser.name,
        username: authenticatedUser.username,
        ip: req.ip
      }).catch(err => {
        console.error('Erro ao enviar e-mail 2FA no login:', err.message);
      });

      logUserActivity({
        username: authenticatedUser.username,
        userName: authenticatedUser.name,
        actionType: 'SOLICITACAO_2FA',
        description: `Código 2FA de 4 dígitos gerado e enviado para ${maskEmail(targetEmail)}`,
        ip: req.ip
      }).catch(() => {});

      return res.json({
        success: true,
        require2FA: true,
        tempToken: tempToken,
        emailMasked: maskEmail(targetEmail),
        expiresInSeconds: 300,
        message: `Código de segurança de 4 dígitos enviado para ${maskEmail(targetEmail)}.`
      });
    }

    // Fallback para contas legadas sem e-mail cadastrado
    const tokenPayload = {
      username: authenticatedUser.username,
      name: authenticatedUser.name,
      role: authenticatedUser.role,
      vendorCode: authenticatedUser.vendorCode,
      permissions: authenticatedUser.permissions
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

    logUserActivity({
      username: authenticatedUser.username,
      userName: authenticatedUser.name,
      actionType: 'LOGIN',
      description: `Login realizado sem 2FA (e-mail não configurado) (${authenticatedUser.role})`,
      ip: req.ip
    }).catch(() => {});

    return res.json({
      success: true,
      require2FA: false,
      warnSetupEmail: true,
      token: token,
      user: authenticatedUser,
      expiresAt: expiresAt,
      message: 'Login realizado com sucesso.'
    });
  } catch (err) {
    return handleServerError(res, err, 'Erro ao processar login.');
  }
});

// API: Validação do Código 2FA de 4 Dígitos
app.post('/api/auth/verify-2fa', verify2FALimiter, async (req, res) => {
  try {
    const { tempToken, code } = req.body || {};

    if (!tempToken || !code) {
      return res.status(400).json({ 
        success: false, 
        message: 'Token temporário e código de 4 dígitos são obrigatórios.' 
      });
    }

    const verifyResult = await verify2FAToken(tempToken, code);
    if (!verifyResult.valid) {
      return res.status(400).json({
        success: false,
        reason: verifyResult.reason,
        message: verifyResult.message,
        attemptsLeft: verifyResult.attemptsLeft
      });
    }

    const cleanUser = String(verifyResult.username).toLowerCase().trim();
    const allUsers = await getUsersDB();
    const userFound = allUsers.find(u => String(u.username || '').toLowerCase() === cleanUser && u.active !== false);

    let userVendorCode = (userFound ? userFound.vendorCode : null) || (userFound?.role === 'vendedor' || DEFAULT_VENDOR_CODES[cleanUser] ? (DEFAULT_VENDOR_CODES[cleanUser] || null) : null);
    if (userFound && !userFound.vendorCode && userVendorCode) {
      saveUserDB({ ...userFound, vendorCode: userVendorCode, role: 'vendedor' }).catch(() => {});
    }

    const authenticatedUser = {
      username: cleanUser,
      name: userFound ? userFound.name : (cleanUser.charAt(0).toUpperCase() + cleanUser.slice(1)),
      email: userFound ? userFound.email : null,
      role: userFound ? (userFound.role || 'user') : (cleanUser === 'alexandre' ? 'admin' : (DEFAULT_VENDOR_CODES[cleanUser] ? 'vendedor' : 'user')),
      vendorCode: userVendorCode,
      permissions: userFound ? (userFound.permissions || ['logistica', 'consulta']) : (cleanUser === 'alexandre' ? ['logistica', 'consulta', 'vendedores', 'financeiro', 'configuracoes'] : ['logistica', 'consulta'])
    };

    const tokenPayload = {
      username: authenticatedUser.username,
      name: authenticatedUser.name,
      role: authenticatedUser.role,
      vendorCode: authenticatedUser.vendorCode,
      permissions: authenticatedUser.permissions
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

    logUserActivity({
      username: authenticatedUser.username,
      userName: authenticatedUser.name,
      actionType: 'LOGIN_2FA',
      description: `Autenticação em dois fatores realizada com sucesso (${authenticatedUser.role})`,
      ip: req.ip
    }).catch(() => {});

    return res.json({
      success: true,
      token: token,
      user: authenticatedUser,
      expiresAt: expiresAt,
      message: 'Autenticação em dois fatores realizada com sucesso!'
    });
  } catch (err) {
    return handleServerError(res, err, 'Erro ao validar código de dois fatores.');
  }
});

// API: Reenvio de Código 2FA de 4 Dígitos
app.post('/api/auth/resend-2fa', resend2FALimiter, async (req, res) => {
  try {
    const { tempToken } = req.body || {};

    if (!tempToken) {
      return res.status(400).json({ 
        success: false, 
        message: 'Token temporário é obrigatório para reenvio de código.' 
      });
    }

    const code4Digits = String(crypto.randomInt(1000, 10000));
    const updateResult = await resend2FAToken(tempToken, code4Digits, 5);

    if (!updateResult.success) {
      return res.status(400).json({ 
        success: false, 
        message: updateResult.message || 'Sessão 2FA expirada ou inválida. Faça login novamente.' 
      });
    }

    const cleanUser = updateResult.username;
    const allUsers = await getUsersDB();
    const userFound = allUsers.find(u => String(u.username || '').toLowerCase() === cleanUser);
    const userEmail = userFound ? userFound.email : (cleanUser === 'alexandre' ? 'alexandre@oaco.com.br' : null);

    if (userEmail && isValidEmail(userEmail)) {
      send2FACodeEmail({
        to: userEmail,
        code: code4Digits,
        name: userFound ? userFound.name : cleanUser,
        username: cleanUser,
        ip: req.ip
      }).catch(err => {
        console.error('Erro ao reenviar e-mail 2FA:', err.message);
      });
    }

    logUserActivity({
      username: cleanUser,
      userName: userFound ? userFound.name : cleanUser,
      actionType: 'REENVIO_2FA',
      description: `Novo código 2FA reenviado para ${maskEmail(userEmail)}`,
      ip: req.ip
    }).catch(() => {});

    return res.json({
      success: true,
      emailMasked: maskEmail(userEmail),
      message: `Novo código de 4 dígitos enviado para ${maskEmail(userEmail)}.`
    });
  } catch (err) {
    return handleServerError(res, err, 'Erro ao reenviar código 2FA.');
  }
});

// API: Heartbeat de Sessão / Touch de Atividade do Usuário
app.post('/api/auth/session-ping', async (req, res) => {
  try {
    const authUser = getUserFromReq(req);
    if (authUser && authUser.username && authUser.username !== 'sistema') {
      await touchUserActivity(authUser.username);
      return res.json({ success: true, active: true, user: authUser.username });
    }
    return res.json({ success: true, active: false });
  } catch (err) {
    return res.json({ success: false });
  }
});

// API: Diagnóstico de Conexão SMTP em Tempo Real
app.get('/api/auth/diag-smtp', async (req, res) => {
  try {
    const targetEmail = req.query.to ? String(req.query.to).trim() : null;
    const diag = await testSmtpConnection(targetEmail);
    res.json({
      success: diag.verifySuccess,
      diagnostic: diag
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Alterar Senha do Próprio Usuário Autenticado (Anti-IDOR / Anti-BOLA)
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        message: 'A senha atual e a nova senha são obrigatórias.' 
      });
    }

    if (String(newPassword).trim().length < 4) {
      return res.status(400).json({ 
        success: false, 
        message: 'A nova senha deve possuir no mínimo 4 caracteres.' 
      });
    }

    // Identidade derivada ESTRITAMENTE do token JWT validado (Zero IDOR / BOLA)
    const tokenUsername = String(req.user.username).toLowerCase().trim();
    const allUsers = await getUsersDB();
    const userFound = allUsers.find(u => u.username.toLowerCase() === tokenUsername);

    if (!userFound) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    }

    // Validação estrita da senha atual
    const isCurrentMatch = await verifyPassword(String(currentPassword).trim(), userFound.pass);
    if (!isCurrentMatch) {
      return res.status(400).json({ 
        success: false, 
        message: 'Senha atual incorreta. Por favor, verifique e tente novamente.' 
      });
    }

    // Salva a nova senha (que será hasheada com bcrypt por saveUserDB)
    await saveUserDB({
      ...userFound,
      pass: String(newPassword).trim()
    });

    logUserActivity({
      username: tokenUsername,
      userName: userFound.name,
      actionType: 'TROCA_SENHA',
      description: `Alterou a própria senha com sucesso`,
      ip: req.ip
    }).catch(() => {});

    return res.json({ 
      success: true, 
      message: 'Sua senha foi alterada com sucesso!' 
    });
  } catch (err) {
    return handleServerError(res, err, 'Erro ao alterar senha.');
  }
});

// API: Listar Usuários (Admin)
app.get('/api/admin/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const allUsers = await getUsersDB();
    const users = allUsers.map(u => ({
      username: u.username,
      name: u.name,
      email: u.email || '',
      role: u.role || 'user',
      vendorCode: u.vendorCode || '',
      permissions: u.permissions || ['logistica', 'consulta'],
      active: u.active !== false
    }));
    res.json({ success: true, users, dbConnected: isPostgresConnected() });
  } catch (err) {
    handleServerError(res, err, 'Erro ao carregar lista de usuários.');
  }
});

// API: Salvar / Atualizar Usuário e Permissões (Admin)
app.post('/api/admin/users/save', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { username, name, email, pass, role, vendorCode, permissions, active } = req.body || {};

    if (!username || !name) {
      return res.status(400).json({ success: false, message: 'Usuário e Nome são obrigatórios.' });
    }

    if (email && !isValidEmail(String(email).trim())) {
      return res.status(400).json({ success: false, message: 'Por favor, informe um endereço de e-mail válido (ex: nome@empresa.com.br).' });
    }

    const allowedTabs = ['logistica', 'consulta', 'vendedores', 'financeiro', 'configuracoes'];
    let cleanPerms = Array.isArray(permissions) ? permissions.filter(p => allowedTabs.includes(p)) : ['logistica', 'consulta'];
    if (cleanPerms.length === 0) {
      cleanPerms = ['logistica', 'consulta'];
    }

    const cleanUser = String(username).trim().toLowerCase();
    const cleanEmail = email ? String(email).trim().toLowerCase() : null;

    const allUsers = await getUsersDB();
    const existingUser = allUsers.find(u => String(u.username || '').toLowerCase() === cleanUser);

    let finalVendorCode = vendorCode !== undefined && vendorCode !== null && String(vendorCode).trim() !== '' 
      ? String(vendorCode).trim() 
      : null;

    if (!finalVendorCode && (role === 'vendedor' || existingUser?.role === 'vendedor')) {
      finalVendorCode = existingUser?.vendorCode || DEFAULT_VENDOR_CODES[cleanUser] || null;
    }

    await saveUserDB({
      username: cleanUser,
      name: String(name).trim(),
      email: cleanEmail,
      pass: pass ? String(pass).trim() : undefined,
      role: role || 'user',
      vendorCode: finalVendorCode,
      permissions: cleanPerms,
      active: active !== undefined ? !!active : true
    });

    const curUser = getUserFromReq(req);
    logUserActivity({
      username: curUser.username,
      userName: curUser.name,
      actionType: 'GESTÃO_USUARIO',
      description: `Salvou configurações do usuário "${cleanUser}" (${cleanEmail || 'sem email'})`,
      ip: req.ip
    }).catch(() => {});

    res.json({ success: true, message: `Usuário "${cleanUser}" salvo com sucesso.` });
  } catch (err) {
    handleServerError(res, err, 'Erro ao salvar usuário.');
  }
});

// API: Excluir Usuário (Admin)
app.post('/api/admin/users/delete', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { username } = req.body || {};
    const cleanUser = String(username || '').trim().toLowerCase();

    if (cleanUser === 'alexandre') {
      return res.status(400).json({ success: false, message: 'O usuário principal Alexandre não pode ser excluído.' });
    }

    await deleteUserDB(cleanUser);

    const curUser = getUserFromReq(req);
    logUserActivity({
      username: curUser.username,
      userName: curUser.name,
      actionType: 'EXCLUSÃO_USUARIO',
      description: `Excluiu o usuário "${cleanUser}"`,
      ip: req.ip
    }).catch(() => {});

    res.json({ success: true, message: `Usuário "${cleanUser}" removido com sucesso.` });
  } catch (err) {
    handleServerError(res, err, 'Erro ao excluir usuário.');
  }
});

// API: Obter Resumo de Auditoria e Logs de Atividades (Admin)
app.get('/api/admin/audit-summary', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const summary = await getAuditSummary();
    res.json({ success: true, ...summary });
  } catch (err) {
    handleServerError(res, err, 'Erro ao obter resumo de auditoria.');
  }
});

// API: Consulta Protheus individual por NF e Empresa
app.get('/api/protheus/consulta/:nf', async (req, res) => {
  try {
    const empresaKey = req.query.empresa || 'OACO';
    const data = await consultarProtheusNF(req.params.nf, empresaKey);
    res.json({ success: true, nf: req.params.nf, empresa: empresaKey, data });
  } catch (err) {
    handleServerError(res, err, 'Erro ao consultar NF no Protheus.');
  }
});

// API: Consulta Multi-Empresa Avançada por Código Web, Pedido de Venda ou NFe
app.get('/api/protheus/consulta-avancada', async (req, res) => {
  try {
    const tipo = req.query.tipo || 'pedVenda'; // 'codWeb', 'pedVenda' ou 'nfe'
    const termo = req.query.termo || '';

    if (!termo) {
      return res.status(400).json({ success: false, message: 'Parâmetro de busca "termo" é obrigatório.' });
    }

    const rows = await buscarProtheusMultiEmpresa(tipo, termo);

    const tipoLabel = tipo === 'codWeb' ? 'Código Web' : (tipo === 'pedVenda' ? 'Pedido' : 'NFe');
    const user = getUserFromReq(req);
    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'CONSULTA_PED_NF',
      description: `Consultou ${tipoLabel}: "${termo}" (${rows.length} resultado(s))`,
      ip: req.ip,
      metadata: { tipo, termo, count: rows.length }
    }).catch(() => {});

    res.json({ success: true, tipo, termo, count: rows.length, rows });
  } catch (err) {
    handleServerError(res, err, 'Erro na consulta multi-empresa.');
  }
});

// API: Vendedores - Buscar Pedidos Multi-Empresa (CodWeb / NumPed / NomeCli)
app.post('/api/vendedores/pedidos/search', requireAuth, async (req, res) => {
  try {
    let { codWeb, numPed, nomeCli } = req.body || {};
    if (!codWeb && !numPed && !nomeCli) {
      return res.status(400).json({ success: false, message: 'Informe ao menos um critério de busca (CodWeb, Número do Pedido ou Nome do Cliente).' });
    }
    const user = getUserFromReq(req);
    let codVend = null;
    if (user.role === 'vendedor') {
      if (!user.vendorCode) {
        return res.status(403).json({ success: false, message: 'Acesso negado: Perfil de vendedor sem código de vendedor associado.' });
      }
      codVend = user.vendorCode;
    }

    const results = await buscarPedidosVendedores({ codWeb, numPed, nomeCli, codVend });

    const filtros = [codWeb && `Web: ${codWeb}`, numPed && `Ped: ${numPed}`, nomeCli && `Cli: ${nomeCli}`].filter(Boolean).join(' | ');
    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'CONSULTA_PEDIDOS',
      description: `Pesquisou pedidos: ${filtros} (${results.length} resultado(s))`,
      ip: req.ip,
      metadata: { codWeb, numPed, nomeCli, count: results.length }
    }).catch(() => {});

    res.json({ success: true, count: results.length, data: results });
  } catch (err) {
    handleServerError(res, err, 'Erro na busca de pedidos de vendedores.');
  }
});

// API: Vendedores - Listar Pedidos de Venda Abertos (Não Faturados)
app.get('/api/vendedores/pedidos/abertos', requireAuth, async (req, res) => {
  try {
    let { empresa, codVend } = req.query || {};
    const user = getUserFromReq(req);

    const results = await buscarPedidosAbertosVendedores({ empresa, codVend });

    const filtros = [
      empresa ? `Empresa: ${empresa}` : 'Todas as Empresas',
      codVend ? `Vendedor: ${codVend}` : 'Todos os Vendedores'
    ].join(' | ');

    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'CONSULTA_PEDIDOS_ABERTOS',
      description: `Consultou pedidos abertos: ${filtros} (${results.length} pedido(s))`,
      ip: req.ip,
      metadata: { empresa, codVend, count: results.length }
    }).catch(() => {});

    res.json({ success: true, count: results.length, data: results });
  } catch (err) {
    handleServerError(res, err, 'Erro na busca de pedidos abertos de vendedores.');
  }
});

// API: Vendedores - Listar Pedidos de Compras em Aberto (Previsão de Estoque SC7)
app.get('/api/vendedores/pedidos/compras', requireAuth, async (req, res) => {
  try {
    const { empresa, search } = req.query || {};
    const user = getUserFromReq(req);

    const results = await buscarPedidosCompras({ empresa, search });

    const filtros = [
      empresa ? `Empresa: ${empresa}` : 'Todas as Empresas',
      search ? `Busca: ${search}` : 'Sem filtro de busca'
    ].join(' | ');

    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'CONSULTA_PEDIDOS_COMPRAS',
      description: `Consultou pedidos de compras: ${filtros} (${results.length} item(ns))`,
      ip: req.ip,
      metadata: { empresa, search, count: results.length }
    }).catch(() => {});

    res.json({ success: true, count: results.length, data: results });
  } catch (err) {
    handleServerError(res, err, 'Erro na busca de pedidos de compras de vendedores.');
  }
});

// Controle de Cooldown em memória para disparo manual de sincronização (2 minutos)
let lastManualEstoqueSyncTime = 0;
const ESTOQUE_SYNC_COOLDOWN_MS = 2 * 60 * 1000;

// API: Vendedores - Listar Saldos em Estoque e KPIs Consolidados
app.get('/api/vendedores/estoque/saldos', requireAuth, async (req, res) => {
  try {
    const { search, filtroEstoque, filtroGrupo } = req.query || {};
    const user = getUserFromReq(req);

    const produtos = await getSaldosEstoqueDB({ search, filtroEstoque, filtroGrupo });
    const todosProdutos = await getSaldosEstoqueDB({ filtroEstoque: 'todos', filtroGrupo: 'todos' });
    const ultimoSync = await getUltimoSyncEstoqueLog();

    // Cálculos de KPIs consolidados globais (independente do filtro selecionado na tabela)
    const baseKpi = todosProdutos && todosProdutos.length > 0 ? todosProdutos : produtos;
    const totalItensEstoque = baseKpi.filter(p => Number(p.saldo || 0) > 0).length;
    const totalItensSemEstoque = baseKpi.filter(p => Number(p.saldo || 0) <= 0).length;
    const totalValorEstoque = baseKpi.reduce((acc, p) => acc + Number(p.saldo_total || 0), 0);

    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'CONSULTA_SALDOS_ESTOQUE',
      description: `Consultou saldos em estoque (${produtos.length} produtos carregados)`,
      ip: req.ip,
      metadata: { search, filtroEstoque, filtroGrupo, count: produtos.length }
    }).catch(() => {});

    res.json({
      success: true,
      count: produtos.length,
      kpis: {
        totalItensEstoque,
        totalItensSemEstoque,
        totalValorEstoque
      },
      lastSync: ultimoSync,
      data: produtos
    });
  } catch (err) {
    handleServerError(res, err, 'Erro ao obter saldos em estoque.');
  }
});

// API: Vendedores - Disparo de Sincronização Manual de Estoque (com Cooldown)
app.post('/api/vendedores/estoque/sync', requireAuth, async (req, res) => {
  try {
    const user = getUserFromReq(req);
    const now = Date.now();
    const elapsed = now - lastManualEstoqueSyncTime;

    if (elapsed < ESTOQUE_SYNC_COOLDOWN_MS) {
      const waitSec = Math.ceil((ESTOQUE_SYNC_COOLDOWN_MS - elapsed) / 1000);
      return res.status(429).json({
        success: false,
        cooldown: true,
        message: `Sincronização recente em andamento ou realizada há poucos instantes. Aguarde ${waitSec}s para sincronizar novamente.`
      });
    }

    lastManualEstoqueSyncTime = now;
    const resultado = await sincronizarSaldosEstoqueProtheus({
      triggeredBy: `MANUAL (${user.name || user.username})`
    });

    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'SYNC_SALDOS_ESTOQUE',
      description: `Disparou sincronização manual de saldos em estoque (${resultado.count || 0} itens)`,
      ip: req.ip,
      metadata: { resultado }
    }).catch(() => {});

    res.json({
      success: resultado.success,
      message: resultado.success ? 'Sincronização concluída com sucesso!' : 'Falha na sincronização.',
      detalhes: resultado
    });
  } catch (err) {
    handleServerError(res, err, 'Erro ao disparar sincronização manual de estoque.');
  }
});

// API: Vendedores - Obter Detalhes Completos do Pedido (Cabeçalho, Endereço, Itens SC6)
app.get('/api/vendedores/pedidos/detalhes', requireAuth, async (req, res) => {
  try {
    const { empresaKey, numPedido } = req.query || {};
    if (!numPedido) {
      return res.status(400).json({ success: false, message: 'Número do Pedido é obrigatório.' });
    }
    const detalhes = await obterDetalhesPedido(empresaKey, numPedido);
    if (!detalhes) {
      return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });
    }

    const user = getUserFromReq(req);

    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'DETALHES_PEDIDO',
      description: `Visualizou detalhes do Pedido ${numPedido} (${empresaKey || 'OACO'})`,
      ip: req.ip,
      metadata: { empresaKey, numPedido }
    }).catch(() => {});

    res.json({ success: true, data: detalhes });
  } catch (err) {
    handleServerError(res, err, 'Erro ao obter detalhes do pedido.');
  }
});

// API: Vendedores - Relatório de Comissões por Período
app.post('/api/vendedores/comissoes', requireAuth, async (req, res) => {
  try {
    let { dataIni, dataFim, codVend } = req.body || {};
    if (!dataIni || !dataFim) {
      return res.status(400).json({ success: false, message: 'Datas inicial e final são obrigatórias.' });
    }

    const user = getUserFromReq(req);

    // Validação de intervalo máximo de 60 dias
    const s1 = String(dataIni).replace(/\D/g, '');
    const s2 = String(dataFim).replace(/\D/g, '');
    if (s1.length === 8 && s2.length === 8) {
      const d1 = new Date(`${s1.slice(0,4)}-${s1.slice(4,6)}-${s1.slice(6,8)}`);
      const d2 = new Date(`${s2.slice(0,4)}-${s2.slice(4,6)}-${s2.slice(6,8)}`);
      const diffDays = Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
      if (diffDays > 60) {
        return res.status(400).json({ success: false, message: 'O intervalo selecionado não pode ser superior a 60 dias.' });
      }
    }

    const resultado = await buscarComissoesPeriodo({ dataIni, dataFim, codVend });

    const vendTxt = codVend ? `Vendedor ${codVend}` : 'Todos os Vendedores';
    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'CONSULTA_COMISSOES',
      description: `Consultou comissões (${dataIni} a ${dataFim}) - ${vendTxt} (${resultado ? resultado.totalRegistros : 0} lançamentos)`,
      ip: req.ip,
      metadata: { dataIni, dataFim, codVend, totalRegistros: resultado ? resultado.totalRegistros : 0 }
    }).catch(() => {});

    res.json({ success: true, data: resultado });
  } catch (err) {
    handleServerError(res, err, 'Erro ao consultar comissões.');
  }
});

// API: Logística - Pedidos Prontos para Faturar (MATA460A - Legenda Verde)
app.get('/api/logistica/pedidos-faturar', requireAuth, async (req, res) => {
  try {
    const { empresa, search } = req.query || {};
    const pedidos = await buscarPedidosProntosFaturar({ empresa, search });
    const user = getUserFromReq(req);

    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'CONSULTA_PEDIDOS_FATURAR',
      description: `Consultou pedidos prontos para faturar (${pedidos ? pedidos.length : 0} pedidos)`,
      ip: req.ip,
      metadata: { empresa, search, total: pedidos ? pedidos.length : 0 }
    }).catch(() => {});

    res.json({ success: true, count: pedidos.length, data: pedidos });
  } catch (err) {
    handleServerError(res, err, 'Erro ao consultar pedidos prontos para faturar.');
  }
});

// API: Logística - Pedidos Bloqueados por Falta de Estoque (C9_BLEST = '02')
app.get('/api/logistica/pedidos-bloq-estoque', requireAuth, async (req, res) => {
  try {
    const { empresa, search } = req.query || {};
    const pedidos = await buscarPedidosBloqueadosEstoque({ empresa, search });
    const user = getUserFromReq(req);

    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'CONSULTA_PEDIDOS_BLOQ_ESTOQUE',
      description: `Consultou pedidos bloqueados por estoque (${pedidos ? pedidos.length : 0} pedidos)`,
      ip: req.ip,
      metadata: { empresa, search, total: pedidos ? pedidos.length : 0 }
    }).catch(() => {});

    res.json({ success: true, count: pedidos.length, data: pedidos });
  } catch (err) {
    handleServerError(res, err, 'Erro ao consultar pedidos bloqueados por estoque.');
  }
});

// API: Logística - Análise e Fila Sequencial FIFO de Liberação de Estoque (MATA455 / MATA456)
app.get('/api/logistica/pedidos-lib-estoque', requireAuth, async (req, res) => {
  try {
    const { empresa, search } = req.query || {};
    const pedidos = await buscarPedidosAnaliseLibEstoque({ empresa, search });
    const user = getUserFromReq(req);

    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'CONSULTA_PEDIDOS_LIB_ESTOQUE',
      description: `Consultou fila de liberação de estoque (${pedidos ? pedidos.length : 0} pedidos)`,
      ip: req.ip,
      metadata: { empresa, search, total: pedidos ? pedidos.length : 0 }
    }).catch(() => {});

    res.json({ success: true, count: pedidos.length, data: pedidos });
  } catch (err) {
    handleServerError(res, err, 'Erro ao analisar liberação de estoque.');
  }
});

// API: Upload de Fatura (Com detecção automática de Pagador/Empresa 14, 15 ou 16)
app.post('/api/upload', upload.single('faturaFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado.' });
    }

    const tipo = req.body.tipoTransportadora || 'RODONAVES';
    let script = 'parser_rodonaves.py';
    let isCorreios = false;

    if (tipo === 'VIPP_TIPO2') {
      script = 'parser_tipo2.py';
    } else if (tipo === 'CORREIOS_SFE') {
      script = 'parser_correios.py';
      isCorreios = true;
    } else {
      script = 'parser_rodonaves.py';
    }

    const result = await runPythonParser(script, req.file.path);
    if (!result.success || !result.items || result.items.length === 0) {
      const errorMsg = result.message || result.error || 'Formato de arquivo incompatível com a transportadora selecionada.';
      return res.status(400).json({ success: false, message: errorMsg });
    }

    const empKey = (result.fatura && result.fatura.empresaKey) ? result.fatura.empresaKey : 'OACO';
    if (isCorreios) {
      result.items = await enrichCorreiosItems(result.items, empKey);
    } else {
      result.items = await enrichItemsWithProtheus(result.items, empKey);
    }

    const user = getUserFromReq(req);
    const fatNum = (result.fatura && result.fatura.numeroFatura) ? result.fatura.numeroFatura : req.file.originalname;
    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'UPLOAD_FATURA',
      description: `Processou fatura ${fatNum} (${result.items.length} CT-es) - ${empKey}`,
      ip: req.ip,
      metadata: { arquivo: req.file.originalname, fatura: fatNum, empresaKey: empKey, qtdFretes: result.items.length }
    }).catch(() => {});

    res.json(result);
  } catch (err) {
    handleServerError(res, err, 'Erro ao processar fatura de frete.');
  }
});

// API: Carregar exemplo local Rodonaves (Exemplo_FAT_OACO.pdf)
app.get('/api/sample-rodonaves', async (req, res) => {
  try {
    const samplePath = path.join(__dirname, 'Exemplo_FAT_OACO.pdf');
    if (!fs.existsSync(samplePath)) {
      return res.status(404).json({ success: false, message: 'Arquivo Exemplo_FAT_OACO.pdf não encontrado.' });
    }
    const result = await runPythonParser('parser_rodonaves.py', samplePath);
    if (result.success && result.items) {
      const empKey = (result.fatura && result.fatura.empresaKey) ? result.fatura.empresaKey : 'OACO';
      result.items = await enrichItemsWithProtheus(result.items, empKey);
    }
    res.json(result);
  } catch (err) {
    handleServerError(res, err, 'Erro ao carregar exemplo Rodonaves.');
  }
});

app.get('/api/sample-tipo2', async (req, res) => {
  try {
    const samplePath = path.join(__dirname, 'vipp-novo-visualset.txt');
    const result = await runPythonParser('parser_tipo2.py', samplePath);
    if (result.success && result.items) {
      const empKey = (result.fatura && result.fatura.empresaKey) ? result.fatura.empresaKey : 'OACO';
      result.items = await enrichItemsWithProtheus(result.items, empKey);
    }
    res.json(result);
  } catch (err) {
    handleServerError(res, err, 'Erro ao carregar exemplo ViPP TXT.');
  }
});

// API: Carregar exemplo local Fatura Correios (Exemplo_CORREIO_OACO.pdf)
app.get('/api/sample-correios', async (req, res) => {
  try {
    const samplePath = path.join(__dirname, 'Exemplo_CORREIO_OACO.pdf');
    if (!fs.existsSync(samplePath)) {
      return res.status(404).json({ success: false, message: 'Arquivo Exemplo_CORREIO_OACO.pdf não encontrado.' });
    }
    const result = await runPythonParser('parser_correios.py', samplePath);
    if (result.success && result.items) {
      const empKey = (result.fatura && result.fatura.empresaKey) ? result.fatura.empresaKey : 'OACO';
      result.items = await enrichCorreiosItems(result.items, empKey);
    }
    res.json(result);
  } catch (err) {
    handleServerError(res, err, 'Erro ao carregar exemplo Correios.');
  }
});

// API: Status da Integração FTP ViPP
app.get('/api/vipp/ftp-status', (req, res) => {
  try {
    const status = getFtpStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    handleServerError(res, err, 'Erro ao consultar status do FTP ViPP.');
  }
});

// API: Sincronização Sob Demanda do FTP ViPP
app.post('/api/vipp/sync-ftp', async (req, res) => {
  try {
    const syncRes = await syncVippFtp(true);
    const user = getUserFromReq(req);
    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'SYNC_FTP_VIPP',
      description: `Sincronizou FTP ViPP: ${syncRes.totalPostagens || 0} postagens (${syncRes.files ? syncRes.files.length : 0} arquivos)`,
      ip: req.ip,
      metadata: { totalPostagens: syncRes.totalPostagens, filesCount: syncRes.files ? syncRes.files.length : 0 }
    }).catch(() => {});

    res.json({
      success: syncRes.success,
      data: syncRes
    });
  } catch (err) {
    handleServerError(res, err, 'Erro ao sincronizar arquivos do FTP ViPP.');
  }
});

// API: Listar Postagens ViPP Indexadas
app.get('/api/vipp/postagens', async (req, res) => {
  try {
    const index = getVippIndex();
    res.json({
      success: true,
      total: index.totalPostagens,
      files: index.files,
      lastSync: index.lastSync,
      data: index.list
    });
  } catch (err) {
    handleServerError(res, err, 'Erro ao listar postagens ViPP.');
  }
});

// API: ViPP Config (GET & POST) - Protegido para Administradores
app.get('/api/vipp/config', requireAuth, requireRole('admin'), (req, res) => {
  const cfg = getVippConfig();
  res.json({
    success: true,
    config: {
      usuario: cfg.usuario || '',
      token: cfg.token ? (cfg.token.slice(0, 3) + '••••••••' + cfg.token.slice(-3)) : '',
      hasToken: !!cfg.token,
      idPerfil: cfg.idPerfil || '179551',
      contrato: cfg.contrato || '9912742673',
      ativo: !!cfg.token
    }
  });
});

app.post('/api/vipp/config', requireAuth, requireRole('admin'), (req, res) => {
  const { usuario, token, idPerfil, contrato } = req.body || {};
  const current = getVippConfig();

  const newConfig = {
    usuario: usuario !== undefined ? String(usuario).trim() : current.usuario,
    token: (token && String(token).trim() !== '') ? String(token).trim() : current.token,
    idPerfil: idPerfil !== undefined ? String(idPerfil).trim() : current.idPerfil,
    contrato: contrato !== undefined ? String(contrato).trim() : current.contrato,
    ativo: true,
    updatedAt: new Date().toISOString()
  };

  saveVippConfig(newConfig);
  res.json({
    success: true,
    message: 'Configurações da API ViPP Visualset salvas com sucesso!',
    config: {
      usuario: newConfig.usuario,
      hasToken: !!newConfig.token,
      idPerfil: newConfig.idPerfil,
      contrato: newConfig.contrato,
      ativo: !!newConfig.token
    }
  });
});

// API: Obter Histórico de Integrações
app.get('/api/history', async (req, res) => {
  const history = await getHistoryDB();
  res.json({ success: true, history });
});

// API: Health Check & Status do Banco de Dados
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    postgres: isPostgresConnected() ? 'connected' : 'local_fallback',
    diagnostic: getDiagnosticInfo(),
    version: '1.4.0 (18/08/2026 10:10)'
  });
});

// API: Lançar fretes no Protheus
app.post('/api/protheus/launch', async (req, res) => {
  const { fatura, items } = req.body;
  
  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ success: false, message: 'Itens inválidos.' });
  }

  const dataVenc = (fatura && fatura.dataVencimento) ? fatura.dataVencimento : '31/07/2026';
  const empresaNome = (fatura && fatura.pagador) ? fatura.pagador : 'OACO PRODUTOS DE ACO LTDA';
  const empCodigo = (fatura && fatura.empresaCodigo) ? fatura.empresaCodigo : '16';

  const results = items.map(item => {
    const fTotal = item.freteProtheusTotal || ((item.freteCobradoProtheus || 0) + (item.freteEmbutidoProtheus || 0));
    return {
      numFrete: item.numFrete,
      docOriginario: item.docOriginario,
      pedVenda: item.pedVenda,
      freteProtheusTotal: fTotal,
      valorCobrado: item.valorCobrado,
      dataVencimento: item.dataVencimento || dataVenc,
      empresaProtheus: `Empresa ${empCodigo} (${fatura.empresaKey || 'OACO'})`,
      tabelaUsada: item.tabela || `SD2${empCodigo}0`,
      status: 'Sucesso',
      protheusDoc: 'FRE-' + item.numFrete.replace(/[^a-zA-Z0-9]/g, ''),
      mensagem: `CT-e ${item.numFrete} amarrado à NF ${item.docOriginario} (Pedido ${item.pedVenda} na Empresa ${empCodigo}) gravado com sucesso.`
    };
  });

  const historyRecord = {
    id: 'HIST-' + Date.now(),
    dataIntegracao: new Date().toLocaleString('pt-BR'),
    faturaNumero: fatura ? fatura.numeroFatura : 'N/A',
    transportadora: fatura ? fatura.transportadora : 'N/A',
    pagador: empresaNome,
    empresaCodigo: empCodigo,
    dataVencimento: dataVenc,
    totalFretes: items.length,
    valorTotal: items.reduce((acc, curr) => acc + (curr.valorCobrado || 0), 0),
    logs: results
  };

  await saveHistoryItemDB(historyRecord);

  res.json({
    success: true,
    message: `${results.length} Conhecimentos de Frete (CT-es) processados e gravados no Protheus (Empresa ${empCodigo}) com sucesso.`,
    faturaNumero: fatura ? fatura.numeroFatura : '',
    empresaProtheus: `Empresa ${empCodigo}`,
    dataVencimentoFatura: dataVenc,
    totalLancado: historyRecord.valorTotal,
    logs: results
  });
});

/**
 * =========================================================================
 * ROTAS DA API: ASSISTENTE FINANCEIRO — CONCILIAÇÃO BANCÁRIA
 * =========================================================================
 */

// API: Status de Configuração das Credenciais do Banco Inter
app.get('/api/financeiro/inter-config', (req, res) => {
  try {
    const status = getInterConfigStatus();
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Executar Conciliação de Saldos (Macro)
app.get('/api/financeiro/conciliacao', async (req, res) => {
  try {
    const { data, empresa } = req.query;
    const user = getUserFromReq(req);
    
    // Normaliza a data (YYYY-MM-DD para YYYYMMDD)
    const rawData = String(data || '').trim();
    let dataIso = '';
    let dataYmd = '';

    if (rawData.includes('-')) {
      dataIso = rawData;
      dataYmd = rawData.replace(/-/g, '');
    } else if (rawData.length === 8) {
      dataYmd = rawData;
      dataIso = `${rawData.slice(0,4)}-${rawData.slice(4,6)}-${rawData.slice(6,8)}`;
    } else {
      // Padrão: dia útil anterior
      const d = new Date();
      d.setDate(d.getDate() - (d.getDay() === 1 ? 3 : d.getDay() === 0 ? 2 : 1));
      dataIso = d.toISOString().slice(0, 10);
      dataYmd = dataIso.replace(/-/g, '');
    }

    const empresasTarget = (empresa && empresa !== 'ALL') ? [String(empresa)] : ['14', '15', '16'];
    const resultados = [];

    for (const empCode of empresasTarget) {
      const info = CONTAS_INTER[empCode];
      if (!info) continue;

      try {
        // 1. Saldo Protheus SE8
        const saldoProtheusInfo = await consultarSaldoSE8(empCode, dataYmd);
        const saldoProtheus = saldoProtheusInfo.saldoProtheus || 0;

        // 2. Saldo Banco Inter
        let saldoBanco = null;
        let origemBanco = 'api_real_inter';
        let statusBancoMsg = '';
        let statusConciliacao = 'PENDENTE_INTER';
        let diferenca = null;

        try {
          const resInter = await consultarSaldoInter(empCode, dataIso);
          if (resInter.origem === 'simulacao_pendente_credenciais') {
            saldoBanco = null;
            origemBanco = 'simulacao_pendente_credenciais';
            statusConciliacao = 'PENDENTE_INTER';
            statusBancoMsg = 'Credenciais mTLS não carregadas no Render. Clique em "Status Credenciais Inter" acima.';
          } else {
            saldoBanco = resInter.saldoDisponivel !== undefined ? resInter.saldoDisponivel : 0;
            diferenca = Number((saldoBanco - saldoProtheus).toFixed(2));
            statusConciliacao = Math.abs(diferenca) < 0.01 ? 'OK' : 'DIVERGENTE';
          }
        } catch (interErr) {
          console.warn(`Aviso Inter Empresa ${empCode}:`, interErr.message);
          saldoBanco = null;
          origemBanco = 'erro_api_inter';
          statusConciliacao = 'ERRO_INTER';
          statusBancoMsg = `Erro na API do Banco Inter: ${interErr.message}`;
        }

        resultados.push({
          empresaCodigo: empCode,
          empresaNome: info.empresaNome,
          cnpj: info.cnpj,
          banco: '077',
          agencia: info.agencia,
          conta: info.conta,
          contaFormatada: info.contaFormatada,
          dataReferenciaIso: dataIso,
          dataReferenciaYmd: dataYmd,
          dataUltimoSaldoProtheus: saldoProtheusInfo.dataUltimoSaldoProtheus,
          saldoProtheus: saldoProtheus,
          saldoBanco: saldoBanco,
          diferenca: diferenca,
          status: statusConciliacao,
          origemBanco: origemBanco,
          statusBancoMsg: statusBancoMsg
        });
      } catch (empErr) {
        console.error(`Erro ao conciliar empresa ${empCode}:`, empErr);
        resultados.push({
          empresaCodigo: empCode,
          empresaNome: info.empresaNome,
          cnpj: info.cnpj,
          contaFormatada: info.contaFormatada,
          dataReferenciaIso: dataIso,
          dataReferenciaYmd: dataYmd,
          saldoProtheus: 0,
          saldoBanco: 0,
          diferenca: 0,
          status: 'ERRO',
          erro: empErr.message
        });
      }
    }

    logUserActivity({
      username: user.username,
      name: user.name,
      action: 'CONCILIACAO_BANCARIA',
      details: `Executou conciliação bancária das empresas [${empresasTarget.join(', ')}] para a data ${dataIso}`
    });

    res.json({
      success: true,
      dataReferenciaIso: dataIso,
      dataReferenciaYmd: dataYmd,
      totalEmpresas: resultados.length,
      empresas: resultados
    });
  } catch (err) {
    console.error('Erro na rota de conciliação bancária:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Diagnóstico Detalhado de Lançamentos Divergentes (Micro)
app.get('/api/financeiro/diagnostico', async (req, res) => {
  try {
    const { empresa, data, dias } = req.query;
    const empCode = String(empresa || '16').trim();
    const info = CONTAS_INTER[empCode];
    if (!info) {
      return res.status(400).json({ success: false, error: `Empresa inválida: ${empCode}` });
    }

    const numDias = parseInt(dias, 10) || 3;
    const rawData = String(data || '').trim();
    let dataRefIso = '';
    let dataRefYmd = '';

    if (rawData.includes('-')) {
      dataRefIso = rawData;
      dataRefYmd = rawData.replace(/-/g, '');
    } else if (rawData.length === 8) {
      dataRefYmd = rawData;
      dataRefIso = `${rawData.slice(0,4)}-${rawData.slice(4,6)}-${rawData.slice(6,8)}`;
    } else {
      const d = new Date();
      d.setDate(d.getDate() - (d.getDay() === 1 ? 3 : d.getDay() === 0 ? 2 : 1));
      dataRefIso = d.toISOString().slice(0, 10);
      dataRefYmd = dataRefIso.replace(/-/g, '');
    }

    // Calcula data inicial (numDias úteis atrás)
    const dIniDate = new Date(dataRefIso + 'T12:00:00');
    dIniDate.setDate(dIniDate.getDate() - (numDias + 2)); // janela segura
    const dataInicioIso = dIniDate.toISOString().slice(0, 10);
    const dataInicioYmd = dataInicioIso.replace(/-/g, '');

    // 1. Consulta lançamentos reais na SE5 do Protheus
    const lancamentosProtheus = await consultarExtratoSE5(empCode, dataInicioYmd, dataRefYmd);

    // 2. Consulta extrato no Banco Inter
    let transacoesBanco = [];
    let origemBanco = 'api_real_inter';

    try {
      const resInter = await consultarExtratoInter(empCode, dataInicioIso, dataRefIso);
      if (resInter.origem === 'simulacao_pendente_credenciais' || !resInter.transacoes || resInter.transacoes.length === 0) {
        origemBanco = 'simulacao_pendente_credenciais';
        
        // Simulação inteligente baseada nos lançamentos da SE5 para testes completos de N:1
        transacoesBanco = [];
        // Converte parte dos lançamentos do Protheus em 1:1 e agrupa 2 ou mais em 1 pagamento para demonstrar o N:1
        let agrupador = [];
        let acumulado = 0;

        for (let i = 0; i < lancamentosProtheus.length; i++) {
          const p = lancamentosProtheus[i];
          if (p.tipoOperacao === 'D' && agrupador.length < 2 && p.valor < 3000) {
            agrupador.push(p);
            acumulado += p.valor;
            if (agrupador.length === 2) {
              transacoesBanco.push({
                id: `inter-sim-grp-${i}`,
                data: p.dataIso || p.data,
                dataIso: p.dataIso,
                tipoOperacao: 'D',
                valor: Number(acumulado.toFixed(2)),
                titulo: 'PAGAMENTO LOTE / FORNECEDORES (AGRUPADO)',
                descricao: `Lote consolidado de ${agrupador.length} títulos no Inter`,
                documento: 'LOTE-' + p.data
              });
              agrupador = [];
              acumulado = 0;
            }
          } else {
            // Lançamento 1:1 normal
            transacoesBanco.push({
              id: `inter-sim-${i}`,
              data: p.dataIso || p.data,
              dataIso: p.dataIso,
              tipoOperacao: p.tipoOperacao,
              valor: p.valor,
              titulo: p.historico || 'Transação Bancária Inter',
              descricao: p.beneficiario || '',
              documento: p.documento || ''
            });
          }
        }
      } else {
        transacoesBanco = resInter.transacoes;
      }
    } catch (errInter) {
      console.warn(`Erro ao consultar extrato Inter: ${errInter.message}`);
    }

    // 3. Executa algoritmo de matching e concatenação N:1
    const resultadoMatching = algoritmoMatchingConciliacao(lancamentosProtheus, transacoesBanco);

    res.json({
      success: true,
      empresaCodigo: empCode,
      empresaNome: info.empresaNome,
      contaFormatada: info.contaFormatada,
      periodo: {
        inicio: dataInicioIso,
        fim: dataRefIso,
        dias: numDias
      },
      origemBanco,
      lancamentosProtheusTotal: lancamentosProtheus.length,
      transacoesBancoTotal: transacoesBanco.length,
      ...resultadoMatching
    });
  } catch (err) {
    console.error('Erro no diagnóstico de conciliação:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =================================================================
// WEBHOOK BANCO INTER (Multi-Empresa: 14 - Metal Pleno, 15 - GSI, 16 - OAÇO)
// =================================================================

// Endpoint de Recepção de Notificações em Tempo Real (Pix, Boletos, Banking)
app.post(['/api/webhooks/inter', '/api/webhooks/inter/:empresa'], async (req, res) => {
  try {
    // 1. Validação opcional de segredo de webhook (se configurado no ambiente) com timingSafeEqual
    const expectedSecret = (process.env.INTER_WEBHOOK_SECRET || '').trim();
    if (expectedSecret) {
      const incomingSecret = String(req.headers['x-webhook-secret'] || req.headers['x-inter-secret'] || req.query.secret || '').trim();
      const bufIncoming = Buffer.from(incomingSecret);
      const bufExpected = Buffer.from(expectedSecret);
      const isMatch = (bufIncoming.length === bufExpected.length) && crypto.timingSafeEqual(bufIncoming, bufExpected);
      if (!isMatch) {
        console.warn('⛔ [Webhook Inter] Acesso rejeitado: segredo de webhook inválido.');
        return res.status(401).json({ success: false, error: 'Unauthorized webhook secret' });
      }
    }

    // 2. Resolução estrita do código da empresa por rota, header ou campos estruturados
    const rawEmp = req.params.empresa || req.query.empresa || req.headers['x-empresa-codigo'] || req.body?.empresaCodigo || req.body?.empresa;
    let empCode = '14';
    if (rawEmp && ['14', '15', '16'].includes(String(rawEmp).trim())) {
      empCode = String(rawEmp).trim();
    } else if (req.body) {
      const b = req.body;
      const digits = String(b.contaCorrente || b.conta || b.cnpjDestinatario || b.cnpjRecebedor || b.chavePix || '').replace(/\D/g, '');
      if (digits.includes('137760655') || digits.includes('18324901000114')) empCode = '15';
      else if (digits.includes('48165605') || digits.includes('61237790000118')) empCode = '16';
      else if (digits.includes('397407319') || digits.includes('44914992000138') || digits.includes('10870367000144')) empCode = '14';
    }

    const b = req.body || {};

    // 3. Validação Rigorosa de Schema Zod
    const valResult = validateWebhookPayload(b);
    if (!valResult.valid) {
      console.warn('⚠️ [Webhook Inter] Payload inválido ou malformado:', valResult.errors);
      return res.status(400).json({ 
        success: false, 
        received: false, 
        error: 'Invalid webhook schema', 
        details: valResult.errors 
      });
    }

    // 4. Tratamento de Batch Pix (múltiplas transações em um único webhook)
    if (valResult.tipo === 'PIX_BATCH') {
      const pixList = b.pix || [];
      if (pixList.length === 0) {
        return res.status(200).json({ received: true, totalEvents: 0, empresaCodigo: empCode, message: 'Empty pix array' });
      }

      // Responde HTTP 200 rápido ao Inter
      res.status(200).json({ received: true, totalEvents: pixList.length, empresaCodigo: empCode, tipo: 'PIX_BATCH' });

      // Grava cada transação Pix isoladamente de forma determinística
      for (const pixItem of pixList) {
        const evtId = pixItem?.endToEndId || pixItem?.txid || null;
        saveInterWebhookEvent({
          empresaCodigo: empCode,
          eventId: evtId,
          tipo: 'PIX',
          payload: pixItem
        }).catch(e => console.warn('⚠️ [Pix Batch Item Save Error]:', e.message));
      }
      return;
    }

    // 5. Tratamento de Notificações Singulares (Boleto, Cobrança, Pix Único, Banking)
    const eventId = valResult.eventId || b.txid || b.nossoNumero || b.idTransacao || b.codigoSolicitacao || b.endToEndId || null;
    const tipo = valResult.tipo;

    // Resposta imediata HTTP 200 para o Banco Inter
    res.status(200).json({ received: true, empresaCodigo: empCode, tipo });

    // Gravação assíncrona/idempotente determinística
    saveInterWebhookEvent({
      empresaCodigo: empCode,
      eventId,
      tipo,
      payload: valResult.data || b
    }).catch(e => console.warn('⚠️ [Webhook Event Async Save Warning]:', e.message));

  } catch (err) {
    console.error('❌ Erro no webhook Inter:', err.message);
    res.status(200).json({ received: true, error: err.message });
  }
});

// Endpoint de Consulta de Eventos de Webhook Recebidos (Protegido com Validação Real de Usuário)
app.get('/api/financeiro/webhooks', async (req, res) => {
  try {
    const user = getUserFromReq(req);
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const isMasterApiKey = (apiKey && apiKey === process.env.API_KEY);

    if (!isMasterApiKey) {
      const allUsers = await getUsersDB();
      const validUser = allUsers.find(u => u.username.toLowerCase() === user.username.toLowerCase() && u.active);
      if (!validUser || !['admin', 'operador', 'financeiro'].includes(validUser.role || 'user')) {
        return res.status(401).json({ success: false, error: 'Acesso restrito a usuários autorizados' });
      }
    }

    const { empresa, limit } = req.query;
    const eventos = await getInterWebhookEvents(empresa, limit || 50);
    res.json({
      success: true,
      total: eventos.length,
      empresa: empresa || 'todas',
      eventos
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =================================================================
// ANÁLISE DE CRÉDITO & SCORE PROTHEUS
// =================================================================
const {
  getScoreConfig,
  saveScoreConfig,
  resetScoreConfig,
  calcularScore,
  getHistorico: getHistoricoCredito,
  salvarAnalise: salvarAnaliseCredito
} = require('./analise_credito_engine');
const { parseSerasaBuffer } = require('./serasa_pdf_parser');

// Funções de Normalização e Comparação Semântica de Endereços (Protheus vs Receita Federal)
function normalizarNumero(num) {
  if (!num) return '';
  const digits = String(num).replace(/\D/g, '');
  if (!digits) return String(num).trim();
  // Remove zeros à esquerda (ex: '00099' -> '99')
  const semZeros = digits.replace(/^0+/, '');
  return semZeros || '0';
}

function normalizarTextoEnd(txt) {
  if (!txt) return '';
  return String(txt)
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,\-\/\\()]/g, ' ')
    .replace(/\b(ESTRADA|ESTR|EST)\b/g, 'EST')
    .replace(/\b(AVENIDA|AV)\b/g, 'AV')
    .replace(/\b(RODOVIA|ROD)\b/g, 'ROD')
    .replace(/\b(RUA|R)\b/g, 'R')
    .replace(/\b(TRAVESSA|TRAV|TV)\b/g, 'TV')
    .replace(/\b(ALAMEDA|AL)\b/g, 'AL')
    .replace(/\b(PRACA|PRC|PC)\b/g, 'PC')
    .replace(/\b(JARDIM|JDM|JD)\b/g, 'JD')
    .replace(/\b(PARQUE|PRQ|PQ)\b/g, 'PQ')
    .replace(/\b(VILA|VL)\b/g, 'VL')
    .replace(/\b(AREA RURAL|ZONA RURAL|RURAL)\b/g, 'RURAL')
    .replace(/\b(DOUTOR|DR)\b/g, 'DR')
    .replace(/\b(PROFESSOR|PROF)\b/g, 'PROF')
    .replace(/\b(SANTO|STO|SANTA|STA|SAO)\b/g, 'SAO')
    .replace(/\b(NUMERO|N|NO|NUM)\b/g, '')
    .replace(/\b(SEM NUMERO|S N|SN)\b/g, 'SN')
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairNumeroEnd(txt) {
  if (!txt) return '';
  const m = String(txt).match(/\b\d+\b/);
  return m ? normalizarNumero(m[0]) : '';
}

function compararEnderecos(endProtheus, endReceita, numProtheus, numReceita, compReceita, compProtheus) {
  const norm1 = normalizarTextoEnd(`${endProtheus} ${compProtheus || ''}`);
  const norm2 = normalizarTextoEnd(`${endReceita} ${compReceita || ''}`);

  const n1 = normalizarNumero(numProtheus) || extrairNumeroEnd(endProtheus);
  const n2 = normalizarNumero(numReceita) || extrairNumeroEnd(endReceita);

  const tokens1 = new Set(norm1.split(' ').filter(x => x.length > 1));
  const tokens2 = new Set(norm2.split(' ').filter(x => x.length > 1));

  let matches = 0;
  for (const t of tokens1) {
    if (tokens2.has(t)) matches++;
  }

  const minTokens = Math.min(tokens1.size, tokens2.size);
  const similarity = minTokens > 0 ? (matches / minTokens) : 0;
  const numMatch = (!n1 && !n2) || (n1 === n2);

  return {
    norm1,
    norm2,
    n1,
    n2,
    similarity,
    numMatch,
    iguais: similarity >= 0.65 && numMatch
  };
}

// Função utilitária para consulta de CNPJ em bases públicas governamentais (BrasilAPI com fallback ReceitaWS)
async function consultarCnpjPublico(cnpjStr) {
  if (!cnpjStr) return null;
  const digits = String(cnpjStr).replace(/\D/g, '');
  if (digits.length !== 14) return null;
  const t0 = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gemini-Auditores/1.0' }
    });
    clearTimeout(timeout);

    if (res.ok) {
      const d = await res.json();
      return {
        fundacao: d.data_inicio_atividade || '',
        capitalSocial: typeof d.capital_social === 'number' ? d.capital_social : parseFloat(d.capital_social) || 0,
        cnpjAtivo: (d.descricao_situacao_cadastral || d.situacao_cadastral || '').toUpperCase().includes('ATIVA') ? 'S' : 'N',
        descricao_tipo_de_logradouro: d.descricao_tipo_de_logradouro || '',
        logradouro: d.logradouro || '',
        numero: d.numero || '',
        complemento: d.complemento || '',
        bairro: d.bairro || '',
        municipio: d.municipio || '',
        uf: d.uf || '',
        cep: d.cep || '',
        enderecoCompleto: `${d.descricao_tipo_de_logradouro || ''} ${d.logradouro || ''}, ${d.numero || ''} - ${d.bairro || ''}, ${d.municipio || ''} - ${d.uf || ''}`.trim(),
        _status: {
          status: 'OK',
          provedor: 'BrasilAPI',
          tempoMs: Date.now() - t0,
          mensagem: 'Dados cadastrais e capital obtidos via BrasilAPI'
        }
      };
    }
  } catch (e) {
    console.warn('Consulta BrasilAPI falhou, tentando fallback ReceitaWS:', e.message);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res2 = await fetch(`https://receitaws.com.br/v1/cnpj/${digits}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gemini-Auditores/1.0' }
    });
    clearTimeout(timeout);

    if (res2.ok) {
      const d2 = await res2.json();
      const cap = String(d2.capital_social || '0').replace(/\./g, '').replace(',', '.');
      return {
        fundacao: d2.abertura || '',
        capitalSocial: parseFloat(cap) || 0,
        cnpjAtivo: (d2.situacao || '').toUpperCase().includes('ATIVA') ? 'S' : 'N',
        descricao_tipo_de_logradouro: '',
        logradouro: d2.logradouro || '',
        numero: d2.numero || '',
        complemento: d2.complemento || '',
        bairro: d2.bairro || '',
        municipio: d2.municipio || '',
        uf: d2.uf || '',
        cep: d2.cep || '',
        enderecoCompleto: `${d2.logradouro || ''}, ${d2.numero || ''} - ${d2.bairro || ''}, ${d2.municipio || ''} - ${d2.uf || ''}`.trim(),
        _status: {
          status: 'OK',
          provedor: 'ReceitaWS (Fallback)',
          tempoMs: Date.now() - t0,
          mensagem: 'Dados cadastrais obtidos via ReceitaWS (Fallback)'
        }
      };
    }
  } catch (e2) {
    console.warn('Consulta CNPJ fallback ReceitaWS falhou:', e2.message);
  }

  return {
    fundacao: '',
    capitalSocial: 0,
    cnpjAtivo: '',
    descricao_tipo_de_logradouro: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    municipio: '',
    uf: '',
    cep: '',
    enderecoCompleto: '',
    _erroTecnico: true,
    _status: {
      status: 'ERRO',
      provedor: 'BrasilAPI / ReceitaWS',
      tempoMs: Date.now() - t0,
      mensagem: 'Indisponibilidade nas APIs da Receita Federal (BrasilAPI e ReceitaWS indisponíveis)'
    }
  };
}

const dns = require('dns').promises;

const PROVIDERS_GENERICOS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.com.br', 'ymail.com', 'icloud.com', 'me.com',
  'uol.com.br', 'bol.com.br', 'terra.com.br', 'ig.com.br', 'globo.com', 'globomail.com',
  'oi.com.br', 'itelefonica.com.br', 'superig.com.br', 'r7.com', 'zipmail.com.br'
]);

function analisarEmailsCliente(emailStr, hpageStr) {
  const raw = String(emailStr || '');
  const matches = raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  const emailsUnicos = Array.from(new Set(matches.map(e => e.toLowerCase().trim())));

  const corporativos = [];
  const genericos = [];

  for (const mail of emailsUnicos) {
    const domain = mail.split('@')[1];
    if (PROVIDERS_GENERICOS.has(domain)) {
      genericos.push(mail);
    } else {
      corporativos.push(mail);
    }
  }

  const emailCorporativo = corporativos.length > 0 ? 'S' : 'N';
  const mailFinanDiferente = corporativos.length >= 2 ? 'S' : 'N';

  let mailGratuito = 'N';
  if (corporativos.length === 0 && genericos.length > 0) {
    mailGratuito = 'S';
  }

  let dominioPrincipal = '';
  if (corporativos.length > 0) {
    dominioPrincipal = corporativos[0].split('@')[1];
  } else if (hpageStr) {
    dominioPrincipal = hpageStr.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim().toLowerCase();
  }

  const possuiSite = (hpageStr && hpageStr.trim() !== '') || dominioPrincipal !== '' ? 'S' : 'N';

  return {
    emailCorporativo,
    mailFinanDiferente,
    mailGratuito,
    possuiSite,
    dominioPrincipal,
    emailsEncontrados: emailsUnicos,
    corporativos,
    genericos
  };
}

async function consultarRDAP(dominio) {
  if (!dominio) return null;
  const limpo = dominio.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim().toLowerCase();
  const t0 = Date.now();

  if (!limpo.endsWith('.br')) {
    return {
      dominio: limpo,
      idadeAnos: null,
      anoCriacao: '',
      titular: '',
      documento: '',
      tipoDocumento: '',
      cnpjDigits: '',
      cnpjRaiz: '',
      _status: {
        status: 'INFO',
        provedor: 'Registro.br (RDAP)',
        tempoMs: 0,
        mensagem: 'Domínio internacional (.com/.org) não gerido pelo Registro.br'
      }
    };
  }

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`https://rdap.registro.br/domain/${limpo}`, { signal: controller.signal });
    clearTimeout(t);
    if (res.ok) {
      const d = await res.json();
      let dataCriacao = null;
      if (Array.isArray(d.events)) {
        const reg = d.events.find(e => e.eventAction === 'registration');
        if (reg) dataCriacao = reg.eventDate;
      }
      let idadeAnos = 0;
      let anoCriacao = '';
      if (dataCriacao) {
        const dCri = new Date(dataCriacao);
        if (!isNaN(dCri.getTime())) {
          idadeAnos = Math.floor((Date.now() - dCri.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
          anoCriacao = dCri.getFullYear().toString();
        }
      }

      let titular = '';
      let documento = '';
      let tipoDocumento = '';

      if (Array.isArray(d.entities)) {
        const regEntity = d.entities.find(e => Array.isArray(e.roles) && e.roles.includes('registrant')) || d.entities[0];
        if (regEntity) {
          if (regEntity.legalRepresentative) {
            titular = String(regEntity.legalRepresentative).trim();
          }
          if (Array.isArray(regEntity.vcardArray) && Array.isArray(regEntity.vcardArray[1])) {
            const fnProp = regEntity.vcardArray[1].find(p => Array.isArray(p) && p[0] === 'fn');
            if (fnProp && typeof fnProp[3] === 'string' && fnProp[3].trim()) {
              titular = fnProp[3].trim();
            }
          }
          if (Array.isArray(regEntity.publicIds) && regEntity.publicIds.length > 0) {
            const pubId = regEntity.publicIds[0];
            tipoDocumento = (pubId.type || '').toLowerCase();
            documento = (pubId.identifier || '').trim();
          }
          if (!documento && regEntity.handle) {
            const handleDigits = regEntity.handle.replace(/\D/g, '');
            if (handleDigits.length === 14) {
              tipoDocumento = 'cnpj';
              documento = handleDigits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
            } else if (handleDigits.length === 11) {
              tipoDocumento = 'cpf';
              documento = handleDigits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
            }
          }
        }
      }

      const docDigits = documento.replace(/\D/g, '');
      const isCnpj = tipoDocumento === 'cnpj' || docDigits.length === 14;
      const cnpjDigits = isCnpj ? docDigits : '';
      const cnpjRaiz = cnpjDigits.length >= 8 ? cnpjDigits.substring(0, 8) : '';

      return {
        dominio: limpo,
        dataCriacao,
        anoCriacao,
        idadeAnos,
        titular: titular || (d.entities && d.entities[0] ? d.entities[0].handle : ''),
        documento,
        tipoDocumento: tipoDocumento || (docDigits.length === 14 ? 'cnpj' : (docDigits.length === 11 ? 'cpf' : '')),
        cnpjDigits,
        cnpjRaiz,
        status: d.status,
        _status: {
          status: 'OK',
          provedor: 'Registro.br (RDAP)',
          tempoMs: Date.now() - t0,
          mensagem: `Domínio registrado há ${idadeAnos} anos (Desde ${anoCriacao || 'N/A'})`
        }
      };
    } else if (res.status === 404) {
      return {
        dominio: limpo,
        idadeAnos: 0,
        anoCriacao: '',
        titular: '',
        documento: '',
        tipoDocumento: '',
        cnpjDigits: '',
        cnpjRaiz: '',
        _status: {
          status: 'ALERTA',
          provedor: 'Registro.br (RDAP)',
          tempoMs: Date.now() - t0,
          mensagem: 'Domínio não localizado no Registro.br'
        }
      };
    }
  } catch (e) {
    console.warn('RDAP erro:', e.message);
  }

  return {
    dominio: limpo,
    idadeAnos: null,
    anoCriacao: '',
    titular: '',
    documento: '',
    tipoDocumento: '',
    cnpjDigits: '',
    cnpjRaiz: '',
    _erroTecnico: true,
    _status: {
      status: 'ERRO',
      provedor: 'Registro.br (RDAP)',
      tempoMs: Date.now() - t0,
      mensagem: 'Indisponibilidade / Timeout na consulta do Registro.br'
    }
  };
}

function compararRegistroBr(cnpjCliente, infoRDAP, dominioPrincipal) {
  if (!infoRDAP || infoRDAP._erroTecnico) {
    if (infoRDAP && infoRDAP._erroTecnico) {
      return {
        valor: 'INDISPONIVEL',
        confere: false,
        erroTecnico: true,
        motivo: 'Indisponibilidade técnica no Registro.br (Neutro)',
        dominio: dominioPrincipal || ''
      };
    }
    if (dominioPrincipal && !dominioPrincipal.toLowerCase().endsWith('.br')) {
      return {
        valor: 'N',
        confere: false,
        motivo: 'Domínio internacional (.com/.org) não gerido pelo Registro.br',
        dominio: dominioPrincipal
      };
    }
    return {
      valor: 'N',
      confere: false,
      motivo: dominioPrincipal ? 'Domínio não encontrado no Registro.br' : 'Cliente sem domínio próprio',
      dominio: dominioPrincipal || ''
    };
  }

  const cnpjCliDigits = String(cnpjCliente || '').replace(/\D/g, '');
  const cnpjCliRaiz = cnpjCliDigits.length >= 8 ? cnpjCliDigits.substring(0, 8) : '';

  if (infoRDAP.tipoDocumento === 'cnpj' || (infoRDAP.cnpjDigits && infoRDAP.cnpjDigits.length === 14)) {
    const regDigits = infoRDAP.cnpjDigits || (infoRDAP.documento || '').replace(/\D/g, '');
    const regRaiz = regDigits.length >= 8 ? regDigits.substring(0, 8) : '';

    if (cnpjCliRaiz && regRaiz) {
      if (cnpjCliRaiz === regRaiz) {
        return {
          valor: 'S',
          confere: true,
          motivo: 'CNPJ confere pela raiz (Matriz/Filial)',
          cnpjCliente: cnpjCliente || '',
          cnpjRegistroBr: infoRDAP.documento || '',
          titularRegistroBr: infoRDAP.titular || '',
          dominio: infoRDAP.dominio || ''
        };
      } else {
        return {
          valor: 'N',
          confere: false,
          motivo: 'CNPJ divergente no Registro.br',
          cnpjCliente: cnpjCliente || '',
          cnpjRegistroBr: infoRDAP.documento || '',
          titularRegistroBr: infoRDAP.titular || '',
          dominio: infoRDAP.dominio || ''
        };
      }
    }
  } else if (infoRDAP.tipoDocumento === 'cpf') {
    return {
      valor: 'N',
      confere: false,
      motivo: 'Domínio registrado por CPF (Pessoa Física)',
      cnpjCliente: cnpjCliente || '',
      cpfRegistroBr: infoRDAP.documento || '',
      titularRegistroBr: infoRDAP.titular || '',
      dominio: infoRDAP.dominio || ''
    };
  }

  return {
    valor: 'N',
    confere: false,
    motivo: 'Documento não identificado no Registro.br',
    dominio: infoRDAP.dominio || ''
  };
}

async function consultarWayback(dominio) {
  const t0 = Date.now();
  if (!dominio) {
    return {
      temHistorico: false,
      anoPrimeiroSnapshot: null,
      _status: {
        status: 'INFO',
        provedor: 'Archive.org (Wayback)',
        tempoMs: 0,
        mensagem: 'Cliente sem domínio/site cadastrado'
      }
    };
  }
  const limpo = dominio.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim().toLowerCase();
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`https://archive.org/wayback/available?url=${limpo}&timestamp=20000101`, { signal: controller.signal });
    clearTimeout(t);
    if (res.ok) {
      const d = await res.json();
      const snap = d.archived_snapshots && d.archived_snapshots.closest;
      if (snap && snap.available) {
        const ts = snap.timestamp;
        const ano = ts ? ts.substring(0, 4) : '';
        return {
          temHistorico: true,
          anoPrimeiroSnapshot: ano,
          url: snap.url,
          _status: {
            status: 'OK',
            provedor: 'Archive.org (Wayback)',
            tempoMs: Date.now() - t0,
            mensagem: `Primeiro snapshot histórico em ${ano}`
          }
        };
      } else {
        return {
          temHistorico: false,
          anoPrimeiroSnapshot: null,
          _status: {
            status: 'ALERTA',
            provedor: 'Archive.org (Wayback)',
            tempoMs: Date.now() - t0,
            mensagem: 'Sem histórico arquivado no Wayback Machine'
          }
        };
      }
    }
  } catch (e) {
    console.warn('Wayback erro:', e.message);
  }
  return {
    temHistorico: false,
    anoPrimeiroSnapshot: null,
    _erroTecnico: true,
    _status: {
      status: 'ERRO',
      provedor: 'Archive.org (Wayback)',
      tempoMs: Date.now() - t0,
      mensagem: 'Indisponibilidade / Timeout no Archive.org'
    }
  };
}

async function consultarMx(dominio) {
  const t0 = Date.now();
  if (!dominio) {
    return {
      tipo: 'GENERICO',
      provedor: 'Sem domínio / e-mail genérico',
      _status: {
        status: 'INFO',
        provedor: 'DNS MX',
        tempoMs: 0,
        mensagem: 'E-mail genérico (@gmail/@hotmail) ou sem domínio'
      }
    };
  }
  const limpo = dominio.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim().toLowerCase();
  try {
    const mxList = await dns.resolveMx(limpo);
    if (mxList && mxList.length > 0) {
      const hosts = mxList.map(m => m.exchange.toLowerCase()).join(' ');
      let tipo = 'PROPRIO';
      let provedor = mxList[0].exchange;

      if (hosts.includes('google') || hosts.includes('aspmx') || hosts.includes('googlemail')) {
        tipo = 'PREMIUM';
        provedor = 'Google Workspace';
      } else if (hosts.includes('outlook') || hosts.includes('microsoft') || hosts.includes('protection.outlook')) {
        tipo = 'PREMIUM';
        provedor = 'Microsoft 365';
      } else if (hosts.includes('locaweb') || hosts.includes('kinghost') || hosts.includes('hostgator') || hosts.includes('hostinger') || hosts.includes('cpanel') || hosts.includes('secureserver')) {
        tipo = 'PADRAO';
        provedor = 'Hospedagem Compartilhada';
      }

      return {
        tipo,
        provedor,
        _status: {
          status: 'OK',
          provedor: `DNS MX (${provedor})`,
          tempoMs: Date.now() - t0,
          mensagem: `Servidor MX ${tipo === 'PREMIUM' ? 'Premium (' + provedor + ')' : provedor} verificado`
        }
      };
    }
  } catch (e) {
    const isDomainNotFound = ['ENOTFOUND', 'ENODATA', 'NODATA', 'NXDOMAIN'].includes(e.code);
    if (isDomainNotFound) {
      return {
        tipo: 'NENHUM',
        provedor: 'Sem registro MX ativo',
        _status: {
          status: 'ALERTA',
          provedor: 'DNS MX',
          tempoMs: Date.now() - t0,
          mensagem: 'Domínio sem entradas MX de e-mail ativas'
        }
      };
    }
    return {
      tipo: 'ERRO_REDE',
      provedor: 'Falha de Resolução DNS',
      _erroTecnico: true,
      _status: {
        status: 'ERRO',
        provedor: 'DNS Resolver',
        tempoMs: Date.now() - t0,
        mensagem: `Falha na consulta DNS (${e.message})`
      }
    };
  }
  return {
    tipo: 'NENHUM',
    provedor: 'Sem registro MX ativo',
    _status: {
      status: 'ALERTA',
      provedor: 'DNS MX',
      tempoMs: Date.now() - t0,
      mensagem: 'Sem registro MX ativo'
    }
  };
}

// Função utilitária para consulta de Regularidade do FGTS (CRF) na Caixa via API InfoSimples
async function consultarFgtsInfoSimples(cnpjStr, razaoClienteProtheus = '') {
  if (!cnpjStr) return null;
  const digits = String(cnpjStr).replace(/\D/g, '');
  if (digits.length !== 14) return null;
  const t0 = Date.now();

  // Busca token nas variáveis de ambiente ou nas configurações de score do sistema
  const cfg = typeof getScoreConfig === 'function' ? getScoreConfig() : {};
  const token = (process.env.INFOSIMPLES_TOKEN || cfg.infosimples_token || '').trim();

  if (!token) {
    return {
      executado: false,
      motivo: 'Token da API InfoSimples não configurado. Configure em Configurações de Score ou via INFOSIMPLES_TOKEN.',
      _status: {
        status: 'ALERTA',
        provedor: 'InfoSimples / Caixa',
        tempoMs: 0,
        mensagem: 'Token da API InfoSimples não configurado'
      }
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); // 25s timeout
    
    const postBody = {
      token: token,
      cnpj: digits,
      timeout: 30
    };

    const res = await fetch('https://api.infosimples.com/api/v2/consultas/caixa/crf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Gemini-Cli/1.0'
      },
      body: JSON.stringify(postBody),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (res.ok) {
      const dataJson = await res.json();
      const code = dataJson.code;
      const codeMessage = dataJson.code_message || '';
      const dataList = Array.isArray(dataJson.data) ? dataJson.data : (dataJson.data ? [dataJson.data] : []);

      // Código 200/201: Sucesso na consulta com dados retornados
      if ((code === 200 || code === 201) && dataList.length > 0 && dataList[0]) {
        const item = dataList[0];
        const razaoCaixa = String(item.razao_social || item.nome || '').trim();
        const situacao = String(item.situacao || '').trim().toUpperCase();
        const isRegular = situacao.includes('REGULAR') && !situacao.includes('NÃO') && !situacao.includes('IRREGULAR');
        const validade = item.validade_fim_data || item.validade_fim || '';
        const endereco = item.endereco || '';

        // Comparação de similaridade entre Razão Social da Caixa e do Protheus/Receita
        let razaoFgtsIgual = 'N';
        let similarity = 0;
        if (razaoClienteProtheus && razaoCaixa) {
          const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/\b(LTDA|EIRELI|EPP|ME|SA|S\/A|CIA|COMPANHIA|SOCIEDADE|IND|COM|DISTRIBUIDORA)\b/g, '');
          const n1 = norm(razaoClienteProtheus);
          const n2 = norm(razaoCaixa);
          
          if (n1 === n2 || (n1.length > 3 && n2.length > 3 && (n1.includes(n2) || n2.includes(n1)))) {
            razaoFgtsIgual = 'S';
            similarity = 1.0;
          } else {
            let matches = 0;
            const w1 = razaoClienteProtheus.toUpperCase().split(/\s+/).filter(w => w.length > 2);
            const w2 = razaoCaixa.toUpperCase().split(/\s+/).filter(w => w.length > 2);
            w1.forEach(w => { if (w2.includes(w)) matches++; });
            similarity = w1.length > 0 && w2.length > 0 ? (matches / Math.max(w1.length, w2.length)) : 0;
            razaoFgtsIgual = similarity >= 0.5 ? 'S' : 'N';
          }
        }

        return {
          executado: true,
          encontrado: true,
          fgts_situacao_regular: isRegular ? 'S' : 'N',
          razao_fgts_igual: razaoFgtsIgual,
          razao_social_caixa: razaoCaixa,
          situacao_caixa: situacao,
          validade_crf: validade,
          endereco_caixa: endereco,
          similarity,
          _status: {
            status: isRegular && razaoFgtsIgual === 'S' ? 'OK' : 'ALERTA',
            provedor: 'InfoSimples / Caixa',
            tempoMs: Date.now() - t0,
            mensagem: isRegular ? (razaoFgtsIgual === 'S' ? `CRF Regular (Validade: ${validade || 'Válido'})` : 'Razão Social divergente na Caixa') : 'Certidão Irregular na Caixa'
          }
        };
      }

      // Código 601 / 602 / "não encontrada": Empresa não possui cadastro no FGTS / Nunca registrou funcionários
      if (code === 601 || code === 602 || codeMessage.toLowerCase().includes('não encontrada') || codeMessage.toLowerCase().includes('nao encontrada') || dataList.length === 0) {
        return {
          executado: true,
          encontrado: false,
          fgts_situacao_regular: 'NE',
          razao_fgts_igual: 'NE',
          motivo: 'Empresa não localizada na Caixa (Sem registro de funcionários / Nunca recolheu FGTS)',
          code,
          codeMessage,
          _status: {
            status: 'ALERTA',
            provedor: 'InfoSimples / Caixa',
            tempoMs: Date.now() - t0,
            mensagem: 'Empresa sem funcionários / Nunca recolheu FGTS'
          }
        };
      }

      return {
        executado: false,
        motivo: `InfoSimples retornou código ${code}: ${codeMessage}`,
        code,
        codeMessage,
        _status: {
          status: 'ERRO',
          provedor: 'InfoSimples / Caixa',
          tempoMs: Date.now() - t0,
          mensagem: `InfoSimples código ${code}: ${codeMessage}`
        }
      };
    } else {
      const errText = await res.text();
      return {
        executado: false,
        motivo: `Erro HTTP ${res.status} ao consultar InfoSimples`,
        detalhe: errText,
        _status: {
          status: 'ERRO',
          provedor: 'InfoSimples / Caixa',
          tempoMs: Date.now() - t0,
          mensagem: `Erro HTTP ${res.status} na API InfoSimples`
        }
      };
    }
  } catch (err) {
    console.warn('⚠️ [InfoSimples FGTS] Erro ao consultar API:', err.message);
    return {
      executado: false,
      motivo: `Falha na requisição InfoSimples: ${err.message}`,
      _status: {
        status: 'ERRO',
        provedor: 'InfoSimples / Caixa',
        tempoMs: Date.now() - t0,
        mensagem: `Timeout / Falha de conexão (${err.message})`
      }
    };
  }
}

// 0. Leitura e Validação em Memória do Laudo Serasa Experian (PDF)
app.post('/api/financeiro/analise-credito/parse-serasa-pdf', memoryUpload.single('serasa_pdf'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        error_type: 'ARQUIVO_NAO_ENVIADO',
        error: 'Nenhum arquivo PDF foi enviado. Selecione o relatório Serasa (.pdf).'
      });
    }

    const resultado = await parseSerasaBuffer(req.file.buffer);

    if (!resultado || !resultado.success) {
      return res.status(400).json({
        success: false,
        error_type: resultado.error_type || 'ERRO_VALIDACAO_SERASA',
        error: resultado.error || 'Falha na validação do relatório Serasa.',
        detalhes: resultado
      });
    }

    // Registra atividade no Feed de Auditoria (opcional se logado)
    const authUser = getUserFromReq(req);
    if (authUser && authUser.username && authUser.username !== 'sistema') {
      logUserActivity({
        username: authUser.username,
        userName: authUser.name,
        actionType: 'LEITURA_SERASA_PDF',
        description: `Leu laudo Serasa do CNPJ ${resultado.cnpj || 'N/A'} (${resultado.razao_social || 'N/A'}) - Score: ${resultado.score_serasa_texto || 'N/A'}, Idade: ${resultado.idade_meses} meses`,
        ip: req.ip,
        metadata: { cnpj: resultado.cnpj, score: resultado.score_serasa_texto, data_emissao: resultado.data_emissao }
      }).catch(() => {});
    }

    return res.json({
      success: true,
      data: resultado
    });
  } catch (err) {
    console.error('Erro no endpoint parse-serasa-pdf:', err);
    return res.status(500).json({
      success: false,
      error_type: 'ERRO_INTERNO',
      error: 'Erro interno ao processar o arquivo PDF do Serasa: ' + err.message
    });
  }
});

// 1B. Consulta Direta de FGTS na Caixa via API InfoSimples
app.post('/api/financeiro/analise-credito/consultar-fgts', async (req, res) => {
  try {
    const { cnpj, razao_social } = req.body;
    if (!cnpj) {
      return res.status(400).json({ success: false, error: 'CNPJ é obrigatório para consultar o FGTS.' });
    }
    const resultado = await consultarFgtsInfoSimples(cnpj, razao_social);
    res.json({
      success: true,
      resultado
    });
  } catch (err) {
    console.error('Erro ao consultar FGTS InfoSimples:', err);
    res.status(500).json({ success: false, error: 'Erro ao consultar FGTS: ' + err.message });
  }
});

// 1. Consulta Protheus para auto-preenchimento
app.post('/api/financeiro/analise-credito/protheus', async (req, res) => {
  try {
    const { empresa, numero_pedido } = req.body;
    if (!empresa || !numero_pedido) {
      return res.status(400).json({ success: false, error: 'Empresa e Número do Pedido são obrigatórios.' });
    }

    const pedNormalizado = String(numero_pedido).trim();
    if (!pedNormalizado) {
      return res.status(400).json({ success: false, error: 'Número do pedido não pode ser vazio.' });
    }

    const empKeyMap = {
      "14": "METAL_PLENO",
      "15": "GSI",
      "16": "OACO",
      "METAL_PLENO": "METAL_PLENO",
      "GSI": "GSI",
      "OACO": "OACO"
    };
    const empKey = empKeyMap[String(empresa).trim()] || "METAL_PLENO";

    const t0Protheus = Date.now();
    // Executa busca real no banco de dados Protheus (SC5 / SC6 / SA1 / SE1 / SE4)
    const detalhes = await obterDetalhesPedido(empKey, pedNormalizado);
    const protheusTempoMs = Date.now() - t0Protheus;

    if (!detalhes || !detalhes.encontrado) {
      return res.status(404).json({
        success: false,
        encontrado: false,
        empresa,
        pedido_venda: pedNormalizado,
        error: `Pedido #${pedNormalizado} NÃO existe no Protheus para a Empresa ${empresa}. Verifique o número e tente novamente.`
      });
    }

    const cli = detalhes.cliente || {};
    const tot = detalhes.totais || {};
    const totalVal = Number(tot.totalGeral || tot.totalProdutos || 0);
    const qtdItensTotal = (detalhes.itens || []).reduce((acc, it) => acc + Number(it.qtd || 0), 0);

    // Condição de Pagamento vinda da SE4 (E4_COND e E4_CTRADT)
    const condInfo = detalhes.comercial?.condPagInfo || {};
    const faturadoVal = condInfo.faturado || (detalhes.fiscal?.geraFinanceiro === 'S' ? 'S' : 'N');
    const entradaVal = condInfo.possuiEntrada || 'N';

    // Consulta CNPJ em bases públicas (Fundação, Capital Social e Endereço Oficial)
    let dadosCnpj = null;
    if (cli.cnpj) {
      dadosCnpj = await consultarCnpjPublico(cli.cnpj);
    }

    // Comparação Inteligente de Endereço Protheus vs Receita Federal
    let cadastroIgualReceitaVal = '';
    let comparacaoEnderecoInfo = null;

    if (dadosCnpj && !dadosCnpj._erroTecnico && cli.endereco) {
      const endProtheus = `${cli.endereco} ${cli.bairro || ''} ${cli.cidade || ''} ${cli.uf || ''}`;
      const endReceita = `${dadosCnpj.descricao_tipo_de_logradouro || ''} ${dadosCnpj.logradouro || ''} ${dadosCnpj.numero || ''} ${dadosCnpj.bairro || ''} ${dadosCnpj.municipio || ''} ${dadosCnpj.uf || ''}`;
      const comp = compararEnderecos(endProtheus, endReceita, cli.numero || extrairNumeroEnd(cli.endereco), dadosCnpj.numero, dadosCnpj.complemento, cli.complemento);
      
      cadastroIgualReceitaVal = comp.iguais ? 'S' : 'N';
      comparacaoEnderecoInfo = {
        iguais: comp.iguais,
        similarity: comp.similarity,
        endProtheus: cli.endereco,
        endReceita: dadosCnpj.enderecoCompleto || `${dadosCnpj.logradouro}, ${dadosCnpj.numero}`
      };
    } else if (dadosCnpj && dadosCnpj._erroTecnico) {
      cadastroIgualReceitaVal = 'INDISPONIVEL';
      comparacaoEnderecoInfo = {
        iguais: false,
        similarity: 0,
        endProtheus: cli.endereco || '',
        endReceita: 'Indisponível (Falha nas APIs da Receita)',
        erroTecnico: true
      };
    }

    // Detecção automática de Casa / Sala / Conjunto no endereço/complemento da Receita Federal e Protheus
    let casaSalaVal = 'N';
    if (dadosCnpj && !dadosCnpj._erroTecnico) {
      const textoComplementos = `${dadosCnpj.complemento || ''} ${dadosCnpj.logradouro || ''} ${cli.endereco || ''}`.toUpperCase();
      const regexCasaSala = /\b(CASA|SALA|SL|CONJ|CONJUNTO|CJ|APTO|APT|APARTAMENTO)\b/;
      casaSalaVal = regexCasaSala.test(textoComplementos) ? 'S' : 'N';
    }

    // Detecção se algum item do pedido possui preço/custo unitário maior que R$ 2.000,00
    const temItemUnitarioGt2k = (detalhes.itens || []).some(it => {
      const prcUnit = Number(it.prcUnit || (it.qtd > 0 ? it.total / it.qtd : 0) || 0);
      return prcUnit > 2000;
    });

    const histFin = detalhes.historicoFinanceiro || {};

    // Análise Automática de E-mails & Site Corporativo (A1_EMAIL e A1_HPAGE do Protheus)
    const infoEmails = analisarEmailsCliente(cli.email, cli.site);

    // Consulta de Inteligência Digital Paralela (RDAP Registro.br, Wayback Machine, DNS MX, FGTS InfoSimples)
    let infoRDAP = null;
    let infoWayback = null;
    let infoMx = null;
    let infoFgts = null;

    const cnpjFgts = cli.cnpj || (dadosCnpj && !dadosCnpj._erroTecnico && dadosCnpj.cnpj) || cli.codigo || '';

    const [resRdap, resWayback, resMx, resFgts] = await Promise.allSettled([
      infoEmails.dominioPrincipal ? consultarRDAP(infoEmails.dominioPrincipal) : Promise.resolve(null),
      infoEmails.dominioPrincipal ? consultarWayback(infoEmails.dominioPrincipal) : Promise.resolve(null),
      infoEmails.dominioPrincipal ? consultarMx(infoEmails.dominioPrincipal) : Promise.resolve(null),
      cnpjFgts ? consultarFgtsInfoSimples(cnpjFgts, cli.nome) : Promise.resolve(null)
    ]);
    infoRDAP = resRdap.status === 'fulfilled' ? resRdap.value : null;
    infoWayback = resWayback.status === 'fulfilled' ? resWayback.value : null;
    infoMx = resMx.status === 'fulfilled' ? resMx.value : null;
    infoFgts = resFgts.status === 'fulfilled' ? resFgts.value : null;

    // Detecção Automática de Endereço de Entrega Diferente (Dupla Regra: C5_MENNOTA ou C5_TRANSP = '000009')
    const entregaDiferenteInfo = detalhes.comercial?.entregaDiferenteInfo || detectarEnderecoEntregaDiferente(detalhes.comercial?.observacoes, detalhes.comercial?.codTransp || detalhes.comercial?.transportadora);
    const entregaIgualCadastroVal = entregaDiferenteInfo.temEnderecoDiferente ? 'N' : 'S';

    // Automação Registro.Br (Comparação de Raiz de CNPJ Matriz x Filial)
    const cnpjParaComparacao = cli.cnpj || (dadosCnpj && !dadosCnpj._erroTecnico && dadosCnpj.cnpj) || cli.codigo || '';
    const regBrInfo = compararRegistroBr(cnpjParaComparacao, infoRDAP, infoEmails.dominioPrincipal);

    // Bloco consolidado de Faróis de Conectividade Externa (SRE)
    const statusConexoes = {
      receita: {
        status: dadosCnpj?._status?.status || (cli.cnpj ? 'ERRO' : 'INFO'),
        provedor: dadosCnpj?._status?.provedor || 'BrasilAPI / ReceitaWS',
        tempoMs: dadosCnpj?._status?.tempoMs || 0,
        mensagem: dadosCnpj?._status?.mensagem || (cli.cnpj ? 'Não foi possível consultar a Receita Federal' : 'Sem CNPJ informado')
      },
      registro_br: {
        status: infoRDAP?._status?.status || (infoEmails.dominioPrincipal ? 'INFO' : 'INFO'),
        provedor: infoRDAP?._status?.provedor || 'Registro.br (RDAP)',
        tempoMs: infoRDAP?._status?.tempoMs || 0,
        mensagem: infoRDAP?._status?.mensagem || (infoEmails.dominioPrincipal ? 'Domínio não consultado no Registro.br' : 'Cliente sem domínio cadastrado')
      },
      wayback: {
        status: infoWayback?._status?.status || 'INFO',
        provedor: infoWayback?._status?.provedor || 'Archive.org (Wayback)',
        tempoMs: infoWayback?._status?.tempoMs || 0,
        mensagem: infoWayback?._status?.mensagem || (infoEmails.dominioPrincipal ? 'Sem consulta ao Archive.org' : 'Cliente sem domínio/site')
      },
      dns_mx: {
        status: infoMx?._status?.status || 'INFO',
        provedor: infoMx?._status?.provedor || 'DNS Resolver',
        tempoMs: infoMx?._status?.tempoMs || 0,
        mensagem: infoMx?._status?.mensagem || 'Sem domínio corporativo para checagem MX'
      },
      fgts_caixa: {
        status: infoFgts?._status?.status || (infoFgts?.executado ? 'OK' : 'ALERTA'),
        provedor: infoFgts?._status?.provedor || 'InfoSimples / Caixa',
        tempoMs: infoFgts?._status?.tempoMs || 0,
        mensagem: infoFgts?._status?.mensagem || (infoFgts?.motivo || 'FGTS não executado')
      },
      protheus_db: {
        status: 'OK',
        provedor: 'Railway SQL',
        tempoMs: protheusTempoMs,
        mensagem: `Pedido #${detalhes.numPedido || pedNormalizado} (${empKey}) e histórico SE1 importados`
      }
    };

    res.json({
      success: true,
      encontrado: true,
      empresa,
      pedido_venda: detalhes.numPedido || pedNormalizado,
      cod_web: detalhes.codWeb !== '-' ? detalhes.codWeb : '',
      cliente_codigo: cli.codigo || '',
      cliente_nome: cli.nome || '',
      total_pedido: parseFloat(totalVal.toFixed(2)),
      desconto_ped: tot.totalDesconto > 0 ? `R$ ${tot.totalDesconto.toFixed(2)}` : 'OK',
      faturado: faturadoVal,
      entrada: entradaVal,
      quant_grande: qtdItensTotal > 15 ? 'S' : 'N',
      prod_nao_combinam: 'N',
      armario_cofre_gt_2000: temItemUnitarioGt2k ? 'S' : 'N',
      uf_cliente: (cli.uf || 'SP').toUpperCase().trim(),
      cnpj_ativo: (dadosCnpj && !dadosCnpj._erroTecnico) ? dadosCnpj.cnpjAtivo : '',
      fundacao_matriz: (dadosCnpj && !dadosCnpj._erroTecnico) ? dadosCnpj.fundacao : '',
      capital_social: (dadosCnpj && !dadosCnpj._erroTecnico && dadosCnpj.capitalSocial > 0) ? dadosCnpj.capitalSocial : '',
      receita_offline: Boolean(dadosCnpj && dadosCnpj._erroTecnico),

      // Histórico Financeiro Consolidado das empresas 09, 14, 15 e 16 (Protheus SE1)
      pgtos_abertos: histFin.temPgtosAbertos || 'N',
      comprou_pagou: histFin.comprou2x || 'N',
      comprou_pagou_5x: histFin.comprou5x || 'N',
      total_compras_pagas: histFin.totalComprasPagas || 0,
      total_titulos_abertos: histFin.titulosAbertos || 0,

      // Comparação de endereço inteligente Protheus vs Receita
      cadastro_igual_receita: cadastroIgualReceitaVal,
      comparacao_endereco: comparacaoEnderecoInfo,

      // Detecção de Casa/Sala/Conjunto no endereço
      casa_sala_conj_end: casaSalaVal,

      // Detecção Automática de Endereço de Entrega Diferente (C5_MENNOTA e C5_TRANSP = 000009)
      entrega_igual_cadastro: entregaIgualCadastroVal,
      entrega_diferente_detectada: entregaDiferenteInfo.temEnderecoDiferente,
      entrega_diferente_motivo: entregaDiferenteInfo.motivo,
      entrega_diferente_endereco: entregaDiferenteInfo.enderecoExtraido,
      entrega_diferente_origem: entregaDiferenteInfo.origem,

      // Inteligência Digital e E-mails Automatizados (Seções 3 e 4)
      dominio_principal: infoEmails.dominioPrincipal,
      idade_dominio_rdap: (infoRDAP && !infoRDAP._erroTecnico) ? infoRDAP.idadeAnos : (infoEmails.dominioPrincipal && (!infoRDAP || !infoRDAP._erroTecnico) ? 0 : null),
      idade_dominio_rdap_erro: Boolean(infoRDAP && infoRDAP._erroTecnico),
      ano_criacao_rdap: (infoRDAP && !infoRDAP._erroTecnico) ? infoRDAP.anoCriacao : '',
      wayback_primeiro_snapshot: (infoWayback && !infoWayback._erroTecnico && infoWayback.anoPrimeiroSnapshot) ? infoWayback.anoPrimeiroSnapshot : '',
      wayback_offline: Boolean(infoWayback && infoWayback._erroTecnico),
      servidor_mx: infoMx ? infoMx.provedor : '',
      tipo_servidor_mx: infoMx ? infoMx.tipo : 'NENHUM',
      servidor_mx_offline: Boolean(infoMx && infoMx._erroTecnico),

      // Automação Registro.Br (Comparação Raiz CNPJ)
      registro_br: regBrInfo.valor,
      registro_br_detalhes: regBrInfo,
      cnpj_registro_br: regBrInfo.cnpjRegistroBr || regBrInfo.cpfRegistroBr || '',
      titular_registro_br: regBrInfo.titularRegistroBr || '',

      // Preenchimento automático da Seção 4 (E-mails & Site)
      email_corporativo: infoEmails.emailCorporativo,
      existe_mail_financeiro: infoEmails.mailFinanDiferente,
      mail_gratuito: infoEmails.mailGratuito,
      possui_site: infoEmails.possuiSite,
      emails_encontrados: infoEmails.emailsEncontrados,

      // FGTS & Regularidade do Empregador (InfoSimples API)
      fgts_info: infoFgts,
      fgts_situacao_regular: infoFgts && infoFgts.executado ? (infoFgts.fgts_situacao_regular || '') : '',
      razao_fgts_igual: infoFgts && infoFgts.executado ? (infoFgts.razao_fgts_igual || '') : '',
      razao_social_caixa: infoFgts && infoFgts.executado ? (infoFgts.razao_social_caixa || '') : '',

      // Telemetria SRE de Faróis de Conectividade
      status_conexoes: statusConexoes,

      // Campos manuais que permanecem em branco para o analista
      score_serasa: '',
      protestos: '',
      valor_protestos: '',
      pfin: '',
      ch_sem_fundo: '',
      obs: '',
      decisao_final: 'Liberado',
      mensagem: `Pedido #${detalhes.numPedido || pedNormalizado} encontrado com sucesso no Protheus.`
    });

    // Registra atividade do analista no Feed de Auditoria e atualiza Último Acesso Ativo
    const authUser = getUserFromReq(req);
    if (authUser && authUser.username && authUser.username !== 'sistema') {
      logUserActivity({
        username: authUser.username,
        userName: authUser.name,
        actionType: 'CONSULTA_CREDITO',
        description: `Consultou pedido #${detalhes.numPedido || pedNormalizado} (${empKey}) - Cliente: ${cli.nome || 'N/A'} (R$ ${Number(totalVal).toFixed(2)})`,
        ip: req.ip,
        metadata: { empresa: empKey, pedido: pedNormalizado, total: totalVal }
      }).catch(() => {});
    }
  } catch (err) {
    console.error('Erro ao consultar Protheus na analise de credito:', err);
    res.status(500).json({ success: false, error: 'Erro interno ao consultar o ERP Protheus: ' + err.message });
  }
});

// 2. Obter Configurações do Score
app.get('/api/financeiro/analise-credito/config', (req, res) => {
  const cfg = { ...getScoreConfig() };
  const user = getUserFromReq(req);
  if (!user || user.role !== 'admin') {
    if (cfg.infosimples_token) {
      cfg.infosimples_token = '••••••••••••••••';
    }
  }
  res.json({ success: true, config: cfg });
});

// 3. Salvar Configurações do Score
app.post('/api/financeiro/analise-credito/config', (req, res) => {
  const ok = saveScoreConfig(req.body);
  if (ok) {
    res.json({ success: true, message: 'Configurações de score atualizadas com sucesso.', config: getScoreConfig() });
  } else {
    res.status(500).json({ success: false, error: 'Falha ao salvar configurações.' });
  }
});

// 3.1 Resetar Configurações do Score para Padrão Oficial
app.post('/api/financeiro/analise-credito/config/reset', (req, res) => {
  const def = resetScoreConfig();
  res.json({ success: true, message: 'Parâmetros restaurados com sucesso para os padrões oficiais da planilha.', config: def });
});

// 4. Calcular e Salvar Análise de Crédito
app.post('/api/financeiro/analise-credito/calcular-salvar', async (req, res) => {
  try {
    const dados = req.body;
    if (!dados.pedido_venda || !dados.cliente_nome || dados.total_pedido === undefined) {
      return res.status(400).json({ success: false, error: 'Campos obrigatórios não podem ficar em branco.' });
    }

    const decisao = String(dados.decisao_final || '').trim();
    if (!decisao || decisao === 'Decisão (atenção ao gravar)') {
      return res.status(400).json({ success: false, error: 'Escolha uma decisão antes de gravar.' });
    }

    // Identificação do Usuário Analista (via JWT token ou payload)
    let usuarioLogado = 'Sistema';
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.slice(7) : null;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        usuarioLogado = decoded.name || decoded.username || 'Sistema';
      } catch {}
    }
    if (dados.usuario && usuarioLogado === 'Sistema') {
      usuarioLogado = String(dados.usuario).trim();
    }

    const resultado = calcularScore(dados);
    const dadosParaSalvar = {
      ...dados,
      usuario: usuarioLogado,
      total_score: resultado.totalScore,
      risco: resultado.risco,
      sugestao: resultado.sugestao,
      sugestoes_lista: resultado.sugestoesLista || [],
      alerta_ped_compra: resultado.alertaPedCompra,
      alerta_contrato_entrega: resultado.alertaContratoEntrega,
      alerta_perigo_golpe: resultado.alertaPerigoGolpe,
      alerta_cadastro_receita: resultado.alertaCadastroReceita,
      detalhes_pontos: resultado.detalhesPontos
    };
    dadosParaSalvar.dados_completos = { ...dadosParaSalvar };
    const registroSalvo = await saveAnaliseCreditoDB(dadosParaSalvar);

    // Registra atividade do analista no Feed de Auditoria e atualiza Último Acesso Ativo
    logUserActivity({
      username: usuarioLogado.toLowerCase(),
      userName: usuarioLogado,
      actionType: 'GRAVACAO_CREDITO',
      description: `Gravou análise de crédito do Pedido #${dados.pedido_venda} (Score: ${resultado.totalScore}, Risco: ${resultado.risco}, Decisão: ${decisao})`,
      ip: req.ip,
      metadata: { empresa: dados.empresa, pedido: dados.pedido_venda, score: resultado.totalScore, risco: resultado.risco, decisao }
    }).catch(() => {});

    res.json({
      success: true,
      resultado,
      registro: registroSalvo
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Histórico de Análises
app.get('/api/financeiro/analise-credito/historico', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 200;
    const hist = await getHistoricoCreditoDB(limit);
    res.json({ success: true, historico: hist });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- MÓDULO DE BI EXECUTIVO EMBUTIDO (METABASE EMBEDDED) ---
app.get('/api/bi/dashboard-executivo', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const user = getUserFromReq(req);
    const theme = req.query.theme || 'night';
    const result = generateSignedDashboardUrl({ theme });

    // Registra auditoria de consulta ao BI no feed de auditoria
    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'CONSULTA_BI_EXECUTIVO',
      description: `Acessou o Dashboard Executivo de BI (Configurado: ${result.configured})`,
      ip: req.ip,
      metadata: { configured: result.configured, dashboardId: result.dashboardId }
    }).catch(() => {});

    return res.json(result);
  } catch (err) {
    return handleServerError(res, err, 'Erro ao obter URL do Dashboard Executivo.');
  }
});

app.get('/api/bi/status', requireAuth, requireRole('admin'), (req, res) => {
  return res.json({ success: true, ...getMetabaseConfigStatus() });
});

app.post('/api/bi/sync-faturamento', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const user = getUserFromReq(req);
    const { dataIni, dataFim } = req.body || {};

    const resultado = await sincronizarFaturamentoConsolidado({
      dataIni,
      dataFim,
      triggeredBy: `ADMIN_${user.username.toUpperCase()}`
    });

    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'SYNC_FATURAMENTO_BI',
      description: `Disparou sincronização de faturamento para o BI (Total: ${resultado.count || 0} itens)`,
      ip: req.ip,
      metadata: { count: resultado.count, duracao_ms: resultado.duracao_ms, success: resultado.success }
    }).catch(() => {});

    if (resultado.success) {
      return res.json({
        success: true,
        message: 'Faturamento sincronizado com sucesso para o Metabase!',
        data: resultado
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Erro durante a sincronização de faturamento: ' + (resultado.error || 'Falha desconhecida'),
        data: resultado
      });
    }
  } catch (err) {
    return handleServerError(res, err, 'Erro ao sincronizar faturamento.');
  }
});

app.get('/api/bi/faturamento-stats', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const stats = await getFaturamentoHistoricoStats();
    const ultimoLog = await getUltimoSyncFaturamentoLog();
    return res.json({
      success: true,
      stats,
      ultimoLog
    });
  } catch (err) {
    return handleServerError(res, err, 'Erro ao obter estatísticas de faturamento.');
  }
});

// --- ROTAS DO MÓDULO DE ÍNDICES FINANCEIROS DE LIQUIDEZ (BI EXECUTIVO) ---
let lastIndicesSyncTimestamp = 0;
const INDICES_SYNC_COOLDOWN_MS = 60 * 1000; // 1 minuto entre sincronizações manuais

app.get('/api/bi/indices', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const user = getUserFromReq(req);
    const dados = await obterDadosIndicesCalculados();
    
    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'CONSULTA_INDICES_LIQUIDEZ',
      description: 'Consultou os Índices Financeiros de Liquidez (LC, LS, LI)',
      ip: req.ip,
      metadata: { source: dados.source }
    }).catch(() => {});

    return res.json({
      success: true,
      ...dados
    });
  } catch (err) {
    return handleServerError(res, err, 'Erro ao consultar índices financeiros de liquidez.');
  }
});

app.post('/api/bi/indices/sync', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const user = getUserFromReq(req);
    const now = Date.now();

    if (now - lastIndicesSyncTimestamp < INDICES_SYNC_COOLDOWN_MS) {
      const waitSec = Math.ceil((INDICES_SYNC_COOLDOWN_MS - (now - lastIndicesSyncTimestamp)) / 1000);
      return res.status(429).json({
        success: false,
        message: `Sincronização em cooldown. Por favor, aguarde ${waitSec} segundos para nova requisição.`
      });
    }

    lastIndicesSyncTimestamp = now;
    const resultado = await sincronizarIndicesCompleto({
      triggeredBy: `ADMIN_${user.username.toUpperCase()}`
    });

    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'SYNC_INDICES_LIQUIDEZ',
      description: `Disparou sincronização manual dos Índices de Liquidez (Sucesso: ${resultado.success})`,
      ip: req.ip,
      metadata: { duracaoMs: resultado.duracaoMs, totais: resultado.totais }
    }).catch(() => {});

    if (resultado.success) {
      return res.json({
        success: true,
        message: 'Índices financeiros sincronizados com sucesso a partir do Protheus!',
        data: resultado
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Erro durante a sincronização de índices: ' + (resultado.error || 'Falha desconhecida'),
        data: resultado
      });
    }
  } catch (err) {
    return handleServerError(res, err, 'Erro ao sincronizar índices financeiros.');
  }
});

app.get('/api/bi/indices/drilldown', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const tipo = req.query.tipo || 'bancos';
    const empresa = req.query.empresa || 'ALL';
    const search = req.query.search || '';
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;

    const detalhes = await obterDetalhesIndicesDrilldown({
      tipo,
      empresa,
      search,
      limit,
      offset
    });

    return res.json({
      success: true,
      ...detalhes
    });
  } catch (err) {
    return handleServerError(res, err, 'Erro ao obter detalhes de drilldown dos índices.');
  }
});

app.get('/api/bi/indices/historico', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const empresa = req.query.empresa || 'ALL';
    const dias = parseInt(req.query.dias, 10) || 30;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    const hist = await obterHistoricoIndices({ empresa, dias, limit });

    return res.json({
      success: true,
      ...hist
    });
  } catch (err) {
    return handleServerError(res, err, 'Erro ao consultar série temporal histórica dos índices.');
  }
});

/**
 * Agendador Automático: Sincronização de Saldos em Estoque
 * Executa de Segunda a Sexta, das 07:00 às 19:00 (Horário de Brasília), a cada 1 hora
 */
let estoqueSyncJobInterval = null;

function startEstoqueSyncJob() {
  if (estoqueSyncJobInterval) return;

  const verificarEExecutarSync = async () => {
    try {
      // Converte data/hora para fuso de Brasília (America/Sao_Paulo)
      const nowStr = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
      const nowBrasilia = new Date(nowStr);
      const diaSemana = nowBrasilia.getDay(); // 0 = Dom, 1 = Seg, ..., 5 = Sex, 6 = Sab
      const hora = nowBrasilia.getHours();

      // Regra: Segunda a Sexta (1 a 5), entre 07h e 19h
      if (diaSemana >= 1 && diaSemana <= 5 && hora >= 7 && hora <= 19) {
        console.log(`⏰ [Job Estoque] Executando sincronização programada (Brasília: ${hora}h)...`);
        await sincronizarSaldosEstoqueProtheus({ triggeredBy: 'JOB_AUTO' });
      }
    } catch (e) {
      console.warn('⚠️ [Job Estoque] Erro na rotina agendada de sincronização:', e.message);
    }
  };

  // Checa a cada 180 minutos (3 horas)
  estoqueSyncJobInterval = setInterval(verificarEExecutarSync, 180 * 60 * 1000);
  if (estoqueSyncJobInterval.unref) {
    estoqueSyncJobInterval.unref();
  }

  // Executa uma sincronização inicial em background após 3 segundos se o cache/tabela não possuir dados reais
  setTimeout(async () => {
    try {
      const ultimo = await getUltimoSyncEstoqueLog();
      const needsSync = !ultimo || Number(ultimo.total_produtos || 0) < 10 || ultimo.triggered_by === 'TEST_SUITE';
      if (needsSync) {
        console.log('📦 [Job Estoque] Carga inicial necessária. Executando sincronização completa do Protheus...');
        await sincronizarSaldosEstoqueProtheus({ triggeredBy: 'JOB_STARTUP' });
      }
    } catch (e) {
      console.warn('⚠️ [Job Estoque] Falha na sincronização de startup:', e.message);
    }
  }, 3000);
}

/**
 * ----------------------------------------------------------------------------
 * JOB DE SINCRONIZAÇÃO PERIÓDICA DOS ÍNDICES FINANCEIROS DE LIQUIDEZ (SUPABASE / CACHE)
 * ----------------------------------------------------------------------------
 */
let indicesSyncJobInterval = null;

function startIndicesSyncJob() {
  if (indicesSyncJobInterval) return;

  const verificarEExecutarSyncIndices = async () => {
    try {
      const nowStr = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
      const nowBrasilia = new Date(nowStr);
      const diaSemana = nowBrasilia.getDay(); // 1 a 5 (Seg a Sex)
      const hora = nowBrasilia.getHours();

      // Executa de Segunda a Sexta, entre 07h e 19h no horário de Brasília
      if (diaSemana >= 1 && diaSemana <= 5 && hora >= 7 && hora <= 19) {
        console.log(`⏰ [Job Índices] Executando sincronização programada de índices (Brasília: ${hora}h)...`);
        await sincronizarIndicesCompleto({ triggeredBy: 'JOB_AUTO' });
      }
    } catch (e) {
      console.warn('⚠️ [Job Índices] Erro na rotina agendada de sincronização de índices:', e.message);
    }
  };

  // Checa a cada 180 minutos (3 horas)
  indicesSyncJobInterval = setInterval(verificarEExecutarSyncIndices, 180 * 60 * 1000);
  if (indicesSyncJobInterval.unref) {
    indicesSyncJobInterval.unref();
  }

  // Executa uma sincronização inicial em background após 5 segundos no startup
  setTimeout(async () => {
    try {
      console.log('📊 [Job Índices] Verificando dados de índices financeiros no startup...');
      await sincronizarIndicesCompleto({ triggeredBy: 'JOB_STARTUP' });
    } catch (e) {
      console.warn('⚠️ [Job Índices] Falha na sincronização de startup dos índices:', e.message);
    }
  }, 5000);
}

if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`=================================================`);
    console.log(`🚀 Portal Faturas & Protheus Multi-Empresa (14/15/16) rodando na porta ${PORT}`);
    console.log(`👉 Acesse: http://localhost:3000`);
    console.log(`=================================================`);
    await initPostgres();
    startEstoqueSyncJob();
    startIndicesSyncJob();
  });
}

module.exports = app;

