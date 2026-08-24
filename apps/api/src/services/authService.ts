import { randomBytes, randomUUID } from "node:crypto";
import type { users as User } from "@prisma/client";
import { prisma } from "../db.js";
import { AppError } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
} from "../lib/tokens.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_PLATFORMS = ["Android", "iOS", "Windows", "MacCatalyst"] as const;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The data the route needs to assemble an AuthResponse (access token is signed
 *  by the route via @fastify/jwt). */
export interface AuthResult {
  user: User;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

async function issueRefreshToken(userId: string, deviceId: string | null): Promise<{ value: string; expiresAt: Date }> {
  const value = generateRefreshToken();
  const expiresAt = refreshTokenExpiresAt();
  await prisma.refresh_tokens.create({
    data: {
      Id: randomUUID(),
      UserId: userId,
      DeviceId: deviceId,
      TokenHash: hashRefreshToken(value),
      CreatedAt: new Date(),
      ExpiresAt: expiresAt,
    },
  });
  return { value, expiresAt };
}

export async function register(input: {
  fullName: string;
  email: string;
  phoneNumber?: string;
  password: string;
  confirmPassword: string;
}): Promise<AuthResult> {
  if (!input.fullName?.trim()) {
    throw new AppError("ValidationError", "Nome completo é obrigatório.");
  }
  if (!input.email || !EMAIL_RE.test(input.email.trim())) {
    throw new AppError("ValidationError", "Informe um e-mail válido.");
  }
  if (!input.password || input.password.length < 8) {
    throw new AppError("ValidationError", "A senha deve ter pelo menos 8 caracteres.");
  }
  if (input.password !== input.confirmPassword) {
    throw new AppError("ValidationError", "Senha e confirmação de senha não coincidem.");
  }

  const email = normalizeEmail(input.email);
  const exists = await prisma.users.findFirst({ where: { Email: email }, select: { Id: true } });
  if (exists) {
    throw new AppError("EmailAlreadyRegistered", "Já existe uma conta cadastrada com este e-mail.");
  }

  const user = await prisma.users.create({
    data: {
      Id: randomUUID(),
      FullName: input.fullName.trim(),
      Email: email,
      PhoneNumber: input.phoneNumber?.trim() || null,
      PasswordHash: hashPassword(input.password),
      CreatedAt: new Date(),
      IsActive: true,
    },
  });

  const refresh = await issueRefreshToken(user.Id, null);
  return { user, refreshToken: refresh.value, refreshTokenExpiresAt: refresh.expiresAt };
}

export async function login(input: { email: string; password: string }): Promise<AuthResult> {
  const invalid = new AppError("InvalidCredentials", "E-mail ou senha inválidos.", 401);
  if (!input.email?.trim() || !input.password) throw invalid;

  const email = normalizeEmail(input.email);
  const user = await prisma.users.findFirst({ where: { Email: email } });
  if (!user || !user.IsActive || !verifyPassword(input.password, user.PasswordHash)) {
    throw invalid;
  }

  await prisma.users.update({ where: { Id: user.Id }, data: { LastLoginAt: new Date() } });

  const refresh = await issueRefreshToken(user.Id, null);
  return { user, refreshToken: refresh.value, refreshTokenExpiresAt: refresh.expiresAt };
}

/**
 * Find-or-create a user from a verified external provider profile (Google).
 * Ports `AuthService.ExternalLoginAsync` from the legacy .NET API: first sign-in
 * auto-registers the account (random password so local login is disabled until
 * the user sets one), and the provider avatar is imported only when the user has
 * none yet — never overriding a manually uploaded photo.
 */
export async function findOrCreateExternalUser(input: {
  provider: string;
  email: string;
  fullName: string;
  avatarUrl?: string | null;
}): Promise<AuthResult & { isNewUser: boolean }> {
  if (!input.email || !EMAIL_RE.test(input.email.trim())) {
    throw new AppError("ExternalEmailUnavailable", "O provedor não retornou um e-mail válido.", 401);
  }

  const email = normalizeEmail(input.email);
  let user = await prisma.users.findFirst({ where: { Email: email } });
  const isNewUser = user === null;

  if (!user) {
    user = await prisma.users.create({
      data: {
        Id: randomUUID(),
        FullName: input.fullName?.trim() || email,
        Email: email,
        PasswordHash: hashPassword(randomBytes(48).toString("base64")),
        AvatarUrl: input.avatarUrl?.trim() || null,
        CreatedAt: new Date(),
        LastLoginAt: new Date(),
        IsActive: true,
      },
    });
  } else {
    if (!user.IsActive) {
      throw new AppError("UserDisabled", "Esta conta está desativada.", 403);
    }
    // Import the provider avatar only when the user hasn't set one.
    const avatarToSet = !user.AvatarUrl && input.avatarUrl?.trim() ? input.avatarUrl.trim() : undefined;
    user = await prisma.users.update({
      where: { Id: user.Id },
      data: { LastLoginAt: new Date(), ...(avatarToSet ? { AvatarUrl: avatarToSet } : {}) },
    });
  }

  const refresh = await issueRefreshToken(user.Id, null);
  return { user, refreshToken: refresh.value, refreshTokenExpiresAt: refresh.expiresAt, isNewUser };
}

export async function refresh(input: { refreshToken: string }): Promise<AuthResult> {
  const invalid = new AppError("InvalidRefreshToken", "Refresh token inválido.", 401);
  if (!input.refreshToken?.trim()) throw invalid;

  const tokenHash = hashRefreshToken(input.refreshToken);
  const existing = await prisma.refresh_tokens.findFirst({ where: { TokenHash: tokenHash } });
  if (!existing) throw invalid;

  // Rotation race grace window: the app AND its headless background tasks (trip
  // FGS, parental/trip push handlers) each refresh independently. Single-use
  // rotation means whoever refreshes first revokes the token the others still
  // hold — and the loser used to be logged out mid-session. So: a token that
  // was JUST rotated (revoked with a replacement, within the grace window) is
  // tolerated and mints a fresh token instead of failing. Outside the window a
  // revoked token is genuine reuse → reject.
  const ROTATION_GRACE_MS = 60_000;
  if (existing.RevokedAt) {
    const rotatedRecently =
      !!existing.ReplacedByTokenHash && Date.now() - existing.RevokedAt.getTime() <= ROTATION_GRACE_MS;
    if (!rotatedRecently) throw invalid;
  }

  if (existing.ExpiresAt <= new Date()) {
    if (!existing.RevokedAt) {
      await prisma.refresh_tokens.update({ where: { Id: existing.Id }, data: { RevokedAt: new Date() } });
    }
    throw new AppError("ExpiredRefreshToken", "Refresh token expirado.", 401);
  }

  const user = await prisma.users.findFirst({ where: { Id: existing.UserId } });
  if (!user || !user.IsActive) throw invalid;

  // Mint the new token. Only revoke+link the old row if it isn't already
  // revoked (a grace-window replay leaves the original rotation record intact).
  const newValue = generateRefreshToken();
  const newHash = hashRefreshToken(newValue);
  const newExpiresAt = refreshTokenExpiresAt();

  const createNew = prisma.refresh_tokens.create({
    data: {
      Id: randomUUID(),
      UserId: existing.UserId,
      DeviceId: existing.DeviceId,
      TokenHash: newHash,
      CreatedAt: new Date(),
      ExpiresAt: newExpiresAt,
    },
  });
  if (existing.RevokedAt) {
    // Grace-window replay: the original rotation record stays as-is.
    await createNew;
  } else {
    await prisma.$transaction([
      prisma.refresh_tokens.update({
        where: { Id: existing.Id },
        data: { RevokedAt: new Date(), ReplacedByTokenHash: newHash },
      }),
      createNew,
    ]);
  }

  return { user, refreshToken: newValue, refreshTokenExpiresAt: newExpiresAt };
}

export async function logout(userId: string, refreshToken: string): Promise<void> {
  if (!refreshToken?.trim()) {
    throw new AppError("InvalidRefreshToken", "Refresh token inválido.", 400);
  }
  const tokenHash = hashRefreshToken(refreshToken);
  const existing = await prisma.refresh_tokens.findFirst({
    where: { UserId: userId, TokenHash: tokenHash },
  });
  if (!existing) {
    throw new AppError("InvalidRefreshToken", "Refresh token inválido.", 400);
  }
  if (!existing.RevokedAt) {
    await prisma.refresh_tokens.update({ where: { Id: existing.Id }, data: { RevokedAt: new Date() } });
  }
}

/** Find an active user by email (for the password-reset request). */
export async function findActiveUserByEmail(email: string): Promise<User | null> {
  const user = await prisma.users.findFirst({ where: { Email: normalizeEmail(email) } });
  return user && user.IsActive ? user : null;
}

/**
 * Set a new password and revoke every refresh token, so any session opened with
 * the old password is invalidated. Used by the password-reset flow.
 */
export async function resetPassword(userId: string, newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 8) {
    throw new AppError("ValidationError", "A senha deve ter ao menos 8 caracteres.");
  }
  await prisma.users.update({
    where: { Id: userId },
    data: { PasswordHash: hashPassword(newPassword) },
  });
  await prisma.refresh_tokens.updateMany({
    where: { UserId: userId, RevokedAt: null },
    data: { RevokedAt: new Date() },
  });
}

export async function registerDevice(
  userId: string,
  input: { deviceName: string; platform: string; pushToken?: string; publicKey?: string },
): Promise<{ deviceId: string }> {
  if (!input.deviceName?.trim()) {
    throw new AppError("ValidationError", "Nome do dispositivo é obrigatório.");
  }
  const platform = ALLOWED_PLATFORMS.find((p) => p.toLowerCase() === input.platform?.trim().toLowerCase());
  if (!platform) {
    throw new AppError("ValidationError", "Plataforma inválida.");
  }
  const name = input.deviceName.trim();

  const existing = await prisma.devices.findFirst({
    where: { UserId: userId, DeviceName: name, Platform: platform },
  });

  if (existing) {
    const updated = await prisma.devices.update({
      where: { Id: existing.Id },
      data: {
        PushToken: input.pushToken?.trim() || null,
        PublicKey: input.publicKey?.trim() || null,
        LastSeenAt: new Date(),
        IsActive: true,
      },
    });
    return { deviceId: updated.Id };
  }

  const created = await prisma.devices.create({
    data: {
      Id: randomUUID(),
      UserId: userId,
      DeviceName: name,
      Platform: platform,
      PushToken: input.pushToken?.trim() || null,
      PublicKey: input.publicKey?.trim() || null,
      RegisteredAt: new Date(),
      LastSeenAt: new Date(),
      IsActive: true,
    },
  });
  return { deviceId: created.Id };
}
