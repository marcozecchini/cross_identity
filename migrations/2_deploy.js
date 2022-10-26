const Web3 = require("web3");
const {createRLPHeader} = require("../utils/utils");
const {deploy} = require("truffle/build/9877.bundled");

const ccIdentityContract = artifacts.require('./ccIdentityContract');
const DIDRegistry = artifacts.require('./EthereumDIDRegistry');
const Ethrelay = artifacts.require('./Ethrelay');
const Ethash = artifacts.require('./Ethash');
const ECDSAVerifierV2 = artifacts.require('./ECDSAVerifierV2');

const GENESIS_BLOCK = 12814531;
const registryAddr = "";

module.exports = async function (deployer) {
    let mainWeb3 = new Web3("https://mainnet.infura.io/v3/cb841a5c15f44c189ccf9d1d749ee1ec");
    const genesisBlock = await mainWeb3.eth.getBlock(GENESIS_BLOCK);
    const genesisRlpHeader = createRLPHeader(genesisBlock);

    let registry = registryAddr !== ""? deployer.link(DIDRegistry, registryAddr) : await deployer.deploy(DIDRegistry);
    let ethash = await  deployer.deploy(Ethash);
    let signatureVerifier = await deployer.deploy(ECDSAVerifierV2);
    let ethrelay = await deployer.deploy(Ethrelay, genesisRlpHeader, genesisBlock.totalDifficulty, ethash.address);

    let ccIdentity = await deployer.deploy(ccIdentityContract, registry.address, ethrelay.address);
};