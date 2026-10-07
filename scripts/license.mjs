#!/usr/bin/env node
// Seller-side license tool. The app only holds the public key and checks
// the signature offline; the private key never goes into this repository.
//
//   node scripts/license.mjs keygen --out <dir>
//       writes <dir>/omopet-license-private.pem (keep it secret, back it up)
//       and prints the public key to paste into src-tauri/src/license.rs
//   node scripts/license.mjs issue --key <private.pem> --id <buyer-or-batch> [--packs band] [--file out.omopet-license]
//       prints one license key (and optionally writes a license file)
//
// Key format: OMOPET1-<base64url(payload json)>.<base64url(ed25519 signature)>
// payload: {"v":1,"packs":["band"],"id":"<buyer-or-batch>","iat":"YYYY-MM-DD"}
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

const KNOWN_PACKS = ["band"];
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (cmd === "keygen") {
  const out = opt("out") ?? fail("--out <dir> is required");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  mkdirSync(out, { recursive: true });
  const pem = join(out, "omopet-license-private.pem");
  writeFileSync(pem, privateKey.export({ type: "pkcs8", format: "pem" }), { flag: "wx" });
  chmodSync(pem, 0o600);
  const raw = publicKey.export({ format: "jwk" }).x; // base64url of the 32 raw bytes
  console.log(`private key: ${pem}`);
  console.log(`PUBLIC_KEY (paste into license.rs): ${raw}`);
} else if (cmd === "issue") {
  const keyPath = opt("key") ?? fail("--key <private.pem> is required");
  const id = opt("id") ?? fail("--id <buyer-or-batch> is required");
  const packs = (opt("packs") ?? "band").split(",").map((p) => p.trim());
  for (const p of packs) if (!KNOWN_PACKS.includes(p)) fail(`unknown pack: ${p}`);
  const payload = Buffer.from(
    JSON.stringify({ v: 1, packs, id, iat: new Date().toISOString().slice(0, 10) }),
  );
  const key = createPrivateKey(readFileSync(keyPath));
  const sig = sign(null, payload, key);
  const license = `OMOPET1-${payload.toString("base64url")}.${sig.toString("base64url")}`;
  console.log(license);
  const file = opt("file");
  if (file) {
    writeFileSync(
      file,
      `# 오모팻 라이선스 / omo-pet license (${packs.join(", ")})\n` +
        `# 앱의 설정 › 밴드 › "라이선스 파일 가져오기"로 여세요.\n` +
        `# Open it from Settings › Band › "Import license file".\n${license}\n`,
    );
    console.error(`wrote ${file}`);
  }
} else {
  fail("usage: license.mjs keygen --out <dir> | issue --key <pem> --id <id> [--packs band] [--file <path>]");
}
