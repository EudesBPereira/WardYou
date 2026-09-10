import type { FastifyInstance } from "fastify";

/**
 * Landing publica do convite de familia.
 *
 * Existe porque o link que ia no WhatsApp apontava para `app.wardyou.com`, que
 * NAO tem DNS — ou seja, todo convite compartilhado levava a lugar nenhum. Esta
 * pagina roda no proprio dominio da API, entao o link funciona hoje, sem
 * depender de infra que ainda nao existe. Quando o dominio proprio subir, basta
 * apontar `INVITE_BASE_URL` para la e nada mais muda.
 *
 * Nao valida o codigo de proposito: validar exigiria expor se um convite existe
 * para quem so tem o link, o que vaza informacao sobre familias alheias. Quem
 * decide e o app, ja autenticado.
 */
export async function registerJoinRoutes(app: FastifyInstance) {
  app.get("/join", async (request, reply) => {
    const query = request.query as { familyInvite?: string; code?: string };
    const raw = (query.familyInvite ?? query.code ?? "").trim().toUpperCase();
    // So o alfabeto usado na geracao (CODE_ALPHABET) — evita refletir HTML.
    const code = /^[A-Z0-9]{4,16}$/.test(raw) ? raw : "";
    reply.type("text/html; charset=utf-8");
    return page(code);
  });

  // Forma de caminho: /join/CODE
  app.get("/join/:code", async (request, reply) => {
    const { code: raw } = request.params as { code: string };
    const code = /^[A-Z0-9]{4,16}$/.test((raw ?? "").toUpperCase()) ? raw.toUpperCase() : "";
    reply.type("text/html; charset=utf-8");
    return page(code);
  });
}

function page(code: string): string {
  const deepLink = code ? `wardyou://join/${code}` : "wardyou://join";
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Convite WardYou</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #F4F7F8; color: #0B1F33; padding: 24px;
    font-family: -apple-system, "Segoe UI", Roboto, system-ui, sans-serif;
  }
  .card {
    background: #fff; border: 1px solid #DCE4E7; border-radius: 16px;
    padding: 32px 24px; max-width: 380px; width: 100%; text-align: center;
    box-shadow: 0 8px 24px -12px rgba(11,31,51,.18);
  }
  .shield { width: 56px; height: 56px; margin: 0 auto 20px; display: block; }
  h1 { font-size: 21px; margin: 0 0 8px; letter-spacing: -.01em; }
  p { color: #5A6B7B; font-size: 15px; line-height: 1.55; margin: 0 0 24px; }
  .rotulo {
    font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
    color: #8A99A6; font-weight: 600; margin-bottom: 8px;
  }
  .codigo {
    font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
    font-size: 30px; font-weight: 700; letter-spacing: .12em; color: #0B1F33;
    background: #EAF0F1; border-radius: 12px; padding: 16px 12px;
    margin-bottom: 20px; user-select: all; -webkit-user-select: all; word-break: break-all;
  }
  a.botao {
    display: block; background: #1875BE; color: #fff; text-decoration: none;
    font-weight: 600; font-size: 16px; padding: 15px; border-radius: 12px;
  }
  .ajuda { font-size: 13px; color: #8A99A6; margin: 18px 0 0; }
</style>
</head>
<body>
  <div class="card">
    <svg class="shield" viewBox="0 0 34 38" fill="none" aria-hidden="true">
      <path d="M17 2 3 8v11c0 8.4 5.8 15 14 17 8.2-2 14-8.6 14-17V8L17 2Z" fill="#1875BE"/>
      <path d="M17 2 3 8v11c0 8.4 5.8 15 14 17V2Z" fill="#77CCDE"/>
      <path d="M11 15.5l4.2 6 7-9" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <h1>Convite para uma fam&iacute;lia no WardYou</h1>
    <p>Abra o app e entre com o c&oacute;digo abaixo.</p>
    ${code ? `<div class="rotulo">Seu c&oacute;digo</div><div class="codigo">${code}</div>` : ""}
    <a class="botao" href="${deepLink}">Abrir no WardYou</a>
    <p class="ajuda">N&atilde;o tem o app? Instale o WardYou e use o c&oacute;digo acima em<br>Fam&iacute;lia &rarr; Entrar com c&oacute;digo.</p>
  </div>
</body>
</html>`;
}
