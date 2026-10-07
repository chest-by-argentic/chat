// A refusal the API answers as {error: code} with its status: what the page
// turns into words. Anything else thrown is a 500 without detail.
export class Problem extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 423 | 429 | 503, readonly code: string) {
    super(code);
  }
}

export const notFound = () => new Problem(404, "not_found");
export const forbidden = () => new Problem(403, "forbidden");
export const invalid = (code = "invalid_body") => new Problem(400, code);

// Readers of a JSON body or a query, at the trust boundary: each returns
// the value or throws a 400.

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

export function text(value: unknown, max: number, min = 0): string {
  if (typeof value !== "string" || value.length > max || value.length < min) throw invalid();
  return value;
}

export function optionalText(value: unknown, max: number): string | undefined {
  return value === undefined || value === null ? undefined : text(value, max);
}

export function id(value: unknown): number {
  const n = typeof value === "string" && /^[1-9][0-9]{0,15}$/u.test(value) ? Number(value) : value;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) throw invalid("invalid_id");
  return n;
}

export function optionalId(value: unknown): number | null {
  return value === undefined || value === null || value === "" ? null : id(value);
}

export function list<T>(value: unknown, max: number, item: (v: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw invalid();
  return value.map(item);
}

export function matching(pattern: RegExp, code = "invalid_body") {
  return (value: unknown): string => {
    if (typeof value !== "string" || !pattern.test(value)) throw invalid(code);
    return value;
  };
}

export function oneOf<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== "string" || !options.includes(value as T)) throw invalid();
  return value as T;
}
