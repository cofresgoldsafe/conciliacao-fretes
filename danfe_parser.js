/**
 * danfe_parser.js — Parser de Alta Performance para XML de NF-e (Layout SEFAZ 4.00)
 * 
 * Extrai campos oficiais necessários para renderização visual do DANFE
 * e formulário A4 oficial (@media print) com zero dependências externas (YAGNI).
 */

'use strict';

/**
 * Desescapa entidades XML básicas
 */
function unescapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

/**
 * Extrai o conteúdo da primeira ocorrência de uma tag XML (suporta tags com ou sem namespace)
 */
function getTag(xml, tagName) {
  if (!xml) return '';
  const regex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? unescapeXml(match[1]) : '';
}

/**
 * Extrai todas as ocorrências de uma tag XML em forma de array
 */
function getTags(xml, tagName) {
  if (!xml) return [];
  const regex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${tagName}>`, 'gi');
  const results = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
}

/**
 * Formata CPF (11 dígitos) ou CNPJ (14 dígitos)
 */
function formatCnpjCpf(val) {
  const clean = String(val || '').replace(/\D/g, '');
  if (clean.length === 11) {
    return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (clean.length === 14) {
    return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return clean || '-';
}

/**
 * Formata Chave de Acesso em grupos de 4 dígitos
 */
function formatChaveAcesso(chave) {
  const clean = String(chave || '').replace(/\D/g, '');
  if (clean.length !== 44) return clean;
  return clean.replace(/(\d{4})/g, '$1 ').trim();
}

/**
 * Formata data ISO (YYYY-MM-DD ou YYYY-MM-DDTHH:mm:ss...) para DD/MM/YYYY
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const clean = String(dateStr).trim();
  const dateMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) {
    return `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]}`;
  }
  if (/^\d{8}$/.test(clean)) {
    return `${clean.slice(6, 8)}/${clean.slice(4, 6)}/${clean.slice(0, 4)}`;
  }
  return clean;
}

/**
 * Formata hora a partir de timestamp ISO
 */
function formatTime(dateStr) {
  if (!dateStr) return '-';
  const clean = String(dateStr).trim();
  const timeMatch = clean.match(/T(\d{2}:\d{2}(?::\d{2})?)/i);
  return timeMatch ? timeMatch[1] : '-';
}

/**
 * Converte valor numérico para pt-BR
 */
function formatMoeda(val) {
  const num = parseFloat(String(val || 0).replace(',', '.'));
  if (isNaN(num)) return '0,00';
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Parser principal de XML de NF-e
 * @param {string} xmlContent Conteúdo do XML em string
 * @returns {Object} Dados estruturados para montagem do DANFE
 */
function parseDanfeXml(xmlContent) {
  if (!xmlContent || typeof xmlContent !== 'string') {
    throw new Error('Conteúdo do XML inválido ou vazio.');
  }

  // Remove comentários XML para evitar falsos positivos
  const cleanXml = xmlContent.replace(/<!--[\s\S]*?-->/g, '');

  // 1. Bloco Identificação (ide)
  const ideBlock = getTag(cleanXml, 'ide');
  const nNF = getTag(ideBlock, 'nNF');
  const serie = getTag(ideBlock, 'serie') || '1';
  const dhEmi = getTag(ideBlock, 'dhEmi') || getTag(ideBlock, 'dEmi');
  const dhSaiEnt = getTag(ideBlock, 'dhSaiEnt') || getTag(ideBlock, 'dSaiEnt');
  const tpNF = getTag(ideBlock, 'tpNF') || '1'; // 0=Entrada, 1=Saída
  const natOp = getTag(ideBlock, 'natOp');
  const tpAmb = getTag(ideBlock, 'tpAmb'); // 1=Produção, 2=Homologação

  // 2. Chave e Protocolo (protNFe ou atributo Id)
  const protBlock = getTag(cleanXml, 'infProt') || getTag(cleanXml, 'protNFe');
  let chNFe = getTag(protBlock, 'chNFe');
  if (!chNFe) {
    const idMatch = cleanXml.match(/Id=["']NFe(\d{44})["']/i);
    if (idMatch) chNFe = idMatch[1];
  }
  const nProt = getTag(protBlock, 'nProt') || '';
  const dhRecbto = getTag(protBlock, 'dhRecbto') || '';
  const cStat = getTag(protBlock, 'cStat') || '100';
  const xMotivo = getTag(protBlock, 'xMotivo') || 'Autorizado o uso da NF-e';

  // 3. Emitente (emit)
  const emitBlock = getTag(cleanXml, 'emit');
  const enderEmitBlock = getTag(emitBlock, 'enderEmit');
  const emitCnpj = getTag(emitBlock, 'CNPJ') || getTag(emitBlock, 'CPF');
  const emitente = {
    cnpjCpf: emitCnpj,
    cnpjCpfFormatado: formatCnpjCpf(emitCnpj),
    xNome: getTag(emitBlock, 'xNome'),
    xFant: getTag(emitBlock, 'xFant') || getTag(emitBlock, 'xNome'),
    ie: getTag(emitBlock, 'IE'),
    ieSt: getTag(emitBlock, 'IEST'),
    crt: getTag(emitBlock, 'CRT'),
    logradouro: getTag(enderEmitBlock, 'xLgr'),
    numero: getTag(enderEmitBlock, 'nro'),
    complemento: getTag(enderEmitBlock, 'xCpl'),
    bairro: getTag(enderEmitBlock, 'xBairro'),
    municipio: getTag(enderEmitBlock, 'xMun'),
    uf: getTag(enderEmitBlock, 'UF'),
    cep: getTag(enderEmitBlock, 'CEP'),
    fone: getTag(enderEmitBlock, 'fone')
  };

  // 4. Destinatário (dest)
  const destBlock = getTag(cleanXml, 'dest');
  const enderDestBlock = getTag(destBlock, 'enderDest');
  const destCnpjCpf = getTag(destBlock, 'CNPJ') || getTag(destBlock, 'CPF');
  const destinatario = {
    cnpjCpf: destCnpjCpf,
    cnpjCpfFormatado: formatCnpjCpf(destCnpjCpf),
    xNome: getTag(destBlock, 'xNome'),
    ie: getTag(destBlock, 'IE') || 'ISENTO',
    email: getTag(destBlock, 'email'),
    logradouro: getTag(enderDestBlock, 'xLgr'),
    numero: getTag(enderDestBlock, 'nro'),
    complemento: getTag(enderDestBlock, 'xCpl'),
    bairro: getTag(enderDestBlock, 'xBairro'),
    municipio: getTag(enderDestBlock, 'xMun'),
    uf: getTag(enderDestBlock, 'UF'),
    cep: getTag(enderDestBlock, 'CEP'),
    fone: getTag(enderDestBlock, 'fone')
  };

  // 5. Totais e Impostos (ICMSTot)
  const icmsTotBlock = getTag(cleanXml, 'ICMSTot');
  const totais = {
    vBC: parseFloat(getTag(icmsTotBlock, 'vBC') || 0),
    vICMS: parseFloat(getTag(icmsTotBlock, 'vICMS') || 0),
    vBCST: parseFloat(getTag(icmsTotBlock, 'vBCST') || 0),
    vST: parseFloat(getTag(icmsTotBlock, 'vST') || 0),
    vProd: parseFloat(getTag(icmsTotBlock, 'vProd') || 0),
    vFrete: parseFloat(getTag(icmsTotBlock, 'vFrete') || 0),
    vSeg: parseFloat(getTag(icmsTotBlock, 'vSeg') || 0),
    vDesc: parseFloat(getTag(icmsTotBlock, 'vDesc') || 0),
    vII: parseFloat(getTag(icmsTotBlock, 'vII') || 0),
    vIPI: parseFloat(getTag(icmsTotBlock, 'vIPI') || 0),
    vPIS: parseFloat(getTag(icmsTotBlock, 'vPIS') || 0),
    vCOFINS: parseFloat(getTag(icmsTotBlock, 'vCOFINS') || 0),
    vOutro: parseFloat(getTag(icmsTotBlock, 'vOutro') || 0),
    vNF: parseFloat(getTag(icmsTotBlock, 'vNF') || 0)
  };

  // 6. Transportadora e Volumes (transp)
  const transpBlock = getTag(cleanXml, 'transp');
  const transportaBlock = getTag(transpBlock, 'transporta');
  const volBlock = getTag(transpBlock, 'vol');
  const veicBlock = getTag(transpBlock, 'veicTransp');

  const modFreteCode = getTag(transpBlock, 'modFrete') || '9';
  const modFreteDesc = {
    '0': '0 - Emitente (CIF)',
    '1': '1 - Destinatário (FOB)',
    '2': '2 - Terceiros',
    '3': '3 - Próprio Remetente',
    '4': '4 - Próprio Destinatário',
    '9': '9 - Sem Ocorrência de Transporte'
  }[modFreteCode] || `${modFreteCode} - Não Informado`;

  const transportador = {
    modFrete: modFreteDesc,
    cnpjCpf: getTag(transportaBlock, 'CNPJ') || getTag(transportaBlock, 'CPF'),
    cnpjCpfFormatado: formatCnpjCpf(getTag(transportaBlock, 'CNPJ') || getTag(transportaBlock, 'CPF')),
    xNome: getTag(transportaBlock, 'xNome') || '-',
    ie: getTag(transportaBlock, 'IE') || '-',
    xEnder: getTag(transportaBlock, 'xEnder') || '-',
    xMun: getTag(transportaBlock, 'xMun') || '-',
    uf: getTag(transportaBlock, 'UF') || '-',
    placa: getTag(veicBlock, 'placa') || '-',
    placaUf: getTag(veicBlock, 'UF') || '-',
    rntc: getTag(veicBlock, 'RNTC') || '-',
    quantidade: getTag(volBlock, 'qVol') || '-',
    especie: getTag(volBlock, 'esp') || '-',
    marca: getTag(volBlock, 'marca') || '-',
    numeracao: getTag(volBlock, 'nVol') || '-',
    pesoBruto: parseFloat(getTag(volBlock, 'pesoB') || 0),
    pesoLiquido: parseFloat(getTag(volBlock, 'pesoL') || 0)
  };

  // 7. Cobrança e Faturas (cobr / dup)
  const cobrBlock = getTag(cleanXml, 'cobr');
  const dupTags = getTags(cobrBlock, 'dup');
  const duplicatas = dupTags.map(dupXml => ({
    nDup: getTag(dupXml, 'nDup'),
    dVenc: formatDate(getTag(dupXml, 'dVenc')),
    vDup: parseFloat(getTag(dupXml, 'vDup') || 0),
    vDupFormatado: formatMoeda(getTag(dupXml, 'vDup') || 0)
  }));

  // 8. Itens da NF-e (det)
  const detTags = getTags(cleanXml, 'det');
  const itens = detTags.map((detXml, idx) => {
    const prodBlock = getTag(detXml, 'prod');
    const impostoBlock = getTag(detXml, 'imposto');
    const icmsInner = getTag(impostoBlock, 'ICMS');
    const ipiInner = getTag(impostoBlock, 'IPI');

    // Tenta encontrar CST ou CSOSN
    let cst = '';
    const cstMatch = icmsInner.match(/<CST>(\d+)<\/CST>/i);
    const csosnMatch = icmsInner.match(/<CSOSN>(\d+)<\/CSOSN>/i);
    if (cstMatch) cst = cstMatch[1];
    else if (csosnMatch) cst = csosnMatch[1];

    const qCom = parseFloat(getTag(prodBlock, 'qCom') || 0);
    const vUnCom = parseFloat(getTag(prodBlock, 'vUnCom') || 0);
    const vProd = parseFloat(getTag(prodBlock, 'vProd') || (qCom * vUnCom));

    return {
      item: idx + 1,
      codigo: getTag(prodBlock, 'cProd'),
      descricao: getTag(prodBlock, 'xProd'),
      ncm: getTag(prodBlock, 'NCM'),
      cst: cst || '00',
      cfop: getTag(prodBlock, 'CFOP'),
      unidade: getTag(prodBlock, 'uCom') || 'UN',
      quantidade: qCom,
      valorUnitario: vUnCom,
      valorTotal: vProd,
      vBC: parseFloat(getTag(icmsInner, 'vBC') || 0),
      pICMS: parseFloat(getTag(icmsInner, 'pICMS') || 0),
      vICMS: parseFloat(getTag(icmsInner, 'vICMS') || 0),
      pIPI: parseFloat(getTag(ipiInner, 'pIPI') || 0),
      vIPI: parseFloat(getTag(ipiInner, 'vIPI') || 0)
    };
  });

  // 9. Informações Adicionais (infAdic)
  const infAdicBlock = getTag(cleanXml, 'infAdic');
  const infCpl = getTag(infAdicBlock, 'infCpl');
  const infAdFisco = getTag(infAdicBlock, 'infAdFisco');

  return {
    chaveAcesso: chNFe,
    chaveFormatada: formatChaveAcesso(chNFe),
    numeroNf: nNF,
    serie,
    tipoOperacao: tpNF === '0' ? '0 - ENTRADA' : '1 - SAÍDA',
    tpNF,
    naturezaOperacao: natOp,
    dataEmissao: formatDate(dhEmi),
    horaEmissao: formatTime(dhEmi),
    dataSaidaEntrada: formatDate(dhSaiEnt) || formatDate(dhEmi),
    horaSaidaEntrada: formatTime(dhSaiEnt) || formatTime(dhEmi),
    protocolo: {
      numero: nProt || 'AUTORIZADO EM CONTINGÊNCIA/SEFAZ',
      dataHora: formatDate(dhRecbto) + (dhRecbto ? ' ' + formatTime(dhRecbto) : ''),
      cStat,
      xMotivo
    },
    emitente,
    destinatario,
    totais,
    transportador,
    duplicatas,
    itens,
    informacoesComplementares: infCpl,
    informacoesFisco: infAdFisco
  };
}

module.exports = {
  parseDanfeXml,
  formatCnpjCpf,
  formatChaveAcesso,
  formatDate,
  formatMoeda
};
