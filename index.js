const Identity = require('./utils/identity');
const { secretKey } = require( './secrets.json');
const { INFURA_TESTNET_ENDPOINT, INFURA_MAINNET_ENDPOINT } = require( "./constant");
const identity = new Identity('http://127.0.0.1:8545', secretKey);


async function main() {
    const account = identity.getAccount();
    await identity.initRegistry();
    // await identity.setDelegate(account);
    await identity.setAlias("website1", "https://myblog.blogging-host.example/home");
    let obj = {type: "Secp256k1VerificationKey2018", ethereumAddress: account.address}
    await identity.setAlias("website2", "http://example.com", JSON.stringify(obj) );

    let r = identity.createAlias("website2", "http://example.com", JSON.stringify(obj))
    let b32 = r[0];
    let bvalue = r[1];

    let DIDocument = await identity.readDID(account);
    console.log(JSON.stringify(DIDocument));

}

main();