// Garante que o e-mail de proposta não chega duplicado (Para = Cc, ou Cc repetido). Nada é enviado: nodemailer é interceptado.
const assert = require('assert');
const nodemailer = require('nodemailer');

process.env.SMTP_server = 'smtp.teste.local';
process.env.SMTP_login = 'usuario-teste';
process.env.SMTP_pass = 'senha-teste';

let enviado = null;
nodemailer.createTransport = () => ({ sendMail: async (opts) => { enviado = opts; return { messageId: 'teste' }; } });

const { sendPropostaEmail } = require('./mailer');
const anexo = { filename: 'p.pdf', contentBase64: Buffer.from('x').toString('base64') };

(async () => {
  // Vendedor é o próprio destinatário e também vai em cópia (caso real da proposta 1055-R1)
  await sendPropostaEmail({ to: 'vendedor@exemplo.com.br', cc: ['VENDEDOR@exemplo.com.br'], replyTo: 'vendedor@exemplo.com.br', subject: 's', text: 't', attachment: anexo });
  assert.strictEqual(enviado.to, 'vendedor@exemplo.com.br');
  assert.strictEqual(enviado.cc, undefined, 'Cc igual ao Para deve sair');

  // Cc repetido some, Cc diferente fica
  await sendPropostaEmail({ to: 'cliente@exemplo.com.br', cc: 'vendedor@exemplo.com.br; Vendedor@exemplo.com.br, gerente@exemplo.com.br', replyTo: 'vendedor@exemplo.com.br', subject: 's', text: 't', attachment: anexo });
  assert.strictEqual(enviado.cc, 'vendedor@exemplo.com.br, gerente@exemplo.com.br');

  console.log('OK test_mailer_proposta_cc: Cc sem duplicados');
})().catch(err => { console.error(err); process.exit(1); });
