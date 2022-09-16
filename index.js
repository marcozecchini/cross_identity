const Identity = require('./utils/identity');
const { secretKey } = require( './secrets.json');
const { INFURA_TESTNET_ENDPOINT, INFURA_MAINNET_ENDPOINT } = require( "./constant");
const identity = new Identity('http://127.0.0.1:8545', secretKey);


async function main() {
    
    await identity.initRegistry();
    // let address = await identity.createDelegate();
    await identity.setAlias("https://myblog.blogging-host.example/home");
    await identity.setAlias("http://example.com");
    console.log(await identity.readDID(Identity.accountFrom));

}

main();