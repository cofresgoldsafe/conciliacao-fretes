/**
 * paulistana_client.js — Cliente de Integração com a Nota Paulistana (Prefeitura de São Paulo)
 * Suporta:
 * 1. Consulta via WebService SOAP com autenticação mTLS e assinatura digital RSA-SHA1
 * 2. Parser de XML da Prefeitura de SP (<RetornoConsulta> -> <NFe>)
 * 3. Parser de Arquivo TXT de lote exportado do portal da Nota Paulistana
 * 4. Geração sintética de XML para contingência
 */

const https = require('https');
const crypto = require('crypto');

const PREFEITURA_SP_HOST = 'nfe.prefeitura.sp.gov.br';
const PREFEITURA_SP_PATH = '/ws/lotenfe.asmx';
const GSI_CNPJ_PADRAO = '14061778000115';

/**
 * Decodifica entidades XML
 */
function decodificarEntidadesXml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&');
}

/**
 * Extrai texto de uma tag XML simples
 */
function tagText(xml, tag) {
  if (!xml) return '';
  const m = xml.match(new RegExp(`<(?:[\\w.-]+:)?${tag}[^>]*>([^<]*)</(?:[\\w.-]+:)?${tag}>`, 'i'));
  return m ? decodificarEntidadesXml(m[1]).trim() : '';
}

/**
 * Extrai bloco de uma tag XML
 */
function tagBlock(xml, tag) {
  if (!xml) return null;
  const m = xml.match(new RegExp(`<(?:[\\w.-]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, 'i'));
  return m ? m[1] : null;
}

/**
 * Traduz erros criptográficos de baixo nível do OpenSSL / mTLS para mensagens claras e operacionais
 */
function humanizarErroMtls(erro) {
  const msg = erro?.message || String(erro || '');
  const code = erro?.code || '';

  if (/DECODER routines/i.test(msg)) {
    return 'O WebService SOAP da Prefeitura de SP exige assinatura estruturada XMLDSig (W3C) que não decodifica chave privada direta a partir do PFX. Utilize o botão "Importar Lote SP" para carregar o arquivo oficial (.xml ou .txt) exportado do portal da Nota Paulistana.';
  }
  if (/Unsupported PKCS12 PFX data/i.test(msg) || /ERR_OSSL_UNSUPPORTED/i.test(msg)) {
    return 'O certificado digital A1 da GSI utiliza criptografia PKCS#12 legada (RC2-40/3DES da ICP-Brasil) incompatível com o OpenSSL 3.0 do Render. Utilize o botão "Importar Lote SP" para carregar o arquivo exportado da prefeitura.';
  }
  if (/mac verify failure/i.test(msg)) {
    return 'Senha do certificado digital A1 da GSI (NFSE_CERT_GSI_SENHA) incorreta ou dados do PFX corrompidos. Verifique a senha configurada no Render/Ambiente.';
  }
  if (/decryption failed or bad record mac|0A000119/i.test(msg) || code === 'ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC') {
    return `Falha de handshake mTLS (o certificado digital A1 da GSI pode estar vencido, revogado ou recusado pela Prefeitura de SP). Erro técnico: ${msg}`;
  }
  if (/certificate has expired/i.test(msg) || code === 'CERT_HAS_EXPIRED') {
    return 'Certificado digital A1 da GSI VENCIDO. Atualize o arquivo PFX e senha nas variáveis de ambiente.';
  }
  return msg;
}

/**
 * Assina dados com chave privada RSA-SHA1 (Padrão Nota Paulistana)
 */
function assinarDadosSha1(textoParaAssinar, privateKeyPem) {
  try {
    const signer = crypto.createSign('RSA-SHA1');
    signer.update(textoParaAssinar, 'utf8');
    return signer.sign(privateKeyPem, 'base64');
  } catch (err) {
    console.warn('⚠️ [Paulistana] Falha ao assinar RSA-SHA1:', humanizarErroMtls(err));
    return '';
  }
}

/**
 * Converte data para formato YYYY-MM-DD
 */
function normalizarDataIso(dataStr) {
  if (!dataStr) return new Date().toISOString();
  const limpa = String(dataStr).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(limpa)) return limpa;
  if (/^\d{8}$/.test(limpa)) {
    return `${limpa.slice(0, 4)}-${limpa.slice(4, 6)}-${limpa.slice(6, 8)}`;
  }
  const d = new Date(limpa);
  if (!isNaN(d.getTime())) return d.toISOString();
  return new Date().toISOString();
}

/**
 * Parser de nós <NFe> no XML de retorno da Nota Paulistana
 * @param {string} xmlCompleto 
 * @returns {Array<Object>} Lista de notas fiscais normalizadas
 */
function parseNFeXmlPaulistana(xmlCompleto) {
  if (!xmlCompleto || typeof xmlCompleto !== 'string') return [];

  const notas = [];
  const regexNFe = /<(?:[\w.-]+:)?NFe[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?NFe>/gi;
  let match;

  while ((match = regexNFe.exec(xmlCompleto)) !== null) {
    const nfeRaw = match[0];
    const nfeCorpo = match[1];

    const chaveBloco = tagBlock(nfeCorpo, 'ChaveNFe') || nfeCorpo;
    const numeroNota = tagText(chaveBloco, 'NumeroNFe') || tagText(nfeCorpo, 'NumeroNFe');
    const serie = tagText(chaveBloco, 'SerieNFe') || 'NFS';
    const codigoVerificacao = tagText(chaveBloco, 'CodigoVerificacao') || tagText(nfeCorpo, 'CodigoVerificacao');

    const dtEmissaoRaw = tagText(nfeCorpo, 'DataEmissaoNFe') || tagText(nfeCorpo, 'DataEmissao');
    const dataEmissao = normalizarDataIso(dtEmissaoRaw);
    const competencia = dataEmissao.slice(0, 7); // 'YYYY-MM'

    // Dados Tomador
    const tomadorBloco = tagBlock(nfeCorpo, 'CPFCNPJTomador') || nfeCorpo;
    const tomadorCnpj = tagText(tomadorBloco, 'CNPJ') || tagText(tomadorBloco, 'CPF');
    const tomadorRazao = tagText(nfeCorpo, 'RazaoSocialTomador') || tagText(nfeCorpo, 'NomeTomador');

    // Valores Financeiros
    const valServicos = parseFloat(tagText(nfeCorpo, 'ValorServicos') || '0') || 0;
    const valDeducoes = parseFloat(tagText(nfeCorpo, 'ValorDeducoes') || '0') || 0;
    const valPis = parseFloat(tagText(nfeCorpo, 'ValorPIS') || '0') || 0;
    const valCofins = parseFloat(tagText(nfeCorpo, 'ValorCOFINS') || '0') || 0;
    const valInss = parseFloat(tagText(nfeCorpo, 'ValorINSS') || '0') || 0;
    const valIr = parseFloat(tagText(nfeCorpo, 'ValorIR') || '0') || 0;
    const valCsll = parseFloat(tagText(nfeCorpo, 'ValorCSLL') || '0') || 0;
    const valIss = parseFloat(tagText(nfeCorpo, 'ValorISS') || '0') || 0;
    const aliquotaIss = parseFloat(tagText(nfeCorpo, 'AliquotaServicos') || '0') || 0;
    const issRetidoStr = tagText(nfeCorpo, 'ISSRetido').toLowerCase();
    const issRetido = issRetidoStr === 'true' || issRetidoStr === '1' || issRetidoStr === 's';

    const valLiquido = parseFloat(tagText(nfeCorpo, 'ValorLiquidoNFe') || '') || (valServicos - valPis - valCofins - valInss - valIr - valCsll - (issRetido ? valIss : 0));

    const discriminacao = tagText(nfeCorpo, 'Discriminacao');
    const statusRaw = (tagText(nfeCorpo, 'StatusNFe') || 'N').toUpperCase();
    const status = (statusRaw === 'C' || statusRaw === 'CANCELADA') ? 'CANCELADA' : 'NORMAL';

    const chaveAcesso = `${GSI_CNPJ_PADRAO}_${numeroNota}`;

    notas.push({
      chave_acesso: chaveAcesso,
      empresa_cnpj: GSI_CNPJ_PADRAO,
      empresa_nome: 'GSI BW Equipamentos de Aço Cofres e Armários',
      empresa_cod_protheus: '15',
      numero_nota: String(numeroNota).padStart(6, '0'),
      serie: serie || 'NFS',
      codigo_verificacao: codigoVerificacao,
      data_emissao: dataEmissao,
      competencia: competencia,
      tomador_cnpj_cpf: tomadorCnpj,
      tomador_razao: tomadorRazao,
      valor_servicos: Math.round(valServicos * 100) / 100,
      valor_deducoes: Math.round(valDeducoes * 100) / 100,
      valor_pis: Math.round(valPis * 100) / 100,
      valor_cofins: Math.round(valCofins * 100) / 100,
      valor_inss: Math.round(valInss * 100) / 100,
      valor_ir: Math.round(valIr * 100) / 100,
      valor_csll: Math.round(valCsll * 100) / 100,
      valor_iss: Math.round(valIss * 100) / 100,
      aliquota_iss: Math.round(aliquotaIss * 100) / 100,
      iss_retido: issRetido,
      valor_liquido: Math.round(valLiquido * 100) / 100,
      discriminacao_servico: discriminacao,
      status: status,
      origem: 'PREFEITURA_SP',
      xml_conteudo: nfeRaw
    });
  }

  return notas;
}

/**
 * Gera um XML sintético bem formatado para notas importadas via TXT ou planilha
 */
function gerarXmlSinteticoPaulistana(nota) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.prefeitura.sp.gov.br/nfe">
  <ChaveNFe>
    <InscricaoPrestador>${nota.inscricao_prestador || '00000000'}</InscricaoPrestador>
    <NumeroNFe>${nota.numero_nota}</NumeroNFe>
    <CodigoVerificacao>${nota.codigo_verificacao || ''}</CodigoVerificacao>
  </ChaveNFe>
  <DataEmissaoNFe>${nota.data_emissao}</DataEmissaoNFe>
  <CPFCNPJTomador>
    <CNPJ>${nota.tomador_cnpj_cpf || ''}</CNPJ>
  </CPFCNPJTomador>
  <RazaoSocialTomador><![CDATA[${nota.tomador_razao || ''}]]></RazaoSocialTomador>
  <ValorServicos>${Number(nota.valor_servicos || 0).toFixed(2)}</ValorServicos>
  <ValorDeducoes>${Number(nota.valor_deducoes || 0).toFixed(2)}</ValorDeducoes>
  <ValorPIS>${Number(nota.valor_pis || 0).toFixed(2)}</ValorPIS>
  <ValorCOFINS>${Number(nota.valor_cofins || 0).toFixed(2)}</ValorCOFINS>
  <ValorINSS>${Number(nota.valor_inss || 0).toFixed(2)}</ValorINSS>
  <ValorIR>${Number(nota.valor_ir || 0).toFixed(2)}</ValorIR>
  <ValorCSLL>${Number(nota.valor_csll || 0).toFixed(2)}</ValorCSLL>
  <ValorISS>${Number(nota.valor_iss || 0).toFixed(2)}</ValorISS>
  <AliquotaServicos>${Number(nota.aliquota_iss || 0).toFixed(4)}</AliquotaServicos>
  <ISSRetido>${nota.iss_retido ? 'true' : 'false'}</ISSRetido>
  <ValorLiquidoNFe>${Number(nota.valor_liquido || 0).toFixed(2)}</ValorLiquidoNFe>
  <Discriminacao><![CDATA[${nota.discriminacao_servico || ''}]]></Discriminacao>
  <StatusNFe>${nota.status === 'CANCELADA' ? 'C' : 'N'}</StatusNFe>
</NFe>`;
}

/**
 * Parser de arquivo TXT de lote exportado do portal da Nota Paulistana
 * Layout oficial Prefeitura de SP:
 * Tipo 1 = Cabeçalho
 * Tipo 2 = Detalhe da NFS-e
 * Tipo 9 = Rodapé
 */
function parseTxtLotePaulistana(conteudoTxt) {
  if (!conteudoTxt || typeof conteudoTxt !== 'string') return [];

  const linhas = conteudoTxt.split(/\r?\n/);
  const notas = [];

  for (const linha of linhas) {
    if (!linha || linha.trim().length < 20) continue;

    // Cenário A: Formato Delimitado por Pipe (|)
    if (linha.includes('|')) {
      const parts = linha.split('|').map(p => p.trim());
      const tipoRegistro = parts[0];

      if (tipoRegistro === '2' || tipoRegistro.toUpperCase() === 'NFE') {
        try {
          const numeroNota = parts[1] || '';
          const dataEmissaoRaw = parts[2] || '';
          const tomadorCnpjCpf = parts[6] || parts[4] || '';
          const tomadorRazao = parts[7] || parts[5] || 'CLIENTE NFS-E SP';
          const valServRaw = parseFloat(parts[8] || parts[6] || '0') || 0;
          // Se o valor estiver em centavos (> 1000 sem ponto), divide por 100
          const valServicos = valServRaw > 10000 && !String(parts[8] || '').includes('.') ? valServRaw / 100 : valServRaw;
          const valIssRaw = parseFloat(parts[10] || parts[7] || '0') || 0;
          const valorIss = valIssRaw > 1000 && !String(parts[10] || '').includes('.') ? valIssRaw / 100 : valIssRaw;
          const discriminacao = parts[13] || parts[11] || parts[9] || 'PRESTAÇÃO DE SERVIÇOS';

          let dataEmissaoIso = new Date().toISOString();
          const dLimpa = dataEmissaoRaw.replace(/\D/g, '');
          if (dLimpa.length >= 8) {
            dataEmissaoIso = `${dLimpa.substring(0, 4)}-${dLimpa.substring(4, 6)}-${dLimpa.substring(6, 8)}T12:00:00-03:00`;
          }

          const chaveAcesso = `${GSI_CNPJ_PADRAO}_${String(numeroNota).padStart(6, '0')}`;
          const competencia = dataEmissaoIso.slice(0, 7);

          const notaObj = {
            chave_acesso: chaveAcesso,
            empresa_cnpj: GSI_CNPJ_PADRAO,
            empresa_nome: 'GSI BW Equipamentos de Aço Cofres e Armários',
            empresa_cod_protheus: '15',
            numero_nota: String(numeroNota).padStart(6, '0'),
            serie: 'NFS',
            codigo_verificacao: parts[12] || '',
            data_emissao: dataEmissaoIso,
            competencia: competencia,
            tomador_cnpj_cpf: tomadorCnpjCpf.replace(/\D/g, ''),
            tomador_razao: tomadorRazao,
            valor_servicos: Math.round(valServicos * 100) / 100,
            valor_deducoes: 0.00,
            valor_pis: 0.00,
            valor_cofins: 0.00,
            valor_inss: 0.00,
            valor_ir: 0.00,
            valor_csll: 0.00,
            valor_iss: Math.round(valorIss * 100) / 100,
            aliquota_iss: 2.5,
            iss_retido: false,
            valor_liquido: Math.round(valServicos * 100) / 100,
            discriminacao_servico: discriminacao,
            status: 'NORMAL',
            origem: 'PREFEITURA_SP_TXT',
            inscricao_prestador: parts[5] || '43219876'
          };

          notaObj.xml_conteudo = gerarXmlSinteticoPaulistana(notaObj);
          notas.push(notaObj);
        } catch (errPipe) {
          console.warn('⚠️ [Paulistana Pipe] Erro ao processar linha:', errPipe.message);
        }
      }
      continue;
    }

    // Cenário B: Layout Posicional de Largura Fixa Oficial da Prefeitura de SP
    if (linha.length >= 50) {
      const tipoRegistro = linha.charAt(0);

      // Registro Tipo 2: NFS-e emitida
      if (tipoRegistro === '2') {
        try {
          const numeroNota = linha.substring(1, 9).trim();
          const dataEmissaoRaw = linha.substring(9, 17).trim(); // AAAAMMDD
          const horaEmissaoRaw = linha.substring(17, 23).trim(); // HHMMSS
          const codigoVerificacao = linha.substring(23, 31).trim();

          let dataEmissaoIso = new Date().toISOString();
          if (dataEmissaoRaw.length === 8) {
            const y = dataEmissaoRaw.substring(0, 4);
            const m = dataEmissaoRaw.substring(4, 6);
            const d = dataEmissaoRaw.substring(6, 8);
            const hh = horaEmissaoRaw.substring(0, 2) || '12';
            const mm = horaEmissaoRaw.substring(2, 4) || '00';
            const ss = horaEmissaoRaw.substring(4, 6) || '00';
            dataEmissaoIso = `${y}-${m}-${d}T${hh}:${mm}:${ss}-03:00`;
          }

        const inscricaoPrestador = linha.substring(56, 64).trim();
        const tipoTomador = linha.substring(78, 79).trim(); // 1=CPF, 2=CNPJ
        const tomadorCnpjCpf = linha.substring(79, 93).trim();
        const tomadorRazao = linha.substring(93, 168).trim();

        // Valores em centavos (15 posições)
        const valServCentavos = parseInt(linha.substring(423, 438).trim() || '0', 10) || 0;
        const valServicos = valServCentavos / 100;

        const valDeducCentavos = parseInt(linha.substring(438, 453).trim() || '0', 10) || 0;
        const valDeducoes = valDeducCentavos / 100;

        const aliqCentavos = parseInt(linha.substring(458, 462).trim() || '0', 10) || 0;
        const aliquotaIss = aliqCentavos / 100;

        const valIssCentavos = parseInt(linha.substring(462, 477).trim() || '0', 10) || 0;
        const valorIss = valIssCentavos / 100;

        const issRetidoFlag = linha.substring(478, 479).trim(); // 1=Sim, 2=Não
        const issRetido = issRetidoFlag === '1';

        const statusChar = (linha.substring(480, 481).trim() || 'N').toUpperCase();
        const status = statusChar === 'C' ? 'CANCELADA' : 'NORMAL';

        // Discriminação dos Serviços (restante da linha a partir da pos 481)
        const discriminacao = linha.substring(481).trim();

        const chaveAcesso = `${GSI_CNPJ_PADRAO}_${numeroNota}`;
        const competencia = dataEmissaoIso.slice(0, 7);

        const notaObj = {
          chave_acesso: chaveAcesso,
          empresa_cnpj: GSI_CNPJ_PADRAO,
          empresa_nome: 'GSI BW Equipamentos de Aço Cofres e Armários',
          empresa_cod_protheus: '15',
          numero_nota: String(numeroNota).padStart(6, '0'),
          serie: 'NFS',
          codigo_verificacao: codigoVerificacao,
          data_emissao: dataEmissaoIso,
          competencia: competencia,
          tomador_cnpj_cpf: tomadorCnpjCpf,
          tomador_razao: tomadorRazao,
          valor_servicos: Math.round(valServicos * 100) / 100,
          valor_deducoes: Math.round(valDeducoes * 100) / 100,
          valor_pis: 0.00,
          valor_cofins: 0.00,
          valor_inss: 0.00,
          valor_ir: 0.00,
          valor_csll: 0.00,
          valor_iss: Math.round(valorIss * 100) / 100,
          aliquota_iss: Math.round(aliquotaIss * 100) / 100,
          iss_retido: issRetido,
          valor_liquido: Math.round((valServicos - (issRetido ? valorIss : 0)) * 100) / 100,
          discriminacao_servico: discriminacao,
          status: status,
          origem: 'PREFEITURA_SP_TXT',
          inscricao_prestador: inscricaoPrestador
        };

        notaObj.xml_conteudo = gerarXmlSinteticoPaulistana(notaObj);
        notas.push(notaObj);
      } catch (errLinha) {
        console.warn('⚠️ [Paulistana TXT] Erro ao processar linha Tipo 2:', errLinha.message);
      }
    }
  }
}

  return notas;
}

/**
 * Consulta WebService SOAP da Nota Paulistana
 * @param {Object} params
 * @param {string} params.dtInicio YYYYMMDD
 * @param {string} params.dtFim YYYYMMDD
 * @param {string} params.inscricaoMunicipal CCM de 8 dígitos da GSI
 * @param {Buffer} [params.pfxBuffer] Certificado Digital A1
 * @param {string} [params.passphrase] Senha do certificado
 * @param {number} [params.pagina=1] Página da consulta
 * @returns {Promise<Array<Object>>}
 */
async function consultarNFeEmitidasWsPaulistana({ dtInicio, dtFim, inscricaoMunicipal, pfxBuffer, passphrase, pagina = 1 }) {
  const ccm = String(inscricaoMunicipal || process.env.GSI_CCM || '43419135').replace(/\D/g, '').padStart(8, '0');
  const dInicioLimpa = String(dtInicio).replace(/\D/g, '');
  const dFimLimpa = String(dtFim).replace(/\D/g, '');

  if (!pfxBuffer && process.env.NFSE_CERT_GSI_PFX_BASE64) {
    pfxBuffer = Buffer.from(process.env.NFSE_CERT_GSI_PFX_BASE64, 'base64');
  }

  // Fallback para arquivo PFX local na máquina se variável não estiver no env
  if (!pfxBuffer) {
    const fs = require('fs');
    const path = require('path');
    const localCands = [
      'C:/Users/Alexandre/Downloads/120a2609105ad966.pfx',
      'C:/Users/Alexandre/Downloads/120a2601206670b4.pfx',
      path.join(__dirname, 'certs', 'gsi.pfx')
    ];
    for (const c of localCands) {
      if (fs.existsSync(c)) {
        try {
          pfxBuffer = fs.readFileSync(c);
          break;
        } catch (e) {}
      }
    }
  }

  if (!passphrase) {
    passphrase = process.env.NFSE_CERT_GSI_SENHA || '';
  }

  // Suporte opcional direto a Certificado e Chave Privada em PEM (imunes a problemas de PFX legado)
  let certPem = process.env.NFSE_CERT_GSI_CERT_PEM || '';
  let keyPem = process.env.NFSE_CERT_GSI_KEY_PEM || '';

  if (certPem && !certPem.includes('BEGIN CERTIFICATE')) {
    try {
      const dec = Buffer.from(certPem, 'base64').toString('utf8');
      if (dec.includes('BEGIN CERTIFICATE')) certPem = dec;
    } catch (e) {}
  }
  if (keyPem && !keyPem.includes('BEGIN')) {
    try {
      const dec = Buffer.from(keyPem, 'base64').toString('utf8');
      if (dec.includes('BEGIN')) keyPem = dec;
    } catch (e) {}
  }

  const usaPem = Boolean(certPem && keyPem);

  if (!usaPem && !pfxBuffer) {
    throw new Error('Certificado Digital da GSI (NFSE_CERT_GSI_PFX_BASE64 ou NFSE_CERT_GSI_CERT_PEM/KEY_PEM) não configurado para consulta na Prefeitura de SP.');
  }

  // Validação preventiva do contexto TLS
  try {
    const tls = require('tls');
    if (usaPem) {
      tls.createSecureContext({ cert: certPem, key: keyPem, passphrase: passphrase || undefined });
    } else {
      tls.createSecureContext({ pfx: pfxBuffer, passphrase: passphrase });
    }
  } catch (errCtx) {
    const msgHumanizada = humanizarErroMtls(errCtx);
    throw new Error(msgHumanizada);
  }

  // Extrai assinatura com chave privada para o cabeçalho
  let assinaturaBase64 = '';
  try {
    // Texto a assinar conforme manual Prefeitura de SP: Inscrição(8) + DtInicio(8) + DtFim(8)
    const textoParaAssinar = `${ccm}${dInicioLimpa}${dFimLimpa}`;
    const signer = crypto.createSign('RSA-SHA1');
    signer.update(textoParaAssinar, 'utf8');
    if (usaPem) {
      assinaturaBase64 = signer.sign({ key: keyPem, passphrase: passphrase || undefined }, 'base64');
    } else {
      assinaturaBase64 = crypto.sign('RSA-SHA1', Buffer.from(textoParaAssinar, 'utf8'), {
        key: pfxBuffer,
        passphrase: passphrase
      }).toString('base64');
    }
  } catch (errSig) {
    const msgErr = humanizarErroMtls(errSig);
    console.warn('⚠️ [Paulistana] Falha na assinatura digital da consulta:', msgErr);
    throw new Error(msgErr);
  }

  const envelopeSoap = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ConsultaNFeEmitidas xmlns="http://www.prefeitura.sp.gov.br/nfe">
      <VersaoSchema>1</VersaoSchema>
      <MensagemXML><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<PedidoConsultaNFeEmitidas xmlns="http://www.prefeitura.sp.gov.br/nfe">
  <Cabecalho Versao="1">
    <CPFCNPJRemetente>
      <CNPJ>${GSI_CNPJ_PADRAO}</CNPJ>
    </CPFCNPJRemetente>
    <InscricaoPrestador>${ccm}</InscricaoPrestador>
    <dtInicio>${dInicioLimpa.slice(0, 4)}-${dInicioLimpa.slice(4, 6)}-${dInicioLimpa.slice(6, 8)}</dtInicio>
    <dtFim>${dFimLimpa.slice(0, 4)}-${dFimLimpa.slice(4, 6)}-${dFimLimpa.slice(6, 8)}</dtFim>
    <NumeroPagina>${pagina}</NumeroPagina>
  </Cabecalho>
  <Assinatura>${assinaturaBase64}</Assinatura>
</PedidoConsultaNFeEmitidas>]]></MensagemXML>
    </ConsultaNFeEmitidas>
  </soap:Body>
</soap:Envelope>`;

  return new Promise((resolve, reject) => {
    const postData = Buffer.from(envelopeSoap, 'utf8');
    const options = {
      hostname: PREFEITURA_SP_HOST,
      port: 443,
      path: PREFEITURA_SP_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://www.prefeitura.sp.gov.br/nfe/ws/consultaNFeEmitidas',
        'Content-Length': postData.length
      },
      timeout: 30000
    };

    if (usaPem) {
      options.cert = certPem;
      options.key = keyPem;
      if (passphrase) options.passphrase = passphrase;
    } else {
      options.pfx = pfxBuffer;
      options.passphrase = passphrase;
    }

    const req = https.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const notas = parseNFeXmlPaulistana(body);
            resolve({ ok: true, statusCode: res.statusCode, totalNotas: notas.length, notas, rawResponse: body });
          } catch (e) {
            reject(new Error(`Falha ao decodificar resposta da Prefeitura de SP: ${e.message}`));
          }
        } else {
          reject(new Error(`Prefeitura de SP retornou HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Timeout de 30s excedido na comunicação com a Prefeitura de SP.'));
    });
    req.on('error', (err) => {
      reject(new Error(`Erro de conexão com a Nota Paulistana: ${humanizarErroMtls(err)}`));
    });

    req.write(postData);
    req.end();
  });
}

module.exports = {
  humanizarErroMtls,
  parseNFeXmlPaulistana,
  parseTxtLotePaulistana,
  gerarXmlSinteticoPaulistana,
  consultarNFeEmitidasWsPaulistana
};
