// Minimal router with three access levels:
//   public  - anyone (the website's booking form, health check)
//   pending - signed in with a password but two-step verification not finished yet
//   user    - fully signed in (both users have full access)
// Every state-changing request from the dashboard must come from the Hub's own origin.
import type { Env, Session, User } from "./env";
import { HttpError, errorResponse, forbidden, json, unauthorized } from "./http";
import { loadSession } from "./session";

export type Access = "public" | "pending" | "user";

export interface Ctx {
  req: Request;
  env: Env;
  exec: ExecutionContext;
  url: URL;
  params: Record<string, string>;
  user: User | null;
  session: Session | null;
  /** Parsed JSON body (cached). Throws a 400 for invalid JSON. */
  body(): Promise<unknown>;
}

/** The authenticated user; safe to call in handlers registered with access "user". */
export const userOf = (ctx: Ctx): User => {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
};

export type Handler = (ctx: Ctx) => Promise<Response> | Response;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
  access: Access;
}

const MAX_JSON_BYTES = 256 * 1024;

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler, access: Access = "user") {
    this.routes.push({ method, parts: path.split("/").filter(Boolean), handler, access });
  }
  get(path: string, h: Handler, access?: Access) { this.add("GET", path, h, access); }
  post(path: string, h: Handler, access?: Access) { this.add("POST", path, h, access); }
  patch(path: string, h: Handler, access?: Access) { this.add("PATCH", path, h, access); }
  put(path: string, h: Handler, access?: Access) { this.add("PUT", path, h, access); }
  delete(path: string, h: Handler, access?: Access) { this.add("DELETE", path, h, access); }

  private match(method: string, path: string): { route: Route; params: Record<string, string> } | "method" | null {
    const segs = path.split("/").filter(Boolean);
    let methodMismatch = false;
    for (const route of this.routes) {
      if (route.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const p = route.parts[i];
        if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(segs[i]);
        else if (p !== segs[i]) { ok = false; break; }
      }
      if (!ok) continue;
      if (route.method !== method) { methodMismatch = true; continue; }
      return { route, params };
    }
    return methodMismatch ? "method" : null;
  }

  async handle(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    try {
      const m = this.match(req.method, url.pathname);
      if (m === "method") return json({ error: { code: "method_not_allowed", message: "Method not allowed." } }, 405);
      if (!m) return json({ error: { code: "not_found", message: "No such endpoint." } }, 404);
      const { route, params } = m;

      let user: User | null = null, session: Session | null = null;
      if (route.access !== "public") {
        const loaded = await loadSession(env, req);
        if (!loaded) throw unauthorized();
        if (route.access === "user" && !loaded.session.mfa_ok) throw unauthorized("Finish two-step verification to continue.");
        ({ user, session } = loaded);
        if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req, env);
      }

      let bodyCache: unknown;
      const ctx: Ctx = {
        req, env, exec, url, params, user, session,
        async body() {
          if (bodyCache !== undefined) return bodyCache;
          const len = Number(req.headers.get("content-length") || 0);
          if (len > MAX_JSON_BYTES) throw new HttpError(413, "too_large", "Request is too large.");
          const text = await req.text();
          if (text.length > MAX_JSON_BYTES) throw new HttpError(413, "too_large", "Request is too large.");
          try { bodyCache = text ? JSON.parse(text) : {}; }
          catch { throw new HttpError(400, "bad_json", "Request body isn't valid JSON."); }
          return bodyCache;
        },
      };
      return await route.handler(ctx);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err);
      const ref = crypto.randomUUID().slice(0, 8);
      console.error(`[${ref}]`, req.method, url.pathname, err);
      return json({ error: { code: "server_error", message: `Something went wrong (ref ${ref}).` } }, 500);
    }
  }
}

function assertSameOrigin(req: Request, env: Env) {
  const origin = req.headers.get("origin");
  const self = new URL(req.url).origin;
  if (!origin || (origin !== env.APP_ORIGIN && origin !== self)) throw forbidden("Request blocked: it didn't come from the Hub.");
}
