const { EthereumDIDRegistry } = require('ethr-did-registry');
const { secretKey } = require( '../secrets.json');
const DidRegistryContract = EthereumDIDRegistry;
const Web3 = require('web3');
const { asciiToHex, hexToAscii } = require( "web3-utils");
const { Resolver } = require('did-resolver');
const { getResolver } = require('ethr-did-resolver');
const { toBuffer } = require( "ethereumjs-util");


const { INFURA_TESTNET_ENDPOINT, INFURA_MAINNET_ENDPOINT } = require( "../constant");

module.exports = function (HTTP_URL) {
    let DidReg;
    const web3 = new Web3(new Web3.providers.HttpProvider(HTTP_URL));
    const accountFrom = web3.eth.accounts.privateKeyToAccount(secretKey);

    this.initRegistry = async function() {
        DidReg = new web3.eth.Contract(DidRegistryContract.abi);
        const bytecode = DidRegistryContract.bytecode;

        const deployTx = DidReg.deploy({
            data: bytecode,
        });

        const createTransaction = await web3.eth.accounts.signTransaction(
            {
              data: deployTx.encodeABI(),
              gas: await deployTx.estimateGas(),
            },
            accountFrom.privateKey
          );
        const createReceipt = await web3.eth.sendSignedTransaction(createTransaction.rawTransaction);
        console.log(`Contract deployed at address: ${createReceipt.contractAddress}`);

        DidReg = new web3.eth.Contract(DidRegistryContract.abi, createReceipt.contractAddress);
        return createReceipt.contractAddress;
    }

    this.createDID = async function (){

      const b32 = asciiToHex("did/pub/Ed25519/veriKey/hex");
      const s = `${accountFrom.address}`

      const bvalue = toBuffer(s);

      const setAttribute = DidReg.methods.setAttribute(accountFrom.address, b32, bvalue, 30000000);
      let gas = await setAttribute.estimateGas({from: accountFrom.address})
      let receipt = await setAttribute.send({from: accountFrom.address, gas: Math.trunc(gas*(2.5))});
      return accountFrom.address;
  }

  this.setAlias = async function (alias) {

    const b32 = asciiToHex("did/alsoKnownAs");

    const s = `${alias}`

    const bvalue = toBuffer(asciiToHex(s));

    const setAttribute = DidReg.methods.setAttribute(accountFrom.address, b32, bvalue, 30000000);
    let gas = await setAttribute.estimateGas({from: accountFrom.address})
    let receipt = await setAttribute.send({from: accountFrom.address, gas: Math.trunc(gas*(2.5))});

    return accountFrom.address;
    
  }

  this.readDID = async function () {
    const providerConfig = { 
      networks: [
        { name: "development", rpcUrl: "http://localhost:8545", registry: DidReg.options.address },
      ]
      };
    const etherDidResolver = getResolver(providerConfig)
    const didResolver = new Resolver(etherDidResolver);

    const didDocument = await didResolver.resolve(`did:ethr:development:${accountFrom.address}`);
    delete Object.assign(didDocument, {['verificationMethod']: didDocument['publicKey'] })['publicKey'];
    didDocument['verificationMethod'] = didDocument['verificationMethod'].slice(1);
    didDocument['alsoKnownAs'] = await readAlias(`${accountFrom.address}`);
    return didDocument;
  }

  async function readAlias(address) {
    let resultEvent = await DidReg.getPastEvents("DIDAttributeChanged");
    console.log(resultEvent.length);
    let finalResult = [];
    for (let i = 0; i <= resultEvent.length - 1; i++) {
      // let partialResult = {};
      let name = hexToAscii(resultEvent[i].returnValues.name).split('/')[1];
      let value = hexToAscii(resultEvent[i].returnValues.value);
      if ( address == resultEvent[i].returnValues.identity 
            && ((Date.now() / 1000) < parseInt(resultEvent[i].returnValues.validTo)) 
              && name.includes('alsoKnownAs')
            ) {
                finalResult.push(value);
            }
    }
    return finalResult;
  }
}