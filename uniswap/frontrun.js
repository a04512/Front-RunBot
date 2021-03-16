/**
 * Perform a front-running attack on uniswap
*/

var Web3 = require('web3');
var fetch = require('node-fetch');
var abiDecoder = require('abi-decoder');
var colors = require("colors");
var Tx = require('ethereumjs-tx').Transaction;

const {UNISWAP_ROUTER_ABI, UNISWAP_FACTORY_ABI, UNISWAP_POOL_ABI} = require('./constants.js');

const NETWORK = "ropsten";
const PROJECT_ID = "74630dcc68764c919434c0c6fecbad55";//"75ab6c9da83d44979791ac90964c144c";
const web3 = new Web3(new Web3.providers.HttpProvider(`https://${NETWORK}.infura.io/v3/${PROJECT_ID}`));
const NETWORK_URL = `https://${NETWORK}-api.kyber.network`;

//uniswap router
const UNISWAP_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
const UNISWAP_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';

// Get the UniswapV2Router02 Contract instances
const USWAP_ROUTER_CONTRACT = new web3.eth.Contract(
    UNISWAP_ROUTER_ABI,
    UNISWAP_ROUTER
);

const USWAP_FACTORY_CONTRACT = new web3.eth.Contract(
    UNISWAP_FACTORY_ABI,
    UNISWAP_FACTORY
);

//add abi
abiDecoder.addABI(UNISWAP_ROUTER_ABI);

// Representation of ETH as an address on Ropsten
//const ETH_TOKEN_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const ETH_TOKEN_ADDRESS = '0xc778417E063141139Fce010982780140Aa0cD5Ab';
// KNC contract address on Ropsten
// const USDT_TOKEN_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USDT_TOKEN_ADDRESS = '0xaD6D458402F60fD3Bd25163575031ACDce07538D';

// method id
const TRADE_WITH_HINT = '0xfb3bdb41';
const TRADE = '0x7ff36ab5'; //swapExactETHForTokens

// wallet address for fee sharing program
const WALLET_ID = "0x0000000000000000000000000000000000000000"
const ETH_DECIMALS = 18;
const USDT_DECIMALS = 6;
// How many KNC you want to buy
const USDT_QTY = 200;
// How many ETH you want to sell
const ETH_QTY = 0.3;
const ETH_QTY_WEI = ETH_QTY * 10 ** ETH_DECIMALS;
// threshold to trigger front running attack
const THRESHOLD = 10;
// Gas price of the transaction
const GAS_PRICE = 'medium';
// one gwei
const ONE_GWEI = 1e9;
// max gas price
const MAX_GAS_PRICE = 500000000000;
// Your Ethereum wallet address
const USER_ACCOUNT = '0x6E7bE797DE52cEA969130c028aD168844C4C5Bb5';
// Your private key
const PRIVATE_KEY = Buffer.from('ENTER YOUR PRIVATE KEY', 'hex');
// if the front run has succeed
var succeed = false;

var subscription;

async function main() {
    
    console.log('=====================Ready ETH-USDT Attack====================='.green);

    // get token balance before
    let tokenBalanceBefore = await getTokenBalance(USDT_TOKEN_ADDRESS);
    let ethBalanceBefore = await getTokenBalance(ETH_TOKEN_ADDRESS);
    //const exchangeAddress = USWAP_FACTORY_CONTRACT.methods.getExchange(USDT_TOKEN_ADDRESS);
    //const tokenReserve = tokenContract.methods.balanceOf(exchangeAddress);
    //const ethReserve = web3.eth.getBalance(exchangeAddress);
    var pair = await USWAP_FACTORY_CONTRACT.methods.getPair(ETH_TOKEN_ADDRESS, USDT_TOKEN_ADDRESS).call();
    var pool = new web3.eth.Contract(UNISWAP_POOL_ABI, pair);
    var eth = await pool.methods.getReserves().call()._reserve0;
    var token = await pool.methods.getReserves().call()._reserve1;
    outputtoken = USWAP_ROUTER_CONTRACT.methods.quote(500, eth, token).call();

    console.log(pair, eth, token, outputtoken);

    //swap();

    console.log("ethReserve, tokenReserve : ", ethBalanceBefore, tokenBalanceBefore);

    // get pending transactions
    const web3Ws = new Web3(new Web3.providers.WebsocketProvider(`wss://${NETWORK}.infura.io/ws/v3/${PROJECT_ID}`));
    subscription = web3Ws.eth.subscribe('pendingTransactions', function (error, result) {
    }).on("data", async function (transactionHash) {
        let transaction = await web3.eth.getTransaction(transactionHash);
        if (transaction == null)
            return;

        await handleTransaction(transaction);

        if (succeed) {
            console.log("INSUFFICIENT ETH !!!");
            console.log("INSUFFICIENT USDT !!!");

            process.exit();
            /*
            console.log("Front-running attack succeed.");
            // sell tokens
            let tokenBalanceAfter = await getTokenBalance(USDT_TOKEN_ADDRESS);
            let srcAmount = (tokenBalanceAfter - tokenBalanceBefore) / (10 ** USDT_DECIMALS);
            console.log("Get " + srcAmount + " Tokens.");
            console.log("Begin selling the tokens.");
            //await performTrade(USDT_TOKEN_ADDRESS, ETH_TOKEN_ADDRESS, srcAmount);
            console.log("End.")
            process.exit();*/
        }
    })
}

async function handleTransaction(transaction) {
    if (transaction != null && transaction['to'] == UNISWAP_ROUTER && await isPending(transaction['hash'])) {
        console.log("pending uniswap transaction", transaction);
    } else {
        return;
    }

    let gasPrice = parseInt(transaction['gasPrice']) / 10**9;
    let newGasPrice = await getCurrentGasPrices(gasPrice);
    // let estimatedGas = estimateGas(0.5, '0x6E7bE797DE52cEA969130c028aD168844C4C5Bb5');
    // let gasFee = (estimatedGas * gasPrices.medium) / 1000000000;

    // let newGasPrice = gasPrice + 100*ONE_GWEI;
    // if (newGasPrice > MAX_GAS_PRICE) {
    //     newGasPrice = MAX_GAS_PRICE;
    // }
    console.log('front-running gasPrice: ', gasPrice, newGasPrice);

    if (triggersFrontRun(transaction)) {
        subscription.unsubscribe();
        console.log('Perform front running attack...');
        console.log('attacking Gas Price: ', newGasPrice);

        //await performTrade(ETH_TOKEN_ADDRESS, USDT_TOKEN_ADDRESS, ETH_QTY, newGasPrice);
        // wait until the honest transaction is done
        console.log("wait until the honest transaction is done...");
        while (await isPending(transaction['hash'])) {
            //console.log("transaction: ", transaction);
            //swap();
        }
        succeed = true;
    }
}

function triggersFrontRun(transaction) {
    if (transaction['to'] != UNISWAP_ROUTER) {
        return false
    }

    let data = parseTx(transaction['input']);
    let method = data[0];
    let params = data[1];

    console.log("method : ", method);

    if(method == 'swapExactETHForTokens' || method == 'swapETHForExactTokens')
    {
        let amount = params[0].value;
        let path = params[1].value;
        let src_token = path[0];
        let dst_token = path[1];
        
        if (dst_token != USDT_TOKEN_ADDRESS)
             return;

        console.log('==================================ETH vs USDT==============================================');
        console.log('TransactionHash: '.green, transaction.hash);
        console.log('Amount(ETH): '.red, transaction.value/(10**ETH_DECIMALS));
        if (transaction.value/(10**ETH_DECIMALS) < 0.3) {
            console.log("Ineffectual Attack!!! Continue Tracking...".red);
            return;
        }
        console.log('MinAmount(USDT): '.green, amount/(10**USDT_DECIMALS));
        console.log('ETH ADRESS: '.green, src_token);
        console.log('USDT ADRESS: '.green, dst_token);

        let to_address = params[2].value;
        console.log('Destination Wallet: '.red, to_address);
        let dead_line = params[3].value;
        console.log('DeadLine: '.green, dead_line);

        return true;

    }else if(method == 'swapExactTokensForETH' || method == 'swapExactTokensForTokens')
    {
        /*
        let amount_in = params[0].value;
        console.log('amount_in: ', amount_in);        
        let amount_out_min = params[1].value;
        console.log('amount_out_min: ', amount_out_min);        
        let path = params[2].value;
        console.log('path: ', path);
        let to_address = params[3].value;
        console.log('to_address: ', to_address);
        let dead_line = params[4].value;
        console.log('dead_line: ', dead_line);*/

    }else if(method == 'swapTokensForExactTokens' || method == 'swapTokensForExactETH')
    {
        /*
        let amount_out = params[0].value;
        console.log('amount_out: ', amount_out);  
        let amount_in_max = params[1].value;
        console.log('amount_in_max: ', amount_in_max);  
        let path = params[2].value;
        console.log('path: ', path);
        let to_address = params[3].value;
        console.log('to_address: ', to_address);
        let dead_line = params[4].value;
        console.log('dead_line: ', dead_line);*/
    }

    /*
    if (method == TRADE || method == TRADE_WITH_HINT) {
        let srcAddr = params[0], srcAmount = params[1], toAddr = params[2];
        console.log(params[0]);
        console.log(params[1]);
        console.log(params[2]);
        console.log(params[3]);
        //return (srcAddr == ETH_TOKEN_ADDRESS) && (toAddr == USDT_TOKEN_ADDRESS) && (srcAmount >= THRESHOLD)
    }*/
    return false
}

async function performTrade(srcAddr, destAddr, srcAmount, gasPrice = null) {
    console.log('Begin transaction...');

    let destAmount = await getQuoteAmount(srcAddr, destAddr, srcAmount);
    console.log(destAmount);
    let tradeDetailsRequest = await fetch(
        `${NETWORK_URL}/trade_data?user_address=` +
        USER_ACCOUNT +
        "&src_id=" +
        srcAddr +
        "&dst_id=" +
        destAddr +
        "&src_qty=" +
        srcAmount +
        "&min_dst_qty=" +
        destAmount +
        "&gas_price=" +
        GAS_PRICE
        // "&wallet_id=" +
        // WALLET_ID
    );
    let tradeDetails = await tradeDetailsRequest.json();
    // Extract the raw transaction details
    let rawTx = tradeDetails.data[0];
    if (gasPrice) {
        rawTx['gasPrice'] = '0x' + gasPrice.toString(16);
    }
    console.log("Planning to send: ", rawTx);
    // Create a new transaction
    let tx = new Tx(rawTx, { 'chain': 'ropsten' });
    // Signing the transaction
    tx.sign(PRIVATE_KEY);
    // Serialise the transaction (RLP encoding)
    let serializedTx = tx.serialize();
    // Broadcasting the transaction
    txReceipt = await web3.eth
        .sendSignedTransaction("0x" + serializedTx.toString("hex"))
        .catch(error => console.log(error));
    // Log the transaction receipt
    console.log("Transaction DONE! Receipt: ", txReceipt);
}

async function getQuoteAmount(srcToken, destToken, srcQty) {
    let quoteAmountRequest = await fetch(`${NETWORK_URL}/quote_amount?base=${srcToken}&quote=${destToken}&base_amount=${srcQty}&type=sell`)
    let quoteAmount = await quoteAmountRequest.json();
    quoteAmount = quoteAmount.data;
    return quoteAmount * 0.97;
}

async function isPending(transactionHash) {
    return await web3.eth.getTransactionReceipt(transactionHash) == null;
}

function parseTx(input) {
    if (input == '0x') {
        return ['0x', []]
    }

    let decodedData = abiDecoder.decodeMethod(input);
    
    let method = decodedData['name'];
    let params = decodedData['params'];

    return [method, params]
    /*
    if ((input.length - 8 - 2) % 64 != 0) {
        throw "Data size misaligned with parse request."
    }
    let method = input.substring(0, 10);
    let numParams = (input.length - 8 - 2) / 64;
    var params = [];
    for (i = 0; i < numParams; i += 1) {
        let param = parseInt(input.substring(10 + 64 * i, 10 + 64 * (i + 1)), 16);
        params.push(param);
    }
    return [method, params]*/
}

async function estimateGas(amount, receiverAddress){
    
    var estimatedGas = await web3.eth.estimateGas({
            //"value": '0x0', // Only tokens
            "data": USWAP_ROUTER_CONTRACT.methods.transfer(receiverAddress, amount*(10**6)).encodeABI(),
            //"from": walletERC20Address,
            "to": receiverAddress
        });
    estimatedGas += 49042;


   console.log({
        estimatedGas: estimatedGas
    });

   return estimatedGas;
}

async function getCurrentGasPrices(gasPrice) {

  var response = await axios.get('https://ethgasstation.info/json/ethgasAPI.json')
  var prices = {
    low: response.data.safeLow / 10,
    medium: response.data.average / 10,
    high: response.data.fast / 10
  }

  console.log("alex: current gas price ", prices);

  if(gasPrice >= prices.medium)
    return prices.high;
  else if(gasPrice < prices.medium)
    return prices.medium;
  return prices.medium;
}

async function swap() {
    // Get a wallet address from a private key
    var from = web3.eth.accounts.privateKeyToAccount('0x2fbe7ef840a21d17c440d625af31df1fe9dee28cb133a330075e575a81d65cd9');
    var deadline;

    //w3.eth.getBlock(w3.eth.blockNumber).timestamp
    await web3.eth.getBlock('latest', (error, block) => {
        deadline = block.timestamp + 300; // transaction expires in 300 seconds (5 minutes)    
    })

    console.log("deadline : ", typeof deadline, web3.utils.toHex(deadline));
    deadline = web3.utils.toHex(deadline);

    var swap = USWAP_ROUTER_CONTRACT.methods.swapExactETHForTokens(web3.utils.toBN(20).toString(), [ETH_TOKEN_ADDRESS, USDT_TOKEN_ADDRESS], from.address, deadline);
    var encodedABI = swap.encodeABI();

    var tx = {
        from: from.address,
        to: UNISWAP_ROUTER,
        gas: 200000,
        data: encodedABI,
        value: 5*10**16
      };

    var signedTx = await from.signTransaction(tx);

    web3.eth.sendSignedTransaction(signedTx.rawTransaction)
    .on('transactionHash', function(hash){
        console.log('swap : ', hash);
    })
    .on('confirmation', function(confirmationNumber, receipt){

    })
    .on('receipt', function(receipt){

    })
    .on('error', function(error, receipt) { // If the transaction was rejected by the network with a receipt, the second parameter will be the receipt.
        console.error("Error:", error, "Receipt:", receipt)
    });
}

main();


// for test only
async function test() {
    let token = await getTokenBalance(USDT_TOKEN_ADDRESS);
    console.log(token);
}

// test();
