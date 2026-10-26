// Serves the demo site with the freshly built widget beside it.
//
//   pnpm demo
//
// Builds @booking/widget, copies the bundle into the demo folder, then serves
// it on 8080. The API is expected on 127.0.0.1:8787 (pnpm --filter @booking/api start).
import { createServer } from "node:http";
import { readFile, copyFile, mkdir } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "glow-salon");
const bundle = join(here, "..", "apps", "widget", "dist", "widget.js");
const port = Number(process.env.PORT ?? 8080);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

await mkdir(site, { recursive: true });
await copyFile(bundle, join(site, "widget.js"));

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const file = join(site, normalize(url.pathname === "/" ? "index.html" : url.pathname));

  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}).listen(port, () => console.log(`demo site on http://127.0.0.1:${port}`));
