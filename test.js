import { EthrDID } from 'ethr-did'
import { Resolver } from 'did-resolver'
import { getResolver } from 'ethr-did-resolver'
import Web3 from 'web3';
import  secretKey from './secrets.json' assert {type: "json"};

let HTTP_URL = 'http://127.0.0.1:8545';
const web3 = new Web3(new Web3.providers.HttpProvider(HTTP_URL));
const keypair = EthrDID.createKeyPair('development')
console.log(keypair)
const ethrDid = new EthrDID({...keypair});
ethrDid.setAttribute("alsoKnownAs", "prov");

const providerConfig = { 
    networks: [
      { name: "development", rpcUrl: "http://localhost:8545"},
    ]
   };
const didResolver = new Resolver(getResolver(providerConfig));

const didDocument = (await didResolver.resolve(ethrDid.did)).didDocument;
console.log(didDocument);

