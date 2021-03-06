import Config from 'react-native-config';
import EthereumJsWallet from 'ethereumjs-wallet';
import Web3 from 'web3';
import EthereumTx from 'ethereumjs-tx';
import ProviderEngine from 'web3-provider-engine';
import WalletSubprovider from 'web3-provider-engine/subproviders/wallet';
import ProviderSubprovider from 'web3-provider-engine/subproviders/provider';
import { store } from '../config/store';
import contractAbi from './XDCAbi';
import {
  ADD_TOKEN,
  SET_WALLET_ADDRESS,
  SET_PRIVATE_KEY,
} from '../config/actionTypes';
import AnalyticsUtils from './analytics';
import { erc20Abi } from './constants';

export default class WalletUtils {
  /**
   * Given an EthereumJSWallet instance, store both address and private key
   * in Redux store
   *
   * @param {Object} wallet
   */
  static storeWallet(wallet) {
    store.dispatch({
      type: SET_WALLET_ADDRESS,
      walletAddress: wallet.getAddressString(),
    });

    store.dispatch({
      type: SET_PRIVATE_KEY,
      privateKey: wallet.getPrivateKey().toString('hex'),
    });
  }

  /**
   * Generate an Ethereum wallet
   */
  static generateWallet() {
    const wallet = EthereumJsWallet.generate();

    AnalyticsUtils.trackEvent('Generate wallet', {
      walletAddress: wallet.getAddressString(),
    });

    this.storeWallet(wallet);
  }

  /**
   * Store a wallet in Redux store given a private key
   *
   * @param {String} privateKey
   */
  static restoreWallet(privateKey) {
    const wallet = EthereumJsWallet.fromPrivateKey(
      Buffer.from(privateKey, 'hex'),
    );

    AnalyticsUtils.trackEvent('Import wallet', {
      walletAddress: wallet.getAddressString(),
    });

    this.storeWallet(wallet);
  }

  /**
   * Reads an EthereumJSWallet instance from Redux store
   */
  static getWallet() {
    const { privateKey } = store.getState();

    return EthereumJsWallet.fromPrivateKey(Buffer.from(privateKey, 'hex'));
  }


  static getWeb3HTTPProvider() {
    switch (store.getState().network) {
      case 'ropsten':
        return new Web3.providers.HttpProvider(
          `https://ropsten.infura.io/${Config.INFURA_API_KEY}`,
        );
      case 'kovan':
        return new Web3.providers.HttpProvider(
          `https://kovan.infura.io/${Config.INFURA_API_KEY}`,
        );
      case 'rinkeby':
        return new Web3.providers.HttpProvider(
          `https://rinkeby.infura.io/${Config.INFURA_API_KEY}`,
        );
      default:
        return new Web3.providers.HttpProvider(
          "http://5.152.223.197:8545",
          // "https://ropsten.infura.io/v3/f060477f35da4c4b85e403b978b17d55"
        );
    }
  }

  static getEtherscanApiSubdomain() {
    switch (store.getState().network) {
      case 'ropsten':
        return 'api-ropsten';
      case 'kovan':
        return 'api-kovan';
      case 'rinkeby':
        return 'api-rinkeby';
      default:
        return 'ropsten';
    }
  }

  /**
   * Returns a web3 instance with the user's wallet
   */
  static getWeb3Instance() {
    const wallet = this.getWallet();

    const engine = new ProviderEngine();

    engine.addProvider(new WalletSubprovider(wallet, {}));
    engine.addProvider(new ProviderSubprovider(this.getWeb3HTTPProvider()));

    engine.start();

    const web3 = new Web3(engine);

    web3.eth.defaultAccount = wallet.getAddressString();

    return web3;
  }

  /**
   * Load the tokens the user owns
   */
  static loadTokensList() {
    const { availableTokens, network, walletAddress } = store.getState();

    if (network !== 'mainnet') return Promise.resolve();

    const availableTokensAddresses = availableTokens
      .filter(token => token.symbol !== 'XDC')
      .map(token => token.contractAddress);

    return fetch(
      `https://api.ethplorer.io/getAddressInfo/${walletAddress}?apiKey=freekey`,
    )
      .then(response => response.json())
      .then(data => {
        if (!data.tokens) {
          return Promise.resolve();
        }

        return data.tokens
          .filter(
            token =>
              !availableTokensAddresses.includes(token.tokenInfo.address),
          )
          .forEach(token => {
            store.dispatch({
              type: ADD_TOKEN,
              token: {
                contractAddress: token.tokenInfo.address,
                decimals: parseInt(token.tokenInfo.decimals, 10),
                name: token.tokenInfo.name,
                symbol: token.tokenInfo.symbol,
              },
            });
          });
      });
  }

  /**
   * Fetch a list of transactions for the user's wallet concerning the given token
   *
   * @param {Object} token
   */
  static getTransactions({ contractAddress, decimals, symbol }) {
    return this.getERC20Transactions(contractAddress, decimals);
  }

  /**
   * Fetch a list of a given token transactions for the user's wallet
   *
   * @param {String} contractAddress
   */
  static async getERC20Transactions(contractAddress, decimals) {
    const { walletAddress } = store.getState();

    return fetch(
      `https://${this.getEtherscanApiSubdomain()}.etherscan.io/api?module=account&action=tokentx&contractaddress=${contractAddress}&address=${walletAddress}&sort=desc&apikey=${
      Config.ETHERSCAN_API_KEY
      }`,
    )
      .then(response => response.json())
      .then(data => {
        console.log('transactions api::', data)
        if (data.message !== 'OK') {
          return [];
        }

        return data.result.map(t => ({
          from: t.from,
          to: t.to,
          timestamp: t.timeStamp,
          transactionHash: t.hash,
          value: (parseInt(t.value, 10) / Math.pow(10, decimals)).toFixed(2),
        }));
      });
  }


  

  /**
   * Get the user's wallet balance of a given token
   *
   * @param {Object} token
   */
  static getBalance({ contractAddress, symbol, decimals }) {
    if(symbol === 'MXDC') {
      return this.getEthBalance();
    } else {
      return this.getERC20Balance(contractAddress, decimals);
    }
  }

  static getEthBalance() {
    const { walletAddress } = store.getState();
    const web3 = new Web3(this.getWeb3HTTPProvider());
    return new Promise((resolve, reject) => {
      // get ether balance
      web3.eth.getBalance(walletAddress, function (e, weiBalance) {
        console.log('getbalance eth', weiBalance);
        console.log('getbalance ree', weiBalance / Math.pow(10, 18));
        if (e) {
          reject(e);
        }

        let balanceData = {};
        const balance = weiBalance / Math.pow(10, 18);
        let usdBalance = null;
        console.log('fetch started')
        fetch(`https://api.coinmarketcap.com/v2/ticker/1027/?convert=USD`)
          .then(res => res.json())
          .then(function (response) {
            console.log(response);
            usdBalance = response.data.quotes.USD.price * balance;
            balanceData = {
              'balance': balance,
              'usdBalance': usdBalance
            };
            console.log('balanceData:', balanceData);
            resolve(balanceData);
          })
          .catch(error => console.error('Error:', error));


        AnalyticsUtils.trackEvent('Get ETH balance', {
          balance,
        });
      });
    });
  }

  /**
   * Get the user's wallet ETH balance
   */
  static getERC20Balance(contractAddress, decimals) {

    const { walletAddress, privateKey } = store.getState();
    console.log('walletAddress', walletAddress)
    console.log('privateKey', privateKey)
    const web3 = new Web3(this.getWeb3HTTPProvider());



    return new Promise((resolve, reject) => {
      var MyContract = web3.eth.contract(contractAbi);
      

      var instancecontract = MyContract.at(contractAddress);
      instancecontract.balanceOf(walletAddress, function (error, weiBalance) {
        console.log('getbalance p', weiBalance);
        console.log('getbalance r', weiBalance / Math.pow(10, 18));
        if (error) {
          reject(error);
        }

        let balanceData = {};
        const balance = weiBalance / Math.pow(10, 18);
        let usdBalance = null;
        console.log('fetch started')
        fetch(`https://api.coinmarketcap.com/v2/ticker/2634/?convert=USD`)
          .then(res => res.json())
          .then(function (response) {
            console.log(response);
            usdBalance = response.data.quotes.USD.price * balance;
            balanceData = {
              'balance': balance,
              'usdBalance': usdBalance
            };
            console.log('balanceData:', balanceData);
            resolve(balanceData);
          })
          .catch(error => console.error('Error:', error));


        AnalyticsUtils.trackEvent('Get ETH balance', {
          balance,
        });
      });


    });
  }

  /**
   * Send a transaction from the user's wallet
   *
   * @param {Object} token
   * @param {String} toAddress
   * @param {String} amount
   */
  static sendTransaction(
    { contractAddress, symbol, decimals },
    toAddress,
    amount,
  ) {
    console.log(contractAddress, symbol, decimals, toAddress, amount)
    if(symbol==='MXDC'){
      return this.sendETHTransaction(toAddress,amount);
    }
    return this.sendERC20Transaction(contractAddress, decimals, toAddress, amount);
  }


  /**
   * Send an ERC20 transaction to the given address with the given amount
   *
   * @param {String} toAddress
   * @param {String} amount
   */
  static sendERC20Transaction(contractAddress, decimals, toAddress, amount) {
    const { walletAddress, privateKey } = store.getState();
    const web3 = this.getWeb3Instance();


    AnalyticsUtils.trackEvent('Send ERC20 transaction', {
      value: amount,
    });

    return new Promise((resolve, reject) => {

      web3.eth.getGasPrice(function (error, gasPrice) {
        console.log('zsdrmfgjmnbdxrjkgnjkdx', error, gasPrice/Math.pow(10,18));
        web3.eth.estimateGas({
          to: contractAddress,
          data: web3.eth.contract(contractAbi).
          at(contractAddress)
          .transfer.getData(toAddress, amount * Math.pow(10, decimals), { from: walletAddress })
        }, function (err, gasLimit) {
          console.log('err gas limit:', err)
          console.log('err gas limit:', gasLimit)
          web3.eth.getTransactionCount(walletAddress, function (error, data) {
            console.log('data:::', data);
            const txParams = {
              nonce: data,
              chainID: 3,
              gasPrice: "0x170cdc1e00",
              // gasLimit: "0x05c30a",
              gasLimit: gasLimit,
              to: contractAddress,
              data: web3.eth.contract(contractAbi).
                at(contractAddress)
                .transfer.getData(toAddress, amount * Math.pow(10, decimals), { from: walletAddress })
            }

            const tx = new EthereumTx(txParams)
            console.log('tx:::', tx);
            tx.sign(Buffer.from(privateKey, 'hex'));
            const serializedTx = tx.serialize();
            console.log('serial', serializedTx);
            web3.eth.sendRawTransaction('0x' + serializedTx.toString('hex'), function (err, hash) {
              if (!err) {
                console.log('hash', hash);
                resolve(hash);
              } else {
                console.log('err', err);
                reject(err);
              }
            });

          });
        });
      });
    });
  }


  // Send an ETH(MXDC) transaction to the given address with the given amount

  static sendETHTransaction(toAddress,amount){
    const web3 = this.getWeb3Instance();
    
     return new Promise((resolve, reject) => {
      web3.eth.sendTransaction(
        {
          to: toAddress,
          value: amount * Math.pow(10, 18),
        },
        (error, transaction) => {
          console.log("MXDC Transaction error",error);
          console.log("MXDC Transaction successs",transaction);
          if (error) {
            reject(error);
          }

          resolve(transaction);
        },
      )
    });
  }
}
