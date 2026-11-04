import nodemailer from 'nodemailer'
import { configError } from '../config/secrets.js'

export function smtpOptions(env = process.env) {
  const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASSWORD: pass, SMTP_FROM: from } = env
  const port = Number(env.SMTP_PORT || 587)
  if (!host || !/^[a-z0-9.-]+$/i.test(host) || ![465, 587].includes(port) || !user || !pass || !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63}$/i.test(from || '')) throw configError('SMTP')
  return { from, options: { host, port, secure: port === 465, requireTLS: true,
      auth: { user, pass }, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
      logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  } }
}
async function withTransport(options, createTransport, task, timeoutMs) {
  const transport = createTransport(options)
  let timer
  try {
    await Promise.race([
      task(transport),
      new Promise((_, reject) => { timer = setTimeout(() => { transport.close(); reject(Error('Delivery timeout')) }, timeoutMs) }),
    ])
  } finally { clearTimeout(timer); transport.close() }
}
export function createVerificationMailer(env = process.env, createTransport = nodemailer.createTransport, timeoutMs = 15000) {
  const { from, options } = smtpOptions(env)
  return async ({ email, language, url }) => {
    await withTransport(options, createTransport, transport => transport.sendMail({ from: { name: 'Sugar', address: from }, to: email,
          subject: language === 'en' ? 'Verify your email for Sugar' : 'Verifica tu correo para Sugar',
          text: language === 'en'
            ? `Open this link to choose your password and create your Sugar account. It expires in 30 minutes and works once.\n\n${url}\n\nIf you already have an account, sign in normally. If you did not request this message, ignore it.`
            : `Abre este enlace para elegir tu contraseña y crear tu cuenta de Sugar. Caduca en 30 minutos y solo funciona una vez.\n\n${url}\n\nSi ya tienes cuenta, entra normalmente. Si no solicitaste este mensaje, ignóralo.`,
        }), timeoutMs)
  }
}

export async function verifySmtp(env, createTransport = nodemailer.createTransport, timeoutMs = 15000) {
  await withTransport(smtpOptions(env).options, createTransport, transport => transport.verify(), timeoutMs)
}

export function createAccountMailer(env = process.env, createTransport = nodemailer.createTransport, timeoutMs = 15000) {
  const { from, options } = smtpOptions(env)
  return async ({ email, language, purpose, url, newEmail }) => {
    const en = language === 'en'
    const templates = {
      reset: [en ? 'Recover your Sugar account' : 'Recupera tu cuenta de Sugar', en ? 'Choose a new password using this link. Only active accounts with a verified email can recover access.' : 'Elige una contraseña nueva con este enlace. Solo las cuentas activas con correo verificado pueden recuperar el acceso.'],
      email_change: [en ? 'Confirm your Sugar email' : 'Confirma tu correo de Sugar', en ? 'Confirm this email using your current Sugar password. If changing a previously verified address, also confirm the message sent to that address.' : 'Confirma este correo con tu contraseña actual de Sugar. Si cambias una dirección ya verificada, confirma también el mensaje enviado a la dirección anterior.'],
      email_change_old: [en ? 'Authorize your Sugar email change' : 'Autoriza el cambio de correo de Sugar', en ? `A change to ${newEmail} was requested. Confirm only if you requested it, using your current Sugar password.` : `Se solicitó cambiar tu correo a ${newEmail}. Confirma solo si lo solicitaste, con tu contraseña actual de Sugar.`],
      password_changed: [en ? 'Your Sugar password changed' : 'Tu contraseña de Sugar cambió', en ? 'Your password changed and all sessions were closed. If you did not request this, contact the administrator of your installation.' : 'Tu contraseña cambió y todas las sesiones se cerraron. Si no lo solicitaste, contacta al responsable de tu instalación.'],
      email_changed: [en ? 'Your Sugar email was confirmed' : 'Tu correo de Sugar fue confirmado', en ? 'Your account email was confirmed or changed and all sessions were closed. If you did not request this, contact the administrator of your installation.' : 'El correo de tu cuenta fue confirmado o cambiado y todas las sesiones se cerraron. Si no lo solicitaste, contacta al responsable de tu instalación.'],
    }
    const template = templates[purpose]
    if (!template) throw configError('MAIL_PURPOSE')
    const text = template[1] + (url ? (en ? '\n\nThis link expires in 15 minutes and works once.\n' : '\n\nEste enlace caduca en 15 minutos y solo funciona una vez.\n') + url : '')
    await withTransport(options, createTransport, transport => transport.sendMail({ from: { name: 'Sugar', address: from }, to: email, subject: template[0], text }), timeoutMs)
  }
}
