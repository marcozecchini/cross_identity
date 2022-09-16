const { EthereumDIDRegistry } = require('ethr-did-registry');
const DidRegistryContract = EthereumDIDRegistry;
const Web3 = require('web3');
const { asciiToHex, hexToAscii } = require( "web3-utils");
const { Resolver } = require('did-resolver');
const { getResolver } = require('ethr-did-resolver');
const { toBuffer } = require( "ethereumjs-util");

module.exports = function (HTTP_URL, secretKey) {
    let DidReg;
    const web3 = new Web3(new Web3.providers.HttpProvider(HTTP_URL));
    const accountFrom = web3.eth.accounts.privateKeyToAccount(secretKey);
    
    this.getAccount = () => {
      return accountFrom;
    }

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

  this.setDelegate = async function (account){
      const b32 = asciiToHex("did/pub/Ed25519/sigAuth/hex");
      const s = `${account.address}`
      const bvalue = toBuffer(s);
      const setAttribute = DidReg.methods.setAttribute(account.address, b32, bvalue, 30000000);
      let gas = await setAttribute.estimateGas({from: accountFrom.address})
      let receipt = await setAttribute.send({from: accountFrom.address, gas: Math.trunc(gas*(2.5))});
      return account.address;
  }

  this.setService = async function (account, nameService, valueService){
    const b32 = asciiToHex(`did/svc/${nameService}`);
    const s = `${valueService}`
    const bvalue = toBuffer(asciiToHex(s));
    const setAttribute = DidReg.methods.setAttribute(account.address, b32, bvalue, 30000000);
    let gas = await setAttribute.estimateGas({from: accountFrom.address})
    let receipt = await setAttribute.send({from: accountFrom.address, gas: Math.trunc(gas*(2.5))});
    return account.address;
  }

  this.setAlias = async function (nameAlias, alias, verify=false, type=undefined) {

    // create the alias
    let b32 = asciiToHex("did/alsoKnownAs");
    let s = `{"${nameAlias}": "${alias}"}`
    let bvalue = toBuffer(asciiToHex(s));
    let setAttribute = DidReg.methods.setAttribute(accountFrom.address, b32, bvalue, 30000000);
    let gas = await setAttribute.estimateGas({from: accountFrom.address})
    let receipt = await setAttribute.send({from: accountFrom.address, gas: Math.trunc(gas*(2.5))});
    
    if (verify) {
      b32 = asciiToHex('did/verificationMethod');
      let dic = { id: `did:ethr:development:${accountFrom.address}#${nameAlias}`, controller: `did:ethr:development:${accountFrom.address}`}
      s = JSON.stringify(dic);
      bvalue = toBuffer(asciiToHex(s));
      setAttribute = DidReg.methods.setAttribute(accountFrom.address, b32, bvalue, 30000000);
      gas = await setAttribute.estimateGas({from: accountFrom.address})
      receipt = await setAttribute.send({from: accountFrom.address, gas: Math.trunc(gas*(2.5))});
    }

    return accountFrom.address;
    
  }

  this.readDID = async function (accountFrom) {
    const providerConfig = { 
      networks: [
        { name: "development", rpcUrl: "http://localhost:8545", registry: DidReg.options.address },
      ]
      };
    const etherDidResolver = getResolver(providerConfig)
    const didResolver = new Resolver(etherDidResolver);

    const didDocument = await didResolver.resolve(`did:ethr:development:${accountFrom.address}`);
    delete Object.assign(didDocument, {['verificationMethod']: didDocument['publicKey'] })['publicKey'];

    // didDocument['verificationMethod'] = didDocument['verificationMethod'].slice(1);
    let additionalVer;
    let result; 
    result = await readAlias(`${accountFrom.address}`);
    console.log(await readAlias(`${accountFrom.address}`));
    didDocument['alsoKnownAs'] = result[0];
    additionalVer = result[1];
    for (let i in additionalVer) didDocument['verificationMethod'].push(additionalVer[i]);
    return didDocument;
  }

  async function readAlias(address) {
    let resultEvent = await DidReg.getPastEvents("DIDAttributeChanged", {
      fromBlock: 0,
      toBlock: 'latest'
    });
    console.log(resultEvent.length);
    let finalResultAlias = [];
    let finalResultVer = []
    for (let i = 0; i <= resultEvent.length - 1; i++) {
      let name = hexToAscii(resultEvent[i].returnValues.name).split('/')[1];
      let value = hexToAscii(resultEvent[i].returnValues.value);
      if ( address == resultEvent[i].returnValues.identity 
            && ((Date.now() / 1000) < parseInt(resultEvent[i].returnValues.validTo))) 
            if (name.includes('alsoKnownAs')) {
                finalResultAlias.push(JSON.parse(value));
                console.log('tick')
            } else if (name.includes('verificationMethod')) {
              finalResultVer.push(JSON.parse(value))
            }
    }
    return [finalResultAlias, finalResultVer];
  }
}