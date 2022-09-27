const Web3 = require("web3");
const Identity = require('../utils/identity');
const { secretKey } = require( '../secrets.json');
const {EthereumProof} = require('../EthereumProof/EthereumProof');

const {BN, expectRevert, time, balance} = require('@openzeppelin/test-helpers');
const {createRLPHeader, calculateBlockHash, addToHex, createRLPValueState, createRLPNodeEncodeState} = require('../utils/utils');
const expectEvent = require('./expectEvent');
const RLP = require('rlp');
const { GetAndVerify, GetProof, VerifyProof } = require('eth-proof');
const { Proof } = require('eth-object');
const {bytesToHex} = require("web3-utils");
const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');
const { asciiToHex } = require( "web3-utils");

const { arrToBufArr, bufArrToArr, toBuffer, bufferToInt, bufferToHex, keccak} = require('ethereumjs-util');

const identity = new Identity('http://127.0.0.1:8545', secretKey);

const { INFURA_TESTNET_ENDPOINT, INFURA_MAINNET_ENDPOINT } = require("../constant");

const ECDSAVerifier = artifacts.require('./ECDSAVerifier');
const ECDSAVerifierV2 = artifacts.require('./ccIdentityContract');
const DIDRegistry = artifacts.require('./EthereumDIDRegistry');
const {expect} = require('chai');
const { web3 } = require("@openzeppelin/test-helpers/src/setup");

const ZERO_HASH                 = '0x0000000000000000000000000000000000000000000000000000000000000000';const LOCK_PERIOD               = time.duration.minutes(5);
const ALLOWED_FUTURE_BLOCK_TIME = time.duration.seconds(15);
const MAX_GAS_LIMIT             = 2n ** 63n - 1n;
const MIN_GAS_LIMIT             = 5000;
const GAS_PRICE_IN_WEI          = new BN(0);
const EPOCH                     = 493; //427; 
const GENESIS_BLOCK             = 14804381;// 12814531;  // block of the prove - 3
expect(Math.floor(GENESIS_BLOCK / 30000), "genesis block not in epoch").to.equal(EPOCH);

const getProof = new GetProof("http://127.0.0.1:8545"); // usa infura
let certificateTxHash;

contract('VerifierContracts', async(accounts) => {

    let ethash;
    let mainWeb3;
    let localWeb3;
    let next_gas_price;
    let Verifier;
    
    // describe('Test its functionality', function() {
    //     let tx = "";
    //     let account;
        
    //     before(async () => {
    //         mainWeb3 = new Web3(INFURA_MAINNET_ENDPOINT);
    //         localWeb3 = new Web3('http://127.0.0.1:8545'); 

    //         const block = await mainWeb3.eth.getBlock('latest');
    //         next_gas_price = Math.ceil(block.baseFeePerGas);

    //     });
    
    //     beforeEach(async () => {
    //         const block = await mainWeb3.eth.getBlock('latest');
    //         const next_gas_price = Math.ceil(block.baseFeePerGas);
    //         Verifier = await ECDSAVerifier.new({
    //             from: accounts[0],
    //             maxFeePerGas: next_gas_price,
    //             // gasPrice: GAS_PRICE_IN_WEI
    //         });
    //     });

    //     it('successfully verified from getProof verification', async () => {
    //         account = identity.getAccount();
    //         await identity.initRegistry();

    //         await identity.setAlias("website1", "https://myblog.blogging-host.example/home");
    //         tx = (await identity.setAlias("website2", "http://example.com", true));
    //         certificateTxHash = tx[1].tx;
    //         console.log(certificateTxHash);
            
    //         // console.log(await mainWeb3.eth.getBlock(GENESIS_BLOCK+1))
    //         const blockNotEncoded = await localWeb3.eth.getBlock(tx[1].block);
    //         const block = createRLPHeader(blockNotEncoded);
    //         const { header, txProof, txIndex} = await getProof.transactionProof(certificateTxHash);

    //         const receiptAndMerkleProof = await getProof.receiptProof(certificateTxHash);
    //         const receiptProof = prepareReceiptProof(receiptAndMerkleProof);
            
    //         console.log(blockNotEncoded,
    //             bufferToHex(receiptAndMerkleProof.header.receiptRoot), 
    //             blockNotEncoded.receiptsRoot, 
    //             bufferToHex(header.receiptRoot), 
    //             "last",
    //             bufferToHex(VerifyProof.getRootFromProof(receiptAndMerkleProof.receiptProof)),
    //             bufferToHex(receiptAndMerkleProof.receiptProof[0]),
    //             bufferToHex(arrToBufArr(RLP.encode(receiptAndMerkleProof.receiptProof[0]))),
    //             bufferToHex(keccak(arrToBufArr(RLP.encode(receiptAndMerkleProof.receiptProof[0]))))
    //         );

    //         const receipt = await VerifyProof.getReceiptFromReceiptProofAt(receiptAndMerkleProof.receiptProof, receiptAndMerkleProof.txIndex);

    //         if (bytesToHex(receipt.postTransactionState) !== "0x01") throw new Error('Transaction rejected');

    //         const receiptRootHeader = blockNotEncoded.receiptsRoot;
    //         const receiptRootProof = VerifyProof.getRootFromProof(receiptAndMerkleProof.receiptProof);


    //         if (!receiptRootProof.equals(toBuffer(receiptRootHeader))) throw new Error('Receipt proof mismatch');


    //         let ret = await Verifier.verifySignature(block,  
    //             receiptProof.rlpEncodedReceipt,
    //             receiptProof.path,
    //             receiptProof.witness, {
    //             from: accounts[0],
    //             maxFeePerGas: next_gas_price,
    //             gasPrice: GAS_PRICE_IN_WEI
    //         });

    //         expectEvent.inLogs(ret.logs, 'VerifiedSignature');
    //     });


    //     // it('successfully verified from getProof verification', async () => {
    //     //     // console.log(await mainWeb3.eth.getBlock(GENESIS_BLOCK+1))
    //     //     let ethereumProof = new EthereumProof(localWeb3);
    //     //     const result = await ethereumProof.composeEvidence(certificateTxHash, true);
    //     //     console.log(result.txReceiptProof);
    //     // });

    //     it('successfully verified from getProof verification', async () => {
    //         // console.log(await mainWeb3.eth.getBlock(GENESIS_BLOCK+1))
    //         let ethereumProof = new EthereumProof(localWeb3);
    //         const result = await ethereumProof.composeEvidence(certificateTxHash, true);
    //         console.log(result.txReceiptProof);
    //     });
    // });

    describe('ECDSAVerifierV2', function() {
        let tx = "";
        let account;
        let Verifier;
        
        before(async () => {
            mainWeb3 = new Web3(INFURA_MAINNET_ENDPOINT);
            localWeb3 = new Web3('http://127.0.0.1:8545'); 

            const block = await mainWeb3.eth.getBlock('latest');
            next_gas_price = Math.ceil(block.baseFeePerGas);

        });
    
        beforeEach(async () => {
            const block = await mainWeb3.eth.getBlock('latest');
            const next_gas_price = Math.ceil(block.baseFeePerGas);
            account = identity.getAccount();
            contractAddress = await identity.initRegistry(DIDRegistry.abi, DIDRegistry.bytecode);
            // console.log(contractAddress);

            Verifier = await ECDSAVerifierV2.new(contractAddress, {
                from: accounts[4],
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

            let ret = await Verifier.declareIdentity(accounts[3], b32, bvalue, 100, asciiToHex(`${1337}`), {
                from: accounts[3],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            })

            // ret = await localWeb3.eth.getTransactionReceipt(ret.tx);

            expectEvent.inLogs(ret.logs, 'IdentityDeclared');

            // TODO send transaction to detach identity
        });

        it('successfully verify an identity in the DIDRegistry', async () => {
            
            // attach identity to the smart contract through changeOwner
            let txHash = await identity.setContractOwner(Verifier.address);

            let obj = ["Secp256k1VerificationKey2018", account.address];
            let r = identity.createAlias("website2", "http://example.com", obj)
            let b32 = r[0];
            let bvalue = r[1]

            let ret = await Verifier.declareIdentity(accounts[3], b32, bvalue, 100, asciiToHex(`${1337}`), {
                from: accounts[3],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            })

            expectEvent.inLogs(ret.logs, 'IdentityDeclared');
            let blockHash = (await localWeb3.eth.getBlock(ret.receipt.blockNumber)).hash;
            let signature = localWeb3.eth.accounts.sign(blockHash, secretKey);

            ret = await Verifier.verifySignature(accounts[3], asciiToHex(`${1337}`), 
                signature.v,
                signature.r,
                signature.s, {
                from: accounts[3],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });

            expectEvent.inLogs(ret.logs, 'VerifiedSignature');

            // TODO send transaction to detach identity
        });

        it('successfully verify an identity in the DIDRegistry', async () => {
            
            // attach identity to the smart contract through changeOwner
            let txHash = await identity.setContractOwner(Verifier.address);

            let obj = ["Secp256k1VerificationKey", account.address];
            let r = identity.createAlias("website2", "http://example.com", obj)
            let b32 = r[0];
            let bvalue = r[1]

            let ret = await Verifier.declareIdentity(accounts[3], b32, bvalue, 100, asciiToHex(`${1337}`), {
                from: accounts[3],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            })

            expectEvent.inLogs(ret.logs, 'IdentityDeclared');
            let blockHash = (await localWeb3.eth.getBlock(ret.receipt.blockNumber)).hash;
            let signature = localWeb3.eth.accounts.sign(blockHash, secretKey);

            await expectRevert.unspecified(Verifier.verifySignature(accounts[3], asciiToHex(`${1337}`), 
                signature.v,
                signature.r,
                signature.s, {
                from: accounts[3],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            }));

            // TODO send transaction to detach identity
        });

    });

    

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
    
    
});