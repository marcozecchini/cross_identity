const Identity = require('./utils/identity');
const identity = new Identity('http://127.0.0.1:8545');

async function main() {
    
    await identity.initRegistry();
    let address = await identity.createDID();
    await identity.setAlias("https://myblog.blogging-host.example/home");
    await identity.setAlias("prova"); // TODO dovrebbero esserci entrambi
    console.log(await identity.readDID(address));

}

main();