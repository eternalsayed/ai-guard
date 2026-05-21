#!/usr/bin/env node
// Build script: copies public/ → dist/, replacing __HOSTED_URL__ with the
// HOSTED_URL env var. Run via `node build.js` or through netlify.toml.
"use strict";

const fs = require("fs");
const path = require("path");

// ── Load .env (local builds only) ────────────────────────────────────────────
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8")
    .split("\n")
    .forEach((line) => {
      line = line.trim();
      if (!line || line.startsWith("#")) return;
      const eq = line.indexOf("=");
      if (eq < 1) return;
      const key = line.slice(0, eq).trim();
      const val = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) process.env[key] = val;
    });
}

// ── Validate ──────────────────────────────────────────────────────────────────
const HOSTED_URL = (process.env.HOSTED_URL || "").replace(/\/$/, "");
if (!HOSTED_URL) {
  console.error("\n  ✗  HOSTED_URL is not set.\n");
  console.error("  Set it in .env for local builds:");
  console.error("    HOSTED_URL=https://your-site.netlify.app\n");
  console.error("  Or in Netlify → Site settings → Environment variables.\n");
  process.exit(1);
}
const GTAG_ID = (process.env.GTAG_ID || "").trim();
console.log(`\n  Building with HOSTED_URL=${HOSTED_URL}${GTAG_ID ? `  GTAG_ID=${GTAG_ID}` : "  GTAG_ID=(not set — GA disabled)"}\n`);

// ── Copy + replace ────────────────────────────────────────────────────────────
const SRC = path.join(__dirname, "public");
const DST = path.join(__dirname, "dist");
const TEXT_EXTS = new Set([
  ".js",
  ".html",
  ".sh",
  ".json",
  ".toml",
  ".txt",
  ".md",
]);

if (fs.existsSync(DST)) fs.rmSync(DST, { recursive: true, force: true });

function copy(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const sp = path.join(src, entry),
      dp = path.join(dst, entry);
    if (fs.statSync(sp).isDirectory()) {
      copy(sp, dp);
      continue;
    }
    const raw = fs.readFileSync(sp);
    if (TEXT_EXTS.has(path.extname(entry))) {
      const out = raw.toString("utf8")
        .replace(/__HOSTED_URL__/g, HOSTED_URL)
        .replace(/__GTAG_ID__/g, GTAG_ID);
      fs.writeFileSync(dp, out, "utf8");
      const changed =
        out.includes(HOSTED_URL) &&
        raw.toString("utf8").includes("__HOSTED_URL__");
      console.log(`  ${changed ? "✓" : "·"}  ${entry}`);
    } else {
      fs.writeFileSync(dp, raw);
      console.log(`  ·  ${entry}`);
    }
  }
}

copy(SRC, DST);
console.log(`\n  Done → dist/\n`);
