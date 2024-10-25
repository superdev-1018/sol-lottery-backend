import * as anchor from "@coral-xyz/anchor";
import * as web3 from "@solana/web3.js";
import { readFileSync } from "fs";
import bs58 from 'bs58';
import { Signer } from "ethers";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
import { Keypair, Transaction } from "@solana/web3.js";

export const loadKeypairFromFile = async (filePath: string) => {
    const keypairData = JSON.parse(readFileSync(filePath, 'utf-8'));
    return web3.Keypair.fromSecretKey(new Uint8Array(keypairData));
}

export const getKeypair = (privateKey:string | undefined): web3.Keypair => {

    if (privateKey){
        const privateKeyBytes = bs58.decode(privateKey);
        return web3.Keypair.fromSecretKey(privateKeyBytes);

    } else {
        return new web3.Keypair();
    }
}

export const getPDA = async ( seeds: (Buffer | Uint8Array)[], programId: anchor.web3.PublicKey) => {
    const [pdaKey] = await anchor.web3.PublicKey.findProgramAddressSync(seeds, programId);
    return pdaKey;
}


export const getUserATA = async (userPubkey: web3.PublicKey, gameToken: web3.PublicKey, connection: web3.Connection) => {

  const wallet = await getKeypair(process.env.INITIALIZER_PRIVATE_KEY);
    
    const associatedTokenAddress = await getAssociatedTokenAddress(gameToken, userPubkey,false)

    let userAssociatedTokenAddress;
    const accountInfo = await connection.getAccountInfo(associatedTokenAddress)

  
    if (accountInfo) {
      console.log("auccount exist");
      userAssociatedTokenAddress = associatedTokenAddress
    } else {
      const transaction = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          associatedTokenAddress,
          userPubkey,
          gameToken,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )

      transaction.feePayer = wallet.publicKey;
      const { blockhash } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.sign(wallet);
        
      const signedTransaction = await connection.sendTransaction(transaction, [wallet]);
      await connection.confirmTransaction(signedTransaction);
      
      userAssociatedTokenAddress = associatedTokenAddress;
    }
    return userAssociatedTokenAddress;
}


export const formatTime = (i: number): string => {
  if (i ==0 ) {
    return `HOURLY`;
  } else if (i == 1) {
    return `3-HOURLY`;
  } else if (i == 2){
    return `6-HOURLY`
  } else if (i == 3) {
    return `12-HOURLY`;
  } else if (i == 4){
    return `DAILY`
  } else if (i == 5) {
    return `WEEKLY`;
  } else if (i == 6) {
    return `MONTHLY`;
  } else if (i == 7) {
    return `QUARTERLY`;
  } else if (i == 8) {
    return `HALF-YEARLY`;
  } else if (i == 9) {
    return `ANNUALLY`;
  }else {
    const years = Math.floor(i / 8760);
    return `${years} ${years === 1 ? 'year' : 'years'}`;
  }
};


