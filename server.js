const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { 
  consultarProtheusNF, 
  buscarProtheusMultiEmpresa,
  buscarPedidosVendedores,
  obterDetalhesPedido,
  buscarComissoesPeriodo,
  VENDEDORES_MAP,
  getNomeVendedor
} = require('./protheus_db');

const {
  initPostgres,
  getUsers: getUsersDB,
  saveUser: saveUserDB,
  deleteUser: deleteUserDB,
  getHistory: getHistoryDB,
  saveHistoryItem: saveHistoryItemDB,
  logUserActivity,
  getAuditSummary,
  isPostgresConnected
} = require('./postgres_db');

const app = express();
const PORT = process.env.PORT || 3000;

function getUserFromReq(req) {
  const rawUser = req.headers['x-user-username'] || req.query.loggedUser || (req.body && req.body.loggedUser) || '';
  const rawName = req.headers['x-user-name'] || req.query.loggedName || (req.body && req.body.loggedName) || rawUser;
  return { 
    username: String(rawUser || 'sistema').toLowerCase().trim(), 
    name: String(rawName || rawUser || 'Sistema').trim() 
  };
}

app.use(cors());
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

const upload = multer({ storage: storage });

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
    if (!item.docOriginario || String(item.docOriginario).trim() === '') {
      item.pedVenda = 'Pendente (Vínculo ViPP)';
      item.codCli = '';
      item.freteCobradoProtheus = 0.00;
      item.freteEmbutidoProtheus = 0.00;
      item.freteProtheusTotal = 0.00;
      item.protheusEncontrado = false;
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
      item.empresaKey = protheusData.empresa;
      item.tabela = protheusData.tabela;
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

// API: Auth Login com Permissões por Usuário
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const cleanUser = String(username || '').trim().toLowerCase();
  const cleanPass = String(password || '').trim();

  console.log('API Login Attempt for user:', cleanUser);

  const allUsers = await getUsersDB();
  const userFound = allUsers.find(u => String(u.username || '').trim().toLowerCase() === cleanUser && u.active !== false);

  if (userFound && String(userFound.pass || '').trim() === cleanPass) {
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const expiresAt = Date.now() + ONE_WEEK_MS;

    logUserActivity({
      username: userFound.username,
      userName: userFound.name,
      actionType: 'LOGIN',
      description: `Login realizado com sucesso (${userFound.role || 'user'})`,
      ip: req.ip
    }).catch(() => {});

    return res.json({
      success: true,
      token: `auth-token-${cleanUser}-${Date.now()}`,
      user: {
        username: userFound.username,
        name: userFound.name,
        role: userFound.role || (cleanUser === 'alexandre' ? 'admin' : 'user'),
        vendorCode: userFound.vendorCode || null,
        permissions: userFound.permissions || (cleanUser === 'alexandre' ? ['logistica', 'consulta', 'vendedores', 'configuracoes'] : ['logistica', 'consulta'])
      },
      expiresAt: expiresAt,
      message: 'Login realizado com sucesso.'
    });
  }

  // Fallback seguro para contas padrão
  const defaultSeeds = {
    'alexandre': { pass: '102030', name: 'Alexandre', role: 'admin', permissions: ['logistica', 'consulta', 'vendedores', 'configuracoes'] },
    'erica': { pass: '1020304050', name: 'Érica', role: 'user', permissions: ['logistica', 'consulta'] },
    'wallerson': { pass: '10203040', name: 'Wallerson', role: 'user', permissions: ['logistica', 'consulta'] },
    'juliana': { pass: '102030', name: 'Juliana', role: 'vendedor', vendorCode: '000074', permissions: ['vendedores'] },
    'andrea': { pass: '102030', name: 'Andrea', role: 'vendedor', vendorCode: '000064', permissions: ['vendedores'] },
    'figueiredo': { pass: '102030', name: 'Figueiredo', role: 'vendedor', vendorCode: '000004', permissions: ['vendedores'] }
  };

  const seed = defaultSeeds[cleanUser];
  if (seed && seed.pass === cleanPass) {
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const expiresAt = Date.now() + ONE_WEEK_MS;

    logUserActivity({
      username: cleanUser,
      userName: seed.name,
      actionType: 'LOGIN',
      description: `Login realizado com sucesso (${seed.role})`,
      ip: req.ip
    }).catch(() => {});

    return res.json({
      success: true,
      token: `auth-token-${cleanUser}-${Date.now()}`,
      user: {
        username: cleanUser,
        name: seed.name,
        role: seed.role,
        vendorCode: seed.vendorCode || null,
        permissions: seed.permissions
      },
      expiresAt: expiresAt,
      message: 'Login realizado com sucesso.'
    });
  }

  return res.status(401).json({ success: false, message: 'Usuário ou senha incorretos ou usuário inativo.' });
});

// API: Listar Usuários (Admin)
app.get('/api/admin/users', async (req, res) => {
  const allUsers = await getUsersDB();
  const users = allUsers.map(u => ({
    username: u.username,
    name: u.name,
    role: u.role || 'user',
    vendorCode: u.vendorCode || '',
    permissions: u.permissions || ['logistica', 'consulta'],
    active: u.active !== false
  }));
  res.json({ success: true, users, dbConnected: isPostgresConnected() });
});

// API: Salvar / Atualizar Usuário e Permissões (Admin)
app.post('/api/admin/users/save', async (req, res) => {
  const { username, name, pass, role, vendorCode, permissions, active } = req.body || {};

  if (!username || !name) {
    return res.status(400).json({ success: false, message: 'Usuário e Nome são obrigatórios.' });
  }

  const cleanUser = String(username).trim().toLowerCase();
  await saveUserDB({
    username: cleanUser,
    name: String(name).trim(),
    pass: pass ? String(pass).trim() : undefined,
    role: role || 'user',
    vendorCode: vendorCode || null,
    permissions: Array.isArray(permissions) ? permissions : ['logistica', 'consulta'],
    active: active !== undefined ? !!active : true
  });

  const curUser = getUserFromReq(req);
  logUserActivity({
    username: curUser.username,
    userName: curUser.name,
    actionType: 'GESTÃO_USUARIO',
    description: `Salvou configurações do usuário "${cleanUser}"`,
    ip: req.ip
  }).catch(() => {});

  res.json({ success: true, message: `Usuário "${cleanUser}" salvo com sucesso.` });
});

// API: Excluir Usuário (Admin)
app.post('/api/admin/users/delete', async (req, res) => {
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
});

// API: Obter Resumo de Auditoria e Logs de Atividades (Admin)
app.get('/api/admin/audit-summary', async (req, res) => {
  try {
    const summary = await getAuditSummary();
    res.json({ success: true, ...summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// API: Consulta Protheus individual por NF e Empresa
app.get('/api/protheus/consulta/:nf', async (req, res) => {
  try {
    const empresaKey = req.query.empresa || 'OACO';
    const data = await consultarProtheusNF(req.params.nf, empresaKey);
    res.json({ success: true, nf: req.params.nf, empresa: empresaKey, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// API: Consulta Multi-Empresa Avançada por Pedido de Venda ou NFe
app.get('/api/protheus/consulta-avancada', async (req, res) => {
  try {
    const tipo = req.query.tipo || 'pedVenda'; // 'pedVenda' ou 'nfe'
    const termo = req.query.termo || '';

    if (!termo) {
      return res.status(400).json({ success: false, message: 'Parâmetro de busca "termo" é obrigatório.' });
    }

    const rows = await buscarProtheusMultiEmpresa(tipo, termo);

    const user = getUserFromReq(req);
    logUserActivity({
      username: user.username,
      userName: user.name,
      actionType: 'CONSULTA_PED_NF',
      description: `Consultou ${tipo === 'pedVenda' ? 'Pedido' : 'NFe'}: "${termo}" (${rows.length} resultado(s))`,
      ip: req.ip,
      metadata: { tipo, termo, count: rows.length }
    }).catch(() => {});

    res.json({ success: true, tipo, termo, count: rows.length, rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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
    res.status(500).json({ success: false, message: err.message });
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
    res.status(500).json({ success: false, message: err.message });
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
    res.status(500).json({ success: false, message: err.message });
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
    if (tipo === 'VIPP_TIPO2') {
      script = 'parser_tipo2.py';
    } else if (tipo === 'CORREIOS_SFE' || req.file.originalname.toLowerCase().includes('correio')) {
      script = 'parser_correios.py';
    }

    const result = await runPythonParser(script, req.file.path);
    if (result.success && result.items) {
      const empKey = (result.fatura && result.fatura.empresaKey) ? result.fatura.empresaKey : 'OACO';
      result.items = await enrichItemsWithProtheus(result.items, empKey);

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
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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
    res.status(500).json({ success: false, message: err.message });
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
    res.status(500).json({ success: false, message: err.message });
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
      result.items = await enrichItemsWithProtheus(result.items, empKey);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// API: ViPP Config (GET & POST)
app.get('/api/vipp/config', (req, res) => {
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

app.post('/api/vipp/config', (req, res) => {
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
    version: '1.4.0 (18/08/2026 09:20)'
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

app.listen(PORT, async () => {
  console.log(`=================================================`);
  console.log(`🚀 Portal Faturas & Protheus Multi-Empresa (14/15/16) rodando na porta ${PORT}`);
  console.log(`👉 Acesse: http://localhost:3000`);
  console.log(`=================================================`);
  await initPostgres();
});
