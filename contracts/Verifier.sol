// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "./libraries/MerklePatriciaProof.sol";
import "./libraries/RLPReader.sol";


abstract contract SignatureVerifier {
    using RLPReader for *;

    // FullHeader is needed when a block is submitted, but will never be saved in state to reduce costs
    struct FullHeader {
        bytes32 parent;
        bytes32 uncleHash;
        bytes32 stateRoot;
        bytes32 transactionsRoot;
        bytes32 receiptsRoot;
        uint blockNumber;
        uint gasLimit;
        uint gasUsed;
        bytes32 rlpHeaderHashWithoutNonce;   // sha3 hash of the header without nonce and mix fields, placed here because of pointer-position in byte-arrays
        uint timestamp;                      // block timestamp is needed for difficulty calculation
        uint nonce;                          // blockNumber, rlpHeaderHashWithoutNonce and nonce are needed for verifying PoW
        uint difficulty;
        bytes extraData;
    }

    event VerifiedSignature(bytes identifier);

    function verifySignature(bytes calldata encodedBlock, bytes memory rlpEncodedValue,
        bytes memory path, bytes memory rlpEncodedNodes) virtual public returns (uint);

    function parseRlpEncodedHeader(bytes memory rlpHeader) internal pure returns (FullHeader memory) {
        FullHeader memory header;

        RLPReader.Iterator memory it = rlpHeader.toRlpItem().iterator();
        uint idx;
        while(it.hasNext()) {
            if( idx == 0 ) header.parent = bytes32(it.next().toUint());
            else if ( idx == 1 ) header.uncleHash = bytes32(it.next().toUint());
            else if ( idx == 3 ) header.stateRoot = bytes32(it.next().toUint());
            else if ( idx == 4 ) header.transactionsRoot = bytes32(it.next().toUint());
            else if ( idx == 5 ) header.receiptsRoot = bytes32(it.next().toUint());
            else if ( idx == 7 ) header.difficulty = it.next().toUint();
            else if ( idx == 8 ) header.blockNumber = it.next().toUint();
            else if ( idx == 9 ) header.gasLimit = it.next().toUint();
            else if ( idx == 10 ) header.gasUsed = it.next().toUint();
            else if ( idx == 11 ) header.timestamp = it.next().toUint();
            else if ( idx == 12 ) header.extraData = it.next().toBytes();
            else if ( idx == 14 ) header.nonce = it.next().toUint();
            else it.next();

            idx++;
        }

        return header;
    }

    function getRoot(bytes memory rlpHeader) internal pure returns (bytes32) {
        RLPReader.Iterator memory it = rlpHeader.toRlpItem().iterator();
        uint idx;
        while(it.hasNext()) {
            if ( idx == 5 ) return bytes32(it.next().toUint());
            else it.next();

            idx++;
        }

        return 0;
    }

    
}

contract ECDSAVerifier is SignatureVerifier{
    event ddb(uint ret);
    function verifySignature(bytes calldata encodedBlock, bytes memory rlpEncodedValue,
        bytes memory path, bytes memory rlpEncodedNodes) public override returns (uint) {

        // FullHeader memory header = parseRlpEncodedHeader(encodedBlock);
        // require(blockhash(header.blockNumber) == keccak256(encodedBlock), "block not in the chain");

        //TODO verifica che ci sia l'identità qui dentro
//        uint ret = MerklePatriciaProof.verifyWithoutDecoding(rlpEncodedValue, path, rlpEncodedNodes, getRoot(encodedBlock));
//        if (ret > 0) {
//            emit ddb(ret);
//            return 1;
//        }
        
        emit VerifiedSignature("prova");
        return 0;

    }

    
}