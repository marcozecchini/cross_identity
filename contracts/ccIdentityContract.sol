// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "./libraries/MerklePatriciaProof.sol";
import "./libraries/RLPReader.sol";
import "./EthereumDIDRegistry.sol";
import "./StateRelay.sol";

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
    StateRelay internal staterelay;

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
        uint stateBlockNumber;
        bytes state;
        bool verified;
    }

    struct PatriciaTrie {
        bytes rlpEncodedState;
        bytes rlpEncodedNodes;
    }

    mapping (address => mapping(bytes32 => Identity)) public ccIdentity;

    event IdentityDeclared(address identity, Alias value, uint validity, uint blockNumber);
    event VerifiedSignature(string identifier);
    event StateTransferred(address identity, address aliasIdentifier, bytes state);
    event IdentityDisconnected(address identity, bytes32 blockchainID);

    constructor (address registryAddress, address payable relayAddress){
        registry = EthereumDIDRegistry(registryAddress);
        staterelay = StateRelay(relayAddress);
    }

    function declareIdentity(Alias memory value,
        uint validity,  bytes32 blockchainID, address signatureVerifier) public returns (uint) {
        Identity memory identitycc;
        bytes32 typeOfSignature = keccak256(value._type);
        if (keccak256(abi.encodePacked("ECDSAVerificationKey")) == typeOfSignature) {
            identitycc.signatureVerifier = ECDSAVerifierV2(signatureVerifier);
            identitycc.identifier = value;
            identitycc.verified = false;
            identitycc.blockNumber = block.number;
            ccIdentity[msg.sender][blockchainID] = identitycc;
            registry.setAttribute(msg.sender, keccak256(abi.encodePacked("did/alsoKnownAs")), abi.encode(value._alias), validity);

            // https://github.com/decentralized-identity/ethr-did-resolver/blob/master/doc/did-method-spec.md#public-keys
            registry.setAttribute(msg.sender, keccak256(abi.encodePacked("did/verificationRelationship/authentication")), abi.encode(value._alias), validity);
            emit IdentityDeclared(msg.sender, value, validity, block.number);
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

    function transferState(bytes32 blockchainID, bytes memory rlpHeader, bytes memory rlpHeaderConfirming,
        bytes memory rlpIntermediateHeader, bytes memory stateContent, uint lengthUpdate) payable public returns (uint8) {

        Identity storage identity = ccIdentity[msg.sender][blockchainID];
        require(identity.verified == true, "identity not verified");
        bytes memory path = abi.encode(keccak256(abi.encodePacked(identity.identifier._alias)));

        if (staterelay.submitState(rlpHeader, rlpHeaderConfirming, rlpIntermediateHeader, stateContent, lengthUpdate) != 0) {
            return 1;
        }

        identity.state = stateContent;
        identity.stateBlockNumber = block.number;
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

    // auxiliary function to invoke EthereumDIDRegistry
    function validDelegate(address identity, bytes32 delegateType, address delegate) public view returns(bool) {
        return registry.validDelegate(identity, delegateType, delegate);
    }

    function addDelegate(address identity, bytes32 delegateType, address delegate, uint validity) public {
        return registry.addDelegate(identity, delegateType, delegate, validity);
    }

    function revokeDelegate(address identity, bytes32 delegateType, address delegate) public {
        return registry.revokeDelegate(identity, delegateType, delegate);
    }

    function setAttribute(address identity, bytes32 name, bytes memory value, uint validity) public {
        return registry.setAttribute(identity, name, value, validity);
    }

    function setAttributeSigned(address identity, uint8 sigV, bytes32 sigR, bytes32 sigS, bytes32 name, bytes memory value, uint validity) public {
        return registry.setAttributeSigned(identity, sigV, sigR, sigS, name, value, validity);
    }

    function revokeAttribute(address identity, bytes32 name, bytes memory value) public {
        return registry.revokeAttribute(identity, name, value);
    }

    function revokeAttributeSigned(address identity, uint8 sigV, bytes32 sigR, bytes32 sigS, bytes32 name, bytes memory value) public {
        return registry.revokeAttributeSigned(identity, sigV, sigR, sigS, name, value);
    }
}