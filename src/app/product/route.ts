import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Public marketing page. Source: marketing/dispatch.html → `python3 marketing/build.py` → public/product.html */
export async function GET() {
  const html = await readFile(join(process.cwd(), "public", "product.html"), "utf8");
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
