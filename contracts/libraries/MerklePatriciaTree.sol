// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

library MerklePatriciaTree {
    
    function calculateMerkleTree(bytes32[] memory leaves)
        internal pure
        returns (bytes32)
    {
        if (leaves.length == 1) {
            return leaves[0];
        }

        bytes32[] memory hashes = new bytes32[]( leaves.length % 2  == 0 ? leaves.length / 2 : (leaves.length / 2) + 1);
        uint256 j = 0;
        for (uint256 i = 0; i < hashes.length; i++) {
            if (leaves.length % 2 != 0 && j == leaves.length - 1) {
                hashes[i] = leaves[j];
                continue;
            }
            hashes[i] = keccak256(abi.encodePacked(leaves[j++], leaves[j++]));
        }

        return calculateMerkleTree(hashes);
    }

    function verifyProof(bytes32[] calldata proof, bool[] calldata position, bytes32 leaf, bytes32 root) 
        internal pure returns (bool)
    {   
        require (proof.length == position.length, "proof and position have different length");
        bytes32 computed;
        for (uint i = 0; i < proof.length; i++){
            if (i == 0) {

                computed = position[i] ? keccak256(abi.encodePacked(leaf, proof[i])) 
                    : keccak256(abi.encodePacked(proof[i], leaf));

                
            }
            else if (i == proof.length - 1) {
                computed = position[i] ? keccak256(abi.encodePacked(computed, proof[i])) 
                                : keccak256(abi.encodePacked(proof[i], computed));
                
            }
            else {
                computed = position[i] ? keccak256(abi.encodePacked(computed, proof[i])) 
                                : keccak256(abi.encodePacked(proof[i], computed));
                
            }
        }
        return computed == root;

    }
}