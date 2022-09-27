const Web3 = require("web3");
const {BN, expectRevert, time, balance} = require('@openzeppelin/test-helpers');
const {createRLPHeader, calculateBlockHash, addToHex, createRLPValueState, createRLPNodeEncodeState} = require('../utils/utils');
const expectEvent = require('./expectEvent');
const RLP = require('rlp');
const {keccak256, arrToBufArr} = require('ethereumjs-util');

const { INFURA_TESTNET_ENDPOINT, INFURA_MAINNET_ENDPOINT } = require("../constant");

const StateRelay = artifacts.require('./StateRelay');
const EthashOwner = artifacts.require('./EthashOwner');
const {expect} = require('chai');
const { web3 } = require("@openzeppelin/test-helpers/src/setup");

// const GENESIS_BLOCK = 12259044;
// let EPOCH = 408;

const EPOCH         = 493; //427; 
const GENESIS_BLOCK = 14804381;// 12814531;  // block of the prove - 3
expect(Math.floor(GENESIS_BLOCK / 30000), "genesis block not in epoch").to.equal(EPOCH);

const EPOCHFILE = "./pow/epoch.json";
const DATAPOWFILE = "./pow/genesisPlus2.json";

const BLOCKCHAIN_ID = "0x13600b294191fc92924bb3ce4b969c1e7e2bab8f4c93c3fc6d0a51733df3c060";

const LOCK_PERIOD               = time.duration.minutes(5);
const GAS_PRICE_IN_WEI          = new BN(0);

contract('StateRelay', async(accounts) => {

    let staterelay;
    let ethash;
    let mainWeb3;
    let sourceWeb3;
    let next_gas_price;

    before(async () => {
        sourceWeb3 = new Web3(INFURA_TESTNET_ENDPOINT);
        mainWeb3 = new Web3(INFURA_MAINNET_ENDPOINT);
        const block = await mainWeb3.eth.getBlock('latest');
        next_gas_price = Math.ceil(block.baseFeePerGas);

        // Advance to the next block to correctly read time in the solidity "now" function interpreted by ganache
        await time.advanceBlock();
    });

    beforeEach(async () => {
        staterelay = await StateRelay.new({
            from: accounts[0],
            gasPrice: GAS_PRICE_IN_WEI,
            maxFeePerGas: next_gas_price,
        });

        ethash = await createEthash(EPOCHFILE);
    });


    describe('Staterelay: DepositStake', function () {

        // Test Scenario 1:
        it("should throw error: transfer amount not equal to function parameter", async () => {
            const stake = new BN(1);
            await expectRevert(
                staterelay.depositStake(stake, {
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
            const balanceBeforeCall = await staterelay.getStake({from: accounts[0]});

            await staterelay.depositStake(stake, {from: accounts[0], value: stake});
            const balanceAfterCall = await staterelay.getStake({from: accounts[0]});

            expect(balanceAfterCall).to.be.bignumber.equal(balanceBeforeCall.add(stake));

            // get back the provided amount of ether
            await withdrawStake(stake, accounts[0]);
        });

    });

    describe('StateRelay: init a state', function(){

        it('should correctly initialize the state of an account', async () => {
            const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
            const stake = new BN(1000000001);
            const balanceBeforeCall = await staterelay.getStake({from: accounts[0]});

            const startBalance = await mainWeb3.eth.getBalance(accounts[0]);//, GENESIS_BLOCK);
            const genesisRlpHeader = createRLPHeader(genesisBlock);

            await staterelay.depositStake(stake, {from: accounts[0], value: stake, maxFeePerGas: next_gas_price});
            const balanceAfterCall = await staterelay.getStake({from: accounts[0]});

            expect(balanceAfterCall).to.be.bignumber.equal(balanceBeforeCall.add(stake));

            await staterelay.initState(accounts[0], genesisRlpHeader, mainWeb3.utils.toHex(startBalance), ethash.address, {
                from: accounts[0],
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,
            });

            const state = mainWeb3.utils.hexToNumberString(await staterelay.getState(accounts[0]));
            expect(state).to.be.bignumber.equal(startBalance);
        });

        it('should not correctly initialize the state of an account: the identity already exists', async () => {
            const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
            const stake = new BN(1000000000);
            const balanceBeforeCall = await staterelay.getStake({from: accounts[0]});

            const startBalance = await mainWeb3.eth.getBalance(accounts[0]);//, GENESIS_BLOCK);
            const genesisRlpHeader = createRLPHeader(genesisBlock);

            await staterelay.depositStake(stake, {from: accounts[0], value: stake,
                maxFeePerGas: next_gas_price,
            });
            const balanceAfterCall = await staterelay.getStake({from: accounts[0]});

            expect(balanceAfterCall).to.be.bignumber.equal(balanceBeforeCall.add(stake));

            await staterelay.initState(accounts[0], genesisRlpHeader, mainWeb3.utils.toHex(startBalance), ethash.address, {
                from: accounts[0],
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,

            });

            await expectRevert(staterelay.initState(accounts[0], genesisRlpHeader, mainWeb3.utils.toHex(startBalance), ethash.address, {
                from: accounts[0],
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,

            }),
                "identity is already initialized");

        });

        it('should not correctly initialize the state of an account: not the same identity', async () => {
            const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
            const stake = new BN(1000000000);
            const balanceBeforeCall = await staterelay.getStake({from: accounts[0]});

            const startBalance = await mainWeb3.eth.getBalance(accounts[0]);//, GENESIS_BLOCK);
            const genesisRlpHeader = createRLPHeader(genesisBlock);

            await staterelay.depositStake(stake, {from: accounts[0], value: stake, 
                maxFeePerGas: next_gas_price,
            });
            const balanceAfterCall = await staterelay.getStake({from: accounts[0]});

            expect(balanceAfterCall).to.be.bignumber.equal(balanceBeforeCall.add(stake));

            await expectRevert(staterelay.initState(accounts[0], genesisRlpHeader, mainWeb3.utils.toHex(startBalance), ethash.address, {
                from: accounts[1],
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,

            }),
                "not the same identity");

        });
        
    });

    describe('StateRelay: submit a state', function(){

        it('should correctly submit the state of an account', async () => {
            const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
            const stake = new BN(1000000000);
            const balanceBeforeCall = await staterelay.getStake({from: accounts[0]});

            const startBalance = await mainWeb3.eth.getBalance(accounts[0]);//, GENESIS_BLOCK);
            const genesisRlpHeader = createRLPHeader(genesisBlock);

            await staterelay.depositStake(stake, {from: accounts[0], value: stake, 
                maxFeePerGas: next_gas_price,
            });
            const balanceAfterCall = await staterelay.getStake({from: accounts[0]});

            expect(balanceAfterCall).to.be.bignumber.equal(balanceBeforeCall.add(stake));

            await staterelay.initState(accounts[0], genesisRlpHeader, mainWeb3.utils.toHex(startBalance), ethash.address, {
                from: accounts[0],
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,

            });

            const state = mainWeb3.utils.hexToNumberString(await staterelay.getState(accounts[0]));
            expect(state).to.be.bignumber.equal(startBalance);

            const newBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 4));
            const intermediateBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 5));
            const confirmingBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 10));

            let return_value = await staterelay.submitState(newBlock, confirmingBlock, intermediateBlock,  mainWeb3.utils.toHex(startBalance), 10, {
                from: accounts[0],
                gas:3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,

            });

            // console.log((await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])));
        });


        it('should not correctly submit: still locked', async () => {
            const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
            const stake = new BN(1000000000);
            const balanceBeforeCall = await staterelay.getStake({from: accounts[0]});

            const startBalance = await mainWeb3.eth.getBalance(accounts[0]);//, GENESIS_BLOCK);
            const genesisRlpHeader = createRLPHeader(genesisBlock);

            await staterelay.depositStake(stake, {from: accounts[0], value: stake,
                maxFeePerGas: next_gas_price,
            });
            const balanceAfterCall = await staterelay.getStake({from: accounts[0]});

            expect(balanceAfterCall).to.be.bignumber.equal(balanceBeforeCall.add(stake));

            await staterelay.initState(accounts[0], genesisRlpHeader, mainWeb3.utils.toHex(startBalance), ethash.address, {
                from: accounts[0],
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,

            });

            const state = mainWeb3.utils.hexToNumberString(await staterelay.getState(accounts[0]));
            expect(state).to.be.bignumber.equal(startBalance);

            const newBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 4));
            const intermediateBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 5));
            const confirmingBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 10));

            await staterelay.submitState(newBlock, confirmingBlock, intermediateBlock, mainWeb3.utils.toHex(startBalance),  10, {
                from: accounts[0],
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,

            });

            await expectRevert(staterelay.submitState(newBlock, confirmingBlock, intermediateBlock, mainWeb3.utils.toHex(startBalance), 10, {
                from: accounts[0],
                gas:3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,

            }),
                "dispute period is not expired");
        });


        it('should not correctly submit the state: not initialized', async () => {
            const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
            const stake = new BN(1000000000);
            const balanceBeforeCall = await staterelay.getStake({from: accounts[0]});

            const startBalance = await mainWeb3.eth.getBalance(accounts[0]);//, GENESIS_BLOCK);
            const genesisRlpHeader = createRLPHeader(genesisBlock);

            await staterelay.depositStake(stake, {from: accounts[0], value: stake, 
                maxFeePerGas: next_gas_price,
            });
            const balanceAfterCall = await staterelay.getStake({from: accounts[0]});

            expect(balanceAfterCall).to.be.bignumber.equal(balanceBeforeCall.add(stake));

            await staterelay.initState(accounts[0], genesisRlpHeader, mainWeb3.utils.toHex(startBalance), ethash.address, {
                from: accounts[0],
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,

            });

            const state = mainWeb3.utils.hexToNumberString(await staterelay.getState(accounts[0]));
            expect(state).to.be.bignumber.equal(startBalance);

            const newBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 4));
            const intermediateBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 5));
            const confirmingBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 10));

            await staterelay.depositStake(stake, {from: accounts[1], value: stake, 
                maxFeePerGas: next_gas_price,
            });
            await expectRevert(staterelay.submitState(newBlock, confirmingBlock, intermediateBlock, mainWeb3.utils.toHex(startBalance), 10, {
                from: accounts[1],
                gas:3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,

            }),
                "identity not initialized");
        });

        it('should not correctly submit the state: not confirming block', async () => {
            const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
            const stake = new BN(1000000000);
            const balanceBeforeCall = await staterelay.getStake({from: accounts[0]});

            const startBalance = await mainWeb3.eth.getBalance(accounts[0]);//, GENESIS_BLOCK);
            const genesisRlpHeader = createRLPHeader(genesisBlock);

            await staterelay.depositStake(stake, {from: accounts[0], value: stake, 
                maxFeePerGas: next_gas_price,
            });
            const balanceAfterCall = await staterelay.getStake({from: accounts[0]});

            expect(balanceAfterCall).to.be.bignumber.equal(balanceBeforeCall.add(stake));

            await staterelay.initState(accounts[0], genesisRlpHeader, mainWeb3.utils.toHex(startBalance), ethash.address,  {
                from: accounts[0],
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,

            });

            const state = mainWeb3.utils.hexToNumberString(await staterelay.getState(accounts[0]));
            expect(state).to.be.bignumber.equal(startBalance);

            const newBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 4));
            const intermediateBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 5));
            const confirmingBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 9));

            await expectRevert(staterelay.submitState(newBlock, confirmingBlock, intermediateBlock, mainWeb3.utils.toHex(startBalance), 10, {
                from: accounts[0],
                gas:3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,

            }),
                "not confirmingBlock");
        });

        it('should not correctly submit the state: not intermediate block', async () => {
            const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
            const stake = new BN(1000000000);
            const balanceBeforeCall = await staterelay.getStake({from: accounts[0]});

            const startBalance = await mainWeb3.eth.getBalance(accounts[0]);//, GENESIS_BLOCK);
            const genesisRlpHeader = createRLPHeader(genesisBlock);

            await staterelay.depositStake(stake, {from: accounts[0], value: stake});
            const balanceAfterCall = await staterelay.getStake({from: accounts[0]});

            expect(balanceAfterCall).to.be.bignumber.equal(balanceBeforeCall.add(stake));

            await staterelay.initState(accounts[0], genesisRlpHeader, mainWeb3.utils.toHex(startBalance), ethash.address, {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });

            const state = mainWeb3.utils.hexToNumberString(await staterelay.getState(accounts[0]));
            expect(state).to.be.bignumber.equal(startBalance);

            const newBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 4));
            const intermediateBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 8));
            const confirmingBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + 10));

            await expectRevert(staterelay.submitState(newBlock, confirmingBlock, intermediateBlock, mainWeb3.utils.toHex(startBalance), 10, {
                from: accounts[0],
                gas:3000000,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            }),
                "not intermediateBlock");
        });

    });


    describe('StateRelay: challenge', function(){


        // Test Scenario 1 (verification of Ethash should be successful):
        //
        // (0)---(1)---(2)---(3)-X-(4)---(5)---(6)---(7)---(8)---(9)     // try to dispute a valid block -> should not prone any header
        //                    ^     /                             !
        //

        it('should correctly perform the challenge: the submitter win', async () => {
            const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
            const stake = new BN(1000000001);

            const startBalance = await getAccountState(mainWeb3, accounts[0], GENESIS_BLOCK); //await mainWeb3.eth.getBalance(accounts[0], GENESIS_BLOCK);
            const genesisRlpHeader = createRLPHeader(genesisBlock);

            await staterelay.depositStake(stake, {from: accounts[0], value: stake,
                maxFeePerGas: next_gas_price,
            });
            await staterelay.depositStake(stake, {from: accounts[1], value: stake, 
                maxFeePerGas: next_gas_price,
            });

            await staterelay.initState(accounts[0], genesisRlpHeader, startBalance, ethash.address, {
                from: accounts[0],
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });


            const state = await staterelay.getState(accounts[0]);
            expect(state).to.be.equal("0x"+startBalance.toString('hex'));

            const i = 4;
            const i_c = i + 6;
            let half = i_c / 2;
            const newBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + i));
            let intermediateBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + half));
            const confirmingBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + i_c));

            await staterelay.submitState(newBlock, confirmingBlock, intermediateBlock,  startBalance, 10, {
                from: accounts[0],
                gas:3000000,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });
            
            let intermediateHash = mainWeb3.utils.toHex(keccak256(intermediateBlock));

            await staterelay.challengerMessage(accounts[0], intermediateHash, {
                from: accounts[1],
                maxFeePerGas: next_gas_price,
                gas:3000000,
                gasPrice: GAS_PRICE_IN_WEI
            });
        
            half = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.midBlockNumber;
            let lower = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.lowerLimitBlock.blockNumber;
            
            while (half - lower > 1) {
                
                
                let notEncodedBlock = await mainWeb3.eth.getBlock(parseInt(half)); // submitter retrieves the block from its chain...
                intermediateBlock = createRLPHeader(notEncodedBlock);

                await staterelay.sumbitterMessage(intermediateBlock, { // and then ... submit it
                    from: accounts[0],
                    gas:3000000,
                    maxFeePerGas: next_gas_price,
                    gasPrice: GAS_PRICE_IN_WEI
                });
                
                // challenger retrieves its block from its chain...
                let trustedBlock = (await mainWeb3.eth.getBlock(parseInt(half))); 
                if (trustedBlock.hash == notEncodedBlock.hash) { // if the two blocks are the same ... 
                    // the problem should be afterwards...
                    let higherHash = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.upperLimitBlock.hash;
                    await staterelay.challengerMessage(accounts[0], higherHash, {
                        from: accounts[1],
                        gas:3000000,
                        maxFeePerGas: next_gas_price,
                        gasPrice: GAS_PRICE_IN_WEI
                    });
                } else { // otherwise, if they differ, the problem might be before..
                    let lowerHash = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.lowerLimitBlock.hash;
                    await staterelay.challengerMessage(accounts[0], lowerHash, {
                        from: accounts[1],
                        gas:3000000,
                        maxFeePerGas: next_gas_price,
                        gasPrice: GAS_PRICE_IN_WEI
                    });
                }
                
                half = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.midBlockNumber;
                lower = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.lowerLimitBlock.blockNumber;
                
            }  

            // the challenger ready to submit the final message to solve the dispute.
            let untrustedBlock = (await mainWeb3.eth.getBlock(parseInt(half)));
            console.log(half, lower, GENESIS_BLOCK);
            let pBlock = (await mainWeb3.eth.getBlock(parseInt(lower)));
            intermediateBlock = createRLPHeader(untrustedBlock);
            parentBlock = createRLPHeader(pBlock);

            // This data refers to block 14804384
            const { DatasetLookUp, WitnessForLookup } = require(DATAPOWFILE);

            let ret = await staterelay.verifyBlock(intermediateBlock, parentBlock, DatasetLookUp, WitnessForLookup, {
                from: accounts[0],
                gas:3000000,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });
            
            expectEvent.inLogs(ret.logs, 'DisputeBlock', {returnCode: new BN(0)});
                                    
            // rlp encoding of proves
            let proof = await getAccountProof(mainWeb3, accounts[0], GENESIS_BLOCK + i);
            let proof_c = await getAccountProof(mainWeb3, accounts[0], GENESIS_BLOCK + i_c)
            
            ret = await staterelay.verifyState(newBlock, proof, confirmingBlock, proof_c,  {
                from: accounts[0],
                gas:3000000,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });


            expectEvent.inLogs(ret.logs, 'DisputeWinner', {client: accounts[0], cancelledState: false});
            
        });

        it('should not correctly perform the challenge: the submitter tries to validate the state without having validated the block', async () => {
            const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
            const stake = new BN(1000000001);

            const startBalance = await getAccountState(mainWeb3, accounts[0], GENESIS_BLOCK); //await mainWeb3.eth.getBalance(accounts[0], GENESIS_BLOCK);
            const genesisRlpHeader = createRLPHeader(genesisBlock);

            await staterelay.depositStake(stake, {from: accounts[0], value: stake, 
                maxFeePerGas: next_gas_price,
            });
            await staterelay.depositStake(stake, {from: accounts[1], value: stake,
                maxFeePerGas: next_gas_price,
            });

            await staterelay.initState(accounts[0], genesisRlpHeader, startBalance, ethash.address, {
                from: accounts[0],
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,

            });


            const state = await staterelay.getState(accounts[0]);
            expect(state).to.be.equal("0x"+startBalance.toString('hex'));

            const i = 4;
            const i_c = i + 6;
            let half = i_c / 2;
            const newBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + i));
            let intermediateBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + half));
            const confirmingBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + i_c));

            await staterelay.submitState(newBlock, confirmingBlock, intermediateBlock,  startBalance, 10, {
                from: accounts[0],
                gas:3000000,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });
            
            let intermediateHash = mainWeb3.utils.toHex(keccak256(intermediateBlock));

            await staterelay.challengerMessage(accounts[0], intermediateHash, {
                from: accounts[1],
                gas:3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,

            });
        
            half = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.midBlockNumber;
            let lower = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.lowerLimitBlock.blockNumber;
            
            while (half - lower > 1) {
                
                
                let notEncodedBlock = await mainWeb3.eth.getBlock(parseInt(half)); // submitter retrieves the block from its chain...
                intermediateBlock = createRLPHeader(notEncodedBlock);

                await staterelay.sumbitterMessage(intermediateBlock, { // and then ... submit it
                    from: accounts[0],
                    maxFeePerGas: next_gas_price,
                    gas:3000000,
                    gasPrice: GAS_PRICE_IN_WEI
                });
                
                // challenger retrieves its block from its chain...
                let trustedBlock = (await mainWeb3.eth.getBlock(parseInt(half))); 
                if (trustedBlock.hash == notEncodedBlock.hash) { // if the two blocks are the same ... 
                    // the problem should be afterwards...
                    let higherHash = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.upperLimitBlock.hash;
                    await staterelay.challengerMessage(accounts[0], higherHash, {
                        from: accounts[1],
                        gas:3000000,
                        maxFeePerGas: next_gas_price,
                        gasPrice: GAS_PRICE_IN_WEI
                    });
                } else { // otherwise, if they differ, the problem might be before..
                    let lowerHash = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.lowerLimitBlock.hash;
                    await staterelay.challengerMessage(accounts[0], lowerHash, {
                        from: accounts[1],
                        gas:3000000,
                        maxFeePerGas: next_gas_price,
                        gasPrice: GAS_PRICE_IN_WEI
                    });
                }
                
                half = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.midBlockNumber;
                lower = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.lowerLimitBlock.blockNumber;
                
            }  
           
                                    
            // rlp encoding of proves
            let proof = await getAccountProof(mainWeb3, accounts[0], GENESIS_BLOCK + i);
            let proof_c = await getAccountProof(mainWeb3, accounts[0], GENESIS_BLOCK + i_c)
            
            let ret = await expectRevert(staterelay.verifyState(newBlock, proof, confirmingBlock, proof_c,  {
                from: accounts[0],
                gas:3000000,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            }), "verify the block before");
            
        });

        it('should correctly perform the challenge: the submitter lose, not valid POW metadata for nth block', async () => {
            const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
            const stake = new BN(1000000001);

            let startBalance = await getAccountState(mainWeb3, accounts[0], GENESIS_BLOCK);
            const genesisRlpHeader = createRLPHeader(genesisBlock);

            await staterelay.depositStake(stake, {from: accounts[0], value: stake, 
                maxFeePerGas: next_gas_price,
            });
            await staterelay.depositStake(stake, {from: accounts[1], value: stake,
                maxFeePerGas: next_gas_price,
            });
   
            await staterelay.initState(accounts[0], genesisRlpHeader, startBalance, ethash.address,  {
                from: accounts[0],
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,

            });

            const state = await staterelay.getState(accounts[0]);
            expect(state).to.be.equal("0x"+startBalance.toString('hex'));

            startBalance = await getAccountState(mainWeb3, accounts[0], GENESIS_BLOCK);
            
            const i = 94;
            const i_c = i + 6;
            let half = i_c / 2;
            let newBlockObject = await mainWeb3.eth.getBlock(GENESIS_BLOCK + i);
            const newBlock = createRLPHeader(newBlockObject);
            let intermediateBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + half));
            const confirmingBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + i_c));
            let upper;
            let ret = await staterelay.submitState(newBlock, confirmingBlock, intermediateBlock, startBalance, i_c, {
                from: accounts[0],
                gas:3000000,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });
            expectEvent.inLogs(ret.logs, "NewPendingState");

            ({ ret, half } = await challengerEvaluation(ret, mainWeb3, half, i_c, "NewPendingState")); 
            
            while (ret.logs[0].event !== "waitForEnd") {
                expectEvent.inLogs(ret.logs, "NewRequest");
                
                let notEncodedBlock = await mainWeb3.eth.getBlock(parseInt(half));
                intermediateBlock = createRLPHeader(notEncodedBlock);
                intermediateHash = mainWeb3.utils.toHex(keccak256(intermediateBlock));

                ret = await staterelay.sumbitterMessage(intermediateBlock, {
                    from: accounts[0],
                    gas:3000000,
                    maxFeePerGas: next_gas_price,

                    gasPrice: GAS_PRICE_IN_WEI
                });
                expectEvent.inLogs(ret.logs, "NewAnswer");

                // challenger retrieves its block from its chain...
                let trustedBlock = (await mainWeb3.eth.getBlock(parseInt(half))); 
                if (trustedBlock.hash == ret.logs[0].args.intermediateBlockHash) { // if the two blocks are the same ... 
                    // the problem should be afterwards...
                    let higherHash = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.upperLimitBlock.hash;
                    ret = await staterelay.challengerMessage(accounts[0], higherHash, {
                        from: accounts[1],
                        gas:3000000,
                        gasPrice: GAS_PRICE_IN_WEI,
                        maxFeePerGas: next_gas_price,

                    });
                } else { // otherwise, if they differ, the problem might be before..
                    let lowerHash = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.lowerLimitBlock.hash;
                    ret = await staterelay.challengerMessage(accounts[0], lowerHash, {
                        from: accounts[1],
                        gas:3000000,
                        gasPrice: GAS_PRICE_IN_WEI,
                        maxFeePerGas: next_gas_price,

                    });
                }
                
                half = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.midBlockNumber;
                lower = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.lowerLimitBlock.blockNumber;

                
            }  

            intermediateBlock = createRLPHeader(await mainWeb3.eth.getBlock(parseInt(half)));
            parentBlock = createRLPHeader(await mainWeb3.eth.getBlock(parseInt(lower)));

            const { DatasetLookUp, WitnessForLookup } = require(DATAPOWFILE);
            ret = await staterelay.verifyBlock(intermediateBlock, parentBlock, DatasetLookUp, WitnessForLookup, {
                from: accounts[0],
                gas:3000000,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });
            
            expectEvent.inLogs(ret.logs, 'DisputeWinner', {client: accounts[1], cancelledState: true});
            expectEvent.inLogs(ret.logs, 'PoWValidationResult', {returnCode: new BN(2)});
        });

        it('should correctly perform the challenge: the submitter lose, invalid nth block', async () => {
            const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
            const stake = new BN(1000000001);

            let startBalance = await getAccountState(mainWeb3, accounts[0], GENESIS_BLOCK);
            const genesisRlpHeader = createRLPHeader(genesisBlock);

            await staterelay.depositStake(stake, {from: accounts[0], value: stake,
                maxFeePerGas: next_gas_price,
            });
            await staterelay.depositStake(stake, {from: accounts[1], value: stake,
                maxFeePerGas: next_gas_price,
            });
   
            await staterelay.initState(accounts[0], genesisRlpHeader, startBalance, ethash.address, {
                from: accounts[0],
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,
            });

            const state = await staterelay.getState(accounts[0]);
            expect(state).to.be.equal("0x"+startBalance.toString('hex'));

            startBalance = await getAccountState(mainWeb3, accounts[0], GENESIS_BLOCK);
            
            const i = 4;
            const i_c = i + 6;
            let half = i_c / 2;
            let upper;
            let newBlockObject = await mainWeb3.eth.getBlock(GENESIS_BLOCK + i);
            let previousOne = await mainWeb3.eth.getBlock(GENESIS_BLOCK + i - 1);
            newBlockObject.stateRoot = previousOne.stateRoot;
            const newBlock = createRLPHeader(newBlockObject);
            let intermediateBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + half));
            const confirmingBlock = createRLPHeader(await mainWeb3.eth.getBlock(GENESIS_BLOCK + i_c));

            let ret = await staterelay.submitState(newBlock, confirmingBlock, intermediateBlock, startBalance, i_c, {
                from: accounts[0],
                gas:3000000,
                maxFeePerGas: next_gas_price,
                gasPrice: GAS_PRICE_IN_WEI
            });

            ({ ret, half } = await challengerEvaluation(ret, mainWeb3, half, i_c, "NewPendingState"));
            
            while (ret.logs[0].event !== "waitForEnd") {
                expectEvent.inLogs(ret.logs, "NewRequest");
                upper = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.upperLimitBlock.blockNumber;
                
                let notEncodedBlock = await mainWeb3.eth.getBlock(parseInt(ret.logs[0].args.midBlockNumber));
                intermediateBlock = createRLPHeader(notEncodedBlock);

                ret = await staterelay.sumbitterMessage(intermediateBlock, {
                    from: accounts[0],
                    maxFeePerGas: next_gas_price,
                    gas:3000000,
                    gasPrice: GAS_PRICE_IN_WEI
                });

                ({ ret, half } = await challengerEvaluation(ret, mainWeb3, half, upper, "NewAnswer"));
                
                half = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.midBlockNumber;

            }  
            expectEvent.inLogs(ret.logs, "waitForEnd");
            console.log(ret.logs[0].args.midBlockNumber);

            intermediateBlock = createRLPHeader(await mainWeb3.eth.getBlock(parseInt(ret.logs[0].args.midBlockNumber)));
            parentBlock = createRLPHeader(await mainWeb3.eth.getBlock(parseInt(ret.logs[0].args.midBlockNumber-1)));

            const { DatasetLookUp, WitnessForLookup } = require(DATAPOWFILE);
            ret = await staterelay.verifyBlock(intermediateBlock, parentBlock, DatasetLookUp, WitnessForLookup, {
                from: accounts[0],
                gas:3000000,
                gasPrice: GAS_PRICE_IN_WEI
            });
            
            expectEvent.inLogs(ret.logs, 'DisputeWinner', {client: accounts[1], cancelledState: true});
        });

    });

    const getAccountState = async (rpc, accountAddr, blockNumber) => {
        let proof = await rpc.eth.getProof(accountAddr, [], blockNumber);
        if (proof == undefined) return RLP.decode()
        let temp = RLP.decode((proof.accountProof)[proof.accountProof.length-1])
        return arrToBufArr(temp[1]);
    }

    const getAccountProof = async (rpc, accountAddr, blockNumber) => {
        let proof = await rpc.eth.getProof(accountAddr, [], blockNumber);
        console.log(proof)
        return createRLPNodeEncodeState(proof.accountProof);
    }

    const deserializeProof = (proof) =>{
        let final = [];
        for (let i = 0; i < proof.length; i++){
            final.push(RLP.decode(proof[i]));
        }

        return final;
    }

    const withdrawStake = async (stake, accountAddr) => {
        const submitTime = await time.latest();
        const increasedTime = submitTime.add(LOCK_PERIOD).add(time.duration.seconds(1));
        await time.increaseTo(increasedTime);  // unlock all blocks
        await staterelay.withdrawStake(stake, {from: accountAddr, gasPrice: GAS_PRICE_IN_WEI, 
            maxFeePerGas: next_gas_price,
        });
    };

    const createEthash = async (EPOCHFILE) => {
        ethash = await EthashOwner.new();

        const epochData = require(EPOCHFILE);

        await submitEpochData(ethash, EPOCH, epochData.FullSizeIn128Resolution, epochData.BranchDepth, epochData.MerkleNodes);
        return ethash;
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

    

    const challengerEvaluation = async (ret, mainWeb3, half, i_c, expectedEvent) => {
        expectEvent.inLogs(ret.logs, expectedEvent);

        if (ret.logs[0].args.intermediateBlockHash === await mainWeb3.eth.getBlock(GENESIS_BLOCK + half).hash && ret.logs[0].upperLimitBlockHash !== await mainWeb3.eth.getBlock(GENESIS_BLOCK + i_c).hash) {
            let upperLimitBlockHash = ret.logs[0].args.upperLimitBlockHash;
    
            ret = await staterelay.challengerMessage(accounts[0], upperLimitBlockHash, {
                from: accounts[1],
                maxFeePerGas: next_gas_price,
                gas: 3000000,
                gasPrice: GAS_PRICE_IN_WEI
            });
    
            half = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.midBlockNumber;
            let lower = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.lowerLimitBlock.blockNumber;
            let upper = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.upperLimitBlock.blockNumber;
            console.log(upper, half, lower, GENESIS_BLOCK);
        }
        else if (ret.logs[0].args.intermediateBlockHash !== await mainWeb3.eth.getBlock(GENESIS_BLOCK + half).hash) {
            let upperLimitBlockHash = ret.logs[0].args.intermediateBlockHash;
    
            ret = await staterelay.challengerMessage(accounts[0], upperLimitBlockHash, {
                from: accounts[1],
                gas: 3000000,
                gasPrice: GAS_PRICE_IN_WEI,
                maxFeePerGas: next_gas_price,

            });
    
            half = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.midBlockNumber;
            let lower = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.lowerLimitBlock.blockNumber;
            let upper = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.upperLimitBlock.blockNumber;
            console.log(upper, half, lower, GENESIS_BLOCK);
        } else {
            let upperLimitBlockHash = ret.logs[0].args._blockNhash;
    
            ret = await staterelay.challengerMessage(accounts[0], upperLimitBlockHash, {
                from: accounts[1],
                gas: 3000000,
                gasPrice: GAS_PRICE_IN_WEI
            });
    
            half = (await staterelay.getIdentity(BLOCKCHAIN_ID, accounts[0])).pendingState.midBlockNumber;
        }
        return { ret, half };
    }
    

});

