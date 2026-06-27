pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

template Hash2() {
    signal input left;
    signal input right;
    signal output out;

    component poseidon = Poseidon(2);
    poseidon.inputs[0] <== left;
    poseidon.inputs[1] <== right;
    out <== poseidon.out;
}

template NoteCommitment() {
    signal input asset;
    signal input amount;
    signal input owner;
    signal input randomness;
    signal input nullifierKey;
    signal output commitment;

    component poseidon = Poseidon(5);
    poseidon.inputs[0] <== asset;
    poseidon.inputs[1] <== amount;
    poseidon.inputs[2] <== owner;
    poseidon.inputs[3] <== randomness;
    poseidon.inputs[4] <== nullifierKey;
    commitment <== poseidon.out;
}

template MerkleRoot(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    signal level[depth + 1];
    signal left[depth];
    signal right[depth];
    signal diff[depth];
    component hashes[depth];

    level[0] <== leaf;
    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (pathIndices[i] - 1) === 0;
        diff[i] <== pathElements[i] - level[i];
        left[i] <== level[i] + pathIndices[i] * diff[i];
        right[i] <== pathElements[i] - pathIndices[i] * diff[i];
        hashes[i] = Hash2();
        hashes[i].left <== left[i];
        hashes[i].right <== right[i];
        level[i + 1] <== hashes[i].out;
    }
    root <== level[depth];
}

template SCT01(depth) {
    signal input action;
    signal input binding;

    signal input asset;
    signal input merkleRoot;
    signal input nullifier;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    signal input noteAmount;
    signal input noteOwner;
    signal input noteRandomness;
    signal input noteNullifierKey;
    signal input nullifierSecret;

    signal input outAmount;
    signal input outOwner;
    signal input outRandomness;
    signal input outNullifierKey;
    signal input outputCommitment;

    signal input changeAmount;
    signal input changeOwner;
    signal input changeRandomness;
    signal input changeNullifierKey;
    signal input changeCommitment;

    signal input encryptedNoteHash0;
    signal input encryptedNoteHash1;

    signal input recipient;
    signal input unwrapAmount;

    component isTransfer = IsEqual();
    isTransfer.in[0] <== action;
    isTransfer.in[1] <== 2;

    component isUnwrap = IsEqual();
    isUnwrap.in[0] <== action;
    isUnwrap.in[1] <== 3;

    isTransfer.out + isUnwrap.out === 1;

    component inputCommitment = NoteCommitment();
    inputCommitment.asset <== asset;
    inputCommitment.amount <== noteAmount;
    inputCommitment.owner <== noteOwner;
    inputCommitment.randomness <== noteRandomness;
    inputCommitment.nullifierKey <== noteNullifierKey;

    component tree = MerkleRoot(depth);
    tree.leaf <== inputCommitment.commitment;
    for (var i = 0; i < depth; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }
    tree.root === merkleRoot;

    component nullifierHash = Hash2();
    nullifierHash.left <== noteNullifierKey;
    nullifierHash.right <== nullifierSecret;
    nullifierHash.out === nullifier;

    component outputNote = NoteCommitment();
    outputNote.asset <== asset;
    outputNote.amount <== outAmount;
    outputNote.owner <== outOwner;
    outputNote.randomness <== outRandomness;
    outputNote.nullifierKey <== outNullifierKey;

    component changeNote = NoteCommitment();
    changeNote.asset <== asset;
    changeNote.amount <== changeAmount;
    changeNote.owner <== changeOwner;
    changeNote.randomness <== changeRandomness;
    changeNote.nullifierKey <== changeNullifierKey;

    isTransfer.out * (noteAmount - outAmount - changeAmount) === 0;
    isTransfer.out * (outputNote.commitment - outputCommitment) === 0;
    isTransfer.out * (changeNote.commitment - changeCommitment) === 0;

    isUnwrap.out * (noteAmount - unwrapAmount) === 0;

    component t0 = Hash2();
    component t1 = Hash2();
    component t2 = Hash2();
    component t3 = Hash2();
    component t4 = Hash2();
    component t5 = Hash2();
    component t6 = Hash2();
    t0.left <== action;
    t0.right <== merkleRoot;
    t1.left <== t0.out;
    t1.right <== asset;
    t2.left <== t1.out;
    t2.right <== nullifier;
    t3.left <== t2.out;
    t3.right <== outputCommitment;
    t4.left <== t3.out;
    t4.right <== changeCommitment;
    t5.left <== t4.out;
    t5.right <== encryptedNoteHash0;
    t6.left <== t5.out;
    t6.right <== encryptedNoteHash1;

    component u0 = Hash2();
    component u1 = Hash2();
    component u2 = Hash2();
    component u3 = Hash2();
    component u4 = Hash2();
    u0.left <== action;
    u0.right <== merkleRoot;
    u1.left <== u0.out;
    u1.right <== asset;
    u2.left <== u1.out;
    u2.right <== recipient;
    u3.left <== u2.out;
    u3.right <== nullifier;
    u4.left <== u3.out;
    u4.right <== unwrapAmount;

    isTransfer.out * (t6.out - binding) === 0;
    isUnwrap.out * (u4.out - binding) === 0;
}

component main { public [action, binding] } = SCT01(20);
