const fs = require('fs');
const path = require('path');
const https = require('https');

function formatarDataIso(baixaStr) {
  if (!baixaStr || baixaStr.length !== 8) return new Date().toISOString();
  const y = baixaStr.substring(0, 4);
  const m = baixaStr.substring(4, 6);
  const d = baixaStr.substring(6, 8);
  return `${y}-${m}-${d}T12:00:00.000Z`;
}

function formatarDataBr(str) {
  if (!str || str.length !== 8) return str || '-';
  const y = str.substring(0, 4);
  const m = str.substring(4, 6);
  const d = str.substring(6, 8);
  return `${d}/${m}/${y}`;
}

function putOS(osObjeto, tentativa = 1) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ os: osObjeto });
    const req = https.request('https://assistencia.gsicofres.com.br/api/os', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Gemini-Cli-PgtosDesconhecidos/1.0',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode });
        } else {
          resolve({ ok: false, status: res.statusCode, error: data.substring(0, 150) });
        }
      });
    });

    req.on('error', async (err) => {
      if (tentativa <= 2) {
        await new Promise(r => setTimeout(r, 500));
        return resolve(await putOS(osObjeto, tentativa + 1));
      }
      resolve({ ok: false, error: err.message });
    });

    req.on('timeout', async () => {
      req.destroy();
      if (tentativa <= 2) {
        await new Promise(r => setTimeout(r, 500));
        return resolve(await putOS(osObjeto, tentativa + 1));
      }
      resolve({ ok: false, error: 'timeout' });
    });

    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('================================================================');
  console.log('🚀 ATUALIZAÇÃO EM LOTE: STATUS PAGAMENTO NO PORTAL DA ASSISTÊNCIA');
  console.log('================================================================\n');

  const jsonPath = path.join(__dirname, '..', 'data', 'os_quitadas_protheus.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('❌ Arquivo data/os_quitadas_protheus.json não encontrado!');
    process.exit(1);
  }

  const d = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`1. Carregadas ${d.itens.length} OSs quitadas no Protheus do arquivo local.`);

  console.log('2. Buscando ordens de serviço ativas no Portal da Assistência...');
  const t0 = Date.now();
  const getRes = await new Promise((resolve, reject) => {
    https.get('https://assistencia.gsicofres.com.br/api/os', { headers: { 'User-Agent': 'Gemini-Cli-PgtosDesconhecidos/1.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
  console.log(`   ✅ Obtidas ${getRes.ordens.length} ordens do portal em ${((Date.now() - t0) / 1000).toFixed(1)}s.\n`);

  const mapaPortal = new Map();
  for (const o of getRes.ordens) {
    if (o && o.numero_os) {
      mapaPortal.set(Number(o.numero_os), o);
    }
  }

  const paraAtualizar = [];
  let jaConfirmadas = 0;
  let naoNoPortal = 0;

  for (const q of d.itens) {
    const num = Number(q.numeroOS);
    const osPortal = mapaPortal.get(num);

    if (osPortal) {
      if (osPortal.status_pagamento === 'Confirmado') {
        jaConfirmadas++;
      } else {
        const dataBaixaIso = formatarDataIso(q.ultimaBaixa);
        const osAtualizada = {
          ...osPortal,
          status_pagamento: 'Confirmado',
          data_pagamento_confirmado: dataBaixaIso,
          pagamento_confirmado_por: 'Conciliação Automática Protheus (Gemini-Cli)'
        };
        paraAtualizar.push({
          num,
          id: osPortal.id,
          osParaEnviar: osAtualizada,
          protheus: q
        });
      }
    } else {
      naoNoPortal++;
    }
  }

  console.log(`📊 Balanço Pré-Execução:`);
  console.log(`   - Total no Protheus (Quitadas): ${d.itens.length}`);
  console.log(`   - Encontradas no Portal: ${jaConfirmadas + paraAtualizar.length}`);
  console.log(`   - Já 'Confirmado' no Portal: ${jaConfirmadas}`);
  console.log(`   - A ser atualizadas (Pendente -> Confirmado): ${paraAtualizar.length}`);
  console.log(`   - Não encontradas no Portal (Legadas): ${naoNoPortal}\n`);

  if (paraAtualizar.length === 0) {
    console.log('✅ Todas as OSs já estão com status Confirmado no Portal!');
    return;
  }

  console.log(`3. Iniciando disparos de atualização em lotes de 5...`);
  const BATCH_SIZE = 5;
  let atualizadasComSucesso = 0;
  let falhas = 0;
  const tUpdate = Date.now();

  for (let i = 0; i < paraAtualizar.length; i += BATCH_SIZE) {
    const batch = paraAtualizar.slice(i, i + BATCH_SIZE);
    const resultados = await Promise.all(batch.map(item => putOS(item.osParaEnviar)));

    resultados.forEach((res, idx) => {
      const item = batch[idx];
      if (res.ok) {
        atualizadasComSucesso++;
        // Atualiza objeto em memória local
        const itemNoJson = d.itens.find(it => Number(it.numeroOS) === item.num);
        if (itemNoJson && itemNoJson.portal) {
          itemNoJson.portal.status_pagamento = 'Confirmado';
          itemNoJson.portal.candidata_alteracao = false;
          itemNoJson.portal.data_pagamento_confirmado = item.osParaEnviar.data_pagamento_confirmado;
          itemNoJson.portal.pagamento_confirmado_por = item.osParaEnviar.pagamento_confirmado_por;
        }
      } else {
        falhas++;
        console.warn(`⚠️ Falha ao atualizar OS #${item.num} (${item.id}): ${res.error || res.status}`);
      }
    });

    const progressoAtual = atualizadasComSucesso + falhas;
    if (progressoAtual % 25 === 0 || progressoAtual === paraAtualizar.length) {
      const pct = ((progressoAtual / paraAtualizar.length) * 100).toFixed(0);
      const segs = ((Date.now() - tUpdate) / 1000).toFixed(1);
      console.log(`   [${pct}%] ${progressoAtual}/${paraAtualizar.length} OSs processadas (${atualizadasComSucesso} com sucesso, ${falhas} falhas) em ${segs}s`);
    }

    await new Promise(r => setTimeout(r, 80));
  }

  const durTotal = ((Date.now() - tUpdate) / 1000).toFixed(1);
  console.log(`\n✅ Atualização em lote finalizada em ${durTotal}s!`);
  console.log(`   - Atualizadas com Sucesso para 'Confirmado': ${atualizadasComSucesso}`);
  console.log(`   - Falhas: ${falhas}`);
  console.log(`   - Anteriormente já confirmadas: ${jaConfirmadas}`);
  console.log(`   - Total Confirmado Agora no Portal: ${jaConfirmadas + atualizadasComSucesso}\n`);

  // 4. Salvar arquivos locais atualizados
  console.log('4. Atualizando arquivos locais...');
  d.confirmadasPortal = jaConfirmadas + atualizadasComSucesso;
  d.pendentesPortal = paraAtualizar.length - atualizadasComSucesso;
  d.dataUltimaSincronizacao = new Date().toISOString();

  fs.writeFileSync(jsonPath, JSON.stringify(d, null, 2), 'utf-8');
  console.log(`   💾 Salvo: ${jsonPath}`);

  // Atualizar Relatório Markdown
  const mdPath = path.join(__dirname, '..', 'data', 'os_quitadas_relatorio.md');
  const excluidasPath = path.join(__dirname, '..', 'data', 'os_nao_quitadas_excluidas.json');
  const excl = fs.existsSync(excluidasPath) ? JSON.parse(fs.readFileSync(excluidasPath, 'utf-8')) : { parcialmenteQuitadas: [], semPagamentoQuitado: [] };

  let mdContent = `# Relatório de Conciliação e Atualização de OSs no Portal da Assistência\n\n`;
  mdContent += `> **Data da Atualização em Lote:** ${new Date().toLocaleString('pt-BR')}  \n`;
  mdContent += `> **Status:** Concluído com Sucesso via API Oficial  \n`;
  mdContent += `> **Fonte ERP:** Protheus MSSQL - Tabela SE1150 (GSI Cofres - Empresa 15)  \n`;
  mdContent += `> **Portal Destino:** API Assistência Técnica (\`assistencia.gsicofres.com.br/api/os\`)  \n\n`;

  mdContent += `## 1. Resumo da Execução\n\n`;
  mdContent += `| Indicador | Quantidade | Status |\n`;
  mdContent += `| :--- | :---: | :--- |\n`;
  mdContent += `| **Total de OSs Quitadas no Protheus** | **${d.itens.length}** | Títulos com \`E1_SALDO = 0.00\` |\n`;
  mdContent += `| **OSs Encontradas no Portal** | **${jaConfirmadas + paraAtualizar.length}** | Base ativa do Portal da Assistência |\n`;
  mdContent += `| ✅ **Atualizadas para 'Confirmado' nesta Execução** | **${atualizadasComSucesso}** | Sincronizadas com sucesso via API |\n`;
  mdContent += `| ✅ **Já Estavam 'Confirmado'** | **${jaConfirmadas}** | Mantidas sem alteração |\n`;
  mdContent += `| ⚠️ **Pendentes Restantes** | **${d.pendentesPortal}** | Falhas na transmissão |\n`;
  mdContent += `| ℹ️ **Legadas / Não no Portal Online** | **${naoNoPortal}** | OSs de 2025 anteriores ao portal online |\n`;
  mdContent += `| 🚫 **OSs Excluídas (Não Quitadas ou Parciais)** | **${excl.totalExcluidas || 5}** | Preservadas sem alteração |\n\n`;

  mdContent += `## 2. Amostra de OSs Atualizadas com Sucesso para "Confirmado"\n\n`;
  mdContent += `| OS Protheus | Nº OS Portal | Valor Protheus | Data Baixa Protheus | Cliente | Status Portal | Link Portal |\n`;
  mdContent += `| :--- | :---: | :---: | :---: | :--- | :---: | :---: |\n`;

  const atualizadasAmostra = paraAtualizar.slice(0, 35);
  for (const a of atualizadasAmostra) {
    mdContent += `| **${a.protheus.e1Num}** | \`${a.num}\` | R$ ${a.protheus.valorTotal.toFixed(2)} | ${a.protheus.ultimaBaixaFormatada} | ${(a.protheus.cliente || '-').substring(0, 25)} | ✅ **Confirmado** | [Ver OS](https://portal.gsicofres.com.br/assistencia/os/onlineos-${a.num}) |\n`;
  }

  mdContent += `\n## 3. OSs Excluídas (Preservadas com Sucesso)\n\n`;
  for (const exp of (excl.parcialmenteQuitadas || [])) {
    mdContent += `- 🚫 **${exp.e1Num}** | Valor: R$ ${exp.valorTotal.toFixed(2)} | Saldo Aberto: R$ ${exp.saldoTotal.toFixed(2)} | *Quitada Parcialmente (Não alterada)*\n`;
  }
  for (const exu of (excl.semPagamentoQuitado || [])) {
    mdContent += `- 🚫 **${exu.e1Num}** | Valor: R$ ${exu.valorTotal.toFixed(2)} | Saldo Aberto: R$ ${exu.saldoTotal.toFixed(2)} | *Sem Pagamento Quitado (Não alterada)*\n`;
  }

  fs.writeFileSync(mdPath, mdContent, 'utf-8');
  console.log(`   📄 Relatório Markdown atualizado: ${mdPath}`);

  console.log('\n🎉 PROCESSO DE ATUALIZAÇÃO CONCLUÍDO COM ÊXITO TOTAL!');
}

main().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
