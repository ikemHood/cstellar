// SCT-01 SDK - Groth16 proof helpers.
//
// This module intentionally does not generate fake proofs. It converts real
// snarkjs Groth16 proof packs into the byte layout expected by the Soroban
// BN254 verifier contract.

import { bytesToBigint } from "../crypto/hash.js";

const BN254_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export interface Groth16Proof {
  a: Uint8Array;
  b: Uint8Array;
  c: Uint8Array;
}

export interface SnarkJsProof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
}

export interface ProofPack {
  proof: SnarkJsProof;
  publicSignals: string[];
}

function decimalToBytes32(value: string): Uint8Array {
  const n = BigInt(value);
  if (n < 0n) throw new Error("negative field element");
  const hex = n.toString(16).padStart(64, "0");
  if (hex.length > 64) throw new Error("field element exceeds 32 bytes");

  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function g1Bytes(point: [string, string, string]): Uint8Array {
  return concat([decimalToBytes32(point[0]), decimalToBytes32(point[1])]);
}

function g2Bytes(point: [[string, string], [string, string], [string, string]]): Uint8Array {
  const [x, y] = point;
  return concat([
    decimalToBytes32(x[1]),
    decimalToBytes32(x[0]),
    decimalToBytes32(y[1]),
    decimalToBytes32(y[0]),
  ]);
}

export function bindingSignal(bindingHash: Uint8Array): string {
  return (bytesToBigint(bindingHash) % BN254_MODULUS).toString();
}

export function proofPackToGroth16Proof(
  pack: ProofPack,
  actionType: number,
  bindingHash: Uint8Array
): Groth16Proof {
  if (pack.publicSignals[0] !== actionType.toString()) {
    throw new Error("proof action public signal does not match operation");
  }
  if (pack.publicSignals[1] !== bindingSignal(bindingHash)) {
    throw new Error("proof binding public signal does not match operation");
  }

  return {
    a: g1Bytes(pack.proof.pi_a),
    b: g2Bytes(pack.proof.pi_b),
    c: g1Bytes(pack.proof.pi_c),
  };
}

export class ProofGenerator {
  async generateTransferProof(): Promise<never> {
    throw new Error(
      "Real Groth16 proving artifacts are required. Generate proof.json/public.json with snarkjs, then use proofPackToGroth16Proof()."
    );
  }

  async generateUnwrapProof(): Promise<never> {
    throw new Error(
      "Real Groth16 proving artifacts are required. Generate proof.json/public.json with snarkjs, then use proofPackToGroth16Proof()."
    );
  }
}
