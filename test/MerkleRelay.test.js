const Web3 = require("web3");
const {BN, expectRevert, time, balance} = require('@openzeppelin/test-helpers');
const {createRLPHeader, calculateBlockHash, addToHex, createRLPValueState, createRLPNodeEncodeState} = require('../utils/utils');
const expectEvent = require('./expectEvent');
const RLP = require('rlp');
const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');


const { INFURA_TESTNET_ENDPOINT, INFURA_MAINNET_ENDPOINT } = require("../constant");

const MerkleRelay = artifacts.require('./MerkleRelayTestContract');
const MerkleTreeTest = artifacts.require('./MerkleTreeTest');
const EthashOwner = artifacts.require('./EthashOwner');
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


const EPOCHFILE = "./pow/epoch.json";
const DATAPOWFILE = "./pow/genesisPlus2.json";


contract('MerkleRelay', async(accounts) => {

    let merklerelay;
    let ethash;
    let mainWeb3;
    let sourceWeb3;
    let next_gas_price;
    

    describe('MerkleRelay: MerkleTree functions', function() {
        before(async () => {
            mainWeb3 = new Web3(INFURA_MAINNET_ENDPOINT);
            const block = await mainWeb3.eth.getBlock('latest');
            next_gas_price = Math.ceil(block.baseFeePerGas);
    
        });
    
        beforeEach(async () => {
            const block = await mainWeb3.eth.getBlock('latest');
            const next_gas_price = Math.ceil(block.baseFeePerGas);
            merklerelay = await MerkleTreeTest.new({
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });
        });
    
        it("it should successefully update the tree with an EVEN array of blocks", async () => {
            let elements = [];

            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+1)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+2)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+3)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+4)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+5)));

            const proofLeaves = elements.map(keccak256);
            const merkleTree = new MerkleTree(proofLeaves, keccak256);
            const root = merkleTree.getRoot();

            let ret = await merklerelay.updateTree(elements.map(Buffer.from), {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gas:3000000,
                gasPrice: GAS_PRICE_IN_WEI
            });

            console.log("Gas used for updating the tree:", ret.receipt.gasUsed);

            ret = await merklerelay.getRoot();
            expect(ret).to.be.equal('0x'+root.toString('hex'));
        });

        it("it should successefully update the tree with an ODD array of blocks", async () => {
            let elements = [];

            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+1)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+2)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+3)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+4)));

            const proofLeaves = elements.map(keccak256);
            const merkleTree = new MerkleTree(proofLeaves, keccak256);
            const root = merkleTree.getRoot();

            let ret = await merklerelay.updateTree(elements.map(Buffer.from), {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gas:3000000,
                gasPrice: GAS_PRICE_IN_WEI
            });
            console.log("Gas used for updating the tree:", ret.receipt.gasUsed);

            ret = await merklerelay.getRoot();
            expect(ret).to.be.equal('0x'+root.toString('hex'));
        });

        it("it should successefully verify that a leaf belongs to the tree", async () => {
            let elements = [];

            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+1)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+2)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+3)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+4)));

            const proofLeaves = elements.map(keccak256);
            const merkleTree = new MerkleTree(proofLeaves, keccak256);
            const root = merkleTree.getRoot();

            let ret = await merklerelay.updateTree(elements.map(Buffer.from), {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gas:3000000,
                gasPrice: GAS_PRICE_IN_WEI
            });

            ret = await merklerelay.getRoot();
            expect(ret).to.be.equal('0x'+root.toString('hex'));

            let proof = merkleTree.getProof(proofLeaves[1]);
            let proofSC = proof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let position_array = proofSC.map((el,i)=> {return el.position});
            let data_array = proofSC.map((el, i) => {return el.data});

            ret = await merklerelay.verifyBlock(data_array, position_array, elements[1], root, {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gas:3000000,
                gasPrice: GAS_PRICE_IN_WEI
            });
            
            expect(ret).to.be.equal(true);

        });

        it("it should NOT successefully verify that a leaf belongs to the tree", async () => {
            let elements = [];

            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+1)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+2)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+3)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+4)));

            const proofLeaves = elements.map(keccak256);
            const merkleTree = new MerkleTree(proofLeaves, keccak256);
            const root = merkleTree.getRoot();

            let ret = await merklerelay.updateTree(elements.map(Buffer.from), {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gas:3000000,
                gasPrice: GAS_PRICE_IN_WEI
            });

            ret = await merklerelay.getRoot();
            expect(ret).to.be.equal('0x'+root.toString('hex'));

            let proof = merkleTree.getProof(proofLeaves[1]);
            let proofSC = proof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let position_array = proofSC.map((el,i)=> {return el.position});
            let data_array = proofSC.map((el, i) => {return el.data});

            ret = await merklerelay.verifyBlock(data_array, position_array, elements[0], root, {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gas:3000000,
                gasPrice: GAS_PRICE_IN_WEI
            });

            expect(ret).to.be.equal(false);

        });

        it("it should revert because data passed for verification are incorrect", async () => {
            let elements = [];

            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+1)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+2)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+3)));
            elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+4)));

            const proofLeaves = elements.map(keccak256);
            const merkleTree = new MerkleTree(proofLeaves, keccak256);
            const root = merkleTree.getRoot();

            let ret = await merklerelay.updateTree(elements.map(Buffer.from), {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gas:3000000,
                gasPrice: GAS_PRICE_IN_WEI
            });

            ret = await merklerelay.getRoot();
            expect(ret).to.be.equal('0x'+root.toString('hex'));

            let proof = merkleTree.getProof(proofLeaves[1]);
            let proofSC = proof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let position_array = proofSC.map((el,i)=> {return el.position});
            let data_array = proofSC.map((el, i) => {return el.data});

            await expectRevert(merklerelay.verifyBlock(data_array, position_array.slice(0,position_array.length-1), elements[1], root, {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gas:3000000,
                gasPrice: GAS_PRICE_IN_WEI
            }), "proof and position have different length");

        });
    });

    describe('Merklerelay: DepositStake', function () {
        before(async () => {
            mainWeb3 = new Web3(INFURA_MAINNET_ENDPOINT);
            ethash = await EthashOwner.new();
            const block = await mainWeb3.eth.getBlock('latest');
            next_gas_price = Math.ceil(block.baseFeePerGas);
            // const epochData = require(EPOCHFILE);
    
            // console.log(`Submitting data for epoch ${EPOCH} to Ethash contract...`);
            // await submitEpochData(ethash, EPOCH, epochData.FullSizeIn128Resolution, epochData.BranchDepth, epochData.MerkleNodes);
            // console.log("Submitted epoch data.");
    
        });
    
        beforeEach(async () => {
            const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
            const genesisRlpHeader = createRLPHeader(genesisBlock);
    
            merklerelay = await MerkleRelay.new(genesisRlpHeader, genesisBlock.totalDifficulty, ethash.address, {
                from: accounts[0],
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,
            });
        });

        // Test Scenario 1:
        it("should throw error: transfer amount not equal to function parameter", async () => {
            const stake = new BN(1);
            await expectRevert(
                merklerelay.depositStake(stake, {
                    from: accounts[0],
                    value: stake.add(new BN(1)),
                    gasPrice: GAS_PRICE_IN_WEI,
                    maxFeePerGas: next_gas_price,

                }),
                "transfer amount not equal to function parameter");
        });

        // Test Scenario 2:
        it("should correctly add the provided stake to the client's balance", async () => {
            const stake = new BN(15);
            const balanceBeforeCall = await merklerelay.getStake({from: accounts[0]});

            await merklerelay.depositStake(stake, {from: accounts[0], value: stake, maxFeePerGas: next_gas_price});
            const balanceAfterCall = await merklerelay.getStake({from: accounts[0]});

            expect(balanceAfterCall).to.be.bignumber.equal(balanceBeforeCall.add(stake));

            await merklerelay.withdrawStake(stake, {from: accounts[0], maxFeePerGas: next_gas_price});
            const balanceAfterCallBis = await merklerelay.getStake({from: accounts[0]});

            expect(balanceAfterCallBis).to.be.bignumber.equal(balanceBeforeCall);
            
            });

        });

        describe('MerkleRelay: MerkleTree submission', function() {
            before(async () => {
                mainWeb3 = new Web3(INFURA_MAINNET_ENDPOINT);
                ethash = await EthashOwner.new();
                const epochData = require(EPOCHFILE);
                const block = await mainWeb3.eth.getBlock('latest');
                next_gas_price = Math.ceil(block.baseFeePerGas);
        
                console.log(`Submitting data for epoch ${EPOCH} to Ethash contract...`);
                await submitEpochData(ethash, EPOCH, epochData.FullSizeIn128Resolution, epochData.BranchDepth, epochData.MerkleNodes);
                console.log("Submitted epoch data.");
        
            });
        
            beforeEach(async () => {
                const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
                const genesisRlpHeader = createRLPHeader(genesisBlock);
        
                merklerelay = await MerkleRelay.new(genesisRlpHeader, genesisBlock.totalDifficulty, ethash.address, {
                    from: accounts[0],
                    gasPrice: GAS_PRICE_IN_WEI,
                    maxFeePerGas: next_gas_price
                });
            });
        
            it("it should correctly submit the new root of 4 elements", async () => {
                const stake = await merklerelay.getRequiredStakePerRoot();
                await merklerelay.depositStake(stake, {
                    from: accounts[0],
                    value: stake,
                    gasPrice: GAS_PRICE_IN_WEI,
                    maxFeePerGas: next_gas_price
                });

                let elements = [];
                let genesisBlock = (await mainWeb3.eth.getBlock(GENESIS_BLOCK));

                elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+1)));
                elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+2)));
                elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+3)));
                elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+4)));

                const proofLeaves = elements.map(keccak256);
                const merkleTree = new MerkleTree(proofLeaves, keccak256);
                const root = merkleTree.getHexRoot();

                let ret = await merklerelay.submitRoot(elements.map(Buffer.from), genesisBlock.hash, {
                    from: accounts[0],
                    gas:3000000,
                    gasPrice: GAS_PRICE_IN_WEI,
                    maxFeePerGas: next_gas_price
                });
                
                expectEvent.inLogs(ret.logs, 'NewRoot', {root: root});
                await merklerelay.withdrawStake(stake, {from: accounts[0], maxFeePerGas: next_gas_price});

            });

            it("it should correctly submit the new root of MANY elements", async () => {
                const stake = await merklerelay.getRequiredStakePerRoot();
                await merklerelay.depositStake(stake, {
                    from: accounts[0],
                    value: stake,
                    gasPrice: GAS_PRICE_IN_WEI,
                    maxFeePerGas: next_gas_price
                });
                let elements = [];
                let genesisBlock = (await mainWeb3.eth.getBlock(GENESIS_BLOCK));

                for (let i = 1; i <= 64; i++) 
                    elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+i)));
                
                const proofLeaves = elements.map(keccak256);
                const merkleTree = new MerkleTree(proofLeaves, keccak256);
                const root = merkleTree.getHexRoot();

                let ret = await merklerelay.submitRoot(elements.map(Buffer.from), genesisBlock.hash, {
                    from: accounts[0],
                    gas: 8000000,
                    gasPrice: GAS_PRICE_IN_WEI,
                    maxFeePerGas: next_gas_price
                });
                
                expectEvent.inLogs(ret.logs, 'NewRoot', {root: root});
                console.log("Gas used for updating the tree:", ret.receipt.gasUsed);
                await merklerelay.withdrawStake(stake, {from: accounts[0], maxFeePerGas: next_gas_price});
                
            });

            // Test Scenario 3:
            //
            // (0)---(1)---(2)---(3)
            //
            it("it should correctly submit test scenario 3", async () => {
                const requiredStakePerRoot = await merklerelay.getRequiredStakePerRoot();
                const stake = requiredStakePerRoot.mul(new BN(3));
                await merklerelay.depositStake(stake, {
                    from: accounts[0],
                    value: stake,
                    gasPrice: GAS_PRICE_IN_WEI,
                    maxFeePerGas: next_gas_price
                });

                let genesisBlock = (await mainWeb3.eth.getBlock(GENESIS_BLOCK));
                let parentHash = genesisBlock.hash;
                let elements = [];
                let expectedRoots = [];

                for (let root_index = 0; root_index < 3; root_index++){
                    elements = [];
                

                    for (let i = 1; i <= 16; i++) 
                        elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+i+root_index*16)));
                    
                    const proofLeaves = elements.map(keccak256);
                    const merkleTree = new MerkleTree(proofLeaves, keccak256);
                    const root = merkleTree.getHexRoot();

                    let ret = await merklerelay.submitRoot(elements.map(Buffer.from), parentHash, {
                        from: accounts[0],
                        gas: 3000000,
                        gasPrice: GAS_PRICE_IN_WEI,
                        maxFeePerGas: next_gas_price
                    });
                    
                    expectEvent.inLogs(ret.logs, 'NewRoot', {root: root});
                    console.log("Gas used for updating the tree:", ret.receipt.gasUsed);

                    parentHash = root;

                    // create an array of expectedRoots
                    const submitTime = await time.latest();
                    if (root_index > 0) expectedRoots[root_index-1].successors.push(parentHash);
                    expectedRoots.push(
                        {
                            hash: root,
                            lastHash: '0x'+keccak256(elements[elements.length-1]).toString('hex'),
                            number: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length+root_index*16)).number,
                            totalDifficulty: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length+root_index*16)).totalDifficulty,
                            lengthUpdate: elements.length,
                            forkId: 0,
                            iterableIndex: 0,
                            latestFork: ZERO_HASH,
                            lockedUntil: submitTime.add(LOCK_PERIOD),
                            submitter: accounts[0],
                            successors: []
                        }
                    )
                }
                
                await withdrawStake(stake, accounts[0]);

                await checkExpectedRoots(expectedRoots);
                await checkExpectedEndpoints([expectedRoots[expectedRoots.length-1]]);
                
            });

            // Test Scenario 4:
            //
            //      -(1)
            //    /
            // (0)
            //    \
            //      -(2)
            //
            it("it should correctly submit test scenario 4", async () => {
                const requiredStakePerRoot = await merklerelay.getRequiredStakePerRoot();
                const stake = requiredStakePerRoot.mul(new BN(2));
                let expectedRoots = [];
                await merklerelay.depositStake(stake, {
                    from: accounts[0],
                    value: stake,
                    gasPrice: GAS_PRICE_IN_WEI,
                    maxFeePerGas: next_gas_price
                });

                let genesisBlock = (await mainWeb3.eth.getBlock(GENESIS_BLOCK));
                let parentHash = genesisBlock.hash;
                let elements = [];

                // Add (1)
                for (let i = 1; i <= 16; i++) 
                    elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+i)));
                    
                const proofLeaves = elements.map(keccak256);
                const merkleTree = new MerkleTree(proofLeaves, keccak256);
                const root = merkleTree.getHexRoot();

                let ret = await merklerelay.submitRoot(elements.map(Buffer.from), parentHash, {
                    from: accounts[0],
                    gas: 3000000,
                    gasPrice: GAS_PRICE_IN_WEI,
                    maxFeePerGas: next_gas_price
                });
                
                expectEvent.inLogs(ret.logs, 'NewRoot', {root: root});
                console.log("Gas used for updating the tree:", ret.receipt.gasUsed);
                let submitTime = await time.latest();
                expectedRoots.push(
                    {
                        hash: root,
                        lastHash: '0x'+keccak256(elements[elements.length-1]).toString('hex'),
                        number: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).number,
                        totalDifficulty: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).totalDifficulty,
                        lengthUpdate: elements.length,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: parentHash, //also the latestFork of the previous node must be set to parentHash
                        lockedUntil: submitTime.add(LOCK_PERIOD),
                        submitter: accounts[0],
                        successors: []
                    }
                );

                // Add (2)
                let block1 = await mainWeb3.eth.getBlock(GENESIS_BLOCK+1);
                let block16 = await mainWeb3.eth.getBlock(GENESIS_BLOCK+16);
                block16.transactionsRoot = block1.receiptsRoot;
                block16.stateRoot = block1.transactionsRoot;
                block16.receiptsRoot = block1.stateRoot;
                block16.hash = calculateBlockHash(block16);
                elements[15] = createRLPHeader(block16);
                
                const proofLeavesBis = elements.map(keccak256);
                const merkleTreeBis = new MerkleTree(proofLeavesBis, keccak256);
                const rootBis = merkleTreeBis.getHexRoot();

                ret = await merklerelay.submitRoot(elements.map(Buffer.from), parentHash, {
                    from: accounts[0],
                    gas: 3000000,
                    gasPrice: GAS_PRICE_IN_WEI,
                    maxFeePerGas: next_gas_price
                });

                expectEvent.inLogs(ret.logs, 'NewRoot', {root: rootBis});
                console.log("Gas used for updating the tree:", ret.receipt.gasUsed);

                submitTime = await time.latest();
                expectedRoots.push(
                    {
                        hash: rootBis,
                        lastHash: '0x'+keccak256(elements[15]).toString('hex'),
                        number: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).number,
                        totalDifficulty: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).totalDifficulty,
                        lengthUpdate: elements.length,
                        forkId: 1,
                        iterableIndex: 1,
                        latestFork: parentHash,
                        lockedUntil: submitTime.add(LOCK_PERIOD),
                        submitter: accounts[0],
                        successors: []
                    }
                );
                
                await checkExpectedRoots(expectedRoots);
                await checkExpectedEndpoints(expectedRoots);

                await withdrawStake(stake, accounts[0]);
            });

            // Test Scenario 5:
            //
            //      -(1)---(2)
            //    /
            // (0)
            //    \
            //      -(3)
            //
            it("it should correctly submit test scenario 5", async () => {
                const requiredStakePerRoot = await merklerelay.getRequiredStakePerRoot();
                const stake = requiredStakePerRoot.mul(new BN(3));
                await merklerelay.depositStake(stake, {
                    from: accounts[0],
                    value: stake,
                    gasPrice: GAS_PRICE_IN_WEI,
                    maxFeePerGas: next_gas_price
                });

                let genesisBlock = (await mainWeb3.eth.getBlock(GENESIS_BLOCK));
                let parentHash = genesisBlock.hash;
                let elements = [];
                let expectedRoots = [];

                // Add (1)
                for (let i = 1; i <= 16; i++) 
                    elements.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+i)));
                    
                const proofLeaves = elements.map(keccak256);
                const merkleTree = new MerkleTree(proofLeaves, keccak256);
                const root = merkleTree.getHexRoot();

                let ret = await merklerelay.submitRoot(elements.map(Buffer.from), parentHash, {
                    from: accounts[0],
                    gas: 3000000,
                    gasPrice: GAS_PRICE_IN_WEI,
                    maxFeePerGas: next_gas_price
                });
                
                expectEvent.inLogs(ret.logs, 'NewRoot', {root: root});
                console.log("Gas used for updating the tree:", ret.receipt.gasUsed);
                
                let submitTime = await time.latest();
                expectedRoots.push(
                    {
                        hash: root,
                        lastHash: '0x'+keccak256(elements[elements.length-1]).toString('hex'),
                        number: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).number,
                        totalDifficulty: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).totalDifficulty,
                        lengthUpdate: elements.length,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: parentHash,
                        lockedUntil: submitTime.add(LOCK_PERIOD),
                        submitter: accounts[0],
                        successors: []
                    }
                );
                parentHash = root;

                // Add (2)
                let elementsBis = [];
                for (let i = 1; i <= 16; i++) 
                    elementsBis.push(createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK+i+16)));
                    
                const proofLeavesBis = elementsBis.map(keccak256);
                const merkleTreeBis = new MerkleTree(proofLeavesBis, keccak256);
                const rootBis = merkleTreeBis.getHexRoot();

                ret = await merklerelay.submitRoot(elementsBis.map(Buffer.from), parentHash, {
                    from: accounts[0],
                    gas: 3000000,
                    gasPrice: GAS_PRICE_IN_WEI,
                    maxFeePerGas: next_gas_price
                });
                
                expectEvent.inLogs(ret.logs, 'NewRoot', {root: rootBis});
                console.log("Gas used for updating the tree:", ret.receipt.gasUsed);

                submitTime = await time.latest();
                expectedRoots[0].successors.push(rootBis);
                expectedRoots.push(
                    {
                        hash: rootBis,
                        lastHash: '0x'+keccak256(elementsBis[elementsBis.length-1]).toString('hex'),
                        number: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elementsBis.length+elements.length)).number,
                        totalDifficulty: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elementsBis.length+elements.length)).totalDifficulty,
                        lengthUpdate: elementsBis.length,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: genesisBlock.hash, //also the latestFork of the previous node must be set to parentHash
                        lockedUntil: submitTime.add(LOCK_PERIOD),
                        submitter: accounts[0],
                        successors: []
                    }
                );

                // Add (3)
                parentHash = genesisBlock.hash;

                let block1 = await mainWeb3.eth.getBlock(GENESIS_BLOCK+1);
                let block16 = await mainWeb3.eth.getBlock(GENESIS_BLOCK+16);
                block16.transactionsRoot = block1.receiptsRoot;
                block16.stateRoot = block1.transactionsRoot;
                block16.receiptsRoot = block1.stateRoot;
                block16.hash = calculateBlockHash(block16);
                elements[15] = createRLPHeader(block16);
                
                const proofLeavesTris = elements.map(keccak256);
                const merkleTreeTris = new MerkleTree(proofLeavesTris, keccak256);
                const rootTris = merkleTreeTris.getHexRoot();

                ret = await merklerelay.submitRoot(elements.map(Buffer.from), parentHash, {
                    from: accounts[0],
                    gas: 3000000,
                    gasPrice: GAS_PRICE_IN_WEI,
                    maxFeePerGas: next_gas_price
                });
                
                expectEvent.inLogs(ret.logs, 'NewRoot', {root: rootTris});
                console.log("Gas used for updating the tree:", ret.receipt.gasUsed);

                submitTime = await time.latest();
                expectedRoots.push(
                    {
                        hash: rootTris,
                        lastHash: '0x'+keccak256(elements[15]).toString('hex'),
                        number: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).number,
                        totalDifficulty: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).totalDifficulty,
                        lengthUpdate: elements.length,
                        forkId: 1,
                        iterableIndex: 1,
                        latestFork: parentHash,
                        lockedUntil: submitTime.add(LOCK_PERIOD),
                        submitter: accounts[0],
                        successors: []
                    }
                );

                await checkExpectedRoots(expectedRoots);
                await checkExpectedEndpoints([expectedRoots[1], expectedRoots[2]]);
                
                await withdrawStake(stake, accounts[0]);
            });

        });
    
    describe('MerkleRelay: MerkleTree dispute', function() {
        let genesisTime;
        before(async () => {
            mainWeb3 = new Web3(INFURA_MAINNET_ENDPOINT);
            ethash = await EthashOwner.new();
            const epochData = require(EPOCHFILE);
    
            console.log(`Submitting data for epoch ${EPOCH} to Ethash contract...`);
            await submitEpochData(ethash, EPOCH, epochData.FullSizeIn128Resolution, epochData.BranchDepth, epochData.MerkleNodes);
            console.log("Submitted epoch data.");
    
        });
    
        beforeEach(async () => {
            const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
            const genesisRlpHeader = createRLPHeader(genesisBlock);
            merklerelay = await MerkleRelay.new(genesisRlpHeader, genesisBlock.totalDifficulty, ethash.address, {
                from: accounts[0],
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });
            genesisTime = await time.latest();

        });

        // Test Scenario 1 (verification of Ethash should fail):
        //
        // (0)-X-(1)
        //
        //
        it('should correctly execute test scenario 1', async () => {
            const requiredStakePerBlock = await merklerelay.getRequiredStakePerRoot();
            const stakeAccount0 = requiredStakePerBlock.mul(new BN(2));
            const stakeAccount1 = requiredStakePerBlock.mul(new BN(2));
            await merklerelay.depositStake(stakeAccount0, {
                from: accounts[0],
                value: stakeAccount0,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });  // submits block 1

            await merklerelay.depositStake(stakeAccount1, {
                from: accounts[1],
                value: stakeAccount1,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });  // submits blocks 2,3

            let genesisBlock = (await mainWeb3.eth.getBlock(GENESIS_BLOCK));
            let parentHash = genesisBlock.hash;

            // Create expected chain
            const block1 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 4);

            // change nonce such that the PoW validation results in false (prune Branch)
            block2.nonce = addToHex(block2.nonce, 1);
            block2.hash = calculateBlockHash(block2);
            block3.parentHash = block2.hash;
            block3.hash = calculateBlockHash(block3);
            block4.parentHash = block3.hash;
            block4.hash = calculateBlockHash(block4);

            let elements = [];
            let expectedRoots = [];

            // Add (1)
            elements.push(createRLPHeader(block1));
            elements.push(createRLPHeader(block2));
            elements.push(createRLPHeader(block3));
            elements.push(createRLPHeader(block4));

                
            const proofLeaves = elements.map(keccak256);
            const merkleTree = new MerkleTree(proofLeaves, keccak256);
            const root = merkleTree.getHexRoot();

            ret = await merklerelay.submitRoot(elements.map(Buffer.from), parentHash, {
                from: accounts[0],
                gas: 3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });
            
            expectEvent.inLogs(ret.logs, 'NewRoot', {root: root});

            const {
                "DatasetLookUp":    dataSetLookupBlock2,
                "WitnessForLookup": witnessForLookupBlock2,
            } = require("./pow/genesisPlus2.json");

            const powMetadata = {dataSetLookup: dataSetLookupBlock2, witnessForLookup: witnessForLookupBlock2};

            let proof = merkleTree.getProof(proofLeaves[1]);
            let proofSC = proof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let position_array = proofSC.map((el,i)=> {return el.position});
            let data_array = proofSC.map((el, i) => {return el.data});

            const blockProof = {proof: data_array, position: position_array};

            let parentProof = merkleTree.getProof(proofLeaves[0]);
            let parentProofSC = parentProof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let parent_position_array = parentProofSC.map((el,i)=> {return el.position});
            let parent_data_array = parentProofSC.map((el, i) => {return el.data});

            const blockParentProof = {proof: parent_data_array, position: parent_position_array};

            ret = await merklerelay.disputeBlockHeader(createRLPHeader(block2), blockProof, 
                    createRLPHeader(block1), blockParentProof, root, root, powMetadata, {
                from: accounts[1],
                gas: 3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });
            expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(2)});
            
            expectedRoots.push(
                {
                    hash: parentHash,
                    lastHash: parentHash,
                    number: (await mainWeb3.eth.getBlock(GENESIS_BLOCK)).number,
                    totalDifficulty: (await mainWeb3.eth.getBlock(GENESIS_BLOCK)).totalDifficulty,
                    lengthUpdate: 1,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: "0x0000000000000000000000000000000000000000000000000000000000000000", // the latestFork should be all 0 because it is genesis
                    lockedUntil: genesisTime, // no add because it is the genesis
                    submitter: accounts[0],
                    successors: []
                }
            );

            // Check
            await checkExpectedEndpoints(expectedRoots);
            await checkExpectedRoots(expectedRoots);

            // withdraw stake
            await withdrawStake(requiredStakePerBlock.mul(new BN(1)), accounts[0]);
            await withdrawStake(requiredStakePerBlock.mul(new BN(3)), accounts[1]);
        });

        // Test Scenario 2 (verification of Ethash should fail between the parent belonging to 1):
        //
        // (0)---(1)-X-(2)
        //
        //
        it('should correctly execute test scenario 2', async () => {
            const requiredStakePerBlock = await merklerelay.getRequiredStakePerRoot();
            const stakeAccount0 = requiredStakePerBlock.mul(new BN(2));
            const stakeAccount1 = requiredStakePerBlock.mul(new BN(2));
            await merklerelay.depositStake(stakeAccount0, {
                from: accounts[0],
                value: stakeAccount0,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });  // submits block 1

            await merklerelay.depositStake(stakeAccount1, {
                from: accounts[1],
                value: stakeAccount1,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });  // submits blocks 2,3

            let genesisBlock = (await mainWeb3.eth.getBlock(GENESIS_BLOCK));
            let parentHash = genesisBlock.hash;

            // Create expected chain
            const block1 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            
            const block5 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const block6 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 6);
            const block7 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 7);
            const block8 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 8);

            // change nonce such that the PoW validation results in false (prune Branch)
            block5.nonce = addToHex(block5.nonce, 1);
            block5.hash = calculateBlockHash(block5);
            block6.parentHash = block5.hash;
            block6.hash = calculateBlockHash(block6);
            block7.parentHash = block6.hash;
            block7.hash = calculateBlockHash(block7);
            block8.parentHash = block7.hash;
            block8.hash = calculateBlockHash(block8);

            let elements = [];
            let expectedRoots = [];

            // Add (1)
            elements.push(createRLPHeader(block1));
            elements.push(createRLPHeader(block2));
            elements.push(createRLPHeader(block3));
            elements.push(createRLPHeader(block4));

                
            const proofLeaves = elements.map(keccak256);
            const merkleTree = new MerkleTree(proofLeaves, keccak256);
            const root = merkleTree.getHexRoot();

            ret = await merklerelay.submitRoot(elements.map(Buffer.from), parentHash, {
                from: accounts[0],
                gas: 8000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });
            
            expectEvent.inLogs(ret.logs, 'NewRoot', {root: root});
            parentHash = root;
            submitTime = await time.latest();

            // Add (2)
            let elementsBis = [];
            elementsBis.push(createRLPHeader(block5));
            elementsBis.push(createRLPHeader(block6));
            elementsBis.push(createRLPHeader(block7));
            elementsBis.push(createRLPHeader(block8));

                
            const proofLeavesBis = elementsBis.map(keccak256);
            const merkleTreeBis = new MerkleTree(proofLeavesBis, keccak256);
            const rootBis = merkleTreeBis.getHexRoot();

            ret = await merklerelay.submitRoot(elementsBis.map(Buffer.from), parentHash, {
                from: accounts[0],
                gas: 3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });
            
            expectEvent.inLogs(ret.logs, 'NewRoot', {root: rootBis});

            const {
                "DatasetLookUp":    dataSetLookupBlock2,
                "WitnessForLookup": witnessForLookupBlock2,
            } = require("./pow/genesisPlus88.json");

            const powMetadata = {dataSetLookup: dataSetLookupBlock2, witnessForLookup: witnessForLookupBlock2};

            let proof = merkleTreeBis.getProof(proofLeavesBis[0]);
            let proofSC = proof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let position_array = proofSC.map((el,i)=> {return el.position});
            let data_array = proofSC.map((el, i) => {return el.data});

            const blockProof = {proof: data_array, position: position_array};

            let parentProof = merkleTree.getProof(proofLeaves[3]);
            let parentProofSC = parentProof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let parent_position_array = parentProofSC.map((el,i)=> {return el.position});
            let parent_data_array = parentProofSC.map((el, i) => {return el.data});

            const blockParentProof = {proof: parent_data_array, position: parent_position_array};

            ret = await merklerelay.disputeBlockHeader(createRLPHeader(block5), blockProof, 
                    createRLPHeader(block4), blockParentProof, rootBis, root, powMetadata, {
                from: accounts[1],
                gas: 3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });

            expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(2)});
            
            expectedRoots.push(
                {
                    hash: root,
                    lastHash: '0x'+keccak256(elements[elements.length-1]).toString('hex'),
                    number: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).number,
                    totalDifficulty: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).totalDifficulty,
                    lengthUpdate: elements.length,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: "0x0000000000000000000000000000000000000000000000000000000000000000", 
                    lockedUntil: submitTime.add(LOCK_PERIOD),
                    submitter: accounts[0],
                    successors: []
                }
            );

            // Check
            await checkExpectedEndpoints(expectedRoots);
            await checkExpectedRoots(expectedRoots);

            // withdraw stake
            await withdrawStake(requiredStakePerBlock.mul(new BN(1)), accounts[0]);
            await withdrawStake(requiredStakePerBlock.mul(new BN(3)), accounts[1]);
        });

        // Test Scenario 3 (verification of Ethash should fail between the parent belonging to 1):
        //
        // (0)---(1)-X-(2) <-- try to dispute a valid block
        //
        //
        it('should correctly execute test scenario 3', async () => {
            const requiredStakePerBlock = await merklerelay.getRequiredStakePerRoot();
            const stakeAccount0 = requiredStakePerBlock.mul(new BN(2));
            const stakeAccount1 = requiredStakePerBlock.mul(new BN(2));
            await merklerelay.depositStake(stakeAccount0, {
                from: accounts[0],
                value: stakeAccount0,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });  // submits block 1

            await merklerelay.depositStake(stakeAccount1, {
                from: accounts[1],
                value: stakeAccount1,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });  // submits blocks 2,3

            let genesisBlock = (await mainWeb3.eth.getBlock(GENESIS_BLOCK));
            let parentHash = genesisBlock.hash;

            // Create expected chain
            const block1 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            
            const block5 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const block6 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 6);
            const block7 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 7);
            const block8 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 8);

            let elements = [];
            let expectedRoots = [];

            // Add (1)
            elements.push(createRLPHeader(block1));
            elements.push(createRLPHeader(block2));
            elements.push(createRLPHeader(block3));
            elements.push(createRLPHeader(block4));

                
            const proofLeaves = elements.map(keccak256);
            const merkleTree = new MerkleTree(proofLeaves, keccak256);
            const root = merkleTree.getHexRoot();

            ret = await merklerelay.submitRoot(elements.map(Buffer.from), parentHash, {
                from: accounts[0],
                gas: 3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });
            
            expectEvent.inLogs(ret.logs, 'NewRoot', {root: root});
            parentHash = root;

            // Add (2)
            let elementsBis = [];
            elementsBis.push(createRLPHeader(block5));
            elementsBis.push(createRLPHeader(block6));
            elementsBis.push(createRLPHeader(block7));
            elementsBis.push(createRLPHeader(block8));

                
            const proofLeavesBis = elementsBis.map(keccak256);
            const merkleTreeBis = new MerkleTree(proofLeavesBis, keccak256);
            const rootBis = merkleTreeBis.getHexRoot();

            ret = await merklerelay.submitRoot(elementsBis.map(Buffer.from), parentHash, {
                from: accounts[0],
                gas: 3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });
            
            expectEvent.inLogs(ret.logs, 'NewRoot', {root: rootBis});
            submitTime = await time.latest();

            const {
                "DatasetLookUp":    dataSetLookupBlock2,
                "WitnessForLookup": witnessForLookupBlock2,
            } = require("./pow/genesisPlus88.json");

            const powMetadata = {dataSetLookup: dataSetLookupBlock2, witnessForLookup: witnessForLookupBlock2};

            let proof = merkleTreeBis.getProof(proofLeavesBis[0]);
            let proofSC = proof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let position_array = proofSC.map((el,i)=> {return el.position});
            let data_array = proofSC.map((el, i) => {return el.data});

            const blockProof = {proof: data_array, position: position_array};

            let parentProof = merkleTree.getProof(proofLeaves[3]);
            let parentProofSC = parentProof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let parent_position_array = parentProofSC.map((el,i)=> {return el.position});
            let parent_data_array = parentProofSC.map((el, i) => {return el.data});

            const blockParentProof = {proof: parent_data_array, position: parent_position_array};

            ret = await merklerelay.disputeBlockHeader(createRLPHeader(block5), blockProof, 
                    createRLPHeader(block4), blockParentProof, rootBis, root, powMetadata, {
                from: accounts[1],
                gas: 3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });
            expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(0)});
            
            expectedRoots.push(
                {
                    hash: rootBis,
                    lastHash: '0x'+keccak256(elementsBis[elementsBis.length-1]).toString('hex'),
                    number: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length+elementsBis.length)).number,
                    totalDifficulty: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length+elementsBis.length)).totalDifficulty,
                    lengthUpdate: elementsBis.length,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: "0x0000000000000000000000000000000000000000000000000000000000000000", 
                    lockedUntil: submitTime.add(LOCK_PERIOD),
                    submitter: accounts[0],
                    successors: []
                }
            );

            // Check
            await checkExpectedEndpoints(expectedRoots);
            await checkExpectedRoots(expectedRoots);

            // withdraw stake
            await withdrawStake(requiredStakePerBlock.mul(new BN(2)), accounts[0]);
            await withdrawStake(requiredStakePerBlock.mul(new BN(2)), accounts[1]);
        });

        // Test Scenario 4 (difficulty of a block is not correct):
        //
        // (0)---(1)-X-(2)
        //
        //
        it('should fail because the difficulty of a block is not valid', async () => {
            const requiredStakePerBlock = await merklerelay.getRequiredStakePerRoot();
            const stakeAccount0 = requiredStakePerBlock.mul(new BN(2));
            const stakeAccount1 = requiredStakePerBlock.mul(new BN(2));
            await merklerelay.depositStake(stakeAccount0, {
                from: accounts[0],
                value: stakeAccount0,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });  // submits block 1

            await merklerelay.depositStake(stakeAccount1, {
                from: accounts[1],
                value: stakeAccount1,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price

            });  // submits blocks 2,3

            let genesisBlock = (await mainWeb3.eth.getBlock(GENESIS_BLOCK));
            let parentHash = genesisBlock.hash;

            // Create expected chain
            const block1 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            
            const block5 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const block6 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 6);
            const block7 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 7);
            const block8 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 8);

            // change the difficulty such that the PoW validation results in false (prune Branch)
            const newDifficulty = mainWeb3.utils.toBN(block5.difficulty).add(mainWeb3.utils.toBN(1000));
            block5.difficulty = newDifficulty.toString();
            block5.hash = calculateBlockHash(block5);
            block6.parentHash = block5.hash;
            block6.hash = calculateBlockHash(block6);
            block7.parentHash = block6.hash;
            block7.hash = calculateBlockHash(block7);
            block8.parentHash = block7.hash;
            block8.hash = calculateBlockHash(block8);

            let elements = [];
            let expectedRoots = [];

            // Add (1)
            elements.push(createRLPHeader(block1));
            elements.push(createRLPHeader(block2));
            elements.push(createRLPHeader(block3));
            elements.push(createRLPHeader(block4));

                
            const proofLeaves = elements.map(keccak256);
            const merkleTree = new MerkleTree(proofLeaves, keccak256);
            const root = merkleTree.getHexRoot();

            ret = await merklerelay.submitRoot(elements.map(Buffer.from), parentHash, {
                from: accounts[0],
                gas: 3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });
            
            expectEvent.inLogs(ret.logs, 'NewRoot', {root: root});
            parentHash = root;
            submitTime = await time.latest();

            // Add (2)
            let elementsBis = [];
            elementsBis.push(createRLPHeader(block5));
            elementsBis.push(createRLPHeader(block6));
            elementsBis.push(createRLPHeader(block7));
            elementsBis.push(createRLPHeader(block8));

                
            const proofLeavesBis = elementsBis.map(keccak256);
            const merkleTreeBis = new MerkleTree(proofLeavesBis, keccak256);
            const rootBis = merkleTreeBis.getHexRoot();

            ret = await merklerelay.submitRoot(elementsBis.map(Buffer.from), parentHash, {
                from: accounts[0],
                gas: 3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });
            
            expectEvent.inLogs(ret.logs, 'NewRoot', {root: rootBis});

            const {
                "DatasetLookUp":    dataSetLookupBlock2,
                "WitnessForLookup": witnessForLookupBlock2,
            } = require("./pow/genesisPlus88.json");

            const powMetadata = {dataSetLookup: dataSetLookupBlock2, witnessForLookup: witnessForLookupBlock2};

            let proof = merkleTreeBis.getProof(proofLeavesBis[0]);
            let proofSC = proof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let position_array = proofSC.map((el,i)=> {return el.position});
            let data_array = proofSC.map((el, i) => {return el.data});

            const blockProof = {proof: data_array, position: position_array};

            let parentProof = merkleTree.getProof(proofLeaves[3]);
            let parentProofSC = parentProof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let parent_position_array = parentProofSC.map((el,i)=> {return el.position});
            let parent_data_array = parentProofSC.map((el, i) => {return el.data});

            const blockParentProof = {proof: parent_data_array, position: parent_position_array};

            ret = await merklerelay.disputeBlockHeader(createRLPHeader(block5), blockProof, 
                    createRLPHeader(block4), blockParentProof, rootBis, root, powMetadata, {
                from: accounts[1],
                gas: 3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });
            expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(7)});
            
            expectedRoots.push(
                {
                    hash: root,
                    lastHash: '0x'+keccak256(elements[elements.length-1]).toString('hex'),
                    number: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).number,
                    totalDifficulty: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).totalDifficulty,
                    lengthUpdate: elements.length,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: "0x0000000000000000000000000000000000000000000000000000000000000000", 
                    lockedUntil: submitTime.add(LOCK_PERIOD),
                    submitter: accounts[0],
                    successors: []
                }
            );

            // Check
            await checkExpectedEndpoints(expectedRoots);
            await checkExpectedRoots(expectedRoots);

            // withdraw stake
            await withdrawStake(requiredStakePerBlock.mul(new BN(1)), accounts[0]);
            await withdrawStake(requiredStakePerBlock.mul(new BN(3)), accounts[1]);
        });

        // Test Scenario 5 (difficulty of a block is not correct):
        //
        // (0)---(1)-X-(2)
        //
        //
        it('should fail because the gasLimit of a block is too high', async () => {
            const requiredStakePerBlock = await merklerelay.getRequiredStakePerRoot();
            const stakeAccount0 = requiredStakePerBlock.mul(new BN(2));
            const stakeAccount1 = requiredStakePerBlock.mul(new BN(2));
            await merklerelay.depositStake(stakeAccount0, {
                from: accounts[0],
                value: stakeAccount0,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });  // submits block 1

            await merklerelay.depositStake(stakeAccount1, {
                from: accounts[1],
                value: stakeAccount1,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });  // submits blocks 2,3

            let genesisBlock = (await mainWeb3.eth.getBlock(GENESIS_BLOCK));
            let parentHash = genesisBlock.hash;

            // Create expected chain
            const block1 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            
            const block5 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const block6 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 6);
            const block7 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 7);
            const block8 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 8);

            // change the difficulty such that the PoW validation results in false (prune Branch)
            block5.gasLimit = MAX_GAS_LIMIT + 1n;;
            block5.hash = calculateBlockHash(block5);
            block6.parentHash = block5.hash;
            block6.hash = calculateBlockHash(block6);
            block7.parentHash = block6.hash;
            block7.hash = calculateBlockHash(block7);
            block8.parentHash = block7.hash;
            block8.hash = calculateBlockHash(block8);

            let elements = [];
            let expectedRoots = [];

            // Add (1)
            elements.push(createRLPHeader(block1));
            elements.push(createRLPHeader(block2));
            elements.push(createRLPHeader(block3));
            elements.push(createRLPHeader(block4));

                
            const proofLeaves = elements.map(keccak256);
            const merkleTree = new MerkleTree(proofLeaves, keccak256);
            const root = merkleTree.getHexRoot();

            ret = await merklerelay.submitRoot(elements.map(Buffer.from), parentHash, {
                from: accounts[0],
                gas: 3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });
            
            expectEvent.inLogs(ret.logs, 'NewRoot', {root: root});
            parentHash = root;
            submitTime = await time.latest();

            // Add (2)
            let elementsBis = [];
            elementsBis.push(createRLPHeader(block5));
            elementsBis.push(createRLPHeader(block6));
            elementsBis.push(createRLPHeader(block7));
            elementsBis.push(createRLPHeader(block8));

                
            const proofLeavesBis = elementsBis.map(keccak256);
            const merkleTreeBis = new MerkleTree(proofLeavesBis, keccak256);
            const rootBis = merkleTreeBis.getHexRoot();

            ret = await merklerelay.submitRoot(elementsBis.map(Buffer.from), parentHash, {
                from: accounts[0],
                gas: 3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });
            
            expectEvent.inLogs(ret.logs, 'NewRoot', {root: rootBis});

            const {
                "DatasetLookUp":    dataSetLookupBlock2,
                "WitnessForLookup": witnessForLookupBlock2,
            } = require("./pow/genesisPlus88.json");

            const powMetadata = {dataSetLookup: dataSetLookupBlock2, witnessForLookup: witnessForLookupBlock2};

            let proof = merkleTreeBis.getProof(proofLeavesBis[0]);
            let proofSC = proof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let position_array = proofSC.map((el,i)=> {return el.position});
            let data_array = proofSC.map((el, i) => {return el.data});

            const blockProof = {proof: data_array, position: position_array};

            let parentProof = merkleTree.getProof(proofLeaves[3]);
            let parentProofSC = parentProof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let parent_position_array = parentProofSC.map((el,i)=> {return el.position});
            let parent_data_array = parentProofSC.map((el, i) => {return el.data});

            const blockParentProof = {proof: parent_data_array, position: parent_position_array};

            ret = await merklerelay.disputeBlockHeader(createRLPHeader(block5), blockProof, 
                    createRLPHeader(block4), blockParentProof, rootBis, root, powMetadata, {
                from: accounts[1],
                gas: 3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });
            expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(8)});
            
            expectedRoots.push(
                {
                    hash: root,
                    lastHash: '0x'+keccak256(elements[elements.length-1]).toString('hex'),
                    number: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).number,
                    totalDifficulty: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).totalDifficulty,
                    lengthUpdate: elements.length,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: "0x0000000000000000000000000000000000000000000000000000000000000000", 
                    lockedUntil: submitTime.add(LOCK_PERIOD),
                    submitter: accounts[0],
                    successors: []
                }
            );

            // Check
            await checkExpectedEndpoints(expectedRoots);
            await checkExpectedRoots(expectedRoots);

            // withdraw stake
            await withdrawStake(requiredStakePerBlock.mul(new BN(1)), accounts[0]);
            await withdrawStake(requiredStakePerBlock.mul(new BN(3)), accounts[1]);
        });

        // Test Scenario 5 (difficulty of a block is not correct):
        //
        // (0)---(1)-X-(2)
        //
        //
        it('should fail because the gasLimit of a block is too low', async () => {
            const requiredStakePerBlock = await merklerelay.getRequiredStakePerRoot();
            const stakeAccount0 = requiredStakePerBlock.mul(new BN(2));
            const stakeAccount1 = requiredStakePerBlock.mul(new BN(2));
            await merklerelay.depositStake(stakeAccount0, {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                value: stakeAccount0,
                gasPrice: GAS_PRICE_IN_WEI
            });  // submits block 1

            await merklerelay.depositStake(stakeAccount1, {
                from: accounts[1],
                value: stakeAccount1,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });  // submits blocks 2,3

            let genesisBlock = (await mainWeb3.eth.getBlock(GENESIS_BLOCK));
            let parentHash = genesisBlock.hash;

            // Create expected chain
            const block1 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            
            const block5 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const block6 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 6);
            const block7 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 7);
            const block8 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 8);

            // change the difficulty such that the PoW validation results in false (prune Branch)
            block5.gasLimit = MIN_GAS_LIMIT - 1;
            block5.hash = calculateBlockHash(block5);
            block6.parentHash = block5.hash;
            block6.hash = calculateBlockHash(block6);
            block7.parentHash = block6.hash;
            block7.hash = calculateBlockHash(block7);
            block8.parentHash = block7.hash;
            block8.hash = calculateBlockHash(block8);

            let elements = [];
            let expectedRoots = [];

            // Add (1)
            elements.push(createRLPHeader(block1));
            elements.push(createRLPHeader(block2));
            elements.push(createRLPHeader(block3));
            elements.push(createRLPHeader(block4));

                
            const proofLeaves = elements.map(keccak256);
            const merkleTree = new MerkleTree(proofLeaves, keccak256);
            const root = merkleTree.getHexRoot();

            ret = await merklerelay.submitRoot(elements.map(Buffer.from), parentHash, {
                from: accounts[0],
                gas: 8000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });
            
            expectEvent.inLogs(ret.logs, 'NewRoot', {root: root});
            parentHash = root;
            submitTime = await time.latest();

            // Add (2)
            let elementsBis = [];
            elementsBis.push(createRLPHeader(block5));
            elementsBis.push(createRLPHeader(block6));
            elementsBis.push(createRLPHeader(block7));
            elementsBis.push(createRLPHeader(block8));

                
            const proofLeavesBis = elementsBis.map(keccak256);
            const merkleTreeBis = new MerkleTree(proofLeavesBis, keccak256);
            const rootBis = merkleTreeBis.getHexRoot();

            ret = await merklerelay.submitRoot(elementsBis.map(Buffer.from), parentHash, {
                from: accounts[0],
                gas: 8000000,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });
            
            expectEvent.inLogs(ret.logs, 'NewRoot', {root: rootBis});

            const {
                "DatasetLookUp":    dataSetLookupBlock2,
                "WitnessForLookup": witnessForLookupBlock2,
            } = require("./pow/genesisPlus88.json");

            const powMetadata = {dataSetLookup: dataSetLookupBlock2, witnessForLookup: witnessForLookupBlock2};

            let proof = merkleTreeBis.getProof(proofLeavesBis[0]);
            let proofSC = proof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let position_array = proofSC.map((el,i)=> {return el.position});
            let data_array = proofSC.map((el, i) => {return el.data});

            const blockProof = {proof: data_array, position: position_array};

            let parentProof = merkleTree.getProof(proofLeaves[3]);
            let parentProofSC = parentProof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let parent_position_array = parentProofSC.map((el,i)=> {return el.position});
            let parent_data_array = parentProofSC.map((el, i) => {return el.data});

            const blockParentProof = {proof: parent_data_array, position: parent_position_array};

            ret = await merklerelay.disputeBlockHeader(createRLPHeader(block5), blockProof, 
                    createRLPHeader(block4), blockParentProof, rootBis, root, powMetadata, {
                from: accounts[1],
                gas: 3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price
            });
            expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(9)});
            
            expectedRoots.push(
                {
                    hash: root,
                    lastHash: '0x'+keccak256(elements[elements.length-1]).toString('hex'),
                    number: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).number,
                    totalDifficulty: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).totalDifficulty,
                    lengthUpdate: elements.length,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: "0x0000000000000000000000000000000000000000000000000000000000000000", 
                    lockedUntil: submitTime.add(LOCK_PERIOD),
                    submitter: accounts[0],
                    successors: []
                }
            );

            // Check
            await checkExpectedEndpoints(expectedRoots);
            await checkExpectedRoots(expectedRoots);

            // withdraw stake
            await withdrawStake(requiredStakePerBlock.mul(new BN(1)), accounts[0]);
            await withdrawStake(requiredStakePerBlock.mul(new BN(3)), accounts[1]);
        });

        // Test Scenario 6 (verification of Ethash should fail):
        //
        // (0)---(1)----(2)
        //         \        
        //          \-X-(3)
        //
        it('should correctly execute test scenario 6', async () => {
            const requiredStakePerBlock = await merklerelay.getRequiredStakePerRoot();
            const stakeAccount0 = requiredStakePerBlock.mul(new BN(3));
            const stakeAccount1 = requiredStakePerBlock.mul(new BN(2));
            await merklerelay.depositStake(stakeAccount0, {
                from: accounts[0],
                value: stakeAccount0,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });  // submits block 1

            await merklerelay.depositStake(stakeAccount1, {
                from: accounts[1],
                value: stakeAccount1,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,
            });  // submits blocks 2,3

            let genesisBlock = (await mainWeb3.eth.getBlock(GENESIS_BLOCK));
            let parentHash = genesisBlock.hash;

            // Create expected chain
            const block1 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            
            const block5 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const block6 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 6);
            const block7 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 7);
            const block8 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 8);

            let elements = [];
            let expectedRoots = [];

            // Add (1)
            elements.push(createRLPHeader(block1));
            elements.push(createRLPHeader(block2));
            elements.push(createRLPHeader(block3));
            elements.push(createRLPHeader(block4));

                
            const proofLeaves = elements.map(keccak256);
            const merkleTree = new MerkleTree(proofLeaves, keccak256);
            const root = merkleTree.getHexRoot();

            ret = await merklerelay.submitRoot(elements.map(Buffer.from), parentHash, {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gas: 8000000,
                gasPrice: GAS_PRICE_IN_WEI
            });
            
            expectEvent.inLogs(ret.logs, 'NewRoot', {root: root});
            parentHash = root;

            // Add (2)
            let elementsBis = [];
            elementsBis.push(createRLPHeader(block5));
            elementsBis.push(createRLPHeader(block6));
            elementsBis.push(createRLPHeader(block7));
            elementsBis.push(createRLPHeader(block8));

                
            const proofLeavesBis = elementsBis.map(keccak256);
            const merkleTreeBis = new MerkleTree(proofLeavesBis, keccak256);
            const rootBis = merkleTreeBis.getHexRoot();

            ret = await merklerelay.submitRoot(elementsBis.map(Buffer.from), parentHash, {
                from: accounts[0],
                gas: 3000000,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });
            
            expectEvent.inLogs(ret.logs, 'NewRoot', {root: rootBis});

            // Add (3)
            // change nonce such that the PoW validation results in false (prune Branch)
            block5.nonce = addToHex(block5.nonce, 1);
            block5.hash = calculateBlockHash(block5);
            block6.parentHash = block5.hash;
            block6.hash = calculateBlockHash(block6);
            block7.parentHash = block6.hash;
            block7.hash = calculateBlockHash(block7);
            block8.parentHash = block7.hash;
            block8.hash = calculateBlockHash(block8);

            // Add (2)
            let elementsTris = [];
            elementsTris.push(createRLPHeader(block5));
            elementsTris.push(createRLPHeader(block6));
            elementsTris.push(createRLPHeader(block7));
            elementsTris.push(createRLPHeader(block8));

                
            const proofLeavesTris = elementsTris.map(keccak256);
            const merkleTreeTris = new MerkleTree(proofLeavesTris, keccak256);
            const rootTris = merkleTreeTris.getHexRoot();

            ret = await merklerelay.submitRoot(elementsTris.map(Buffer.from), parentHash, {
                from: accounts[0],
                gas: 3000000,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });
            
            expectEvent.inLogs(ret.logs, 'NewRoot', {root: rootTris});
            submitTime = await time.latest();

            const {
                "DatasetLookUp":    dataSetLookupBlock2,
                "WitnessForLookup": witnessForLookupBlock2,
            } = require("./pow/genesisPlus88.json");

            const powMetadata = {dataSetLookup: dataSetLookupBlock2, witnessForLookup: witnessForLookupBlock2};

            let proof = merkleTreeTris.getProof(proofLeavesTris[0]);
            let proofSC = proof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let position_array = proofSC.map((el,i)=> {return el.position});
            let data_array = proofSC.map((el, i) => {return el.data});

            const blockProof = {proof: data_array, position: position_array};

            let parentProof = merkleTree.getProof(proofLeaves[3]);
            let parentProofSC = parentProof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let parent_position_array = parentProofSC.map((el,i)=> {return el.position});
            let parent_data_array = parentProofSC.map((el, i) => {return el.data});

            const blockParentProof = {proof: parent_data_array, position: parent_position_array};

            ret = await merklerelay.disputeBlockHeader(createRLPHeader(block5), blockProof, 
                    createRLPHeader(block4), blockParentProof, rootTris, root, powMetadata, {
                from: accounts[1],
                gas: 3000000,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });

            expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(2)});
            
            expectedRoots.push(
                {
                    hash: rootBis,
                    lastHash: '0x'+keccak256(elementsBis[elementsBis.length-1]).toString('hex'),
                    number: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length+elementsBis.length)).number,
                    totalDifficulty: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length+elementsBis.length)).totalDifficulty,
                    lengthUpdate: elementsBis.length,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: "0x0000000000000000000000000000000000000000000000000000000000000000", 
                    lockedUntil: submitTime.add(LOCK_PERIOD),
                    submitter: accounts[0],
                    successors: []
                }
            );

            // Check
            await checkExpectedEndpoints(expectedRoots);
            await checkExpectedRoots(expectedRoots);

            // withdraw stake
            await withdrawStake(requiredStakePerBlock.mul(new BN(2)), accounts[0]);
            await withdrawStake(requiredStakePerBlock.mul(new BN(3)), accounts[1]);
        }); 
    });

    describe('MerkleRelay: VerifyTransaction', function () {

        // Test Scenario 1:
        //
        //              tx
        //              |
        //              v
        // (0)---(1)---(2)-
        //
        it('should correctly execute test scenario 1', async () => {
            // deposit enough stake
            const requiredStakePerBlock = await merklerelay.getRequiredStakePerRoot();
            const stakeAccount0 = requiredStakePerBlock.mul(new BN(3));
            const stakeAccount1 = requiredStakePerBlock.mul(new BN(2));
            const submitterAddr = accounts[0];
            const verifierAddr = accounts[1];

            await merklerelay.depositStake(stakeAccount0, {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                value: stakeAccount0,
                gasPrice: GAS_PRICE_IN_WEI
            });  // submits block 1

            await merklerelay.depositStake(stakeAccount1, {
                from: accounts[1],
                value: stakeAccount1,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });  // submits blocks 2,3

            let genesisBlock = (await mainWeb3.eth.getBlock(GENESIS_BLOCK));
            let parentHash = genesisBlock.hash;
            const verificationFee = await merklerelay.getRequiredVerificationFee();

            // Create expected chain
            const block1 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 1);
            const block2 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 2);
            const block3 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 3);
            const block4 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 4);
            
            const block5 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 5);
            const block6 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 6);
            const block7 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 7);
            const block8 = await mainWeb3.eth.getBlock(GENESIS_BLOCK + 8);

            let elements = [];
            let expectedRoots = [];

            // Add (1)
            elements.push(createRLPHeader(block1));
            elements.push(createRLPHeader(block2));
            elements.push(createRLPHeader(block3));
            elements.push(createRLPHeader(block4));

            const proofLeaves = elements.map(keccak256);
            const merkleTree = new MerkleTree(proofLeaves, keccak256);
            const root = merkleTree.getHexRoot();

            ret = await merklerelay.submitRoot(elements.map(Buffer.from), parentHash, {
                from: accounts[0],
                gas: 8000000,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });
            
            expectEvent.inLogs(ret.logs, 'NewRoot', {root: root});
            parentHash = root;
            let submitTime = await time.latest();
            
            expectedRoots.push({
                root: {
                    hash: root,
                    lastHash: '0x'+keccak256(elements[elements.length-1]).toString('hex'),
                    number: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).number,
                    totalDifficulty: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length)).totalDifficulty,
                    lengthUpdate: elements.length,
                    forkId: 0,
                    iterableIndex: 0,
                    latestFork: "0x0000000000000000000000000000000000000000000000000000000000000000", 
                    lockedUntil: submitTime.add(LOCK_PERIOD),
                    submitter: accounts[0],
                    successors: []
                },
            })

            // Add (2)
            let elementsBis = [];
            elementsBis.push(createRLPHeader(block5));
            elementsBis.push(createRLPHeader(block6));
            elementsBis.push(createRLPHeader(block7));
            elementsBis.push(createRLPHeader(block8));
            const requestedBlockInRlp = createRLPHeader(block5);

            const proofLeavesBis = elementsBis.map(keccak256);
            const merkleTreeBis = new MerkleTree(proofLeavesBis, keccak256);
            const rootBis = merkleTreeBis.getHexRoot();

            ret = await merklerelay.submitRoot(elementsBis.map(Buffer.from), parentHash, {
                from: accounts[0],
                gas: 8000000,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });
            
            expectEvent.inLogs(ret.logs, 'NewRoot', {root: rootBis});

            const {Value, Path, Nodes} = require("./transactions/genesis.json");

            let proof = merkleTreeBis.getProof(proofLeavesBis[0]);
            let proofSC = proof.map((el, i) => {return el.position == 'right' ?  {position: true, data: el.data} : {position: false, data: el.data}}); 
            let position_array = proofSC.map((el,i)=> {return el.position});
            let data_array = proofSC.map((el, i) => {return el.data});

            const blockProof = {proof: data_array, position: position_array};

            expectedRoots.push(
                {
                    root: {
                        hash: rootBis,
                        lastHash: '0x'+keccak256(elementsBis[elementsBis.length-1]).toString('hex'),
                        number: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length+elementsBis.length)).number,
                        totalDifficulty: (await mainWeb3.eth.getBlock(GENESIS_BLOCK+elements.length+elementsBis.length)).totalDifficulty,
                        lengthUpdate: elementsBis.length,
                        forkId: 0,
                        iterableIndex: 0,
                        latestFork: "0x0000000000000000000000000000000000000000000000000000000000000000", 
                        lockedUntil: submitTime.add(LOCK_PERIOD),
                        submitter: accounts[0],
                        successors: []
                    },
            });

            let balanceSubmitterBeforeCall = await balance.current(submitterAddr);
            let balanceVerifierBeforeCall = await balance.current(verifierAddr);

            ret = await merklerelay.verifyTransaction(verificationFee, requestedBlockInRlp, 0, Value, Path, Nodes, blockProof, rootBis, {
                from: verifierAddr,
                maxFeePerGas: next_gas_price,
                value: verificationFee,
                gas: 8000000,
                gasPrice: GAS_PRICE_IN_WEI
            });

            expectEvent.inLogs(ret.logs, 'VerifyTransaction', {result: new BN(0)});

            let balanceSubmitterAfterCall = await balance.current(submitterAddr);
            let balanceVerifierAfterCall = await balance.current(verifierAddr);
            let txCost = (new BN(ret.receipt.gasUsed)).mul(GAS_PRICE_IN_WEI);
            console.log("Gas used for verifying a transaction: ", ret.receipt.gasUsed);

            expect(balanceSubmitterBeforeCall).to.be.bignumber.equal(balanceSubmitterAfterCall.sub(verificationFee));
            expect(balanceVerifierBeforeCall).to.be.bignumber.equal(balanceVerifierAfterCall.add(verificationFee).add(txCost));
            
            let stake = await merklerelay.getStake({
                from: submitterAddr
            });
            await withdrawStake(stake, submitterAddr);
        });
    });

    // checks if expectedEndpoints array is correct and if longestChainEndpoints contains hash of block with highest difficulty
    const checkExpectedEndpoints = async (expectedEndpoints) => {
        expect(await merklerelay.getNumberOfForks()).to.be.bignumber.equal(new BN(expectedEndpoints.length));

        let expectedLongestChainEndpoint = expectedEndpoints[0];
        await asyncForEach(expectedEndpoints, async (expected, index) => {
            expect(await merklerelay.getEndpoint(index)).to.equal(expected.hash);
            if (expectedLongestChainEndpoint.totalDifficulty < expected.totalDifficulty) {
                expectedLongestChainEndpoint = expected;
            }
        });

        expect(await merklerelay.getLongestChainEndpoint()).to.equal(expectedLongestChainEndpoint.hash);
    };

    const checkExpectedRoots = async (expectedRoots) => {
        await asyncForEach(expectedRoots, async expected => {
            // check header data
            const actualRoot = await merklerelay.getExtendedRootMetadata(expected.hash);
            assertRootEqual(actualRoot, expected);
        });
    };

    const getAccountBalanceInWei = async (accountAddress) => {
        return await balance.current(accountAddress);
    };

    const withdrawStake = async (stake, accountAddr) => {
        const submitTime = await time.latest();
        const increasedTime = submitTime.add(LOCK_PERIOD).add(time.duration.seconds(1));
        const block = await mainWeb3.eth.getBlock('latest');
        next_gas_price = Math.ceil(block.baseFeePerGas);
        await time.increaseTo(increasedTime);  // unlock all blocks
        await merklerelay.withdrawStake(stake, {from: accountAddr, gasPrice: GAS_PRICE_IN_WEI,maxFeePerGas: next_gas_price,});
    };

    const assertRootEqual = (actual, expected) => {
        expect(actual.blockNumber).to.be.bignumber.equal(new BN(expected.number));
        expect(actual.lengthUpdate).to.be.bignumber.equal(new BN(expected.lengthUpdate));
        expect(actual.forkId).to.be.bignumber.equal(new BN(expected.forkId));
        expect(actual.iterableIndex).to.be.bignumber.equal(new BN(expected.iterableIndex));
        expect(actual.lockedUntil).to.be.bignumber.equal(expected.lockedUntil);
        expect(actual.successors).to.deep.equal(expected.successors);
        expect(actual.submitter).to.equal(expected.submitter);
        expect(actual.latestFork).to.equal(expected.latestFork);
        expect(actual.lastHash).to.equal(expected.lastHash);
    };
    
    
    const asyncForEach = async (array, callback) => {
        for (let index = 0; index < array.length; index++) {
            await callback(array[index], index, array);
        }
    };

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
});