export function parseExactOriginAllowlist(value: string) {
  const values = value.split(",").map((item) => item.trim());
  if (values.length === 0 || values.some((item) => !item)) return null;

  for (const value of values) {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== value) return null;
    } catch {
      return null;
    }
  }

  return new Set(values);
}

export function exactCorsHeaders(
  origin: string | null,
  allowedOrigins: Set<string>,
  methods: string,
) {
  const headers = new Headers({ "cache-control": "no-store" });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", methods);
    headers.set(
      "access-control-allow-headers",
      "authorization, x-client-info, apikey, content-type",
    );
    headers.set("vary", "Origin");
  }
  return headers;
}
