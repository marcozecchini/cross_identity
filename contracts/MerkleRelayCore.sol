// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "./libraries/MerkleTree.sol";
import "./libraries/RLPReader.sol";
import "./libraries/MerklePatriciaProof.sol";


abstract contract EthashInterface {
    function verifyPoW(uint blockNumber, bytes32 rlpHeaderHashWithoutNonce, uint nonce, uint difficulty,
        uint[] calldata dataSetLookup, uint[] calldata witnessForLookup) external view virtual returns (uint, uint);
}

/// @title MerkleRelay: A contract enabling cross-blockchain verifications of transactions,
///        receipts and states on a destination blockchain of a source blockchain
/// @author Marco Zecchini
/// @notice You can use this contract for submitting new block headers, disputing already submitted block headers and
///         for verifying Merkle Patricia proofs of transactions, receipts and states
contract MerkleRelayCore {
    using MerkleTree for *;
    using RLPReader for *;

    uint16 constant LOCK_PERIOD_IN_MIN = 5 minutes;
    uint8 constant ALLOWED_FUTURE_BLOCK_TIME = 15 seconds;
    uint8 constant MAX_EXTRA_DATA_SIZE = 32;
    uint8 constant REQU_SUCEEDING_BLOCKS = 3;
    uint16 constant MIN_GAS_LIMIT = 5000;
    int64 constant GAS_LIMIT_BOUND_DIVISOR = 1024;
    uint constant MAX_GAS_LIMIT = 2**63-1;
    bytes32 constant EMPTY_UNCLE_HASH = hex"1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347";

    // pointer to the ethash-contract that holds functions for calculating and verifying proof of work (keccak) in a contract
    EthashInterface ethashContract;

    struct RootMetadata {
        bytes32 parentRoot;
        bytes32 lastHash;
        uint256 totalDifficulty;
        uint24 blockNumber;
        uint64 lengthUpdate;
        uint64 forkId;              // every branch gets a branchId/forkId, stored to speed up block-search/isPartOfMainChain-reqeuests etc.
        uint64 iterableIndex;       // index at which the block header is/was stored in the iterable endpoints array
        bytes32 latestFork;         // contains the hash of the latest node where the current fork branched off
        uint64 lockedUntil;         // timestamp until which it is possible to dispute a given block
        address submitter;          // address of the submitter of the block, stored for incentive and punishment reasons
        bytes32[] successors;       // in case of forks a blockchain can have multiple successors
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

    struct PoWMetadata {
        uint[] dataSetLookup; ///contains elements of the DAG needed for the PoW verification
        uint[] witnessForLookup; /// needed for verifying the dataSetLookup
    }

    struct TreeProof {
       bytes32[] proof; 
       bool[] position;
    }
    
    uint64 maxForkId = 0;                           // current fork-id, is incrementing
    bytes32 longestChainEndpoint;                   // saves the hash of the block with the highest blockNr. (most PoW work)
    bytes32 genesisBlockHash;                       // saves the hash of the genesis block the contract was deployed with
                                                    // maybe the saving of the genesis block could also be achieved with events in the
                                                    // constructor that gives very small savings
    mapping (bytes32 => RootMetadata) public rootChain;
    bytes32[] iterableEndpoints; // holds endpoints of all forks of the PoW-tree to speed up submission, deletion etc.
    

    // initialize the contract with a rlpHeader of the wanted genesis block, the actual totalDifficulty at this block and
    // the deployed ethhashContractAddress to verify PoW of this header, the contract creator needs to make sure that these
    // values represent a valid block of the tracked blockchain
    constructor (bytes memory _rlpHeader, uint totalDifficulty, address _ethashContractAddr) {
        bytes32 newBlockHash = keccak256(_rlpHeader);

        FullHeader memory parsedHeader = parseRlpEncodedHeader(_rlpHeader);
        RootMetadata memory newRoot;

        newRoot.parentRoot = newBlockHash;
        newRoot.blockNumber = uint24(parsedHeader.blockNumber);
        newRoot.lengthUpdate = 1;
        newRoot.totalDifficulty = uint256(totalDifficulty);
        // newRoot.meta.forkId = maxForkId;  // the first block is no fork (forkId = 0)
        iterableEndpoints.push(newBlockHash);
        newRoot.iterableIndex = uint64(iterableEndpoints.length - 1);    // the first block is also an endpoint
        newRoot.lockedUntil = uint64(block.timestamp);   // the first block does not need a confirmation period
        newRoot.submitter = msg.sender;
        newRoot.lastHash = newBlockHash;
        newRoot.forkId = maxForkId;  // the first block is no fork (forkId = 0)

        rootChain[newBlockHash] = newRoot;

        longestChainEndpoint = newBlockHash;    // the first block is also the longest chain/fork at the moment

        ethashContract = EthashInterface(_ethashContractAddr);

        genesisBlockHash = newBlockHash;

    }

    function getLockedUntil(bytes32 root) internal view returns (uint) {
        return rootChain[root].lockedUntil;
    }

    function getNoOfForks() internal view returns (uint) {
        return iterableEndpoints.length;
    }

    // @dev Returns the block hash of the endpoint at the specified index
    function getBlockHashOfEndpoint(uint index) internal view returns (bytes32) {
        return iterableEndpoints[index];
    }

    function getLongestChainEndpoint() public view returns (bytes32 hash) {
        return longestChainEndpoint;
    }

    function getGenesisBlockHash() public view returns (bytes32 hash) {
        return genesisBlockHash;
    }

    function isRootStored(bytes32 root) public view returns (bool){
        return rootChain[root].blockNumber != 0;
    }

    function getRootMetadata(bytes32 root) public view returns (uint64 blockNumber, uint totalDifficulty) {
        RootMetadata storage metadata = rootChain[root];
        return (
            metadata.blockNumber,
            metadata.totalDifficulty
        );
    }


    function getExtendedRootMetadata(bytes32 root) public view returns (
        bytes32[] memory successors, uint forkId, uint iterableIndex, bytes32 latestFork, uint lockedUntil,
        address submitter,bytes32 lastHash, uint24 blockNumber, uint64 lengthUpdate
    ) {
        RootMetadata storage rootMeta = rootChain[root];
        return (
            rootMeta.successors,
            rootMeta.forkId,
            rootMeta.iterableIndex,
            rootMeta.latestFork,
            rootMeta.lockedUntil,
            rootMeta.submitter,
            rootMeta.lastHash, 
            rootMeta.blockNumber,
            rootMeta.lengthUpdate
        );
    }

    function isUnlocked(bytes32 rootHash) internal view returns (bool) {
        return rootChain[rootHash].lockedUntil < block.timestamp;
    }

    ///@dev questa funzione aggiunge una root ad una precedente root 
    function _submitRoot(bytes[] calldata headers, bytes32 parentRoot) internal returns (bytes32) {
        // check if the root has not been submitted before
        require(isRootStored(parentRoot), "parentRoot does not exists");

        bytes32[] memory leaves = new bytes32[](headers.length);
        RootMetadata storage parentMetadata = rootChain[parentRoot];
        uint difficulty = parentMetadata.totalDifficulty;
        uint64 parentBlockNumber = parentMetadata.blockNumber;
        bytes32 decodedParent;
        uint decodedBlockNumber;
        uint decodedDifficulty;

        for (uint i = 0; i < headers.length; i++) {
            // read metadata from rlp encoded header
            
            (decodedParent, decodedBlockNumber, decodedDifficulty) = getParentBlockNumberDiff(headers[i]);
            
            difficulty += decodedDifficulty;
            leaves[i] = keccak256(headers[i]);
            require(i > 0? leaves[i-1] == decodedParent : parentMetadata.lastHash == decodedParent, "parent block is not correct");
        }

        RootMetadata memory newRoot;
        newRoot.parentRoot = parentRoot;
        newRoot.totalDifficulty = difficulty;
        newRoot.blockNumber = uint24(decodedBlockNumber);
        newRoot.lengthUpdate = newRoot.blockNumber - parentBlockNumber;
        newRoot.lockedUntil = uint64(block.timestamp + LOCK_PERIOD_IN_MIN);
        newRoot.submitter = msg.sender;
        newRoot.lastHash = leaves[headers.length-1];

        bytes32 newRootHash = MerkleTree.calculateMerkleTree(leaves);
        // add block to successors of parent
        parentMetadata.successors.push(newRootHash);
        // check if parent is an endpoint or root
        if (iterableEndpoints.length > parentMetadata.iterableIndex && iterableEndpoints[parentMetadata.iterableIndex] == parentRoot) {
            // parentHeader is an endpoint (and no fork) -> replace parentHeader in endpoints by new header (since new header becomes new endpoint)
            newRoot.forkId = parentMetadata.forkId;
            iterableEndpoints[parentMetadata.iterableIndex] = newRootHash;
            newRoot.iterableIndex = parentMetadata.iterableIndex;
            delete parentMetadata.iterableIndex;
            newRoot.latestFork = parentMetadata.latestFork;
        } else {
            // parentHeader is forked
            maxForkId += 1;
            newRoot.forkId = maxForkId;
            iterableEndpoints.push(newRootHash);
            newRoot.iterableIndex = uint64(iterableEndpoints.length - 1);
            newRoot.latestFork = parentRoot;

            if (parentMetadata.successors.length == 2) {
                // a new fork was created, so we set the latest fork of the original branch to the newly created fork
                // this has to be done only the first time a fork is created and updates the whole chain from parent header
                // to every successor having exactly one successor
                setLatestForkAtSuccessors(rootChain[parentMetadata.successors[0]], parentRoot);
            }
        }

        // if total difficulty is higher, a new longest chain came up
        if (newRoot.totalDifficulty > rootChain[longestChainEndpoint].totalDifficulty) {
            longestChainEndpoint = newRootHash;
        }
        
        // save root, important: make sure to persist the header only AFTER all property changes
        rootChain[newRootHash] = newRoot;
        return newRootHash;
    }

    event DisputeBlock(uint returnCode);
    event PoWValidationResult(uint returnCode, uint errorInfo);
    event rootP(bytes32 rootParent, RootMetadata rm);
    /// @dev If a client is convinced that a certain block header is invalid, it can call this function which validates
    ///      whether enough PoW has been carried out.
    /// @param rlpHeader the encoded version of the block header to dispute
    /// @param rlpParent the encoded version of the block header's parent
    /// @param powmetadata metadata for validating PoW
    /// @return A list of addresses belonging to the submitters of illegal blocks
    function disputeBlock(bytes calldata rlpHeader, bytes calldata rlpParent, PoWMetadata calldata powmetadata,
        bytes32 root, bytes32 rootParent) internal returns (address[] memory) {

        // Currently, once the dispute period is over and the block is unlocked we accept it as valid.
        // In that case, no validation is carried out anymore.

        // outsourcing verifying of validity and PoW because solidity encountered a stack too deep exception before
        uint returnCode = verifyValidityAndPoW(rlpHeader, rlpParent, powmetadata, root, rootParent);

        address[] memory submittersToPunish = new address[](0);

        if (returnCode != 0) {
            submittersToPunish = removeBranch(root);            
        }

        emit DisputeBlock(returnCode);

        return submittersToPunish;
    }

    // helper function to not get a stack to deep exception
    function verifyValidityAndPoW(bytes calldata rlpHeader, bytes memory rlpParent,  PoWMetadata calldata powmetadata, bytes32 root, bytes32 rootParent) private returns (uint) {
        uint returnCode;
        uint24 blockNumber;
        uint nonce;
        uint difficulty;

        // verify validity of header and parent
        (returnCode, blockNumber, nonce, difficulty) = verifyValidity(rlpHeader, rlpParent, root, rootParent);

        // if return code is 0, the block and it's parent seem to be valid
        // next check the ethash PoW algorithm
        if (returnCode == 0) {
            // header validation without checking Ethash was successful -> verify Ethash
            return invokeVerifyPoW(rlpHeader, powmetadata, blockNumber, nonce, difficulty);
        }

        return returnCode;
    }

    function invokeVerifyPoW (bytes calldata rlpHeader,  PoWMetadata calldata powmetadata, uint24 blockNumber,
        uint nonce, uint difficulty) private returns (uint) {
        // header validation without checking Ethash was successful -> verify Ethash
        uint errorInfo;
        uint returnCode;

        (returnCode, errorInfo) = ethashContract.verifyPoW(blockNumber, getRlpHeaderHashWithoutNonce(rlpHeader),
            nonce, difficulty, powmetadata.dataSetLookup, powmetadata.witnessForLookup);

        emit PoWValidationResult(returnCode, errorInfo);
        return returnCode;
    }

    // initially this logic was part of the disputeBlock method, but as the solidity compiler failed for
    // such big logic blocks the logic was split in 2 sub methods to save stack space
    // so maybe this necessary call can be enhanced to use a little less gas integrating in the upper method while
    // preserving the logic, e.g. the storedParent is read read from storage 2 times, maybe pass as argument if cheaper,
    // this should not cause too much cost increase
    function verifyValidity(bytes memory rlpBlock, bytes memory rlpParent, bytes32 root, bytes32 rootParent) private view returns (uint, uint24, uint, uint) {
        bytes32 parentHash = keccak256(rlpParent);

        require(!isUnlocked(root), "dispute period is expired");

        RootMetadata storage storedRootParent = rootChain[rootParent];

        require(isRootSuccessorOfParent(root, storedRootParent) || root == rootParent, "stored parent is not a predecessor of stored header within MerkleRelay");

        FullHeader memory providedHeader = parseRlpEncodedHeader(rlpBlock);
        FullHeader memory providedParent = parseRlpEncodedHeader(rlpParent);

        require(providedHeader.parent == parentHash, "provided header's parent does not match with provided parent' hash");

        return (checkHeaderValidity(providedHeader, providedParent), uint24(providedHeader.blockNumber), providedHeader.nonce, providedHeader.difficulty);
    }

    function isRootSuccessorOfParent(bytes32 root, RootMetadata memory parent) private pure returns (bool) {
        for (uint i = 0; i < parent.successors.length; i++) {
            bytes32 successor = parent.successors[i];

            if (successor == root) {
                return true;
            }
        }

        return false;
    }

    /// @dev This function verifies that a block belongs to one tree of the rootChain
    function _verifyBlock(TreeProof calldata proofMeta, bytes calldata blockHeader, bytes32 root)
        internal view returns (bool success)
    {   
        success = false;
        require(isRootStored(root), "root is not stored");
        success = MerkleTree.verifyProof(proofMeta.proof, proofMeta.position, keccak256(blockHeader), root);
        return success;
        
    }


    /// @dev Verifies the existence of a transaction, receipt or state ('rlpEncodedValue') within a certain block ('rootHash').
    /// @param rootHash the hash of the block that contains the Merkle root hash
    /// @param noOfConfirmations the required number of succeeding blocks needed for a block to be considered as confirmed
    /// @param rlpEncodedValue the value of the Merkle Patricia trie (e.g. transaction, receipt, state) in RLP format
    /// @param path the path (key) in the trie indicating the way starting at the root node and ending at the value (e.g. transaction)
    /// @param rlpEncodedNodes an RLP encoded list of nodes of the Merkle branch, first element is the root node, last element the value
    /// @param merkleRootHash the hash of the root node of the Merkle Patricia trie
    /// @return 0: verification was successful
    ///         1: block is confirmed and unlocked, but the Merkle proof was invalid
    //
    // The verification follows the following steps:
    //     1. Verify that the given block is part of the longest Proof of Work chain. this suffices when used in combination with noOfConfirmations and lockedUntil params
    //     2. Verify that the block is unlocked and has been confirmed by at least n succeeding unlocked blocks ('noOfConfirmations')
    //     3. Verify the Merkle Patricia proof of the given block
    //
    // In case we have to check whether enough block confirmations occurred
    // starting from the requested block ('rootHash'), we go to the latest
    // unlocked block on the longest chain path (could be the requested block itself)
    // and count the number of confirmations (i.e. the number of unlocked blocks),
    // starting from the latest unlocked block along the longest chain path.
    // The verification only works, if at least 1 (altruistic) participant submits blocks from the source blockchain to retain the correct longest chain
    // and 1 (altruistic) participant disputes illegal blocks to prevent fake/invalid blocks building the longest chain (this can be the same participant)
    function verifyMerkleProof(bytes32 rootHash, uint8 noOfConfirmations, bytes memory rlpEncodedValue,
        bytes memory path, bytes memory rlpEncodedNodes, bytes32 merkleRootHash, bytes32 root) internal returns (uint8) {

        (bool isPartOfLongestPoWCFork, bytes32 confirmationStart) = isBlockPartOfFork(root, longestChainEndpoint);
        require(isPartOfLongestPoWCFork, "block is not part of the longest PoW chain");

        // if (rootChain[confirmationStart].blockNumber <= rootChain[root].blockNumber + noOfConfirmations) {
        //     noOfConfirmations = noOfConfirmations - uint8(rootChain[confirmationStart].blockNumber - rootChain[root].blockNumber);
        //     bool unlockedAndConfirmed = hasEnoughConfirmations(confirmationStart, noOfConfirmations);
        //     require(unlockedAndConfirmed, "block is locked or not confirmed by enough blocks");
        // }

        if (MerklePatriciaProof.verify(rlpEncodedValue, path, rlpEncodedNodes, merkleRootHash) > 0) {
            return 1;
        }

        return 0;
    }

    function isBlockConfirmed(bytes32 root, uint8 noOfConfirmations) internal view returns (bool) {

        if (isRootStored(root) == false) {
            return false;
        }

        (bool isPartOfLongestPoWCFork, bytes32 confirmationStart) = isBlockPartOfFork(root, longestChainEndpoint);
        if (isPartOfLongestPoWCFork == false) {
            return false;
        }

        if (rootChain[confirmationStart].blockNumber <= rootChain[root].blockNumber + noOfConfirmations) {
            noOfConfirmations = noOfConfirmations - uint8(rootChain[confirmationStart].blockNumber - rootChain[root].blockNumber);
            bool unlockedAndConfirmed = hasEnoughConfirmations(confirmationStart, noOfConfirmations);
            if (unlockedAndConfirmed == false) {
                return false;
            }
        }

        return true;
    }

    function isBlockPartOfFork(bytes32 rootHash, bytes32 forkEndpoint) private view returns (bool, bytes32) {
        bytes32 current = forkEndpoint;
        bytes32 confirmationStartHeader;    // the hash from where to start the confirmation count in case the requested block header is part of the longest chain
        uint lastForkId;

        // Current is still the endpoint
        // if the endpoint is already unlocked we need to start the confirmation verification from the endpoint
        if (isUnlocked(current)) {
            confirmationStartHeader = current;
        }

        while (rootChain[current].forkId > rootChain[rootHash].forkId) {
            // go to next fork point but remember last fork id
            lastForkId = rootChain[current].forkId;
            current = rootChain[current].latestFork;

            // set confirmationStartHeader only if it has not been set before
            if (confirmationStartHeader == 0) {
                if (isUnlocked(current)) {
                    confirmationStartHeader = getSuccessorByForkId(current, lastForkId);
                }
            }
        }

        if (rootChain[current].forkId < rootChain[rootHash].forkId) {
            return (false, confirmationStartHeader);   // the requested block is NOT part of the longest chain
        }

        if (rootChain[current].blockNumber < rootChain[rootHash].blockNumber) {
            // current and the requested block are on a fork with the same fork id
            // however, the requested block comes after the fork point (current), so the requested block cannot be part of the longest chain
            return (false, confirmationStartHeader);
        }

        // if no earlier block header has been found from where to start the confirmation verification,
        // we start the verification from the requested block header
        if (confirmationStartHeader == 0) {
            confirmationStartHeader = rootHash;
        }

        return (true, confirmationStartHeader);
    }

    function getSuccessorByForkId(bytes32 rootHash, uint forkId) private view returns (bytes32) {
        for (uint i = 0; i < rootChain[rootHash].successors.length; i++) {
            bytes32 successor = rootChain[rootHash].successors[i];

            if (rootChain[successor].forkId == forkId) {
                return successor;
            }
        }

        return rootHash;
    }

    // @dev Checks whether a block has enough succeeding blocks that are unlocked (dispute period is over).
    // Note: The caller has to make sure that this method is only called for paths where the required number of
    // confirmed blocks does not go beyond forks, i.e., each block has to have a clear successor.
    // If a block is a fork, i.e., has more than one successor and requires more than 0 confirmations
    // the method returns false, which may or may not represent the true state of the system.
    function hasEnoughConfirmations(bytes32 start, uint8 noOfConfirmations) private view returns (bool) {
        if (!isUnlocked(start)) {
            return false;   // --> block is still locked and can therefore not be confirmed
        }

        if (noOfConfirmations == 0) {
            return true;    // --> block is unlocked and no more confirmations are required
        }

        if (rootChain[start].successors.length == 0) {
            // More confirmations are required but block has no more successors.
            return false;
        }

        return hasEnoughConfirmations(rootChain[start].successors[0], noOfConfirmations - 1);
    }

    function setLatestForkAndForkIdAtSuccessors(RootMetadata storage root, bytes32 latestFork, uint64 forkId) private {
        if (root.latestFork == latestFork) {
            // latest fork has already been set
            return;
        }

        root.latestFork = latestFork;
        root.forkId = forkId;

        if (root.successors.length == 1) {
            setLatestForkAndForkIdAtSuccessors(rootChain[root.successors[0]], latestFork, forkId);
        }
    }

    event RemoveBranch(bytes32 root);
    function removeBranch(bytes32 root) private returns (address[] memory) {
        bytes32 parentHash = rootChain[root].parentRoot;
        RootMetadata storage parentRoot = rootChain[parentHash];
        
        address[] memory submitters = pruneBranch(root, 0);
        if (parentRoot.successors.length == 1) {
            // parentHeader has only one successor --> parentHeader will be an endpoint after pruning
            iterableEndpoints.push(parentHash);
            parentRoot.iterableIndex = uint64(iterableEndpoints.length - 1);
        }

        // remove root (which will be pruned) from the parent's successor list
        for (uint i=0; i < parentRoot.successors.length; i++) {
            if (parentRoot.successors[i] == root) {

                // overwrite root with last successor and delete last successor
                parentRoot.successors[i] = parentRoot.successors[parentRoot.successors.length - 1];
                parentRoot.successors.pop();

                // we remove at most one element, if this is done we can break to save gas
                break;
            }
        }

        if (parentRoot.successors.length == 1) {
            // only one successor left after pruning -> parent is no longer a fork junction
            setLatestForkAndForkIdAtSuccessors(rootChain[parentRoot.successors[0]], parentRoot.latestFork, parentRoot.forkId);
        }

        // find new longest chain endpoint
        longestChainEndpoint = iterableEndpoints[0];
        for (uint i=1; i<iterableEndpoints.length; i++) {
            if (rootChain[iterableEndpoints[i]].totalDifficulty > rootChain[longestChainEndpoint].totalDifficulty) {
                longestChainEndpoint = iterableEndpoints[i];
            }
        }

        emit RemoveBranch(root);

        return submitters;
    }

    function pruneBranch(bytes32 root, uint counter) private returns (address[] memory) {
        RootMetadata storage rootHeader = rootChain[root];
        address[] memory submitters;

        counter += 1;

        if (rootHeader.successors.length > 1) {
            address[] memory aggregatedSubmitters = new address[](0);

            for (uint i = 0; i < rootHeader.successors.length; i++) {
                address[] memory submittersOfBranch = pruneBranch(rootHeader.successors[i], 0);

                aggregatedSubmitters = combineArrays(aggregatedSubmitters, submittersOfBranch);
            }

            submitters = copyArrays(new address[](aggregatedSubmitters.length + counter), aggregatedSubmitters, counter);

        }

        if (rootHeader.successors.length == 1) {
            submitters = pruneBranch(rootHeader.successors[0], counter);
        }

        if (iterableEndpoints.length > rootHeader.iterableIndex && iterableEndpoints[rootHeader.iterableIndex] == root) {
            // root is an endpoint --> delete root in endpoints array, since root will be deleted and thus can no longer be an endpoint
            bytes32 lastIterableElement = iterableEndpoints[iterableEndpoints.length - 1];

            iterableEndpoints[rootHeader.iterableIndex] = lastIterableElement;
            iterableEndpoints.pop();

            rootChain[lastIterableElement].iterableIndex = rootHeader.iterableIndex;

            submitters = new address[](counter);
        }

        submitters[counter-1] = rootChain[root].submitter;

        delete rootChain[root];

        return submitters;
    }

    function setLatestForkAtSuccessors(RootMetadata storage root, bytes32 latestFork) private {
        if (root.latestFork == latestFork) {
            // latest fork has already been set
            return;
        }

        root.latestFork = latestFork;

        if (root.successors.length == 1) {
            setLatestForkAtSuccessors(rootChain[root.successors[0]], latestFork);
        }
    }
  

    function copyArrays(address[] memory dest, address[] memory src, uint startIndex) private pure returns (address[] memory) {
        require(dest.length - startIndex >= src.length);

        uint j = startIndex;

        for (uint i = 0; i < src.length; i++) {
            dest[j] = src[i];
            j++;
        }

        return dest;
    }

    function combineArrays(address[] memory arr1, address[] memory arr2) private pure returns (address[] memory) {
        address[] memory resultArr = new address[](arr1.length + arr2.length);
        uint i = 0;

        // copy arr1 to resultArr
        for (; i < arr1.length; i++) {
            resultArr[i] = arr1[i];
        }

        // copy arr2 to resultArr
        for (uint j = 0; j < arr2.length; j++) {
            resultArr[i] = arr2[j];
            i++;
        }

        return resultArr;
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

    function getTxRoot(bytes memory rlpHeader) internal pure returns (bytes32) {
        RLPReader.Iterator memory it = rlpHeader.toRlpItem().iterator();
        uint idx;
        while(it.hasNext()) {
            if ( idx == 4 ) return bytes32(it.next().toUint());
            else it.next();

            idx++;
        }

        return 0;
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

    function getReceiptsRoot(bytes memory rlpHeader) internal pure returns (bytes32) {
        RLPReader.Iterator memory it = rlpHeader.toRlpItem().iterator();
        uint idx;
        while(it.hasNext()) {
            if ( idx == 5 ) return bytes32(it.next().toUint());
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

    function copy(bytes memory sourceArray, uint newLength) private pure returns (bytes memory) {
        uint newArraySize = newLength;

        if (newArraySize > sourceArray.length) {
            newArraySize = sourceArray.length;
        }

        bytes memory newArray = new bytes(newArraySize);

        for(uint i = 0; i < newArraySize; i++){
            newArray[i] = sourceArray[i];
        }

        return newArray;
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
        if (iterableEndpoints.length != 0) {
            // check chronological blockNumber order
            if (parent.blockNumber + 1 != header.blockNumber) return 4;

            // check chronological timestamp order
            if (parent.timestamp >= header.timestamp) return 6;

            // check difficulty
            uint expectedDifficulty = calculateDifficulty(parent, header.timestamp);
            if (expectedDifficulty != header.difficulty) return 7;

            // validate gas limit with parent
            if (!gasLimitWithinBounds(int64(uint64(header.gasLimit)), int64(uint64(parent.gasLimit)))) return 10;
        }

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