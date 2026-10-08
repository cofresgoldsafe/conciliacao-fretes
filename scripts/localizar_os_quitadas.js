const fs = require('fs');
const path = require('path');
const https = require('https');
const { executeRailwayQuery } = require('../protheus_db');

const ASSISTENCIA_API_URL = 'https://assistencia.gsicofres.com.br/api/conciliacao/buscar';
const ASSISTENCIA_API_KEY = 'gsi_conciliacao_portal_2026_sec';

function formatarDataBr(str) {
  if (!str || str.length !== 8) return str || '-';
  const y = str.substring(0, 4);
  const m = str.substring(4, 6);
  const d = str.substring(6, 8);
  return `${d}/${m}/${y}`;
}

function buscarOSNoPortal(numeroOS) {
  return new Promise((resolve) => {
    // Normaliza número da OS (número puro sem zeros à esquerda)
    const numLimpo = String(numeroOS).replace(/^0+/, '') || String(numeroOS);
    const url = new URL(ASSISTENCIA_API_URL);
    url.searchParams.set('termo', numLimpo);
    url.searchParams.set('limite', '5');

    const req = https.request(url.toString(), {
      method: 'GET',
      headers: {
        'x-api-key': ASSISTENCIA_API_KEY,
        'Accept': 'application/json',
        'User-Agent': 'Gemini-Cli-PgtosDesconhecidos/1.0'
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && json.resultados && json.resultados.length > 0) {
            const match = json.resultados.find(r => 
              String(r.numero_os) === String(numLimpo) || 
              String(r.numero_os) === String(numeroOS)
            );
            resolve(match || null);
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function main() {
  console.log('=====================================================');
  console.log('🚀 INICIANDO LOCALIZAÇÃO E CONCILIAÇÃO DE OSs QUITADAS');
  console.log('=====================================================\n');

  console.log('1. Consultando títulos no Protheus (SE1150)...');
  const sql = `
    SELECT 
      RTRIM(E1_FILIAL) AS FILIAL,
      RTRIM(E1_NUM) AS NUM,
      RTRIM(E1_PREFIXO) AS PREFIXO,
      RTRIM(E1_PARCELA) AS PARCELA,
      RTRIM(E1_TIPO) AS TIPO,
      E1_VALOR AS VALOR,
      E1_SALDO AS SALDO,
      RTRIM(E1_BAIXA) AS BAIXA,
      RTRIM(E1_EMISSAO) AS EMISSAO,
      RTRIM(E1_VENCTO) AS VENCTO,
      RTRIM(E1_CLIENTE) AS CLIENTE,
      RTRIM(E1_NOMCLI) AS NOMCLI,
      RTRIM(E1_HIST) AS HIST
    FROM SE1150
    WHERE (
      LTRIM(RTRIM(E1_NUM)) LIKE 'OS %'
      OR LTRIM(RTRIM(E1_NUM)) LIKE 'OS[0-9]%'
      OR LTRIM(RTRIM(E1_NUM)) LIKE 'OS-%'
      OR LTRIM(RTRIM(E1_NUM)) LIKE 'OS/%'
      OR LTRIM(RTRIM(E1_NUM)) LIKE 'OS O%'
    )
    AND D_E_L_E_T_ = ' '
    ORDER BY E1_EMISSAO DESC, E1_NUM ASC
  `;

  const t0 = Date.now();
  const res = await executeRailwayQuery(sql);
  const rows = res.rows || [];
  console.log(`✅ Consulta Protheus finalizada em ${((Date.now() - t0) / 1000).toFixed(1)}s. Total de registros: ${rows.length}\n`);

  // Agrupamento por E1_NUM
  const byNum = new Map();
  for (const r of rows) {
    const num = r.NUM.trim();
    if (!byNum.has(num)) byNum.set(num, []);
    byNum.get(num).push(r);
  }

  const quitadas = [];
  const excluidasNaoQuitadas = [];
  const excluidasParciais = [];

  for (const [num, items] of byNum.entries()) {
    const totalValor = items.reduce((sum, i) => sum + (Number(i.VALOR) || 0), 0);
    const totalSaldo = items.reduce((sum, i) => sum + (Number(i.SALDO) || 0), 0);
    const allBaixados = items.every(i => i.BAIXA && i.BAIXA.trim() !== '' && i.BAIXA.trim() !== '0');
    const cleanNum = num.replace(/^OS\s*[-/]?\s*/i, '').replace(/^O/i, '0').trim();
    const numOsPuro = cleanNum.match(/^\d+/) ? cleanNum.match(/^\d+/)[0] : cleanNum;
    const numOsInt = parseInt(numOsPuro, 10);

    // REGRA 1: Totalmente quitada (Saldo = 0 e todos os títulos com data de baixa)
    if (totalSaldo === 0 && allBaixados) {
      quitadas.push({
        e1Num: num,
        numeroOS: isNaN(numOsInt) ? cleanNum : String(numOsInt),
        numeroOSPadded: isNaN(numOsInt) ? cleanNum : String(numOsInt).padStart(4, '0'),
        valorTotal: Number(totalValor.toFixed(2)),
        saldoTotal: 0.00,
        ultimaBaixa: items.reduce((max, i) => (i.BAIXA > max ? i.BAIXA : max), ''),
        ultimaBaixaFormatada: formatarDataBr(items.reduce((max, i) => (i.BAIXA > max ? i.BAIXA : max), '')),
        ultimaEmissao: items.reduce((max, i) => (i.EMISSAO > max ? i.EMISSAO : max), ''),
        ultimaEmissaoFormatada: formatarDataBr(items.reduce((max, i) => (i.EMISSAO > max ? i.EMISSAO : max), '')),
        vencto: items[0].VENCTO || '',
        venctoFormatado: formatarDataBr(items[0].VENCTO || ''),
        cliente: items[0].NOMCLI || '',
        codCliente: items[0].CLIENTE || '',
        historico: items[0].HIST || '',
        qtdTitulos: items.length,
        titulos: items.map(t => ({
          filial: t.FILIAL,
          prefixo: t.PREFIXO,
          parcela: t.PARCELA,
          tipo: t.TIPO,
          valor: t.VALOR,
          saldo: t.SALDO,
          baixa: t.BAIXA,
          baixaFormatada: formatarDataBr(t.BAIXA),
          emissao: t.EMISSAO,
          emissaoFormatada: formatarDataBr(t.EMISSAO),
          vencto: t.VENCTO,
          venctoFormatado: formatarDataBr(t.VENCTO),
          historico: t.HIST
        }))
      });
    } 
    // REGRA 2: Quitada parcialmente (Saldo > 0 mas houve baixa ou abate parcial)
    else if (totalSaldo > 0 && totalSaldo < totalValor) {
      excluidasParciais.push({
        e1Num: num,
        motivo: 'Quitada Parcialmente (Saldo remanescente > 0)',
        valorTotal: Number(totalValor.toFixed(2)),
        saldoTotal: Number(totalSaldo.toFixed(2)),
        baixa: items[0].BAIXA || '',
        emissao: items[0].EMISSAO || '',
        cliente: items[0].NOMCLI || '',
        historico: items[0].HIST || ''
      });
    }
    // REGRA 3: Sem pagamento quitado (Saldo = Valor, Baixa vazia)
    else {
      excluidasNaoQuitadas.push({
        e1Num: num,
        motivo: 'Sem pagamento quitado (Pendente no Protheus)',
        valorTotal: Number(totalValor.toFixed(2)),
        saldoTotal: Number(totalSaldo.toFixed(2)),
        baixa: items[0].BAIXA || '',
        emissao: items[0].EMISSAO || '',
        cliente: items[0].NOMCLI || '',
        historico: items[0].HIST || ''
      });
    }
  }

  console.log(`📊 Sumário Protheus:`);
  console.log(`   - OSs Quitadas (E1_SALDO = 0 e baixadas): ${quitadas.length}`);
  console.log(`   - OSs Parcialmente Quitadas (Excluídas): ${excluidasParciais.length}`);
  console.log(`   - OSs Sem Pagamento Quitado (Excluídas): ${excluidasNaoQuitadas.length}\n`);

  console.log('2. Correlacionando com o Portal da Assistência Técnica...');
  console.log(`   Total de OSs quitadas a consultar: ${quitadas.length} (lotes de 10)`);

  const BATCH_SIZE = 5;
  let concluidos = 0;
  let encontradasPortal = 0;
  let pendentesPortal = 0;
  let confirmadasPortal = 0;

  for (let i = 0; i < quitadas.length; i += BATCH_SIZE) {
    const batch = quitadas.slice(i, i + BATCH_SIZE);
    const promessas = batch.map(async (os) => {
      const portalData = await buscarOSNoPortal(os.numeroOS);
      if (portalData) {
        encontradasPortal++;
        const stPagto = portalData.status_pagamento || 'Pendente';
        if (stPagto.toLowerCase().includes('confirm') || stPagto.toLowerCase().includes('quitad')) {
          confirmadasPortal++;
        } else {
          pendentesPortal++;
        }

        os.portal = {
          encontrado: true,
          id_os: portalData.id_os || `onlineos-${portalData.numero_os}`,
          numero_os: portalData.numero_os,
          status_pagamento: stPagto,
          status_os: portalData.status_os || '',
          forma_pagamento: portalData.forma_pagamento || '',
          valor_os: portalData.valor_os || 0,
          valor_com_5pct_pix: portalData.valor_com_5pct_pix || 0,
          data_abertura: portalData.data_abertura || '',
          cliente_nome: portalData.cliente?.nome_razao_social || '',
          cliente_cpf_cnpj: portalData.cliente?.cpf_cnpj || '',
          cliente_email: portalData.cliente?.email || '',
          cliente_celular: portalData.cliente?.celular || '',
          link_os: portalData.link_os || `https://portal.gsicofres.com.br/assistencia/os/onlineos-${portalData.numero_os}`,
          candidata_alteracao: !stPagto.toLowerCase().includes('confirm') && !stPagto.toLowerCase().includes('quitad')
        };
      } else {
        os.portal = {
          encontrado: false,
          candidata_alteracao: false
        };
      }
    });

    await Promise.all(promessas);
    concluidos += batch.length;
    if (concluidos % 50 === 0 || concluidos === quitadas.length) {
      console.log(`   [Progresso] ${concluidos}/${quitadas.length} processadas... (Portal: ${encontradasPortal} encontradas, ${pendentesPortal} pendentes, ${confirmadasPortal} confirmadas)`);
    }
    // Pequena pausa entre lotes para não sobrecarregar
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n✅ Correlação concluída!`);
  console.log(`   - Encontradas no Portal: ${encontradasPortal}`);
  console.log(`   - Pendentes no Portal (Prontas para Alteração -> Quitado): ${pendentesPortal}`);
  console.log(`   - Já Confirmadas/Quitadas no Portal: ${confirmadasPortal}`);
  console.log(`   - Não localizadas no Portal (provavelmente legadas ou antigas): ${quitadas.length - encontradasPortal}\n`);

  // 3. Salvar arquivos locais
  console.log('3. Salvando dados em disco...');
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const pathJsonQuitadas = path.join(dataDir, 'os_quitadas_protheus.json');
  fs.writeFileSync(pathJsonQuitadas, JSON.stringify({
    dataExtracao: new Date().toISOString(),
    totalQuitadasProtheus: quitadas.length,
    encontradasPortal,
    pendentesPortal,
    confirmadasPortal,
    naoLocalizadasPortal: quitadas.length - encontradasPortal,
    itens: quitadas
  }, null, 2), 'utf-8');
  console.log(`   💾 Salvo: ${pathJsonQuitadas}`);

  const pathJsonExcluidas = path.join(dataDir, 'os_nao_quitadas_excluidas.json');
  fs.writeFileSync(pathJsonExcluidas, JSON.stringify({
    dataExtracao: new Date().toISOString(),
    totalExcluidas: excluidasParciais.length + excluidasNaoQuitadas.length,
    parcialmenteQuitadas: excluidasParciais,
    semPagamentoQuitado: excluidasNaoQuitadas
  }, null, 2), 'utf-8');
  console.log(`   💾 Salvo: ${pathJsonExcluidas}`);

  // 4. Gerar Relatório Markdown
  const pathMdRelatorio = path.join(dataDir, 'os_quitadas_relatorio.md');
  const candidatas = quitadas.filter(q => q.portal && q.portal.candidata_alteracao);

  let mdContent = `# Relatório de OSs Quitadas no Protheus e Status no Portal da Assistência\n\n`;
  mdContent += `> **Data da Extração:** ${new Date().toLocaleString('pt-BR')}  \n`;
  mdContent += `> **Fonte ERP:** Protheus MSSQL - Tabela SE1150 (GSI Cofres - Empresa 15)  \n`;
  mdContent += `> **Fonte Portal:** API Assistência Técnica (\`assistencia.gsicofres.com.br\`)  \n\n`;

  mdContent += `## 1. Resumo Executivo\n\n`;
  mdContent += `| Métrica | Quantidade | Observação |\n`;
  mdContent += `| :--- | :--- | :--- |\n`;
  mdContent += `| **Total de OSs Quitadas no Protheus** | **${quitadas.length}** | Títulos com \`E1_SALDO = 0\` e baixa quitada integralmente |\n`;
  mdContent += `| **OSs Encontradas no Portal da Assistência** | **${encontradasPortal}** | Localizadas na base online da assistência técnica |\n`;
  mdContent += `| ⚠️ **Candidatas a Alteração (Pendente -> Quitado)** | **${pendentesPortal}** | Quitadas no Protheus, mas ainda \`Pendente\` no Portal |\n`;
  mdContent += `| ✅ **Já Confirmadas/Quitadas no Portal** | **${confirmadasPortal}** | Já sincronizadas com status \`Confirmado\` |\n`;
  mdContent += `| ℹ️ **Não Localizadas no Portal** | **${quitadas.length - encontradasPortal}** | OSs anteriores ao sistema online (ex: OS 15000+ ou antigas) |\n`;
  mdContent += `| 🚫 **OSs Excluídas (Não Quitadas ou Parciais)** | **${excluidasParciais.length + excluidasNaoQuitadas.length}** | Respeitando a regra de exclusão estrita |\n\n`;

  mdContent += `## 2. OSs Excluídas (Regra Estrita Solicitada)\n\n`;
  mdContent += `### 2.1 OS Quitada Parcialmente (Exemplo: OS 1297)\n`;
  for (const exp of excluidasParciais) {
    mdContent += `- **${exp.e1Num}** | Valor Total: R$ ${exp.valorTotal.toFixed(2)} | **Saldo Aberto: R$ ${exp.saldoTotal.toFixed(2)}** | Baixa: ${formatarDataBr(exp.baixa)} | Cliente: ${exp.cliente} | *${exp.motivo}*\n`;
  }
  mdContent += `\n### 2.2 OSs Sem Pagamento Quitado (Exemplos: OS 1429, OS 1458, OS 1437)\n`;
  for (const exu of excluidasNaoQuitadas) {
    mdContent += `- **${exu.e1Num}** | Valor Total: R$ ${exu.valorTotal.toFixed(2)} | **Saldo Aberto: R$ ${exu.saldoTotal.toFixed(2)}** | Baixa: Nenhuma | Emissão: ${formatarDataBr(exu.emissao)} | Cliente: ${exu.cliente} | *${exu.motivo}*\n`;
  }

  mdContent += `\n## 3. Top 30 OSs Mais Recentes Candidatas a Alteração (Pendente -> Quitado no Portal)\n\n`;
  mdContent += `| OS | Nº OS | Valor Protheus | Data Baixa | Cliente Protheus | Status Portal Atual | Link Portal |\n`;
  mdContent += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  for (const c of candidatas.slice(0, 30)) {
    mdContent += `| **${c.e1Num}** | \`${c.numeroOS}\` | R$ ${c.valorTotal.toFixed(2)} | ${c.ultimaBaixaFormatada} | ${c.cliente.substring(0, 25)} | ⚠️ **${c.portal.status_pagamento}** | [Ver OS](${c.portal.link_os}) |\n`;
  }

  fs.writeFileSync(pathMdRelatorio, mdContent, 'utf-8');
  console.log(`   📄 Relatório Markdown: ${pathMdRelatorio}`);

  console.log('\n🎉 PROCESSO CONCLUÍDO COM SUCESSO!');
}

main().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
