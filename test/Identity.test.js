const Web3 = require("web3");
const Identity = require('../utils/identity');
const { secretKey } = require( '../secrets.json');

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
const Ethrelay = artifacts.require('./Ethrelay');
const Ethash = artifacts.require('./Ethash');

const {expect} = require('chai');
const { web3 } = require("@openzeppelin/test-helpers/src/setup");

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
    let localWeb3;
    let next_gas_price;
    let Verifier;
    let ethrelay;

    describe('Test its functionalities', function() {
        let tx = "";
        let account;
        let Verifier;
        let blockRlp;

        before(async () => {
            mainWeb3 = new Web3(INFURA_MAINNET_ENDPOINT);
            localWeb3 = new Web3('http://127.0.0.1:8545'); 

            const block = await mainWeb3.eth.getBlock('latest');
            next_gas_price = Math.ceil(block.baseFeePerGas);

            ethash = await Ethash.new();
            const epochData = require("./pow/epochMine.json");
            console.log(`Submitting data for epoch ${EPOCH} to Ethash contract...`);
            await submitEpochData(ethash, EPOCH, epochData.FullSizeIn128Resolution, epochData.BranchDepth, epochData.MerkleNodes);
            console.log("Submitted epoch data.");

            const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
            const genesisRlpHeader = createRLPHeader(genesisBlock);
            ethrelay = await Ethrelay.new(genesisRlpHeader, genesisBlock.totalDifficulty, ethash.address, {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });

            await time.advanceBlock();

            const requiredStakePerBlock = await ethrelay.getRequiredStakePerBlock();
            const stake = requiredStakePerBlock.mul(new BN(4));
            let ret = await ethrelay.depositStake(stake, {
                from: accounts[0],
                value: stake,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });

            let block1 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            block1.parentHash = bufferToHex(keccak256(genesisRlpHeader));
            blockRlp = createRLPHeader(block1);
            let block2 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            block2.parentHash = bufferToHex(keccak256(blockRlp));
            blockRlp = createRLPHeader(block2);
            let block3 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            block3.parentHash = bufferToHex(keccak256(blockRlp));
            blockRlp = createRLPHeader(block3);
            let block4 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            block4.parentHash = bufferToHex(keccak256(blockRlp));
            let block5 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            block5.parentHash = bufferToHex(keccak256(blockRlp));
            blockRlp = createRLPHeader(block5);
            let block6 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 6);
            block6.parentHash = bufferToHex(keccak256(blockRlp));
            blockRlp = createRLPHeader(block6);
            let block7 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 7);
            block7.parentHash = bufferToHex(keccak256(blockRlp));
            blockRlp = createRLPHeader(block7);

            blockRlp = createRLPHeader(block1);

            const expectedBlocks = [
                {
                    block: block1,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block1.parentHash,
                    successors: [block2.hash],
                    submitter: accounts[0]
                },
                {
                    block: block2,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block1.parentHash,
                    successors: [block3.hash],
                    submitter: accounts[0]
                },
                {
                    block: block3,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block1.parentHash,
                    successors: [block4.hash],
                    submitter: accounts[0]
                },
                {
                    block: block4,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block1.parentHash,
                    successors: [],
                    submitter: accounts[0]
                },
                {
                    block: block5,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block1.parentHash,
                    successors: [],
                    submitter: accounts[0]
                },
                {
                    block: block6,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block1.parentHash,
                    successors: [],
                    submitter: accounts[0]
                },
                {
                    block: block7,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: block1.parentHash,
                    successors: [],
                    submitter: accounts[0]
                },
            ];
            await submitBlockHeaders(expectedBlocks, accounts[0]);

        });
    
        beforeEach(async () => {
            const block = await mainWeb3.eth.getBlock('latest');
            const next_gas_price = Math.ceil(block.baseFeePerGas);
            account = identity.getAccount();
            contractAddress = await identity.initRegistry(DIDRegistry.abi, DIDRegistry.bytecode);
            // console.log(contractAddress);

            Verifier = await ccIdentityContract.new(contractAddress, ethrelay.address, {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });
            // console.log(Verifier.address)
        });

        it('successfully declare an identity in the DIDRegistry', async () => {
            
            // attach identity to the smart contract through changeOwner
            let txHash = await identity.setContractOwner(Verifier.address);

            let obj = ["Secp256k1VerificationKey2018", account.address];
            let r = identity.createAlias("website2", "http://example.com", obj)
            let b32 = r[0];
            let bvalue = r[1]

            let ret = await Verifier.declareIdentity(accounts[0], b32, bvalue, 100, asciiToHex(`${1337}`), {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            })

            // ret = await localWeb3.eth.getTransactionReceipt(ret.tx);

            expectEvent.inLogs(ret.logs, 'IdentityDeclared');

            await disconnectIdentity(ret, Verifier);
        });

        it('successfully verify an identity in the DIDRegistry', async () => {
            
            // attach identity to the smart contract through changeOwner
            let txHash = await identity.setContractOwner(Verifier.address);

            let obj = ["Secp256k1VerificationKey2018", account.address];
            let r = identity.createAlias("website2", "http://example.com", obj)
            let b32 = r[0];
            let bvalue = r[1]

            let ret = await Verifier.declareIdentity(accounts[0], b32, bvalue, 100, asciiToHex(`${1337}`), {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            })

            expectEvent.inLogs(ret.logs, 'IdentityDeclared');
            let blockHash = bufferToHex(keccak256(createRLPHeader(await localWeb3.eth.getBlock(ret.receipt.blockNumber))));
            let signature = localWeb3.eth.accounts.sign(blockHash, secretKey);

            ret = await Verifier.verifySignature(accounts[0], asciiToHex(`${1337}`), 
                signature.v,
                signature.r,
                signature.s, {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });

            expectEvent.inLogs(ret.logs, 'VerifiedSignature');

            await disconnectIdentity(ret, Verifier);
        });

        it('not verifying an identity in the DIDRegistry: type is not correct', async () => {
            
            // attach identity to the smart contract through changeOwner
            let txHash = await identity.setContractOwner(Verifier.address);

            let obj = ["Secp256k1VerificationKey", account.address];
            let r = identity.createAlias("website2", "http://example.com", obj)
            let b32 = r[0];
            let bvalue = r[1]

            let ret = await Verifier.declareIdentity(accounts[0], b32, bvalue, 100, asciiToHex(`${1337}`), {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });

            expectEvent.inLogs(ret.logs, 'IdentityDeclared');
            let blockHash = (await localWeb3.eth.getBlock(ret.receipt.blockNumber)).hash;
            let signature = localWeb3.eth.accounts.sign(blockHash, secretKey);

            await expectRevert.unspecified(Verifier.verifySignature(accounts[0], asciiToHex(`${1337}`), 
                signature.v,
                signature.r,
                signature.s, {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            }));

            await disconnectIdentity(ret, Verifier);
        });

        it('successfully transfer an identity state in the DIDRegistry', async () => {
            
            // attach identity to the smart contract through changeOwner
            let txHash = await identity.setContractOwner(Verifier.address);

            let obj = ["Secp256k1VerificationKey2018", account.address];
            let r = identity.createAlias("website2", "http://example.com", obj)
            let b32 = r[0];
            let bvalue = r[1];

            let ret = await Verifier.declareIdentity(accounts[0], b32, bvalue, 100, asciiToHex(`${1337}`), {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            })

            expectEvent.inLogs(ret.logs, 'IdentityDeclared');
            let blockHash = bufferToHex(keccak256(createRLPHeader(await localWeb3.eth.getBlock(ret.receipt.blockNumber))));
            let signature = localWeb3.eth.accounts.sign(blockHash, secretKey);

            ret = await Verifier.verifySignature(accounts[0], asciiToHex(`${1337}`), 
                signature.v,
                signature.r,
                signature.s, {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });

            expectEvent.inLogs(ret.logs, 'VerifiedSignature');

            let proof = await getAccountProof(mainWeb3, accounts[0], GENESIS_BLOCK + 1);
            let value = await getAccountState(mainWeb3, accounts[0], GENESIS_BLOCK + 1);
            let PatriciaTrie = {rlpEncodedState: mainWeb3.utils.toHex(value), rlpEncodedNodes: proof}
            let fee = await ethrelay.getRequiredVerificationFee();
            
            ret = await Verifier.transferState(accounts[0], asciiToHex(`${1337}`), 
                fee,
                blockRlp,
                3, // todo problem with confirmation blocks
                PatriciaTrie,
                {
                from: accounts[0],
                value: fee,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });

            expectEvent.inLogs(ret.logs, 'StateTransferred');

            await disconnectIdentity(ret, Verifier);

        });

    });

    const disconnectIdentity = async (ret, Verifier) => {
        ret = await Verifier.detachIdentity(accounts[0], asciiToHex(`${1337}`),
            {
                from: accounts[0],
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

    const submitBlockHeaders = async (expectedHeaders, accountAddr) => {
        await asyncForEach(expectedHeaders, async expected => {
            const rlpHeader = createRLPHeader(expected.block);
            await time.increase(time.duration.seconds(15));
            await ethrelay.submitBlock(rlpHeader, {from: accountAddr, maxFeePerGas: next_gas_price, gasPrice: GAS_PRICE_IN_WEI});
            const submitTime = await time.latest();
            expected.lockedUntil = submitTime.add(LOCK_PERIOD);
        });
    };

    const asyncForEach = async (array, callback) => {
        for (let index = 0; index < array.length; index++) {
            await callback(array[index], index, array);
        }
    };
    
    
});