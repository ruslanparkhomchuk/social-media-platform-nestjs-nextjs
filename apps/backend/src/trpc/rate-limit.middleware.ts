import { Inject, Injectable } from "@nestjs/common";
import { ThrottlerStorage } from "@nestjs/throttler";
import { TRPCError } from "@trpc/server";
import {
  MiddlewareOptions,
  MiddlewareResponse,
  TRPCMiddleware,
} from "nestjs-trpc-v2";
import type { Request, Response } from "express";

type RateLimitCtx = {
  req: Request;
  res: Response;
  user?: { id: string };
};

const WINDOW_MS = 60_000;
const LIMITS = { query: 120, mutation: 30, subscription: 10 } as const;

@Injectable()
export class RateLimitTrpcMiddleware implements TRPCMiddleware {
  constructor(
    @Inject(ThrottlerStorage) private readonly storage: ThrottlerStorage,
  ) {}

  async use(
    opts: MiddlewareOptions<RateLimitCtx>,
  ): Promise<MiddlewareResponse> {
    const { ctx, type, next } = opts;
    const who = ctx.user?.id ?? ctx.req.ip ?? "unknown";

    const { isBlocked, timeToBlockExpire } = await this.storage.increment(
      `trpc:${type}:${who}`,
      WINDOW_MS,
      LIMITS[type],
      WINDOW_MS,
      "trpc",
    );

    if (isBlocked) {
      ctx.res.setHeader("Retry-After", String(timeToBlockExpire));
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Too many requests, try again in ${timeToBlockExpire}s`,
      });
    }

    return next();
  }
}
