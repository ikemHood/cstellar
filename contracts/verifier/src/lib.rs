//! SCT-01 BN254 Groth16 verifier.
//!
//! Uses CAP-0074 BN254 host functions through `soroban-sdk` Protocol 25+
//! bindings. Verification key is stored once at initialization so the wrapper
//! can call this contract for transfer and unwrap proofs.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    Address, Env, Symbol, Vec, U256,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    VerificationKey,
    ProofCount,
    CircuitVersion,
}

#[contracttype]
#[derive(Clone)]
pub struct VerificationKey {
    pub alpha: Bn254G1Affine,
    pub beta: Bn254G2Affine,
    pub gamma: Bn254G2Affine,
    pub delta: Bn254G2Affine,
    pub ic: Vec<Bn254G1Affine>,
}

#[contracttype]
#[derive(Clone)]
pub struct Groth16Proof {
    pub a: Bn254G1Affine,
    pub b: Bn254G2Affine,
    pub c: Bn254G1Affine,
}

#[contracttype]
#[derive(Clone)]
pub struct ProofStatement {
    pub proof: Groth16Proof,
    pub pub_signals: Vec<Bn254Fr>,
    pub action_type: u32,
    pub contract_id: Address,
    pub asset_id: Address,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VerifierError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidProof = 3,
    InvalidActionType = 4,
    MalformedVerificationKey = 5,
    PublicSignalMismatch = 6,
}

#[contract]
pub struct Verifier;

#[contractimpl]
impl Verifier {
    pub fn initialize(
        env: Env,
        admin: Address,
        vk: VerificationKey,
        circuit_version: u32,
    ) -> Result<(), VerifierError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(VerifierError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::VerificationKey, &vk);
        env.storage().instance().set(&DataKey::ProofCount, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::CircuitVersion, &circuit_version);
        env.storage().instance().extend_ttl(17_280, 518_400);

        Ok(())
    }

    pub fn verify_proof(env: Env, statement: ProofStatement) -> Result<bool, VerifierError> {
        if statement.action_type < 1 || statement.action_type > 3 {
            return Err(VerifierError::InvalidActionType);
        }

        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::VerificationKey)
            .ok_or(VerifierError::NotInitialized)?;

        if statement.pub_signals.len() + 1 != vk.ic.len() {
            return Err(VerifierError::MalformedVerificationKey);
        }

        let action_signal = statement
            .pub_signals
            .get(0)
            .ok_or(VerifierError::PublicSignalMismatch)?;
        if action_signal.to_u256() != U256::from_u32(&env, statement.action_type) {
            return Err(VerifierError::PublicSignalMismatch);
        }

        let bn = env.crypto().bn254();
        let mut vk_x = vk
            .ic
            .get(0)
            .ok_or(VerifierError::MalformedVerificationKey)?;
        for (signal, ic_point) in statement.pub_signals.iter().zip(vk.ic.iter().skip(1)) {
            let product = bn.g1_mul(&ic_point, &signal);
            vk_x = bn.g1_add(&vk_x, &product);
        }

        let neg_a = -statement.proof.a;
        let vp1 = soroban_sdk::vec![&env, neg_a, vk.alpha, vk_x, statement.proof.c];
        let vp2 = soroban_sdk::vec![&env, statement.proof.b, vk.beta, vk.gamma, vk.delta];
        let valid = bn.pairing_check(vp1, vp2);

        if !valid {
            return Err(VerifierError::InvalidProof);
        }

        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ProofCount)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::ProofCount, &(count + 1));
        env.events().publish(
            (Symbol::new(&env, "proof_verified"), statement.action_type),
            (statement.contract_id, statement.asset_id),
        );
        env.storage().instance().extend_ttl(17_280, 518_400);

        Ok(true)
    }

    pub fn update_vk(
        env: Env,
        vk: VerificationKey,
        circuit_version: u32,
    ) -> Result<(), VerifierError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(VerifierError::NotInitialized)?;
        admin.require_auth();

        env.storage().instance().set(&DataKey::VerificationKey, &vk);
        env.storage()
            .instance()
            .set(&DataKey::CircuitVersion, &circuit_version);
        env.storage().instance().extend_ttl(17_280, 518_400);

        Ok(())
    }

    pub fn circuit_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::CircuitVersion)
            .unwrap_or(0)
    }

    pub fn proof_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::ProofCount)
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, BytesN};

    fn zero_g1(env: &Env) -> Bn254G1Affine {
        Bn254G1Affine::from_bytes(BytesN::from_array(env, &[0u8; 64]))
    }

    fn zero_g2(env: &Env) -> Bn254G2Affine {
        Bn254G2Affine::from_bytes(BytesN::from_array(env, &[0u8; 128]))
    }

    fn proof(env: &Env) -> Groth16Proof {
        Groth16Proof {
            a: zero_g1(env),
            b: zero_g2(env),
            c: zero_g1(env),
        }
    }

    fn vk(env: &Env, ic_len: u32) -> VerificationKey {
        let mut ic = Vec::new(env);
        for _ in 0..ic_len {
            ic.push_back(zero_g1(env));
        }
        VerificationKey {
            alpha: zero_g1(env),
            beta: zero_g2(env),
            gamma: zero_g2(env),
            delta: zero_g2(env),
            ic,
        }
    }

    fn setup(ic_len: u32) -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(Verifier, ());
        let admin = Address::generate(&env);
        let client = VerifierClient::new(&env, &contract_id);
        client.initialize(&admin, &vk(&env, ic_len), &1);

        (env, contract_id)
    }

    #[test]
    fn test_initialize() {
        let (env, contract_id) = setup(3);
        let client = VerifierClient::new(&env, &contract_id);
        assert_eq!(client.circuit_version(), 1);
        assert_eq!(client.proof_count(), 0);
    }

    #[test]
    fn test_reject_bad_action() {
        let (env, contract_id) = setup(3);
        let client = VerifierClient::new(&env, &contract_id);
        let statement = ProofStatement {
            proof: proof(&env),
            pub_signals: soroban_sdk::vec![&env, Bn254Fr::from_u256(U256::from_u32(&env, 9))],
            action_type: 9,
            contract_id: Address::generate(&env),
            asset_id: Address::generate(&env),
        };

        let result = client.try_verify_proof(&statement);
        assert!(result.is_err());
    }

    #[test]
    fn test_reject_vk_signal_len_mismatch() {
        let (env, contract_id) = setup(3);
        let client = VerifierClient::new(&env, &contract_id);
        let statement = ProofStatement {
            proof: proof(&env),
            pub_signals: soroban_sdk::vec![&env, Bn254Fr::from_u256(U256::from_u32(&env, 2))],
            action_type: 2,
            contract_id: Address::generate(&env),
            asset_id: Address::generate(&env),
        };

        let result = client.try_verify_proof(&statement);
        assert!(result.is_err());
    }
}
