// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "./libraries/MerklePatriciaProof.sol";
import "./libraries/RLPReader.sol";
import "./EthereumDIDRegistry.sol";
import "./Ethrelay.sol";

abstract contract SignatureVerifierV2 {
    function verifySignature(ccIdentityContract.Identity memory identity, 
        uint8 v, bytes32 r, bytes32 s) virtual public  returns (uint);
    
}

contract ECDSAVerifierV2 is SignatureVerifierV2 {
    bytes constant SIGNATURETYPE = bytes("ECDSAVerificationKey");

    function verifySignature(ccIdentityContract.Identity memory identity, uint8 v, bytes32 r, bytes32 s) public override  returns (uint) {
        bytes32 hash = blockhash(identity.blockNumber);
        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 prefixedHashMessage = keccak256(abi.encodePacked(prefix, hash));
        require(identity.blockNumber > 0, "identity not declared");
        require(!identity.verified, "identity already verified");
        require(hash != bytes32(0x0), "blockHash not found");

        // Verify signature type is appropriate
        require (keccak256(abi.encodePacked(identity.identifier._type)) == keccak256(abi.encodePacked(SIGNATURETYPE)), "type not valid");

        // Verify that the signature is correct
        address signer = ecrecover(prefixedHashMessage, v, r, s);

        require(signer != address(0), "ECDSA: invalid signature");
        if (signer != identity.identifier._alias) return 1;
        
        return 0;

    }

    function bytesToAddress(bytes memory bys) private pure returns (address addr) {
        assembly {
            addr := mload(add(bys,32))
        }
    }

    
}

contract ccIdentityContract {
    using RLPReader for *;

    EthereumDIDRegistry internal registry;
    Ethrelay internal ethrelay;
    
    struct Alias {
        string nameAlias;
        address _alias;
        bytes _type;
    }

    // Identity struct relative to an identifier on a specific blockchain
    struct Identity {
        Alias identifier;
        SignatureVerifierV2 signatureVerifier;
        uint blockNumber;
        bytes state;
        bool verified;
    }

    struct PatriciaTrie {
        bytes rlpEncodedState;
        bytes rlpEncodedNodes;
    }

    mapping (address => mapping(bytes32 => Identity)) public ccIdentity;

    event IdentityDeclared(address identity, string name, Alias value, uint validity, uint blockNumber);
    event VerifiedSignature(string identifier);
    event StateTransferred(address identity, address aliasIdentifier, bytes state);
    event IdentityDisconnected(address identity, bytes32 blockchainID);

    constructor (address registryAddress, address payable relayAddress){
        registry = EthereumDIDRegistry(registryAddress);
        ethrelay = Ethrelay(relayAddress);
    }
    //TODO ci sta bisogno di name?
    function declareIdentity(string memory name, Alias memory value,
        uint validity,  bytes32 blockchainID, address signatureVerifier) public returns (uint) {
        Identity memory identitycc;

        // 0x6469642f616c736f4b6e6f776e41730000000000000000000000000000000000 is the encoding of did/alsoKnownAs
        bytes32 hash = keccak256(abi.encodePacked(name));
        if (hash ==  keccak256(abi.encodePacked("did/alsoKnownAs"))) {// 0x6469642f616c736f4b6e6f776e41730000000000000000000000000000000000) {

            identitycc.signatureVerifier = ECDSAVerifierV2(signatureVerifier);
            identitycc.identifier = value;
            identitycc.verified = false;
            identitycc.blockNumber = block.number;
            ccIdentity[msg.sender][blockchainID] = identitycc;
            registry.setAttribute(msg.sender, hash, abi.encode(value), validity);
            // registry.setAttribute(msg.sender, keccak256(abi.encodedPacked("did/)), abi.encode(value.nameAlias), validity); // TODO set properly verification method and alsoKnownAs
            
            emit IdentityDeclared(msg.sender, name, value, validity, block.number);
            return 0;
        }
        return 1;
    }

    function verifySignature(bytes32 blockchainID, uint8 v, bytes32 r, bytes32 s) public returns (uint) {
        Identity storage identity = ccIdentity[msg.sender][blockchainID];
        if (identity.signatureVerifier.verifySignature(identity, v, r, s) != 0)
            return 1;
        
        emit VerifiedSignature(identity.identifier.nameAlias);
        identity.verified = true;
        return 0;

    }

    function transferState(bytes32 blockchainID, uint feeInWei, bytes memory rlpHeader, uint8 noOfConfirmations,
            PatriciaTrie memory patriciaTrie) payable public returns (uint8) {

        Identity storage identity = ccIdentity[msg.sender][blockchainID];
        require(identity.verified == true, "identity not verified");
        bytes memory path = abi.encode(keccak256(abi.encodePacked(identity.identifier._alias)));

         if (ethrelay.verifyState{value: msg.value}(feeInWei, rlpHeader, noOfConfirmations, patriciaTrie.rlpEncodedState, path, patriciaTrie.rlpEncodedNodes) > 0) {
             return 1;
         }
        identity.state = patriciaTrie.rlpEncodedState;
        emit StateTransferred(msg.sender, identity.identifier._alias, identity.state);
        return 0;
    }

    function bytesToAddress(bytes memory bys) private pure returns (address addr) {
        assembly {
            addr := mload(add(bys,32))
        } 
    }

    function detachIdentity( bytes32 blockchainID) public returns (uint8){
        registry.changeOwner(msg.sender, msg.sender);
        emit IdentityDisconnected(msg.sender, blockchainID);
        return 0;
    }

    // TODO add other function to interact with DID registry
}