# SCT-01: Stellar Confidential Token Wrapper

A confidential token wrapper standard for private transfers on Stellar.

Wrap any Stellar asset into a confidential token, transfer privately, and unwrap back to the original asset when needed.

> **WARNING: This is a hackathon prototype. NOT AUDITED. Do NOT use with real funds.**

## Architecture

```
Browser Groth16 proof     Verifier Contract       Wrapper Contract       dApp
(Circom/snarkjs)      -->  (CAP-0074 BN254)  -->  (CAP-0075 Poseidon) --> (UX)
```

### Components

| Component | Location | Description |
|-----------|----------|-------------|
| Wrapper Contract | `contracts/wrapper/` | Soroban contract managing commitments, nullifiers, and vault |
| Verifier Contract | `contracts/verifier/` | BN254 Groth16 verifier using CAP-0074 host functions |
| Final Circuit | `circuits/circom/sct01.circom` | Circom Groth16 circuit for transfer + unwrap |
| Legacy Circuits | `circuits/transfer/`, `circuits/unwrap/` | Exploratory Noir circuits, not used by the demo verifier |
| TypeScript SDK | `sdk/` | Note management, crypto, proof generation, contract client |
| Demo dApp | `dapp/` | Next.js app with wrap, transfer, receive, unwrap, explorer |

## How It Works

### Note-Based Privacy Model

Instead of encrypted account balances, SCT-01 uses **notes** - discrete units of confidential value.

1. **Wrap**: Deposit public tokens, receive a private note (commitment stored on-chain)
2. **Transfer**: Spend input notes, create output notes. ZK proof proves value conservation without revealing amounts
3. **Unwrap**: Spend a note, receive public tokens back

### What's Hidden

- Transfer amounts
- Confidential balances
- Internal transfer history
- Recipient amounts

### What's Public

- Wrapper contract address
- Transaction submitter
- Wrap/unwrap amounts (entry/exit points)
- Commitments and nullifiers (opaque hashes)

## Quick Start

### Prerequisites

- Rust + `wasm32v1-none` target
- Node.js 20+
- Stellar CLI 26+
- Circom 2.1+ for rebuilding Groth16 artifacts
- Noir (`nargo`) only for the legacy exploratory circuits

### Build Contracts

```bash
# Build Soroban contracts. SDK 26 requires wasm32v1-none.
cargo build --release --target wasm32v1-none

# Contracts output:
# target/wasm32v1-none/release/sct01_wrapper.wasm
# target/wasm32v1-none/release/sct01_verifier.wasm
```

### Deploy to Testnet

```bash
# Generate testnet identity
stellar keys generate --global alice --network testnet

# Use native XLM SAC for the fastest demo asset
stellar contract asset id --asset native --network testnet

# Deploy verifier
stellar contract deploy \
  --wasm target/wasm32v1-none/release/sct01_verifier.wasm \
  --source alice --network testnet

# Deploy wrapper
stellar contract deploy \
  --wasm target/wasm32v1-none/release/sct01_wrapper.wasm \
  --source alice --network testnet

# Initialize verifier from snarkjs verification key
cd dapp
STELLAR_SECRET_KEY=S... \
  node scripts/init-verifier-from-vk.mjs VERIFIER_ID ../dapp/public/circuits/verification_key.json
cd ..

# Initialize wrapper
stellar contract invoke \
  --id WRAPPER_ID --source alice --network testnet -- \
  initialize \
  --admin alice \
  --asset ASSET_SAC_ADDRESS \
  --verifier VERIFIER_ID \
  --name cUSDC --symbol cUSDC --decimals 7
```

For the dApp demo, set `NEXT_PUBLIC_ASSET_ADDRESS` to the SAC contract ID,
`NEXT_PUBLIC_VERIFIER_CONTRACT_ID` to `VERIFIER_ID`, and
`NEXT_PUBLIC_WRAPPER_CONTRACT_ID` to `WRAPPER_ID`.

The verifier no longer has an admin proof-approval path. Transfer and unwrap
require a real Groth16 proof whose public signals are:

```text
[action_type, binding_hash_as_bn254_field]
```

The dApp generates proofs in-browser from:

```text
dapp/public/circuits/sct01.wasm
dapp/public/circuits/sct01_final.zkey
dapp/public/vendor/snarkjs.min.js
```

The current final circuit supports one input note and two output commitments
for transfer: recipient output + change output. Unwrap supports one exact-value
input note.

### Build Final Circuit Artifacts

Artifacts are already generated for the demo. Rebuild them after changing the
Circom circuit:

```bash
cd dapp && npm install
cd ..
./scripts/build-circom-artifacts.sh
```

This writes:

```text
artifacts/circom/sct01.r1cs
artifacts/circom/sct01_final.zkey
artifacts/circom/verification_key.json
dapp/public/circuits/sct01.wasm
dapp/public/circuits/sct01_final.zkey
dapp/public/circuits/verification_key.json
```

### Legacy Noir Circuits

```bash
cd circuits/transfer
nargo compile

cd ../unwrap
nargo compile
```

### Run SDK

```bash
cd sdk
npm install
npm run build
npm test
```

### Run dApp

```bash
cd dapp
cp .env.local.example .env.local
# Edit .env.local with deployed contract addresses
npm install
npm run dev
```

### Demo Flow

1. Deploy and initialize `sct01_verifier` with `dapp/public/circuits/verification_key.json`.
2. Deploy and initialize `sct01_wrapper` with the verifier ID and SAC asset ID.
3. Put `NEXT_PUBLIC_WRAPPER_CONTRACT_ID`, `NEXT_PUBLIC_VERIFIER_CONTRACT_ID`, and `NEXT_PUBLIC_ASSET_ADDRESS` in `dapp/.env.local`.
4. Open `http://localhost:3000`, connect Freighter on testnet.
5. Wrap a small amount. This stores a commitment and local note with Merkle leaf index.
6. Transfer less than the note amount to another `G...` address. Browser generates a real Groth16 proof, contract verifies it on testnet, one nullifier is spent, and two commitments are inserted.
7. Unwrap an exact-value note. Public token transfer is visible; private transfer history remains hidden behind commitments/nullifiers.

## Project Structure

```
cstellar/
├── contracts/
│   ├── wrapper/          # Soroban wrapper contract
│   │   ├── Cargo.toml
│   │   └── src/lib.rs
│   └── verifier/         # Soroban verifier contract
│       ├── Cargo.toml
│       └── src/lib.rs
├── circuits/
│   ├── transfer/         # Noir transfer circuit
│   │   ├── Nargo.toml
│   │   └── src/main.nr
│   └── unwrap/           # Noir unwrap circuit
│       ├── Nargo.toml
│       └── src/main.nr
├── sdk/                  # TypeScript SDK
│   ├── src/
│   │   ├── crypto/       # Commitment, encryption, hashing
│   │   ├── notes/        # Note manager
│   │   ├── proof/        # Proof generator
│   │   └── contract/     # Contract client
│   └── tests/
├── dapp/                 # Next.js demo dApp
│   └── src/
│       ├── app/          # Pages (wrap, transfer, receive, unwrap, explorer)
│       ├── components/   # UI components
│       ├── hooks/        # React hooks (wallet, notes)
│       ├── store/        # Zustand state
│       └── lib/          # Stellar SDK, crypto, contract helpers
├── Cargo.toml            # Workspace root
├── prd.txt               # Product requirements
└── stack.txt             # Tech stack
```

## Security Notes

- **NOT AUDITED** - This is a hackathon prototype
- ZK proof verification uses BN254 Groth16 pairing checks through CAP-0074.
- The wrapper uses Poseidon BN254 hashing through CAP-0075 via
  `soroban-poseidon`.
- The dApp refuses to submit transfer/unwrap without generating a real Groth16
  proof for the current note, root, nullifier, outputs, recipient, and amount.
- `snarkjs` is vendored as a browser bundle to avoid shipping vulnerable npm
  transitive packages in the app dependency graph.
- BN254 and Poseidon/Poseidon2 require Protocol 25+ network/runtime support.
- Notes are stored in browser localStorage and encrypted-note payloads are demo
  JSON. Use real wallet/recipient encryption before production.
- Wrap/unwrap amounts are public (entry/exit points)

## Standard: SCT-01

### Contract Interface

```rust
fn wrap(from, amount, commitment, encrypted_note)
fn confidential_transfer(proof, public_inputs, nullifiers, output_commitments, encrypted_notes)
fn unwrap(proof, public_inputs, nullifier, recipient, amount)
fn is_spent(nullifier) -> bool
fn commitment_exists(commitment) -> bool
fn root() -> BytesN<32>
fn metadata() -> ConfidentialTokenMetadata
```

### Commitment Format

```
commitment = Poseidon(asset_id_field, amount, owner_field, randomness, nullifier_key)
```

### Nullifier Format

```
nullifier = Poseidon(nullifier_key, nullifier_secret)
```

### Events

| Event | Topics | Data |
|-------|--------|------|
| `wrap` | `[wrap, asset, from]` | `{commitment, encrypted_note_hash}` |
| `conf_transfer` | `[conf_transfer, asset]` | `{nullifiers, output_commitments, encrypted_note_hashes}` |
| `unwrap` | `[unwrap, asset, recipient]` | `{nullifier, amount}` |

## Roadmap

- [x] Full BN254 Groth16 verifier contract using CAP-0074 host functions
- [x] Poseidon BN254 incremental Merkle root using CAP-0075 host functions
- [x] Final Circom transfer and unwrap circuit with value conservation and Merkle membership
- [x] Trusted setup and generated testnet proving/verifying artifacts
- [ ] Note encryption with recipient scanning (event-based)
- [ ] View key / selective disclosure
- [ ] Multi-asset support
- [ ] Stealth addresses (Level 3 privacy)
- [ ] Compliance hooks (allowlist/denylist)
- [ ] Mobile wallet support
- [ ] Security audit

## License

MIT
