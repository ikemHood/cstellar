#!/usr/bin/env node

import { readFileSync } from "node:fs";
import * as StellarSdk from "@stellar/stellar-sdk";

const [verifierId, vkPath] = process.argv.slice(2);
const secret = process.env.STELLAR_SECRET_KEY;
const rpcUrl =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const networkPassphrase =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ||
  StellarSdk.Networks.TESTNET;

if (!verifierId || !vkPath || !secret) {
  console.error(
    "usage: STELLAR_SECRET_KEY=S... node scripts/init-verifier-from-vk.mjs VERIFIER_ID verification_key.json"
  );
  process.exit(2);
}

const source = StellarSdk.Keypair.fromSecret(secret);
const admin = source.publicKey();
const rpc = new StellarSdk.rpc.Server(rpcUrl);

function decimalToBytes32(value) {
  const hex = BigInt(value).toString(16).padStart(64, "0");
  if (hex.length > 64) throw new Error("field element exceeds 32 bytes");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function scBytesN(bytes) {
  return StellarSdk.xdr.ScVal.scvBytes(bytes);
}

function scVec(values) {
  return StellarSdk.xdr.ScVal.scvVec(values);
}

function scMap(entries) {
  return StellarSdk.xdr.ScVal.scvMap(
    entries.sort(([a], [b]) => a.localeCompare(b)).map(
      ([key, val]) =>
        new StellarSdk.xdr.ScMapEntry({
          key: StellarSdk.xdr.ScVal.scvSymbol(key),
          val,
        })
    )
  );
}

function g1(point) {
  return concat([decimalToBytes32(point[0]), decimalToBytes32(point[1])]);
}

function g2(point) {
  return concat([
    decimalToBytes32(point[0][0]),
    decimalToBytes32(point[0][1]),
    decimalToBytes32(point[1][0]),
    decimalToBytes32(point[1][1]),
  ]);
}

const vkJson = JSON.parse(readFileSync(vkPath, "utf8"));
const ic = vkJson.IC || vkJson.ic;
const vkVal = scMap([
  ["alpha", scBytesN(g1(vkJson.vk_alpha_1))],
  ["beta", scBytesN(g2(vkJson.vk_beta_2))],
  ["gamma", scBytesN(g2(vkJson.vk_gamma_2))],
  ["delta", scBytesN(g2(vkJson.vk_delta_2))],
  ["ic", scVec(ic.map((point) => scBytesN(g1(point))))],
]);

const account = await rpc.getAccount(admin);
const contract = new StellarSdk.Contract(verifierId);
let tx = new StellarSdk.TransactionBuilder(account, {
  fee: StellarSdk.BASE_FEE,
  networkPassphrase,
})
  .addOperation(
    contract.call(
      "initialize",
      StellarSdk.Address.fromString(admin).toScVal(),
      vkVal,
      StellarSdk.nativeToScVal(1, { type: "u32" })
    )
  )
  .setTimeout(180)
  .build();

const sim = await rpc.simulateTransaction(tx);
if (StellarSdk.rpc.Api.isSimulationError(sim)) {
  throw new Error(`simulation failed: ${sim.error}`);
}

tx = StellarSdk.rpc.assembleTransaction(tx, sim).build();
tx.sign(source);

const sent = await rpc.sendTransaction(tx);
if (sent.status === "ERROR") {
  throw new Error(`send failed: ${sent.errorResult}`);
}

let result = await rpc.getTransaction(sent.hash);
while (result.status === "NOT_FOUND") {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  result = await rpc.getTransaction(sent.hash);
}
if (result.status !== "SUCCESS") {
  throw new Error(`transaction failed: ${result.status}`);
}

console.log("verifier initialized");
