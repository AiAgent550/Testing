// M&K Hub entry point. Every request passes through here first:
//   /api/*            -> module routes (each declares its own access level)
//   /app/*            -> the dashboard, only for fully signed-in users
//   /login, /assets/* -> public static files
import type { Env } from "./lib/env";
import { Router } from "./lib/router";
import { withSecurityHeaders } from "./lib/http";
import { loadSession } from "./lib/session";
import { modules } from "./modules";

const router = new Router();
for (const m of modules) m.register(router);

const PUBLIC_PATHS = ["/login", "/login/", "/manifest.webmanifest", "/sw.js", "/favicon.svg"];

async function handle(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path.startsWith("/api/")) return router.handle(req, env, exec);
  if (path === "/") return Response.redirect(new URL("/app/", url).toString(), 302);

  if (path === "/app" || path.startsWith("/app/")) {
    const s = await loadSession(env, req);
    if (!s || !s.session.mfa_ok) return Response.redirect(new URL("/login", url).toString(), 302);
    const res = await env.ASSETS.fetch(req);
    const out = new Response(res.body, res);
    out.headers.set("cache-control", "no-cache");
    return out;
  }

  if (PUBLIC_PATHS.includes(path) || path.startsWith("/assets/")) return env.ASSETS.fetch(req);
  return new Response("Not found", { status: 404 });
}

export default {
  async fetch(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    return withSecurityHeaders(await handle(req, env, exec));
  },
  async scheduled(controller: ScheduledController, env: Env, exec: ExecutionContext): Promise<void> {
    for (const m of modules) {
      if (!m.scheduled) continue;
      exec.waitUntil(m.scheduled(env, controller).catch(err => console.error(`scheduled ${m.name}`, err)));
    }
  },
} satisfies ExportedHandler<Env>;
