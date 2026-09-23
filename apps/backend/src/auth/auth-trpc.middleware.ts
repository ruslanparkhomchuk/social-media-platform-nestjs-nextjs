import { AuthService } from "@thallesp/nestjs-better-auth";
import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import { fromNodeHeaders } from "better-auth/node";
import {
  MiddlewareOptions,
  MiddlewareResponse,
  TRPCMiddleware,
} from "nestjs-trpc-v2";
import type { Request, Response } from "express";

type AuthCtx = { req: Request; res: Response };

@Injectable()
export class AuthTrpcMiddleware implements TRPCMiddleware {
  constructor(private readonly authService: AuthService) {}

  async use(opts: MiddlewareOptions<AuthCtx>): Promise<MiddlewareResponse> {
    const { ctx, next } = opts;

    const session = await this.authService.api.getSession({
      headers: fromNodeHeaders(ctx.req.headers),
    });

    if (!session?.user || !session.session) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    return next({
      ctx: {
        ...ctx,
        user: session.user,
        session: session.session,
      },
    });
  }
}
