/**
 * Naming helpers for turning Framer's obfuscated identifiers and human-readable
 * display names into clean, idiomatic React identifiers.
 */

/** "retail / how card" -> "RetailHowCard" */
export function toPascalCase(input: string): string {
  const parts = input.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return "FramerComponent";
  const pascal = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join("");
  return /^[A-Za-z_]/.test(pascal) ? pascal : `_${pascal}`;
}

/**
 * Sanitize a human variant title into a valid identifier-safe variant key.
 * "Variant 3" -> "Variant3", "Closed" -> "Closed". Framer-motion variant names
 * are arbitrary strings, but keeping them identifier-safe lets us use them as
 * plain object keys instead of quoted strings.
 */
export function sanitizeVariant(title: string): string {
  const cleaned = title.replace(/[^A-Za-z0-9]+/g, "");
  if (!cleaned) return "_variant";
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

/** Last path segment of a URL without extension: ".../eG98yZsRp.js" -> "eG98yZsRp" */
export function moduleBasename(url: string): string {
  const last = url.split("/").pop() ?? url;
  return last.replace(/\.[a-zA-Z0-9]+$/, "");
}
