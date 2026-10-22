/**
 * public/js/whatsapp_sso.js
 *
 * Ponte de login único (SSO) para o painel WhatsApp Atendimento
 * (https://gemini-whatsapp-multi360.onrender.com).
 *
 * 1. Sem sessão no portal: manda para o login normal (senha + código por e-mail)
 *    com ?redirect=/whatsapp-sso.html, e o portal devolve para esta página.
 * 2. Com sessão: pede ao servidor um passe de uso único (60 s) e segue para o painel.
 *
 * Não altera nada da sessão do portal.
 */
(function () {
  'use strict';

  var LOGIN_URL = '/?redirect=' + encodeURIComponent('/whatsapp-sso.html');
  var card = document.getElementById('ssoCard');
  var msg = document.getElementById('ssoMsg');

  function showError(text) {
    if (msg) msg.textContent = text;
    if (card) card.classList.add('erro');
  }

  function readSession() {
    try {
      var raw = localStorage.getItem('conciliacao_fretes_session');
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (s && s.token && s.expiresAt && s.expiresAt > Date.now()) return s;
    } catch (e) { /* sessão ilegível = sem sessão */ }
    return null;
  }

  var session = readSession();
  if (!session) {
    if (msg) msg.textContent = 'Indo para o login do portal...';
    window.location.replace(LOGIN_URL);
    return;
  }

  fetch('/api/auth/whatsapp-ticket', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + session.token
    },
    body: '{}'
  })
    .then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) {
          // Token do portal vencido: faz login de novo e volta para cá.
          try { localStorage.removeItem('conciliacao_fretes_session'); } catch (e) {}
          window.location.replace(LOGIN_URL);
          return;
        }
        if (!res.ok || !data || !data.redirectUrl) {
          showError((data && data.message) || 'Não foi possível abrir o WhatsApp Atendimento.');
          return;
        }
        if (msg) msg.textContent = 'Abrindo o painel...';
        window.location.replace(data.redirectUrl);
      });
    })
    .catch(function () {
      showError('Falha de conexão com o portal. Tente novamente.');
    });
})();
