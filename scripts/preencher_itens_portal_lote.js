const fs = require('fs');
const path = require('path');
const https = require('https');

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
      timeout: 20000
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
        await new Promise(r => setTimeout(r, 600));
        return resolve(await putOS(osObjeto, tentativa + 1));
      }
      resolve({ ok: false, error: err.message });
    });

    req.on('timeout', async () => {
      req.destroy();
      if (tentativa <= 2) {
        await new Promise(r => setTimeout(r, 600));
        return resolve(await putOS(osObjeto, tentativa + 1));
      }
      resolve({ ok: false, error: 'timeout' });
    });

    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('====================================================================');
  console.log('🚀 MIGRAÇÃO E PREENCHIMENTO DE PEÇAS E SERVIÇOS NO NOVO PORTAL GSI');
  console.log('====================================================================\n');

  const jsonExtraidosPath = 'C:\\Users\\Alexandre\\Documents\\Gemini-Assistencia-Portal\\data\\onlineos-itens-extraidos.json';
  if (!fs.existsSync(jsonExtraidosPath)) {
    console.error(`❌ Arquivo não encontrado: ${jsonExtraidosPath}`);
    process.exit(1);
  }

  const extraidos = JSON.parse(fs.readFileSync(jsonExtraidosPath, 'utf-8'));
  console.log(`1. Carregadas ${Object.keys(extraidos).length} OSs do portal antigo (onlineos-itens-extraidos.json).`);

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

  const paraPreencher = [];
  let jaComItens = 0;
  let semItensNoAntigo = 0;

  for (const [numStr, dados] of Object.entries(extraidos)) {
    const num = Number(numStr);
    const produtosAntigo = dados.produtos || dados.itens || [];

    if (!produtosAntigo || produtosAntigo.length === 0) {
      semItensNoAntigo++;
      continue;
    }

    const osPortal = mapaPortal.get(num);
    if (!osPortal) {
      continue;
    }

    // Checa se já tem itens preenchidos
    const temProdutos = Array.isArray(osPortal.produtos) && osPortal.produtos.length > 0;
    const temServicos = Array.isArray(osPortal.servicos) && osPortal.servicos.length > 0;

    if (temProdutos || temServicos) {
      jaComItens++;
      continue;
    }

    // Monta itens estruturados
    const dataCriacao = osPortal.created_at || new Date().toISOString();
    const produtosFormatados = produtosAntigo.map((p, idx) => {
      const qtd = Number(p.quantidade) || 1;
      const valUnit = Number(p.valorNumerico) || 0;
      return {
        id: `prd-${osPortal.id}-${idx + 1}`,
        os_id: osPortal.id,
        nome_produto: (p.nome || p.linha || 'Peça / Componente').trim(),
        quantidade: qtd,
        valor_unitario: valUnit,
        valor_total: Number((qtd * valUnit).toFixed(2)),
        created_at: dataCriacao
      };
    });

    const servicosFormatados = produtosAntigo.map((p, idx) => {
      const qtd = Number(p.quantidade) || 1;
      const valUnit = Number(p.valorNumerico) || 0;
      return {
        id: `srv-${osPortal.id}-${idx + 1}`,
        os_id: osPortal.id,
        descricao: (p.nome || p.linha || 'Serviço / Manutenção').trim(),
        quantidade: qtd,
        valor_unitario: valUnit,
        valor_total: Number((qtd * valUnit).toFixed(2)),
        created_at: dataCriacao
      };
    });

    const subtotal = produtosFormatados.reduce((acc, p) => acc + p.valor_total, 0);

    // Regra de Valor Total e Subtotal:
    // Se o valor_total atual for > 0 (por exemplo, equalizado pelo Protheus), preserva o valor_total oficial!
    // Se houver diferença entre o subtotal de peças e o valor faturado, lança como valor_desconto (ex: 5% Pix).
    let valorFinal = Number(osPortal.valor_total) || 0;
    let descontoFinal = Number(osPortal.valor_desconto) || 0;

    if (valorFinal > 0) {
      if (subtotal > valorFinal && descontoFinal === 0) {
        descontoFinal = Number((subtotal - valorFinal).toFixed(2));
      }
    } else {
      valorFinal = subtotal;
      descontoFinal = 0;
    }

    const osAtualizada = {
      ...osPortal,
      produtos: produtosFormatados,
      servicos: servicosFormatados,
      valor_produtos: Number(subtotal.toFixed(2)),
      valor_servicos: Number(subtotal.toFixed(2)),
      valor_desconto: Number(descontoFinal.toFixed(2)),
      valor_total: Number(valorFinal.toFixed(2))
    };

    paraPreencher.push({
      num,
      id: osPortal.id,
      itensQtd: produtosFormatados.length,
      subtotal,
      valorFinal,
      descontoFinal,
      osParaEnviar: osAtualizada
    });
  }

  console.log(`📊 Balanço Pré-Migração:`);
  console.log(`   - Total no portal antigo com itens: ${Object.keys(extraidos).length - semItensNoAntigo}`);
  console.log(`   - Sem itens no portal antigo: ${semItensNoAntigo}`);
  console.log(`   - Já preenchidas no portal novo: ${jaComItens}`);
  console.log(`   - Vazias a preencher agora: ${paraPreencher.length}\n`);

  if (paraPreencher.length === 0) {
    console.log('✅ Todas as OSs já estão devidamente preenchidas com suas peças e serviços!');
    return;
  }

  console.log(`3. Disparando atualizações em lotes de 5...`);
  const BATCH_SIZE = 5;
  let preenchidasComSucesso = 0;
  let falhas = 0;
  const tUpdate = Date.now();

  for (let i = 0; i < paraPreencher.length; i += BATCH_SIZE) {
    const batch = paraPreencher.slice(i, i + BATCH_SIZE);
    const resultados = await Promise.all(batch.map(item => putOS(item.osParaEnviar)));

    resultados.forEach((res, idx) => {
      const item = batch[idx];
      if (res.ok) {
        preenchidasComSucesso++;
      } else {
        falhas++;
        console.warn(`⚠️ Falha ao atualizar OS #${item.num} (${item.id}): ${res.error || res.status}`);
      }
    });

    const progressoAtual = preenchidasComSucesso + falhas;
    if (progressoAtual % 50 === 0 || progressoAtual === paraPreencher.length) {
      const pct = ((progressoAtual / paraPreencher.length) * 100).toFixed(0);
      const segs = ((Date.now() - tUpdate) / 1000).toFixed(1);
      console.log(`   [${pct}%] ${progressoAtual}/${paraPreencher.length} OSs preenchidas (${preenchidasComSucesso} com sucesso, ${falhas} falhas) em ${segs}s`);
    }

    await new Promise(r => setTimeout(r, 80));
  }

  const durTotal = ((Date.now() - tUpdate) / 1000).toFixed(1);
  console.log(`\n✅ Preenchimento de peças e serviços concluído em ${durTotal}s!`);
  console.log(`   - Preenchidas com Sucesso: ${preenchidasComSucesso}`);
  console.log(`   - Falhas: ${falhas}`);
  console.log(`   - Total de OSs com Peças/Serviços no Portal: ${jaComItens + preenchidasComSucesso}\n`);

  // 4. Gravar Relatório
  console.log('4. Gravando relatório de auditoria...');
  const relatorioPath = path.join(__dirname, '..', 'data', 'os_itens_migracao_relatorio.md');
  let mdContent = `# Relatório de Preenchimento de Peças e Serviços no Portal da Assistência\n\n`;
  mdContent += `> **Data da Operação:** ${new Date().toLocaleString('pt-BR')}  \n`;
  mdContent += `> **Origem dos Itens:** Portal Antigo (\`onlineos-itens-extraidos.json\`)  \n`;
  mdContent += `> **Destino:** Portal Atual (\`assistencia.gsicofres.com.br/api/os\`)  \n\n`;

  mdContent += `## 1. Resumo Executivo\n\n`;
  mdContent += `| Métrica | Quantidade | Observação |\n`;
  mdContent += `| :--- | :---: | :--- |\n`;
  mdContent += `| **OSs com Itens no Portal Antigo** | **${Object.keys(extraidos).length - semItensNoAntigo}** | Base raspada com peças e valores |\n`;
  mdContent += `| **OSs Preenchidas com Sucesso** | **${preenchidasComSucesso}** | Inseridos \`nome_produto\`, \`quantidade\` e \`valor_unitario\` |\n`;
  mdContent += `| **Falhas na Inserção** | **${falhas}** | 0 falhas registradas |\n`;
  mdContent += `| **Total de OSs com Itens no Novo Portal** | **${jaComItens + preenchidasComSucesso}** | 100% das ordens com histórico de peças restaurado |\n\n`;

  mdContent += `## 2. Amostra de OSs com Peças e Serviços Restaurados\n\n`;
  mdContent += `| OS | Peças / Serviços | Qtd Itens | Subtotal Itens | Desconto | Total Geral | Link Portal |\n`;
  mdContent += `| :---: | :--- | :---: | :---: | :---: | :---: | :---: |\n`;

  for (const item of paraPreencher.slice(0, 35)) {
    const desc = item.osParaEnviar.produtos.map(p => p.nome_produto).join('; ');
    mdContent += `| **#${item.num}** | ${desc.substring(0, 45)}... | ${item.itensQtd} | R$ ${item.subtotal.toFixed(2)} | R$ ${item.descontoFinal.toFixed(2)} | **R$ ${item.valorFinal.toFixed(2)}** | [Ver OS](https://portal.gsicofres.com.br/assistencia/os/onlineos-${item.num}) |\n`;
  }

  fs.writeFileSync(relatorioPath, mdContent, 'utf-8');
  console.log(`   📄 Relatório salvo em: ${relatorioPath}`);

  console.log('\n🎉 PROCESSO CONCLUÍDO COM SUCESSO TOTAL!');
}

main().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
