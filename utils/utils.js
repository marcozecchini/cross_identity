const RLP = require('rlp');
const Web3 = require('web3');
const BigNumber = require('bignumber.js');
const { arrToBufArr, bufArrToArr } = require('ethereumjs-util');

const calculateBlockHash = (block) => {
    return Web3.utils.keccak256(createRLPHeader(block));
};

const addToHex = (hexString, number) => {
  return Web3.utils.toHex((new BigNumber(hexString).plus(number)));
};

const createRLPHeader = (block) => {
    return arrToBufArr(RLP.encode([
        block.parentHash,
        block.sha3Uncles,
        block.miner,
        block.stateRoot,
        block.transactionsRoot,
        block.receiptsRoot,
        block.logsBloom,
        BigInt(block.difficulty != undefined? block.difficulty: 0 ),
        BigInt(block.number != undefined? block.number: 0),
        block.gasLimit,
        block.gasUsed,
        block.timestamp,
        block.extraData,
        block.mixHash,
        block.nonce,
        block.baseFeePerGas,
    ]));
};

const createRLPNodeEncodeState = (proof) => {
    
    return arrToBufArr(RLP.encode(proof));
}

function str2ab(str) {
    var buf = new ArrayBuffer(str.length * 2); // 2 bytes for each char
    var bufView = new Uint16Array(buf);
    for (var i = 0, strLen = str.length; i < strLen; i++) {
      bufView[i] = str.charCodeAt(i);
    }
    return buf;
  }

const createRLPValueState = (value) => {
    return arrToBufArr(RLP.encode(value));
}

module.exports = {
    calculateBlockHash,
    createRLPValueState,
    createRLPHeader,
    addToHex,
    createRLPNodeEncodeState,
};