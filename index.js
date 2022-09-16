const Identity = require('./utils/identity');
const { secretKey } = require( './secrets.json');
const { INFURA_TESTNET_ENDPOINT, INFURA_MAINNET_ENDPOINT } = require( "./constant");
const identity = new Identity('http://127.0.0.1:8545', secretKey);


async function main() {
    const account = identity.getAccount();
    await identity.initRegistry();
    // await identity.setDelegate(account);
    await identity.setAlias("website1", "https://myblog.blogging-host.example/home");
    await identity.setAlias("website2", "http://example.com", true);
    console.log(await identity.readDID(account));

}

main();