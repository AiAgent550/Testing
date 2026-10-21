// Input validation. Every handler parses its body through these so bad input never reaches the database.
import { badRequest } from "./http";

type Rule<T> = (value: unknown, field: string) => T;
export type Shape = Record<string, Rule<unknown>>;
export type Parsed<S extends Shape> = { [K in keyof S]: ReturnType<S[K]> };

class FieldError extends Error {
  constructor(public field: string, message: string) { super(message); }
}

export function parse<S extends Shape>(input: unknown, shape: S): Parsed<S> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw badRequest("Expected a JSON object.");
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [key, rule] of Object.entries(shape)) {
    try { out[key] = rule(src[key], key); }
    catch (e) { if (e instanceof FieldError) errors[e.field] = e.message; else throw e; }
  }
  if (Object.keys(errors).length) throw badRequest("Some fields need fixing.", errors);
  return out as Parsed<S>;
}

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

export function optional<T>(rule: Rule<T>): Rule<T | undefined> {
  return (v, f) => (isEmpty(v) ? undefined : rule(v, f));
}

export function nullable<T>(rule: Rule<T>): Rule<T | null | undefined> {
  return (v, f) => (v === null ? null : v === undefined ? undefined : isEmpty(v) ? null : rule(v, f));
}

export function str(opts: { min?: number; max?: number; label?: string } = {}): Rule<string> {
  const { min = 1, max = 2000 } = opts;
  return (v, f) => {
    if (typeof v !== "string") throw new FieldError(f, "Required.");
    const s = v.trim();
    if (s.length < min) throw new FieldError(f, min === 1 ? "Required." : `At least ${min} characters.`);
    if (s.length > max) throw new FieldError(f, `At most ${max} characters.`);
    return s;
  };
}

export function oneOf<T extends string>(values: readonly T[]): Rule<T> {
  return (v, f) => {
    if (typeof v !== "string" || !values.includes(v as T)) throw new FieldError(f, `Must be one of: ${values.join(", ")}.`);
    return v as T;
  };
}

export function int(opts: { min?: number; max?: number } = {}): Rule<number> {
  return (v, f) => {
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isInteger(n)) throw new FieldError(f, "Must be a whole number.");
    if (opts.min !== undefined && n < opts.min) throw new FieldError(f, `Must be at least ${opts.min}.`);
    if (opts.max !== undefined && n > opts.max) throw new FieldError(f, `Must be at most ${opts.max}.`);
    return n;
  };
}

export function bool(): Rule<boolean> {
  return (v, f) => {
    if (typeof v !== "boolean") throw new FieldError(f, "Must be true or false.");
    return v;
  };
}

export function email(): Rule<string> {
  return (v, f) => {
    const s = str({ max: 254 })(v, f).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new FieldError(f, "Enter a valid email address.");
    return s;
  };
}

/** UK phone numbers normalised to E.164 (+44...). */
export function ukPhone(): Rule<string> {
  return (v, f) => {
    const raw = str({ max: 32 })(v, f).replace(/[\s()-]/g, "");
    let n = raw;
    if (n.startsWith("00")) n = "+" + n.slice(2);
    if (n.startsWith("0")) n = "+44" + n.slice(1);
    if (!/^\+\d{10,15}$/.test(n)) throw new FieldError(f, "Enter a valid phone number.");
    return n;
  };
}

/** UK registration: upper case, no spaces, letters and digits only, 2-8 characters. */
export function normaliseReg(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function reg(): Rule<string> {
  return (v, f) => {
    const r = normaliseReg(str({ max: 12 })(v, f));
    if (r.length < 2 || r.length > 8) throw new FieldError(f, "Enter a valid registration.");
    return r;
  };
}

/** 17-character VIN, no I, O or Q. */
export function vin(): Rule<string> {
  return (v, f) => {
    const s = str({ max: 17 })(v, f).toUpperCase().replace(/\s/g, "");
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(s)) throw new FieldError(f, "A VIN is 17 letters and numbers (no I, O or Q).");
    return s;
  };
}

export function isoDate(): Rule<string> {
  return (v, f) => {
    const s = str({ max: 10 })(v, f);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new FieldError(f, "Use the format YYYY-MM-DD.");
    return s;
  };
}

export function isoDateTime(): Rule<string> {
  return (v, f) => {
    const s = str({ max: 40 })(v, f);
    const t = Date.parse(s);
    if (Number.isNaN(t)) throw new FieldError(f, "Enter a valid date and time.");
    return new Date(t).toISOString();
  };
}
