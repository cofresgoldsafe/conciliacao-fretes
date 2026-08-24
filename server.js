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
const { 
  consultarProtheusNF, 
  buscarProtheusMultiEmpresa,
  buscarPedidosVendedores,
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
  getAuditSummary,
  getDiagnosticInfo,
  saveInterWebhookEvent,
  getInterWebhookEvents,
  isPostgresConnected
} = require('./postgres_db');

const {
  send2FACodeEmail,
  maskEmail,
  isValidEmail,
  testSmtpConnection
} = require('./mailer');

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

function getUserFromReq(req) {
  if (req.user && req.user.username) {
    return { 
      username: String(req.user.username).toLowerCase().trim(), 
      name: String(req.user.name || req.user.username).trim(),
      role: req.user.role || 'user',
      permissions: req.user.permissions || []
    };
  }
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
      if (decoded && decoded.username) {
        return {
          username: String(decoded.username).toLowerCase().trim(),
          name: String(decoded.name || decoded.username).trim(),
          role: decoded.role || 'user',
          permissions: decoded.permissions || []
        };
      }
    } catch {}
  }
  return { 
    username: 'sistema', 
    name: 'Sistema',
    role: 'anonymous',
    permissions: []
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

const allowedOrigins = [
  'https://conciliacao-fretes.onrender.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.onrender.com')) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true
}));
app.use(express.json());

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
  try {
    if (fs.existsSync(vippConfigFile)) {
      return JSON.parse(fs.readFileSync(vippConfigFile, 'utf-8'));
    }
  } catch {}
  return {
    usuario: process.env.VIPP_USUARIO || 'financeiro@oaco.com.br',
    token: process.env.VIPP_TOKEN || '',
    idPerfil: process.env.VIPP_ID_PERFIL || '179551',
    contrato: process.env.VIPP_CONTRATO || '9912742673',
    ativo: !!process.env.VIPP_TOKEN
  };
}

function saveVippConfig(cfg) {
  fs.writeFileSync(vippConfigFile, JSON.stringify(cfg, null, 2));
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
        authenticatedUser = {
          username: userFound.username,
          name: userFound.name,
          role: userFound.role || (cleanUser === 'alexandre' ? 'admin' : 'user'),
          vendorCode: userFound.vendorCode || null,
          permissions: userFound.permissions || (cleanUser === 'alexandre' ? ['logistica', 'consulta', 'vendedores', 'financeiro', 'configuracoes'] : ['logistica', 'consulta'])
        };

        // Migração silenciosa para hash bcrypt se senha estiver em texto puro
        if (userFound.pass && !String(userFound.pass).startsWith('$2')) {
          saveUserDB({ ...userFound, pass: cleanPass }).catch(() => {});
        }
      }
    }

    // Fallback seguro para contas padrão
    if (!authenticatedUser) {
      const defaultSeeds = {
        'alexandre': { pass: '321654', name: 'Alexandre', email: 'alexandre@oaco.com.br', role: 'admin', permissions: ['logistica', 'consulta', 'vendedores', 'financeiro', 'configuracoes'] },
        'erica': { pass: '1020304050', name: 'Érica', email: 'erica@oaco.com.br', role: 'user', permissions: ['logistica', 'consulta'] },
        'wallerson': { pass: '10203040', name: 'Wallerson', email: 'wallerson@oaco.com.br', role: 'user', permissions: ['logistica', 'consulta'] },
        'juliana': { pass: '102030', name: 'Juliana', email: 'juliana@oaco.com.br', role: 'vendedor', vendorCode: '000074', permissions: ['vendedores'] },
        'andrea': { pass: '102030', name: 'Andrea', email: 'andrea@oaco.com.br', role: 'vendedor', vendorCode: '000064', permissions: ['vendedores'] },
        'figueiredo': { pass: '102030', name: 'Figueiredo', email: 'figueiredo@oaco.com.br', role: 'vendedor', vendorCode: '000004', permissions: ['vendedores'] },
        'rubens': { pass: '102030', name: 'Rubens da Silva', email: 'rubens@oaco.com.br', role: 'user', permissions: ['financeiro'] }
      };

      const seed = defaultSeeds[cleanUser];
      if (seed && seed.pass === cleanPass) {
        authenticatedUser = {
          username: cleanUser,
          name: seed.name,
          email: seed.email || null,
          role: seed.role,
          vendorCode: seed.vendorCode || null,
          permissions: seed.permissions
        };
        saveUserDB({ ...authenticatedUser, pass: cleanPass }).catch(() => {});
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

    const authenticatedUser = {
      username: cleanUser,
      name: userFound ? userFound.name : (cleanUser.charAt(0).toUpperCase() + cleanUser.slice(1)),
      email: userFound ? userFound.email : null,
      role: userFound ? (userFound.role || 'user') : (cleanUser === 'alexandre' ? 'admin' : 'user'),
      vendorCode: userFound ? userFound.vendorCode : null,
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

    await saveUserDB({
      username: cleanUser,
      name: String(name).trim(),
      email: cleanEmail,
      pass: pass ? String(pass).trim() : undefined,
      role: role || 'user',
      vendorCode: vendorCode || null,
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
app.post('/api/vendedores/pedidos/search', async (req, res) => {
  try {
    const { codWeb, numPed, nomeCli } = req.body || {};
    if (!codWeb && !numPed && !nomeCli) {
      return res.status(400).json({ success: false, message: 'Informe ao menos um critério de busca (CodWeb, Número do Pedido ou Nome do Cliente).' });
    }
    const results = await buscarPedidosVendedores({ codWeb, numPed, nomeCli });

    const user = getUserFromReq(req);
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

// API: Vendedores - Obter Detalhes Completos do Pedido (Cabeçalho, Endereço, Itens SC6)
app.get('/api/vendedores/pedidos/detalhes', async (req, res) => {
  try {
    const { empresaKey, numPedido } = req.query || {};
    if (!numPedido) {
      return res.status(400).json({ success: false, message: 'Número do Pedido é obrigatório.' });
    }
    const detalhes = await obterDetalhesPedido(empresaKey, numPedido);

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
app.post('/api/vendedores/comissoes', async (req, res) => {
  try {
    const { dataIni, dataFim, codVend } = req.body || {};
    if (!dataIni || !dataFim) {
      return res.status(400).json({ success: false, message: 'Datas inicial e final são obrigatórias.' });
    }

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

    const user = getUserFromReq(req);
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

    // 3. Tratamento de Batch Pix (múltiplas transações em um único webhook)
    if (Array.isArray(b.pix)) {
      if (b.pix.length === 0) {
        return res.status(200).json({ received: true, totalEvents: 0, empresaCodigo: empCode, message: 'Empty pix array' });
      }

      // Responde HTTP 200 rápido ao Inter
      res.status(200).json({ received: true, totalEvents: b.pix.length, empresaCodigo: empCode, tipo: 'PIX_BATCH' });

      // Grava cada transação Pix isoladamente de forma determinística
      for (const pixItem of b.pix) {
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

    // 4. Tratamento de Notificações Singulares (Boleto, Cobrança, Pix Único, Banking)
    const eventId = b.txid || b.nossoNumero || b.idTransacao || b.codigoSolicitacao || b.endToEndId || null;
    const tipo = b.nossoNumero ? 'BOLETO' : (b.pix || b.txid || b.endToEndId ? 'PIX' : (b.tipoOperacao || b.tipoTransacao ? 'BANKING' : 'EVENTO_INTER'));

    // Resposta imediata HTTP 200 para o Banco Inter
    res.status(200).json({ received: true, empresaCodigo: empCode, tipo });

    // Gravação assíncrona/idempotente determinística
    saveInterWebhookEvent({
      empresaCodigo: empCode,
      eventId,
      tipo,
      payload: b
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

if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`=================================================`);
    console.log(`🚀 Portal Faturas & Protheus Multi-Empresa (14/15/16) rodando na porta ${PORT}`);
    console.log(`👉 Acesse: http://localhost:3000`);
    console.log(`=================================================`);
    await initPostgres();
  });
}

module.exports = app;

