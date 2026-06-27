#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

const [proofPath, publicPath, outPath] = process.argv.slice(2);

if (!proofPath || !publicPath || !outPath) {
  console.error(
    "usage: node scripts/pack-snarkjs-proof.mjs proof.json public.json dapp/public/proofs/transfer-proof.json"
  );
  process.exit(2);
}

const proof = JSON.parse(readFileSync(proofPath, "utf8"));
const publicSignals = JSON.parse(readFileSync(publicPath, "utf8")).map(String);

if (!Array.isArray(publicSignals) || publicSignals.length < 2) {
  throw new Error("public.json must contain at least [action, binding]");
}

writeFileSync(
  outPath,
  `${JSON.stringify({ proof, publicSignals }, null, 2)}\n`
);

console.log(`wrote ${outPath}`);
