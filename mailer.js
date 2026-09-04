const nodemailer = require('nodemailer');
const https = require('https');

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
 * Envia E-mail via API REST HTTP do Mailjet (Porta 443 HTTPS - imune a bloqueios de portas SMTP em nuvem)
 */
function sendViaMailjetHttpApi({ apiKey, secretKey, fromEmail, fromName, toEmail, toName, subject, text, html }) {
  return new Promise((resolve, reject) => {
    const authHeader = 'Basic ' + Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
    const payload = JSON.stringify({
      Messages: [
        {
          From: {
            Email: fromEmail,
            Name: fromName || 'Plataforma GSI'
          },
          To: [
            {
              Email: toEmail,
              Name: toName || 'Usuário'
            }
          ],
          Subject: subject,
          TextPart: text,
          HTMLPart: html
        }
      ]
    });

    const options = {
      hostname: 'api.mailjet.com',
      port: 443,
      path: '/v3.1/send',
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 12000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const msgInfo = (json.Messages && json.Messages[0]) || {};
            if (msgInfo.Status === 'success' || msgInfo.Status === 'queued' || (msgInfo.To && msgInfo.To.length > 0)) {
              resolve({
                success: true,
                mode: 'mailjet_http_api_443',
                messageId: (msgInfo.To && msgInfo.To[0] && msgInfo.To[0].MessageID) || 'mj-' + Date.now(),
                response: json
              });
            } else {
              const errDetail = (msgInfo.Errors && msgInfo.Errors.map(e => e.ErrorMessage).join('; ')) || 'Status não-sucesso retornado pelo Mailjet';
              reject(new Error(`Mailjet API erro no envio: ${errDetail}`));
            }
          } else {
            const errDetail = json.ErrorMessage || json.message || data;
            reject(new Error(`Mailjet API HTTP ${res.statusCode}: ${errDetail}`));
          }
        } catch (e) {
          reject(new Error(`Mailjet API resposta inválida: ${data}`));
        }
      });
    });

    req.on('error', err => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout ao conectar na API HTTP do Mailjet'));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Instancia o Transporter do Nodemailer com base nas variáveis de ambiente
 */
function getTransporter() {
  const host = (process.env.SMTP_server || process.env.SMTP_SERVER || process.env.SMTP_HOST || process.env.SMTP_host || '').trim();
  const port = parseInt(process.env.SMTP_port || process.env.SMTP_PORT || '587', 10);
  const user = (process.env.SMTP_login || process.env.SMTP_LOGIN || process.env.SMTP_USER || process.env.SMTP_user || '').trim();
  const pass = (process.env.SMTP_pass || process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.SMTP_password || '').trim();
  const rawSecure = String(process.env.SMTP_SECURE || process.env.SMTP_secure || '').trim().toLowerCase();
  const secure = ['true', 'ssl', 'tls', '1', 'yes'].includes(rawSecure) || port === 465;

  if (!host || !user || !pass) {
    return null; // SMTP não configurado (Modo Dev / Fallback Local)
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass
    },
    tls: {
      rejectUnauthorized: false
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
}

/**
 * Envia E-mail com o Código de 4 Dígitos de Autenticação em Dois Fatores (2FA)
 */
async function send2FACodeEmail({ to, code, name, username, ip = '' }) {
  if (!to || !isValidEmail(to)) {
    return { success: false, error: 'E-mail de destinatário inválido ou ausente.' };
  }

  const cleanCode = String(code || '').trim();
  const userName = name || username || 'Usuário';
  const senderUser = (process.env.SMTP_login || process.env.SMTP_LOGIN || process.env.SMTP_USER || process.env.SMTP_user || 'nao-responda@oaco.com.br').trim();
  
  let rawFrom = (process.env.SMTP_from || process.env.SMTP_FROM || senderUser).trim();
  let fromEmailOnly = rawFrom;
  let fromNameOnly = 'Plataforma de Apoio GSI';

  if (rawFrom.includes('<') && rawFrom.includes('>')) {
    const match = rawFrom.match(/^(.*?)\s*<([^>]+)>/);
    if (match) {
      fromNameOnly = match[1].replace(/["']/g, '').trim() || fromNameOnly;
      fromEmailOnly = match[2].trim();
    }
  }

  const fromAddress = rawFrom.includes('<') ? rawFrom : `"${fromNameOnly}" <${fromEmailOnly}>`;
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

  const host = (process.env.SMTP_server || process.env.SMTP_SERVER || process.env.SMTP_HOST || process.env.SMTP_host || '').trim();
  const apiKey = (process.env.SMTP_login || process.env.SMTP_LOGIN || process.env.SMTP_USER || process.env.SMTP_user || '').trim();
  const secretKey = (process.env.SMTP_pass || process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.SMTP_password || '').trim();

  // 1. Se configurado com Mailjet, prioriza a API REST HTTP (Porta 443 HTTPS imune a bloqueios de nuvem)
  if (host.includes('mailjet') && apiKey && secretKey) {
    try {
      const httpRes = await sendViaMailjetHttpApi({
        apiKey,
        secretKey,
        fromEmail: fromEmailOnly,
        fromName: fromNameOnly,
        toEmail: to,
        toName: userName,
        subject,
        text: textContent,
        html: htmlContent
      });

      console.log(`🟢 [Mailer HTTP API] E-mail 2FA enviado com sucesso para ${maskEmail(to)} via Mailjet (ID: ${httpRes.messageId})`);
      return httpRes;
    } catch (httpErr) {
      console.warn(`⚠️ [Mailer HTTP Warning] Falha na API HTTP do Mailjet (${httpErr.message}). Tentando fallback SMTP...`);
    }
  }

  // 2. Transporter Nodemailer (SMTP clássico)
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

    console.log(`🟢 [Mailer SMTP] E-mail 2FA enviado com sucesso para ${maskEmail(to)} (MessageID: ${info.messageId})`);
    return {
      success: true,
      mode: 'smtp',
      messageId: info.messageId
    };
  } catch (err) {
    console.error(`❌ [Mailer Error] Falha ao enviar e-mail 2FA para ${to}:`, err.message);
    console.log(`⚠️ [Mailer Fallback] Código 2FA gerado para ${to}: [ ${cleanCode} ]`);
    return {
      success: false,
      error: err.message,
      codeFallback: cleanCode
    };
  }
}

/**
 * Função de Diagnóstico e Teste de Conexão SMTP / Mailjet HTTP API em Tempo Real
 */
async function testSmtpConnection(targetEmail) {
  const host = (process.env.SMTP_server || process.env.SMTP_SERVER || process.env.SMTP_HOST || process.env.SMTP_host || '').trim();
  const port = parseInt(process.env.SMTP_port || process.env.SMTP_PORT || '587', 10);
  const user = (process.env.SMTP_login || process.env.SMTP_LOGIN || process.env.SMTP_USER || process.env.SMTP_user || '').trim();
  const hasPass = Boolean((process.env.SMTP_pass || process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.SMTP_password || '').trim());
  const rawFrom = (process.env.SMTP_from || process.env.SMTP_FROM || user).trim();

  let fromEmailOnly = rawFrom;
  let fromNameOnly = 'Plataforma de Apoio GSI';
  if (rawFrom.includes('<') && rawFrom.includes('>')) {
    const match = rawFrom.match(/^(.*?)\s*<([^>]+)>/);
    if (match) {
      fromNameOnly = match[1].replace(/["']/g, '').trim() || fromNameOnly;
      fromEmailOnly = match[2].trim();
    }
  }

  const diagnostic = {
    timestamp: new Date().toISOString(),
    config: {
      host: host || 'NÃO CONFIGURADO (process.env.SMTP_server)',
      port,
      user: user ? maskEmail(user) : 'NÃO CONFIGURADO (process.env.SMTP_login)',
      hasPassword: hasPass,
      from: rawFrom || 'NÃO CONFIGURADO (process.env.SMTP_from)',
      driver: host.includes('mailjet') ? 'Mailjet HTTP API (HTTPS 443) + Fallback SMTP' : 'SMTP Nodemailer'
    },
    transporterConfigured: Boolean(host && user && hasPass),
    verifySuccess: false,
    verifyMessage: '',
    sendTestSuccess: false,
    sendTestDetails: null,
    errorMessage: null
  };

  if (!host || !user || !hasPass) {
    diagnostic.errorMessage = 'Variáveis incompletas no Render. Verifique SMTP_server, SMTP_login e SMTP_pass.';
    return diagnostic;
  }

  // Se for Mailjet, testa disparo direto via API HTTPS (Porta 443)
  if (host.includes('mailjet')) {
    diagnostic.verifySuccess = true;
    diagnostic.verifyMessage = 'Driver Mailjet HTTP API (HTTPS 443) ativo!';

    if (targetEmail && isValidEmail(targetEmail)) {
      try {
        const httpRes = await sendViaMailjetHttpApi({
          apiKey: user,
          secretKey: (process.env.SMTP_pass || process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.SMTP_password || '').trim(),
          fromEmail: fromEmailOnly,
          fromName: fromNameOnly,
          toEmail: targetEmail,
          toName: 'Teste GSI',
          subject: '🧪 Teste de Conexão Mailjet HTTP API — Plataforma GSI',
          text: 'Teste de envio via Mailjet REST API HTTPS na Plataforma GSI.',
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; background: #0f172a; color: #fff; border-radius: 8px;">
              <h2 style="color: #38bdf8;">✅ Teste Mailjet HTTP API Bem-Sucedido!</h2>
              <p>O envio via API REST HTTPS (Porta 443) funcionou com sucesso para <strong>${targetEmail}</strong>.</p>
              <p style="color: #94a3b8; font-size: 12px;">Data/Hora do Teste: ${new Date().toLocaleString('pt-BR')}</p>
            </div>
          `
        });

        diagnostic.sendTestSuccess = true;
        diagnostic.sendTestDetails = httpRes;
      } catch (httpErr) {
        diagnostic.sendTestSuccess = false;
        diagnostic.errorMessage = httpErr.message;
      }
    }

    return diagnostic;
  }

  // Outros provedores via SMTP clássico
  const transporter = getTransporter();
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

/**
 * Envia E-mail de Alerta Administrativo / Operacional (Erros de Integração, APIs, etc.)
 */
async function sendAlertEmail({ to, subject, title, message, details = {}, html, text }) {
  const targetEmail = (to || process.env.ALERT_EMAIL || process.env.ADMIN_EMAIL || 'alexandre@oaco.com.br').trim();
  if (!targetEmail || !isValidEmail(targetEmail)) {
    return { success: false, error: 'E-mail de destinatário inválido ou ausente.' };
  }

  const host = (process.env.SMTP_server || process.env.SMTP_SERVER || process.env.SMTP_HOST || process.env.SMTP_host || '').trim();
  const apiKey = (process.env.SMTP_login || process.env.SMTP_LOGIN || process.env.SMTP_USER || process.env.SMTP_user || '').trim();
  const secretKey = (process.env.SMTP_pass || process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.SMTP_password || '').trim();
  const senderUser = apiKey || 'nao-responda@oaco.com.br';

  let rawFrom = (process.env.SMTP_from || process.env.SMTP_FROM || senderUser).trim();
  let fromEmailOnly = rawFrom;
  let fromNameOnly = 'Plataforma de Apoio GSI - Alertas';

  if (rawFrom.includes('<') && rawFrom.includes('>')) {
    const match = rawFrom.match(/^(.*?)\s*<([^>]+)>/);
    if (match) {
      fromNameOnly = match[1].replace(/["']/g, '').trim() || fromNameOnly;
      fromEmailOnly = match[2].trim();
    }
  }

  const fromAddress = rawFrom.includes('<') ? rawFrom : `"${fromNameOnly}" <${fromEmailOnly}>`;
  const emailSubject = subject || '🚨 [Alerta Gemini-Cli] Notificação do Sistema';

  // Constrói tabela HTML para os detalhes
  let detailsHtml = '';
  if (details && typeof details === 'object' && Object.keys(details).length > 0) {
    detailsHtml = `
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: rgba(15, 23, 42, 0.6); border-radius: 8px; overflow: hidden;">
        <tbody>
          ${Object.entries(details).map(([k, v]) => `
            <tr style="border-bottom: 1px solid #334155;">
              <td style="padding: 10px 14px; font-weight: 600; color: #94a3b8; font-size: 13px; width: 35%;">${k}</td>
              <td style="padding: 10px 14px; color: #f8fafc; font-size: 13px; font-family: monospace;">${v}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  const htmlContent = html || `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <style>
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; }
        .wrapper { width: 100%; max-width: 580px; margin: 24px auto; background-color: #1e293b; border-radius: 12px; border: 1px solid #334155; overflow: hidden; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4); }
        .header { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 20px 24px; border-bottom: 1px solid #334155; }
        .header h1 { margin: 0; font-size: 18px; font-weight: 700; color: #f87171; letter-spacing: -0.02em; }
        .header p { margin: 4px 0 0 0; font-size: 12px; color: #94a3b8; }
        .content { padding: 24px; }
        .alert-box { background: rgba(239, 68, 68, 0.12); border-left: 4px solid #ef4444; padding: 14px 18px; border-radius: 6px; font-size: 14px; color: #fecaca; line-height: 1.5; margin-bottom: 18px; }
        .footer { background-color: #0f172a; padding: 14px 24px; border-top: 1px solid #334155; font-size: 11px; color: #64748b; text-align: center; }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="header">
          <h1>🚨 ${title || 'Alerta de Integração do Sistema'}</h1>
          <p>Plataforma de Apoio GSI (Gemini-Cli)</p>
        </div>
        <div class="content">
          <div class="alert-box">
            <strong>${title || 'Atenção Necessária'}:</strong><br>
            ${message || 'Ocorreu um evento crítico no processamento de integrações.'}
          </div>
          ${detailsHtml}
          <div style="font-size: 12px; color: #94a3b8; margin-top: 16px;">
            Horário do Evento: <strong>${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Horário de Brasília)</strong>
          </div>
        </div>
        <div class="footer">
          Notificação automática gerada pelo servidor Gemini-Cli. Por favor, não responda a este e-mail.
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = text || `
[ALERTA GEMINI-CLI] ${title || 'Notificação do Sistema'}
${message || ''}

Detalhes:
${Object.entries(details).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

Data: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
  `.trim();

  // 1. Mailjet REST API (HTTPS 443)
  if (host.includes('mailjet') && apiKey && secretKey) {
    try {
      const httpRes = await sendViaMailjetHttpApi({
        apiKey,
        secretKey,
        fromEmail: fromEmailOnly,
        fromName: fromNameOnly,
        toEmail: targetEmail,
        toName: 'Administrador',
        subject: emailSubject,
        text: textContent,
        html: htmlContent
      });
      console.log(`🟢 [Mailer Alert] Alerta enviado para ${maskEmail(targetEmail)} via Mailjet (ID: ${httpRes.messageId})`);
      return httpRes;
    } catch (httpErr) {
      console.warn(`⚠️ [Mailer Alert Warning] Falha na API HTTP do Mailjet (${httpErr.message}). Tentando SMTP...`);
    }
  }

  // 2. Fallback Nodemailer SMTP
  const transporter = getTransporter();
  if (!transporter) {
    console.log('---------------------------------------------------------');
    console.log(`🚨 [MAILER ALERT DEV] Alerta para: ${targetEmail}`);
    console.log(`Assunto: ${emailSubject}`);
    console.log(`Mensagem: ${message}`);
    console.log('---------------------------------------------------------');
    return {
      success: true,
      mode: 'dev_console',
      messageId: `dev-alert-${Date.now()}`
    };
  }

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: targetEmail,
      subject: emailSubject,
      text: textContent,
      html: htmlContent
    });
    console.log(`🟢 [Mailer Alert SMTP] Alerta enviado para ${maskEmail(targetEmail)} (MessageID: ${info.messageId})`);
    return {
      success: true,
      mode: 'smtp',
      messageId: info.messageId
    };
  } catch (err) {
    console.error(`❌ [Mailer Alert Error] Falha ao enviar alerta para ${targetEmail}:`, err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

module.exports = {
  maskEmail,
  isValidEmail,
  send2FACodeEmail,
  sendAlertEmail,
  testSmtpConnection
};
