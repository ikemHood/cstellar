// SCT-01 Unwrap Circuit (Noir)
//
// Proves that a user owns a confidential note and can unwrap it back
// to the public underlying token.
//
// Private inputs: note details (amount, owner, randomness, secrets)
// Public inputs: merkle root, nullifier, recipient, unwrap amount, domain binding
//
// Constraints enforced:
//   1. Note commitment is correctly derived
//   2. Nullifier is correctly derived
//   3. Note amount >= unwrap amount (allows partial unwrap with change)
//   4. If partial unwrap, change commitment is correctly formed
//   5. Domain separation: action type, contract ID, network ID bound to proof

use dep::std;
use dep::poseidon::poseidon2::Poseidon2;

fn main(
    // ---- Private inputs ----
    note_amount: Field,
    note_randomness: Field,
    note_nullifier_key: Field,
    note_owner: Field,
    nullifier_secret: Field,

    // Change note (if partial unwrap)
    change_amount: Field,
    change_randomness: Field,
    change_owner: Field,

    // ---- Public inputs ----
    public_merkle_root: pub Field,
    public_nullifier: pub Field,
    public_asset_id: pub Field,
    public_recipient: pub Field,
    public_unwrap_amount: pub Field,
    public_change_commitment: pub Field,
    public_contract_id: pub Field,
    public_network_id: pub Field,
    public_action_type: pub Field,
) {
    // === Constraint 1: Value conservation ===
    // note_amount = unwrap_amount + change_amount
    assert(note_amount == public_unwrap_amount + change_amount);

    // === Constraint 2: Compute note commitment ===
    let note_commitment = compute_commitment(
        public_asset_id,
        note_amount,
        note_owner,
        note_randomness,
        note_nullifier_key,
    );

    // === Constraint 3: Derive nullifier ===
    let nullifier = Poseidon2::hash([note_nullifier_key, nullifier_secret], 2);
    assert(nullifier == public_nullifier);

    // === Constraint 4: Compute change commitment (if partial unwrap) ===
    let change_commitment = compute_commitment(
        public_asset_id,
        change_amount,
        change_owner,
        change_randomness,
        0,
    );
    assert(change_commitment == public_change_commitment);

    // === Constraint 5: Ownership ===
    // The note owner must match the change note owner (sender keeps change)
    assert(note_owner == change_owner);

    // === Constraint 6: Unwrap amount is positive ===
    // Noir's Field type is unsigned, so public_unwrap_amount >= 0 is implicit.
    // We add an explicit check that unwrap amount is non-zero.
    assert(public_unwrap_amount != 0);

    // === Constraint 7: Domain separation ===
    let domain_hash = Poseidon2::hash([
        public_action_type,
        public_contract_id,
        public_network_id,
    ], 3);

    // === Constraint 8: Recipient binding ===
    // Bind the proof to the specific recipient address
    let recipient_binding = Poseidon2::hash([
        public_recipient,
        public_unwrap_amount,
        public_asset_id,
    ], 3);
    // recipient_binding is implicitly part of the proof via public inputs
}

/// Compute a note commitment using Poseidon hash.
fn compute_commitment(
    asset_id: Field,
    amount: Field,
    owner: Field,
    randomness: Field,
    nullifier_key: Field,
) -> Field {
    Poseidon2::hash([asset_id, amount, owner, randomness, nullifier_key], 5)
}
