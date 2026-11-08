import argon2 from 'argon2';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
  REFRESH_TOKEN_TTL_DAYS,
  RESET_TOKEN_TTL_MINUTES,
  VERIFY_TOKEN_TTL_HOURS,
  type AuthSessionResponse,
  type AuthUserDto,
  type LoginInput,
  type RegisterInput,
} from '@sol-y-luna/shared';
import type { User } from '../generated/prisma/client.js';
import { hashToken, randomToken } from '../lib/crypto.js';
import { HttpError } from '../lib/http-error.js';
import type { Logger } from '../lib/logger.js';
import type { Db } from '../lib/prisma.js';
import type { TokenService } from '../lib/tokens.js';
import type { EmailSender } from './email.js';
import {
  accountExistsTemplate,
  passwordChangedTemplate,
  resetPasswordTemplate,
  verifyEmailTemplate,
} from './email-templates.js';

/** One generic message for every login failure, so the response never reveals whether an email exists. */
export const INVALID_CREDENTIALS_MESSAGE =
  'Correo o contraseña incorrectos. Después de 5 intentos fallidos la cuenta se bloquea 15 minutos.';

const ARGON2_OPTIONS = { type: argon2.argon2id } as const;

/**
 * A rotated refresh token presented again within this window is treated as a lost response or a
 * parallel tab, not as theft, as long as its family is still alive (same idea as Auth0's
 * "reuse interval"). Outside the window, any reuse revokes the whole family.
 */
export const REFRESH_REUSE_GRACE_MS = 15_000;

export interface SessionContext {
  ip: string;
  userAgent: string | undefined;
}

export interface IssuedSession extends AuthSessionResponse {
  refreshToken: string;
  sessionToken: string;
}

export interface AuthServiceDeps {
  db: Db;
  tokens: TokenService;
  email: EmailSender;
  logger: Logger;
  pepper: string;
  webUrl: string;
}

export function toUserDto(user: User): AuthUserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
    wholesaleStatus: user.wholesaleStatus,
  };
}

export function createAuthService(deps: AuthServiceDeps) {
  const { db, tokens, email, logger, pepper, webUrl } = deps;
  const hash = (token: string) => hashToken(token, pepper);
  // Hash used to spend the same argon2 time when the email does not exist.
  let dummyHash: Promise<string> | undefined;
  const getDummyHash = () => (dummyHash ??= argon2.hash(randomToken(), ARGON2_OPTIONS));

  const link = (path: string, token: string) =>
    `${webUrl.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;

  async function sendSafely(message: Parameters<EmailSender['send']>[0]) {
    try {
      await email.send(message);
    } catch (error) {
      logger.error({ err: error, subject: message.subject }, 'no se pudo enviar el email');
    }
  }

  async function issueSession(
    user: User,
    ctx: SessionContext,
    familyId = randomToken(16),
  ): Promise<IssuedSession> {
    const refreshToken = randomToken();
    await db.refreshToken.create({
      data: {
        tokenHash: hash(refreshToken),
        familyId,
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        userAgent: ctx.userAgent?.slice(0, 255) ?? null,
        ip: ctx.ip,
      },
    });
    const claims = { userId: user.id, role: user.role, familyId };
    const [accessToken, sessionToken] = await Promise.all([
      tokens.signAccessToken(claims),
      tokens.signSessionToken(claims),
    ]);
    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: toUserDto(user),
      refreshToken,
      sessionToken,
    };
  }

  async function createEmailToken(userId: string, type: 'VERIFY' | 'RESET') {
    const token = randomToken();
    const ttl =
      type === 'VERIFY' ? VERIFY_TOKEN_TTL_HOURS * 3_600_000 : RESET_TOKEN_TTL_MINUTES * 60_000;
    // Only the newest token of each type stays usable.
    await db.emailToken.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: new Date() },
    });
    await db.emailToken.create({
      data: { userId, type, tokenHash: hash(token), expiresAt: new Date(Date.now() + ttl) },
    });
    return token;
  }

  async function revokeAllSessions(userId: string) {
    await db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async function sendVerification(user: User) {
    const token = await createEmailToken(user.id, 'VERIFY');
    await sendSafely({
      to: user.email,
      ...verifyEmailTemplate({ name: user.name, link: link('/cuenta/verificar', token) }),
    });
  }

  return {
    issueSession,

    async register(input: RegisterInput): Promise<void> {
      // Hash first in every branch so timing does not reveal existing accounts.
      const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);
      const existing = await db.user.findUnique({ where: { email: input.email } });
      if (existing) {
        await sendSafely({
          to: existing.email,
          ...accountExistsTemplate({
            name: existing.name,
            loginLink: `${webUrl}/cuenta/ingresar`,
            resetLink: `${webUrl}/cuenta/recuperar`,
          }),
        });
        return;
      }
      try {
        const user = await db.user.create({
          data: { email: input.email, name: input.name, phone: input.phone ?? null, passwordHash },
        });
        await sendVerification(user);
        logger.info({ userId: user.id }, 'cuenta creada');
      } catch (error) {
        // Concurrent registration with the same email: behave as "already exists".
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'P2002'
        )
          return;
        throw error;
      }
    },

    async login(input: LoginInput, ctx: SessionContext): Promise<IssuedSession> {
      const user = await db.user.findUnique({ where: { email: input.email } });
      if (!user) {
        await argon2.verify(await getDummyHash(), input.password).catch(() => false);
        throw new HttpError(401, INVALID_CREDENTIALS_MESSAGE, 'INVALID_CREDENTIALS');
      }

      const now = new Date();
      const locked = user.lockedUntil !== null && user.lockedUntil > now;
      const valid = await argon2.verify(user.passwordHash, input.password).catch(() => false);

      if (locked) {
        logger.warn({ userId: user.id }, 'login rechazado: cuenta bloqueada');
        throw new HttpError(401, INVALID_CREDENTIALS_MESSAGE, 'INVALID_CREDENTIALS');
      }

      if (!valid) {
        const failed = user.failedLoginCount + 1;
        const lock = failed >= MAX_FAILED_LOGINS;
        await db.user.update({
          where: { id: user.id },
          data: lock
            ? {
                failedLoginCount: 0,
                lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000),
              }
            : { failedLoginCount: failed },
        });
        if (lock) logger.warn({ userId: user.id }, 'cuenta bloqueada por intentos fallidos');
        throw new HttpError(401, INVALID_CREDENTIALS_MESSAGE, 'INVALID_CREDENTIALS');
      }

      const fresh =
        user.failedLoginCount > 0 || user.lockedUntil !== null
          ? await db.user.update({
              where: { id: user.id },
              data: { failedLoginCount: 0, lockedUntil: null },
            })
          : user;
      logger.info({ userId: user.id }, 'login correcto');
      return issueSession(fresh, ctx);
    },

    /**
     * Rotates a refresh token. Reusing a token that was already rotated means it leaked: the whole
     * family (that login and every token derived from it) is revoked — except within the short
     * grace window described at REFRESH_REUSE_GRACE_MS.
     */
    async refresh(presented: string, ctx: SessionContext): Promise<IssuedSession> {
      const record = await db.refreshToken.findUnique({
        where: { tokenHash: hash(presented) },
        include: { user: true },
      });
      if (!record)
        throw new HttpError(401, 'Tu sesión expiró. Ingresa de nuevo.', 'SESSION_EXPIRED');
      if (record.revokedAt === null && record.expiresAt <= new Date()) {
        throw new HttpError(401, 'Tu sesión expiró. Ingresa de nuevo.', 'SESSION_EXPIRED');
      }

      const nextToken = randomToken();
      const newTokenData = () => ({
        tokenHash: hash(nextToken),
        familyId: record.familyId,
        userId: record.userId,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        userAgent: ctx.userAgent?.slice(0, 255) ?? null,
        ip: ctx.ip,
      });

      const rotated = await db.$transaction(async (tx) => {
        // Atomic claim: only one request can rotate a given token.
        const claimed = await tx.refreshToken.updateMany({
          where: { id: record.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (claimed.count === 1) {
          const created = await tx.refreshToken.create({ data: newTokenData() });
          await tx.refreshToken.update({
            where: { id: record.id },
            data: { replacedById: created.id },
          });
          return created;
        }

        // Already rotated. Within the grace window, supersede the family's live token
        // (whose response probably never reached the browser) instead of killing the session.
        const current = await tx.refreshToken.findUniqueOrThrow({ where: { id: record.id } });
        const rotatedRecently =
          current.replacedById !== null &&
          current.revokedAt !== null &&
          Date.now() - current.revokedAt.getTime() <= REFRESH_REUSE_GRACE_MS;
        if (!rotatedRecently) return null;
        const live = await tx.refreshToken.findFirst({
          where: { familyId: record.familyId, revokedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: 'desc' },
        });
        if (!live) return null;
        const superseded = await tx.refreshToken.updateMany({
          where: { id: live.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (superseded.count !== 1) return null;
        const created = await tx.refreshToken.create({ data: newTokenData() });
        await tx.refreshToken.update({
          where: { id: live.id },
          data: { replacedById: created.id },
        });
        logger.info(
          { userId: record.userId, familyId: record.familyId },
          'refresh repetido dentro del margen: sesión conservada',
        );
        return created;
      });

      if (!rotated) {
        await db.refreshToken.updateMany({
          where: { familyId: record.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        logger.warn(
          { userId: record.userId, familyId: record.familyId },
          'reutilización de refresh token detectada: familia revocada',
        );
        throw new HttpError(401, 'Tu sesión expiró. Ingresa de nuevo.', 'SESSION_REVOKED');
      }

      const claims = { userId: record.user.id, role: record.user.role, familyId: record.familyId };
      const [accessToken, sessionToken] = await Promise.all([
        tokens.signAccessToken(claims),
        tokens.signSessionToken(claims),
      ]);
      return {
        accessToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        user: toUserDto(record.user),
        refreshToken: nextToken,
        sessionToken,
      };
    },

    async logout(presented: string | undefined): Promise<void> {
      if (!presented) return;
      const record = await db.refreshToken.findUnique({ where: { tokenHash: hash(presented) } });
      if (!record) return;
      await db.refreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },

    /** True while the login family still has a live refresh token. */
    async isFamilyActive(familyId: string): Promise<boolean> {
      const active = await db.refreshToken.findFirst({
        where: { familyId, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      return active !== null;
    },

    async resendVerification(userId: string): Promise<void> {
      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.emailVerifiedAt) return;
      await sendVerification(user);
    },

    async verifyEmail(token: string): Promise<void> {
      const record = await db.emailToken.findUnique({ where: { tokenHash: hash(token) } });
      if (!record || record.type !== 'VERIFY' || record.usedAt || record.expiresAt <= new Date()) {
        throw new HttpError(
          400,
          'El enlace no es válido o ya venció. Pide uno nuevo desde tu cuenta.',
          'INVALID_TOKEN',
        );
      }
      const claimed = await db.emailToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new HttpError(
          400,
          'El enlace no es válido o ya venció. Pide uno nuevo desde tu cuenta.',
          'INVALID_TOKEN',
        );
      }
      await db.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
    },

    async forgotPassword(emailAddress: string): Promise<void> {
      const user = await db.user.findUnique({ where: { email: emailAddress } });
      if (!user) return;
      const token = await createEmailToken(user.id, 'RESET');
      await sendSafely({
        to: user.email,
        ...resetPasswordTemplate({ name: user.name, link: link('/cuenta/restablecer', token) }),
      });
    },

    async resetPassword(token: string, newPassword: string): Promise<void> {
      const invalid = () =>
        new HttpError(
          400,
          'El enlace no es válido o ya venció. Solicita uno nuevo.',
          'INVALID_TOKEN',
        );
      const record = await db.emailToken.findUnique({ where: { tokenHash: hash(token) } });
      if (!record || record.type !== 'RESET' || record.usedAt || record.expiresAt <= new Date())
        throw invalid();

      const passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);
      const user = await db.$transaction(async (tx) => {
        const claimed = await tx.emailToken.updateMany({
          where: { id: record.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (claimed.count !== 1) return null;
        const updated = await tx.user.update({
          where: { id: record.userId },
          data: {
            passwordHash,
            passwordChangedAt: new Date(Math.floor(Date.now() / 1000) * 1000),
            failedLoginCount: 0,
            lockedUntil: null,
          },
        });
        await tx.refreshToken.updateMany({
          where: { userId: record.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return updated;
      });
      if (!user) throw invalid();
      // Reaching the inbox proves ownership of the email.
      if (!user.emailVerifiedAt) {
        await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      }
      await sendSafely({ to: user.email, ...passwordChangedTemplate({ name: user.name }) });
    },

    async changePassword(
      userId: string,
      input: { currentPassword: string; newPassword: string },
      ctx: SessionContext,
    ): Promise<IssuedSession> {
      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      const valid = await argon2
        .verify(user.passwordHash, input.currentPassword)
        .catch(() => false);
      if (!valid) {
        throw new HttpError(400, 'La contraseña actual no es correcta', 'INVALID_PASSWORD', [
          { path: ['currentPassword'], message: 'La contraseña actual no es correcta' },
        ]);
      }
      const updated = await db.user.update({
        where: { id: userId },
        data: {
          passwordHash: await argon2.hash(input.newPassword, ARGON2_OPTIONS),
          // Rounded down to the second so tokens issued right after stay valid (JWT iat has 1s precision).
          passwordChangedAt: new Date(Math.floor(Date.now() / 1000) * 1000),
        },
      });
      await revokeAllSessions(userId);
      await sendSafely({ to: updated.email, ...passwordChangedTemplate({ name: updated.name }) });
      return issueSession(updated, ctx);
    },

    async getUser(userId: string) {
      return db.user.findUnique({ where: { id: userId } });
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
