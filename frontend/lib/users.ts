import { randomUUID } from "node:crypto";
import { z } from "zod";
import { hashPassword, verifyPassword } from "@/lib/password";
import { getRedisClient } from "@/lib/redis";

const USERS_SET_KEY = "users:all";

export const createUserSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().optional().default(""),
  country: z.string().optional().default(""),
  plan: z.string().optional().default("Free"),
  status: z.string().optional().default("active"),
});

export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type SignInInput = z.infer<typeof signInSchema>;

export type StoredUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  plan: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  passwordHash: string;
};

export type PublicUser = Omit<StoredUser, "passwordHash">;

function userKey(id: string) {
  return `user:${id}`;
}

function userEmailKey(email: string) {
  return `user:email:${email.toLowerCase()}`;
}

function sanitizeUser(user: StoredUser): PublicUser {
  const { passwordHash: _, ...safeUser } = user;
  return safeUser;
}

function parseStoredUser(value: string | null): StoredUser | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as StoredUser;
  } catch {
    return null;
  }
}

export async function createUser(input: CreateUserInput): Promise<PublicUser> {
  const redis = await getRedisClient();
  const normalizedEmail = input.email.toLowerCase();
  const emailIndexKey = userEmailKey(normalizedEmail);

  const existingUserId = await redis.get(emailIndexKey);
  if (existingUserId) {
    throw new Error("A user with this email already exists.");
  }

  const now = new Date().toISOString();
  const id = randomUUID();

  const storedUser: StoredUser = {
    id,
    firstName: input.firstName,
    lastName: input.lastName,
    email: normalizedEmail,
    phone: input.phone ?? "",
    country: input.country ?? "",
    plan: input.plan ?? "Free",
    status: input.status ?? "active",
    createdAt: now,
    updatedAt: now,
    passwordHash: await hashPassword(input.password),
  };

  await redis.set(userKey(id), JSON.stringify(storedUser));
  await redis.set(emailIndexKey, id);
  await redis.sAdd(USERS_SET_KEY, id);

  return sanitizeUser(storedUser);
}

export async function getUsers(): Promise<PublicUser[]> {
  const redis = await getRedisClient();
  const userIds = await redis.sMembers(USERS_SET_KEY);

  if (!userIds.length) {
    return [];
  }

  const keys = userIds.map((id) => userKey(id));
  const users = (await redis.mGet(keys))
    .map((rawUser) => parseStoredUser(rawUser))
    .filter((user): user is StoredUser => Boolean(user))
    .map((user) => sanitizeUser(user))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return users;
}

export async function signInUser(input: SignInInput): Promise<PublicUser> {
  const redis = await getRedisClient();
  const normalizedEmail = input.email.toLowerCase();
  const userId = await redis.get(userEmailKey(normalizedEmail));

  if (!userId) {
    throw new Error("Invalid email or password.");
  }

  const storedUser = parseStoredUser(await redis.get(userKey(userId)));

  if (!storedUser) {
    throw new Error("User profile is not available.");
  }

  const isValidPassword = await verifyPassword(input.password, storedUser.passwordHash);
  if (!isValidPassword) {
    throw new Error("Invalid email or password.");
  }

  return sanitizeUser(storedUser);
}
