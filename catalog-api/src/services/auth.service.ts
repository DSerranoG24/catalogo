import bcrypt from "bcrypt";
import { OAuth2Client } from "google-auth-library";
import {
  attachGoogleId,
  createGoogleUser,
  createUser,
  findUserByEmail,
  findUserByGoogleId,
} from "../repositories/user.repository";
import { generateToken } from "../utils/jwt";

const googleClient = new OAuth2Client();

function createSession(user: { id: string; email: string; name: string | null }) {
  return {
    user: { id: user.id, email: user.email, name: user.name },
    token: generateToken({ userId: user.id, email: user.email }),
  };
}

export async function registerUser(data: {
  email: string;
  password: string;
  name?: string;
}) {
  const existingUser = await findUserByEmail(data.email);

  if (existingUser) {
    throw new Error("EMAIL_ALREADY_EXISTS");
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const user = await createUser({
    email: data.email,
    passwordHash,
    name: data.name,
  });

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

export async function loginWithGoogle(idToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_AUTH_NOT_CONFIGURED");

  const ticket = await googleClient.verifyIdToken({ idToken, audience: clientId });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new Error("INVALID_GOOGLE_CREDENTIAL");
  }

  const googleId = payload.sub;
  const email = payload.email.trim().toLowerCase();
  const existingGoogleUser = await findUserByGoogleId(googleId);
  if (existingGoogleUser) return createSession(existingGoogleUser);

  const existingEmailUser = await findUserByEmail(email);
  if (existingEmailUser) {
    if (existingEmailUser.googleId && existingEmailUser.googleId !== googleId) {
      throw new Error("GOOGLE_ACCOUNT_MISMATCH");
    }
    return createSession(await attachGoogleId(existingEmailUser.id, googleId));
  }

  try {
    const user = await createGoogleUser({
      email,
      name: payload.name?.slice(0, 100),
      googleId,
    });
    return createSession(user);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      const concurrentUser = await findUserByGoogleId(googleId);
      if (concurrentUser) return createSession(concurrentUser);
    }
    throw error;
  }
}