/**
 * routes/compras_necessidade.js
 * 
 * Controlador REST Modular: Necessidade de Compras Protheus (Módulo Compras)
 * Rota: GET /api/compras/necessidade
 */

const express = require('express');
const { consultarNecessidadeComprasProtheus } = require('../protheus_db');

function createComprasNecessidadeRouter({ requireAuth, handleServerError, logUserActivity, getUserFromReq }) {
  const router = express.Router();

  /**
   * GET /api/compras/necessidade
   * Query params:
   *  - empresa: '14' | '15' | '16'
   *  - modo: 'novas' (padrão) | 'todas'
   *  - grupo: 'todos' (padrão) | '018' | '001' | '017' | string
   */
  router.get('/', requireAuth, async (req, res) => {
    try {
      const { empresa, modo, grupo } = req.query || {};
      const emp = String(empresa || '').trim();
      const modoNorm = String(modo || 'novas').toLowerCase().trim();
      const grupoNorm = String(grupo || 'todos').trim();

      if (!['14', '15', '16'].includes(emp)) {
        return res.status(400).json({
          success: false,
          message: 'Por favor, selecione uma empresa válida (14 - Metal Pleno, 15 - GSI ou 16 - OAÇO).'
        });
      }

      if (!['novas', 'todas'].includes(modoNorm)) {
        return res.status(400).json({
          success: false,
          message: 'Modo inválido. Escolha "novas" ou "todas".'
        });
      }

      const resultado = await consultarNecessidadeComprasProtheus({
        empresa: emp,
        modo: modoNorm,
        grupo: grupoNorm
      });

      if (typeof logUserActivity === 'function' && typeof getUserFromReq === 'function') {
        const user = getUserFromReq(req);
        logUserActivity({
          username: user.username,
          userName: user.name,
          actionType: 'CONSULTA_NECESSIDADE_COMPRAS',
          description: `Consultou Necessidade de Compras da empresa ${emp} (Modo: ${modoNorm}, Grupo: ${grupoNorm}) - ${resultado.total} produtos`,
          ip: req.ip,
          metadata: { empresa: emp, modo: modoNorm, grupo: grupoNorm, total: resultado.total }
        }).catch(() => {});
      }

      res.json(resultado);
    } catch (err) {
      if (typeof handleServerError === 'function') {
        handleServerError(res, err, 'Erro ao consultar necessidade de compras no Protheus.');
      } else {
        console.error('❌ Erro na rota de necessidade de compras:', err);
        res.status(500).json({ success: false, message: err.message || 'Erro interno.' });
      }
    }
  });

  return router;
}

module.exports = createComprasNecessidadeRouter;
