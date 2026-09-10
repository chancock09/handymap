import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
const allowed = new Set(["handymap.gobbi.tech"]);
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await check(path);
      continue;
    }
    if (!/\.(html|css|js|json|svg)$/.test(path)) continue;
    const source = await readFile(path, "utf8");
    for (const [host] of source.matchAll(
      /(?:[a-z0-9-]+\.)*(?:gobbi\.tech|pages\.dev)/gi,
    )) {
      if (!allowed.has(host.toLowerCase()))
        throw new Error(`${path} names an unapproved hostname: ${host}`);
    }
  }
}
await check("dist");
console.log("Public assets contain only approved site hostnames.");
