/**
 * generate_faturamento_sql.js
 * Extrai os 2.912 itens de faturamento do Protheus e gera os comandos SQL de inserção
 * para carga instantânea no Supabase
 */

const fs = require('fs');
const path = require('path');
const { consultarFaturamentoHistorico } = require('./protheus_db');

function escapeSql(str) {
  if (str === null || str === undefined) return 'NULL';
  return `'${String(str).replace(/'/g, "''").trim()}'`;
}

async function run() {
  console.log('⏳ Consultando faturamento histórico no Protheus ERP...');
  const itens = await consultarFaturamentoHistorico();
  console.log(`✅ ${itens.length} itens faturados extraídos do Protheus.`);

  const outputFile = path.join(__dirname, 'sql', 'bi', 'carga_faturamento_inicial.sql');
  const chunks = [];
  const chunkSize = 200;

  let sqlContent = `-- ============================================================================
-- CARGA INICIAL DE FATURAMENTO HISTÓRICO PROTHEUS -> SUPABASE
-- Gerado automaticamente em ${new Date().toISOString()}
-- Total de Registros: ${itens.length} itens faturados (Multi-Empresa: MP 14, GSI 15, OACO 16)
-- ============================================================================

`;

  for (let i = 0; i < itens.length; i += chunkSize) {
    const chunk = itens.slice(i, i + chunkSize);
    let chunkSql = `INSERT INTO faturamento_itens_historico (
    empresa_cod, empresa_sigla, nota_doc, nota_serie, item_num,
    pedido_venda, cliente_cod, cliente_nome, vendedor_cod, vendedor_nome,
    produto_cod, produto_descricao, grupo_cod, grupo_descricao,
    quantidade, preco_unitario, valor_total_item, valor_total_nota,
    cfop, tipo_nota, data_emissao, mes_ano
) VALUES\n`;

    const valueRows = chunk.map(it => {
      return `  (${escapeSql(it.empresa_cod)}, ${escapeSql(it.empresa_sigla)}, ${escapeSql(it.nota_doc)}, ${escapeSql(it.nota_serie)}, ${escapeSql(it.item_num)}, ` +
             `${escapeSql(it.pedido_venda)}, ${escapeSql(it.cliente_cod)}, ${escapeSql(it.cliente_nome)}, ${escapeSql(it.vendedor_cod)}, ${escapeSql(it.vendedor_nome)}, ` +
             `${escapeSql(it.produto_cod)}, ${escapeSql(it.produto_descricao)}, ${escapeSql(it.grupo_cod)}, ${escapeSql(it.grupo_descricao)}, ` +
             `${Number(it.quantidade || 0)}, ${Number(it.preco_unitario || 0)}, ${Number(it.valor_total_item || 0)}, ${Number(it.valor_total_nota || 0)}, ` +
             `${escapeSql(it.cfop)}, ${escapeSql(it.tipo_nota)}, ${escapeSql(it.data_emissao)}, ${escapeSql(it.mes_ano)})`;
    });

    chunkSql += valueRows.join(',\n') + '\nON CONFLICT (empresa_cod, nota_doc, nota_serie, item_num) DO UPDATE SET\n' +
      '  cliente_nome = EXCLUDED.cliente_nome,\n' +
      '  vendedor_nome = EXCLUDED.vendedor_nome,\n' +
      '  produto_descricao = EXCLUDED.produto_descricao,\n' +
      '  grupo_descricao = EXCLUDED.grupo_descricao,\n' +
      '  quantidade = EXCLUDED.quantidade,\n' +
      '  preco_unitario = EXCLUDED.preco_unitario,\n' +
      '  valor_total_item = EXCLUDED.valor_total_item,\n' +
      '  valor_total_nota = EXCLUDED.valor_total_nota,\n' +
      '  data_emissao = EXCLUDED.data_emissao,\n' +
      '  mes_ano = EXCLUDED.mes_ano,\n' +
      '  synced_at = NOW();\n\n';

    sqlContent += chunkSql;
  }

  fs.writeFileSync(outputFile, sqlContent, 'utf-8');
  console.log(`✅ Arquivo de carga gerado com sucesso em: ${outputFile}`);
  console.log(`Tamanho do arquivo: ${(fs.statSync(outputFile).size / 1024).toFixed(2)} KB`);
}

run().catch(console.error);
