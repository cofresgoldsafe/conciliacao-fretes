/**
 * routes/pgtos_desconhecidos.js
 * 
 * Controlador REST e Motor Federado de Busca para a tela 'Pgtos Desconhecidos'
 * Macro-Área: 💰 ASSIST. FINANC. > Pgtos Desconhecidos (#tab-pgtos-desconhecidos)
 * 
 * Integra em paralelo (Promise.all):
 * 1. Portal da Assistência Técnica (API REST externa com x-api-key, cálculo reverso 5% Pix e match PF x PJ).
 * 2. TOTVS Protheus ERP (SE1 Títulos/Adiantamentos RA + SC5/SC6 Pedidos + SA3 Vendedores).
 * 3. Pipedrive CRM (itemSearch deals e oportunidades abertas).
 * 
 * Aplica regras heurísticas de negócio por empresa:
 * - Empresa 15 (GSI Cofres): Prioridade máxima na Assistência Técnica, seguida de Protheus e Pipedrive.
 * - Empresas 14 (Metal Pleno) e 16 (OAÇO): Prioridade máxima no Protheus com foco obrigatório no VENDEDOR.
 */

const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');
const { executeRailwayQuery, sanitizeSqlParam } = require('../protheus_db');

// Configurações da API de Assistência Técnica
const ASSISTENCIA_API_URL = process.env.ASSISTENCIA_API_URL || 'https://assistencia.gsicofres.com.br/api/conciliacao/buscar';
const ASSISTENCIA_API_KEY = process.env.ASSISTENCIA_API_KEY || (process.env.NODE_ENV === 'production' ? '' : 'gsi_conciliacao_portal_2026_sec');

// Configurações do Pipedrive CRM
const PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';
const PIPEDRIVE_API_TOKEN = process.env.PIPEDRIVE_API_TOKEN || (process.env.NODE_ENV === 'production' ? '' : '27c8e6f7f9bccd60101889f25369f6075e30f615');

/**
 * Utilitário HTTP nativo para chamadas seguras (stdlib https) com timeout estrito
 */
function fetchHttpJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Gemini-Cli-PgtosDesconhecidos/1.0',
          ...(options.headers || {})
        },
        timeout: options.timeout || 15000
      };

      const req = client.request(reqOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              resolve({ raw: data, status: res.statusCode });
            }
          } else {
            let errDetail = data;
            try {
              const errJson = JSON.parse(data);
              errDetail = errJson.message || errJson.error || data;
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

      req.end();
    } catch (errUrl) {
      reject(errUrl);
    }
  });
}

/**
 * Sanitiza e extrai o termo útil de descrições de extrato bancário
 * Remove ruídos comuns: PIX RECEBIDO, TED, DOC, TRANSF, etc.
 */
function limparTermoBancario(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  s = s.replace(/^(PIX\s*(RECEBIDO|TRANSF(ERENCIA)?)?|TED(\s+REMET(ENTE)?)?|DOC|TRANSF(\s+ELET\s+DISP)?|CREDITO|DEP(\s+EM\s+DINHEIRO)?|PAGTO\s+PIX)\s*[-:]?\s*/i, '');
  return s.trim();
}

/**
 * Normaliza valores numéricos enviados na query string (ex: '361', '361,00', 'R$ 361.00')
 */
function normalizarValorNumerico(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return isNaN(raw) ? null : raw;
  const s = String(raw).replace(/[^\d,\.]/g, '').trim();
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) {
    return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  } else if (s.includes(',')) {
    return parseFloat(s.replace(',', '.'));
  }
  const val = parseFloat(s);
  return isNaN(val) ? null : val;
}

/**
 * Formata data AAAAMMDD para DD/MM/AAAA
 */
function formatarDataProtheus(raw) {
  if (!raw) return '-';
  const str = String(raw).trim();
  if (str.length === 8 && !str.includes('-')) {
    return `${str.slice(6, 8)}/${str.slice(4, 6)}/${str.slice(0, 4)}`;
  }
  return str;
}

/**
 * Módulo 1: Consulta à API da Assistência Técnica
 */
async function buscarAssistencia({ valor, termo, limite = 25 }) {
  try {
    const parsedUrl = new URL(ASSISTENCIA_API_URL);
    if (valor !== null && valor !== undefined) parsedUrl.searchParams.set('valor', String(valor));
    if (termo) parsedUrl.searchParams.set('termo', String(termo));
    if (limite) parsedUrl.searchParams.set('limite', String(limite));

    const res = await fetchHttpJson(parsedUrl.toString(), {
      headers: {
        'x-api-key': ASSISTENCIA_API_KEY
      },
      timeout: 15000
    });

    if (!res || !res.resultados || !Array.isArray(res.resultados)) {
      return [];
    }

    return res.resultados.map(os => {
      const cli = os.cliente || {};
      const equip = os.equipamento || {};
      return {
        origem: 'ASSISTENCIA',
        origemLabel: 'Assistência Técnica',
        empresa: '15',
        empresaNome: 'GSI Cofres (15)',
        id: os.id_os || `onlineos-${os.numero_os}`,
        documento: `OS ${os.numero_os}`,
        numeroOS: os.numero_os,
        cliente: cli.nome_razao_social || 'Cliente não identificado',
        cpfCnpj: cli.cpf_cnpj || '',
        email: cli.email || '',
        celular: cli.celular || '',
        cidadeUf: cli.cidade_uf || '',
        vendedor: 'Suporte Técnico GSI',
        defeito: equip.defeito || '',
        status: os.status_pagamento ? `${os.status_pagamento} (${os.status_os})` : os.status_os,
        statusPagamento: os.status_pagamento || 'Pendente',
        data: os.data_abertura || '',
        valorOriginal: parseFloat(os.valor_os) || 0,
        valorCom5pctPix: parseFloat(os.valor_com_5pct_pix) || 0,
        valorMatch: parseFloat(os.valor_com_5pct_pix || os.valor_os) || 0,
        tipoMatch: os.tipo_match || 'Correspondência Assistência Técnica',
        confianca: os.confianca || 'Alta',
        scoreBase: parseInt(os.score, 10) || 160,
        link: os.link_os || `https://portal.gsicofres.com.br/assistencia/os/onlineos-${os.numero_os}`
      };
    });
  } catch (err) {
    console.warn(`⚠️ [Pgtos Desconhecidos] Falha na consulta da Assistência Técnica: ${err.message}`);
    return [];
  }
}

/**
 * Módulo 2: Consulta ao ERP TOTVS Protheus (Títulos SE1 e Pedidos SC5/SC6 em Paralelo)
 */
async function buscarProtheus({ empresas, valor, termo, limite = 25 }) {
  const empConfigs = [
    { cod: '15', nome: 'GSI Cofres (15)', se1: 'SE1150', sc5: 'SC5150', sc6: 'SC6150' },
    { cod: '14', nome: 'Metal Pleno (14)', se1: 'SE1140', sc5: 'SC5140', sc6: 'SC6140' },
    { cod: '16', nome: 'OAÇO (16)', se1: 'SE1160', sc5: 'SC5160', sc6: 'SC6160' }
  ].filter(e => empresas.includes(e.cod));

  const cleanTermo = sanitizeSqlParam(termo || '');
  const hasValor = valor !== null && valor !== undefined && !isNaN(valor) && valor > 0;
  const safeLimit = Math.max(1, Math.min(limite, 100));

  // Execução paralela em todas as empresas solicitadas (elimina gargalo sequencial)
  const promessasEmpresas = empConfigs.map(async emp => {
    const itensEmpresa = [];

    // 2.1 Consulta Títulos em Aberto ou Adiantamentos em SE1
    try {
      let whereClauses = ["E1.D_E_L_E_T_ = ' '", "RTRIM(E1.E1_TIPO) NOT IN ('TX', 'INS', 'ISS', 'PIS', 'COF', 'CSL', 'NCC')"];

      if (hasValor) {
        const vMin = (valor - 0.05).toFixed(2);
        const vMax = (valor + 0.05).toFixed(2);
        const vPixCheioMin = ((valor / 0.95) - 0.05).toFixed(2);
        const vPixCheioMax = ((valor / 0.95) + 0.05).toFixed(2);

        whereClauses.push(`(
          (E1.E1_VALOR BETWEEN ${vMin} AND ${vMax}) OR
          (E1.E1_SALDO BETWEEN ${vMin} AND ${vMax}) OR
          (E1.E1_VALOR BETWEEN ${vPixCheioMin} AND ${vPixCheioMax})
        )`);
      }

      if (cleanTermo) {
        const digits = cleanTermo.replace(/\D/g, '');
        const condicoesTermo = [
          `E1.E1_NOMCLI LIKE '%${cleanTermo}%'`,
          `E1.E1_NUM LIKE '%${cleanTermo}%'`,
          `SA1.A1_NOME LIKE '%${cleanTermo}%'`
        ];
        // Proteção contra bypass wildcard universal (LIKE '%%')
        if (digits.length >= 3) {
          condicoesTermo.push(`SA1.A1_CGC LIKE '%${digits}%'`);
        }
        whereClauses.push(`(${condicoesTermo.join(' OR ')})`);
      }

      const sqlSE1 = `
        SELECT TOP ${safeLimit}
          RTRIM(E1.E1_NUM) AS NUM_TITULO,
          RTRIM(E1.E1_PREFIXO) AS PREFIXO,
          RTRIM(E1.E1_PARCELA) AS PARCELA,
          RTRIM(E1.E1_TIPO) AS TIPO,
          ISNULL(E1.E1_VALOR, 0) AS VALOR,
          ISNULL(E1.E1_SALDO, 0) AS SALDO,
          RTRIM(ISNULL(E1.E1_EMISSAO, '')) AS EMISSAO,
          RTRIM(ISNULL(E1.E1_VENCTO, '')) AS VENCTO,
          RTRIM(ISNULL(E1.E1_BAIXA, '')) AS BAIXA,
          RTRIM(ISNULL(E1.E1_NOMCLI, '')) AS NOMCLI,
          RTRIM(ISNULL(E1.E1_CLIENTE, '')) AS CODCLI,
          RTRIM(ISNULL(E1.E1_PEDIDO, '')) AS PEDIDO,
          RTRIM(ISNULL(SA1.A1_CGC, '')) AS CGC,
          RTRIM(ISNULL(A3.A3_NOME, '')) AS NOME_VEND,
          RTRIM(ISNULL(C5.C5_VEND1, '')) AS COD_VEND,
          RTRIM(ISNULL(E4.E4_DESCRI, '')) AS CONDPAG_DESC
        FROM ${emp.se1} E1
        LEFT JOIN SA1010 SA1
          ON (SA1.A1_COD = E1.E1_CLIENTE OR SA1.A1_COD = RIGHT('000000' + RTRIM(E1.E1_CLIENTE), 6))
         AND SA1.D_E_L_E_T_ = ' '
        LEFT JOIN ${emp.sc5} C5
          ON (
            (E1.E1_PEDIDO <> '' AND (C5.C5_NUM = E1.E1_PEDIDO OR C5.C5_NUM = RIGHT('000000' + RTRIM(E1.E1_PEDIDO), 6)))
            OR
            (E1.E1_NUM LIKE 'PED%' AND (C5.C5_NUM = SUBSTRING(E1.E1_NUM, 4, 10) OR C5.C5_NUM = RIGHT('000000' + SUBSTRING(E1.E1_NUM, 4, 10), 6)))
          )
         AND C5.D_E_L_E_T_ = ' '
        LEFT JOIN SA3010 A3
          ON (A3.A3_COD = C5.C5_VEND1 OR A3.A3_COD = RIGHT('000000' + RTRIM(C5.C5_VEND1), 6))
         AND A3.D_E_L_E_T_ = ' '
        LEFT JOIN SE4010 E4
          ON (E4.E4_CODIGO = C5.C5_CONDPAG OR E4.E4_CODIGO = RIGHT('000' + RTRIM(C5.C5_CONDPAG), 3))
         AND E4.D_E_L_E_T_ = ' '
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY E1.E1_EMISSAO DESC, E1.R_E_C_N_O_ DESC
      `;

      const resSE1 = await executeRailwayQuery(sqlSE1);
      if (resSE1 && resSE1.rows && Array.isArray(resSE1.rows)) {
        for (const row of resSE1.rows) {
          const saldo = parseFloat(row.SALDO) || 0;
          const valorTit = parseFloat(row.VALOR) || 0;
          const isBaixado = row.BAIXA && row.BAIXA.trim() !== '' && saldo <= 0;
          const isRA = (row.TIPO || '').trim() === 'RA';

          let tipoDesc = isRA ? 'Adiantamento de Pedido (RA)' : 'Título / Duplicata';
          let statusTit = isBaixado ? 'Baixado no Protheus' : (saldo > 0 ? 'Em Aberto (Pendente)' : 'Quitado');

          itensEmpresa.push({
            origem: 'PROTHEUS',
            origemLabel: isRA ? 'Protheus (Adiantamento RA)' : 'Protheus (Título SE1)',
            empresa: emp.cod,
            empresaNome: emp.nome,
            id: `protheus-se1-${emp.cod}-${row.NUM_TITULO}-${row.PARCELA}`,
            documento: `${row.PREFIXO ? row.PREFIXO + '-' : ''}${row.NUM_TITULO}${row.PARCELA ? ' / ' + row.PARCELA : ''}`,
            cliente: row.NOMCLI || 'Cliente Protheus',
            cpfCnpj: row.CGC || '',
            vendedor: row.NOME_VEND || (row.COD_VEND ? `Vendedor #${row.COD_VEND}` : 'Vendedor Comercial'),
            condicaoPagamento: row.CONDPAG_DESC || '',
            status: statusTit,
            data: formatarDataProtheus(row.EMISSAO),
            dataVencimento: formatarDataProtheus(row.VENCTO),
            valorOriginal: valorTit,
            valorSaldo: saldo,
            valorMatch: valorTit,
            tipoMatch: `${tipoDesc} • Parcela ${row.PARCELA || 'Única'}`,
            confianca: emp.cod === '15' ? 'Média' : 'Alta',
            scoreBase: isRA ? 175 : 145,
            link: null
          });
        }
      }
    } catch (errSE1) {
      console.warn(`⚠️ [Pgtos Desconhecidos] Falha ao consultar SE1 na empresa ${emp.cod}: ${errSE1.message}`);
    }

    // 2.2 Consulta Pedidos de Venda em Aberto (SC5) com filtro em SQL
    if (itensEmpresa.length < safeLimit) {
      try {
        let whereC5 = ["C5.D_E_L_E_T_ = ' '", "(C5.C5_NOTA = '' OR C5.C5_NOTA IS NULL)"];

        if (cleanTermo) {
          whereC5.push(`(C5.C5_NOMECLI LIKE '%${cleanTermo}%' OR C5.C5_NUM LIKE '%${cleanTermo}%')`);
        }

        // Filtro em SQL quando há valor buscado
        if (hasValor) {
          const vMin = (valor - 1.00).toFixed(2);
          const vMax = (valor + 1.00).toFixed(2);
          whereC5.push(`(
            ((C5.C5_FRETE + (SELECT ISNULL(SUM(C6.C6_VALOR), 0) FROM ${emp.sc6} C6 WHERE C6.C6_NUM = C5.C5_NUM AND C6.D_E_L_E_T_ = ' ') - C5.C5_DESCONT) BETWEEN ${vMin} AND ${vMax})
            OR (C5.C5_CONDPAG IN ('001', '053') AND C5.C5_FRETE > 0)
          )`);
        }

        const sqlSC5 = `
          SELECT TOP ${safeLimit}
            RTRIM(C5.C5_NUM) AS NUM_PEDIDO,
            RTRIM(ISNULL(C5.C5_EMISSAO, '')) AS EMISSAO,
            RTRIM(ISNULL(C5.C5_NOMECLI, '')) AS NOMECLI,
            RTRIM(ISNULL(C5.C5_CLIENTE, '')) AS CODCLI,
            RTRIM(ISNULL(C5.C5_VEND1, '')) AS COD_VEND,
            RTRIM(ISNULL(A3.A3_NOME, '')) AS NOME_VEND,
            RTRIM(ISNULL(E4.E4_DESCRI, '')) AS CONDPAG_DESC,
            RTRIM(ISNULL(E4.E4_COND, '')) AS E4_COND,
            ISNULL(C5.C5_FRETE, 0) AS FRETE,
            ISNULL(C5.C5_DESCONT, 0) AS DESCONTO,
            ISNULL((SELECT SUM(C6.C6_VALOR) FROM ${emp.sc6} C6 WHERE C6.C6_NUM = C5.C5_NUM AND C6.D_E_L_E_T_ = ' '), 0) AS TOTAL_PRODUTOS
          FROM ${emp.sc5} C5
          LEFT JOIN SA3010 A3
            ON (A3.A3_COD = C5.C5_VEND1 OR A3.A3_COD = RIGHT('000000' + RTRIM(C5.C5_VEND1), 6))
           AND A3.D_E_L_E_T_ = ' '
          LEFT JOIN SE4010 E4
            ON (E4.E4_CODIGO = C5.C5_CONDPAG OR E4.E4_CODIGO = RIGHT('000' + RTRIM(C5.C5_CONDPAG), 3))
           AND E4.D_E_L_E_T_ = ' '
          WHERE ${whereC5.join(' AND ')}
          ORDER BY C5.C5_EMISSAO DESC
        `;

        const resSC5 = await executeRailwayQuery(sqlSC5);
        if (resSC5 && resSC5.rows && Array.isArray(resSC5.rows)) {
          for (const row of resSC5.rows) {
            const totProd = parseFloat(row.TOTAL_PRODUTOS) || 0;
            const frete = parseFloat(row.FRETE) || 0;
            const desc = parseFloat(row.DESCONTO) || 0;
            const totalPedido = totProd + frete - desc;

            let detalheValor = `Total do Pedido R$ ${totalPedido.toFixed(2)}`;

            itensEmpresa.push({
              origem: 'PROTHEUS',
              origemLabel: 'Protheus (Pedido em Aberto)',
              empresa: emp.cod,
              empresaNome: emp.nome,
              id: `protheus-sc5-${emp.cod}-${row.NUM_PEDIDO}`,
              documento: `Pedido ${row.NUM_PEDIDO}`,
              cliente: row.NOMECLI || 'Cliente Protheus',
              cpfCnpj: '',
              vendedor: row.NOME_VEND || (row.COD_VEND ? `Vendedor #${row.COD_VEND}` : 'Vendedor Comercial'),
              condicaoPagamento: row.CONDPAG_DESC || '',
              status: 'Pedido Aberto (Não Faturado)',
              data: formatarDataProtheus(row.EMISSAO),
              valorOriginal: totalPedido,
              valorMatch: totalPedido,
              tipoMatch: `Pedido SC5 • ${detalheValor}`,
              confianca: emp.cod === '15' ? 'Média' : 'Alta',
              scoreBase: 155,
              link: null
            });
          }
        }
      } catch (errSC5) {
        console.warn(`⚠️ [Pgtos Desconhecidos] Falha ao consultar SC5 na empresa ${emp.cod}: ${errSC5.message}`);
      }
    }

    return itensEmpresa;
  });

  const resultadosPorEmpresa = await Promise.all(promessasEmpresas);
  return resultadosPorEmpresa.flat();
}

/**
 * Módulo 3: Consulta ao Pipedrive CRM (itemSearch deals e negociações abertas)
 */
async function buscarPipedrive({ valor, termo, limite = 15 }) {
  const resultados = [];
  const cleanTermo = (termo || '').trim();
  const hasValor = valor !== null && valor !== undefined && !isNaN(valor) && valor > 0;
  const safeLimit = Math.max(1, Math.min(limite, 50));

  try {
    // 3.1 Busca por Termo via itemSearch
    if (cleanTermo && cleanTermo.length >= 2) {
      const url = `${PIPEDRIVE_BASE_URL}/itemSearch?term=${encodeURIComponent(cleanTermo)}&item_types=deal&limit=${safeLimit}&api_token=${PIPEDRIVE_API_TOKEN}`;
      const res = await fetchHttpJson(url, { timeout: 12000 });

      if (res && res.data && res.data.items && Array.isArray(res.data.items)) {
        for (const it of res.data.items) {
          const d = it.item || {};
          const v = parseFloat(d.value) || 0;
          const org = d.organization ? d.organization.name : '';
          const person = d.person ? d.person.name : '';
          const stage = d.stage ? d.stage.name : 'Funil Comercial';

          resultados.push({
            origem: 'PIPEDRIVE',
            origemLabel: 'Pipedrive CRM',
            empresa: 'CRM',
            empresaNome: 'Pipedrive CRM',
            id: `pipedrive-deal-${d.id}`,
            documento: `Deal #${d.id}`,
            cliente: org || person || d.title || 'Lead Pipedrive',
            cpfCnpj: '',
            vendedor: (d.owner && d.owner.name) || 'Vendedor Pipedrive',
            status: `${d.status || 'open'} (${stage})`,
            data: '-',
            valorOriginal: v,
            valorMatch: v,
            tipoMatch: `Oportunidade CRM • ${d.title}`,
            confianca: 'Média',
            scoreBase: 90,
            link: `https://benetroncomercial.pipedrive.com/deal/${d.id}`
          });
        }
      }
    }

    // 3.2 Se busca por valor (e poucos ou nenhum resultado por termo), busca deals abertos recentes
    if (hasValor && resultados.length < safeLimit) {
      const urlDeals = `${PIPEDRIVE_BASE_URL}/deals?status=open&limit=60&sort=update_time%20DESC&api_token=${PIPEDRIVE_API_TOKEN}`;
      const resDeals = await fetchHttpJson(urlDeals, { timeout: 12000 });

      if (resDeals && resDeals.data && Array.isArray(resDeals.data)) {
        for (const deal of resDeals.data) {
          const v = parseFloat(deal.value) || 0;
          if (Math.abs(v - valor) <= 0.10) {
            if (!resultados.some(r => r.id === `pipedrive-deal-${deal.id}`)) {
              const org = deal.org_name || '';
              const person = deal.person_name || '';
              resultados.push({
                origem: 'PIPEDRIVE',
                origemLabel: 'Pipedrive CRM',
                empresa: 'CRM',
                empresaNome: 'Pipedrive CRM',
                id: `pipedrive-deal-${deal.id}`,
                documento: `Deal #${deal.id}`,
                cliente: org || person || deal.title || 'Lead Pipedrive',
                cpfCnpj: '',
                vendedor: (deal.user_id && deal.user_id.name) || deal.owner_name || 'Vendedor Pipedrive',
                status: `Aberto (${deal.stage_id || 'Proposta'})`,
                data: deal.add_time ? deal.add_time.slice(0, 10) : '-',
                valorOriginal: v,
                valorMatch: v,
                tipoMatch: `Valor idêntico da proposta comercial (${deal.title})`,
                confianca: 'Média',
                scoreBase: 85,
                link: `https://benetroncomercial.pipedrive.com/deal/${deal.id}`
              });
            }
          }
        }
      }
    }
  } catch (errPipe) {
    console.warn(`⚠️ [Pgtos Desconhecidos] Falha ao consultar Pipedrive: ${errPipe.message}`);
  }

  return resultados;
}

/**
 * Motor Heurístico de Ranqueamento e Ajuste de Confiança por Empresa
 */
function calcularScoreEConfianca(item, empresaAlvo, valorBuscado, termoBuscado) {
  let score = item.scoreBase || 100;

  // 1. Regra para Empresa 15 (GSI Cofres):
  if (empresaAlvo === '15') {
    if (item.origem === 'ASSISTENCIA') {
      score += 50; // Grande bônus: maior probabilidade é ser da assistência técnica
    } else if (item.origem === 'PROTHEUS' && item.empresa === '15') {
      score += 20;
    } else if (item.origem === 'PIPEDRIVE') {
      score -= 20; // Menor probabilidade
    }
  }
  // 2. Regra para Empresas 14 (Metal Pleno) e 16 (OAÇO):
  else if (empresaAlvo === '14' || empresaAlvo === '16') {
    if (item.origem === 'ASSISTENCIA') {
      return {
        ...item,
        score: 0,
        confianca: 'Baixa'
      };
    } else if (item.origem === 'PROTHEUS' && item.empresa === empresaAlvo) {
      score += 60; // Prioridade máxima no Protheus da empresa correspondente
    } else if (item.origem === 'PIPEDRIVE') {
      score += 10;
    }
  }

  // Bônus se houver match exato do termo no nome do cliente
  if (termoBuscado && item.cliente && item.cliente.toLowerCase().includes(termoBuscado.toLowerCase())) {
    score += 35;
  }

  // Bônus se o valor for idêntico
  if (valorBuscado !== null && Math.abs(item.valorMatch - valorBuscado) < 0.01) {
    score += 25;
  }

  // Classificação de Confiança
  let confianca = 'Baixa';
  if (score >= 150) confianca = 'Alta';
  else if (score >= 90) confianca = 'Média';

  return {
    ...item,
    score,
    confianca
  };
}

/**
 * ENDPOINT PRINCIPAL:
 * GET /api/financeiro/pgtos-desconhecidos/buscar
 */
router.get('/buscar', async (req, res) => {
  try {
    const { empresa, valor, termo, limite } = req.query;

    const empresaAlvo = String(empresa || 'ALL').trim().toUpperCase();
    const valorNum = normalizarValorNumerico(valor);
    const termoLimpo = limparTermoBancario(termo);
    const limiteNum = Math.max(1, Math.min(parseInt(limite, 10) || 30, 100));

    if (!valorNum && !termoLimpo) {
      return res.status(400).json({
        success: false,
        error: 'Informe ao menos o valor do pagamento ou um termo de busca (razão social, CNPJ ou descrição).'
      });
    }

    // Define quais empresas do Protheus consultar
    let empresasProtheus = ['15', '14', '16'];
    if (empresaAlvo === '14') empresasProtheus = ['14'];
    else if (empresaAlvo === '15') empresasProtheus = ['15'];
    else if (empresaAlvo === '16') empresasProtheus = ['16'];

    // Orquestra as buscas em paralelo com degradação graciosa
    const tarefas = [];

    // Módulo 1: Assistência Técnica (Apenas se Empresa 15 ou ALL)
    if (empresaAlvo === '15' || empresaAlvo === 'ALL') {
      tarefas.push(buscarAssistencia({ valor: valorNum, termo: termoLimpo, limite: limiteNum }));
    } else {
      tarefas.push(Promise.resolve([]));
    }

    // Módulo 2: Protheus ERP
    tarefas.push(buscarProtheus({ empresas: empresasProtheus, valor: valorNum, termo: termoLimpo, limite: limiteNum }));

    // Módulo 3: Pipedrive CRM
    tarefas.push(buscarPipedrive({ valor: valorNum, termo: termoLimpo, limite: Math.min(limiteNum, 15) }));

    const [resAssistencia, resProtheus, resPipedrive] = await Promise.allSettled(tarefas);

    const listaAssistencia = (resAssistencia.status === 'fulfilled' && Array.isArray(resAssistencia.value)) ? resAssistencia.value : [];
    const listaProtheus = (resProtheus.status === 'fulfilled' && Array.isArray(resProtheus.value)) ? resProtheus.value : [];
    const listaPipedrive = (resPipedrive.status === 'fulfilled' && Array.isArray(resPipedrive.value)) ? resPipedrive.value : [];

    // Concatena e aplica o motor de ranqueamento
    const todosCandidatos = [
      ...listaAssistencia,
      ...listaProtheus,
      ...listaPipedrive
    ]
      .map(item => calcularScoreEConfianca(item, empresaAlvo, valorNum, termoLimpo))
      .filter(item => item.score > 0) // Descarta itens zerados (ex: Assistência para MP/OAÇO)
      .sort((a, b) => b.score - a.score);

    // Estatísticas agregadas
    const resumo = {
      totalEncontrados: todosCandidatos.length,
      altaConfianca: todosCandidatos.filter(c => c.confianca === 'Alta').length,
      mediaConfianca: todosCandidatos.filter(c => c.confianca === 'Média').length,
      baixaConfianca: todosCandidatos.filter(c => c.confianca === 'Baixa').length,
      origens: {
        assistencia: listaAssistencia.length,
        protheus: listaProtheus.length,
        pipedrive: listaPipedrive.length
      }
    };

    return res.json({
      success: true,
      criterios: {
        empresa: empresaAlvo,
        valor: valorNum,
        termoOriginal: termo || '',
        termoLimpo,
        limite: limiteNum
      },
      resumo,
      resultados: todosCandidatos.slice(0, limiteNum)
    });
  } catch (errGeral) {
    console.error('❌ [Pgtos Desconhecidos] Erro fatal no endpoint:', errGeral);
    return res.status(500).json({
      success: false,
      error: `Erro interno ao pesquisar pagamentos desconhecidos: ${errGeral.message}`
    });
  }
});

module.exports = router;
module.exports.limparTermoBancario = limparTermoBancario;
module.exports.normalizarValorNumerico = normalizarValorNumerico;
module.exports.calcularScoreEConfianca = calcularScoreEConfianca;
