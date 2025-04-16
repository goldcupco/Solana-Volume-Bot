import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { BLOCKENGINE_URL, JITO_FEE, JITO_KEY, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT } from "../constants";
import { SearcherClient, searcherClient } from "jito-ts/dist/sdk/block-engine/searcher";
import { Bundle } from "jito-ts/dist/sdk/block-engine/types";
import { isError } from "jito-ts/dist/sdk/block-engine/utils";

const solanaConnection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
});

/**
 * Bundles transactions into groups and sends them using JITO.
 * @param txs Array of VersionedTransaction objects to bundle.
 * @param keypair Keypair for signing transactions.
 * @returns Promise<boolean> indicating success or failure.
 */
export async function bundle(txs: VersionedTransaction[], keypair: Keypair): Promise<boolean> {
  try {
    const txNum = Math.ceil(txs.length / 3); // Split transactions into groups of 3
    let successNum = 0;

    for (let i = 0; i < txNum; i++) {
      const upperIndex = (i + 1) * 3;
      const downIndex = i * 3;
      const newTxs = txs.slice(downIndex, upperIndex);

      const success = await bull_dozer(newTxs, keypair);
      if (success) successNum++;
    }

    return successNum === txNum;
  } catch (error) {
    console.error("Error in bundle function:", error);
    return false;
  }
}

/**
 * Sends a group of transactions using JITO's block engine.
 * @param txs Array of VersionedTransaction objects to send.
 * @param keypair Keypair for signing transactions.
 * @returns Promise<boolean> indicating success or failure.
 */
export async function bull_dozer(txs: VersionedTransaction[], keypair: Keypair): Promise<boolean> {
  try {
    const bundleTransactionLimit = 4; // Maximum transactions per bundle

    if (JITO_KEY) {
      // Parse the private key array directly
      const jitoKeyArray = JSON.parse(JITO_KEY); // Assuming JITO_KEY is an array in the environment variable
      const jitoKey = Keypair.fromSecretKey(Uint8Array.from(jitoKeyArray));
      const search = searcherClient(BLOCKENGINE_URL, jitoKey);

      await build_bundle(search, bundleTransactionLimit, txs, keypair);

      const bundleResult = await onBundleResult(search);
      return bundleResult > 0; // Return true if at least one bundle was accepted
    } else {
      console.warn("JITO_KEY is not set. Skipping JITO bundling...");
      return false;
    }
  } catch (error) {
    console.error("Error in bull_dozer function:", error);
    return false;
  }
}

/**
 * Builds and sends a bundle of transactions using JITO's block engine.
 * @param search SearcherClient instance for interacting with the block engine.
 * @param bundleTransactionLimit Maximum number of transactions in a bundle.
 * @param txs Array of VersionedTransaction objects to include in the bundle.
 * @param keypair Keypair for signing the tip transaction.
 */
async function build_bundle(
  search: SearcherClient,
  bundleTransactionLimit: number,
  txs: VersionedTransaction[],
  keypair: Keypair
): Promise<void> {
  try {
    const accounts = await search.getTipAccounts();
    if (!accounts || accounts.length === 0) {
      throw new Error("No tip accounts available from JITO.");
    }

    const randomIndex = Math.min(Math.floor(Math.random() * accounts.length), accounts.length - 1);
    const tipAccount = new PublicKey(accounts[randomIndex]);

    const bund = new Bundle([], bundleTransactionLimit);
    const resp = await solanaConnection.getLatestBlockhash("processed");

    bund.addTransactions(...txs);

    const maybeBundle = bund.addTipTx(keypair, JITO_FEE, tipAccount, resp.blockhash);

    if (isError(maybeBundle)) {
      throw maybeBundle;
    }

    await search.sendBundle(maybeBundle);
  } catch (error) {
    console.error("Error in build_bundle function:", error);
    throw error; // Propagate the error to the caller
  }
}

/**
 * Waits for the result of a submitted bundle and resolves when accepted or after a timeout.
 * @param c SearcherClient instance for interacting with the block engine.
 * @returns Promise<number> indicating the number of accepted bundles.
 */
export const onBundleResult = (c: SearcherClient): Promise<number> => {
  let acceptedCount = 0;
  let isResolved = false;

  return new Promise((resolve) => {
    // Timeout after 30 seconds if no result is received
    setTimeout(() => {
      if (!isResolved) {
        console.warn("Bundle result timeout reached.");
        resolve(acceptedCount);
        isResolved = true;
      }
    }, 30000);

    c.onBundleResult(
      (result: any) => {
        if (isResolved) return;

        if (result.accepted) {
          console.log(`Bundle accepted! ID: ${result.bundleId} | Slot: ${result.accepted.slot}`);
          acceptedCount++;
          isResolved = true;
          resolve(acceptedCount); // Resolve when a bundle is accepted
        }
      },
      (error: any) => {
        console.error("Error in onBundleResult callback:", error.message);
        if (!isResolved) resolve(acceptedCount); // Resolve with current count even on error
      }
    );
  });
};
