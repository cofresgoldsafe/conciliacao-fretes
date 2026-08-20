const { executeRailwayQuery, consultarSaldoSE8 } = require('./protheus_db');
const { getInterWebhookEvents } = require('./postgres_db');

async function consultarUltimosLancamentosMetalPleno() {
  console.log('🔍 Consultando lançamentos mais recentes da METAL PLENO (Empresa 14) no Protheus (SE5140 / SE8140)...\n');

  // 1. Consulta últimos registros na SE5140 (Banco 077 - Inter)
  const sqlSE5 = `
    SELECT TOP 15
      R_E_C_N_O_ AS ID,
      E5_DATA, 
      E5_VALOR, 
      E5_RECPAG, 
      E5_DOCUMEN, 
      E5_HISTOR, 
      E5_BENEF, 
      E5_TIPODOC,
      E5_NATUREZ,
      E5_BANCO,
      E5_AGENCIA,
      E5_CONTA
    FROM SE5140
    WHERE E5_BANCO = '077'
      AND D_E_L_E_T_ = ' '
    ORDER BY E5_DATA DESC, R_E_C_N_O_ DESC
  `;

  // 2. Consulta saldo de fechamento na SE8140
  const sqlSE8 = `
    SELECT TOP 5
      E8_BANCO,
      E8_AGENCIA,
      E8_CONTA,
      E8_DTSALAT,
      E8_SALATUA
    FROM SE8140
    WHERE E8_BANCO = '077'
      AND D_E_L_E_T_ = ' '
    ORDER BY E8_DTSALAT DESC
  `;

  try {
    const resSE5 = await executeRailwayQuery(sqlSE5);
    const rowsSE5 = resSE5.rows || resSE5 || [];
    console.log(`📊 [SE5140 - Movimentações Banco 077] ${rowsSE5.length} registros encontrados:`);
    console.table(rowsSE5.map(r => ({
      ID: r.ID,
      Data: r.E5_DATA,
      Tipo: r.E5_RECPAG === 'R' ? 'Crédito (+)' : 'Débito (-)',
      Valor: `R$ ${Number(r.E5_VALOR || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      Documento: (r.E5_DOCUMEN || '').trim(),
      Histórico: (r.E5_HISTOR || '').trim(),
      Beneficiário: (r.E5_BENEF || '').trim(),
      TipoDoc: (r.E5_TIPODOC || '').trim()
    })));

    const resSE8 = await executeRailwayQuery(sqlSE8);
    const rowsSE8 = resSE8.rows || resSE8 || [];
    console.log(`\n💰 [SE8140 - Saldos Recentes Banco 077]:`);
    console.table(rowsSE8.map(r => ({
      Banco: r.E8_BANCO,
      Agencia: r.E8_AGENCIA,
      Conta: r.E8_CONTA,
      DataSaldo: r.E8_DTSALAT,
      SaldoAtual: `R$ ${Number(r.E8_SALATUA || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    })));

    // 3. Consulta Webhooks recebidos da Empresa 14
    const webhooks = await getInterWebhookEvents('14', 5);
    console.log(`\n🔔 [Webhooks Recebidos - Empresa 14]: ${webhooks.length} registros`);
    if (webhooks.length > 0) {
      console.table(webhooks.map(w => ({
        ID: w.id,
        EventID: w.eventId,
        Tipo: w.tipo,
        DataRecebido: w.createdAt
      })));
    }

  } catch (err) {
    console.error('❌ Erro na consulta:', err.message);
  }
}

consultarUltimosLancamentosMetalPleno();
