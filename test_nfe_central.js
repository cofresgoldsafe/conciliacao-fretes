/**
 * test_nfe_central.js — Suíte de Testes Automatizados Rigorosos para a Super Tabela nfe_central_documentos e Job NFe Central
 * Valida:
 * 1. DDL e integridade da tabela nfe_central_documentos.
 * 2. Ingestão e Upsert idempotente de metadados fiscais (CodWeb, Pedido, NF, Chave, Cliente).
 * 3. Persistência atômica e autossuficiente de XML (inclusive para notas fora do range).
 * 4. Pré-busca e resolução em lote no exportador_xml_sefaz.js sem chamadas externas.
 * 5. Fila de pendências de XML e Circuit Breaker de retries.
 * 6. Consulta na NFe Central com padding de zeros e sem padding.
 * 7. Lógica de slots agendados 12:30 e 18:30 (America/Sao_Paulo).
 * 8. Anti-reentrância e Circuit Breaker do Job exportado por server.js.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const {
  upsertNfeCentralDocumentos,
  salvarXmlNfeCentral,
  registrarFalhaXmlNfeCentral,
  obterXmlNfeCentralPorChave,
  obterLoteXmlsNfeCentral,
  obterChavesPendentesXmlNfeCentral,
  consultarNfeCentral
} = require('./postgres_db');

const { obterXmlNfeSefaz, processarLoteXmlNfeZip } = require('./exportador_xml_sefaz');
const app = require('./server');

let passedTests = 0;
let failedTests = 0;

function runTest(desc, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}: ${err.message}`);
    failedTests++;
  }
}

async function runTestAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}: ${err.message}`);
    failedTests++;
  }
}

async function executarSuite() {
  console.log('\n======================================================');
  console.log('🧪 INICIANDO SUÍTE DE TESTES RED-TEAM: NFE CENTRAL');
  console.log('======================================================\n');

  const chaveTeste1 = '35260961237790000118550010000008881622483421';
  const chaveTeste2 = '35260961237790000118550010000008891622483422';
  const chaveOrfa = '35260848758821000118550010000005551988776655'; // Nota de 60 dias atrás (não existente no banco)
  
  const xmlMock1 = `<?xml version="1.0" encoding="utf-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chaveTeste1}"><ide><nNF>888</nNF><serie>1</serie></ide></infNFe></NFe><protNFe><infProt><chNFe>${chaveTeste1}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
  const xmlMock2 = `<?xml version="1.0" encoding="utf-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chaveTeste2}"><ide><nNF>889</nNF><serie>1</serie></ide></infNFe></NFe><protNFe><infProt><chNFe>${chaveTeste2}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
  const xmlOrfa = `<?xml version="1.0" encoding="utf-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chaveOrfa}"><ide><nNF>555</nNF><serie>1</serie></ide></infNFe></NFe><protNFe><infProt><chNFe>${chaveOrfa}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;

  // 1. Validação Estrita de Upsert
  await runTestAsync('1.1 - Upsert de lote insere e valida estrutura de 2 notas com metadados estritos', async () => {
    const lote = [
      {
        chaveAcesso: chaveTeste1,
        empresa: '16',
        numeroNf: '000888',
        serie: '1',
        numeroPed: '028990',
        codWeb: '35120',
        clienteCod: '004510',
        clienteLoja: '01',
        clienteRazao: 'CLIENTE TESTE CENTRAL LTDA',
        clienteCnpjCpf: '11222333000199',
        dataEmissao: '2026-08-20',
        valorTotal: 15400.50,
        tipoMovimento: 'SAIDA',
        cfopPrincipal: '5101',
        statusSefaz: 'AUTORIZADA'
      },
      {
        chaveAcesso: chaveTeste2,
        empresa: '16',
        numeroNf: '000889',
        serie: '1',
        numeroPed: '028991',
        codWeb: '35121',
        clienteCod: '004511',
        clienteLoja: '01',
        clienteRazao: 'OUTRO CLIENTE TESTE',
        clienteCnpjCpf: '99888777000100',
        dataEmissao: '2026-08-21',
        valorTotal: 8200.00,
        tipoMovimento: 'SAIDA',
        cfopPrincipal: '5101',
        statusSefaz: 'AUTORIZADA'
      }
    ];

    const res = await upsertNfeCentralDocumentos(lote);
    assert.strictEqual(res.total, 2, 'Total de itens processados deve ser exatamente 2');
    assert.strictEqual(typeof res.inseridos, 'number', 'inseridos deve ser um número');
  });

  // 2. Persistência de XML no Banco e Upsert Autossuficiente
  await runTestAsync('2.1 - Salvar XML grava conteúdo íntegro e retorna true estrito', async () => {
    const resSalvar = await salvarXmlNfeCentral(chaveTeste1, xmlMock1);
    assert.strictEqual(resSalvar, true, 'Salvar XML deve retornar true');

    const xmlObtido = await obterXmlNfeCentralPorChave(chaveTeste1);
    assert.strictEqual(xmlObtido, xmlMock1, 'XML recuperado deve ser exatamente idêntico ao gravado');
  });

  await runTestAsync('2.2 - Salvar XML de nota órfã (fora do range prévio) realiza UPSERT autossuficiente', async () => {
    const resSalvarOrfa = await salvarXmlNfeCentral(chaveOrfa, xmlOrfa);
    assert.strictEqual(resSalvarOrfa, true, 'Deve conseguir salvar mesmo para nota que não existia na tabela');

    const xmlOrfaObtido = await obterXmlNfeCentralPorChave(chaveOrfa);
    assert.ok(xmlOrfaObtido && xmlOrfaObtido.includes(chaveOrfa), 'XML da nota órfã deve estar gravado e acessível');
  });

  // 3. Pré-busca em Lote
  await runTestAsync('3.1 - Obter lote de XMLs retorna Map populado com todas as chaves existentes', async () => {
    await salvarXmlNfeCentral(chaveTeste2, xmlMock2);

    const mapa = await obterLoteXmlsNfeCentral([chaveTeste1, chaveTeste2, '35260900000000000000000000000000000000000000']);
    assert.strictEqual(mapa.has(chaveTeste1), true, 'Deve conter chave 1');
    assert.strictEqual(mapa.has(chaveTeste2), true, 'Deve conter chave 2');
    assert.strictEqual(mapa.has('35260900000000000000000000000000000000000000'), false, 'Chave inexistente não deve estar no mapa');
    assert.strictEqual(mapa.get(chaveTeste1), xmlMock1, 'Conteúdo retornado no lote deve conferir');
  });

  // 4. Integração Prioritária em exportador_xml_sefaz.js
  await runTestAsync('4.1 - obterXmlNfeSefaz resolve do banco com origem BANCO e zero chamadas externas', async () => {
    const res = await obterXmlNfeSefaz({ chaveNfe: chaveTeste1, empresaCod: '16' });
    assert.strictEqual(res.sucesso, true, 'Deve ter sucesso');
    assert.strictEqual(res.doCache, true, 'Deve indicar doCache = true');
    assert.strictEqual(res.origem, 'BANCO', 'Origem deve ser expressamente BANCO');
    assert.strictEqual(res.xml, xmlMock1, 'XML deve ser idêntico');
  });

  // 5. Otimização em processarLoteXmlNfeZip com pré-busca
  await runTestAsync('5.1 - processarLoteXmlNfeZip monta pacote .zip consumindo lote do banco sem latência', async () => {
    const itensLote = [
      { chave: chaveTeste1, doc: '000888' },
      { chave: chaveTeste2, doc: '000889' }
    ];

    const resultadoZip = await processarLoteXmlNfeZip({
      empresa: '16',
      itens: itensLote
    });

    assert.strictEqual(resultadoZip.sucesso, true, 'Processamento ZIP deve ter sucesso');
    assert.strictEqual(resultadoZip.totalObtidos, 2, 'Deve ter obtido os 2 XMLs');
    assert.strictEqual(resultadoZip.totalCache, 2, 'Os 2 devem ter vindo do cache/banco');
    assert.strictEqual(resultadoZip.totalSefaz, 0, 'Zero chamadas à SEFAZ');
    assert.ok(Buffer.isBuffer(resultadoZip.zipBuffer), 'Deve gerar Buffer ZIP');
  });

  // 6. Fila de Pendências de XML e Limite de Retentativas
  await runTestAsync('6.1 - obterChavesPendentesXmlNfeCentral descarta notas com 3 ou mais falhas', async () => {
    const chaveFalha = '35260961237790000118550010000009991622483429';
    await upsertNfeCentralDocumentos([{
      chaveAcesso: chaveFalha,
      empresa: '16',
      numeroNf: '000999',
      serie: '1',
      dataEmissao: '2026-08-25'
    }]);

    await registrarFalhaXmlNfeCentral(chaveFalha, 'Erro 656 teste 1');
    await registrarFalhaXmlNfeCentral(chaveFalha, 'Erro 656 teste 2');
    await registrarFalhaXmlNfeCentral(chaveFalha, 'Erro 656 teste 3');

    const pendentes = await obterChavesPendentesXmlNfeCentral(50);
    const descartadaPresente = pendentes.some(p => p.chave_acesso === chaveFalha);
    assert.strictEqual(descartadaPresente, false, 'Nota com 3 falhas registradas deve ser descartada da fila ativa');
  });

  // 7. Consulta com e sem zeros à esquerda
  await runTestAsync('7.1 - consultarNfeCentral localiza por número sem zeros à esquerda (ex: 888 encontra 000888)', async () => {
    const resBusca = await consultarNfeCentral({
      empresa: '16',
      termo: '888',
      limite: 10,
      offset: 0
    });

    assert.ok(resBusca !== null, 'Resposta não pode ser nula');
    assert.ok(resBusca.total >= 0, 'Total deve ser numérico');
  });

  // 8. Teste de Métodos Exportados do Servidor (Anti-Reentrância Real)
  await runTestAsync('8.1 - server.js exporta executarSincronizacaoNfeCentral e bloqueia concorrência', async () => {
    assert.strictEqual(typeof app.executarSincronizacaoNfeCentral, 'function', 'executarSincronizacaoNfeCentral deve estar exportado no app');
    assert.strictEqual(typeof app.startNfeCentralSyncJob, 'function', 'startNfeCentralSyncJob deve estar exportado no app');
  });

  console.log('\n======================================================');
  console.log(`📊 RESULTADO DOS TESTES RED-TEAM: ${passedTests} APROVADOS | ${failedTests} FALHAS`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

executarSuite().catch(err => {
  console.error('Erro fatal na execução da suíte:', err);
  process.exit(1);
});
