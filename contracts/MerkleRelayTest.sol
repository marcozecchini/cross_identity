// SPDX-License-Identifier: MIT
pragma solidity >=0.7.0 <0.9.0;

import "./MerkleRelay.sol";

contract MerkleRelayTestContract is MerkleRelay {
    constructor(bytes memory _rlpHeader, uint totalDifficulty, address _ethashContractAddr) MerkleRelay(_rlpHeader, totalDifficulty, _ethashContractAddr) {}

    // TODO aggiungi extended Root
    // function getRootMetaInfo(bytes32 blockHash) public view returns (
    //     bytes32[] memory successors, uint forkId, uint iterableIndex, bytes32 latestFork, uint lockedUntil,
    //     address submitter
    // ) {
    //     return super.getHeaderMetaInfo(blockHash);
    // }

    function getLockedUntilOfBlock(bytes32 blockHash) public view returns (uint) {
        return super.getLockedUntil(blockHash);
    }

    function getNumberOfForks() public view returns (uint) {
        return super.getNoOfForks();
    }

    function getEndpoint(uint index) public view returns (bytes32) {
        return super.getBlockHashOfEndpoint(index);
    }

    function isBlockUnlocked(bytes32 blockHash) public view returns (bool) {
        return super.isUnlocked(blockHash);
    }

    // event DisputeBlockWithoutPunishment(address[] submittersOfIllegalBlocks);
    // function disputeBlockWithoutPunishment(bytes calldata rlpHeader, bytes memory rlpParent, uint[] memory dataSetLookup,
    //         uint[] memory witnessForLookup) public returns (address[] memory) {
    //     address[] memory submittersToPunish = disputeBlock(rlpHeader, rlpParent, dataSetLookup, witnessForLookup);
    //     emit DisputeBlockWithoutPunishment(submittersToPunish);
    // }

}
