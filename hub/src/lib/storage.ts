// Serving files from R2 (job photos and videos), shared by the dashboard and the customer link page.
import type { Env } from "./env";
import { notFound } from "./http";

/** Serves a stored photo or video, with byte ranges so videos can be scrubbed. Shared with the customer link page. */
export async function serveStored(env: Env, req: Request, key: string, contentType: string, cache = "private, max-age=3600"): Promise<Response> {
  const range = req.headers.get("range");
  const obj = await env.FILES.get(key, range ? { range: req.headers } : undefined);
  if (!obj) throw notFound("Photo");
  const headers = new Headers({ "content-type": contentType, "cache-control": cache, "content-disposition": "inline", "accept-ranges": "bytes" });
  const r = (obj as R2ObjectBody).range as { offset?: number; length?: number } | undefined;
  if (range && r && (r.offset !== undefined || r.length !== undefined)) {
    const offset = r.offset ?? 0, length = r.length ?? obj.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    return new Response((obj as R2ObjectBody).body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response((obj as R2ObjectBody).body, { headers });
}
