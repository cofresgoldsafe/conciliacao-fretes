const fs = require('fs');
const path = require('path');
const mssql = require('mssql');

const envPath = 'C:\\Users\\Alexandre\\Documents\\claude\\protheus-mcp\\.env';
const envText = fs.readFileSync(envPath, 'utf8');
const env = {};

envText.split('\n').forEach(line => {
  if (line.includes('=') && !line.startsWith('#')) {
    const [k, v] = line.split('=');
    env[k.trim()] = v.split('#')[0].trim();
  }
});

const config = {
  server: env.DB_HOST,
  port: parseInt(env.DB_PORT || '1433', 10),
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

console.log(`Connecting to SQL Server: ${config.server}:${config.port} DB=${config.database}...`);

async function run() {
  try {
    const pool = await mssql.connect(config);
    console.log('✅ CONNECTED TO PROTHEUS SQL SERVER (CNVYB3_184594_PR_PD)!');
    
    const result = await pool.request().query(`
      SELECT DISTINCT
          SD2.D2_DOC,
          SD2.D2_PEDIDO,
          ISNULL(SC5.C5_FRETE, 0) AS C5_FRETE,
          ISNULL(SC5.C5VLR_FRT, 0) AS C5VLR_FRT
      FROM SD2160 SD2
      LEFT JOIN SC5160 SC5 
        ON SC5.C5_FILIAL = SD2.D2_FILIAL 
       AND SC5.C5_NUM = SD2.D2_PEDIDO 
       AND SC5.D_E_L_E_T_ = ' '
      WHERE SD2.D2_DOC IN ('000000546', '000000551', '000000561', '000000563', '000000566')
        AND SD2.D_E_L_E_T_ = ' '
    `);
    
    console.log('\n=== REAL RESULTS FROM OACO SD2160 / SC5160 ===');
    result.recordset.forEach(r => {
      console.log(`NF: ${r.D2_DOC.trim()} | Pedido SD2160/SC5160: ${r.D2_PEDIDO.trim()} | C5_FRETE: R$ ${r.C5_FRETE} | C5VLR_FRT: R$ ${r.C5VLR_FRT}`);
    });
    
    await pool.close();
  } catch (err) {
    console.error('❌ SQL Server Connection Error:', err);
  }
}

run();
