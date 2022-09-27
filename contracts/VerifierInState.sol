// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "./libraries/MerklePatriciaProof.sol";
import "./libraries/RLPReader.sol";
import "./libraries/strings.sol";
import "./EthereumDIDRegistry.sol";

abstract contract SignatureVerifierV2 {
    using RLPReader for *;

    function verifySignature(ccIdentityContract.Identity memory identity, 
        uint8 v, bytes32 r, bytes32 s) virtual public view returns (uint);
    
}

contract ECDSAVerifierV2 is SignatureVerifierV2 {
    bytes constant SIGNATURETYPE = bytes("Secp256k1VerificationKey2018");
    

    function verifySignature(ccIdentityContract.Identity memory identity, uint8 v, bytes32 r, bytes32 s) public override view returns (uint) {
        bytes32 hash = blockhash(identity.blockNumber);
        require(identity.blockNumber > 0, "identity not declared");
        require(!identity.verified, "identity already verified");
        require(hash != bytes32(0x0), "blockHash not found");

        // Verify signature type is appropriate
        require (keccak256(abi.encodePacked(identity.identifier._verificationMethod[0])) == keccak256(abi.encodePacked(SIGNATURETYPE)), "type not valid");

        // Verify that the signature is correct
        address signer = ecrecover(hash, v, r, s);
        require(signer != address(0), "ECDSA: invalid signature");
        require(signer != bytesToAddress(identity.identifier._verificationMethod[1]), "ECDSA: invalid signature");
        
        return 0;

    }

    function bytesToAddress(bytes memory bys) private pure returns (address addr) {
        assembly {
        addr := mload(add(bys,32))
        } 
    }

    
}

contract ccIdentityContract {
    SignatureVerifierV2 internal signatureVerifier;
    EthereumDIDRegistry internal registry;
    
    struct Alias {
        string typeAlias;
        string _alias;
        bytes[] _verificationMethod;
    }

    // Identity struct relative to an identifier on a specific blockchain
    struct Identity {
        Alias identifier;
        SignatureVerifierV2 signatureVerifier;
        uint blockNumber;
        bool verified;
    }

    mapping (address => mapping(bytes32 => Identity)) public ccIdentity;

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
    event IdentityDeclared(address identity, string name, Alias value, uint validity);
    event VerifiedSignature(string identifier);

    constructor (address registryAddress){
        registry = EthereumDIDRegistry(registryAddress);
        signatureVerifier = new ECDSAVerifierV2(); // TODO GENERALIZE
    }

    function declareIdentity(address identity, string memory name, Alias memory value, 
        uint validity, 
        bytes32 blockchainID) public returns (uint) {
        Identity memory identitycc;

        // 0x6469642f616c736f4b6e6f776e41730000000000000000000000000000000000 is the encoding of did/alsoKnownAs
        bytes32 hash = keccak256(abi.encodePacked(name));
        if (hash ==  keccak256(abi.encodePacked("did/alsoKnownAs"))) {// 0x6469642f616c736f4b6e6f776e41730000000000000000000000000000000000) {

            identitycc.signatureVerifier = signatureVerifier;
            identitycc.identifier = value;
            identitycc.verified = false;
            identitycc.blockNumber = block.number;
            ccIdentity[identity][blockchainID] = identitycc;
            registry.setAttribute(identity, hash, abi.encode(value), validity);
            emit IdentityDeclared(identity, name, value, validity);
            return 0;
        }
        return 1;
    }

    function verifySignature(address identifier, bytes32 blockchainID, uint8 v, bytes32 r, bytes32 s) public returns (uint) {
        Identity storage identity = ccIdentity[identifier][blockchainID];
        if (signatureVerifier.verifySignature(identity, v, r, s) != 0) 
            return 1;
        emit VerifiedSignature(identity.identifier._alias);
        identity.verified = true;
        return 0;

    }    
}