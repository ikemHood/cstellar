//! SCT-01: Stellar Confidential Token Wrapper
//!
//! Note-based confidential token wrapper. Users deposit public tokens,
//! receive private notes, transfer confidentially, and unwrap back to
//! the original asset.
//!
//! Architecture:
//! - Commitments: Poseidon BN254 hash of note data (stored on-chain)
//! - Nullifiers: Unique per-note spend guards (prevent double-spend)
//! - Proofs: ZK proofs verified by separate verifier contract
//! - Merkle tree: Append-only Poseidon incremental Merkle tree

#![no_std]

use soroban_poseidon::poseidon_hash;
use soroban_sdk::{
    address_payload::AddressPayload,
    contract, contractclient, contracterror, contractimpl, contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    token, Address, Bytes, BytesN, Env, Symbol, Vec, U256,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_NULLIFIERS: u32 = 1;
const MAX_OUTPUTS: u32 = 2;
const TREE_DEPTH: u32 = 20;
const MAX_NOTES: u64 = 1_048_576;

// Domain-separation action tags (embedded in proofs)
const ACTION_TRANSFER: u8 = 0x02;
const ACTION_UNWRAP: u8 = 0x03;

// TTL management (~30 days at 5s ledgers)
const TTL_THRESHOLD: u32 = 17_280;
const TTL_EXTEND: u32 = 518_400;

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Asset,
    Verifier,
    TreeRoot,
    NoteCount,
    Metadata,
    FilledSubtree(u32),
    Nullifier(BytesN<32>),
    Commitment(BytesN<32>),
}

// ---------------------------------------------------------------------------
// Public-input structs
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferPublicInputs {
    pub merkle_root: BytesN<32>,
    pub asset_id: Address,
    pub output_commitments: Vec<BytesN<32>>,
    pub encrypted_note_hashes: Vec<BytesN<32>>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnwrapPublicInputs {
    pub merkle_root: BytesN<32>,
    pub asset_id: Address,
    pub recipient: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Groth16Proof {
    pub a: Bn254G1Affine,
    pub b: Bn254G2Affine,
    pub c: Bn254G1Affine,
}

#[contracttype]
#[derive(Clone)]
pub struct VerifierProofStatement {
    pub proof: Groth16Proof,
    pub pub_signals: Vec<Bn254Fr>,
    pub action_type: u32,
    pub contract_id: Address,
    pub asset_id: Address,
}

#[contractclient(name = "VerifierClient")]
pub trait VerifierGateway {
    fn verify_proof(env: Env, statement: VerifierProofStatement) -> bool;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfidentialTokenMetadata {
    pub name: Symbol,
    pub symbol: Symbol,
    pub decimals: u32,
    pub underlying_asset: Address,
    pub version: u32,
    pub circuit_version: u32,
    pub verifier: Address,
    pub privacy_model: Symbol,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    NullifierAlreadySpent = 4,
    CommitmentAlreadyExists = 5,
    InvalidProof = 6,
    InvalidMerkleRoot = 7,
    AssetMismatch = 8,
    TooManyInputs = 9,
    TooManyOutputs = 10,
    InvalidPublicInputs = 11,
    ProofTooShort = 12,
    DomainMismatch = 13,
    VerifierNotSet = 14,
    ArithmeticOverflow = 15,
    TreeFull = 16,
}

// ---------------------------------------------------------------------------
// Contract trait
// ---------------------------------------------------------------------------

pub trait ConfidentialTokenWrapper {
    /// Return the underlying asset SAC address.
    fn asset(env: Env) -> Address;

    /// Return confidential token metadata.
    fn metadata(env: Env) -> ConfidentialTokenMetadata;

    /// Deposit public tokens and create a confidential note commitment.
    fn wrap(
        env: Env,
        from: Address,
        amount: i128,
        commitment: BytesN<32>,
        encrypted_note: Bytes,
    ) -> Result<(), ContractError>;

    /// Execute a confidential transfer (consumes notes, creates new notes).
    fn confidential_transfer(
        env: Env,
        proof: Groth16Proof,
        public_inputs: TransferPublicInputs,
        nullifiers: Vec<BytesN<32>>,
        output_commitments: Vec<BytesN<32>>,
        encrypted_notes: Vec<Bytes>,
    ) -> Result<(), ContractError>;

    /// Unwrap a confidential note back to the public underlying token.
    fn unwrap(
        env: Env,
        proof: Groth16Proof,
        public_inputs: UnwrapPublicInputs,
        nullifier: BytesN<32>,
        recipient: Address,
        amount: i128,
    ) -> Result<(), ContractError>;

    /// Check whether a nullifier has been spent.
    fn is_spent(env: Env, nullifier: BytesN<32>) -> bool;

    /// Check whether a commitment exists in the tree.
    fn commitment_exists(env: Env, commitment: BytesN<32>) -> bool;

    /// Return the current commitment-tree root.
    fn root(env: Env) -> BytesN<32>;

    /// Return total number of commitments stored.
    fn note_count(env: Env) -> u64;
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct ConfidentialWrapper;

#[contractimpl]
impl ConfidentialWrapper {
    /// Initialize the wrapper. Can only be called once.
    pub fn initialize(
        env: Env,
        admin: Address,
        asset: Address,
        verifier: Address,
        name: Symbol,
        symbol: Symbol,
        decimals: u32,
    ) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Asset, &asset);
        env.storage().instance().set(&DataKey::Verifier, &verifier);

        // Empty incremental Merkle tree root over Poseidon(BN254).
        let empty_root = zero_root(&env);
        env.storage()
            .instance()
            .set(&DataKey::TreeRoot, &empty_root);
        env.storage().instance().set(&DataKey::NoteCount, &0u64);

        let meta = ConfidentialTokenMetadata {
            name,
            symbol,
            decimals,
            underlying_asset: asset,
            version: 1,
            circuit_version: 1,
            verifier,
            privacy_model: Symbol::new(&env, "note_commitment_v1"),
        };
        env.storage().instance().set(&DataKey::Metadata, &meta);

        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);

        Ok(())
    }

    // -- Core flows ---------------------------------------------------------

    /// Wrap: lock public tokens, store commitment.
    pub fn wrap(
        env: Env,
        from: Address,
        amount: i128,
        commitment: BytesN<32>,
        encrypted_note: Bytes,
    ) -> Result<(), ContractError> {
        from.require_auth();

        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Commitment(commitment.clone()))
        {
            return Err(ContractError::CommitmentAlreadyExists);
        }

        // Transfer underlying tokens from user → wrapper contract
        let asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::Asset)
            .ok_or(ContractError::NotInitialized)?;
        let token_client = token::Client::new(&env, &asset);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        insert_commitment(&env, &commitment)?;

        // Emit wrap event
        let enc_note_hash: BytesN<32> = env.crypto().sha256(&encrypted_note).into();
        env.events().publish(
            (Symbol::new(&env, "wrap"), asset.clone(), from.clone()),
            (commitment.clone(), enc_note_hash),
        );

        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);

        Ok(())
    }

    /// Confidential transfer: spend input notes, create output notes.
    pub fn confidential_transfer(
        env: Env,
        proof: Groth16Proof,
        public_inputs: TransferPublicInputs,
        nullifiers: Vec<BytesN<32>>,
        output_commitments: Vec<BytesN<32>>,
        encrypted_notes: Vec<Bytes>,
    ) -> Result<(), ContractError> {
        // --- Validate sizes ------------------------------------------------
        if nullifiers.len() != MAX_NULLIFIERS {
            return Err(ContractError::TooManyInputs);
        }
        if output_commitments.len() != MAX_OUTPUTS {
            return Err(ContractError::TooManyOutputs);
        }
        if encrypted_notes.len() != output_commitments.len()
            || public_inputs.output_commitments.len() != output_commitments.len()
            || public_inputs.encrypted_note_hashes.len() != encrypted_notes.len()
        {
            return Err(ContractError::InvalidPublicInputs);
        }
        // --- Validate asset binding ----------------------------------------
        let asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::Asset)
            .ok_or(ContractError::NotInitialized)?;
        if public_inputs.asset_id != asset {
            return Err(ContractError::AssetMismatch);
        }

        // --- Validate Merkle root ------------------------------------------
        let current_root: BytesN<32> = env.storage().instance().get(&DataKey::TreeRoot).unwrap();
        if public_inputs.merkle_root != current_root {
            return Err(ContractError::InvalidMerkleRoot);
        }

        // Validate output commitments and encrypted-note hashes match public inputs.
        let mut enc_hashes: Vec<BytesN<32>> = Vec::new(&env);
        for i in 0..output_commitments.len() {
            let expected_cm = public_inputs.output_commitments.get(i).unwrap();
            let actual_cm = output_commitments.get(i).unwrap();
            if expected_cm != actual_cm {
                return Err(ContractError::InvalidPublicInputs);
            }

            let note_bytes = encrypted_notes.get(i).unwrap();
            let hash: BytesN<32> = env.crypto().sha256(&note_bytes).into();
            let expected_hash = public_inputs.encrypted_note_hashes.get(i).unwrap();
            if expected_hash != hash {
                return Err(ContractError::InvalidPublicInputs);
            }
            enc_hashes.push_back(hash);
        }

        let binding_hash = transfer_binding_hash(
            &env,
            ACTION_TRANSFER,
            &current_root,
            &asset,
            &nullifiers,
            &output_commitments,
            &enc_hashes,
        )?;
        verify_proof_binding(&env, proof, ACTION_TRANSFER, &asset, &binding_hash)?;

        // --- Check & mark nullifiers (double-spend guard) ------------------
        for i in 0..nullifiers.len() {
            let nf = nullifiers.get(i).unwrap();
            let key = DataKey::Nullifier(nf.clone());
            if env.storage().persistent().has(&key) {
                return Err(ContractError::NullifierAlreadySpent);
            }
            env.storage().persistent().set(&key, &true);
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);
        }

        // --- Store output commitments --------------------------------------
        for i in 0..output_commitments.len() {
            let cm = output_commitments.get(i).unwrap();
            insert_commitment(&env, &cm)?;
        }

        // --- Emit transfer event -------------------------------------------
        env.events().publish(
            (Symbol::new(&env, "conf_transfer"), asset.clone()),
            (nullifiers, output_commitments, enc_hashes),
        );

        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);

        Ok(())
    }

    /// Unwrap: spend a confidential note, release public tokens.
    pub fn unwrap(
        env: Env,
        proof: Groth16Proof,
        public_inputs: UnwrapPublicInputs,
        nullifier: BytesN<32>,
        recipient: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }
        // Validate asset
        let asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::Asset)
            .ok_or(ContractError::NotInitialized)?;
        if public_inputs.asset_id != asset {
            return Err(ContractError::AssetMismatch);
        }
        if public_inputs.recipient != recipient {
            return Err(ContractError::InvalidPublicInputs);
        }
        if public_inputs.amount != amount {
            return Err(ContractError::InvalidPublicInputs);
        }

        // Validate Merkle root
        let current_root: BytesN<32> = env.storage().instance().get(&DataKey::TreeRoot).unwrap();
        if public_inputs.merkle_root != current_root {
            return Err(ContractError::InvalidMerkleRoot);
        }

        let binding_hash = unwrap_binding_hash(
            &env,
            ACTION_UNWRAP,
            &current_root,
            &asset,
            &recipient,
            &nullifier,
            amount,
        )?;
        verify_proof_binding(&env, proof, ACTION_UNWRAP, &asset, &binding_hash)?;

        // Check & mark nullifier
        let nf_key = DataKey::Nullifier(nullifier.clone());
        if env.storage().persistent().has(&nf_key) {
            return Err(ContractError::NullifierAlreadySpent);
        }
        env.storage().persistent().set(&nf_key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&nf_key, TTL_THRESHOLD, TTL_EXTEND);

        // Transfer underlying tokens from wrapper vault → recipient
        let token_client = token::Client::new(&env, &asset);
        token_client.transfer(&env.current_contract_address(), &recipient, &amount);

        // Emit unwrap event (amount is public because token transfer is public)
        env.events().publish(
            (
                Symbol::new(&env, "unwrap"),
                asset.clone(),
                recipient.clone(),
            ),
            (nullifier, amount),
        );

        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);

        Ok(())
    }

    // -- View functions -----------------------------------------------------

    pub fn is_spent(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Nullifier(nullifier))
    }

    pub fn commitment_exists(env: Env, commitment: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Commitment(commitment))
    }

    pub fn root(env: Env) -> BytesN<32> {
        env.storage()
            .instance()
            .get(&DataKey::TreeRoot)
            .unwrap_or(zero_root(&env))
    }

    pub fn note_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NoteCount)
            .unwrap_or(0)
    }

    pub fn asset(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Asset).unwrap()
    }

    pub fn metadata(env: Env) -> ConfidentialTokenMetadata {
        env.storage().instance().get(&DataKey::Metadata).unwrap()
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn bytesn_to_u256(env: &Env, value: &BytesN<32>) -> U256 {
    U256::from_be_bytes(env, &Bytes::from_slice(env, &value.to_array()))
}

fn u256_to_bytesn(value: U256) -> BytesN<32> {
    Bn254Fr::from_u256(value).to_bytes()
}

fn zero_at_level(env: &Env, level: u32) -> BytesN<32> {
    let mut zero = BytesN::from_array(env, &[0u8; 32]);
    for _ in 0..level {
        zero = hash_pair(env, &zero, &zero);
    }
    zero
}

fn zero_root(env: &Env) -> BytesN<32> {
    zero_at_level(env, TREE_DEPTH)
}

/// Poseidon BN254 Merkle hash: H(left || right), matching circomlib Poseidon.
fn hash_pair(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    let inputs = soroban_sdk::vec![env, bytesn_to_u256(env, a), bytesn_to_u256(env, b)];
    u256_to_bytesn(poseidon_hash::<3, Bn254Fr>(env, &inputs))
}

fn insert_commitment(env: &Env, commitment: &BytesN<32>) -> Result<(), ContractError> {
    let key = DataKey::Commitment(commitment.clone());
    if env.storage().persistent().has(&key) {
        return Err(ContractError::CommitmentAlreadyExists);
    }

    let count: u64 = env
        .storage()
        .instance()
        .get(&DataKey::NoteCount)
        .unwrap_or(0);
    if count >= MAX_NOTES {
        return Err(ContractError::TreeFull);
    }

    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);

    let mut index = count;
    let mut current = commitment.clone();
    let mut zero = BytesN::from_array(env, &[0u8; 32]);
    for level in 0..TREE_DEPTH {
        let subtree_key = DataKey::FilledSubtree(level);
        if index % 2 == 0 {
            env.storage().instance().set(&subtree_key, &current);
            current = hash_pair(env, &current, &zero);
        } else {
            let left: BytesN<32> = env
                .storage()
                .instance()
                .get(&subtree_key)
                .unwrap_or(zero.clone());
            current = hash_pair(env, &left, &current);
        }
        zero = hash_pair(env, &zero, &zero);
        index /= 2;
    }

    env.storage().instance().set(&DataKey::TreeRoot, &current);
    env.storage()
        .instance()
        .set(&DataKey::NoteCount, &(count + 1));

    Ok(())
}

fn address_payload_bytes(address: &Address) -> Result<BytesN<32>, ContractError> {
    match address.to_payload() {
        Some(AddressPayload::AccountIdPublicKeyEd25519(bytes)) => Ok(bytes),
        Some(AddressPayload::ContractIdHash(bytes)) => Ok(bytes),
        None => Err(ContractError::InvalidPublicInputs),
    }
}

fn poseidon_pair(env: &Env, left: U256, right: U256) -> U256 {
    let inputs = soroban_sdk::vec![env, left, right];
    poseidon_hash::<3, Bn254Fr>(env, &inputs)
}

fn bytesn_field(env: &Env, value: &BytesN<32>) -> U256 {
    Bn254Fr::from_u256(bytesn_to_u256(env, value)).to_u256()
}

fn amount_field(env: &Env, amount: i128) -> Result<U256, ContractError> {
    if amount < 0 {
        return Err(ContractError::InvalidAmount);
    }
    Ok(U256::from_u128(env, amount as u128))
}

fn transfer_binding_hash(
    env: &Env,
    action: u8,
    root: &BytesN<32>,
    asset: &Address,
    nullifiers: &Vec<BytesN<32>>,
    output_commitments: &Vec<BytesN<32>>,
    encrypted_note_hashes: &Vec<BytesN<32>>,
) -> Result<BytesN<32>, ContractError> {
    if nullifiers.len() != MAX_NULLIFIERS
        || output_commitments.len() != MAX_OUTPUTS
        || encrypted_note_hashes.len() != MAX_OUTPUTS
    {
        return Err(ContractError::InvalidPublicInputs);
    }

    let mut acc = poseidon_pair(
        env,
        U256::from_u32(env, action as u32),
        bytesn_field(env, root),
    );
    acc = poseidon_pair(env, acc, bytesn_field(env, &address_payload_bytes(asset)?));
    acc = poseidon_pair(env, acc, bytesn_field(env, &nullifiers.get(0).unwrap()));
    acc = poseidon_pair(
        env,
        acc,
        bytesn_field(env, &output_commitments.get(0).unwrap()),
    );
    acc = poseidon_pair(
        env,
        acc,
        bytesn_field(env, &output_commitments.get(1).unwrap()),
    );
    acc = poseidon_pair(
        env,
        acc,
        bytesn_field(env, &encrypted_note_hashes.get(0).unwrap()),
    );
    acc = poseidon_pair(
        env,
        acc,
        bytesn_field(env, &encrypted_note_hashes.get(1).unwrap()),
    );
    Ok(u256_to_bytesn(acc))
}

fn unwrap_binding_hash(
    env: &Env,
    action: u8,
    root: &BytesN<32>,
    asset: &Address,
    recipient: &Address,
    nullifier: &BytesN<32>,
    amount: i128,
) -> Result<BytesN<32>, ContractError> {
    let mut acc = poseidon_pair(
        env,
        U256::from_u32(env, action as u32),
        bytesn_field(env, root),
    );
    acc = poseidon_pair(env, acc, bytesn_field(env, &address_payload_bytes(asset)?));
    acc = poseidon_pair(
        env,
        acc,
        bytesn_field(env, &address_payload_bytes(recipient)?),
    );
    acc = poseidon_pair(env, acc, bytesn_field(env, nullifier));
    acc = poseidon_pair(env, acc, amount_field(env, amount)?);
    Ok(u256_to_bytesn(acc))
}

/// Verify proof structure and domain binding.
///
/// In production this calls the dedicated verifier contract for full Groth16
/// pairing checks. For the hackathon MVP it validates:
///   1. Minimum proof length
///   2. Action-type tag embedded in proof matches expected action
///   3. Proof binds to the correct asset address
fn verify_proof_binding(
    env: &Env,
    proof: Groth16Proof,
    action: u8,
    asset: &Address,
    expected_binding: &BytesN<32>,
) -> Result<(), ContractError> {
    let verifier: Address = env
        .storage()
        .instance()
        .get(&DataKey::Verifier)
        .ok_or(ContractError::VerifierNotSet)?;
    let pub_signals = soroban_sdk::vec![
        env,
        Bn254Fr::from_u256(U256::from_u32(env, action as u32)),
        Bn254Fr::from_bytes(expected_binding.clone())
    ];
    let statement = VerifierProofStatement {
        proof,
        pub_signals,
        action_type: action as u32,
        contract_id: env.current_contract_address(),
        asset_id: asset.clone(),
    };

    let verifier_client = VerifierClient::new(env, &verifier);
    if !verifier_client.verify_proof(&statement) {
        return Err(ContractError::InvalidProof);
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup() -> (Env, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(ConfidentialWrapper, ());
        let admin = Address::generate(&env);
        let asset = Address::generate(&env);
        let verifier = Address::generate(&env);

        let client = ConfidentialWrapperClient::new(&env, &contract_id);
        client.initialize(
            &admin,
            &asset,
            &verifier,
            &Symbol::new(&env, "cUSDC"),
            &Symbol::new(&env, "cUSDC"),
            &7,
        );

        (env, contract_id, admin, asset)
    }

    #[test]
    fn test_initialize() {
        let (env, contract_id, _admin, asset) = setup();
        let client = ConfidentialWrapperClient::new(&env, &contract_id);

        assert_eq!(client.asset(), asset);
        assert_eq!(client.note_count(), 0);
        assert_eq!(client.root(), zero_root(&env));
    }

    #[test]
    fn test_initialize_prevents_reinit() {
        let (env, contract_id, admin, asset) = setup();
        let client = ConfidentialWrapperClient::new(&env, &contract_id);

        let result = client.try_initialize(
            &admin,
            &asset,
            &Address::generate(&env),
            &Symbol::new(&env, "cUSDC"),
            &Symbol::new(&env, "cUSDC"),
            &7,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_commitment_and_nullifier_queries() {
        let (env, contract_id, _, _) = setup();
        let client = ConfidentialWrapperClient::new(&env, &contract_id);

        let cm = BytesN::from_array(&env, &[1u8; 32]);
        let nf = BytesN::from_array(&env, &[2u8; 32]);

        assert!(!client.commitment_exists(&cm));
        assert!(!client.is_spent(&nf));
    }

    #[test]
    fn test_metadata() {
        let (env, contract_id, _, asset) = setup();
        let client = ConfidentialWrapperClient::new(&env, &contract_id);

        let meta = client.metadata();
        assert_eq!(meta.underlying_asset, asset);
        assert_eq!(meta.version, 1);
        assert_eq!(meta.circuit_version, 1);
        assert_eq!(meta.decimals, 7);
    }
}
