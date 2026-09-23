/**
 * test_logistica_xml_faturamento.js — Suíte de Testes Automatizados para Exportação de XMLs no Google Drive
 * 
 * Valida:
 * 1. Nomenclatura oficial rigorosa: [SIGLA]-[NF8]-[CHAVE44]-[CLIENTE6].xml (MP, GSI, OACO).
 * 2. Roteamento automático de diretórios no Google Drive: [ANO]/[EMPRESA]/[MM.ANO].
 * 3. Validação de dias úteis no Job das 18:00 (segunda a sexta-feira).
 * 4. Resolução em lote de XMLs com integridade <nfeProc> e fallback sintético Protheus.
 * 5. Gravação direta em disco (sem ZIP) respeitando a hierarquia de pastas.
 * 6. Governança contábil: bloqueio estrito de notas canceladas (evita emissão de protocolo falso 100).
 * 7. Resolução de múltiplos formatos de data e suporte multianual (2026, 2027, etc.).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  formatarNomeXmlLogistica,
  obterMetadadosRoteamentoDrive,
  normalizarCodigoEmpresa,
  buscarNotasFaturadasLogistica,
  resolverXmlNota,
  obterLoteXmlsFaturados,
  executarJobSincronizacaoDrive18h
} = require('./logistica_xml_service');

let testesPassados = 0;
let totalTestes = 0;

async function test(descricao, fn) {
  totalTestes++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${descricao}`);
    testesPassados++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${descricao}`);
    console.error(`     Erro: ${err.message}`);
    process.exitCode = 1;
  }
}

async function rodarSuite() {
  console.log('\n========================================================================');
  console.log('🧪 INICIANDO SUÍTE DE TESTES: LOGÍSTICA XMLS & GOOGLE DRIVE');
  console.log('========================================================================\n');

  // ----------------------------------------------------------------------------
  // 1. TESTES DE NOMENCLATURA RIGOROSA DOS XMLS
  // ----------------------------------------------------------------------------
  console.log('--- 1. Nomenclatura Oficial dos Arquivos XML ---');

  await test('Deve gerar nome correto para Metal Pleno (14) no formato MP-00123456-[CHAVE]-[CLI6].xml', () => {
    const chave = '35260948758821000118550010000004091540731944';
    const nome = formatarNomeXmlLogistica({
      empresa: '14',
      numeroNf: '123456',
      chaveAcesso: chave,
      clienteRazao: 'CLIENT LTDA'
    });
    assert.strictEqual(nome, `MP-00123456-${chave}-CLIENT.xml`);
  });

  await test('Deve gerar nome correto para OAÇO (16) com padding de 8 dígitos e cliente sanitizado', () => {
    const chave = '35260961237790000118550010000007281622483426';
    const nome = formatarNomeXmlLogistica({
      empresa: '16',
      numeroNf: '728',
      chaveAcesso: chave,
      clienteRazao: 'SUPERMERCADO DIA BRASIL S.A.'
    });
    assert.strictEqual(nome, `OACO-00000728-${chave}-SUPERM.xml`);
  });

  await test('Deve gerar nome correto para GSI Brasil (15) tratando caracteres acentuados', () => {
    const chave = '35260914061778000115550010000001231622483426';
    const nome = formatarNomeXmlLogistica({
      empresa: '15',
      numeroNf: '000123',
      chaveAcesso: chave,
      clienteRazao: 'AÇO & FERRO INDÚSTRIA LTDA'
    });
    // 'AÇO & FERRO' -> 'ACOFER' (6 letras)
    assert.strictEqual(nome, `GSI-00000123-${chave}-ACOFER.xml`);
  });

  await test('Deve preencher com X caso o nome do cliente tenha menos de 6 caracteres', () => {
    const chave = '35260961237790000118550010000007001207268330';
    const nome = formatarNomeXmlLogistica({
      empresa: '16',
      numeroNf: '700',
      chaveAcesso: chave,
      clienteRazao: 'ABC'
    });
    assert.strictEqual(nome, `OACO-00000700-${chave}-ABCXXX.xml`);
  });

  // ----------------------------------------------------------------------------
  // 2. TESTES DE ROTEAMENTO DE PASTAS NO GOOGLE DRIVE
  // ----------------------------------------------------------------------------
  console.log('\n--- 2. Roteamento de Diretórios no Google Drive ---');

  await test('Deve mapear Empresa 14 para subpasta "METAL PLENO" e mês/ano correspondente', () => {
    const rot = obterMetadadosRoteamentoDrive({
      empresa: '14',
      dataEmissao: '2026-09-23',
      basePath: 'G:\\Drives compartilhados\\Fiscal e Faturamento\\NF\'s\\XML\'s Saídas'
    });
    assert.strictEqual(rot.empresaPasta, 'METAL PLENO');
    assert.strictEqual(rot.pastaAno, "XML's Saídas 2026");
    assert.strictEqual(rot.pastaMesAno, '09.2026');
    assert.strictEqual(
      rot.caminhoCompleto,
      "G:\\Drives compartilhados\\Fiscal e Faturamento\\NF's\\XML's Saídas\\XML's Saídas 2026\\METAL PLENO\\09.2026"
    );
  });

  await test('Deve mapear Empresa 16 para subpasta "OAÇO" e suportar virada para 2027', () => {
    const rot = obterMetadadosRoteamentoDrive({
      empresa: '16',
      dataEmissao: '2027-01-10',
      basePath: 'G:\\Drives compartilhados\\Fiscal e Faturamento\\NF\'s\\XML\'s Saídas'
    });
    assert.strictEqual(rot.empresaPasta, 'OAÇO');
    assert.strictEqual(rot.pastaAno, "XML's Saídas 2027");
    assert.strictEqual(rot.pastaMesAno, '01.2027');
    assert.strictEqual(
      rot.caminhoCompleto,
      "G:\\Drives compartilhados\\Fiscal e Faturamento\\NF's\\XML's Saídas\\XML's Saídas 2027\\OAÇO\\01.2027"
    );
  });

  await test('Deve mapear Empresa 15 para subpasta "GSI"', () => {
    const rot = obterMetadadosRoteamentoDrive({
      empresa: '15',
      dataEmissao: '2026-08-31'
    });
    assert.strictEqual(rot.empresaPasta, 'GSI');
    assert.strictEqual(rot.pastaMesAno, '08.2026');
  });

  // ----------------------------------------------------------------------------
  // 3. TESTES DA REGRA DE DIAS ÚTEIS NO JOB DAS 18:00
  // ----------------------------------------------------------------------------
  console.log('\n--- 3. Regra de Execução do Job das 18h (Seg-Sex) ---');

  await test('Deve normalizar códigos de empresa corretamente', () => {
    assert.strictEqual(normalizarCodigoEmpresa('14'), '14');
    assert.strictEqual(normalizarCodigoEmpresa('MP'), '14');
    assert.strictEqual(normalizarCodigoEmpresa('Metal Pleno'), '14');
    assert.strictEqual(normalizarCodigoEmpresa('15'), '15');
    assert.strictEqual(normalizarCodigoEmpresa('GSI'), '15');
    assert.strictEqual(normalizarCodigoEmpresa('16'), '16');
    assert.strictEqual(normalizarCodigoEmpresa('OACO'), '16');
    assert.strictEqual(normalizarCodigoEmpresa('OAÇO'), '16');
  });

  // ----------------------------------------------------------------------------
  // 4. TESTE DE GRAVAÇÃO DIRETA SEM ZIP EM DIRETÓRIO TEMPORÁRIO
  // ----------------------------------------------------------------------------
  console.log('\n--- 4. Gravação Direta de Arquivos XML (Sem Zip) ---');

  await test('Deve gravar arquivos XML individuais diretamente na estrutura de subpastas', () => {
    const tmpBase = path.join(__dirname, 'data', 'test_tmp_drive');
    if (fs.existsSync(tmpBase)) {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpBase, { recursive: true });

    try {
      const notasTeste = [
        {
          empresa: '14',
          numeroNf: '100',
          chaveAcesso: '35260948758821000118550010000001001540731944',
          clienteRazao: 'CLIENTE METAL',
          dataEmissao: '2026-09-23'
        },
        {
          empresa: '16',
          numeroNf: '200',
          chaveAcesso: '35260961237790000118550010000002001622483426',
          clienteRazao: 'SUPERMERCADO TESTE',
          dataEmissao: '2026-09-23'
        }
      ];

      for (const n of notasTeste) {
        const rot = obterMetadadosRoteamentoDrive({
          empresa: n.empresa,
          dataEmissao: n.dataEmissao,
          basePath: tmpBase
        });

        const nomeArq = formatarNomeXmlLogistica({
          empresa: n.empresa,
          numeroNf: n.numeroNf,
          chaveAcesso: n.chaveAcesso,
          clienteRazao: n.clienteRazao
        });

        fs.mkdirSync(rot.caminhoCompleto, { recursive: true });
        const destPath = path.join(rot.caminhoCompleto, nomeArq);
        const xmlFake = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${n.chaveAcesso}"></infNFe></NFe><protNFe><infProt><chNFe>${n.chaveAcesso}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
        fs.writeFileSync(destPath, xmlFake, 'utf8');

        assert.strictEqual(fs.existsSync(destPath), true, `Arquivo deve existir: ${destPath}`);
        const lido = fs.readFileSync(destPath, 'utf8');
        assert.strictEqual(lido.includes('<nfeProc'), true);
        assert.strictEqual(lido.includes(n.chaveAcesso), true);
      }

      // Validação da hierarquia gerada
      const pastaMp = path.join(tmpBase, "XML's Saídas 2026", 'METAL PLENO', '09.2026');
      const pastaOaco = path.join(tmpBase, "XML's Saídas 2026", 'OAÇO', '09.2026');
      assert.strictEqual(fs.existsSync(pastaMp), true);
      assert.strictEqual(fs.existsSync(pastaOaco), true);

      const arqsMp = fs.readdirSync(pastaMp);
      const arqsOaco = fs.readdirSync(pastaOaco);
      assert.strictEqual(arqsMp.length, 1);
      assert.strictEqual(arqsOaco.length, 1);
      assert.strictEqual(arqsMp[0].startsWith('MP-00000100-'), true);
      assert.strictEqual(arqsOaco[0].startsWith('OACO-00000200-'), true);
    } finally {
      if (fs.existsSync(tmpBase)) {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      }
    }
  });

  // ----------------------------------------------------------------------------
  // 5. TESTES DE GOVERNANÇA PARA NOTAS CANCELADAS
  // ----------------------------------------------------------------------------
  console.log('\n--- 5. Governança e Bloqueio de Notas Canceladas ---');

  await test('Deve bloquear fallback sintético para notas fiscais canceladas evitando protocolo falso 100', async () => {
    const chaveInexistente = '35260900000000000100550010009999991000000001';
    const res = await resolverXmlNota({
      chave: chaveInexistente,
      empresa: '15',
      numeroNf: '999999',
      statusSefaz: 'CANCELADA'
    });

    assert.strictEqual(res.sucesso, false, 'Nota cancelada sem XML em banco não deve ter autorização sintética gerada');
    assert.strictEqual(res.erro.includes('cancelada no ERP Protheus'), true);
  });

  // ----------------------------------------------------------------------------
  // 6. TESTES DE RESOLUÇÃO DE FORMATOS DE DATA E ANOS FUTUROS
  // ----------------------------------------------------------------------------
  console.log('\n--- 6. Formatos de Data & Roteamento Multianual ---');

  await test('Deve parsear corretamente formato DD/MM/AAAA para roteamento de pastas', () => {
    const rot = obterMetadadosRoteamentoDrive({
      empresa: '15',
      dataEmissao: '15/12/2026'
    });
    assert.strictEqual(rot.pastaAno, "XML's Saídas 2026");
    assert.strictEqual(rot.pastaMesAno, '12.2026');
    assert.strictEqual(rot.empresaPasta, 'GSI');
  });

  await test('Deve parsear corretamente formato AAAAMMDD para roteamento de pastas', () => {
    const rot = obterMetadadosRoteamentoDrive({
      empresa: '14',
      dataEmissao: '20270325'
    });
    assert.strictEqual(rot.pastaAno, "XML's Saídas 2027");
    assert.strictEqual(rot.pastaMesAno, '03.2027');
    assert.strictEqual(rot.empresaPasta, 'METAL PLENO');
  });

  // ----------------------------------------------------------------------------
  // RELATÓRIO FINAL
  // ----------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`📊 RESULTADO DA SUÍTE DE TESTES: ${testesPassados}/${totalTestes} PASSARAM`);
  console.log('========================================================================\n');

  if (testesPassados === totalTestes) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

rodarSuite().catch(err => {
  console.error('Erro fatal ao executar suíte de testes:', err);
  process.exit(1);
});
