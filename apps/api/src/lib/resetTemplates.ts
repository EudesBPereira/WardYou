// Branded HTML for the password-reset email and the self-served reset page.
// Kept dependency-free (plain template strings). The page submits via fetch so
// the API needs no form-body parser.

const NAVY = "#0B1F33";
const BRAND = "#1E88C7";
const TEAL = "#77CCDE";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

export function resetPasswordEmail(name: string, link: string): { subject: string; html: string; text: string } {
  const safeName = escapeHtml(name?.split(" ")[0] || "");
  const subject = "Redefinição de senha — WardYou";
  const text =
    `Olá${safeName ? " " + safeName : ""},\n\n` +
    `Recebemos um pedido para redefinir a senha da sua conta WardYou.\n` +
    `Abra o link abaixo para criar uma nova senha (válido por 30 minutos):\n\n${link}\n\n` +
    `Se você não pediu isso, ignore este e-mail — sua senha continua a mesma.`;
  const html = `<!doctype html><html><body style="margin:0;background:#EEF3F6;font-family:Segoe UI,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:${NAVY};padding:28px 32px;">
          <span style="color:#fff;font-size:22px;font-weight:700;letter-spacing:.5px;">wardyou</span>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:${NAVY};">Redefinir sua senha</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#40505C;">
            Olá${safeName ? " " + safeName : ""}, recebemos um pedido para redefinir a senha da sua conta WardYou.
            Toque no botão abaixo para criar uma nova senha. O link é válido por <strong>30 minutos</strong>.
          </p>
          <a href="${link}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-size:15px;font-weight:600;">Criar nova senha</a>
          <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#8494A0;">
            Se você não fez esse pedido, ignore este e-mail — sua senha continua a mesma.
          </p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:12px;color:#A6B4BE;">WardYou — segurança e proteção familiar</p>
    </td></tr>
  </table></body></html>`;
  return { subject, html, text };
}

function shell(bodyInner: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Redefinir senha — WardYou</title></head>
  <body style="margin:0;background:#EEF3F6;font-family:Segoe UI,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;">
    <div style="width:100%;max-width:400px;background:#fff;border-radius:20px;padding:32px;box-shadow:0 10px 40px rgba(11,31,51,.12);">
      <div style="text-align:center;margin-bottom:8px;color:${NAVY};font-size:26px;font-weight:800;letter-spacing:.5px;">wardyou</div>
      ${bodyInner}
    </div>
  </body></html>`;
}

export function resetPage(token: string): string {
  return shell(`
    <h1 style="font-size:19px;color:${NAVY};text-align:center;margin:8px 0 4px;">Criar nova senha</h1>
    <p style="font-size:14px;color:#64727C;text-align:center;margin:0 0 20px;">Escolha uma senha com pelo menos 8 caracteres.</p>
    <form id="f" onsubmit="return false;">
      <input id="p1" type="password" placeholder="Nova senha" autocomplete="new-password"
        style="width:100%;box-sizing:border-box;padding:14px;border:1px solid #D6DEE4;border-radius:12px;font-size:15px;margin-bottom:12px;">
      <input id="p2" type="password" placeholder="Confirmar senha" autocomplete="new-password"
        style="width:100%;box-sizing:border-box;padding:14px;border:1px solid #D6DEE4;border-radius:12px;font-size:15px;margin-bottom:8px;">
      <div id="msg" style="min-height:18px;font-size:13px;color:#D14343;margin-bottom:8px;"></div>
      <button id="b" type="submit"
        style="width:100%;padding:14px;background:${BRAND};color:#fff;border:0;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;">
        Redefinir senha</button>
    </form>
    <script>
      var token=${JSON.stringify(token)};
      var f=document.getElementById('f'),b=document.getElementById('b'),msg=document.getElementById('msg');
      f.addEventListener('submit',async function(){
        var p1=document.getElementById('p1').value,p2=document.getElementById('p2').value;
        msg.textContent='';
        if(p1.length<8){msg.textContent='A senha deve ter ao menos 8 caracteres.';return;}
        if(p1!==p2){msg.textContent='As senhas não coincidem.';return;}
        b.disabled=true;b.textContent='Salvando...';
        try{
          var r=await fetch('/api/v1/auth/reset-password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:token,password:p1})});
          document.open();document.write(await r.text());document.close();
        }catch(e){b.disabled=false;b.textContent='Redefinir senha';msg.textContent='Erro de conexão. Tente novamente.';}
      });
    </script>`);
}

export function resetResultPage(kind: "success" | "invalid" | "error"): string {
  const map = {
    success: { c: TEAL, t: "Senha redefinida!", m: "Sua senha foi alterada. Volte ao app WardYou e entre com a nova senha." },
    invalid: { c: "#D14343", t: "Link inválido ou expirado", m: "Este link de redefinição não é mais válido. Peça um novo no app, em “Esqueceu a senha?”." },
    error: { c: "#D14343", t: "Algo deu errado", m: "Não foi possível redefinir a senha. Tente novamente." },
  }[kind];
  return shell(`
    <div style="text-align:center;">
      <div style="width:56px;height:56px;border-radius:50%;background:${map.c}22;margin:12px auto 16px;line-height:56px;font-size:28px;color:${map.c};">${kind === "success" ? "✓" : "!"}</div>
      <h1 style="font-size:19px;color:${NAVY};margin:0 0 8px;">${map.t}</h1>
      <p style="font-size:14px;color:#64727C;margin:0;line-height:1.6;">${map.m}</p>
    </div>`);
}
