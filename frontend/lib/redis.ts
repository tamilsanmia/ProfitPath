import { createClient, type RedisClientType } from "redis";

declare global {
  var __redisClient__: RedisClientType | undefined;
}

async function connectRedisClient(client: RedisClientType) {
  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}

export async function getRedisClient(): Promise<RedisClientType> {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is not set. Add REDIS_URL to your environment.");
  }

  if (!globalThis.__redisClient__) {
    globalThis.__redisClient__ = createClient({ url: redisUrl });
    globalThis.__redisClient__.on("error", (error) => {
      console.error("Redis error:", error);
    });
  }

  return connectRedisClient(globalThis.__redisClient__);
}
