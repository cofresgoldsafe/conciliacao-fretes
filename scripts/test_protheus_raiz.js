const { executeRailwayQuery } = require('../protheus_db');

async function test() {
  const q = `
    SELECT TOP 10 
      SUBSTRING(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(a.A1_CGC)), '.', ''), '/', ''), '-', ''), 1, 8) as raiz_cnpj, 
      COUNT(DISTINCT f.F2_DOC + f.F2_SERIE) as total_compras, 
      MIN(f.F2_EMISSAO) as primeira_compra, 
      MAX(f.F2_EMISSAO) as ultima_compra, 
      SUM(f.F2_VALBRUT) as valor_total, 
      MAX(a.A1_NOME) as razao_social 
    FROM SF2150 f 
    INNER JOIN SA1010 a ON a.A1_COD = f.F2_CLIENTE AND a.A1_LOJA = f.F2_LOJA AND a.D_E_L_E_T_ = ''
    WHERE f.D_E_L_E_T_ = '' AND LEN(LTRIM(RTRIM(a.A1_CGC))) >= 8 
    GROUP BY SUBSTRING(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(a.A1_CGC)), '.', ''), '/', ''), '-', ''), 1, 8) 
    ORDER BY total_compras DESC
  `;
  try {
    const res = await executeRailwayQuery(q);
    console.log("Sucesso! Linhas:", res.rows?.length);
    console.log(res.rows?.slice(0, 5));
  } catch(e) {
    console.error("Erro:", e.message);
  }
}
test();
