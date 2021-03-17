/**
 * Perform a front-running attack on uniswap
*/

var Web3 = require('web3');
var abiDecoder = require('abi-decoder');
var colors = require("colors");
var Tx = require('ethereumjs-tx').Transaction;
var axios = require('axios');

const {UNISWAP_ROUTER_ADDRESS, UNISWAP_FACTORY_ADDRESS, UNISWAP_ROUTER_ABI, UNISWAP_FACTORY_ABI, UNISWAP_POOL_ABI, HTTP_PROVIDER_LINK, WEBSOCKET_PROVIDER_LINK} = require('./constants.js');

//mainnet
const INPUT_TOKEN_ADDRESS = '0x0';
const WETH_TOKEN_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const OUT_TOKEN_ADDRESS = '0x6b175474e89094c44da98b954eedeac495271d0f'; 
const INPUT_TOKEN_ABI_REQ = 'https://api.etherscan.io/api?module=contract&action=getabi&address='+INPUT_TOKEN_ADDRESS+'&apikey=33Y681VVRYXX7J2XCRX3CYYUSWPQ6EPQ9K';
const OUT_TOKEN_ABI_REQ = 'https://api.etherscan.io/api?module=contract&action=getabi&address='+OUT_TOKEN_ADDRESS+'&apikey=33Y681VVRYXX7J2XCRX3CYYUSWPQ6EPQ9K';


//ropsten
//const INPUT_TOKEN_ADDRESS = '0xc778417E063141139Fce010982780140Aa0cD5Ab';
//const WETH_TOKEN_ADDRESS = '0xc778417E063141139Fce010982780140Aa0cD5Ab';
//const OUT_TOKEN_ADDRESS = '0xad6d458402f60fd3bd25163575031acdce07538d';
//var INPUT_TOKEN_ABI_REQ = 'https://api-ropsten.etherscan.io/api?module=contract&action=getabi&address='+INPUT_TOKEN_ADDRESS+'&apikey=33Y681VVRYXX7J2XCRX3CYYUSWPQ6EPQ9K';
//var OUT_TOKEN_ABI_REQ = 'https://api-ropsten.etherscan.io/api?module=contract&action=getabi&address='+OUT_TOKEN_ADDRESS+'&apikey=33Y681VVRYXX7J2XCRX3CYYUSWPQ6EPQ9K';


var eth_info;
var input_token_info;
var out_token_info;
var pool_volumn;
var gas_price_info;
var attack_info = {'min_eth_balance': 300000000000000000, 'max_gas_price': 500000000000, 'attack_price_percent': 5};

const web3 = new Web3(new Web3.providers.HttpProvider(HTTP_PROVIDER_LINK));
const web3Ws = new Web3(new Web3.providers.WebsocketProvider(WEBSOCKET_PROVIDER_LINK));
const uniswapRouter = new web3.eth.Contract(UNISWAP_ROUTER_ABI, UNISWAP_ROUTER_ADDRESS);
const uniswapFactory = new web3.eth.Contract(UNISWAP_FACTORY_ABI, UNISWAP_FACTORY_ADDRESS);
abiDecoder.addABI(UNISWAP_ROUTER_ABI);

const private_key = '0x2fbe7ef840a21d17c440d625af31df1fe9dee28cb133a330075e575a81d65cd9';
const user_wallet = web3.eth.accounts.privateKeyToAccount(private_key);

var succeed = false;
var subscription;

async function main() {
    
    var ret = await preparedAttack(INPUT_TOKEN_ADDRESS, OUT_TOKEN_ADDRESS);
    if(ret == false)
        return;
   
    ret = await getPoolInfo(WETH_TOKEN_ADDRESS, OUT_TOKEN_ADDRESS);
    if(ret == false)
        return;

    gas_price_info = await getCurrentGasPrices();

    log_str = '***** Tracking more ' + (pool_volumn.attack_volumn/(10**eth_info.decimals)).toFixed(5) + '  ' +  eth_info.symbol + '  Exchange on Uniswap *****'
    console.log(log_str.green);


    // get pending transactions
    subscription = web3Ws.eth.subscribe('pendingTransactions', function (error, result) {
    }).on("data", async function (transactionHash) {
        let transaction = await web3.eth.getTransaction(transactionHash);
        if (transaction != null && transaction['to'] == UNISWAP_ROUTER_ADDRESS)
        {
           await handleTransaction(transaction);
        }
        
        /*
        if (succeed) {
            console.log("INSUFFICIENT ETH !!!");
            console.log("INSUFFICIENT USDT !!!");

            process.exit();
            /*
            console.log("Front-running attack succeed.");
            // sell tokens
            let tokenBalanceAfter = await getTokenBalance(OUT_TOKEN_ADDRESS);
            let srcAmount = (tokenBalanceAfter - tokenBalanceBefore) / (10 ** swap_token_decimals);
            console.log("Get " + srcAmount + " Tokens.");
            console.log("Begin selling the tokens.");
            //await performTrade(OUT_TOKEN_ADDRESS, INPUT_TOKEN_ADDRESS, srcAmount);
            console.log("End.")
            process.exit();
        }*/
    })
}


async function handleTransaction(transaction) {
    
    let is_pending = await isPending(transaction['hash']);
    if(!is_pending)
        return;
    
    // let estimatedGas = estimateGas(0.5, '0x6E7bE797DE52cEA969130c028aD168844C4C5Bb5');
    // let gasFee = (estimatedGas * gasPrices.medium) / 1000000000;

    // let newGasPrice = gasPrice + 100*one_gwei;
    // if (newGasPrice > max_gas_price) {
    //     newGasPrice = max_gas_price;
    // }
    //console.log('front-running gasPrice: ', gasPrice, newGasPrice);

    
    if (triggersFrontRun(transaction)) {
        subscription.unsubscribe();
        console.log('Perform front running attack...');
        console.log('attacking Gas Price: ', newGasPrice);

        //await performTrade(INPUT_TOKEN_ADDRESS, OUT_TOKEN_ADDRESS, eth_amount, newGasPrice);
        // wait until the honest transaction is done
        console.log("wait until the honest transaction is done...");
        while (await isPending(transaction['hash'])) {
            //console.log("transaction: ", transaction);
            //swap();
        }
        succeed = true;
    }
}


//select attacking transaction
function triggersFrontRun(transaction) {
    if (transaction['to'] != UNISWAP_ROUTER_ADDRESS) {
        return false
    }

    let data = parseTx(transaction['input']);
    let method = data[0];
    let params = data[1];
    let gasPrice = parseInt(transaction['gasPrice']) / 10**9;

    if(method == 'swapExactETHForTokens')
    {
        let in_amount = transaction.value;
        let out_min = params[0].value;

        let path = params[1].value;
        let in_token_addr = path[0];
        let out_token_addr = path[path.length-1];
        
        let recept_addr = params[2].value;
        let deadline = params[3].value;


        let log_str = transaction['hash'] +'\t' + gasPrice.toFixed(2) + '\tGWEI\t\t' + (in_amount/(10**eth_info.decimals)).toFixed(3) + '\t' + eth_info.symbol 
        console.log(log_str.yellow);
    }
    else if (method == 'swapETHForExactTokens'){
        
        let in_max = transaction.value;
        let out_amount = params[0].value;

        let path = params[1].value;
        let src_token_addr = path[0];
        let swap_token_addr = path[path.length-1];
        
        let recept_addr = params[2].value;
        let deadline = params[3].value;

        let log_str = transaction['hash'] +'\t' + gasPrice.toFixed(2) + '\tGWEI\t\t' + (in_max/(10**eth_info.decimals)).toFixed(3) + '\t' + eth_info.symbol + '(max)' 
        console.log(log_str.blue);

    }
    else if(method == 'swapExactTokensForETH' /*|| method == 'swapExactTokensForTokens'*/)
    {
        
        let in_amount = params[0].value;
        let out_min = params[1].value;
        
        let path = params[2].value;
        let in_token_addr = path[0];
        let out_token_addr = path[path.length-1];

        let recept_addr = params[3].value;
        let dead_line = params[4].value;

        let log_str = transaction['hash'] +'\t' + gasPrice.toFixed(2) + '\tGWEI\t\t' + (out_min/(10**eth_info.decimals)).toFixed(3) + '\t' + eth_info.symbol + '(min amount)' 
        console.log(log_str.magenta);
    }
    else if(method == 'swapTokensForExactETH'/*|| method == 'swapTokensForExactTokens'*/)
    {
        let out_amount = params[0].value;
        let in_max = params[1].value;
        
        let path = params[2].value;
        let in_token_addr = path[0];
        let out_token_addr = path[path.length-1];

        let recept_addr = params[3].value;
        let dead_line = params[4].value;

        let log_str = transaction['hash'] +'\t' + gasPrice.toFixed(2) + '\tGWEI\t\t' + (out_amount/(10**eth_info.decimals)).toFixed(3) + '\t' + eth_info.symbol + '(exact amount)' 
        console.log(log_str.cyan);
    }

    return false
}

/*
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
        gas_price
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
    tx.sign(private_key);
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

async function estimateGas(amount, receiverAddress){
    
    var estimatedGas = await web3.eth.estimateGas({
            //"value": '0x0', // Only tokens
            "data": uniswapRouter.methods.transfer(receiverAddress, amount*(10**6)).encodeABI(),
            //"from": walletERC20Address,
            "to": receiverAddress
        });
    estimatedGas += 49042;


   console.log({
        estimatedGas: estimatedGas
    });

   return estimatedGas;
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

    var swap = uniswapRouter.methods.swapExactETHForTokens(web3.utils.toBN(20).toString(), [INPUT_TOKEN_ADDRESS, OUT_TOKEN_ADDRESS], from.address, deadline);
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
}*/

main();

function parseTx(input) {
    if (input == '0x') {
        return ['0x', []]
    }

    let decodedData = abiDecoder.decodeMethod(input);
    
    let method = decodedData['name'];
    let params = decodedData['params'];

    return [method, params]
}

async function getCurrentGasPrices() {

  var response = await axios.get('https://ethgasstation.info/json/ethgasAPI.json')
  var prices = {
    low: response.data.safeLow / 10,
    medium: response.data.average / 10,
    high: response.data.fast / 10
  }

  var log_str = '***** gas price information *****'
  console.log(log_str.green);
  var log_str = 'High: ' + prices.high + '        medium: ' + prices.medium + '        low: ' + prices.low;
  console.log(log_str);

  return prices;
}

async function isPending(transactionHash) {
    return await web3.eth.getTransactionReceipt(transactionHash) == null;
}

async function getPoolInfo(input_token_address, out_token_address){

    var log_str = '*****  ' + input_token_info.symbol + '-' + out_token_info.symbol + ' Pair Pool Info  *****'
    console.log(log_str.green);

    var pool_address = await uniswapFactory.methods.getPair(input_token_address, out_token_address).call();
    var log_str = 'Address: ' + pool_address;
    console.log(log_str.white);    

    var pool_contract = new web3.eth.Contract(UNISWAP_POOL_ABI, pool_address);
    var reserves = await pool_contract.methods.getReserves().call();

    var eth_balance = reserves[0];
    var token_balance = reserves[1];

    var log_str = (eth_balance/(10**input_token_info.decimals)).toFixed(5) + '   ' + input_token_info.symbol;
    console.log(log_str.white);

    var log_str = (token_balance/(10**out_token_info.decimals)).toFixed(5) + '   ' + out_token_info.symbol;
    console.log(log_str.white);

    var attack_amount = eth_balance*5/100;

    pool_volumn = {'eth_token_volumn': eth_balance, 'swap_token_volumn': token_balance, 'attack_volumn': attack_amount}

    log_str = '=================== Prepared to attack '+ eth_info.symbol + '-'+ out_token_info.symbol +' pair ==================='
    console.log(log_str.red);

    return true;
}

async function getEthInfo(){
    var balance = await web3.eth.getBalance(user_wallet.address)
    var decimals = 18;
    var symbol = 'ETH';

    return {'balance': balance, 'symbol': symbol, 'decimals': decimals}
}

async function getTokenInfo(tokenAddr, token_abi_ask) {
    //get token abi
    var response = await axios.get(token_abi_ask);
    var token_abi = response.data.result;

    //get token info
    const token_contract = new web3.eth.Contract(JSON.parse(token_abi), tokenAddr);
    var balance = await token_contract.methods.balanceOf(user_wallet.address).call();
    var decimals = await token_contract.methods.decimals().call();
    var symbol =  await token_contract.methods.symbol().call();

    return {'balance': balance, 'symbol': symbol, 'decimals': decimals, 'abi': token_abi}
}

async function preparedAttack(input_token_address, out_token_address)
{
    var log_str = '***** Your Wallet Balance *****'
    console.log(log_str.green);

    log_str = 'wallet address:\t' + user_wallet.address;
    console.log(log_str.white);    

    //eth balance
    eth_info = await getEthInfo();
    eth_balance = await web3.eth.getBalance(user_wallet.address)
    log_str = (eth_info.balance/(10**eth_info.decimals)).toFixed(5) + '  ' + eth_info.symbol;
    console.log(log_str.white);

    if(input_token_address == '0x0')
        input_token_info = eth_info;
    else
        input_token_info = await getTokenInfo(input_token_address, INPUT_TOKEN_ABI_REQ);
    log_str = 'input:\t'+(input_token_info.balance/(10**input_token_info.decimals)).toFixed(5) + '\t' + input_token_info.symbol;
    console.log(log_str);

    //out token balance
    out_token_info = await getTokenInfo(out_token_address, OUT_TOKEN_ABI_REQ);
    log_str = 'output:\t'+(out_token_info.balance/(10**out_token_info.decimals)).toFixed(5) + '\t' + out_token_info.symbol;
    console.log(log_str.white);

    //attack info
    attack_info.min_eth_balance = 0.3*(10**input_token_info.decimals);
    /*if(eth_info.balance <= attack_info.min_eth_balance){
        log_str = '!!!! INSUFFICIENT ETH BALANCE !!!!'
        console.log(log_str.yellow);

        log_str = 'Your wallet balance must be more 0.3 ETH'
        console.log(log_str.white);

        return false;    
    }*/

    return true;
}

