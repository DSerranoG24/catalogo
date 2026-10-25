import bcrypt from "bcrypt";
import { OAuth2Client } from "google-auth-library";
import {
  linkGoogleUser,
  createGoogleUser,
  createUser,
  findUserByEmail,
  findUserByGoogleId,
  findUserById,
} from "../repositories/user.repository";
import { generateToken } from "../utils/jwt";
import { accountActionService } from "./account-action.service";

const googleClient = new OAuth2Client();

function createSession(user: { id: string; email: string; name: string | null; sessionVersion: number }) {
  const claims = { userId: user.id, email: user.email, sessionVersion: user.sessionVersion };
  return {
    user: { id: user.id, email: user.email, name: user.name },
    token: generateToken(claims),
  };
}

export async function registerUser(data: {
  email: string;
  password: string;
  name?: string;
}, store = { findUserByEmail, createUser }, actions = accountActionService) {
  const existingUser = await store.findUserByEmail(data.email);

  if (existingUser) {
    throw new Error("EMAIL_ALREADY_EXISTS");
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const user = await store.createUser({
    email: data.email,
    passwordHash,
    name: data.name,
  });

  try { actions.requestVerification(user.id); }
  catch { console.warn("[account-mail]", { operation: "VERIFY_EMAIL", result: "failed" }); }
  return createSession(user);
}

export async function loginUser(data: {
  email: string;
  password: string;
}) {
  const user = await findUserByEmail(data.email);

  if (!user?.passwordHash) {
    throw new Error("INVALID_CREDENTIALS");
  }

  const passwordValid = await bcrypt.compare(
    data.password,
    user.passwordHash
  );

  if (!passwordValid) {
    throw new Error("INVALID_CREDENTIALS");
  }

  return createSession(user);
}

export async function verifyGoogleIdentity(idToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_AUTH_NOT_CONFIGURED");

  const ticket = await googleClient.verifyIdToken({ idToken, audience: clientId });
  const payload = ticket.getPayload();
  const validIssuer = payload?.iss === "accounts.google.com" || payload?.iss === "https://accounts.google.com";
  const tokenIsCurrent = typeof payload?.exp === "number" && payload.exp > Math.floor(Date.now() / 1000);
  if (
    !payload?.sub ||
    !payload.email ||
    payload.email_verified !== true ||
    !validIssuer ||
    !tokenIsCurrent
  ) {
    throw new Error("INVALID_GOOGLE_CREDENTIAL");
  }

  return { googleId: payload.sub, email: payload.email.trim().toLowerCase(), name: payload.name?.slice(0, 100), authoritative: payload.email.toLowerCase().endsWith("@gmail.com") || Boolean(payload.hd) };
}

export async function loginWithGoogle(idToken: string, store = { findUserByGoogleId, findUserByEmail, createGoogleUser }, verify = verifyGoogleIdentity) {
  const { googleId, email, name, authoritative } = await verify(idToken);
  const existingGoogleUser = await store.findUserByGoogleId(googleId);
  if (existingGoogleUser) return createSession(existingGoogleUser);

  const existingEmailUser = await store.findUserByEmail(email);
  if (existingEmailUser) {
    if (existingEmailUser.googleId && existingEmailUser.googleId !== googleId) {
      throw new Error("GOOGLE_ACCOUNT_MISMATCH");
    }
    throw new Error("GOOGLE_LINK_REQUIRED");
  }

  try {
    const user = await store.createGoogleUser({
      email,
      name,
      googleId,
      ...(authoritative ? { emailVerifiedAt: new Date() } : {}),
    });
    if (!authoritative) accountActionService.requestVerification(user.id);
    return createSession(user);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      const concurrentUser = await store.findUserByGoogleId(googleId);
      if (concurrentUser) return createSession(concurrentUser);
    }
    throw error;
  }
}

export async function linkGoogleAccount(userId: string, idToken: string, password: string, store = { findUserById, linkGoogleUser }, verify = verifyGoogleIdentity) {
  const identity = await verify(idToken);
  const user = await store.findUserById(userId);
  if (!user?.passwordHash || user.email !== identity.email || !await bcrypt.compare(password, user.passwordHash)) throw new Error("GOOGLE_LINK_REJECTED");
  await store.linkGoogleUser(user.id, user.email, user.passwordHash, user.sessionVersion, identity.googleId, identity.authoritative);
}
