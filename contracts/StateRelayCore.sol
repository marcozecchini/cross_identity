// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "./libraries/MerklePatriciaProof.sol";

abstract contract EthashInterface {
    function verifyPoW(uint blockNumber, bytes32 rlpHeaderHashWithoutNonce, uint nonce, uint difficulty,
        uint[] calldata dataSetLookup, uint[] calldata witnessForLookup) external view virtual returns (uint, uint);
}

/// @title StateRelay: A contract enabling cross-blockchain verifications of state transfer
/// @author Marco Zecchini
/// @notice You can use this contract for submitting new user state along with block headers, disputing already submitted block headers and
///         for verifying Merkle Patricia proofs of states
contract StateRelayCore {

    using RLPReader for *;

    // the verification- and dispute-process takes a long time, so it may not be possible to verify and additionally
    // dispute the block within 5mins if a disputer don't have a generated DAG on the hard disk. to solve this
    // quickly, make the process faster or increase the lock period to get enough time for clients to dispute
    uint16 constant LOCK_PERIOD_IN_MIN = 10 minutes;
    uint16 constant ANSWER_PERIOD_IN_MIN = 1 minutes;
    uint8 constant ALLOWED_FUTURE_BLOCK_TIME = 15 seconds;
    uint8 constant MAX_EXTRA_DATA_SIZE = 32;
    uint8 constant REQU_SUCEEDING_BLOCKS = 3;
    uint16 constant MIN_GAS_LIMIT = 5000;
    int64 constant GAS_LIMIT_BOUND_DIVISOR = 1024;
    uint constant MAX_GAS_LIMIT = 2**63-1;
    bytes32 constant EMPTY_UNCLE_HASH = hex"1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347";

    // for proving inclusion etc. only the header and some meta-info is stored, if one want to make further operations
    // on data in the FullHeader, one has to go back to the submit-transaction of this block and search for the event
    // why: the FullHeader space consumption is high and emitting it once is cheaper than save it in the state
    struct Header {
        // uint24 first and uint232 second to pack variables in 1 uint256 variable
        uint24 blockNumber;
        bytes32 stateRoot;
        bytes32 hash;
    }

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

    // Identity struct relative to an identifier on a specific blockchain
    struct Identity {
        address identifier;
        bytes32 blockchainId;
        bool verified;
        State state;
        PendingState pendingState;
        EthashInterface ethashContract; // pointer to the ethash-contract that holds functions for calculating and verifying proof of work (keccak) in a contract
    }

    /// @dev This is the struct representing the State of an identity
    struct State {
        Header header;
        address identifier;
        bytes32 genesisBlockHash; // saves the hash of the genesis block the contract was deployed with
        address smartContractId; // 0x0 if not of a contract
        bytes stateContent; 
    }

    /// @dev Variables useful for protocol
    struct PendingState {
        address identifier;
        address challenger;
        State pendingState;
        Header intermediateBlock;
        Header upperLimitBlock;
        Header lowerLimitBlock;
        Header confirmingBlock;
        uint256 answerBefore;
        uint64 lockedUntil; // timestamp until which it is possible to dispute a given block
        uint256 updateLength;
        uint256 midBlockNumber;
    }

    
    // maybe the saving of the genesis block could also be achieved with events in the
    // constructor that gives very small savings
    mapping (bytes32 => mapping(address => Identity)) internal ccIdentity; 
    //holds all identities in a hashmap, key=address of cc-identity creator, value=array of Identities

    uint numberOfInterval = 2;

    // here, the consideration was to use indexes as these are much faster for searching in the blockchain
    // the counterpart is the higher gas, a index log costs (very cheap), but as the content of the submit
    // block is only important to participants in the time of the lock period like disputers, we can simply
    // do a linear backwards search and find the event in the last e.g. 10mins, this is a reasonable amount
    // of time of block search a client can handle easily and fast
    event NewState(bytes32 blockchainID, address identifier, bytes32 stateRoot, bytes32 blockHash, bytes stateContent, address smartContractID); 
    
    constructor() {
    }

    // initialize the contract with a rlpHeader of the wanted genesis block, the actual totalDifficulty at this block and
    // the deployed ethhashContractAddress to verify PoW of this header, the contract creator needs to make sure that these
    // values represent a valid block of the tracked blockchain

    function _initState(bytes32 blockchainID, address identifier, bytes memory _rlpHeader, bytes memory _state, address _ethashContractAddr) internal {
        require(identifier == msg.sender, "not the same identity");
        require(!getIdentity(blockchainID, identifier).verified, "identity is already initialized");
        
        bytes32 newBlockHash = keccak256(_rlpHeader);

        Identity memory identity;
        State memory lastValidState;

        FullHeader memory parsedHeader = parseRlpEncodedHeader(_rlpHeader);
        Header memory newHeader;

        newHeader.hash = newBlockHash;
        newHeader.blockNumber = uint24(parsedHeader.blockNumber);
        // newHeader.totalDifficulty = uint232(totalDifficulty);
        newHeader.stateRoot = parsedHeader.stateRoot;

        identity.blockchainId = blockchainID;
        identity.identifier = msg.sender; 
        identity.verified = true;
        identity.ethashContract = EthashInterface(_ethashContractAddr);

        lastValidState.stateContent = _state; // store the last valid state
        lastValidState.header = newHeader;
        lastValidState.identifier = identifier;
        lastValidState.genesisBlockHash = newBlockHash;
        identity.state = lastValidState;

        ccIdentity[blockchainID][identifier] = identity;
        
        emit NewState(blockchainID, identifier, lastValidState.header.stateRoot, lastValidState.header.hash, lastValidState.stateContent, lastValidState.smartContractId);
    }

    function getIdentity(bytes32 blockchainID, address identifier) public view returns (Identity memory identity) {
        return ccIdentity[blockchainID][identifier];
    }


    function getLastValidStateHeader(bytes32 blockchainID, address identifier) public view returns (bytes32 hash, uint blockNumber, bytes32 stateRoot) {
        State memory lastValidState = ccIdentity[blockchainID][identifier].state;
        return (
            lastValidState.header.hash,
            lastValidState.header.blockNumber,
            lastValidState.header.stateRoot
        );
    }

    function _getLockedUntil(bytes32 blockchainID, address identifier) internal view returns (uint) {
        return getIdentity(blockchainID, identifier).pendingState.lockedUntil;
    }

    function getPendingHash(bytes32 blockchainID, address identifier) public view returns (bytes32) {
        return getIdentity(blockchainID, identifier).pendingState.pendingState.header.hash;
    }

    function getConfirmingHash(bytes32 blockchainID, address identifier) public view returns (bytes32) {
        return getIdentity(blockchainID, identifier).pendingState.confirmingBlock.hash;
    }

    function isLastHeaderStored(bytes32 blockchainID, address identifier, bytes32 hash) public view returns (bool) {
        return getIdentity(blockchainID, identifier).state.header.hash == hash;
    }

    function isConfirmingHeaderStored(bytes32 blockchainID, address identifier, bytes32 hash) public view returns (bool) {
        return getIdentity(blockchainID, identifier).pendingState.confirmingBlock.hash == hash;
    }

    function sameHeader(Header memory h1, Header memory h2) private pure returns (bool){
        if (h1.hash == h2.hash || h1.blockNumber == h2.blockNumber || h1.stateRoot == h2.stateRoot) {
            return true;
        }
        return false;
    }

    function _getState(bytes32 blockchainID, address identifier) internal view returns(State memory){
        if (block.timestamp > getIdentity(blockchainID, identifier).pendingState.lockedUntil) {
            getIdentity(blockchainID, identifier).state = getIdentity(blockchainID, identifier).pendingState.pendingState;
        }
        return getIdentity(blockchainID, identifier).state;
    }

    function getIdentityAddress(bytes32 blockchainID, address identifier) public view returns (address) {
        return getIdentity(blockchainID, identifier).identifier;
    }

    event NewPendingState(bytes32 blockchainID, address identifier, bytes32 lowerLimitBlockHash, bytes32 _blockNhash, bytes32 intermediateBlockHash, bytes32 upperLimitBlockHash, bytes _stateContent, uint _updateLength, uint timeout); 

    /// @dev Function to submit the new pending state
    function _submitState(bytes32 blockchainID, address identifier, bytes memory _rlpNBlockHeader, bytes memory _rlpConfirmingBlockHeader, bytes memory _rlpIntermediateBlockHeader, bytes memory _stateContent, uint _lengthUpdate ) internal returns (uint) {
        Header memory newHeader;
        PendingState memory pendingState;
        Identity memory identity = getIdentity(blockchainID, identifier);

        // calculate block hash of rlp header
        bytes32 blockHash = keccak256(_rlpNBlockHeader);
        
        // check if header has not been submitted before
        require(getIdentityAddress(blockchainID, identifier) == msg.sender, "identity not initialized");
        require(!isLastHeaderStored(blockchainID, identifier, blockHash), "block already exists");
        require(isPendingUnlocked(blockchainID, identifier), "dispute period is not expired");
        require(getIdentity(blockchainID, identifier).identifier == msg.sender, "not valid identity");

        newHeader = fromRlpEncodedToHeader(_rlpNBlockHeader);

        pendingState.lockedUntil = uint64(block.timestamp + LOCK_PERIOD_IN_MIN);
        pendingState.pendingState.header = newHeader;
        pendingState.pendingState.stateContent = _stateContent;

        pendingState.updateLength = _lengthUpdate;
        pendingState.identifier = identifier;

        pendingState.confirmingBlock = fromRlpEncodedToHeader(_rlpConfirmingBlockHeader);
        pendingState.intermediateBlock = fromRlpEncodedToHeader(_rlpIntermediateBlockHeader);
        pendingState.upperLimitBlock = pendingState.confirmingBlock;
        pendingState.lowerLimitBlock = identity.state.header; //newHeader;
        
        pendingState.midBlockNumber = pendingState.intermediateBlock.blockNumber;

        require(pendingState.confirmingBlock.blockNumber == pendingState.pendingState.header.blockNumber + 6, "not confirmingBlock");
        require(pendingState.midBlockNumber == pendingState.upperLimitBlock.blockNumber - pendingState.updateLength/2, "not intermediateBlock");

        identity.pendingState = pendingState;
        ccIdentity[blockchainID][identifier] = identity;

        emit NewPendingState(blockchainID, identifier, getIdentity(blockchainID, identifier).state.header.hash, pendingState.confirmingBlock.hash, pendingState.intermediateBlock.hash, 
            pendingState.confirmingBlock.hash, pendingState.pendingState.stateContent, pendingState.updateLength, pendingState.lockedUntil);
        
        return 0;
    }

    event NewRequest(bytes32 blockchainID, address identifier, bytes32 lowerLimitBlockHash, bytes32 upperLimitBlockHash, uint midBlockNumber);
    event waitForEnd(bytes32 blockchainID, address identifier, bytes32 lowerLimitBlockHash, bytes32 upperLimitBlockHash, uint midBlockNumber);
    
    /// @dev Function that is invoked by a challenger for challenge a new pendingState
    function _challengerMessage(bytes32 blockchainID, address identifier, bytes32 upperLimitBlockHash) internal returns (bool) {
        Identity memory identity = getIdentity(blockchainID, identifier);
        PendingState memory pendingState = identity.pendingState;
        // if both the intermediateHash and the upperLimitHash are correct means that the Nth block is the incorrect one.
        if (pendingState.midBlockNumber == 5 + pendingState.lowerLimitBlock.blockNumber && pendingState.pendingState.header.hash == upperLimitBlockHash){
            emit waitForEnd(blockchainID, identifier, pendingState.pendingState.header.hash, pendingState.pendingState.header.hash, pendingState.midBlockNumber);
            return true;
        }
        require(block.timestamp <= pendingState.lockedUntil, "too late for dispute");
        require(pendingState.midBlockNumber > 1, "already reached a single block");
        require(pendingState.challenger == msg.sender || pendingState.challenger == address(0), "challenger not allowed");
        require(!sameHeader(pendingState.lowerLimitBlock, pendingState.intermediateBlock) || !sameHeader(pendingState.upperLimitBlock, pendingState.intermediateBlock), "sumbitter didn't answer");

        if (pendingState.upperLimitBlock.hash == upperLimitBlockHash) { // If you want to know more in the second interval
            pendingState.lowerLimitBlock = pendingState.intermediateBlock;
            
        } else if (pendingState.intermediateBlock.hash == upperLimitBlockHash) { // if you want to know more of the first interval
            pendingState.upperLimitBlock = pendingState.intermediateBlock;
        } else {
            revert("nor the intermediate nor the upperLimit one");
        }

        pendingState.midBlockNumber = ((pendingState.upperLimitBlock.blockNumber - pendingState.lowerLimitBlock.blockNumber) / 2) + pendingState.lowerLimitBlock.blockNumber;
        pendingState.answerBefore = ANSWER_PERIOD_IN_MIN + block.timestamp;
        pendingState.challenger = msg.sender;
        identity.pendingState = pendingState;
        ccIdentity[blockchainID][identifier] = identity;
        if ((pendingState.midBlockNumber == pendingState.lowerLimitBlock.blockNumber + 1)) {
            emit waitForEnd(blockchainID, identifier, pendingState.lowerLimitBlock.hash, pendingState.upperLimitBlock.hash, pendingState.midBlockNumber);
        } else {
            emit NewRequest(blockchainID, identifier, pendingState.lowerLimitBlock.hash, pendingState.upperLimitBlock.hash, pendingState.midBlockNumber);
        }
        return true;
    }


    event NewAnswer(bytes32 blockchainID, address identifier, bytes32 lowerLimitBlockHash, bytes32 upperLimitBlockHash, bytes32 intermediateBlockHash);

    /// @dev Function that is invoked by a submitter for answer the challenge of a new pendingState
    function _sumbitterMessage(bytes32 blockchainID, address identifier, bytes memory _rlpIntermediateBlockHeader) internal returns (bool) {
        Identity memory identity = getIdentity(blockchainID, identifier);
        PendingState memory pendingState = identity.pendingState;
        require(block.timestamp <= pendingState.lockedUntil, "too late for dispute");
        require(block.timestamp <= pendingState.answerBefore, "too late for answering");
        require(pendingState.identifier == msg.sender, "submitter not allowed");
        require(pendingState.midBlockNumber > 1, "already reached a single block");
        require(!sameHeader(pendingState.lowerLimitBlock, pendingState.intermediateBlock) || !sameHeader(pendingState.upperLimitBlock,pendingState.intermediateBlock), "sumbitter didn't answer");

        pendingState.intermediateBlock = fromRlpEncodedToHeader(_rlpIntermediateBlockHeader);
        require(pendingState.intermediateBlock.blockNumber == pendingState.midBlockNumber, "not block in the middle");
        
        pendingState.answerBefore = ANSWER_PERIOD_IN_MIN + block.timestamp;
        identity.pendingState = pendingState;
        ccIdentity[blockchainID][identifier] = identity;
        emit NewAnswer(blockchainID, identifier, pendingState.lowerLimitBlock.hash, pendingState.upperLimitBlock.hash, pendingState.intermediateBlock.hash);
        return true;
    }


    event DisputeBlock(uint returnCode);
    event PoWValidationResult(uint returnCode, uint errorInfo);
    /// @dev If a client is convinced that a certain block header is invalid, it can call this function which validates
    ///      whether enough PoW has been carried out.
    /// @param rlpHeader the encoded version of the block header to dispute
    /// @param rlpParent the encoded version of the block header's parent
    /// @param dataSetLookup contains elements of the DAG needed for the PoW verification
    /// @param witnessForLookup needed for verifying the dataSetLookup
    function disputeBlock(bytes32 blockchainID, address identifier, bytes calldata rlpHeader, bytes memory rlpParent, uint[] memory dataSetLookup,
        uint[] memory witnessForLookup) internal returns (uint) {
        Identity memory identity = getIdentity(blockchainID, identifier);
        require(identity.pendingState.midBlockNumber - identity.pendingState.lowerLimitBlock.blockNumber == 1, "not reached a single block");
        // Currently, once the dispute period is over and the block is unlocked we accept it as valid.
        // In that case, no validation is carried out anymore.

        // outsourcing verifying of validity and PoW because solidity encountered a stack too deep exception before
        uint returnCode = verifyValidityAndPoW(blockchainID, identifier, rlpHeader, rlpParent, dataSetLookup, witnessForLookup);

        emit DisputeBlock(returnCode);

        return returnCode;
    }

    // helper function to not get a stack to deep exception
    function verifyValidityAndPoW(bytes32 blockchainID, address identifier, bytes calldata rlpHeader, bytes memory rlpParent, uint[] memory dataSetLookup, uint[] memory witnessForLookup) private returns (uint) {
        uint returnCode;
        uint24 blockNumber;
        uint nonce;
        uint difficulty;
        Identity memory identity = getIdentity(blockchainID, identifier);

        // verify validity of header and parent
        (returnCode, blockNumber, nonce, difficulty) = verifyValidity(blockchainID, identifier, rlpHeader, rlpParent);

        // if return code is 0, the block and it's parent seem to be valid
        // next check the ethash PoW algorithm
        if (returnCode == 0) {
            // header validation without checking Ethash was successful -> verify Ethash
            uint errorInfo;

            (returnCode, errorInfo) = identity.ethashContract.verifyPoW(blockNumber, getRlpHeaderHashWithoutNonce(rlpHeader),
                nonce, difficulty, dataSetLookup, witnessForLookup);

            emit PoWValidationResult(returnCode, errorInfo);
        }

        return returnCode;
    }

    // initially this logic was part of the disputeBlock method, but as the solidity compiler failed for
    // such big logic blocks the logic was split in 2 sub methods to save stack space
    // so maybe this necessary call can be enhanced to use a little less gas integrating in the upper method while
    // preserving the logic, e.g. the storedParent is read read from storage 2 times, maybe pass as argument if cheaper,
    // this should not cause too much cost increase
    function verifyValidity(bytes32 blockchainID, address identifier, bytes memory rlpHeader, bytes memory rlpParent) private view returns (uint, uint24, uint, uint) {
        bytes32 parentHash = keccak256(rlpParent);
        Identity memory identity = getIdentity(blockchainID, identifier);
        PendingState memory pendingState = identity.pendingState;

        require(pendingState.lowerLimitBlock.hash == parentHash, "provided parent not evaluated");
        require(!isPendingUnlocked(blockchainID, identifier), "dispute period is expired");

        Header memory storedHeader = fromRlpEncodedToHeader(rlpHeader);
        Header memory storedParent = fromRlpEncodedToHeader(rlpParent);

        require(isHeaderSuccessorOfParent(blockchainID, identifier, storedHeader, storedParent), "stored parent is not a predecessor of evaluated header within StateRelay");

        FullHeader memory providedHeader = parseRlpEncodedHeader(rlpHeader);
        FullHeader memory providedParent = parseRlpEncodedHeader(rlpParent);

        require(providedHeader.parent == parentHash, "provided header's parent does not match with provided parent' hash");

        return (checkHeaderValidity(providedHeader, providedParent), storedHeader.blockNumber, providedHeader.nonce, providedHeader.difficulty);
    }

    function isHeaderSuccessorOfParent(bytes32 blockchainID, address identifier, Header memory header, Header memory parent) private view returns (bool) {
        if (getIdentity(blockchainID, identifier).pendingState.lowerLimitBlock.hash == parent.hash && parent.blockNumber+1 == header.blockNumber) {
            return true;
        }
        return false;
    }

    function disputeState(bytes memory rlpEncodedValue, bytes memory path, bytes memory rlpEncodedNodesN, bytes32 merkleRootHashN,
                                                        bytes memory  rlpEncodedNodesConfirming, bytes32 merkleRootHashConfirming ) internal returns (uint8) {
                                                            
           
            if (verifyMerkleProof(rlpEncodedValue, path, rlpEncodedNodesN, merkleRootHashN) == 1 
                && verifyMerkleProof(rlpEncodedValue, path, rlpEncodedNodesConfirming, merkleRootHashConfirming) == 1) 
                {
                    return 1;
                }
            return 0;

    }
    event debugMP(uint s);
    /// @dev Verifies the existence of a transaction, receipt or state ('rlpEncodedValue') within a certain block ('blockHash').
    /// @param rlpEncodedValue the value of the Merkle Patricia trie (e.g. transaction, receipt, state) in RLP format
    /// @param path the path (key) in the trie indicating the way starting at the root node and ending at the value (e.g. transaction)
    /// @param rlpEncodedNodes an RLP encoded list of nodes of the Merkle branch, first element is the root node, last element the value
    /// @param merkleRootHash the hash of the root node of the Merkle Patricia trie
    /// @return 0: verification was successful
    ///         1: block is confirmed and unlocked, but the Merkle proof was invalid

    // The verification follows the following steps:
    //     1. Verify that the given block is part of the longest Proof of Work chain. this suffices when used in combination with noOfConfirmations and lockedUntil params
    //     2. Verify that the block is unlocked and has been confirmed by at least n succeeding unlocked blocks ('noOfConfirmations')
    //     3. Verify the Merkle Patricia proof of the given block
    //
    // In case we have to check whether enough block confirmations occurred
    // starting from the requested block ('blockHash'), we go to the latest
    // unlocked block on the longest chain path (could be the requested block itself)
    // and count the number of confirmations (i.e. the number of unlocked blocks),
    // starting from the latest unlocked block along the longest chain path.
    // The verification only works, if at least 1 (altruistic) participant submits blocks from the source blockchain to retain the correct longest chain
    // and 1 (altruistic) participant disputes illegal blocks to prevent fake/invalid blocks building the longest chain (this can be the same participant)
    function verifyMerkleProof(bytes memory rlpEncodedValue,
        bytes memory path, bytes memory rlpEncodedNodes, bytes32 merkleRootHash) internal returns (uint8) {

        uint s = MerklePatriciaProof.verify(rlpEncodedValue, path, rlpEncodedNodes, merkleRootHash);
        if (s > 0) {
            emit debugMP(s);
            return 1;
        }

        return 0;
    }

    function isPendingUnlocked(bytes32 blockchainID, address identifier) internal view returns (bool) {
        return getIdentity(blockchainID, identifier).pendingState.lockedUntil < block.timestamp;
    }

    function isTimeout(bytes32 blockchainID, address identifier) internal view returns (bool, uint8) {
        PendingState memory pendingState = getIdentity(blockchainID, identifier).pendingState;
        if (block.timestamp >= pendingState.answerBefore && (sameHeader(pendingState.lowerLimitBlock, pendingState.intermediateBlock) || sameHeader(pendingState.upperLimitBlock,pendingState.intermediateBlock))){
            // The submitter didn't answer
            return (true, 1);
        } else if (block.timestamp >= pendingState.answerBefore && (!sameHeader(pendingState.lowerLimitBlock, pendingState.intermediateBlock) && !sameHeader(pendingState.upperLimitBlock, pendingState.intermediateBlock))){
            return (true, 2);
        } else {
            return (false, 0);
        }

    }

    function fromRlpEncodedToHeader(bytes memory rlpHeader) private pure returns (Header memory) {
        FullHeader memory fullHeader = parseRlpEncodedHeader(rlpHeader);
        Header memory newHeader;

        bytes32 blockHash = keccak256(rlpHeader);

        newHeader.hash = blockHash;
        newHeader.blockNumber = uint24(fullHeader.blockNumber);
        newHeader.stateRoot = fullHeader.stateRoot;

        return newHeader;
    }

    function parseRlpEncodedHeader(bytes memory rlpHeader) private pure returns (FullHeader memory) {
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

    function getRlpHeaderHashWithoutNonce(bytes calldata rlpHeader) private pure returns (bytes32) {

        RLPReader.Iterator memory it = rlpHeader.toRlpItem().iterator();
        uint byteIdx = 3;  // RLP list starts with list prefix and the length of the payload
        uint elementIdx;
        uint startCut;
        uint endCut;

        while(it.hasNext()) {
            if (elementIdx == 13) {
                startCut = byteIdx;
            }

            RLPReader.RLPItem memory cur = it.next();
            byteIdx += cur.len;

            if (elementIdx == 14) {
                endCut = byteIdx;
                break;
            }

            elementIdx++;
        }

        bytes memory truncatedRlpHeader = bytes.concat(rlpHeader[:startCut], rlpHeader[endCut:]);
        uint16 rlpHeaderWithoutNonceLength = uint16(
            rlpHeader.length        // Length of original RLP header
            - 3                     // RLP List prefix bytes (0xf9 + two bytes for payload length)
            - (endCut - startCut)   // Length of MixDigest and Nonce fields
        );

        bytes2 headerLengthBytes = bytes2(rlpHeaderWithoutNonceLength);

        // Update payload length
        truncatedRlpHeader[1] = headerLengthBytes[0];
        truncatedRlpHeader[2] = headerLengthBytes[1];

        return keccak256(truncatedRlpHeader);
    }

    function getStateRoot(bytes memory rlpHeader) internal pure returns (bytes32) {
        RLPReader.Iterator memory it = rlpHeader.toRlpItem().iterator();
        uint idx;
        while(it.hasNext()) {
            if ( idx == 3 ) return bytes32(it.next().toUint());
            else it.next();

            idx++;
        }

        return 0;
    }

    function getParentBlockNumberDiff(bytes memory rlpHeader) internal pure returns (bytes32, uint, uint) {
        uint idx;
        bytes32 parent;
        uint blockNumber;
        uint difficulty;
        RLPReader.Iterator memory it = rlpHeader.toRlpItem().iterator();

        while(it.hasNext()) {
            if( idx == 0 ) parent = bytes32(it.next().toUint());
            else if ( idx == 7 ) difficulty = it.next().toUint();
            else if ( idx == 8 ) blockNumber = it.next().toUint();
            else it.next();

            idx++;
        }

        return (parent, blockNumber, difficulty);
    }

    // @dev Validates the fields of a block header without validating Ethash.
    // The validation largely follows the header validation of the geth implementation:
    // https://github.com/ethereum/go-ethereum/blob/aa6005b469fdd1aa7a95f501ce87908011f43159/consensus/ethash/consensus.go#L241
    function checkHeaderValidity(FullHeader memory header, FullHeader memory parent) private view returns (uint) {
        // check extraData size
        if (header.extraData.length > MAX_EXTRA_DATA_SIZE) return 3;

        // check timestamp not in the future
        if (header.timestamp > block.timestamp + ALLOWED_FUTURE_BLOCK_TIME) return 5;

        // validate gas limit
        if (header.gasLimit > MAX_GAS_LIMIT) return 8; // verify that the gas limit is <= 2^63-1
        if (header.gasLimit < MIN_GAS_LIMIT) return 9; // verify that the gas limit is >= 5000

        // if there are already endpoints available, perform additional checks
        // else it is the genesis block and has no parent blocks we can check
        // if (iterableEndpoints.length != 0) {

        // check chronological blockNumber order
        if (parent.blockNumber + 1 != header.blockNumber) return 4;

        // check chronological timestamp order
        if (parent.timestamp >= header.timestamp) return 6;

        // check difficulty
        uint expectedDifficulty = calculateDifficulty(parent, header.timestamp);
        if (expectedDifficulty != header.difficulty) return 7; 

        // validate gas limit with parent
        if (!gasLimitWithinBounds(int64(uint64(header.gasLimit)), int64(uint64(parent.gasLimit)))) return 10;
        
        // }

        // validate gas limit
        if (header.gasUsed > header.gasLimit) return 11;

        return 0;
    }

    function gasLimitWithinBounds(int64 gasLimit, int64 parentGasLimit) private pure returns (bool) {
        int64 limit = parentGasLimit / GAS_LIMIT_BOUND_DIVISOR;
        int64 difference = gasLimit - parentGasLimit;

        if (difference < 0) {
            difference *= -1;
        }

        return difference <= limit;
    }

    // diff = (parent_diff +
    //         (parent_diff / 2048 * max((2 if len(parent.uncles) else 1) - ((timestamp - parent.timestamp) // 9), -99))
    //        ) + 2^(periodCount - 2)
    // https://github.com/ethereum/go-ethereum/blob/aa6005b469fdd1aa7a95f501ce87908011f43159/consensus/ethash/consensus.go#L335
    function calculateDifficulty(FullHeader memory parent, uint timestamp) private pure returns (uint) {
        int x = int((timestamp - parent.timestamp) / 9);

        // take into consideration uncles of parent
        if (parent.uncleHash == EMPTY_UNCLE_HASH) {
            x = 1 - x;
        } else {
            x = 2 - x;
        }

        if (x < -99) {
            x = -99;
        }

        x = int(parent.difficulty) + int(parent.difficulty) / 2048 * x;

        // minimum difficulty = 131072
        if (x < 131072) {
            x = 131072;
        }

        uint bombDelayFromParent = 5000000 - 1;
        if (parent.blockNumber + 1 >= 13773000) {
            // https://eips.ethereum.org/EIPS/eip-4345
            bombDelayFromParent = 10700000 - 1;
        } else if (parent.blockNumber + 1 >= 9200000) {
            // https://eips.ethereum.org/EIPS/eip-2384
            bombDelayFromParent = 9000000 - 1;
        }

        // calculate a fake block number for the ice-age delay
        // Specification: https://eips.ethereum.org/EIPS/eip-1234
        uint fakeBlockNumber = 0;
        if (parent.blockNumber >= bombDelayFromParent) {
            fakeBlockNumber = parent.blockNumber - bombDelayFromParent;
        }

        // for the exponential factor
        uint periodCount = fakeBlockNumber / 100000;

        // the exponential factor, commonly referred to as "the bomb"
        // diff = diff + 2^(periodCount - 2)
        if (periodCount > 1) {
            return uint(x) + 2**(periodCount - 2);
        }

        return uint(x);
    }
}
