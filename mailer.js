const nodemailer = require('nodemailer');

/**
 * Utilitário de Mascaramento Seguro de E-mail (Anti-PII Leak)
 * Exemplo: alexandre@oaco.com.br -> al******@oaco.com.br
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const clean = email.trim();
  const atIndex = clean.indexOf('@');
  if (atIndex <= 1) return '***@' + (clean.slice(atIndex + 1) || 'email.com');
  
  const userPart = clean.slice(0, atIndex);
  const domainPart = clean.slice(atIndex + 1);
  
  let visibleLen = Math.min(2, Math.max(1, Math.floor(userPart.length / 3)));
  const maskedUser = userPart.slice(0, visibleLen) + '*'.repeat(Math.max(3, userPart.length - visibleLen));
  return `${maskedUser}@${domainPart}`;
}

/**
 * Validação de Formato de E-mail (RFC 5322 simplificado)
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return re.test(email.trim());
}

/**
 * Instancia o Transporter do Nodemailer com base nas variáveis de ambiente
 * Suporta tanto a convenção (SMTP_server, SMTP_login, SMTP_pass, SMTP_port, SMTP_from)
 * quanto a convenção (SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT, SMTP_FROM).
 */
function getTransporter() {
  const host = (process.env.SMTP_server || process.env.SMTP_SERVER || process.env.SMTP_HOST || process.env.SMTP_host || '').trim();
  const port = parseInt(process.env.SMTP_port || process.env.SMTP_PORT || '587', 10);
  const user = (process.env.SMTP_login || process.env.SMTP_LOGIN || process.env.SMTP_USER || process.env.SMTP_user || '').trim();
  const pass = (process.env.SMTP_pass || process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.SMTP_password || '').trim();
  const secure = process.env.SMTP_SECURE === 'true' || process.env.SMTP_secure === 'true' || port === 465;

  if (!host || !user || !pass) {
    return null; // SMTP não configurado (Modo Dev / Fallback Local)
  }

  return nodemailer.createTransport({
    host,
    port,
    secure, // false para 587 (usa STARTTLS), true para 465 (SSL direto)
    auth: {
      user,
      pass
    },
    tls: {
      rejectUnauthorized: false
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });
}

/**
 * Envia E-mail com o Código de 4 Dígitos de Autenticação em Dois Fatores (2FA)
 * @param {Object} params
 * @param {string} params.to - E-mail do destinatário
 * @param {string} params.code - Código numérico de 4 dígitos (ex: "7492")
 * @param {string} params.name - Nome do usuário
 * @param {string} params.username - Login do usuário
 * @param {string} [params.ip] - IP de origem da requisição
 */
async function send2FACodeEmail({ to, code, name, username, ip = '' }) {
  if (!to || !isValidEmail(to)) {
    return { success: false, error: 'E-mail de destinatário inválido ou ausente.' };
  }

  const cleanCode = String(code || '').trim();
  const userName = name || username || 'Usuário';
  const senderUser = (process.env.SMTP_login || process.env.SMTP_LOGIN || process.env.SMTP_USER || process.env.SMTP_user || 'nao-responda@oaco.com.br').trim();
  
  let rawFrom = (process.env.SMTP_from || process.env.SMTP_FROM || senderUser).trim();
  if (rawFrom && !rawFrom.includes('<') && isValidEmail(rawFrom)) {
    rawFrom = `"Plataforma GSI" <${rawFrom}>`;
  } else if (!rawFrom) {
    rawFrom = `"Plataforma GSI" <${senderUser}>`;
  }
  const fromAddress = rawFrom;

  const subject = `🔐 Seu Código de Acesso 2FA: ${cleanCode} — Plataforma GSI`;

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Código de Segurança 2FA</title>
      <style>
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; }
        .wrapper { width: 100%; max-width: 540px; margin: 24px auto; background-color: #1e293b; border-radius: 12px; border: 1px solid #334155; overflow: hidden; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4); }
        .header { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 24px 28px; border-bottom: 1px solid #334155; text-align: center; }
        .header h1 { margin: 0; font-size: 20px; font-weight: 700; color: #38bdf8; letter-spacing: -0.02em; }
        .header p { margin: 6px 0 0 0; font-size: 13px; color: #94a3b8; }
        .content { padding: 28px; }
        .greeting { font-size: 15px; color: #f8fafc; margin-bottom: 16px; line-height: 1.5; }
        .code-box { background: rgba(56, 189, 248, 0.08); border: 2px dashed #0284c7; border-radius: 10px; padding: 20px; text-align: center; margin: 24px 0; }
        .code-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #38bdf8; margin-bottom: 8px; }
        .code-number { font-family: 'Courier New', Courier, monospace; font-size: 42px; font-weight: 800; letter-spacing: 12px; color: #ffffff; margin: 0; text-shadow: 0 2px 10px rgba(56, 189, 248, 0.4); padding-left: 12px; }
        .warning-box { background: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 6px; font-size: 12.5px; color: #cbd5e1; line-height: 1.5; margin-bottom: 20px; }
        .footer { background-color: #0f172a; padding: 16px 28px; border-top: 1px solid #334155; font-size: 11.5px; color: #64748b; text-align: center; line-height: 1.5; }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="header">
          <h1>Plataforma de Apoio GSI</h1>
          <p>Multi-Empresas Protheus (OACO / GSI / Metal Pleno)</p>
        </div>
        <div class="content">
          <div class="greeting">
            Olá, <strong>${userName}</strong>,<br>
            Recebemos uma solicitação de login em sua conta (<code>${username}</code>). Use o código de 4 dígitos abaixo para autenticar seu acesso:
          </div>

          <div class="code-box">
            <div class="code-title">Seu Código de Acesso</div>
            <div class="code-number">${cleanCode}</div>
          </div>

          <div class="warning-box">
            ⏱️ <strong>Atenção:</strong> Este código é de uso único e expira em <strong>5 minutos</strong>.<br>
            Se você não tentou fazer login neste momento, altere sua senha imediatamente e contate o administrador.
          </div>

          ${ip ? `<div style="font-size: 11px; color: #64748b; margin-top: 8px;">Origem da solicitação: IP <code>${ip}</code></div>` : ''}
        </div>
        <div class="footer">
          Este é um e-mail automático gerado pelo módulo de segurança da Plataforma GSI.<br>
          Por favor, não responda a este e-mail.
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
Plataforma de Apoio GSI — Código de Autenticação 2FA

Olá, ${userName}!

Seu código de acesso em duas etapas (2FA) é: ${cleanCode}

Este código é de uso único e expira em 5 minutos.
Se você não solicitou este acesso, desconsidere este e-mail.
${ip ? `Origem da solicitação: IP ${ip}` : ''}
  `.trim();

  const transporter = getTransporter();

  if (!transporter) {
    // Ambiente de Desenvolvimento / Sem SMTP configurado no momento
    console.log('---------------------------------------------------------');
    console.log(`📨 [MAILER DEV/FALLBACK] Código 2FA para: ${to} (${userName})`);
    console.log(`🔑 CÓDIGO DE 4 DÍGITOS: [ ${cleanCode} ] (Válido por 5 minutos)`);
    console.log('---------------------------------------------------------');
    return {
      success: true,
      mode: 'dev_console',
      messageId: `dev-${Date.now()}-${cleanCode}`
    };
  }

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      text: textContent,
      html: htmlContent
    });

    console.log(`🟢 [Mailer] E-mail 2FA enviado com sucesso para ${maskEmail(to)} (MessageID: ${info.messageId})`);
    return {
      success: true,
      mode: 'smtp',
      messageId: info.messageId
    };
  } catch (err) {
    console.error(`❌ [Mailer Error] Falha ao enviar e-mail 2FA para ${to}:`, err.message);
    // Em caso de falha de conexão SMTP em produção, loga no console para não deixar o usuário travado
    console.log(`⚠️ [Mailer Fallback] Código 2FA gerado para ${to}: [ ${cleanCode} ]`);
    return {
      success: false,
      error: err.message,
      codeFallback: cleanCode
    };
  }
}

/**
 * Função de Diagnóstico e Teste de Conexão SMTP em Tempo Real
 */
async function testSmtpConnection(targetEmail) {
  const host = (process.env.SMTP_server || process.env.SMTP_SERVER || process.env.SMTP_HOST || process.env.SMTP_host || '').trim();
  const port = parseInt(process.env.SMTP_port || process.env.SMTP_PORT || '587', 10);
  const user = (process.env.SMTP_login || process.env.SMTP_LOGIN || process.env.SMTP_USER || process.env.SMTP_user || '').trim();
  const hasPass = Boolean((process.env.SMTP_pass || process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.SMTP_password || '').trim());
  const rawFrom = (process.env.SMTP_from || process.env.SMTP_FROM || user).trim();

  const diagnostic = {
    timestamp: new Date().toISOString(),
    config: {
      host: host || 'NÃO CONFIGURADO (process.env.SMTP_server)',
      port,
      user: user ? maskEmail(user) : 'NÃO CONFIGURADO (process.env.SMTP_login)',
      hasPassword: hasPass,
      from: rawFrom || 'NÃO CONFIGURADO (process.env.SMTP_from)'
    },
    transporterConfigured: false,
    verifySuccess: false,
    verifyMessage: '',
    sendTestSuccess: false,
    sendTestDetails: null,
    errorMessage: null
  };

  const transporter = getTransporter();
  if (!transporter) {
    diagnostic.errorMessage = 'Variáveis de SMTP incompletas no Render. Verifique SMTP_server, SMTP_login e SMTP_pass.';
    return diagnostic;
  }

  diagnostic.transporterConfigured = true;

  try {
    await transporter.verify();
    diagnostic.verifySuccess = true;
    diagnostic.verifyMessage = 'Conexão e Autenticação SMTP verificadas com sucesso!';
  } catch (vErr) {
    diagnostic.verifySuccess = false;
    diagnostic.verifyMessage = `Falha na verificação SMTP: ${vErr.message}`;
    diagnostic.errorMessage = vErr.message;
    return diagnostic;
  }

  if (targetEmail && isValidEmail(targetEmail)) {
    try {
      const fromAddr = rawFrom.includes('<') ? rawFrom : `"Plataforma GSI" <${rawFrom}>`;
      const info = await transporter.sendMail({
        from: fromAddr,
        to: targetEmail,
        subject: '🧪 Teste de Conexão SMTP — Plataforma GSI',
        text: 'Este é um e-mail de teste disparado pelo módulo de diagnóstico da Plataforma GSI.',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; background: #0f172a; color: #fff; border-radius: 8px;">
            <h2 style="color: #38bdf8;">✅ Teste de Conexão SMTP Bem-Sucedido!</h2>
            <p>O servidor SMTP está respondendo e disparou este e-mail com sucesso para <strong>${targetEmail}</strong>.</p>
            <p style="color: #94a3b8; font-size: 12px;">Data/Hora do Teste: ${new Date().toLocaleString('pt-BR')}</p>
          </div>
        `
      });

      diagnostic.sendTestSuccess = true;
      diagnostic.sendTestDetails = {
        messageId: info.messageId,
        response: info.response,
        accepted: info.accepted
      };
    } catch (sErr) {
      diagnostic.sendTestSuccess = false;
      diagnostic.errorMessage = `Erro ao disparar e-mail de teste: ${sErr.message}`;
    }
  }

  return diagnostic;
}

module.exports = {
  maskEmail,
  isValidEmail,
  send2FACodeEmail,
  testSmtpConnection
};
