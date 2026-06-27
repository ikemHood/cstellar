#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS="$ROOT/artifacts/circom"
PUBLIC="$ROOT/dapp/public/circuits"
BEACON_PTAU="$ARTIFACTS/pot15_beacon.ptau"
PTAU="$ARTIFACTS/pot15_final.ptau"

mkdir -p "$ARTIFACTS" "$PUBLIC"

if ! command -v circom >/dev/null 2>&1; then
  echo "circom CLI not found. Install circom 2.1.x first." >&2
  exit 1
fi

if [ ! -d "$ROOT/dapp/node_modules/circomlib/circuits" ]; then
  echo "Missing dapp/node_modules/circomlib. Run: cd dapp && npm install" >&2
  exit 1
fi

circom "$ROOT/circuits/circom/sct01.circom" \
  --r1cs \
  --wasm \
  --sym \
  -l "$ROOT/dapp/node_modules" \
  -o "$ARTIFACTS"

if [ ! -f "$PTAU" ]; then
  npx --yes snarkjs@0.7.6 powersoftau new bn128 15 "$ARTIFACTS/pot15_0000.ptau" -v
  npx --yes snarkjs@0.7.6 powersoftau contribute "$ARTIFACTS/pot15_0000.ptau" "$ARTIFACTS/pot15_0001.ptau" \
    --name="sct01-demo-contribution" -v -e="sct01 deterministic hackathon demo entropy"
  npx --yes snarkjs@0.7.6 powersoftau beacon "$ARTIFACTS/pot15_0001.ptau" "$BEACON_PTAU" \
    0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10 -n="sct01-demo-beacon"
  npx --yes snarkjs@0.7.6 powersoftau prepare phase2 "$BEACON_PTAU" "$PTAU" -v
fi

npx --yes snarkjs@0.7.6 groth16 setup "$ARTIFACTS/sct01.r1cs" "$PTAU" "$ARTIFACTS/sct01_0000.zkey"
npx --yes snarkjs@0.7.6 zkey contribute "$ARTIFACTS/sct01_0000.zkey" "$ARTIFACTS/sct01_final.zkey" \
  --name="sct01-demo-zkey" -v -e="sct01 deterministic hackathon zkey entropy"
npx --yes snarkjs@0.7.6 zkey export verificationkey "$ARTIFACTS/sct01_final.zkey" "$ARTIFACTS/verification_key.json"

cp "$ARTIFACTS/sct01_js/sct01.wasm" "$PUBLIC/sct01.wasm"
cp "$ARTIFACTS/sct01_final.zkey" "$PUBLIC/sct01_final.zkey"
cp "$ARTIFACTS/verification_key.json" "$PUBLIC/verification_key.json"

echo "Circuit artifacts written to $PUBLIC"
