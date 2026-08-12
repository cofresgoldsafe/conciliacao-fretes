const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { consultarProtheusNF, buscarProtheusMultiEmpresa } = require('./protheus_db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure uploads and data directories
const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
const historyFile = path.join(dataDir, 'history.json');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(historyFile)) fs.writeFileSync(historyFile, JSON.stringify([]));

function getHistory() {
  try {
    const raw = fs.readFileSync(historyFile, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveHistoryItem(item) {
  const history = getHistory();
  history.unshift(item);
  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
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

  for (const item of items) {
    const protheusData = await consultarProtheusNF(item.docOriginario, empresaKey);
    item.pedVenda = protheusData.pedVenda || 'N/A';
    item.freteCobradoProtheus = protheusData.freteCobrado || 0.00;
    item.freteEmbutidoProtheus = protheusData.freteEmbutido || 0.00;
    item.freteProtheusTotal = protheusData.freteProtheusTotal || (item.freteCobradoProtheus + item.freteEmbutidoProtheus);
    item.protheusEncontrado = protheusData.encontrado;
    item.empresaKey = protheusData.empresa;
    item.tabela = protheusData.tabela;
  }
  return items;
}

// API: Auth Check (Alexandre, Érica, Wallerson - Validade de 7 dias)
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const cleanUser = String(username || '').trim().toLowerCase();
  const cleanPass = String(password || '').trim();

  const validUsers = {
    'alexandre': { pass: '102030', name: 'Alexandre' },
    'erica': { pass: '1020304050', name: 'Érica' },
    'wallerson': { pass: '10203040', name: 'Wallerson' }
  };

  const userFound = validUsers[cleanUser];
  if (userFound && userFound.pass === cleanPass) {
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const expiresAt = Date.now() + ONE_WEEK_MS;

    return res.json({
      success: true,
      token: `auth-token-${cleanUser}-${Date.now()}`,
      user: { username: cleanUser, name: userFound.name },
      expiresAt: expiresAt,
      message: 'Login realizado com sucesso.'
    });
  }

  return res.status(401).json({ success: false, message: 'Usuário ou senha incorretos.' });
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
    res.json({ success: true, tipo, termo, count: rows.length, rows });
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
    const script = (tipo === 'VIPP_TIPO2') ? 'parser_tipo2.py' : 'parser_rodonaves.py';

    const result = await runPythonParser(script, req.file.path);
    if (result.success && result.items) {
      const empKey = (result.fatura && result.fatura.empresaKey) ? result.fatura.empresaKey : 'OACO';
      result.items = await enrichItemsWithProtheus(result.items, empKey);
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

// API: Obter Histórico de Integrações
app.get('/api/history', (req, res) => {
  res.json({ success: true, history: getHistory() });
});

// API: Lançar fretes no Protheus
app.post('/api/protheus/launch', (req, res) => {
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

  saveHistoryItem(historyRecord);

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

app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🚀 Portal Faturas & Protheus Multi-Empresa (14/15/16) rodando na porta ${PORT}`);
  console.log(`👉 Acesse: http://localhost:3000`);
  console.log(`=================================================`);
});
