const Web3 = require("web3");
const Identity = require('../utils/identity');
const { secretKey, secondarySecretKey } = require( '../secrets.json');

const {BN, expectRevert, time, balance} = require('@openzeppelin/test-helpers');
const {createRLPHeader, calculateBlockHash, addToHex, createRLPValueState, createRLPNodeEncodeState} = require('../utils/utils');
const expectEvent = require('./expectEvent');
const RLP = require('rlp');
const {bytesToHex} = require("web3-utils");
const keccak256 = require('keccak256');
const { asciiToHex } = require( "web3-utils");

const { arrToBufArr, bufArrToArr, toBuffer, bufferToInt, bufferToHex, keccak} = require('ethereumjs-util');

const identity = new Identity('http://127.0.0.1:8545', secretKey);

const { INFURA_TESTNET_ENDPOINT, INFURA_MAINNET_ENDPOINT } = require("../constant");

const ccIdentityContract = artifacts.require('./ccIdentityContract');
const DIDRegistry = artifacts.require('./EthereumDIDRegistry');
const StateRelay = artifacts.require('./StateRelay');
const Ethash = artifacts.require('./Ethash');
const ECDSAVerifierV2 = artifacts.require('./ECDSAVerifierV2');

const {expect} = require('chai');
const { web3 } = require("@openzeppelin/test-helpers/src/setup");
const epochData = require("./pow/epochMine.json");

const ZERO_HASH                 = '0x0000000000000000000000000000000000000000000000000000000000000000';
const LOCK_PERIOD               = time.duration.minutes(5);
const ALLOWED_FUTURE_BLOCK_TIME = time.duration.seconds(15);
const MAX_GAS_LIMIT             = 2n ** 63n - 1n;
const MIN_GAS_LIMIT             = 5000;
const GAS_PRICE_IN_WEI          = new BN(0);
const EPOCH                     = 427; 
const GENESIS_BLOCK             = 12814531;  // block of the prove - 3
expect(Math.floor(GENESIS_BLOCK / 30000), "genesis block not in epoch").to.equal(EPOCH);

contract('ccIdentityContract', async(accounts) => {

    let ethash;
    let mainWeb3;
    let destinationWeb3;
    let next_gas_price;
    let Verifier;
    let staterelay;
    let signatureVerifier;

    describe('Test its functionalities', function() {
        let tx = "";
        let account;
        let Verifier;
        let blockRlp;

        before(async () => {
            mainWeb3 = new Web3(INFURA_MAINNET_ENDPOINT);
            destinationWeb3 = new Web3('http://127.0.0.1:8545');

            const block = await mainWeb3.eth.getBlock('latest');
            next_gas_price = Math.ceil(block.baseFeePerGas);

            ethash = await Ethash.new();
            const epochData = require("./pow/epochMine.json");
            console.log(`Submitting data for epoch ${EPOCH} to Ethash contract...`);
            await submitEpochData(ethash, EPOCH, epochData.FullSizeIn128Resolution, epochData.BranchDepth, epochData.MerkleNodes);
            console.log("Submitted epoch data.");

            const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
            const genesisRlpHeader = createRLPHeader(genesisBlock);

            staterelay = await StateRelay.new({
                from: accounts[0],
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,
            });

            signatureVerifier = await ECDSAVerifierV2.new({
                    from: accounts[0],
                    maxFeePerGas: next_gas_price,
                    gasPrice: GAS_PRICE_IN_WEI
            })

            await time.advanceBlock();

            const requiredStakePerBlock = await staterelay.getRequiredStakePerState();
            const stake = requiredStakePerBlock.mul(new BN(1));
            
            // let ret = await staterelay.depositStake(stake, {
            //     from: accounts[1],
            //     value: stake,
            //     maxFeePerGas: next_gas_price,
            //     gasPrice: GAS_PRICE_IN_WEI
            // });


        });
    
        beforeEach(async () => {
            const block = await mainWeb3.eth.getBlock('latest');
            const next_gas_price = Math.ceil(block.baseFeePerGas);
            account = identity.getAccount();
            contractAddress = await identity.initRegistry(DIDRegistry.abi, DIDRegistry.bytecode);
            // console.log(contractAddress);

            Verifier = await ccIdentityContract.new(contractAddress, staterelay.address, {
                from: accounts[1],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });
            // console.log(Verifier.address)
        });

        it('successfully declare an identity in the DIDRegistry', async () => {
            
            // attach identity to the smart contract through changeOwner
            let txHash = await identity.setContractOwner(Verifier.address);

            let obj = ["ECDSAVerificationKey", destinationWeb3.eth.accounts.privateKeyToAccount(secondarySecretKey).address];
            let r = identity.createAlias("website2", "http://example.com", obj)
            let b32 = r[0];
            let bvalue = r[1]

            let ret = await Verifier.declareIdentity(bvalue, 100, asciiToHex(`${1}`), signatureVerifier.address, {
                from: accounts[1],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            })
            console.log("Gas used for declare an identity: ", ret.receipt.gasUsed);
            let count = await computeZeroBytes(ret);
            console.log("Zero bytes for this transaction are", count[0], "and the nonZero ones are", count[1]);

            // ret = await localWeb3.eth.getTransactionReceipt(ret.tx);

            expectEvent.inLogs(ret.logs, 'IdentityDeclared');

            await disconnectIdentity(ret, Verifier);
        });



        it('successfully verify an identity in the DIDRegistry', async () => {
            
            // attach identity to the smart contract through changeOwner
            let txHash = await identity.setContractOwner(Verifier.address);

            let obj = ["ECDSAVerificationKey", destinationWeb3.eth.accounts.privateKeyToAccount(secondarySecretKey).address];
            let r = identity.createAlias("website2", "http://example.com", obj)
            let b32 = r[0];
            let bvalue = r[1]

            let ret = await Verifier.declareIdentity(bvalue, 100, asciiToHex(`${1}`), signatureVerifier.address, {
                from: accounts[1],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            })

            expectEvent.inLogs(ret.logs, 'IdentityDeclared');
            let blockHash = bufferToHex(keccak256(createRLPHeader(await destinationWeb3.eth.getBlock(ret.receipt.blockNumber))));
            let signature = destinationWeb3.eth.accounts.sign(blockHash, secondarySecretKey);

            ret = await Verifier.verifySignature(asciiToHex(`${1}`),
                signature.v,
                signature.r,
                signature.s, {
                from: accounts[1],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });
            console.log("Gas used for verifying an identity: ", ret.receipt.gasUsed);
            let count = await computeZeroBytes(ret);
            console.log("Zero bytes for this transaction are", count[0], "and the nonZero ones are", count[1]);

            expectEvent.inLogs(ret.logs, 'VerifiedSignature');

            await disconnectIdentity(ret, Verifier);
        });

        it('not verifying an identity in the DIDRegistry: type is not correct', async () => {
            
            // attach identity to the smart contract through changeOwner
            let txHash = await identity.setContractOwner(Verifier.address);

            let obj = ["ECDSAVerification", destinationWeb3.eth.accounts.privateKeyToAccount(secondarySecretKey).address];
            let r = identity.createAlias("website2", "http://example.com", obj)
            let b32 = r[0];
            let bvalue = r[1]

            let ret = await Verifier.declareIdentity(bvalue, 100, asciiToHex(`${1}`), signatureVerifier.address, {
                from: accounts[1],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });

            let blockHash = (await destinationWeb3.eth.getBlock(ret.receipt.blockNumber)).hash;
            let signature = destinationWeb3.eth.accounts.sign(blockHash, secondarySecretKey);

            await expectRevert.unspecified(Verifier.verifySignature(asciiToHex(`${1}`),
                signature.v,
                signature.r,
                signature.s, {
                from: accounts[1],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            }));

            await disconnectIdentity(ret, Verifier);
        });

        it('successfully transfer an identity state in the DIDRegistry', async () => {

            const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
            const stake = new BN(1000000001);
            const balanceBeforeCall = await staterelay.getStake({from: accounts[0]});

            const startBalance = await mainWeb3.eth.getBalance(accounts[0]);//, GENESIS_BLOCK);
            const genesisRlpHeader = createRLPHeader(genesisBlock);

            await staterelay.depositStake(stake, {from: accounts[1], value: stake, maxFeePerGas: next_gas_price});
            const balanceAfterCall = await staterelay.getStake({from: accounts[1]});

            expect(balanceAfterCall).to.be.bignumber.equal(balanceBeforeCall.add(stake));

            await staterelay.initState(accounts[0], genesisRlpHeader, mainWeb3.utils.toHex(startBalance), ethash.address, {
                from: accounts[1],
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,
            });

            const state = mainWeb3.utils.hexToNumberString(await staterelay.getState(accounts[0]));
            expect(state).to.be.bignumber.equal(startBalance);

            // attach identity to the smart contract through changeOwner
            let txHash = await identity.setContractOwner(Verifier.address);

            let obj = ["ECDSAVerificationKey", destinationWeb3.eth.accounts.privateKeyToAccount(secondarySecretKey).address];
            let r = identity.createAlias("website2", "http://example.com", obj)
            let b32 = r[0];
            let bvalue = r[1]

            let ret = await Verifier.declareIdentity(bvalue, 100, asciiToHex(`${4}`), signatureVerifier.address, {
                from: accounts[1],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            })
            
            expectEvent.inLogs(ret.logs, 'IdentityDeclared');
            let blockHash = bufferToHex(keccak256(createRLPHeader(await destinationWeb3.eth.getBlock(ret.receipt.blockNumber))));
            let signature = destinationWeb3.eth.accounts.sign(blockHash, secondarySecretKey);

            ret = await Verifier.verifySignature(asciiToHex(`${4}`),
                signature.v,
                signature.r,
                signature.s, {
                    from: accounts[1],
                    maxFeePerGas: next_gas_price,
                    gasPrice: GAS_PRICE_IN_WEI
                });

            expectEvent.inLogs(ret.logs, 'VerifiedSignature');

            const newBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 4));
            const intermediateBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 5));
            const confirmingBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 10));

            ret = await Verifier.transferState(asciiToHex(`${4}`),
                newBlock,
                confirmingBlock,
                intermediateBlock,
                mainWeb3.utils.toHex(startBalance),
                10,
                {
                from: accounts[1],
                gas:3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,

            });
            console.log("Gas used for submitting the new state (after 10 blocks): ", ret.receipt.gasUsed);
            let count = await computeZeroBytes(ret);
            console.log("Zero bytes for this transaction are", count[0], "and the nonZero ones are", count[1]);

            expectEvent.inLogs(ret.logs, 'StateTransferred');

            await disconnectIdentity(ret, Verifier);

        });

    });

     const computeZeroBytes = async (ret) => {
        let tx = await destinationWeb3.eth.getTransaction(ret.tx);
        let count = tx.input.split('00').length - 1;
        return [count, tx.input.length - count];
    }

    const disconnectIdentity = async (ret, Verifier) => {
        ret = await Verifier.detachIdentity(asciiToHex(`${1}`),
            {
                from: accounts[1],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });

        expectEvent.inLogs(ret.logs, 'IdentityDisconnected');
    }

    const submitEpochData = async (ethashContractInstance, epoch, fullSizeIn128Resolution, branchDepth, merkleNodes) => {
        let start = new BN(0);
        let nodes = [];
        let mnlen = 0;
        let index = 0;
        for (let mn of merkleNodes) {
            nodes.push(mn);
            if (nodes.length === 40 || index === merkleNodes.length - 1) {
                mnlen = new BN(nodes.length);

                if (index < 440 && epoch === 128) {
                    start = start.add(mnlen);
                    nodes = [];
                    return;
                }

                await ethashContractInstance.setEpochData(epoch, fullSizeIn128Resolution, branchDepth, nodes, start, mnlen);

                start = start.add(mnlen);
                nodes = [];
            }
            index++;
        }
    };

    const prepareReceiptProof = (proof) => {
        // the path is HP encoded
        const indexBuffer = proof.txIndex.slice(2);
        const hpIndex = "0x" + (indexBuffer.startsWith("0") ? "1" + indexBuffer.slice(1) : "00" + indexBuffer);

        // the value is the second buffer in the leaf (last node)
        const value = "0x" + Buffer.from(proof.receiptProof[proof.receiptProof.length - 1][1]).toString("hex");
        // the parent nodes must be rlp encoded
        const parentNodes =  arrToBufArr(RLP.encode(proof.receiptProof));

        return {
            path: hpIndex,
            rlpEncodedReceipt: value,
            witness: parentNodes
        };
    };

    const getAccountState = async (rpc, accountAddr, blockNumber) => {
        let proof = await rpc.eth.getProof(accountAddr, [], blockNumber);
        if (proof == undefined) return RLP.decode()
        let temp = RLP.decode((proof.accountProof)[proof.accountProof.length-1])
        return arrToBufArr(temp[1]);
    }

    const getAccountProof = async (rpc, accountAddr, blockNumber) => {
        let proof = await rpc.eth.getProof(accountAddr, [], blockNumber);
        // console.log(proof)
        return (proof.accountProof)[proof.accountProof.length-1],createRLPNodeEncodeState(proof.accountProof);
    }

    // const submitBlockHeaders = async (expectedHeaders, accountAddr) => {
    //     await asyncForEach(expectedHeaders, async expected => {
    //         const rlpHeader = createRLPHeader(expected.block);
    //         await time.increase(time.duration.seconds(15));
    //         await ethrelay.submitBlock(rlpHeader, {from: accountAddr, maxFeePerGas: next_gas_price, gasPrice: GAS_PRICE_IN_WEI});
    //         const submitTime = await time.latest();
    //         expected.lockedUntil = submitTime.add(LOCK_PERIOD);
    //     });
    // };

    const asyncForEach = async (array, callback) => {
        for (let index = 0; index < array.length; index++) {
            await callback(array[index], index, array);
        }
    };
    
    
});