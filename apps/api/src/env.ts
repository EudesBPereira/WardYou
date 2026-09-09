import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_ISSUER: z.string().default("WardYou"),
  JWT_AUDIENCE: z.string().default("WardYou.App"),
  ACCESS_TOKEN_MINUTES: z.coerce.number().default(15),
  REFRESH_TOKEN_DAYS: z.coerce.number().default(30),
  PORT: z.coerce.number().default(3000),
  CORS_ORIGIN: z.string().default("http://localhost:8081"),
  // Google OAuth (web client — reused from the legacy .NET ExternalAuthentication).
  // Server-side auth-code flow: the app opens /external/google/start in a browser,
  // we redirect to Google, Google calls back /external/google/complete, and we
  // hand a one-time code back to the app via the wardyou:// deep link.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  // Where the OAuth flow is allowed to hand the one-time auth code back to.
  // This MUST stay an explicit allowlist: redirecting to a caller-supplied URL
  // would be an open redirect that leaks the code to whoever asked. Native uses
  // the wardyou:// deep link; the web build needs a real http origin (a browser
  // cannot open wardyou://, which is why web sign-in used to hang forever).
  OAUTH_REDIRECT_ALLOWLIST: z
    .string()
    .default("wardyou://auth/callback,http://localhost:8081/auth-callback"),
  // Public base URL of THIS api, used to build the Google redirect_uri. Must match
  // an "Authorized redirect URI" registered on the Google OAuth client. When unset,
  // it is derived from the incoming request (proto+host).
  PUBLIC_API_URL: z.string().optional(),
  // Azure Communication Services Email — powers the password-reset email. When
  // unset, the reset link is logged instead of sent (dev fallback).
  ACS_CONNECTION_STRING: z.string().optional(),
  MAIL_FROM: z.string().optional(),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
