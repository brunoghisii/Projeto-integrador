export async function enviarCodigoMFA(destinatario: string, codigo: string, nome: string): Promise<void> {
  const user = process.env['EMAIL_USER'];
  const pass = process.env['EMAIL_PASS'];
  const semConfig = !user || !pass || pass === 'COLE_AQUI_A_SENHA_DE_APP_DO_GMAIL';

  console.log(`\n🔐 [MFA] Código para ${destinatario}: ${codigo}\n`);

  if (semConfig) return;

  try {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
        <div style="background:#046C4E;padding:28px 24px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:1.3rem;">Luana Damazio · Clínica</h1>
        </div>
        <div style="padding:36px 32px;text-align:center;">
          <h2 style="color:#065F46;font-size:1rem;margin:0 0 8px;">Olá, ${nome}!</h2>
          <p style="color:#4B5563;font-size:0.88rem;margin:0 0 24px;">Seu código de verificação:</p>
          <div style="background:#f0fdf4;border:2px dashed #6EE7B7;border-radius:12px;padding:18px 24px;display:inline-block;margin-bottom:24px;">
            <span style="font-size:2.2rem;font-weight:800;color:#046C4E;letter-spacing:10px;">${codigo}</span>
          </div>
          <p style="color:#9CA3AF;font-size:0.76rem;">Expira em <strong>5 minutos</strong>. Se não foi você, ignore.</p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"Luana Damazio - Clínica" <${user}>`,
      to: destinatario,
      subject: `${codigo} — Código de acesso ao sistema`,
      html,
      text: `Olá ${nome}! Seu código: ${codigo} (expira em 5 minutos)`,
    });
  } catch (err) {
    console.error('[MFA] Falha ao enviar email:', err instanceof Error ? err.message : err);
  }
}

/** Envia o link de redefinição de senha. Retorna false se o e-mail não estiver configurado ou falhar. */
export async function enviarLinkRedefinicaoSenha(destinatario: string, nome: string, link: string): Promise<boolean> {
  const user = process.env['EMAIL_USER'];
  const pass = process.env['EMAIL_PASS'];
  if (!user || !pass || pass === 'COLE_AQUI_A_SENHA_DE_APP_DO_GMAIL') {
    console.warn(`[Email] EMAIL_USER/EMAIL_PASS nao configurados: link de redefinicao para ${destinatario} nao enviado.`);
    return false;
  }

  try {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({ service: 'gmail', auth: { user, pass } });

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
        <div style="background:#046C4E;padding:28px 24px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:1.3rem;">Luana Damazio · Clínica</h1>
        </div>
        <div style="padding:36px 32px;text-align:center;">
          <h2 style="color:#065F46;font-size:1rem;margin:0 0 8px;">Olá, ${nome}!</h2>
          <p style="color:#4B5563;font-size:0.88rem;margin:0 0 24px;">Recebemos um pedido para redefinir a sua senha. Clique no botão abaixo para criar uma nova:</p>
          <a href="${link}" style="display:inline-block;background:#10B981;color:#fff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;">Redefinir senha</a>
          <p style="color:#9CA3AF;font-size:0.76rem;margin-top:24px;">O link expira em <strong>30 minutos</strong> e só pode ser usado uma vez. Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"Luana Damazio - Clínica" <${user}>`,
      to: destinatario,
      subject: 'Redefinição de senha — Luana Damazio Clínica',
      html,
      text: `Olá ${nome}! Para redefinir sua senha, acesse: ${link} (expira em 30 minutos). Se não foi você, ignore.`,
    });
    console.log(`[Email] Link de redefinicao enviado para ${destinatario}`);
    return true;
  } catch (err) {
    console.error('[Email] Falha ao enviar link de redefinicao:', err instanceof Error ? err.message : err);
    return false;
  }
}
