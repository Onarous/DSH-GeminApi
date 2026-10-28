#!/usr/bin/env node
// Call a DSH Host Remote method over the local Web carrier.
//
//   node tools/dsh-api.cjs <namespace>/<method> '{"arg":"value"}'
//
// The Web carrier on 127.0.0.1:27979 authenticates with a signed cookie. The
// HMAC secret lives in the Harness home's credentials file, so no token is
// hardcoded here.
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const AUTHORITY = process.env.DSH_AUTHORITY ?? "127.0.0.1:27979";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function base64url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** The persistent browser-session secret from the Harness credentials file. */
function readSecret() {
  const file = path.join(os.homedir(), ".dsh", ".credentials.yaml");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*client-connection\/browser-session:\s*$/.test(line));
  if (start === -1) throw new Error(`No browser-session record in ${file}`);
  for (const line of lines.slice(start + 1)) {
    // A new record key ends the block.
    if (/^\s{2}\S[^:]*:\s*$/.test(line)) break;
    const m = /^\s+secret:\s*(\S+)\s*$/.exec(line);
    if (m) return m[1];
  }
  throw new Error(`No browser-session secret found in ${file}`);
}

/** Mint the signed cookie the Web carrier expects. */
function sessionCookie() {
  const secret = Buffer.from(readSecret().replaceAll("-", "+").replaceAll("_", "/"), "base64");
  const name = `dsh-auth-${base64url(crypto.createHash("sha256").update(AUTHORITY).digest())}`;
  const issuedAt = Date.now();
  const body = base64url(
    Buffer.from(
      JSON.stringify({
        version: 1,
        authority: AUTHORITY,
        issuedAt,
        expiresAt: issuedAt + COOKIE_MAX_AGE_MS,
      }),
    ),
  );
  const mac = base64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${name}=v1.${body}.${mac}`;
}

function call(method, args) {
  const body = JSON.stringify({
    type: "client-request",
    rpcId: `cli-${Date.now()}`,
    method,
    payload: { args },
  });
  const [host, port] = AUTHORITY.split(":");
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host,
        port: Number(port),
        path: `/api/${method}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          cookie: sessionCookie(),
          host: AUTHORITY,
        },
      },
      (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () => {
          try {
            resolve({ status: response.statusCode, body: JSON.parse(text) });
          } catch {
            resolve({ status: response.statusCode, body: text });
          }
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function main() {
  const [method, argsJson] = process.argv.slice(2);
  if (!method) {
    console.error("usage: node tools/dsh-api.cjs <namespace>/<method> [args-json|@file]");
    process.exit(2);
  }
  // Args may be inline JSON or @path, so a shell never has to quote JSON.
  const raw = argsJson
    ? argsJson.startsWith("@")
      ? fs.readFileSync(argsJson.slice(1), "utf8")
      : argsJson
    : "{}";
  // A UTF-8 BOM is not JSON.
  const args = JSON.parse(raw.replace(/^\uFEFF/, ""));
  const result = await call(method, args);
  console.log(JSON.stringify(result.body, null, 2));
  if (result.status !== 200) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
