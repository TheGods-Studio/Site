'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const fsp = require('fs/promises');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const EMAIL_DIR = path.join(DATA_DIR, 'emails');
const NODE_ENV = process.env.NODE_ENV || 'development';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_SECURE = process.env.SMTP_SECURE === 'true' || SMTP_PORT === 465;
const MAIL_FROM =
  process.env.MAIL_FROM || (SMTP_USER ? `The Gods Studio <${SMTP_USER}>` : 'The Gods Studio <no-reply@thegods.studio>');

let transporter = null;
if (SMTP_HOST) {
  if (!SMTP_USER || !SMTP_PASS) {
    console.warn(
      '[mailer] SMTP_HOST está definido mas SMTP_USER ou SMTP_PASS estão ausentes/vazios. ' +
        'O e-mail NÃO será enviado. Configure ambas as credenciais no .env.'
    );
    transporter = null;
  } else {
    try {
      const nodemailer = require('nodemailer');
      transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        connectionTimeout: 30000,
        greetingTimeout: 30000,
        socketTimeout: 60000,
        tls: {
          rejectUnauthorized: false,
          ciphers: 'DEFAULT',
        },
      });
      transporter.verify(function (err) {
        if (err) {
          console.error(
            '[mailer] Falha na verificacao SMTP: ' +
              (err && err.message ? err.message : 'erro desconhecido') +
              '. Verifique SMTP_HOST, SMTP_PORT, SMTP_USER e SMTP_PASS no .env. ' +
              'Para Gmail, use uma senha de app de 16 caracteres (nao a senha da conta).'
          );
          transporter = null;
        } else {
          console.log('[mailer] SMTP configurado e verificado (' + SMTP_HOST + ':' + SMTP_PORT + ', secure=' + SMTP_SECURE + ').');
        }
      });
    } catch (e) {
      console.error('[mailer] Falha ao configurar o transporter SMTP:', e && e.message);
      transporter = null;
    }
  }
} else {
  console.warn(
    '[mailer] SMTP não configurado. Em produção os e-mails NÃO serão entregues. ' +
      'Defina SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS. (modo dev salva em ' +
      EMAIL_DIR +
      ')'
  );
}

async function saveDevCopy({ to, subject, html }) {
  try {
    await fsp.mkdir(EMAIL_DIR, { recursive: true });
    const slug = (String(to) + '-' + String(subject)).replace(/[^a-z0-9]/gi, '_').slice(0, 70);
    const file = path.join(EMAIL_DIR, slug + '-' + Date.now() + '.html');
    await fsp.writeFile(file, html);
    return file;
  } catch (_) {
    return null;
  }
}

async function sendEmail({ to, subject, html, text }) {
  if (!to || !subject || !html) {
    return { ok: false, dev: false, error: 'Parâmetros incompletos (to, subject, html).' };
  }

  if (!transporter) {
    const file = await saveDevCopy({ to, subject, html });
    if (NODE_ENV === 'production') {
      return {
        ok: false,
        dev: true,
        error: 'Servidor de e-mail (SMTP) não configurado: o e-mail não foi entregue.',
      };
    }
    console.warn('\n====== [mailer] EMAIL (modo dev, NÃO entregue) ======');
    console.warn('Para  : ' + to);
    console.warn('Assunto: ' + subject);
    console.warn('Arquivo: ' + file);
    console.warn('======================================================\n');
    return { ok: true, dev: true, file };
  }

  try {
    const info = await transporter.sendMail({
      from: MAIL_FROM,
      to,
      subject,
      text: text || html,
      html,
    });
    if (info && Array.isArray(info.rejected) && info.rejected.length) {
      return { ok: false, dev: false, error: 'E-mail rejeitado pelo servidor: ' + info.rejected.join(', ') };
    }
    if (info && Array.isArray(info.accepted) && !info.accepted.length) {
      return { ok: false, dev: false, error: 'Nenhum destinatario aceito pelo servidor de e-mail.' };
    }
    return { ok: true, dev: false, messageId: info && info.messageId };
  } catch (e) {
    const errMsg = e && e.message ? e.message : 'erro desconhecido';
    console.error('[mailer] falha ao enviar via SMTP:', errMsg);
    let userMsg = 'Falha ao enviar o e-mail: ' + errMsg;
    if (/535/i.test(errMsg) || /auth/i.test(errMsg) || /bad.*user.*pass/i.test(errMsg)) {
      userMsg =
        'Falha ao enviar o e-mail: credenciais SMTP invalidas (535). ' +
        'Verifique SMTP_USER, SMTP_PASS, SMTP_HOST e SMTP_PORT no .env. ' +
        'Para Gmail, use uma senha de app de 16 caracteres, nao a senha da conta.';
    }
    return { ok: false, dev: false, error: userMsg };
  }
}

module.exports = { sendEmail, MAIL_FROM };