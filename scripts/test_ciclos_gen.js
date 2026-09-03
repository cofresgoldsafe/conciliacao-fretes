const { calcularCicloFechamentoDisponivel } = require('../fechamento_vendedores_engine');

function obterCiclosPredefinidosFechamento(qtd = 6, refDate) {
  const c0 = calcularCicloFechamentoDisponivel(refDate);
  const parts = c0.dataFimIso.split('-');
  const endYear = parseInt(parts[0], 10);
  const endMonth = parseInt(parts[1], 10) - 1; // 0-based

  const pad = (n) => String(n).padStart(2, '0');
  const ciclos = [];

  for (let offset = 0; offset < qtd; offset++) {
    const dIni = new Date(endYear, endMonth - offset - 1, 26);
    const dFim = new Date(endYear, endMonth - offset, 25);

    const sYear = dIni.getFullYear();
    const sMonth = dIni.getMonth() + 1;
    const eYear = dFim.getFullYear();
    const eMonth = dFim.getMonth() + 1;

    const dataIniIso = sYear + '-' + pad(sMonth) + '-26';
    const dataFimIso = eYear + '-' + pad(eMonth) + '-25';
    const dtIni = String(sYear) + pad(sMonth) + '26';
    const dtFim = String(eYear) + pad(eMonth) + '25';
    const dataIniBR = '26/' + pad(sMonth) + '/' + sYear;
    const dataFimBR = '25/' + pad(eMonth) + '/' + eYear;
    const cicloId = dataIniIso + '_' + dataFimIso;
    const label = dataIniBR + ' a ' + dataFimBR;

    ciclos.push({
      cicloId,
      label,
      periodoLabel: label,
      dataIniIso,
      dataFimIso,
      dtIni,
      dtFim,
      dataIniBR,
      dataFimBR,
      isAtual: offset === 0,
      offset
    });
  }
  return ciclos;
}

console.log(obterCiclosPredefinidosFechamento(6));
