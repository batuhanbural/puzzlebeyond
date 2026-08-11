import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = path.join(projectRoot, ".next");
const kibibytes = 1024;

const serverOnlyPackages = /node_modules[\\/](?:drizzle-orm|vinext|wrangler|sharp|vite|@cloudflare[\\/])/i;

function formatKibibytes(bytes) {
  return `${(bytes / kibibytes).toFixed(1)} KiB`;
}

async function measureFiles(files) {
  const buffers = await Promise.all([...files].map((file) => readFile(file)));
  return buffers.reduce(
    (total, buffer) => ({
      raw: total.raw + buffer.byteLength,
      gzip: total.gzip + gzipSync(buffer, { level: 9 }).byteLength,
    }),
    { raw: 0, gzip: 0 },
  );
}

async function readPngDimensions(file) {
  const image = await readFile(file);
  assert.equal(image.subarray(1, 4).toString("ascii"), "PNG", `${path.basename(file)} is not a PNG`);
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}

async function findFiles(directory, suffix) {
  const matches = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...(await findFiles(entryPath, suffix)));
    } else if (entry.name.endsWith(suffix)) {
      matches.push(entryPath);
    }
  }
  return matches;
}

async function readRouteManifest(manifestPath, route) {
  const contents = await readFile(manifestPath, "utf8");
  const assignment = `globalThis.__RSC_MANIFEST[${JSON.stringify(route)}] =`;
  const assignmentIndex = contents.indexOf(assignment);
  assert.notEqual(assignmentIndex, -1, `${route} is missing from ${path.relative(projectRoot, manifestPath)}`);

  const serialized = contents.slice(assignmentIndex + assignment.length).trim().replace(/;$/, "");
  return JSON.parse(serialized);
}

test("/page client-specific chunks and main CSS stay within budget", async (t) => {
  const manifestPath = path.join(buildRoot, "server", "app", "page_client-reference-manifest.js");
  const manifest = await readRouteManifest(manifestPath, "/page");
  const pageEntry = Object.keys(manifest.entryJSFiles).find((entry) => entry.endsWith("/app/page"));
  assert.ok(pageEntry, "The /page client entry is missing from its RSC manifest");

  const sharedJavascript = new Set(
    Object.entries(manifest.entryJSFiles)
      .filter(([entry]) => entry !== pageEntry)
      .flatMap(([, files]) => files),
  );
  const pageJavascript = new Set(
    manifest.entryJSFiles[pageEntry]
      .filter((file) => !sharedJavascript.has(file))
      .map((file) => path.join(buildRoot, file)),
  );
  const pageCss = new Set(
    (manifest.entryCSSFiles[pageEntry] ?? []).map(({ path: file }) => path.join(buildRoot, file)),
  );

  assert.ok(pageJavascript.size > 0, "The /page-specific JavaScript chunk set is empty");
  assert.ok(pageCss.size > 0, "The /page CSS chunk set is empty");

  const javascript = await measureFiles(pageJavascript);
  const css = await measureFiles(pageCss);
  t.diagnostic(
    `Page JS (${pageJavascript.size}) ${formatKibibytes(javascript.raw)} raw / ${formatKibibytes(javascript.gzip)} gzip; `
      + `CSS (${pageCss.size}) ${formatKibibytes(css.raw)} raw / ${formatKibibytes(css.gzip)} gzip`,
  );

  assert.ok(javascript.raw <= 70 * kibibytes, "/page-specific JavaScript raw budget exceeded");
  assert.ok(javascript.gzip <= 24 * kibibytes, "/page-specific JavaScript gzip budget exceeded");
  assert.ok(css.raw <= 55 * kibibytes, "/page CSS raw budget exceeded");
  assert.ok(css.gzip <= 12 * kibibytes, "/page CSS gzip budget exceeded");
});

test("social preview image stays lightweight and metadata matches", async () => {
  const previewPath = path.join(projectRoot, "public", "og.jpg");
  const [preview, layout] = await Promise.all([
    stat(previewPath),
    readFile(path.join(projectRoot, "app", "layout.tsx"), "utf8"),
  ]);

  assert.ok(preview.size <= 350 * kibibytes, "The social preview exceeds its 350 KiB budget");
  assert.match(layout, /url: "\/og\.jpg", width: 1200, height: 630/);
  assert.match(layout, /images: \["\/og\.jpg"\]/);
});

test("profile-style site icons have the expected sizes and metadata", async () => {
  const iconFiles = [
    ["favicon-32.png", 32],
    ["apple-touch-icon.png", 180],
    ["icon.png", 512],
  ];
  const [layout, icons] = await Promise.all([
    readFile(path.join(projectRoot, "app", "layout.tsx"), "utf8"),
    Promise.all(iconFiles.map(async ([name, size]) => {
      const file = path.join(projectRoot, "public", name);
      return { name, size, dimensions: await readPngDimensions(file), stats: await stat(file) };
    })),
  ]);

  for (const icon of icons) {
    assert.deepEqual(icon.dimensions, { width: icon.size, height: icon.size });
    assert.ok(icon.stats.size <= 160 * kibibytes, `${icon.name} exceeds its 160 KiB budget`);
    assert.match(layout, new RegExp(`/${icon.name.replace(".", "\\.")}`));
  }
  assert.doesNotMatch(layout, /favicon\.svg/);
});

test("client manifests do not include server and alternate-host packages", async () => {
  const manifests = [
    path.join(buildRoot, "server", "app", "page_client-reference-manifest.js"),
    path.join(buildRoot, "server", "app", "admin", "page_client-reference-manifest.js"),
  ];

  for (const manifest of manifests) {
    const contents = await readFile(manifest, "utf8");
    assert.doesNotMatch(contents, serverOnlyPackages, path.relative(projectRoot, manifest));
  }
});

test("Vercel API traces stay lean and exclude alternate-host packages", async (t) => {
  const apiRoot = path.join(buildRoot, "server", "app", "api");
  const traces = await findFiles(apiRoot, ".nft.json");
  let largestTrace = { file: "", bytes: 0, count: 0 };

  assert.ok(traces.length > 0, "No Vercel API trace manifests were generated");

  for (const trace of traces) {
    const manifest = JSON.parse(await readFile(trace, "utf8"));
    const listedFiles = manifest.files ?? [];
    assert.doesNotMatch(listedFiles.join("\n"), serverOnlyPackages, path.relative(projectRoot, trace));

    const tracedFiles = [trace.replace(/\.nft\.json$/, ""), ...listedFiles.map((file) => path.resolve(path.dirname(trace), file))];
    const sizes = await Promise.all(tracedFiles.map(async (file) => (await stat(file)).size));
    const bytes = sizes.reduce((sum, size) => sum + size, 0);

    assert.ok(bytes <= 2.25 * 1024 * 1024, `${path.relative(projectRoot, trace)} exceeds 2.25 MiB`);
    if (bytes > largestTrace.bytes) {
      largestTrace = { file: path.relative(projectRoot, trace), bytes, count: tracedFiles.length };
    }
  }

  t.diagnostic(`${largestTrace.file}: ${formatKibibytes(largestTrace.bytes)} across ${largestTrace.count} files`);
});
