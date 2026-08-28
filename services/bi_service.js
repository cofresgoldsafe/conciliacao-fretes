/**
 * services/bi_service.js
 * Módulo de Serviço para Integração do Metabase BI Executivo
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

const jwt = require('jsonwebtoken');

/**
 * Verifica o status de configuração das variáveis do Metabase
 */
function getMetabaseConfigStatus() {
  const siteUrl = (process.env.METABASE_SITE_URL || '').trim().replace(/\/+$/, '');
  const secretKey = (process.env.METABASE_SECRET_KEY || '').trim();
  const dashboardId = parseInt(process.env.METABASE_EXEC_DASHBOARD_ID || '1', 10);

  const isConfigured = Boolean(siteUrl && secretKey && !isNaN(dashboardId));

  return {
    isConfigured,
    siteUrl: siteUrl || null,
    dashboardId: isNaN(dashboardId) ? 1 : dashboardId,
    hasSecretKey: Boolean(secretKey)
  };
}

/**
 * Gera a URL assinada (Signed JWT Embed) para visualização segura do Dashboard no Metabase
 * @param {Object} options Parâmetros opcionais (tema, filtros, validade)
 * @returns {Object} { success: boolean, configured: boolean, embedUrl?: string, message?: string }
 */
function generateSignedDashboardUrl(options = {}) {
  const config = getMetabaseConfigStatus();

  if (!config.isConfigured) {
    return {
      success: false,
      configured: false,
      message: 'Instância do Metabase não configurada. Defina as variáveis METABASE_SITE_URL e METABASE_SECRET_KEY.',
      setupGuide: {
        siteUrlSet: Boolean(config.siteUrl),
        secretKeySet: config.hasSecretKey,
        dashboardId: config.dashboardId
      }
    };
  }

  try {
    const theme = options.theme === 'light' ? 'light' : 'night'; // Padrão escuro combinando com o portal
    const dashboardId = options.dashboardId ? parseInt(options.dashboardId, 10) : config.dashboardId;
    const params = options.params || {};

    // Expiração curta do token (10 minutos)
    const exp = Math.round(Date.now() / 1000) + (10 * 60);

    const payload = {
      resource: { dashboard: dashboardId },
      params: params,
      exp: exp
    };

    const token = jwt.sign(payload, process.env.METABASE_SECRET_KEY.trim());

    // Parâmetros de visualização limpa (seamless) sem bordas e sem cabeçalhos externos
    const embedUrl = `${config.siteUrl}/embed/dashboard/${token}#bordered=false&titled=false&theme=${theme}`;

    return {
      success: true,
      configured: true,
      embedUrl,
      expiresAt: new Date(exp * 1000).toISOString(),
      dashboardId
    };
  } catch (err) {
    console.error('❌ [BI Service] Erro ao gerar token de embed do Metabase:', err);
    return {
      success: false,
      configured: true,
      message: `Erro ao assinar URL de incorporação: ${err.message}`
    };
  }
}

module.exports = {
  getMetabaseConfigStatus,
  generateSignedDashboardUrl
};
