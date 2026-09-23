/**
 * logistica_xml_service.js — Serviço de Gestão e Exportação de XMLs de Faturamento no Google Drive
 * 
 * Responsável por:
 * 1. Formatar a nomenclatura oficial dos arquivos XML:
 *    [SIGLA]-[NF8]-[CHAVE44]-[CLIENTE6].xml
 * 2. Mapear a árvore de diretórios do Google Drive:
 *    G:\Drives compartilhados\Fiscal e Faturamento\NF's\XML's Saídas\XML's Saídas [ANO]\[EMPRESA]\[MM.ANO]\
 * 3. Consultar notas faturadas no Protheus ERP (SF2/SD2/SC5/SA1) para o período e empresas selecionadas.
 * 4. Resolver os XMLs das notas em lote com prioridade para a Super Tabela e fallback sintético Protheus.
 * 5. Executar o Job diário agendado das 18:00 (estritamente de segunda a sexta-feira).
 */

const fs = require('fs');
const path = require('path');
const { extrairNotasFaturadasParaCentral } = require('./protheus_db');
const { obterXmlNfeCentralPorChave, salvarXmlNfeCentral } = require('./postgres_db');
const { obterXmlNfeSefaz } = require('./exportador_xml_sefaz');
const { obterDanfeCompletoProtheus, gerarXmlDanfeDeDados } = require('./danfe_protheus');
const googleDriveService = require('./google_drive_service');

// Configuração padrão da pasta raiz no Google Drive Desktop com raiz explícita do Windows
const DEFAULT_DRIVE_BASE = path.normalize('G:/Drives compartilhados/Fiscal e Faturamento/NF\'s/XML\'s Saídas');

// Mapeamento de empresas
const MAPA_EMPRESAS = {
  '14': { sigla: 'MP', pasta: 'METAL PLENO', nome: 'Metal Pleno' },
  '15': { sigla: 'GSI', pasta: 'GSI', nome: 'GSI Brasil' },
  '16': { sigla: 'OACO', pasta: 'OAÇO', nome: 'OAÇO / Cofres' }
};

/**
 * Normaliza o código da empresa (14, 15 ou 16)
 */
function normalizarCodigoEmpresa(empresa) {
  const str = String(empresa || '').trim().toUpperCase();
  if (str === '14' || str.includes('METAL') || str.includes('MP')) return '14';
  if (str === '15' || str.includes('GSI')) return '15';
  if (str === '16' || str.includes('OACO') || str.includes('OAÇO') || str.includes('COFRE')) return '16';
  return '16';
}

/**
 * Formata o nome oficial do arquivo XML:
 * [SIGLA]-[NF8]-[CHAVE44]-[CLIENTE6].xml
 * Ex: MP-00123456-35260948758821000118550010000004091540731944-CLIENT.xml
 */
function formatarNomeXmlLogistica({ empresa, numeroNf, chaveAcesso, clienteRazao, clienteCod }) {
  const empCod = normalizarCodigoEmpresa(empresa);
  const sigla = (MAPA_EMPRESAS[empCod] && MAPA_EMPRESAS[empCod].sigla) || 'OACO';

  // 2. Número da NF formatado com 8 dígitos preenchidos com zeros à esquerda
  const nfLimpo = String(numeroNf || '').replace(/\D/g, '');
  const nfNum = parseInt(nfLimpo, 10) || 0;
  const nf8 = String(nfNum).padStart(8, '0');

  // 3. Chave de acesso de 44 dígitos
  const chave44 = String(chaveAcesso || '').replace(/\D/g, '').trim();

  // 4. Primeiras 6 letras da Razão Social do Cliente (em maiúsculas, sem acentos e sem especiais)
  const textoBase = String(clienteRazao || clienteCod || 'CLIENT').trim();
  const cliLimpo = textoBase
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentuação
    .replace(/[^a-zA-Z0-9]/g, '')   // apenas alfanuméricos
    .toUpperCase();
  const cli6 = (cliLimpo.slice(0, 6) || 'CLIENT').padEnd(6, 'X');

  return `${sigla}-${nf8}-${chave44}-${cli6}.xml`;
}

/**
 * Retorna os metadados de roteamento de diretório do Google Drive
 * para uma nota com base na empresa e na data de emissão
 */
function obterMetadadosRoteamentoDrive({ empresa, dataEmissao, basePath = DEFAULT_DRIVE_BASE }) {
  const empCod = normalizarCodigoEmpresa(empresa);
  const empInfo = MAPA_EMPRESAS[empCod] || MAPA_EMPRESAS['16'];

  let ano = '2026';
  let mes = '09';

  const raw = String(dataEmissao || '').trim();
  if (raw.includes('/')) {
    // Formato DD/MM/AAAA ou DD/MM/AA
    const parts = raw.split('/');
    if (parts.length >= 3) {
      mes = parts[1].padStart(2, '0');
      ano = parts[2].slice(0, 4);
    }
  } else if (raw.includes('-')) {
    // Formato AAAA-MM-DD
    const parts = raw.split('-');
    if (parts.length >= 2) {
      ano = parts[0].slice(0, 4);
      mes = parts[1].padStart(2, '0');
    }
  } else {
    // Formato AAAAMMDD
    const dtStr = raw.replace(/\D/g, '');
    if (dtStr.length >= 8) {
      ano = dtStr.substring(0, 4);
      mes = dtStr.substring(4, 6);
    }
  }

  const pastaAno = `XML's Saídas ${ano}`;
  const pastaMesAno = `${mes}.${ano}`;
  const basePathEfetivo = basePath || DEFAULT_DRIVE_BASE;
  const caminhoCompleto = path.join(basePathEfetivo, pastaAno, empInfo.pasta, pastaMesAno);

  return {
    empresaCod: empCod,
    empresaSigla: empInfo.sigla,
    empresaPasta: empInfo.pasta,
    ano,
    mes,
    pastaAno,
    pastaMesAno,
    caminhoCompleto
  };
}

/**
 * Consulta notas fiscais faturadas no Protheus para o módulo de Logística
 */
async function buscarNotasFaturadasLogistica({ dataDe, dataAte, empresa = null }) {
  const empFiltro = empresa && empresa !== 'ALL' && empresa !== 'TODAS'
    ? normalizarCodigoEmpresa(empresa)
    : null;

  const notasBrutas = await extrairNotasFaturadasParaCentral({
    dataInicio: dataDe,
    dataFim: dataAte,
    empresaEspecifica: empFiltro
  });

  const notasFormatadas = notasBrutas.map(n => {
    const nomeArquivo = formatarNomeXmlLogistica({
      empresa: n.empresa,
      numeroNf: n.numeroNf,
      chaveAcesso: n.chaveAcesso,
      clienteRazao: n.clienteRazao,
      clienteCod: n.clienteCod
    });

    const roteamento = obterMetadadosRoteamentoDrive({
      empresa: n.empresa,
      dataEmissao: n.dataEmissao
    });

    return {
      ...n,
      nomeArquivo,
      subpastaAno: roteamento.pastaAno,
      subpastaEmpresa: roteamento.empresaPasta,
      subpastaMesAno: roteamento.pastaMesAno,
      caminhoSugeridoDrive: roteamento.caminhoCompleto
    };
  });

  // Agregação de totais
  const totais = {
    totalNotas: notasFormatadas.length,
    valorTotal: notasFormatadas.reduce((acc, curr) => acc + (Number(curr.valorTotal) || 0), 0),
    porEmpresa: {
      '14': { qtd: 0, valor: 0 },
      '15': { qtd: 0, valor: 0 },
      '16': { qtd: 0, valor: 0 }
    }
  };

  for (const n of notasFormatadas) {
    const cod = n.empresa || '16';
    if (!totais.porEmpresa[cod]) totais.porEmpresa[cod] = { qtd: 0, valor: 0 };
    totais.porEmpresa[cod].qtd++;
    totais.porEmpresa[cod].valor += (Number(n.valorTotal) || 0);
  }

  return {
    ok: true,
    notas: notasFormatadas,
    totais
  };
}

/**
 * Resolve o conteúdo XML oficial de uma nota (Banco -> SEFAZ -> Protheus Sintético)
 * NOTAS CANCELADAS: Não permite síntese de XML falso com status 100 (Autorizada)
 */
async function resolverXmlNota({ chave, empresa, numeroNf = '', statusSefaz = 'AUTORIZADA' }) {
  const chaveLimpa = String(chave || '').replace(/\D/g, '').trim();
  if (chaveLimpa.length !== 44) {
    return { sucesso: false, erro: 'Chave de acesso inválida' };
  }

  const empCod = normalizarCodigoEmpresa(empresa);
  const isCancelada = String(statusSefaz || '').toUpperCase() === 'CANCELADA';

  // 1. Super Tabela / Cache Local em disco
  try {
    const dbXml = await obterXmlNfeCentralPorChave(chaveLimpa);
    if (dbXml && dbXml.includes('<nfeProc') && dbXml.includes('</nfeProc>')) {
      return { sucesso: true, xml: dbXml, origem: 'BANCO' };
    }
  } catch (e) {}

  // 2. Tenta download SEFAZ
  try {
    const resSefaz = await obterXmlNfeSefaz({ chaveNfe: chaveLimpa, empresaCod: empCod });
    if (resSefaz && resSefaz.sucesso && resSefaz.xml) {
      salvarXmlNfeCentral(chaveLimpa, resSefaz.xml).catch(() => {});
      return { sucesso: true, xml: resSefaz.xml, origem: 'SEFAZ' };
    }
  } catch (e) {}

  // 3. Fallback Sintético Protheus ERP — VEDADO para notas canceladas (evita emissão de protocolo falso 100)
  if (isCancelada) {
    return {
      sucesso: false,
      erro: 'Nota fiscal cancelada no ERP Protheus. Síntese sintética autorizada bloqueada por governança contábil.'
    };
  }

  try {
    const docParaBusca = numeroNf || chaveLimpa.substring(25, 34);
    const protheusDanfe = await obterDanfeCompletoProtheus({
      empresaCod: empCod,
      doc: docParaBusca,
      chave: chaveLimpa
    });

    if (protheusDanfe && protheusDanfe.sucesso && protheusDanfe.dadosDanfe) {
      const xmlGerado = gerarXmlDanfeDeDados(protheusDanfe.dadosDanfe);
      if (xmlGerado && xmlGerado.includes('<nfeProc')) {
        salvarXmlNfeCentral(chaveLimpa, xmlGerado).catch(() => {});
        return { sucesso: true, xml: xmlGerado, origem: 'PROTHEUS' };
      }
    }
  } catch (e) {
    return { sucesso: false, erro: `Falha na síntese Protheus: ${e.message}` };
  }

  return { sucesso: false, erro: 'Não foi possível recuperar nem sintetizar o XML da nota' };
}

/**
 * Resolve lote de XMLs para envio ao frontend com controle de taxa e sanitização
 */
async function obterLoteXmlsFaturados({ itens = [] }) {
  const resultados = [];

  for (let i = 0; i < itens.length; i++) {
    const item = itens[i];
    const chave = item.chave || item.chaveAcesso;
    const emp = item.empresa;
    const doc = item.doc || item.numeroNf;
    const statusSefaz = item.statusSefaz || 'AUTORIZADA';

    // Nomenclatura estrita governada e imposta pelo servidor
    const nomeArquivo = formatarNomeXmlLogistica({
      empresa: emp,
      numeroNf: doc,
      chaveAcesso: chave,
      clienteRazao: item.clienteRazao,
      clienteCod: item.clienteCod
    });

    const roteamento = obterMetadadosRoteamentoDrive({
      empresa: emp,
      dataEmissao: item.dataEmissao
    });

    try {
      const resXml = await resolverXmlNota({ chave, empresa: emp, numeroNf: doc, statusSefaz });
      resultados.push({
        chave,
        empresa: normalizarCodigoEmpresa(emp),
        numeroNf: doc,
        nomeArquivo,
        subpastaAno: roteamento.pastaAno,
        subpastaEmpresa: roteamento.empresaPasta,
        subpastaMesAno: roteamento.pastaMesAno,
        xmlConteudo: resXml.sucesso ? resXml.xml : null,
        origem: resXml.origem || null,
        sucesso: resXml.sucesso,
        erro: resXml.erro || null
      });

      // Pausa anti-throttling se chamou SEFAZ
      if (resXml.origem === 'SEFAZ' && i < itens.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (err) {
      resultados.push({
        chave,
        empresa: normalizarCodigoEmpresa(emp),
        numeroNf: doc,
        nomeArquivo,
        subpastaAno: roteamento.pastaAno,
        subpastaEmpresa: roteamento.empresaPasta,
        subpastaMesAno: roteamento.pastaMesAno,
        xmlConteudo: null,
        sucesso: false,
        erro: err.message
      });
    }
  }

  return resultados;
}

/**
 * Executa o Job diário de salvamento de XMLs no Google Drive às 18:00
 * Regra estrita: Executa exclusivamente de segunda a sexta-feira.
 */
async function executarJobSincronizacaoDrive18h({ force = false, dataAlvo = null, basePath = DEFAULT_DRIVE_BASE } = {}) {
  const inicio = Date.now();
  const nowBr = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const diaSemana = nowBr.getDay(); // 0 = Domingo, 1 = Segunda ... 5 = Sexta, 6 = Sábado

  // Verificação de dia útil: segunda a sexta-feira
  if (!force && (diaSemana === 0 || diaSemana === 6)) {
    console.log(`ℹ️ [Job XML Drive 18h] Hoje é final de semana (dia ${diaSemana}). Execução suspensa (regra: seg-sex).`);
    return {
      ok: true,
      executado: false,
      motivo: 'Execução permitida exclusivamente de segunda a sexta-feira.',
      diaSemana
    };
  }

  // Define data de busca (padrão: hoje no formato YYYYMMDD)
  let dataBusca = '';
  if (dataAlvo) {
    dataBusca = String(dataAlvo).replace(/\D/g, '').slice(0, 8);
  } else {
    const ano = nowBr.getFullYear();
    const mes = String(nowBr.getMonth() + 1).padStart(2, '0');
    const dia = String(nowBr.getDate()).padStart(2, '0');
    dataBusca = `${ano}${mes}${dia}`;
  }

  console.log(`\n🚀 [Job XML Drive 18h] Iniciando varredura de faturamento para data: ${dataBusca}...`);

  const basePathEfetivo = basePath || DEFAULT_DRIVE_BASE;
  const driveRoot = path.parse(basePathEfetivo).root || basePathEfetivo;
  const modoDiscoLocalDisponivel = fs.existsSync(driveRoot);
  const credsServiceAccount = googleDriveService.carregarCredenciaisServiceAccount();
  const modoNuvemDisponivel = !!credsServiceAccount;

  if (!modoNuvemDisponivel && !modoDiscoLocalDisponivel) {
    const msg = `⚠️ [Job XML Drive 18h] Nem as credenciais da Service Account do Google Cloud nem a unidade local (${driveRoot}) estão disponíveis.`;
    console.warn(msg);
    return { ok: false, executado: false, erro: msg };
  }

  // 1. Busca notas faturadas no dia nas 3 empresas
  const buscaRes = await buscarNotasFaturadasLogistica({ dataDe: dataBusca, dataAte: dataBusca });
  const todasNotas = buscaRes.notas || [];

  // Filtra apenas notas AUTORIZADAS para salvar na pasta oficial de saídas
  const notas = todasNotas.filter(n => n.statusSefaz !== 'CANCELADA');
  const notasCanceladasCount = todasNotas.length - notas.length;

  console.log(`📦 [Job XML Drive 18h] Protheus retornou ${todasNotas.length} notas (${notas.length} autorizadas, ${notasCanceladasCount} canceladas ignoradas).`);

  if (notas.length === 0) {
    return {
      ok: true,
      executado: true,
      totalNotas: 0,
      gravados: 0,
      jaExistentes: 0,
      erros: 0,
      canceladasIgnoradas: notasCanceladasCount,
      duracaoSegundos: Math.round((Date.now() - inicio) / 1000),
      mensagem: 'Nenhuma nota fiscal autorizada faturada na data especificada.'
    };
  }

  const stats = {
    totalNotas: notas.length,
    modo: modoNuvemDisponivel ? 'GOOGLE_DRIVE_API_NUVEM' : 'DISCO_LOCAL_WINDOWS',
    gravados: 0,
    jaExistentes: 0,
    erros: 0,
    detalhes: []
  };

  // 2. Executa a gravação priorizando o Modo Nuvem
  if (modoNuvemDisponivel) {
    console.log('☁️ [Job XML Drive 18h] Modo Nuvem Ativo: Gravando via Google Drive API com Service Account (independente de computadores ligados)...');

    const notasComXml = [];
    for (const n of notas) {
      const roteamento = obterMetadadosRoteamentoDrive({
        empresa: n.empresa,
        dataEmissao: n.dataEmissao
      });

      const nomeArquivo = n.nomeArquivo || formatarNomeXmlLogistica({
        empresa: n.empresa,
        numeroNf: n.numeroNf,
        chaveAcesso: n.chaveAcesso,
        clienteRazao: n.clienteRazao,
        clienteCod: n.clienteCod
      });

      const resXml = await resolverXmlNota({
        chave: n.chaveAcesso,
        empresa: n.empresa,
        numeroNf: n.numeroNf
      });

      if (resXml.sucesso && resXml.xml) {
        notasComXml.push({
          ...n,
          nomeArquivo,
          subpastaAno: roteamento.pastaAno,
          subpastaEmpresa: roteamento.empresaPasta,
          subpastaMesAno: roteamento.pastaMesAno,
          xmlConteudo: resXml.xml
        });
      } else {
        stats.erros++;
        stats.detalhes.push({ arquivo: nomeArquivo, erro: resXml.erro, status: 'ERRO_XML' });
        console.warn(`❌ [Job XML Drive 18h] Falha ao resolver XML ${nomeArquivo}:`, resXml.erro);
      }
    }

    try {
      const resNuvem = await googleDriveService.sincronizarNotasFaturamentoDriveNuvem({
        notas: notasComXml
      });

      stats.gravados += resNuvem.gravados;
      stats.jaExistentes += resNuvem.jaExistentes;
      stats.erros += resNuvem.erros;
      stats.detalhes.push(...resNuvem.detalhes);
    } catch (errNuvem) {
      console.warn('⚠️ [Job XML Drive 18h] Falha no upload em nuvem:', errNuvem.message);
      // Fallback para disco local se unidade G: estiver montada
      if (modoDiscoLocalDisponivel) {
        console.log(`🔄 [Job XML Drive 18h] Tentando fallback para gravação em disco local ${driveRoot}...`);
        stats.modo = 'DISCO_LOCAL_FALLBACK';
        for (const item of notasComXml) {
          const destPasta = path.join(basePathEfetivo, item.subpastaAno, item.subpastaEmpresa, item.subpastaMesAno);
          const destArquivo = path.join(destPasta, item.nomeArquivo);
          if (fs.existsSync(destArquivo)) {
            stats.jaExistentes++;
            continue;
          }
          try {
            if (!fs.existsSync(destPasta)) fs.mkdirSync(destPasta, { recursive: true });
            fs.writeFileSync(destArquivo, item.xmlConteudo, 'utf8');
            stats.gravados++;
            stats.detalhes.push({ arquivo: item.nomeArquivo, status: 'GRAVADO_LOCAL' });
          } catch (eWrite) {
            stats.erros++;
            stats.detalhes.push({ arquivo: item.nomeArquivo, erro: eWrite.message });
          }
        }
      } else {
        stats.erros += notasComXml.length;
        stats.detalhes.push({ erro: `Falha na Google Drive API: ${errNuvem.message}`, status: 'ERRO_NUVEM' });
      }
    }
  } else {
    console.log(`💻 [Job XML Drive 18h] Modo Disco Local: Gravando na unidade montada ${driveRoot}...`);
    for (const n of notas) {
      const roteamento = obterMetadadosRoteamentoDrive({
        empresa: n.empresa,
        dataEmissao: n.dataEmissao,
        basePath: basePathEfetivo
      });

      const nomeArquivo = n.nomeArquivo || formatarNomeXmlLogistica({
        empresa: n.empresa,
        numeroNf: n.numeroNf,
        chaveAcesso: n.chaveAcesso,
        clienteRazao: n.clienteRazao,
        clienteCod: n.clienteCod
      });

      const destinoPasta = roteamento.caminhoCompleto;
      const destinoArquivo = path.join(destinoPasta, nomeArquivo);

      if (fs.existsSync(destinoArquivo)) {
        try {
          const fStat = fs.statSync(destinoArquivo);
          if (fStat.size > 50) {
            stats.jaExistentes++;
            continue;
          }
        } catch (e) {}
      }

      const resXml = await resolverXmlNota({
        chave: n.chaveAcesso,
        empresa: n.empresa,
        numeroNf: n.numeroNf
      });

      if (resXml.sucesso && resXml.xml) {
        try {
          if (!fs.existsSync(destinoPasta)) {
            fs.mkdirSync(destinoPasta, { recursive: true });
          }
          fs.writeFileSync(destinoArquivo, resXml.xml, 'utf8');
          stats.gravados++;
          stats.detalhes.push({ arquivo: nomeArquivo, pasta: destinoPasta, status: 'GRAVADO' });
        } catch (errWrite) {
          stats.erros++;
          stats.detalhes.push({ arquivo: nomeArquivo, erro: errWrite.message, status: 'ERRO_GRAVACAO' });
          console.warn(`❌ [Job XML Drive 18h] Falha ao gravar ${nomeArquivo}:`, errWrite.message);
        }
      } else {
        stats.erros++;
        stats.detalhes.push({ arquivo: nomeArquivo, erro: resXml.erro, status: 'ERRO_XML' });
        console.warn(`❌ [Job XML Drive 18h] Falha ao resolver XML ${nomeArquivo}:`, resXml.erro);
      }
    }
  }

  const duracaoSegundos = Math.round((Date.now() - inicio) / 1000);
  console.log(`✅ [Job XML Drive 18h] Concluído em ${duracaoSegundos}s. Gravados: ${stats.gravados}, Já existentes: ${stats.jaExistentes}, Erros: ${stats.erros}.`);

  return {
    ok: true,
    executado: true,
    dataBusca,
    duracaoSegundos,
    ...stats
  };
}

module.exports = {
  DEFAULT_DRIVE_BASE,
  MAPA_EMPRESAS,
  normalizarCodigoEmpresa,
  formatarNomeXmlLogistica,
  obterMetadadosRoteamentoDrive,
  buscarNotasFaturadasLogistica,
  resolverXmlNota,
  obterLoteXmlsFaturados,
  executarJobSincronizacaoDrive18h
};
