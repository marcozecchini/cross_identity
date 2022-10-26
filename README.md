# Building a Cross-Chain Identity: a Self-Sovereign Identity-based Framework

Prototypical implementation of the smart contracts and a Javascript library for the realization of a Cross-Chain Identity Framework.
The prototype is Proof-of-Concept, and it allows to bind identities belonging to different Ethereum-based blockchains in compliance with W3C [Decentralized Identifier](https://w3c.github.io/did-core/) standard.

The repository contains also the PoC of the StateRelay and the MerkleRelay which are two optimizations of blockchain relays.

## Prerequisites

You need to have the following software installed:

* [Node.js](https://nodejs.org/) (version >= 15.4.0)
* [Truffle](https://www.trufflesuite.com/truffle) (version >= 5.5.30)
* [Ganache](https://www.trufflesuite.com/ganache) (version >= 6.12.2)
* [Solidity](https://docs.soliditylang.org/en/latest/installing-solidity.html) (^0.8.0)

## Installation

### Smart Contract Deployment

1. Change into the contract directory: `cd cross_identity/`
2. Install all dependencies: `npm install`
3. Run a local Ethereum blockchain (Ganache).
4. Deploy contracts: `truffle migrate --reset`

## Cost Analysis

The project includes a test suite that also measure the gas consumption of every operation discussed in the paper. 

To execute the test about the Cross-Chain Identity Framework: 
1. Run a local Ethereum blockchain (Ganache).
2. Run `truffle test test/Identity.test.js`

To execute the test about the StateRelay:
1. Run a local Ethereum blockchain (Ganache).
2. Run `truffle test test/StateRelay.test.js`

To execute the test about the MerkleRelay:
1. Run a local Ethereum blockchain (Ganache).
2. Run `truffle test test/MerkleRelay.test.js`

## Contributing

This is a research prototype. We welcome anyone to contribute. File a bug report or submit feature requests through the issue tracker. If you want to contribute feel free to submit a pull request.

## License

This project is licensed under the [MIT License](LICENSE).