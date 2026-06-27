import type { Groth16Proof } from "@/lib/contract";
import type { StoredNote } from "@/store/notes";
import {
  addressToField,
  bigintToBytes,
  bytesToHex,
  fieldFromBytes,
  hexToBytes,
  poseidonHash,
  sha256,
  toField,
} from "@/lib/crypto";

const TREE_DEPTH = 20;

type SnarkJsProof = {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
};

type ProofPack = {
  proof: SnarkJsProof;
  publicSignals: string[];
};

export type MerklePath = {
  pathElements: string[];
  pathIndices: string[];
  root: Uint8Array;
};

type TransferProofArgs = {
  assetId: string;
  merkleRoot: Uint8Array;
  note: StoredNote;
  merklePath: MerklePath;
  nullifier: Uint8Array;
  outAmount: bigint;
  outOwner: string;
  outRandomness: Uint8Array;
  outNullifierKey: Uint8Array;
  outputCommitment: Uint8Array;
  changeAmount: bigint;
  changeOwner: string;
  changeRandomness: Uint8Array;
  changeNullifierKey: Uint8Array;
  changeCommitment: Uint8Array;
  encryptedNoteHashes: Uint8Array[];
  bindingHash: Uint8Array;
};

type UnwrapProofArgs = {
  assetId: string;
  merkleRoot: Uint8Array;
  note: StoredNote;
  merklePath: MerklePath;
  nullifier: Uint8Array;
  recipient: string;
  amount: bigint;
  bindingHash: Uint8Array;
};

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

function proofPackToGroth16Proof(pack: ProofPack): Groth16Proof {
  return {
    a: g1Bytes(pack.proof.pi_a),
    b: g2Bytes(pack.proof.pi_b),
    c: g1Bytes(pack.proof.pi_c),
  };
}

function signal(bytes: Uint8Array): string {
  return fieldFromBytes(bytes).toString();
}

function field(n: bigint | number | string): string {
  return toField(BigInt(n)).toString();
}

function noteFieldInputs(note: StoredNote) {
  return {
    noteAmount: field(note.amount),
    noteOwner: addressToField(note.owner).toString(),
    noteRandomness: signal(hexToBytes(note.randomness)),
    noteNullifierKey: signal(hexToBytes(note.nullifierKey)),
    nullifierSecret: signal(hexToBytes(note.nullifierSecret)),
  };
}

function zeroes(depth: number): bigint[] {
  const z = [0n];
  for (let i = 0; i < depth; i++) {
    z.push(poseidonHash([z[i], z[i]]));
  }
  return z;
}

export function buildMerklePath(
  commitmentLeaves: string[],
  leafIndex: number,
  depth = TREE_DEPTH
): MerklePath {
  if (leafIndex < 0 || leafIndex >= commitmentLeaves.length) {
    throw new Error("note leaf index missing from local tree");
  }
  const zeros = zeroes(depth);
  let level = commitmentLeaves.map((leaf) => fieldFromBytes(hexToBytes(leaf)));
  const pathElements: string[] = [];
  const pathIndices: string[] = [];
  let index = leafIndex;

  for (let d = 0; d < depth; d++) {
    const siblingIndex = index ^ 1;
    const sibling = siblingIndex < level.length ? level[siblingIndex] : zeros[d];
    pathElements.push(sibling.toString());
    pathIndices.push((index & 1).toString());

    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : zeros[d];
      next.push(poseidonHash([left, right]));
    }
    level = next.length > 0 ? next : [zeros[d + 1]];
    index = Math.floor(index / 2);
  }

  return {
    pathElements,
    pathIndices,
    root: bigintToBytes(level[0] ?? zeros[depth]),
  };
}

async function prove(input: Record<string, unknown>): Promise<ProofPack> {
  const snarkjs = await loadSnarkjs();
  const result = await snarkjs.groth16.fullProve(
    input,
    "/circuits/sct01.wasm",
    "/circuits/sct01_final.zkey"
  );
  return {
    proof: result.proof as SnarkJsProof,
    publicSignals: result.publicSignals.map(String),
  };
}

async function loadSnarkjs(): Promise<NonNullable<Window["snarkjs"]>> {
  if (typeof window === "undefined") {
    throw new Error("proof generation is only available in the browser");
  }
  if (window.snarkjs) return window.snarkjs;

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="/vendor/snarkjs.min.js"]'
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("failed to load snarkjs")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = "/vendor/snarkjs.min.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("failed to load snarkjs"));
    document.head.appendChild(script);
  });

  if (!window.snarkjs) throw new Error("snarkjs global was not initialized");
  return window.snarkjs;
}

function assertPublicSignals(pack: ProofPack, action: number, bindingHash: Uint8Array) {
  if (pack.publicSignals[0] !== action.toString()) {
    throw new Error("proof action public signal does not match operation");
  }
  if (pack.publicSignals[1] !== signal(bindingHash)) {
    throw new Error("proof binding public signal does not match operation");
  }
}

export async function generateTransferProof(args: TransferProofArgs): Promise<Groth16Proof> {
  if (args.encryptedNoteHashes.length !== 2) {
    throw new Error("transfer proof requires exactly two encrypted note hashes");
  }
  if (bytesToHex(args.merklePath.root) !== bytesToHex(args.merkleRoot)) {
    throw new Error("local Merkle path root does not match on-chain root");
  }

  const input = {
    action: "2",
    binding: signal(args.bindingHash),
    asset: addressToField(args.assetId).toString(),
    merkleRoot: signal(args.merkleRoot),
    nullifier: signal(args.nullifier),
    pathElements: args.merklePath.pathElements,
    pathIndices: args.merklePath.pathIndices,
    ...noteFieldInputs(args.note),
    outAmount: field(args.outAmount),
    outOwner: addressToField(args.outOwner).toString(),
    outRandomness: signal(args.outRandomness),
    outNullifierKey: signal(args.outNullifierKey),
    outputCommitment: signal(args.outputCommitment),
    changeAmount: field(args.changeAmount),
    changeOwner: addressToField(args.changeOwner).toString(),
    changeRandomness: signal(args.changeRandomness),
    changeNullifierKey: signal(args.changeNullifierKey),
    changeCommitment: signal(args.changeCommitment),
    encryptedNoteHash0: signal(args.encryptedNoteHashes[0]),
    encryptedNoteHash1: signal(args.encryptedNoteHashes[1]),
    recipient: "0",
    unwrapAmount: "0",
  };

  const pack = await prove(input);
  assertPublicSignals(pack, 2, args.bindingHash);
  return proofPackToGroth16Proof(pack);
}

export async function generateUnwrapProof(args: UnwrapProofArgs): Promise<Groth16Proof> {
  if (bytesToHex(args.merklePath.root) !== bytesToHex(args.merkleRoot)) {
    throw new Error("local Merkle path root does not match on-chain root");
  }

  const input = {
    action: "3",
    binding: signal(args.bindingHash),
    asset: addressToField(args.assetId).toString(),
    merkleRoot: signal(args.merkleRoot),
    nullifier: signal(args.nullifier),
    pathElements: args.merklePath.pathElements,
    pathIndices: args.merklePath.pathIndices,
    ...noteFieldInputs(args.note),
    outAmount: "0",
    outOwner: "0",
    outRandomness: "0",
    outNullifierKey: "0",
    outputCommitment: "0",
    changeAmount: "0",
    changeOwner: "0",
    changeRandomness: "0",
    changeNullifierKey: "0",
    changeCommitment: "0",
    encryptedNoteHash0: "0",
    encryptedNoteHash1: "0",
    recipient: addressToField(args.recipient).toString(),
    unwrapAmount: field(args.amount),
  };

  const pack = await prove(input);
  assertPublicSignals(pack, 3, args.bindingHash);
  return proofPackToGroth16Proof(pack);
}

export function encryptedNoteHash(note: Uint8Array): Uint8Array {
  return sha256(note);
}
