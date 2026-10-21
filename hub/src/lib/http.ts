// JSON responses, typed errors and the security headers applied to every response.

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) => new HttpError(400, "bad_request", message, fields);
export const unauthorized = (message = "Sign in to continue.") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "You don't have access to this.") => new HttpError(403, "forbidden", message);
export const notFound = (what = "That record") => new HttpError(404, "not_found", `${what} wasn't found.`);
export const conflict = (message: string) => new HttpError(409, "conflict", message);
export const tooMany = (message = "Too many attempts. Wait a few minutes and try again.") => new HttpError(429, "rate_limited", message);

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function errorResponse(err: HttpError): Response {
  return json({ error: { code: err.code, message: err.message, fields: err.fields } }, err.status);
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export function withSecurityHeaders(res: Response, extra: Record<string, string> = {}): Response {
  const out = new Response(res.body, res);
  const h = out.headers;
  h.set("content-security-policy", CSP);
  h.set("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  h.set("x-content-type-options", "nosniff");
  h.set("x-frame-options", "DENY");
  h.set("referrer-policy", "same-origin");
  h.set("permissions-policy", "camera=(self), microphone=(), geolocation=(), payment=(), usb=()");
  h.set("cross-origin-opener-policy", "same-origin");
  h.set("cross-origin-resource-policy", "same-origin");
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return out;
}

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}
