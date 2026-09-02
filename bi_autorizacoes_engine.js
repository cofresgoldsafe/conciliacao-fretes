/**
 * bi_autorizacoes_engine.js
 * Motor Determinístico de Autorização de Desconto e Margem (BI Executivo)
 * Integração Pipedrive CRM <-> TOTVS Protheus ERP (SB1090, SA1010) <-> Supabase
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

const https = require('https');
const http = require('http');
const { executeRailwayQuery } = require('./protheus_db');

const RAILWAY_API_URL = process.env.RAILWAY_BASE_URL || 'https://protheus-api-production.up.railway.app';
const RAILWAY_API_KEY = process.env.PROTHEUS_API_KEY || process.env.RAILWAY_API_KEY || (process.env.NODE_ENV === 'production' ? '' : 'ProtheusClaude#2026');
const PIPEDRIVE_API_TOKEN = process.env.PIPEDRIVE_API_TOKEN || '27c8e6f7f9bccd60101889f25369f6075e30f615';
const PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';

// Hashes oficiais de campos customizados do Pipedrive (conforme manual técnico)
const COND_PGTO_KEY = 'bdbc4635c15ed6d0add5748159b3a0b1f1b4b5a7';
const FRETE_EMBUTIDO_KEY = 'cd279b000a096a971341df192fba61a673ed87d2';

// Cache em memória para labels de condições de pagamento do Pipedrive (TTL 10 min)
let _condPgtoCache = new Map();
let _condPgtoCacheTime = 0;

/**
 * Utilitário HTTP para chamadas REST seguras
 */
function fetchHttpJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Gemini-Cli-BI-Autorizacoes/1.0',
        ...(options.headers || {})
      },
      timeout: options.timeout || 15000
    };

    let postBody = null;
    if (options.body) {
      postBody = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(postBody);
    }

    const req = client.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (e) {
            resolve({ raw: data, status: res.statusCode });
          }
        } else {
          let errDetail = data;
          try {
            const errJson = JSON.parse(data);
            errDetail = errJson.detail || errJson.message || errJson.error || data;
          } catch {}
          reject(new Error(`HTTP ${res.statusCode}: ${errDetail}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout de conexão com o serviço externo'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (postBody) {
      req.write(postBody);
    }
    req.end();
  });
}

/**
 * Extrai o ID numérico do Deal a partir de string, número ou URL completa do Pipedrive
 * Trata URLs complexas com query params (?user_id=4), hashes (#details), prefixos ("deal 25238") ou números puros
 * Ex: "https://benetroncomercial.pipedrive.com/deal/25238?user=1" -> 25238
 */
function extrairDealId(input) {
  if (input === null || input === undefined) return null;
  const str = String(input).trim();
  if (!str) return null;

  // 1. Padrão URL do Pipedrive: /deal/25238
  const dealUrlMatch = str.match(/\/deal\/(\d+)/i);
  if (dealUrlMatch && dealUrlMatch[1]) {
    return parseInt(dealUrlMatch[1], 10);
  }

  // 2. Padrão textual: "deal 25238", "Deal #25238", "#25238"
  const dealWordMatch = str.match(/deal\s*#?\s*(\d+)/i);
  if (dealWordMatch && dealWordMatch[1]) {
    return parseInt(dealWordMatch[1], 10);
  }

  // 3. Fallback: Primeiro bloco de dígitos isolado
  const match = str.match(/\b\d+\b/);
  if (match) {
    return parseInt(match[0], 10);
  }

  return null;
}

/**
 * Extrai e normaliza o código do Protheus a partir do código do produto no Pipedrive
 * Regra: Descartar tudo antes e inclusive o hífen (XX-YYYYYYYYYYYYYYY -> YYYYYYYYYYYYYYY)
 * Ex: "15-01801080802B001" -> "01801080802B001"
 */
function extrairCodigoProtheus(code) {
  if (!code) return '';
  const str = String(code).trim();
  const idx = str.indexOf('-');
  if (idx !== -1) {
    return str.substring(idx + 1).trim().toUpperCase();
  }
  return str.toUpperCase();
}

/**
 * Resolve o label legível da condição de pagamento (ex: 43380 -> "015-APPMAX")
 */
async function getCondicaoPagamentoLabel(optionId) {
  if (!optionId) return 'Não informada';
  const optId = parseInt(optionId, 10);
  if (isNaN(optId)) return String(optionId);

  // 1. Tenta cache em memória (10 minutos)
  const now = Date.now();
  if (_condPgtoCache.has(optId) && (now - _condPgtoCacheTime < 10 * 60 * 1000)) {
    return _condPgtoCache.get(optId);
  }

  // 2. Tenta resolver via Gateway Railway
  try {
    const url = `${RAILWAY_API_URL.replace(/\/query$/, '')}/pipedrive/cond-pagamento/${optId}`;
    const res = await fetchHttpJson(url, {
      headers: { 'X-API-Key': RAILWAY_API_KEY },
      timeout: 8000
    });
    if (res && res.label) {
      _condPgtoCache.set(optId, res.label);
      _condPgtoCacheTime = now;
      return res.label;
    }
  } catch (err) {
    console.warn(`⚠️ [Autorizações] Falha ao consultar label de pagamento via Railway: ${err.message}`);
  }

  // 3. Fallback: consulta direta /dealFields no Pipedrive
  try {
    const url = `${PIPEDRIVE_BASE_URL}/dealFields?api_token=${PIPEDRIVE_API_TOKEN}&limit=100`;
    const res = await fetchHttpJson(url, { timeout: 8000 });
    if (res && res.data && Array.isArray(res.data)) {
      for (const field of res.data) {
        if (field.key === COND_PGTO_KEY && Array.isArray(field.options)) {
          for (const opt of field.options) {
            _condPgtoCache.set(opt.id, opt.label);
          }
          _condPgtoCacheTime = now;
          if (_condPgtoCache.has(optId)) {
            return _condPgtoCache.get(optId);
          }
        }
      }
    }
  } catch (err) {
    console.warn(`⚠️ [Autorizações] Falha ao consultar dealFields no Pipedrive: ${err.message}`);
  }

  return String(optId);
}

/**
 * Consulta o cadastro de um produto no Protheus (SB1090 / Cadastro Mestre Filial 09)
 */
async function getProdutoProtheus(codigoProtheus) {
  if (!codigoProtheus) return null;
  const cleanCode = String(codigoProtheus).trim().toUpperCase();

  // 1. Tenta Gateway Railway direto
  try {
    const url = `${RAILWAY_API_URL.replace(/\/query$/, '')}/produto/${encodeURIComponent(cleanCode)}?filial=09`;
    const res = await fetchHttpJson(url, {
      headers: { 'X-API-Key': RAILWAY_API_KEY },
      timeout: 8000
    });
    if (res && res.codigo) {
      return {
        codigo: res.codigo,
        descricao: res.descricao || '',
        unidade: res.unidade || 'UN',
        tipo: res.tipo || 'PA',
        grupo: res.grupo || '',
        custo: parseFloat(res.custo) || 0.0,
        precoVenda: parseFloat(res.preco_venda) || 0.0,
        bloqueado: !!res.bloqueado
      };
    }
  } catch (err) {
    // Continua para fallback SQL
  }

  // 2. Fallback: Query SQL via executeRailwayQuery
  try {
    const sql = `
      SELECT TOP 1
        RTRIM(B1_COD) AS codigo,
        RTRIM(B1_DESC) AS descricao,
        RTRIM(B1_UM) AS unidade,
        RTRIM(B1_TIPO) AS tipo,
        RTRIM(B1_GRUPO) AS grupo,
        B1_VLUNIT AS custo,
        B1_PRV1 AS preco_venda,
        B1_MSBLQL AS bloqueado
      FROM SB1090
      WHERE B1_COD = '${cleanCode.replace(/'/g, "''")}'
        AND B1_FILIAL = '01'
        AND D_E_L_E_T_ = ' '
    `;
    const rows = await executeRailwayQuery(sql);
    if (rows && rows.length > 0) {
      const r = rows[0];
      return {
        codigo: r.codigo,
        descricao: r.descricao || '',
        unidade: r.unidade || 'UN',
        tipo: r.tipo || 'PA',
        grupo: r.grupo || '',
        custo: parseFloat(r.custo) || 0.0,
        precoVenda: parseFloat(r.preco_venda) || 0.0,
        bloqueado: r.bloqueado === '1'
      };
    }
  } catch (err) {
    console.warn(`⚠️ [Autorizações] Falha na consulta SQL de produto ${cleanCode}: ${err.message}`);
  }

  return null;
}

/**
 * Verifica se um cliente é identificado como REVENDA no Protheus (SA1010.A1_SATIV1 contendo '000085')
 */
async function checkClienteRevenda(clienteNome, cnpjCpf = '') {
  if (!clienteNome && !cnpjCpf) return false;
  try {
    let whereClause = '';
    if (cnpjCpf) {
      const cleanCgc = String(cnpjCpf).replace(/\D/g, '');
      if (cleanCgc) whereClause = `A1_CGC = '${cleanCgc}'`;
    }
    if (!whereClause && clienteNome) {
      const cleanNome = String(clienteNome).trim().replace(/'/g, "''");
      whereClause = `A1_NOME LIKE '%${cleanNome.substring(0, 20)}%'`;
    }

    if (!whereClause) return false;

    const sql = `
      SELECT TOP 1 A1_SATIV1
      FROM SA1010
      WHERE ${whereClause}
        AND D_E_L_E_T_ = ' '
    `;
    const rows = await executeRailwayQuery(sql);
    if (rows && rows.length > 0) {
      const sativ1 = rows[0].A1_SATIV1 || '';
      return sativ1.includes('000085');
    }
  } catch (err) {
    console.warn(`⚠️ [Autorizações] Erro ao checar revenda SA1010: ${err.message}`);
  }
  return false;
}

/**
 * Executa o cálculo determinístico de Desconto Ponderado e Margem Bruta
 * Regras conforme Seção 7 do manual técnico
 */
function calcularMargemEDesconto({ valorVendaTotal, precoTabelaTotal, custoTotal, freteEmbutido = 0 }) {
  const vVenda = parseFloat(valorVendaTotal) || 0.0;
  const vTabela = parseFloat(precoTabelaTotal) || 0.0;
  const vCusto = parseFloat(custoTotal) || 0.0;
  const vFreteEmpresa = parseFloat(freteEmbutido) || 0.0;

  // 1. O frete da empresa é SEMPRE subtraído do valor vendido para apurar o líquido
  const valorLiquido = vVenda - vFreteEmpresa;

  // 2. Desconto sobre a tabela: (Preço Tabela Total - Valor Líquido) / Preço Tabela Total * 100
  const descontoReais = vTabela - valorLiquido;
  const descontoPct = vTabela > 0 ? (descontoReais / vTabela) * 100 : 0.0;

  // 3. Lucro Bruto e Margem: (Valor Vendido - Custo Total - Frete Empresa) / Valor Vendido * 100
  const lucroBruto = vVenda - vCusto - vFreteEmpresa;
  const margemPct = vVenda > 0 ? (lucroBruto / vVenda) * 100 : 0.0;

  return {
    valorVenda: Number(vVenda.toFixed(2)),
    precoTabelaTotal: Number(vTabela.toFixed(2)),
    custoTotal: Number(vCusto.toFixed(2)),
    freteEmbutido: Number(vFreteEmpresa.toFixed(2)),
    valorLiquido: Number(valorLiquido.toFixed(2)),
    descontoReais: Number(descontoReais.toFixed(2)),
    descontoPct: Number(descontoPct.toFixed(2)),
    lucroBruto: Number(lucroBruto.toFixed(2)),
    margemPct: Number(margemPct.toFixed(2))
  };
}

/**
 * Analisa completamente um Deal do Pipedrive (Fluxo de 5 passos)
 */
async function analisarDealCompleto(dealInput, options = {}) {
  const dealId = extrairDealId(dealInput);
  if (!dealId) {
    throw new Error('ID do Deal inválido ou não informado.');
  }

  // PASSO 1: Obter dados do Deal no Pipedrive
  let dealData = null;
  try {
    const url = `${PIPEDRIVE_BASE_URL}/deals/${dealId}?api_token=${PIPEDRIVE_API_TOKEN}`;
    const res = await fetchHttpJson(url, { timeout: 12000 });
    dealData = res.data;
  } catch (err) {
    // Tenta via Gateway Railway
    const url = `${RAILWAY_API_URL.replace(/\/query$/, '')}/pipedrive/deal/${dealId}`;
    const res = await fetchHttpJson(url, {
      headers: { 'X-API-Key': RAILWAY_API_KEY },
      timeout: 12000
    });
    dealData = res.data || res;
  }

  if (!dealData) {
    throw new Error(`Deal ${dealId} não encontrado no Pipedrive.`);
  }

  const dealTitle = dealData.title || `Deal ${dealId}`;
  const clienteNome = (dealData.org_name || dealData.person_name || dealData.title || 'Cliente').trim();
  const solicitanteNome = (dealData.user_id && typeof dealData.user_id === 'object' ? dealData.user_id.name : dealData.owner_name) || 'Vendedor';
  const dealStatus = dealData.status || 'open';
  const dealValuePipedrive = parseFloat(dealData.value) || 0.0;

  // PASSO 2: Obter campos customizados (Condição de Pagamento e Frete Embutido)
  const condPgtoOptionId = dealData[COND_PGTO_KEY];
  const condPgtoLabel = await getCondicaoPagamentoLabel(condPgtoOptionId);
  const rawFreteEmbutido = dealData[FRETE_EMBUTIDO_KEY];
  const freteEmbutido = parseFloat(rawFreteEmbutido) || 0.0;
  const tipoFrete = freteEmbutido > 0 ? 'CIF (Embutido)' : 'FOB (Cliente)';

  // PASSO 3: Obter produtos associados ao Deal
  let dealProducts = [];
  try {
    const url = `${PIPEDRIVE_BASE_URL}/deals/${dealId}/products?api_token=${PIPEDRIVE_API_TOKEN}`;
    const res = await fetchHttpJson(url, { timeout: 12000 });
    dealProducts = res.data || [];
  } catch (err) {
    const url = `${RAILWAY_API_URL.replace(/\/query$/, '')}/pipedrive/deal/${dealId}/products`;
    const res = await fetchHttpJson(url, {
      headers: { 'X-API-Key': RAILWAY_API_KEY },
      timeout: 12000
    });
    dealProducts = res.data || res || [];
  }

  if (!Array.isArray(dealProducts) || dealProducts.length === 0) {
    throw new Error(`O Deal ${dealId} não possui produtos adicionados no Pipedrive.`);
  }

  // PASSO 4: Para cada produto, obter o código Protheus puro e consultar SB1090
  const itensDetalhados = [];
  let somaTabelaTotal = 0.0;
  let somaCustoTotal = 0.0;
  let somaVendaDealTotal = 0.0;
  let totalQuantidade = 0;

  for (const item of dealProducts) {
    const productId = item.product_id;
    const itemQuantity = parseFloat(item.quantity) || 1;
    const itemPriceDeal = parseFloat(item.item_price) || 0.0;
    const itemSumDeal = parseFloat(item.sum) || (itemQuantity * itemPriceDeal);
    totalQuantidade += itemQuantity;
    somaVendaDealTotal += itemSumDeal;

    // Busca detalhes do produto no Pipedrive para pegar o campo `code`
    let productDetails = null;
    try {
      const url = `${PIPEDRIVE_BASE_URL}/products/${productId}?api_token=${PIPEDRIVE_API_TOKEN}`;
      const res = await fetchHttpJson(url, { timeout: 8000 });
      productDetails = res.data;
    } catch {
      try {
        const url = `${RAILWAY_API_URL.replace(/\/query$/, '')}/pipedrive/product/${productId}`;
        const res = await fetchHttpJson(url, {
          headers: { 'X-API-Key': RAILWAY_API_KEY },
          timeout: 8000
        });
        productDetails = res.data || res;
      } catch {}
    }

    const rawCode = (productDetails && productDetails.code) ? productDetails.code : (item.product && item.product.code ? item.product.code : '');
    const protheusCode = extrairCodigoProtheus(rawCode);
    const productName = (productDetails && productDetails.name) || item.name || item.product_name || `Produto ${productId}`;

    // Consulta cadastro Protheus SB1090
    const cadastroProtheus = protheusCode ? await getProdutoProtheus(protheusCode) : null;
    const custoUnitario = cadastroProtheus ? cadastroProtheus.custo : 0.0;
    const precoTabelaUnitario = cadastroProtheus ? cadastroProtheus.precoVenda : (itemPriceDeal || 0.0);
    const descricaoProtheus = cadastroProtheus ? cadastroProtheus.descricao : productName;

    const itemTotalTabela = precoTabelaUnitario * itemQuantity;
    const itemTotalCusto = custoUnitario * itemQuantity;

    somaTabelaTotal += itemTotalTabela;
    somaCustoTotal += itemTotalCusto;

    itensDetalhados.push({
      productId,
      rawCode,
      protheusCode,
      nomePipedrive: productName,
      descricaoProtheus,
      quantidade: itemQuantity,
      precoUnitarioDeal: Number(itemPriceDeal.toFixed(2)),
      precoUnitarioTabela: Number(precoTabelaUnitario.toFixed(2)),
      custoUnitario: Number(custoUnitario.toFixed(2)),
      totalDeal: Number(itemSumDeal.toFixed(2)),
      totalTabela: Number(itemTotalTabela.toFixed(2)),
      totalCusto: Number(itemTotalCusto.toFixed(2)),
      encontradoProtheus: !!cadastroProtheus
    });
  }

  // PASSO 5: Trata valor proposto (se informado pelo gestor/vendedor)
  let valorVendaFinal = somaVendaDealTotal;
  let isValorPropostoCustom = false;
  if (options.proposta && !isNaN(parseFloat(options.proposta)) && parseFloat(options.proposta) > 0) {
    valorVendaFinal = parseFloat(options.proposta);
    isValorPropostoCustom = true;
  }

  // Checa se cliente é Revenda (000085)
  const isRevenda = await checkClienteRevenda(clienteNome);

  // Cálculos financeiros
  const calculos = calcularMargemEDesconto({
    valorVendaTotal: valorVendaFinal,
    precoTabelaTotal: somaTabelaTotal,
    custoTotal: somaCustoTotal,
    freteEmbutido
  });

  const precoUnitarioAutorizadoMedio = totalQuantidade > 0 ? Number((valorVendaFinal / totalQuantidade).toFixed(2)) : valorVendaFinal;
  const hasItensSemCusto = itensDetalhados.some(it => !it.encontradoProtheus || it.custoUnitario <= 0);
  const isAlertaDesconto = (calculos.descontoPct > 11 && !isRevenda) || hasItensSemCusto;

  return {
    dealId,
    dealTitle,
    clienteNome,
    solicitanteNome,
    dealStatus,
    condPgtoOptionId,
    condPgtoLabel,
    tipoFrete,
    freteEmbutido,
    isRevenda,
    hasItensSemCusto,
    isAlertaDesconto,
    isValorPropostoCustom,
    valorVendaOriginalPipedrive: Number(somaVendaDealTotal.toFixed(2)),
    valorVendaFinal: calculos.valorVenda,
    precoUnitarioAutorizadoMedio,
    totalQuantidade,
    precoTabelaTotal: calculos.precoTabelaTotal,
    custoTotal: calculos.custoTotal,
    valorLiquido: calculos.valorLiquido,
    descontoReais: calculos.descontoReais,
    descontoPct: calculos.descontoPct,
    lucroBruto: calculos.lucroBruto,
    margemPct: calculos.margemPct,
    itens: itensDetalhados,
    observacoesInput: options.observacoes || ''
  };
}

/**
 * Formata o conteúdo exato da nota para gravação no Pipedrive
 * Regras estritas conforme Seções 9.2 e 9.3 do manual técnico
 */
function formatarNotaPipedrive({ dealId, descontoPct, condPgtoLabel, freteEmbutido = 0, autorizado = true }) {
  const pctStr = (parseFloat(descontoPct) || 0).toFixed(2).replace('.', ',');
  const freteStr = (parseFloat(freteEmbutido) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sufixo = autorizado ? '(ok autorizado)' : '(NAO AUTORIZADO)';

  return `Deal ${dealId} | Desconto Medio Ponderado do Pedido: ${pctStr}% | Forma de Pagamento: ${condPgtoLabel} | Frete Embutido: R$ ${freteStr} | ${sufixo}`;
}

/**
 * Grava a nota padronizada fixada no Deal do Pipedrive via Railway API / Pipedrive REST
 */
async function gravarNotaPipedrive(dealId, content) {
  if (!dealId || !content) {
    throw new Error('dealId e content são obrigatórios para gravar nota no Pipedrive.');
  }

  // 1. Tenta via Gateway Railway (já aplica pinned_to_deal_flag="1")
  try {
    const url = `${RAILWAY_API_URL.replace(/\/query$/, '')}/pipedrive/note`;
    const res = await fetchHttpJson(url, {
      method: 'POST',
      headers: {
        'X-API-Key': RAILWAY_API_KEY
      },
      body: {
        deal_id: parseInt(dealId, 10),
        content: String(content)
      },
      timeout: 12000
    });
    return res;
  } catch (err) {
    console.warn(`⚠️ [Autorizações] Falha ao gravar nota via Railway Gateway (${err.message}). Tentando fallback direto...`);
  }

  // 2. Fallback: Gravação direta via Pipedrive API REST
  const url = `${PIPEDRIVE_BASE_URL}/notes?api_token=${PIPEDRIVE_API_TOKEN}`;
  const res = await fetchHttpJson(url, {
    method: 'POST',
    body: {
      deal_id: parseInt(dealId, 10),
      content: String(content),
      pinned_to_deal_flag: '1'
    },
    timeout: 12000
  });
  return res;
}

module.exports = {
  extrairDealId,
  extrairCodigoProtheus,
  getCondicaoPagamentoLabel,
  getProdutoProtheus,
  checkClienteRevenda,
  calcularMargemEDesconto,
  analisarDealCompleto,
  formatarNotaPipedrive,
  gravarNotaPipedrive,
  COND_PGTO_KEY,
  FRETE_EMBUTIDO_KEY
};
