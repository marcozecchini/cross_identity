// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "./libraries/MerkleTree.sol";

/// @title MerkleRelay: A contract enabling cross-blockchain verifications of transactions,
///        receipts and states on a destination blockchain of a source blockchain
/// @notice You can use this contract for submitting new block headers, disputing already submitted block headers and
///         for verifying Merkle Patricia proofs of transactions, receipts and states
contract MerkleTreeTest {
    using MerkleTree for *;

    bytes32[] public roots;
    
    event newRoot(bytes32 root);
    
    function updateTree(bytes[] calldata value) 
        public returns (bytes32) 
    {
        bytes32[] memory leaves = new bytes32[](value.length);
        for (uint i = 0; i < value.length; i++) {
                leaves[i] = keccak256(value[i]);
        }

        roots.push(MerkleTree.calculateMerkleTree(leaves));
        emit newRoot(roots[roots.length-1]);
        return roots[roots.length-1];
    }

    function verifyBlock(bytes32[] calldata proof, bool[] calldata position, bytes calldata blockHeader, bytes32 root)
        public view returns (bool success)
    {   
        success = false;
        for (uint i = 0; i < roots.length; i++){
            if (roots[i] == root) {
                success = MerkleTree.verifyProof(proof, position, keccak256(blockHeader), root);
                return success;
            }
        }

        revert("root is not stored");
    }

    function getRoot() public view returns (bytes32){
        return roots[roots.length-1];
    }   

} 