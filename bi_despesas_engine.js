/**
 * bi_despesas_engine.js
 * Módulo Dedicado de Análise de Despesas Bancárias e Classificação por Natureza (BI Executivo)
 * Plataforma de Apoio GSI (Gemini-Cli)
 *
 * Responsabilidades:
 * 1. Extração Protheus (SE5140, SE5150, SE5160) com JOIN em SA2010 e SED010.
 * 2. Mapeamento hierárquico dinâmico de Natureza Analítica (Filho) para Natureza Pai.
 * 3. Identificação e dedução matemática rigorosa de estornos (-valor).
 * 4. Segregação de movimentações internas / transferências / CDBs (2.10, TR, TE).
 * 5. Sincronização inteligente com janela retroativa de 10 dias e suporte a carga full.
 * 6. Persistência relacional em PostgreSQL (Supabase) + Cache local JSON (ACID-safe).
 * 7. Endpoints analíticos: KPIs, gráfico por Natureza Pai, comparativo 2025 vs 2026 e tabela paginada.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { executeRailwayQuery } = require('./protheus_db');
const { getPool } = require('./postgres_db');
const { safeWriteJson, safeReadJson } = require('./safe_json_storage');

const dataDir = path.join(__dirname, 'data');
const despesasCacheFile = path.join(dataDir, 'bi_despesas_cache.json');

// Mapeamento das 3 empresas atendidas
const EMPRESAS_DESPESAS = [
  { cod: '14', sigla: 'MP', nome: 'Metal Pleno', se5: 'SE5140', sa2: 'SA2010' },
  { cod: '15', sigla: 'GSI', nome: 'GSI Cofres', se5: 'SE5150', sa2: 'SA2010' },
  { cod: '16', sigla: 'OACO', nome: 'OAÇO', se5: 'SE5160', sa2: 'SA2010' }
];

// Nomes amigáveis dos meses
const MESES_NOMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];
const MESES_ABREV = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
];

function roundVal(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function parseDateYmd(ymd) {
  const s = String(ymd || '').replace(/\D/g, '');
  if (s.length === 8) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return null;
}

/**
 * 1. MAPA DE NATUREZAS FINANCEIRAS PROTHEUS (SED010)
 */
let naturezasCache = null;
let naturezasCacheTime = 0;
const CACHE_NATS_TTL_MS = 60 * 60 * 1000; // 1 hora

async function carregarMapaNaturezasProtheus() {
  const now = Date.now();
  if (naturezasCache && (now - naturezasCacheTime < CACHE_NATS_TTL_MS)) {
    return naturezasCache;
  }

  try {
    const sql = `
      SELECT RTRIM(ED_CODIGO) AS CODIGO, 
             RTRIM(ED_DESCRIC) AS DESCRICAO, 
             RTRIM(ED_PAI) AS PAI, 
             RTRIM(ED_TIPO) AS TIPO
      FROM SED010
      WHERE D_E_L_E_T_ = ' '
      ORDER BY ED_CODIGO
    `;
    const res = await executeRailwayQuery(sql);
    const rows = res.rows || res || [];

    const map = new Map();
    rows.forEach(r => {
      const cod = (r.CODIGO || '').trim();
      if (cod) {
        map.set(cod, {
          codigo: cod,
          descricao: (r.DESCRICAO || '').trim(),
          pai: (r.PAI || '').trim(),
          tipo: (r.TIPO || '').trim()
        });
      }
    });

    naturezasCache = map;
    naturezasCacheTime = now;
    return map;
  } catch (err) {
    console.warn('⚠️ [BI Despesas] Falha ao carregar SED010 do Protheus, usando fallback heurístico:', err.message);
    return naturezasCache || new Map();
  }
}

/**
 * Resolve código e descrição da Natureza Pai a partir do código analítico
 */
function resolverNaturezaPai(codNatureza, natsMap) {
  const cod = String(codNatureza || '').trim();
  if (!cod) {
    return { paiCod: 'OUTRAS', paiDesc: 'OUTRAS DESPESAS' };
  }

  // 1. Tenta buscar direto no mapa da SED010
  const natInfo = natsMap.get(cod);
  if (natInfo && natInfo.pai && natInfo.pai !== '2' && natInfo.pai !== '1' && natInfo.pai !== '3') {
    const paiInfo = natsMap.get(natInfo.pai);
    return {
      paiCod: natInfo.pai,
      paiDesc: paiInfo ? paiInfo.descricao : `GRUPO ${natInfo.pai}`
    };
  }

  // 2. Heurística padrão Protheus por máscara com ponto (ex: 2.01.001 -> Pai: 2.01)
  const partes = cod.split('.');
  if (partes.length >= 2) {
    const paiCod = `${partes[0]}.${partes[1]}`;
    const paiInfo = natsMap.get(paiCod);
    return {
      paiCod,
      paiDesc: paiInfo ? paiInfo.descricao : `DESPESAS GRUPO ${paiCod}`
    };
  }

  // 3. Fallback
  return {
    paiCod: cod,
    paiDesc: natInfo ? natInfo.descricao : `NATUREZA ${cod}`
  };
}

/**
 * 2. SINCRONIZAÇÃO INTELIGENTE COM O PROTHEUS (SE5)
 */
let isSyncInProgress = false;
let lastSyncTimestamp = 0;
const SYNC_COOLDOWN_MS = 60 * 1000; // 60 segundos anti-concorrência

async function sincronizarDespesasProtheus({ modo = 'incremental', retroativoDias = 10, triggeredBy = 'admin' } = {}) {
  const now = Date.now();
  if (isSyncInProgress) {
    throw new Error('Uma sincronização de despesas já está em andamento. Aguarde sua conclusão.');
  }
  if (now - lastSyncTimestamp < SYNC_COOLDOWN_MS) {
    const esperaSegundos = Math.ceil((SYNC_COOLDOWN_MS - (now - lastSyncTimestamp)) / 1000);
    throw new Error(`Aguarde ${esperaSegundos}s antes de iniciar uma nova sincronização.`);
  }

  isSyncInProgress = true;
  const startTime = Date.now();

  try {
    const natsMap = await carregarMapaNaturezasProtheus();
    const dadosExistentes = await carregarEspelhoDespesasDB();
    
    // Determinar data inicial de corte
    let dataInicioYmd = '20250101';
    const hojeYmd = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    if (modo === 'incremental' && dadosExistentes && dadosExistentes.length > 0) {
      // Encontrar maior data existente no espelho
      let maxDataYmd = '20250101';
      dadosExistentes.forEach(d => {
        const ymd = String(d.data_movimento || '').replace(/\D/g, '');
        if (ymd > maxDataYmd) maxDataYmd = ymd;
      });

      // Subtrair retroativoDias (janela de segurança retroativa de 10 dias)
      if (maxDataYmd.length === 8) {
        const ano = parseInt(maxDataYmd.slice(0, 4), 10);
        const mes = parseInt(maxDataYmd.slice(4, 6), 10) - 1;
        const dia = parseInt(maxDataYmd.slice(6, 8), 10);
        const d = new Date(ano, mes, dia);
        d.setDate(d.getDate() - Math.max(1, retroativoDias));
        const anoRecuo = d.getFullYear();
        const mesRecuo = String(d.getMonth() + 1).padStart(2, '0');
        const diaRecuo = String(d.getDate()).padStart(2, '0');
        dataInicioYmd = `${anoRecuo}${mesRecuo}${diaRecuo}`;
      }
    }

    console.log(`⏳ [BI Despesas] Sincronizando Protheus (Modo: ${modo} | Período: ${dataInicioYmd} até ${hojeYmd})...`);

    const registrosProcessados = [];

    // Consultar cada uma das 3 empresas
    for (const emp of EMPRESAS_DESPESAS) {
      try {
        const sql = `
          SELECT 
            E5.R_E_C_N_O_ AS RECNO,
            RTRIM(E5.E5_DATA) AS E5_DATA,
            ISNULL(E5.E5_VALOR, 0) AS E5_VALOR,
            RTRIM(E5.E5_RECPAG) AS E5_RECPAG,
            RTRIM(E5.E5_TIPODOC) AS E5_TIPODOC,
            RTRIM(E5.E5_MOTBX) AS E5_MOTBX,
            RTRIM(E5.E5_NATUREZ) AS E5_NATUREZ,
            RTRIM(E5.E5_CLIFOR) AS E5_CLIFOR,
            RTRIM(E5.E5_LOJA) AS E5_LOJA,
            RTRIM(ISNULL(E5.E5_BENEF, '')) AS E5_BENEF,
            RTRIM(ISNULL(E5.E5_DOCUMEN, '')) AS E5_DOCUMEN,
            RTRIM(ISNULL(E5.E5_NUMERO, '')) AS E5_NUMERO,
            RTRIM(ISNULL(E5.E5_HISTOR, '')) AS E5_HISTOR,
            RTRIM(ISNULL(E5.E5_BANCO, '')) AS E5_BANCO,
            RTRIM(ISNULL(E5.E5_SITUACA, '')) AS E5_SITUACA,
            RTRIM(ISNULL(A2.A2_NOME, '')) AS FORNECEDOR_NOME
          FROM ${emp.se5} E5
          LEFT JOIN ${emp.sa2} A2 
            ON A2.A2_COD = E5.E5_CLIFOR 
           AND A2.A2_LOJA = E5.E5_LOJA 
           AND A2.D_E_L_E_T_ = ' '
          WHERE E5.E5_DATA >= '${dataInicioYmd}' 
            AND E5.E5_DATA <= '${hojeYmd}'
            AND E5.D_E_L_E_T_ = ' '
            AND (
              E5.E5_RECPAG = 'P' 
              OR E5.E5_TIPODOC = 'ES' 
              OR (E5.E5_RECPAG = 'R' AND E5.E5_NATUREZ LIKE '2.%')
            )
          ORDER BY E5.E5_DATA ASC, E5.R_E_C_N_O_ ASC
        `;

        const res = await executeRailwayQuery(sql);
        const rows = res.rows || res || [];

        rows.forEach(r => {
          const natCod = (r.E5_NATUREZ || '').trim();
          const tipoDoc = (r.E5_TIPODOC || '').trim().toUpperCase();
          const recpag = (r.E5_RECPAG || '').trim().toUpperCase();
          const situaca = (r.E5_SITUACA || '').trim().toUpperCase();
          const historico = (r.E5_HISTOR || '').trim();
          const valorBruto = roundVal(r.E5_VALOR || 0);

          // Pula registros estritamente cancelados sem estorno inverso
          if (situaca === 'C' && tipoDoc !== 'ES' && !historico.toUpperCase().includes('CANCEL')) {
            return;
          }

          // Identificação de Estorno
          const isEstorno = (
            tipoDoc === 'ES' ||
            (recpag === 'R' && natCod.startsWith('2.')) ||
            historico.toUpperCase().includes('CANCEL') ||
            historico.toUpperCase().includes('ESTORNO')
          );

          // Valor Líquido (Negativo se estorno)
          const valorLiquido = isEstorno ? -Math.abs(valorBruto) : Math.abs(valorBruto);

          // Identificação de Transferência interna / CDB (2.10, TR, TE)
          const isTransferencia = (
            natCod.startsWith('2.10') ||
            tipoDoc === 'TR' ||
            tipoDoc === 'TE'
          );

          // Resolução da Natureza e Pai
          const natInfo = natsMap.get(natCod);
          const natDesc = natInfo ? natInfo.descricao : (natCod ? `NATUREZA ${natCod}` : 'NÃO INFORMADA');
          const { paiCod, paiDesc } = resolverNaturezaPai(natCod, natsMap);

          // Data e Partições
          const dataIso = parseDateYmd(r.E5_DATA) || new Date().toISOString().slice(0, 10);
          const ano = parseInt(dataIso.slice(0, 4), 10);
          const mes = parseInt(dataIso.slice(5, 7), 10);
          const mesAno = `${ano}-${String(mes).padStart(2, '0')}`;

          const fornecedorNome = r.FORNECEDOR_NOME || r.E5_BENEF || 'NÃO INFORMADO';

          registrosProcessados.push({
            empresa_cod: emp.cod,
            empresa_sigla: emp.sigla,
            empresa_nome: emp.nome,
            recno_se5: parseInt(r.RECNO, 10),
            data_movimento: dataIso,
            ano,
            mes,
            mes_ano: mesAno,
            natureza_cod: natCod || 'OUTRAS',
            natureza_desc: natDesc,
            natureza_pai_cod: paiCod,
            natureza_pai_desc: paiDesc,
            fornecedor_cod: (r.E5_CLIFOR || '').trim(),
            fornecedor_loja: (r.E5_LOJA || '').trim(),
            fornecedor_nome: fornecedorNome,
            valor_bruto: valorBruto,
            valor_liquido: valorLiquido,
            recpag,
            tipo_doc: tipoDoc,
            motivo_baixa: (r.E5_MOTBX || '').trim(),
            is_estorno: isEstorno,
            is_transferencia: isTransferencia,
            numero_documento: (r.E5_DOCUMEN || '').trim(),
            numero_titulo: (r.E5_NUMERO || '').trim(),
            historico,
            banco: (r.E5_BANCO || '').trim()
          });
        });

      } catch (empErr) {
        console.error(`❌ [BI Despesas] Erro ao extrair SE5 da Empresa ${emp.sigla} (${emp.cod}):`, empErr.message);
      }
    }

    console.log(`✅ [BI Despesas] ${registrosProcessados.length} lançamentos extraídos e preparados.`);

    // Persistir no Banco / Cache Local
    const resultadoSalvar = await salvarEspelhoDespesasDB(registrosProcessados, {
      modo,
      dataInicioYmd,
      hojeYmd,
      triggeredBy,
      duracaoMs: Date.now() - startTime
    });

    lastSyncTimestamp = Date.now();
    return {
      success: true,
      modo,
      periodo: `${dataInicioYmd} até ${hojeYmd}`,
      totalExtraidos: registrosProcessados.length,
      ...resultadoSalvar,
      duracaoMs: Date.now() - startTime
    };

  } finally {
    isSyncInProgress = false;
  }
}

/**
 * 3. PERSISTÊNCIA DUAL: POSTGRESQL SUPABASE + CACHE JSON LOCAL
 */
async function salvarEspelhoDespesasDB(novosRegistros = [], meta = {}) {
  // 1. Atualizar ou mesclar no Cache Local
  let registrosFinais = [];
  try {
    const cacheAtual = await safeReadJson(despesasCacheFile, { registros: [], metadata: {} });
    const existentes = cacheAtual.registros || [];

    // Mapa por chave composta: empresa_cod + '-' + recno_se5
    const mapa = new Map();
    existentes.forEach(it => mapa.set(`${it.empresa_cod}-${it.recno_se5}`, it));
    novosRegistros.forEach(it => mapa.set(`${it.empresa_cod}-${it.recno_se5}`, it));

    registrosFinais = Array.from(mapa.values());
    // Ordena decrescente por data
    registrosFinais.sort((a, b) => b.data_movimento.localeCompare(a.data_movimento) || b.recno_se5 - a.recno_se5);

    const metadata = {
      last_sync_at: new Date().toISOString(),
      total_registros: registrosFinais.length,
      novos_ou_atualizados: novosRegistros.length,
      ...meta
    };

    await safeWriteJson(despesasCacheFile, {
      metadata,
      registros: registrosFinais
    });
    console.log(`💾 [BI Despesas] Cache JSON salvo com sucesso: ${registrosFinais.length} registros.`);
  } catch (jsonErr) {
    console.warn('⚠️ [BI Despesas] Falha ao salvar cache JSON:', jsonErr.message);
  }

  // 2. Se Postgres estiver conectado, salvar no Supabase
  const p = getPool();
  if (p && novosRegistros.length > 0) {
    try {
      const client = await p.connect();
      try {
        await client.query('BEGIN');

        // Inserção em lotes de 200 itens
        const chunkSize = 200;
        for (let i = 0; i < novosRegistros.length; i += chunkSize) {
          const chunk = novosRegistros.slice(i, i + chunkSize);
          const values = [];
          const placeholders = [];
          let paramIdx = 1;

          chunk.forEach(r => {
            placeholders.push(`(
              $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++},
              $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++},
              $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++},
              $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++},
              $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}
            )`);
            values.push(
              r.empresa_cod, r.empresa_sigla, r.empresa_nome, r.recno_se5, r.data_movimento,
              r.ano, r.mes, r.mes_ano, r.natureza_cod, r.natureza_desc,
              r.natureza_pai_cod, r.natureza_pai_desc, r.fornecedor_cod, r.fornecedor_loja, r.fornecedor_nome,
              r.valor_bruto, r.valor_liquido, r.recpag, r.tipo_doc, r.motivo_baixa,
              r.is_estorno, r.is_transferencia, r.numero_documento, r.numero_titulo, r.historico
            );
          });

          const sqlInsert = `
            INSERT INTO bi_despesas_movimentos (
              empresa_cod, empresa_sigla, empresa_nome, recno_se5, data_movimento,
              ano, mes, mes_ano, natureza_cod, natureza_desc,
              natureza_pai_cod, natureza_pai_desc, fornecedor_cod, fornecedor_loja, fornecedor_nome,
              valor_bruto, valor_liquido, recpag, tipo_doc, motivo_baixa,
              is_estorno, is_transferencia, numero_documento, numero_titulo, historico
            ) VALUES ${placeholders.join(', ')}
            ON CONFLICT (empresa_cod, recno_se5) DO UPDATE SET
              valor_bruto = EXCLUDED.valor_bruto,
              valor_liquido = EXCLUDED.valor_liquido,
              natureza_cod = EXCLUDED.natureza_cod,
              natureza_desc = EXCLUDED.natureza_desc,
              natureza_pai_cod = EXCLUDED.natureza_pai_cod,
              natureza_pai_desc = EXCLUDED.natureza_pai_desc,
              fornecedor_nome = EXCLUDED.fornecedor_nome,
              is_estorno = EXCLUDED.is_estorno,
              is_transferencia = EXCLUDED.is_transferencia,
              synced_at = NOW()
          `;

          await client.query(sqlInsert, values);
        }

        // Grava Log
        await client.query(`
          INSERT INTO bi_despesas_sync_log (
            modo, total_registros, novos_ou_atualizados, duracao_ms, status, triggered_by, data_corte_inicio, data_corte_fim
          ) VALUES ($1, $2, $3, $4, 'SUCCESS', $5, $6, $7)
        `, [
          meta.modo || 'incremental',
          registrosFinais.length,
          novosRegistros.length,
          meta.duracaoMs || 0,
          meta.triggeredBy || 'admin',
          meta.dataInicioYmd || '2025-01-01',
          meta.hojeYmd || new Date().toISOString().slice(0, 10)
        ]);

        await client.query('COMMIT');
        console.log(`🐘 [BI Despesas] Persistência PostgreSQL Supabase concluída com sucesso.`);
      } catch (dbErr) {
        await client.query('ROLLBACK');
        console.warn('⚠️ [BI Despesas] Rollback no Supabase, mantendo dados no cache JSON:', dbErr.message);
      } finally {
        client.release();
      }
    } catch (poolErr) {
      console.warn('⚠️ [BI Despesas] Erro ao conectar no pool Postgres, fallback JSON ativo:', poolErr.message);
    }
  }

  return {
    totalRegistros: registrosFinais.length,
    novosOuAtualizados: novosRegistros.length
  };
}

/**
 * Carrega a lista completa de despesas do banco ou cache
 */
async function carregarEspelhoDespesasDB() {
  const p = getPool();
  if (p) {
    try {
      const res = await p.query(`
        SELECT *
        FROM bi_despesas_movimentos
        ORDER BY data_movimento DESC, recno_se5 DESC
      `);
      if (res.rows && res.rows.length > 0) {
        return res.rows;
      }
    } catch (err) {
      console.warn('⚠️ [BI Despesas] Falha ao consultar PostgreSQL, recorrendo ao cache JSON:', err.message);
    }
  }

  // Fallback JSON
  const cache = await safeReadJson(despesasCacheFile, { registros: [] });
  return cache.registros || [];
}

/**
 * 4. MÉTODOS DE CONSULTA ANALÍTICA PARA A INTERFACE
 */

/**
 * Helper de filtragem em memória (utilizado quando operando em fallback ou consultas compostas)
 */
function aplicarFiltrosDespesas(registros = [], filtros = {}) {
  const {
    empresa = 'TODAS',
    naturezaPai = 'TODAS',
    dataIni = '',
    dataFim = '',
    ano = '',
    mes = '',
    busca = '',
    incluirTransferencias = false
  } = filtros;

  const sEmpresa = String(empresa || 'TODAS').toUpperCase();
  const sPai = String(naturezaPai || 'TODAS').trim();
  const sBusca = String(busca || '').trim().toLowerCase();
  const sDataIni = String(dataIni || '').replace(/\D/g, '');
  const sDataFim = String(dataFim || '').replace(/\D/g, '');
  const nAno = ano ? parseInt(ano, 10) : null;
  const nMes = mes ? parseInt(mes, 10) : null;
  const incTransf = Boolean(incluirTransferencias === true || incluirTransferencias === 'true');

  return registros.filter(r => {
    // 1. Transferências internas e CDBs (ocultas por padrão)
    if (!incTransf && r.is_transferencia) {
      return false;
    }

    // 2. Empresa
    if (sEmpresa !== 'TODAS' && sEmpresa !== 'ALL') {
      if (r.empresa_cod !== sEmpresa && r.empresa_sigla.toUpperCase() !== sEmpresa) {
        return false;
      }
    }

    // 3. Natureza Pai
    if (sPai !== 'TODAS' && sPai !== 'ALL' && sPai !== '') {
      if (r.natureza_pai_cod !== sPai && r.natureza_pai_desc !== sPai) {
        return false;
      }
    }

    // 4. Período
    const dYmd = String(r.data_movimento || '').replace(/\D/g, '');
    if (sDataIni && dYmd < sDataIni) return false;
    if (sDataFim && dYmd > sDataFim) return false;

    // 5. Ano / Mês
    if (nAno && r.ano !== nAno) return false;
    if (nMes && r.mes !== nMes) return false;

    // 6. Busca textual livre (Fornecedor, código de natureza, histórico, documento)
    if (sBusca) {
      const match = (
        (r.fornecedor_nome || '').toLowerCase().includes(sBusca) ||
        (r.fornecedor_cod || '').toLowerCase().includes(sBusca) ||
        (r.natureza_cod || '').toLowerCase().includes(sBusca) ||
        (r.natureza_desc || '').toLowerCase().includes(sBusca) ||
        (r.natureza_pai_desc || '').toLowerCase().includes(sBusca) ||
        (r.historico || '').toLowerCase().includes(sBusca) ||
        (r.numero_documento || '').toLowerCase().includes(sBusca)
      );
      if (!match) return false;
    }

    return true;
  });
}

/**
 * Retorna KPIs do Período
 */
async function obterKpisDespesas(filtros = {}) {
  const todos = await carregarEspelhoDespesasDB();
  const filtrados = aplicarFiltrosDespesas(todos, filtros);

  let totalLiquido = 0;
  let totalBruto = 0;
  let totalEstornos = 0;
  let qtdEstornos = 0;
  const mapaPai = new Map();

  filtrados.forEach(r => {
    const vLiq = Number(r.valor_liquido || 0);
    const vBrut = Number(r.valor_bruto || 0);
    totalLiquido += vLiq;
    totalBruto += vBrut;

    if (r.is_estorno) {
      totalEstornos += Math.abs(vLiq);
      qtdEstornos++;
    }

    const paiDesc = r.natureza_pai_desc || r.natureza_pai_cod;
    mapaPai.set(paiDesc, (mapaPai.get(paiDesc) || 0) + vLiq);
  });

  // Encontra maior grupo
  let maiorPai = { nome: 'N/A', valor: 0, percentual: 0 };
  for (const [nome, valor] of mapaPai.entries()) {
    if (valor > maiorPai.valor) {
      maiorPai = {
        nome,
        valor: roundVal(valor),
        percentual: totalLiquido > 0 ? roundVal((valor / totalLiquido) * 100) : 0
      };
    }
  }

  // Comparativo com período anterior (se filtrando por ano ou período fechado)
  let variacaoPercentualAnterior = null;
  const anoAtual = filtros.ano ? parseInt(filtros.ano, 10) : new Date().getFullYear();
  if (anoAtual) {
    const filtrosAnoAnterior = { ...filtros, ano: anoAtual - 1 };
    const filtradosAnoAnterior = aplicarFiltrosDespesas(todos, filtrosAnoAnterior);
    const totalAnoAnterior = filtradosAnoAnterior.reduce((acc, r) => acc + Number(r.valor_liquido || 0), 0);
    if (totalAnoAnterior > 0) {
      variacaoPercentualAnterior = roundVal(((totalLiquido - totalAnoAnterior) / totalAnoAnterior) * 100);
    }
  }

  return {
    totalLiquido: roundVal(totalLiquido),
    totalBruto: roundVal(totalBruto),
    totalEstornos: roundVal(totalEstornos),
    qtdEstornos,
    totalLancamentos: filtrados.length,
    maiorGrupo: maiorPai,
    variacaoPercentualAnterior
  };
}

/**
 * Retorna dados agregados por Natureza Pai para Gráfico de Barras
 */
async function obterGraficoNaturezaPai(filtros = {}) {
  const todos = await carregarEspelhoDespesasDB();
  const filtrados = aplicarFiltrosDespesas(todos, filtros);

  const mapa = new Map();
  let totalGeral = 0;

  filtrados.forEach(r => {
    const cod = r.natureza_pai_cod || 'OUTRAS';
    const desc = r.natureza_pai_desc || 'OUTRAS DESPESAS';
    const key = `${cod}|${desc}`;
    const vLiq = Number(r.valor_liquido || 0);

    totalGeral += vLiq;
    if (!mapa.has(key)) {
      mapa.set(key, {
        codigo: cod,
        descricao: desc,
        valorLiquido: 0,
        qtdLancamentos: 0,
        totalEstornos: 0
      });
    }

    const item = mapa.get(key);
    item.valorLiquido += vLiq;
    item.qtdLancamentos++;
    if (r.is_estorno) {
      item.totalEstornos += Math.abs(vLiq);
    }
  });

  const lista = Array.from(mapa.values()).map(it => ({
    ...it,
    valorLiquido: roundVal(it.valorLiquido),
    totalEstornos: roundVal(it.totalEstornos),
    percentual: totalGeral > 0 ? roundVal((it.valorLiquido / totalGeral) * 100) : 0
  }));

  // Ordena decrescente por valor líquido
  lista.sort((a, b) => b.valorLiquido - a.valorLiquido);

  return {
    totalGeral: roundVal(totalGeral),
    itens: lista
  };
}

/**
 * Retorna dados para o Gráfico Comparativo Mês a Mês Lado a Lado (2025 vs 2026)
 */
async function obterComparativoMesAMes(filtros = {}) {
  const todos = await carregarEspelhoDespesasDB();

  // Filtros base sem amarrar data para capturar 2025 e 2026
  const baseFiltros = {
    empresa: filtros.empresa,
    naturezaPai: filtros.naturezaPai,
    busca: filtros.busca,
    incluirTransferencias: filtros.incluirTransferencias
  };

  const registros2025 = aplicarFiltrosDespesas(todos, { ...baseFiltros, ano: 2025 });
  const registros2026 = aplicarFiltrosDespesas(todos, { ...baseFiltros, ano: 2026 });

  const meses = [];
  let acumulado2025 = 0;
  let acumulado2026 = 0;

  for (let m = 1; m <= 12; m++) {
    const soma2025 = registros2025
      .filter(r => r.mes === m)
      .reduce((acc, r) => acc + Number(r.valor_liquido || 0), 0);

    const soma2026 = registros2026
      .filter(r => r.mes === m)
      .reduce((acc, r) => acc + Number(r.valor_liquido || 0), 0);

    acumulado2025 += soma2025;
    acumulado2026 += soma2026;

    const diff = soma2026 - soma2025;
    const variacao = soma2025 > 0 ? roundVal((diff / soma2025) * 100) : null;

    meses.push({
      mes: m,
      nomeMes: MESES_NOMES[m - 1],
      abrevMes: MESES_ABREV[m - 1],
      valor2025: roundVal(soma2025),
      valor2026: roundVal(soma2026),
      diferenca: roundVal(diff),
      variacaoPercentual: variacao
    });
  }

  const diffAcumulado = acumulado2026 - acumulado2025;
  const varAcumulada = acumulado2025 > 0 ? roundVal((diffAcumulado / acumulado2025) * 100) : null;

  return {
    ano1: 2025,
    ano2: 2026,
    acumulado2025: roundVal(acumulado2025),
    acumulado2026: roundVal(acumulado2026),
    diferencaAcumulada: roundVal(diffAcumulado),
    variacaoAcumulada: varAcumulada,
    meses
  };
}

/**
 * Retorna Listagem Analítica Paginada (Conforme Pilar 1 de Engenharia)
 */
async function obterLancamentosPaginados(filtros = {}) {
  const todos = await carregarEspelhoDespesasDB();
  const filtrados = aplicarFiltrosDespesas(todos, filtros);

  const curPage = Math.max(1, parseInt(filtros.page, 10) || 1);
  const curLimit = Math.min(100, Math.max(1, parseInt(filtros.limit, 10) || 50));
  const total = filtrados.length;
  const totalPages = Math.ceil(total / curLimit) || 1;
  const offset = (curPage - 1) * curLimit;

  const paginados = filtrados.slice(offset, offset + curLimit);

  // Totais do conjunto filtrado completo
  let totalLiquido = 0;
  let totalEstornos = 0;
  filtrados.forEach(r => {
    const v = Number(r.valor_liquido || 0);
    totalLiquido += v;
    if (r.is_estorno) totalEstornos += Math.abs(v);
  });

  return {
    items: paginados,
    pagination: {
      page: curPage,
      limit: curLimit,
      total,
      totalPages,
      hasNext: curPage < totalPages,
      hasPrev: curPage > 1,
      totalLiquido: roundVal(totalLiquido),
      totalEstornos: roundVal(totalEstornos)
    }
  };
}

/**
 * Retorna lista de Naturezas Pai cadastradas para popular o seletor de filtros
 */
async function obterNaturezasPaisDisponiveis() {
  const todos = await carregarEspelhoDespesasDB();
  const map = new Map();

  todos.forEach(r => {
    if (r.natureza_pai_cod && !r.is_transferencia) {
      map.set(r.natureza_pai_cod, r.natureza_pai_desc || r.natureza_pai_cod);
    }
  });

  const lista = Array.from(map.entries()).map(([codigo, descricao]) => ({
    codigo,
    descricao
  }));

  lista.sort((a, b) => a.codigo.localeCompare(b.codigo));
  return lista;
}

/**
 * Retorna o status da última sincronização
 */
async function obterStatusSincronizacao() {
  const cache = await safeReadJson(despesasCacheFile, { metadata: {}, registros: [] });
  const meta = cache.metadata || {};
  return {
    last_sync_at: meta.last_sync_at || null,
    total_registros: (cache.registros || []).length,
    modo: meta.modo || 'N/A',
    duracao_ms: meta.duracaoMs || 0,
    triggered_by: meta.triggeredBy || 'admin'
  };
}

module.exports = {
  sincronizarDespesasProtheus,
  obterKpisDespesas,
  obterGraficoNaturezaPai,
  obterComparativoMesAMes,
  obterLancamentosPaginados,
  obterNaturezasPaisDisponiveis,
  obterStatusSincronizacao,
  carregarEspelhoDespesasDB
};
