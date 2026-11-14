/**
 * whatsapp_sso.js
 * 
 * Handler reutilizável para emissão de tickets SSO de acesso ao painel do WhatsApp.
 * Suporta parâmetro opcional { deal } com verificação de escopo RBAC no CRM.
 */

'use strict';

const crypto = require('crypto');
const crmEngine = require('./crm_engine');
const { resolverAcessoCrm } = require('./crm_routes');

function criarHandlerWhatsappTicket({
  getUsersDB,
  userHasWhatsappAccess,
  whatsappSsoTickets,
  logUserActivity,
  WHATSAPP_PANEL_URL,
  handleServerError
}) {
  return async function handleWhatsappTicket(req, res) {
    try {
      const cleanUser = String((req.user && req.user.username) || '').trim().toLowerCase();
      const allUsers = await getUsersDB();
      const userFound = allUsers.find(u => String(u.username || '').trim().toLowerCase() === cleanUser);
      if (!userHasWhatsappAccess(userFound)) {
        return res.status(403).json({
          success: false,
          message: 'Seu usuário não tem acesso ao WhatsApp Atendimento. Peça ao administrador para marcar a opção "WhatsApp" em Abas Permitidas.'
        });
      }

      let dealIdParam = null;
      if (req.body && req.body.deal !== undefined && req.body.deal !== null && String(req.body.deal).trim() !== '') {
        const rawDeal = String(req.body.deal).trim();
        let crmScope = null;
        try {
          const acesso = await resolverAcessoCrm(userFound);
          crmScope = acesso.crmScope;
        } catch (_) {
          return res.status(404).json({
            success: false,
            code: 'DEAL_NOT_FOUND',
            message: 'Oportunidade não encontrada.'
          });
        }

        const dealObj = await crmEngine.obterDealPorId(rawDeal, crmScope);
        if (!dealObj) {
          return res.status(404).json({
            success: false,
            code: 'DEAL_NOT_FOUND',
            message: 'Oportunidade não encontrada.'
          });
        }

        dealIdParam = String(dealObj.id);
      }

      const now = Date.now();
      for (const [key, val] of whatsappSsoTickets) {
        if (val.expiresAt < now) whatsappSsoTickets.delete(key);
      }
      const ticket = crypto.randomBytes(32).toString('base64url');
      whatsappSsoTickets.set(ticket, { username: cleanUser, expiresAt: now + 60 * 1000 });

      if (typeof logUserActivity === 'function') {
        logUserActivity({
          username: cleanUser,
          userName: (userFound && userFound.name) || cleanUser,
          actionType: 'ACESSO_WHATSAPP',
          description: dealIdParam
            ? `Acesso ao painel WhatsApp Atendimento vinculado ao negócio #${dealIdParam}`
            : 'Acesso ao painel WhatsApp Atendimento (login único)',
          ip: req.ip
        }).catch(() => {});
      }

      let redirectUrl = `${WHATSAPP_PANEL_URL}/auth/callback?ticket=${encodeURIComponent(ticket)}`;
      if (dealIdParam) {
        redirectUrl += `&deal=${encodeURIComponent(dealIdParam)}`;
      }

      return res.json({
        success: true,
        redirectUrl
      });
    } catch (err) {
      if (typeof handleServerError === 'function') {
        return handleServerError(res, err, 'Erro ao gerar acesso ao WhatsApp Atendimento.');
      }
      console.error('❌ [WhatsApp SSO] Erro ao gerar ticket:', err);
      return res.status(500).json({
        success: false,
        message: 'Erro ao gerar acesso ao WhatsApp Atendimento.'
      });
    }
  };
}

module.exports = {
  criarHandlerWhatsappTicket
};
