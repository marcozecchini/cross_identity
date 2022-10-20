// SPDX-License-Identifier: MIT
pragma solidity >=0.7.0 <0.9.0;

import "./StateRelayCore.sol";
import "./libraries/RLPReader.sol";

/// @title StateRelay: A contract enabling cross-blockchain state verifications
/// @notice You can use this contract for submitting new user state along with block headers, disputing already submitted block headers and
/////         for verifying Merkle Patricia proofs of states
/// @dev    This contract uses the StateRelayCore contract and extends it with an incentive structure.
contract StateRelay is StateRelayCore {

    using RLPReader for *;
    bytes32 public constant BLOCKCHAIN_ID = keccak256(abi.encodePacked("4"));
    uint public constant REQUIRED_STAKE_PER_STATE = 1 wei;
    uint public constant REQUIRED_STAKE_PER_CHALLENGE = 1 wei;

    address challenger;
    bool gotoState = false;

    mapping(address => uint) NumberOfStateSubmittedByClient;
    mapping(address => uint) clientStake;

    // The contract is initialized with block 8084509 and the total difficulty of that same block.
    // The contract creator needs to make sure that these values represent a valid block of the tracked blockchain.
    constructor() StateRelayCore() {}

    function initState(address identifier, bytes memory _rlpHeader, bytes memory _state, address _ethashContractAddr) public {
        // require(getStake(msg.sender) >= REQUIRED_STAKE_PER_STATE, "provided fee is less than expected fee"); // TODO it always revert...
        _initState(BLOCKCHAIN_ID, identifier, _rlpHeader, _state, _ethashContractAddr);
    }
    
    function getState(address identifier) public view returns (bytes memory state) {
        return _getState(BLOCKCHAIN_ID, identifier).stateContent;
    }
    /// @dev Deposits stake for a client allowing the client to submit block headers.
    function depositStake(uint amount) public payable {
        require(amount == msg.value, "transfer amount not equal to function parameter");
        clientStake[msg.sender] = clientStake[msg.sender] + msg.value;
    }

    event WithdrawStake(address client, uint withdrawnStake);
    /// @dev Withdraws the stake of a client. The stake is reduced by the specified amount. Emits an event WithdrawStake
    ///      containing the client's address and the amount of withdrawn stake.
    function withdrawStake(uint amount) public {
        // if participant has not emitted amount stake we can for sure revert
        require(clientStake[msg.sender] >= amount, "amount higher than deposited stake");

        // else we check the unlocked stake and if enough stake is available we simply withdraw amount
        if (getUnusedStake(msg.sender) >= amount) {
            withdraw(payable(msg.sender), amount);
            emit WithdrawStake(msg.sender, amount);
            return;
        }

        // no enough free stake -> try to clean up array (search for stakes used by blocks that have already passed the lock period)
        cleanSubmitList(msg.sender);

        // if less than amount is available, we simply withdraw 0, so the client can distinguish
        // between the case a participant doesn't event hold amount stake or it is simply locked
        if (getUnusedStake(msg.sender) >= amount) {
            withdraw(payable(msg.sender), amount);
            emit WithdrawStake(msg.sender, amount);
            return;
        }

        if (challenger == msg.sender) {
            return;
        }

        emit WithdrawStake(msg.sender, 0);
    }

    function withdrawTimeout() public {
        bool result;
        uint who;
        (result, who) = isTimeout(BLOCKCHAIN_ID, msg.sender);
        if (result) {
            if (who==2) {
                clientStake[challenger] += REQUIRED_STAKE_PER_STATE;
            } else {
                clientStake[getIdentityAddress(BLOCKCHAIN_ID, msg.sender)] += REQUIRED_STAKE_PER_CHALLENGE;
            }
            challenger = address(0);
        }
    }
    
    function getStake() public view returns (uint) {
        return clientStake[msg.sender];
    }

    function getRequiredStakePerState() public pure returns (uint) {
        return REQUIRED_STAKE_PER_STATE;
    }

    function getRequiredChallengerFee() public pure returns (uint) {
        return REQUIRED_STAKE_PER_CHALLENGE;
    }

    function getNumberOfStateSubmittedByClient() public view returns (uint) {
        return NumberOfStateSubmittedByClient[msg.sender];
    }

    function submitState(bytes memory rlpHeader, bytes memory rlpConfirmingHeader, bytes memory rlpIntermediateHeader, bytes memory stateContent, uint lengthUpdate) public returns (uint){
        // // client must have enough stake to be able to submit blocks
        require(getStake() >= REQUIRED_STAKE_PER_STATE, "provided fee is less than expected fee");
        
        // client has enough stake -> submit header and add its hash to the client's list of submitted block headers
        return _submitState(BLOCKCHAIN_ID, msg.sender, rlpHeader, rlpConfirmingHeader, rlpIntermediateHeader, stateContent, lengthUpdate);

    }

    function challengerMessage(address submitter, bytes32 upperLimitBlockHash) public returns (bool) {
        require(getStake() >= REQUIRED_STAKE_PER_CHALLENGE, "provided fee is less than expected fee");
        if (msg.sender == challenger || challenger == address(0)) {
            challenger = msg.sender;
            return _challengerMessage(BLOCKCHAIN_ID, submitter, upperLimitBlockHash);
        }
        return false;
    }

    function sumbitterMessage(bytes memory _rlpIntermediateBlockHeader) public returns (bool) {
        require(getIdentityAddress(BLOCKCHAIN_ID, msg.sender) == msg.sender, "user not enabled to answer");
        require(getStake() >= REQUIRED_STAKE_PER_STATE, "provided fee is less than expected fee");

        return _sumbitterMessage(BLOCKCHAIN_ID, msg.sender, _rlpIntermediateBlockHeader);
    }


    event DisputeWinner(address client, bool cancelledState);
    /// @dev Function that ends the dispute among the submitter and the challenger
    function verifyBlock(bytes calldata rlpHeader, bytes memory rlpParent, uint[] memory dataSetLookup, uint[] memory witnessForLookup) public {
        require(getIdentityAddress(BLOCKCHAIN_ID, msg.sender) == msg.sender, "user not enabled to answer");
        require(getStake() >= REQUIRED_STAKE_PER_STATE, "provided fee is less than expected fee");
        require(!gotoState, "no call it again");
        
        if (disputeBlock(BLOCKCHAIN_ID, msg.sender, rlpHeader, rlpParent, dataSetLookup, witnessForLookup) != 0) {
            clientStake[challenger] += REQUIRED_STAKE_PER_STATE;
            emit DisputeWinner(challenger, true);
            return;
        }

        gotoState = true;
    }
    function verifyState(bytes memory rlpHeaderN, bytes memory rlpEncodedNodesN, 
            bytes memory rlpHeaderConfirming, bytes memory rlpEncodedNodesConfirming) public {

        bytes32 blockHashN = keccak256(rlpHeaderN);
        bytes32 blockHashConfirming = keccak256(rlpHeaderConfirming);
        bytes32 merkleRootHashN = getStateRoot(rlpHeaderN);
        bytes32 merkleRootHashConfirming = getStateRoot(rlpHeaderConfirming);
        PendingState memory pendingState = getIdentity(BLOCKCHAIN_ID, msg.sender).pendingState;
        
        require(getPendingHash(BLOCKCHAIN_ID, msg.sender) == blockHashN, "hashN provided is not valid");
        require(getConfirmingHash(BLOCKCHAIN_ID, msg.sender) == blockHashConfirming, "hashConf provided is not valid");
        require(getIdentityAddress(BLOCKCHAIN_ID, msg.sender) == msg.sender, "user not enabled to answer");
        require(getStake() >= REQUIRED_STAKE_PER_STATE, "provided fee is less than expected fee");
        require(gotoState, "verify the block before");
        bytes memory path = abi.encode(keccak256(abi.encodePacked(msg.sender)));

        bytes memory stateContent = pendingState.pendingState.stateContent;

        require(pendingState.pendingState.header.stateRoot == merkleRootHashN, "merkleRootHashN not valid");
        if (disputeState(stateContent, path , rlpEncodedNodesN, merkleRootHashN, rlpEncodedNodesConfirming, merkleRootHashConfirming) != 0) {
            clientStake[challenger] += REQUIRED_STAKE_PER_STATE;
            emit DisputeWinner(challenger, true);
            return;
        }

        clientStake[msg.sender] += REQUIRED_STAKE_PER_CHALLENGE;
        challenger = address(0);
        gotoState = false;
        emit DisputeWinner(msg.sender, false);
    }

    


    /// @dev Calculates the stake needed by a client
    function getStake(address client) private view returns (uint) {
        return NumberOfStateSubmittedByClient[client] * REQUIRED_STAKE_PER_STATE;
    }


    /// @dev Calculates the fraction of the provided stake that is not used by any of the blocks in the client's list of
    ///      submitted block headers (blocksSubmittedByClient). It does not matter whether a block's lock period has already
    ///      been elapsed. As long as the block is referenced in blocksSubmittedByClient, the stake is considered as "used".
    function getUnusedStake(address client) private view returns (uint) {
        uint usedStake = NumberOfStateSubmittedByClient[client] * REQUIRED_STAKE_PER_STATE;

        if (clientStake[client] < usedStake) {
            // if a client get punished due to a dispute the clientStake[client] can be less than
            // blocksSubmittedByClient[client].length * REQUIRED_STAKE_PER_STATE, since clientStake[client] is deducted
            // after the dispute, but blocksSubmittedByClient[client] remains unaffected (i.e., it is not cleared)
            return 0;
        } else {
            return clientStake[client] - usedStake;
        }
    }

    // take care of cleanSubmitList, maybe more gas than estimated is needed: e.g. if the time from estimating the gas costs
    // on the local machine to running the code on a node takes so long that a new block is unlocked in this time and can be
    // freed by this procedure, then gas-estimation from before is too less and an out of gas exception occur, this can easily
    // be the case if two blocks are directly relayed and submitted by the same person having less time between the submits
    // as the time from estimation to running the code lasts

    /// @dev Checks for each block referenced in blocksSubmittedByClient whether it is unlocked. In case a referenced
    ///      block's lock period has expired, its reference is removed from the list blocksSubmittedByClient.
    function cleanSubmitList(address client) private view returns (uint) {
        uint deletedElements = 0;

        // TODO cosa fare nel caso del multistate?

        if (isPendingUnlocked(BLOCKCHAIN_ID, client)) {
            deletedElements += 1;
        }

        return deletedElements;
    }

    function withdraw(address payable receiver, uint amount) private {
        clientStake[receiver] = clientStake[receiver] - amount;
        receiver.transfer(amount);
    }
}
