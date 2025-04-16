import 'dotenv/config';
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  BUY_AMOUNT,
  BUY_INTERVAL_MAX,
  BUY_INTERVAL_MIN,
  BUY_LOWER_AMOUNT,
  BUY_UPPER_AMOUNT,
  DISTRIBUTE_WALLET_NUM,
  ADDITIONAL_FEE,
  PRIVATE_KEY,
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
  TOKEN_MINT,
  QUOTE_MINT,
  TARGET_POOL,
} from './constants';
import { getBuyTx, getSellTx } from './utils/swapOnlyAmm';
import { sleep } from './utils';

// Use this for JSON array private key (from solana-keygen)
const mainKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(PRIVATE_KEY)));

const solanaConnection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
});

const baseMint = new PublicKey(TOKEN_MINT);
const quoteMint = new PublicKey(QUOTE_MINT);
const targetPool = TARGET_POOL;
const distributionNum = DISTRIBUTE_WALLET_NUM > 10 ? 10 : DISTRIBUTE_WALLET_NUM;

async function checkPoolExists(poolAddress: string) {
  const info = await solanaConnection.getAccountInfo(new PublicKey(poolAddress));
  if (!info) {
    throw new Error('Pool does not exist on devnet!');
  }
  console.log('Pool exists and is ready.');
}

async function main() {
  if (!RPC_ENDPOINT.includes('devnet')) {
    throw new Error('This bot is configured to run only on devnet!');
  }

  await checkPoolExists(targetPool);

  const solBalance = (await solanaConnection.getBalance(mainKp.publicKey)) / LAMPORTS_PER_SOL;
  console.log(`Volume bot is running`);
  console.log(`Wallet address: ${mainKp.publicKey.toBase58()}`);
  console.log(`Pool token mint: ${baseMint.toBase58()}`);
  console.log(`Wallet SOL balance: ${solBalance.toFixed(3)} SOL`);
  console.log(`Buying interval max: ${BUY_INTERVAL_MAX}ms`);
  console.log(`Buying interval min: ${BUY_INTERVAL_MIN}ms`);
  console.log(`Buy upper limit amount: ${BUY_UPPER_AMOUNT} SOL`);
  console.log(`Buy lower limit amount: ${BUY_LOWER_AMOUNT} SOL`);
  console.log(`Distribute SOL to ${distributionNum} wallets`);

  // For demonstration, just use the main wallet
  const wallets: Keypair[] = [mainKp];

  for (const wallet of wallets) {
    await sleep(Math.random() * (BUY_INTERVAL_MAX - BUY_INTERVAL_MIN) + BUY_INTERVAL_MIN);

    // --- BUY ---
    const buyAmount = BUY_AMOUNT; // Or randomize within limits
    const buyResult = await buy(wallet, baseMint, quoteMint, buyAmount, targetPool);
    if (buyResult) {
      console.log('Buy successful!');
    } else {
      console.log('Buy failed.');
      continue;
    }

    await sleep(3000);

    // --- SELL ---
    // You may want to fetch the actual token balance to sell, here we use buyAmount for simplicity
    const sellResult = await sell(wallet, baseMint, quoteMint, buyAmount, targetPool);
    if (sellResult) {
      console.log('Sell successful!');
    } else {
      console.log('Sell failed.');
    }

    await sleep(5000);
  }
}

// BUY function
async function buy(
  wallet: Keypair,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  amount: number,
  targetPool: string
): Promise<boolean> {
  try {
    const tx = await getBuyTx(
      solanaConnection,
      wallet,
      baseMint,
      quoteMint,
      amount,
      targetPool
    );
    if (!tx) {
      console.log('Failed to build buy transaction.');
      return false;
    }
    tx.sign([wallet]);
    const signature = await solanaConnection.sendTransaction(tx);
    console.log(`Buy transaction sent: ${signature}`);
    return true;
  } catch (error) {
    console.error('Error in buy:', error);
    return false;
  }
}

// SELL function
async function sell(
  wallet: Keypair,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  amount: number,
  targetPool: string
): Promise<boolean> {
  try {
    const tx = await getSellTx(
      solanaConnection,
      wallet,
      baseMint,
      quoteMint,
      amount.toString(), // Convert number to string
      targetPool
    );
    if (!tx) {
      console.log('Failed to build sell transaction.');
      return false;
    }
    tx.sign([wallet]);
    const signature = await solanaConnection.sendTransaction(tx);
    console.log(`Sell transaction sent: ${signature}`);
    return true;
  } catch (error) {
    console.error('Error in sell:', error);
    return false;
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
