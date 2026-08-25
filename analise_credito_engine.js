/**
 * Motor de Análise de Crédito e Cálculo de Score Comercial
 * Baseado na planilha oficial "Score Análise de Crédito 2025.xlsx"
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const configFilePath = path.join(dataDir, 'score_config.json');
const historyFilePath = path.join(dataDir, 'analise_credito_history.json');

const DEFAULT_CONFIG = {
  // 1. Limites Monetários & Gatilhos Operacionais
  limite_pedido_alto: 21000.0,
  peso_pedido_alto: -8.0,
  limite_pedido_compra: 5000.0,
  limite_armario_cofre: 2000.0,

  // 2. Pesos Comerciais, Vendas a Prazo & Histórico Protheus
  peso_faturado_avista: 100.0,
  peso_entrada_sim: 12.0,
  peso_entrada_nao: -4.0,
  peso_comprou_2x_sim: 9.0,
  peso_comprou_2x_nao: -3.0,
  peso_comprou_5x_sim: 23.0,
  peso_pgtos_abertos_sim: -3.0,
  peso_pgtos_abertos_nao: 1.0,
  peso_muitos_itens_sim: -13.0,
  peso_muitos_itens_nao: 1.0,
  peso_prod_variados_sim: -5.0,
  peso_prod_variados_nao: 2.0,

  // 3. Pesos Cadastrais, Localização & Receita Federal
  peso_cnpj_ativo_sim: 2.0,
  peso_cnpj_ativo_nao: -100.0,
  peso_cadastro_receita_sim: 3.0,
  peso_cadastro_receita_nao: -3.0,
  peso_entrega_cadastro_sim: 2.0,
  peso_entrega_cadastro_nao: -9.0,
  peso_endereco_sala_sim: -5.0,
  peso_endereco_sala_nao: 1.0,
  peso_uf_rj: -12.0,
  peso_maps_10: 6.0,
  peso_maps_5: 0.0,
  peso_maps_0: -6.0,
  peso_maps_traco: -3.0,
  peso_registro_br_sim: 6.0,

  // 4. Estudo de E-mails & Maturidade Digital (RDAP, Wayback, MX, Site)
  peso_email_corp_sim: 3.0,
  peso_email_corp_nao: -3.0,
  peso_email_fin_diferente_nao: -7.0,
  peso_email_gratuito_sim: -8.0,
  peso_email_gratuito_nao: 2.0,
  peso_site_ativo_sim: 1.0,
  peso_site_ativo_nao: -15.0,
  peso_dominio_idade_10: 6.0,
  peso_dominio_idade_3: 3.0,
  peso_dominio_idade_1: 0.0,
  peso_dominio_idade_recente: -7.0,
  peso_dominio_sem_site: -5.0,
  peso_wayback_5: 3.0,
  peso_wayback_1: 1.0,
  peso_wayback_zero: 0.0,
  peso_mx_premium: 3.0,
  peso_mx_padrao: 0.0,
  peso_mx_inexistente: -4.0,

  // 5. Fundação da Empresa & Capital Social
  peso_idade_30: 8.0,
  peso_idade_15: 4.0,
  peso_idade_5: 0.0,
  peso_idade_menor5: -6.0,
  peso_capital_10m: 12.0,
  peso_capital_1m: 6.0,
  peso_capital_150k: 0.0,
  peso_capital_12k_menor: -3.0,
  peso_capital_zero: -7.0,
  peso_grande_conhecida_sim: 5.0,

  // 6. Serasa, Protestos, Cheques & Certidões Comerciais
  peso_protestos_nao: 5.0,
  peso_protestos_sim: -10.0,
  peso_protesto_2x_ped: -10.0,
  peso_protesto_maior_capital: -20.0,
  peso_protesto_menor_capital: 4.0,
  peso_ch_sem_fundo_sim: -6.0,
  peso_pfin_sim: -5.0,
  peso_pfin_nao: 1.0,
  peso_serasa_700: 8.0,
  peso_serasa_500: 4.0,
  peso_serasa_200: -4.0,
  peso_serasa_baixo: -15.0,
  peso_serasa_zero: -20.0,
  peso_fgts_regular_nao: -6.0,
  peso_razao_fgts_igual_nao: -10.0,
  peso_boletos_sim: 3.0,
  peso_boletos_nao: -3.0,
};

function getScoreConfig() {
  if (fs.existsSync(configFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
      return { ...DEFAULT_CONFIG, ...data };
    } catch (e) {
      console.warn('Erro ao ler score_config.json, usando padrão', e);
    }
  }
  return { ...DEFAULT_CONFIG };
}

function saveScoreConfig(cfg) {
  try {
    const merged = { ...getScoreConfig(), ...cfg };
    fs.writeFileSync(configFilePath, JSON.stringify(merged, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('Erro ao salvar score_config.json', e);
    return false;
  }
}

function resetScoreConfig() {
  try {
    if (fs.existsSync(configFilePath)) {
      fs.unlinkSync(configFilePath);
    }
    return { ...DEFAULT_CONFIG };
  } catch (e) {
    console.error('Erro ao resetar score_config.json', e);
    return { ...DEFAULT_CONFIG };
  }
}

function calcularScore(dados, config = getScoreConfig()) {
  const pontos = {};

  const totalPed = Number(dados.total_pedido) || 0;
  pontos.total_pedido = totalPed > config.limite_pedido_alto ? (config.peso_pedido_alto !== undefined ? config.peso_pedido_alto : -8) : 0;

  const isFaturado = dados.faturado === 'S';
  pontos.faturado = !isFaturado ? config.peso_faturado_avista : 0;
  pontos.entrada = dados.entrada === 'S' ? config.peso_entrada_sim : config.peso_entrada_nao;
  pontos.quant_grande = dados.quant_grande === 'S' ? config.peso_muitos_itens_sim : config.peso_muitos_itens_nao;
  pontos.prod_nao_combinam = dados.prod_nao_combinam === 'S' ? config.peso_prod_variados_sim : config.peso_prod_variados_nao;
  pontos.pgtos_abertos = dados.pgtos_abertos === 'S' ? config.peso_pgtos_abertos_sim : config.peso_pgtos_abertos_nao;
  pontos.comprou_pagou = dados.comprou_pagou === 'S' ? config.peso_comprou_2x_sim : config.peso_comprou_2x_nao;
  pontos.comprou_pagou_5x = dados.comprou_pagou_5x === 'S' ? config.peso_comprou_5x_sim : 0;
  pontos.cadastro_igual_receita = dados.cadastro_igual_receita === 'S' ? config.peso_cadastro_receita_sim : config.peso_cadastro_receita_nao;
  pontos.cnpj_ativo = dados.cnpj_ativo === 'S' ? config.peso_cnpj_ativo_sim : config.peso_cnpj_ativo_nao;

  const entregaIgualCadastro = dados.entrega_igual_cadastro === 'S';
  pontos.entrega_igual_cadastro = entregaIgualCadastro ? config.peso_entrega_cadastro_sim : config.peso_entrega_cadastro_nao;

  const uf = (dados.uf_cliente || '').toUpperCase().trim();
  pontos.uf_cliente = uf === 'RJ' ? config.peso_uf_rj : 0;

  const maps = dados.google_maps || '-';
  if (maps === '10') pontos.google_maps = config.peso_maps_10;
  else if (maps === '5') pontos.google_maps = config.peso_maps_5;
  else if (maps === '0') pontos.google_maps = config.peso_maps_0;
  else pontos.google_maps = config.peso_maps_traco;

  if (entregaIgualCadastro) {
    pontos.registro_br = 0;
  } else {
    pontos.registro_br = dados.registro_br === 'S' ? config.peso_registro_br_sim : 0;
  }

  // Inteligência Digital Automática (RDAP Registro.br, Wayback Machine, Servidor MX)
  const idadeDominio = dados.idade_dominio_rdap !== undefined && dados.idade_dominio_rdap !== null && dados.idade_dominio_rdap !== '' 
    ? Number(dados.idade_dominio_rdap) 
    : null;

  if (idadeDominio !== null && !isNaN(idadeDominio)) {
    if (idadeDominio >= 10) pontos.idade_dominio = config.peso_dominio_idade_10 !== undefined ? config.peso_dominio_idade_10 : 6;
    else if (idadeDominio >= 3) pontos.idade_dominio = config.peso_dominio_idade_3 !== undefined ? config.peso_dominio_idade_3 : 3;
    else if (idadeDominio >= 1) pontos.idade_dominio = config.peso_dominio_idade_1 !== undefined ? config.peso_dominio_idade_1 : 0;
    else pontos.idade_dominio = config.peso_dominio_idade_recente !== undefined ? config.peso_dominio_idade_recente : -7;
  } else {
    pontos.idade_dominio = dados.possui_site === 'N' ? (config.peso_dominio_sem_site !== undefined ? config.peso_dominio_sem_site : -5) : 0;
  }

  const waybackAno = dados.wayback_primeiro_snapshot ? parseInt(dados.wayback_primeiro_snapshot, 10) : 0;
  const anoAtual = new Date().getFullYear();
  if (waybackAno > 1990) {
    const anosHistorico = anoAtual - waybackAno;
    if (anosHistorico >= 5) pontos.wayback = config.peso_wayback_5 !== undefined ? config.peso_wayback_5 : 3;
    else if (anosHistorico >= 1) pontos.wayback = config.peso_wayback_1 !== undefined ? config.peso_wayback_1 : 1;
    else pontos.wayback = config.peso_wayback_zero !== undefined ? config.peso_wayback_zero : 0;
  } else {
    pontos.wayback = config.peso_wayback_zero !== undefined ? config.peso_wayback_zero : 0;
  }

  const mxTipo = (dados.tipo_servidor_mx || '').toUpperCase();
  if (mxTipo === 'PREMIUM') pontos.servidor_mx = config.peso_mx_premium !== undefined ? config.peso_mx_premium : 3;
  else if (mxTipo === 'PADRAO' || mxTipo === 'PROPRIO') pontos.servidor_mx = config.peso_mx_padrao !== undefined ? config.peso_mx_padrao : 0;
  else if (dados.email_corporativo === 'S' && (mxTipo === 'NENHUM' || !mxTipo)) pontos.servidor_mx = config.peso_mx_inexistente !== undefined ? config.peso_mx_inexistente : -4;
  else pontos.servidor_mx = 0;

  pontos.casa_sala_conj = dados.casa_sala_conj_end === 'S' ? config.peso_endereco_sala_sim : (dados.casa_sala_conj_end === 'N' ? config.peso_endereco_sala_nao : 0);
  pontos.email_corporativo = dados.email_corporativo === 'S' ? config.peso_email_corp_sim : (dados.email_corporativo === 'N' ? config.peso_email_corp_nao : 0);
  pontos.existe_mail_financeiro = dados.existe_mail_financeiro === 'S' ? 0 : (dados.existe_mail_financeiro === 'N' ? config.peso_email_fin_diferente_nao : 0);
  pontos.mail_gratuito = dados.mail_gratuito === 'S' ? config.peso_email_gratuito_sim : (dados.mail_gratuito === 'N' ? config.peso_email_gratuito_nao : 0);
  pontos.possui_site = dados.possui_site === 'S' ? config.peso_site_ativo_sim : (dados.possui_site === 'N' ? config.peso_site_ativo_nao : 0);

  let idadeAnos = 0;
  if (dados.fundacao_matriz) {
    const dataFund = new Date(dados.fundacao_matriz);
    if (!isNaN(dataFund.getTime())) {
      const diffMs = Date.now() - dataFund.getTime();
      idadeAnos = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365.25));
    }
  }
  if (idadeAnos >= 30) pontos.idade_empresa = config.peso_idade_30;
  else if (idadeAnos >= 15) pontos.idade_empresa = config.peso_idade_15;
  else if (idadeAnos >= 5) pontos.idade_empresa = config.peso_idade_5;
  else if (dados.fundacao_matriz) pontos.idade_empresa = config.peso_idade_menor5;
  else pontos.idade_empresa = 0;

  pontos.empresa_grande_conhecida = dados.empresa_grande_conhecida === 'S' ? config.peso_grande_conhecida_sim : 0;

  const temProtestos = dados.protestos === 'S';
  if (dados.protestos === 'N') {
    pontos.protestos = config.peso_protestos_nao;
    pontos.vlr_protestos_vs_ped = 0;
    pontos.protestos_vs_capital = 0;
  } else if (temProtestos) {
    pontos.protestos = config.peso_protestos_sim;
    const vlrProtestos = Number(dados.valor_protestos) || 0;
    pontos.vlr_protestos_vs_ped = totalPed > 0 && vlrProtestos > totalPed * 2 ? config.peso_protesto_2x_ped : 0;

    const capitalSocial = Number(dados.capital_social) || 0;
    if (capitalSocial > 0) {
      pontos.protestos_vs_capital = vlrProtestos > capitalSocial ? config.peso_protesto_maior_capital : config.peso_protesto_menor_capital;
    } else {
      pontos.protestos_vs_capital = 0;
    }
  } else {
    pontos.protestos = 0;
    pontos.vlr_protestos_vs_ped = 0;
    pontos.protestos_vs_capital = 0;
  }

  pontos.ch_sem_fundo = dados.ch_sem_fundo === 'S' ? config.peso_ch_sem_fundo_sim : 0;
  pontos.pfin = dados.pfin === 'S' ? config.peso_pfin_sim : (dados.pfin === 'N' ? config.peso_pfin_nao : 0);

  const scoreSerasa = parseInt(dados.score_serasa, 10);
  if (!isNaN(scoreSerasa) && dados.score_serasa !== '' && dados.score_serasa !== undefined) {
    if (scoreSerasa >= 700) pontos.score_serasa = config.peso_serasa_700;
    else if (scoreSerasa >= 500) pontos.score_serasa = config.peso_serasa_500;
    else if (scoreSerasa >= 200) pontos.score_serasa = config.peso_serasa_200;
    else if (scoreSerasa > 0) pontos.score_serasa = config.peso_serasa_baixo;
    else pontos.score_serasa = config.peso_serasa_zero;
  } else {
    pontos.score_serasa = 0;
  }

  const capitalSocial = Number(dados.capital_social) || 0;
  if (capitalSocial >= 10000000) pontos.capital_social = config.peso_capital_10m;
  else if (capitalSocial >= 1000000) pontos.capital_social = config.peso_capital_1m;
  else if (capitalSocial >= 150000) pontos.capital_social = config.peso_capital_150k;
  else if (capitalSocial >= 12000) pontos.capital_social = config.peso_capital_12k_menor;
  else if (capitalSocial > 0) pontos.capital_social = config.peso_capital_zero;
  else pontos.capital_social = 0;

  if (dados.tres_nfs_confirmadas === 'S') pontos.tres_nfs = config.peso_boletos_sim;
  else if (dados.tres_nfs_confirmadas === 'N') pontos.tres_nfs = config.peso_boletos_nao;
  else pontos.tres_nfs = 0; // 'D' (Dispensado) = 0 pts

  pontos.fgts_regular = dados.fgts_situacao_regular === 'N' ? config.peso_fgts_regular_nao : 0;
  pontos.razao_fgts_igual = dados.razao_fgts_igual === 'N' ? config.peso_razao_fgts_igual_nao : 0;

  const totalScore = Object.values(pontos).reduce((acc, curr) => acc + curr, 0);

  const subEmpresinha = pontos.capital_social + pontos.mail_gratuito + pontos.casa_sala_conj + pontos.empresa_grande_conhecida;
  const subGolpe =
    pontos.entrada +
    pontos.quant_grande +
    pontos.prod_nao_combinam +
    pontos.entrega_igual_cadastro +
    pontos.registro_br +
    pontos.mail_gratuito +
    pontos.possui_site +
    pontos.capital_social +
    pontos.razao_fgts_igual;
  const subGrandeFalindo = pontos.protestos + pontos.empresa_grande_conhecida + pontos.idade_empresa;

  let risco = 'SEM-RISCO';
  let sugestao = 'LIBERADO';

  if (totalScore > 5) {
    risco = 'SEM-RISCO';
    sugestao = 'LIBERADO';
  } else {
    if (capitalSocial > 999000) {
      risco = 'GRANDE-OU-FALINDO';
      sugestao = 'SE FALINDO SÓ ANTECIPADO | SE GRANDE BUROCR PEGAR CONTATOS FINANCEIRO';
    } else {
      if (subGolpe < subEmpresinha) {
        risco = 'GOLPE';
        sugestao = 'ENTRADA OU A VISTA';
      } else {
        risco = 'EMPRESINHA';
        sugestao = 'VER E-MAIL CORPORATIVO SITE REFERENC COML NFE 3S ALTO VALOR FATURADO';
      }
    }
  }

  const alertaPedCompra = totalPed > config.limite_pedido_compra ? 'SOLICITAR PED COMPRA' : 'N/A';
  const alertaContratoEntrega = dados.armario_cofre_gt_2000 === 'S' ? 'SOLIC CONTRATO DE ENTREGA' : 'N/A';
  const alertaPerigoGolpe = !entregaIgualCadastro && isFaturado ? 'PERIGO CHECAGEM REVERSA' : 'N/A';
  const alertaCadastroReceita = dados.cadastro_igual_receita === 'N' ? 'PRECISA CORRIGIR END DIVERGENTE' : 'N/A';

  const sugestoesLista = [];
  if (alertaContratoEntrega !== 'N/A') sugestoesLista.push('SOLIC CONTRATO DE ENTREGA');
  if (alertaPedCompra !== 'N/A') sugestoesLista.push('SOLICITAR PED COMPRA');
  if (alertaPerigoGolpe !== 'N/A') sugestoesLista.push('PERIGO CHECAGEM REVERSA');
  if (alertaCadastroReceita !== 'N/A') sugestoesLista.push('CORRIGIR END DIVERGENTE');
  if (sugestao && sugestao !== 'LIBERADO' && !sugestoesLista.includes(sugestao)) {
    sugestoesLista.push(sugestao);
  }

  return {
    totalScore,
    risco,
    sugestao,
    alertaPedCompra,
    alertaContratoEntrega,
    alertaPerigoGolpe,
    alertaCadastroReceita,
    sugestoesLista,
    detalhesPontos: pontos,
  };
}

function getHistorico() {
  if (fs.existsSync(historyFilePath)) {
    try {
      return JSON.parse(fs.readFileSync(historyFilePath, 'utf-8'));
    } catch (e) {
      console.warn('Erro ao ler analise_credito_history.json', e);
    }
  }
  return [];
}

function salvarAnalise(registro) {
  try {
    const list = getHistorico();
    const resultado = calcularScore(registro);
    const itemCompleto = {
      id: String(Date.now()),
      ...registro,
      total_score: registro.total_score !== undefined ? registro.total_score : resultado.totalScore,
      risco: registro.risco || resultado.risco,
      sugestao: registro.sugestao || resultado.sugestao,
      sugestoes_lista: registro.sugestoes_lista || resultado.sugestoesLista || [],
      detalhes_pontos: registro.detalhes_pontos || resultado.detalhesPontos,
      usuario: registro.usuario || 'Sistema',
      created_at: new Date().toISOString()
    };
    list.unshift(itemCompleto);
    fs.writeFileSync(historyFilePath, JSON.stringify(list, null, 2), 'utf-8');
    return itemCompleto;
  } catch (e) {
    console.error('Erro ao salvar analise de credito', e);
    return null;
  }
}

module.exports = {
  getScoreConfig,
  saveScoreConfig,
  resetScoreConfig,
  DEFAULT_CONFIG,
  calcularScore,
  getHistorico,
  salvarAnalise
};
