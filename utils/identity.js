const { EthereumDIDRegistry } = require('ethr-did-registry');
const DidRegistryContract = EthereumDIDRegistry;
const Web3 = require('web3');
const { asciiToHex, hexToAscii } = require( "web3-utils");
const { Resolver } = require('did-resolver');
const { getResolver } = require('ethr-did-resolver');
const { toBuffer } = require( "ethereumjs-util");

module.exports = function (HTTP_URL, secretKey, abi, bytecode) {
    let DidReg;
    const web3 = new Web3(new Web3.providers.HttpProvider(HTTP_URL));
    const accountFrom = web3.eth.accounts.privateKeyToAccount(secretKey);
    
    this.getAccount = () => {
      return accountFrom;
    }

    this.initRegistry = async function(abi=undefined, bytecode=undefined, DIDRegAddress=undefined) {
        bytecode = bytecode === undefined? DidRegistryContract.bytecode : bytecode;

        if (DIDRegAddress === undefined) {
          DidReg = abi === undefined? new web3.eth.Contract(DidRegistryContract.abi): new web3.eth.Contract(abi) ;

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
          // console.log(`Contract deployed at address: ${createReceipt.contractAddress}`);

          DidReg =  abi === undefined? new web3.eth.Contract(DidRegistryContract.abi, createReceipt.contractAddress): new web3.eth.Contract(abi, createReceipt.contractAddress);
          return createReceipt.contractAddress;
        }

        DidReg = abi === undefined? new web3.eth.Contract(DidRegistryContract.abi, DIDRegAddress): new web3.eth.Contract(abi, DIDRegAddress) ;
        return DIDRegAddress;        

    }

  this.setContractOwner = async function (contractAddress) {
    const changeOwner = DidReg.methods.changeOwner(accountFrom.address, contractAddress);
    let gas = await changeOwner.estimateGas({from: accountFrom.address});
    let receipt = await changeOwner.send({from: accountFrom.address, gas: Math.trunc(gas*(2.5))});
    console.log()
    return receipt.transactionHash;
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

  this.createAlias = function (nameAlias, alias, verificationMethod) {
    return createAlias(nameAlias, alias, verificationMethod);
  }

  this.setAlias = async function (nameAlias, alias, verificationMethod=undefined) {
    let returnedTx = []
    // create the alias
    let r = createAlias(nameAlias, alias, verificationMethod);
    
    let setAttribute = DidReg.methods.setAttribute(accountFrom.address, r[0],r[1], 30000000);
    let gas = await setAttribute.estimateGas({from: accountFrom.address})
    let receipt = await setAttribute.send({from: accountFrom.address, gas: Math.trunc(gas*(2.5))});
    returnedTx.push({tx: receipt.transactionHash, block: receipt.blockNumber})

    return returnedTx;
    
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
    didDocument['alsoKnownAs'] = result[0];
    additionalVer = result[1];
    for (let i in additionalVer) didDocument['verificationMethod'].push(additionalVer[i]);
    return didDocument;
  }

  function createAlias(nameAlias, alias, verificationMethod) {
    let b32 = "did/alsoKnownAs"; // asciiToHex("did/alsoKnownAs");
    let s = (verificationMethod !== undefined ? { nameAlias: nameAlias, _alias: verificationMethod[1], _type: Buffer.from(verificationMethod[0]) } : { typeAlias: nameAlias, _alias: alias })
    let bvalue = s // toBuffer(asciiToHex(s));
    return [b32, bvalue];
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
      if ( address === resultEvent[i].returnValues.identity
            && ((Date.now() / 1000) < parseInt(resultEvent[i].returnValues.validTo))) 
            if (name.includes('alsoKnownAs')) {
              console.log(name, value);
                finalResultAlias.push(JSON.parse(value));
            }
          }
    return [finalResultAlias, finalResultVer];
  }
}