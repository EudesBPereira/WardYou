import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { users as User } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { env } from "../env.js";
import { accessTokenExpiresAt } from "../lib/tokens.js";
import { issueExternalAuthCode, takeExternalAuthCode } from "../lib/externalAuthCodes.js";
import { createResetToken, peekResetToken, consumeResetToken } from "../lib/passwordReset.js";
import { sendEmail } from "../lib/mailer.js";
import { resetPasswordEmail, resetPage, resetResultPage } from "../lib/resetTemplates.js";
import * as authService from "../services/authService.js";
import { writeAudit } from "../services/auditService.js";

const APP_AUTH_CALLBACK = "wardyou://auth/callback";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * Resolve where to hand the one-time auth code back to. Only ever a URL from the
 * allowlist — echoing back an arbitrary caller-supplied `returnTo` would be an
 * open redirect that leaks the auth code to an attacker's site.
 */
function safeReturnTo(candidate?: string | null): string {
  if (!candidate) return APP_AUTH_CALLBACK;
  const allowed = env.OAUTH_REDIRECT_ALLOWLIST.split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes(candidate) ? candidate : APP_AUTH_CALLBACK;
}

/** Carry the return URL through Google in `state` (it round-trips untouched). */
function encodeState(returnTo: string): string {
  const payload = JSON.stringify({ n: randomBytes(8).toString("hex"), r: returnTo });
  return Buffer.from(payload).toString("base64url");
}

function decodeState(state?: string): string {
  if (!state) return APP_AUTH_CALLBACK;
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString()) as { r?: string };
    // Re-validate: `state` came back over the wire, so treat it as untrusted.
    return safeReturnTo(parsed.r);
  } catch {
    return APP_AUTH_CALLBACK;
  }
}

function withParam(url: string, key: string, value: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

const registerSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().min(1),
  phoneNumber: z.string().optional(),
  password: z.string().min(1),
  confirmPassword: z.string().min(1),
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const logoutSchema = z.object({ refreshToken: z.string().min(1) });
const registerDeviceSchema = z.object({
  deviceName: z.string().min(1),
  platform: z.string().min(1),
  pushToken: z.string().optional(),
  publicKey: z.string().optional(),
});

/** Same wire shape as Wityu.Contracts.Auth.AuthResponse (and the mobile type). */
function buildAuthResponse(
  app: FastifyInstance,
  result: { user: User; refreshToken: string; refreshTokenExpiresAt: Date },
) {
  const { user } = result;
  const accessToken = app.jwt.sign(
    { sub: user.Id, email: user.Email, name: user.FullName },
    { expiresIn: `${env.ACCESS_TOKEN_MINUTES}m` },
  );
  return {
    userId: user.Id,
    fullName: user.FullName,
    email: user.Email,
    accessToken,
    refreshToken: result.refreshToken,
    accessTokenExpiresAt: accessTokenExpiresAt().toISOString(),
    refreshTokenExpiresAt: result.refreshTokenExpiresAt.toISOString(),
    avatarUrl: user.AvatarUrl ?? null,
  };
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Payload de login inválido." });
    const result = await authService.login(parsed.data);
    await writeAudit({ actorUserId: result.user.Id, action: "UserLoggedIn", sourceType: "Auth", targetUserId: result.user.Id });
    return reply.send(buildAuthResponse(app, result));
  });

  app.post("/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Payload de cadastro inválido." });
    const result = await authService.register(parsed.data);
    await writeAudit({ actorUserId: result.user.Id, action: "UserRegistered", sourceType: "Auth", targetUserId: result.user.Id });
    return reply.code(201).send(buildAuthResponse(app, result));
  });

  app.post("/refresh-token", async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Refresh token inválido." });
    const result = await authService.refresh(parsed.data);
    return reply.send(buildAuthResponse(app, result));
  });

  app.post("/logout", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = logoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Refresh token inválido." });
    await authService.logout(request.user.sub, parsed.data.refreshToken);
    return reply.code(204).send();
  });

  app.post("/register-device", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = registerDeviceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Payload de dispositivo inválido." });
    const result = await authService.registerDevice(request.user.sub, parsed.data);
    return reply.code(201).send(result);
  });

  // --- Password reset (email a link to a self-served reset page) ---
  const forgotSchema = z.object({ email: z.string().min(1) });

  function apiBase(request: { protocol: string; headers: { host?: string } }): string {
    return env.PUBLIC_API_URL?.replace(/\/$/, "") ?? `${request.protocol}://${request.headers.host}`;
  }

  // POST /forgot-password — always 200 (never reveal whether the email exists).
  app.post("/forgot-password", async (request, reply) => {
    const parsed = forgotSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "E-mail inválido." });
    const user = await authService.findActiveUserByEmail(parsed.data.email);
    if (user) {
      const token = createResetToken(user.Id);
      const link = `${apiBase(request)}/api/v1/auth/reset-password?token=${token}`;
      await sendEmail({ to: user.Email, ...resetPasswordEmail(user.FullName, link) });
      await writeAudit({ actorUserId: user.Id, action: "PasswordResetRequested", sourceType: "Auth", targetUserId: user.Id });
    }
    return reply.send({ message: "Se o e-mail existir, enviaremos um link de redefinição." });
  });

  // GET /reset-password?token= — the self-served page where the user sets a new
  // password (opened from the email link; works in any browser).
  app.get<{ Querystring: { token?: string } }>("/reset-password", async (request, reply) => {
    const token = request.query.token ?? "";
    const valid = token && peekResetToken(token);
    reply.type("text/html");
    if (!valid) return reply.send(resetResultPage("invalid"));
    return reply.send(resetPage(token));
  });

  // POST /reset-password — process the form (or JSON) and update the password.
  app.post("/reset-password", async (request, reply) => {
    const body = z
      .object({ token: z.string().min(1), password: z.string().min(8) })
      .safeParse(request.body);
    reply.type("text/html");
    if (!body.success) return reply.code(400).send(resetResultPage("error"));
    const userId = consumeResetToken(body.data.token);
    if (!userId) return reply.code(400).send(resetResultPage("invalid"));
    await authService.resetPassword(userId, body.data.password);
    await writeAudit({ actorUserId: userId, action: "PasswordReset", sourceType: "Auth", targetUserId: userId });
    return reply.send(resetResultPage("success"));
  });

  // --- Google Sign-In (server-side auth-code flow, ported from the .NET API) ---
  // The mobile app opens this in a browser; we bounce to Google's consent screen.
  app.get<{ Querystring: { returnTo?: string } }>("/external/google/start", async (request, reply) => {
    // Web passes its own http origin here; native omits it and gets the wardyou://
    // deep link. Always run through the allowlist.
    const returnTo = safeReturnTo(request.query.returnTo);
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
      return reply.redirect(withParam(returnTo, "error", "provider_not_configured"));
    }
    const params = new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri: googleRedirectUri(request),
      response_type: "code",
      scope: "openid email profile",
      access_type: "online",
      prompt: "select_account",
      state: encodeState(returnTo),
    });
    return reply.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  // Google redirects here with ?code. We exchange it, find-or-create the user,
  // then hand a one-time code back to the app via the wardyou:// deep link.
  app.get("/external/google/complete", async (request, reply) => {
    const query = request.query as { code?: string; error?: string; state?: string };
    // `state` round-trips our (allowlisted) return URL through Google.
    const returnTo = decodeState(query.state);
    if (query.error || !query.code) {
      return reply.redirect(withParam(returnTo, "error", "external_auth_failed"));
    }
    try {
      const profile = await exchangeGoogleCode(query.code, googleRedirectUri(request));
      const result = await authService.findOrCreateExternalUser({
        provider: "google",
        email: profile.email,
        fullName: profile.name,
        avatarUrl: profile.picture,
      });
      await writeAudit({
        actorUserId: result.user.Id,
        action: result.isNewUser ? "UserRegistered" : "UserLoggedIn",
        sourceType: "Auth",
        targetUserId: result.user.Id,
        metadata: { loginMethod: "external-google" },
      });
      const code = issueExternalAuthCode(buildAuthResponse(app, result));
      return reply.redirect(withParam(returnTo, "code", code));
    } catch {
      return reply.redirect(withParam(returnTo, "error", "external_login_failed"));
    }
  });

  // The app exchanges the one-time code for the real tokens.
  app.post("/external/exchange", async (request, reply) => {
    const parsed = z.object({ code: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Código inválido." });
    const auth = takeExternalAuthCode<ReturnType<typeof buildAuthResponse>>(parsed.data.code);
    if (!auth) return reply.code(401).send({ message: "Código expirado ou inválido." });
    return reply.send(auth);
  });
}

/** Build the Google redirect_uri; must match an Authorized redirect URI on the
 *  OAuth client. Prefer the configured public URL for determinism behind a proxy. */
function googleRedirectUri(request: { protocol: string; headers: { host?: string } }): string {
  const base = env.PUBLIC_API_URL?.replace(/\/+$/, "") ?? `${request.protocol}://${request.headers.host}`;
  return `${base}/api/v1/auth/external/google/complete`;
}

/** Swap the auth code for tokens, then read the user's profile from Google. */
async function exchangeGoogleCode(code: string, redirectUri: string): Promise<{ email: string; name: string; picture?: string | null }> {
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID as string,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET as string,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) throw new Error(`google token exchange failed: ${tokenRes.status}`);
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error("google token exchange returned no access_token");

  const userRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) throw new Error(`google userinfo failed: ${userRes.status}`);
  const info = (await userRes.json()) as { email?: string; name?: string; picture?: string };
  if (!info.email) throw new Error("google userinfo returned no email");
  return { email: info.email, name: info.name ?? info.email, picture: info.picture ?? null };
}
