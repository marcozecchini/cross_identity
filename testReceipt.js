const { GetProof } = require('eth-proof');
const { Proof } = require('eth-object');
const Web3 = require('web3');
const RLP = require('rlp');

const web3 = new Web3(new Web3.providers.HttpProvider("https://mainnet.infura.io/v3/cb841a5c15f44c189ccf9d1d749ee1ec"));

const { asciiToHex, hexToAscii } = require( "web3-utils");
const { INFURA_TESTNET_ENDPOINT, INFURA_MAINNET_ENDPOINT } = require( "./constant");
const { arrToBufArr } = require('ethereumjs-util');

const getProof = new GetProof("https://mainnet.infura.io/v3/cb841a5c15f44c189ccf9d1d749ee1ec"); // usa infura
let certificateTxHash = "0xdc8d2e11a2c70e326c8d73880b38bce894380214785991f81a7e4d7b9afc7d1b"
const main = async () =>{
    const receiptAndMerkleProof = await getProof.receiptProof(certificateTxHash);
    
    console.log(receiptAndMerkleProof.receiptProof.toHex(),"\n========== RECEIPTPROOF ABOVE\n" , new Proof(receiptAndMerkleProof.receiptProof[receiptAndMerkleProof.receiptProof.length-1]).toHex(),"\n========== VALUE ABOVE\n" ,  receiptAndMerkleProof.txIndex, "\n========== TXINDEX ABOVE\n" );
}

main()