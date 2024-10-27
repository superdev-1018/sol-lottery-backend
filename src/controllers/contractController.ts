const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
import * as web3 from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { Program } from "@coral-xyz/anchor";
const anchor = require("@coral-xyz/anchor");
import { BN } from "bn.js";
import bs58 from 'bs58';
const fs = require("fs");
const path = require("path");

import { getPDA, loadKeypairFromFile, getKeypair, getUserATA } from "../util/utils";
import { time_frame, ticket_price, max_tickets,dev_fees } from "../interfaces/global";


const connection = new Connection(process.env.NETWORK, 'confirmed');
const initializer = getKeypair(process.env.INITIALIZER_PRIVATE_KEY);

const wallet = new anchor.Wallet(initializer);
const provider = new anchor.AnchorProvider(connection, wallet, anchor.AnchorProvider.defaultOptions());
anchor.setProvider(provider);

const programId = new PublicKey(process.env.PROGRAM_ID);
const idlPath = path.join("src", "idl", "lottery.json");
const Lottery = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
const program = new anchor.Program(Lottery, programId, provider);

const withdrawer = process.env.WITHDRAW_PRIVATE_KEY;
const poolKeypair = getKeypair(process.env.INITIALIZER_PRIVATE_KEY);

if (!process.env.GAME_TOKEN) {
    throw new Error('The GAME_TOKEN environment variable is not defined.');
}

if(!initializer) {
    console.log("Insert initializer private key");
}

if (!poolKeypair) {
    throw new Error('Failed to get the Keypair from the private key.');
}

if (!withdrawer){
    throw new Error("Failed to get the withdraw pubkey");
}

const gameToken = new PublicKey(process.env.GAME_TOKEN);


let [globalPDA] =  PublicKey.findProgramAddressSync([Buffer.from("GLOBAL_SETTING_SEED"), initializer.publicKey.toBuffer()], program.programId);
let [lotteryKeyInfoPDA] =  PublicKey.findProgramAddressSync([Buffer.from("LOTTERY_PDAKEY_INFO")], program.programId);
let [winnerTickerPDA] =  PublicKey.findProgramAddressSync([Buffer.from("WINNER_TICKER_SEED")], program.programId);
let [depositeTickerPDA] =  PublicKey.findProgramAddressSync([Buffer.from("DEPOSITE_TICKER_SEED")], program.programId);

export const initialize = async () => {
    const accountInfo = await connection.getAccountInfo(globalPDA);
    if (!accountInfo){
        const txHash = await program.methods.initialize()
        .accounts({
          globalAccount: globalPDA,
          lotteryPdakeyInfo: lotteryKeyInfoPDA,
          winnerTicker: winnerTickerPDA,
          depositeTicker: depositeTickerPDA,
          systemProgram: web3.SystemProgram.programId
        })
        .signers([initializer])
        .rpc()
        .catch((error: any) => {
          console.log("Transaction Error", error);
        });
        const globalAccount = await program.account.globalAccount.fetch(globalPDA);
        console.log(globalAccount)
        return true;
    } else {
        return false;
    }
}


export const initLottery = async () => {
    const globalAccount = await program.account.globalAccount.fetch(globalPDA);
    if (globalAccount.isInitialized ==1){
        for (let i=0;i<10;i++){
            let lotteryPDA = await getPDA([Buffer.from("LOTTERY_INFO_SEED"), initializer.publicKey.toBuffer(), new Uint8Array([i])], program.programId)

            let time_frame_index = i;
            let start_time = new Date().getTime();
            await program.methods.createLottery(
                i,
                time_frame_index, 
                new BN(time_frame[i]),     
                new BN(ticket_price[i]*web3.LAMPORTS_PER_SOL),           
                new BN(max_tickets[i]),
                dev_fees[i],
                new BN(start_time)  
            )
            .accounts({
                admin: initializer.publicKey,
                lottery: lotteryPDA,
                lotteryPdakeyInfo: lotteryKeyInfoPDA,
                systemProgram: web3.SystemProgram.programId
            })
            .signers([initializer])
            .rpc()
            .catch((error: any)=>{console.log(error)});
        }
    }
        let lotteryList = await program.account.lottery.all();
        console.log(lotteryList,"lottery LIst");
}


export const createLottery = async (i: number) => {

    const finalLottery = await program.account.lotteryPdaInfo.fetch(lotteryKeyInfoPDA);

    let final_id = finalLottery.count;
    let lotteryPDA = await getPDA([Buffer.from("LOTTERY_INFO_SEED"), initializer.publicKey.toBuffer(), new Uint8Array([final_id])], program.programId)
    let start_time = new Date().getTime();
    await program.methods.createLottery(
        final_id,
        i, 
        new BN(time_frame[i]),     
        new BN(ticket_price[i]* web3.LAMPORTS_PER_SOL),           
        new BN(max_tickets[i]),
        dev_fees[i],
        new BN(start_time)  
    )
    .accounts({
        admin: initializer.publicKey,
        lottery: lotteryPDA,
        lotteryPdakeyInfo: lotteryKeyInfoPDA,
        systemProgram: web3.SystemProgram.programId
    })
    .signers([initializer])
    .rpc()
    .catch((error: any)=>{console.log(error)});

}

export const endLottery = async (i:number) => {
    try {
            const lotteries = await program.account.lottery.all();
            console.log(`Number of lotteries fetched: ${lotteries.length}`);

            const filteredLotteries = lotteries.filter((lottery: any) => lottery.account.timeFrame.eq(new BN(time_frame[i])));

            if (filteredLotteries.length > 0) {
                const finalOneLottery = filteredLotteries.reduce((prev:any, current:any) => {
                    return (prev.account.id > current.account.id) ? prev : current;
                });
     
                console.log(finalOneLottery,"Final Lottery");

                const endTxHash = await program.methods.endLottery()
                    .accounts({
                        admin: initializer.publicKey,
                        lottery: finalOneLottery.publicKey,
                        poolTokenAccount: new web3.PublicKey(poolKeypair.publicKey),
                        taxTokenAccount: new web3.PublicKey(withdrawer),
                        winnerTicker: winnerTickerPDA
                    })
                    .signers([initializer])
                    .rpc()
                    .then(async (res: any) => {
                        console.log(res, "end transaction hash value");
                        //if endlottery is successful, then distribute the prize to winners.
                  
                        if ( typeof res == 'string') {
                            console.log("lottery prize distribution")
 

                            let updatedLottery = await program.account.lottery.fetch(finalOneLottery.publicKey);

                            let ATAs = [];

                            for(let i=0;i<3;i++){
                                let ATA = new web3.PublicKey(updatedLottery.winner[i]);
                                ATAs.push(ATA);
                            } 

                                const txHash = await program.methods.prizeDistribution()
                                    .accounts({
                                        admin: initializer.publicKey,
                                        poolTokenAccount: new web3.PublicKey(poolKeypair.publicKey),
                                        lottery: finalOneLottery.publicKey,
                                        winner1TokenAccount: ATAs[0],
                                        winner2TokenAccount: ATAs[1],
                                        winner3TokenAccount: ATAs[2],
                                        tokenProgram: TOKEN_PROGRAM_ID,
                                        systemProgram: web3.SystemProgram.programId
                                    })
                                    .rpc()
                                console.log(txHash,"success");
                                return true;
                        } else {
                            return false;
                        }
                    }).catch(async (error:any)=>{
                        let errMessage = error.message;

                        // check that lottery is failed because of not enough participants.
                        if (errMessage.includes("NotEnoughParticipants")){
                            if (finalOneLottery.account.state == 1){
                                console.log("state is 1 in notenoughparticipant")
                                return false;
                            } else {
                                console.log("state is not 1 in not enough")
                                let participants = finalOneLottery.account.participants;
                                if (participants.length > 0) {
                                    console.log("length is more than 0")
                                    // If lottery has 1~3 participants, then program will refund the ticket price.
                                    for (let i=0;i<participants.length;i++){
                                        let participant = participants[i];
                                        let participantATA = new web3.PublicKey(participant);
                                        await program.methods.refundToUser()
                                            .accounts({
                                                admin: initializer.publicKey,
                                                lottery: finalOneLottery.publicKey,
                                                poolTokenAccount: new web3.PublicKey(poolKeypair.publicKey),
                                                participantTokenAccount: participantATA,
                                                tokenProgram: TOKEN_PROGRAM_ID,
                                                systemProgram: web3.SystemProgram.programId
                                            })
                                            .rpc();
                                    }

                                    return "restart";
                                } else { 
                                    console.log("length is 0")
                                    // If lottery has no participants, then set the lottery state to 2.
                                    return "restart";
                                }
                            }
                        } 
                        // check that lottery has already ended.
                        else if (errMessage.includes("LotteryAlreadyEnded")){
                            console.log("lottery already ended")
                            return true;
                        } else {
                            // other errors.
                            console.log(error,"************")  
                            return false;
                        }
                    });   

                    return endTxHash;
            } else {
                console.log("No lotteries matched the time frame.");
                return true;
            }
    } catch (error) {
        console.error("Error in endLottery:", error);
        return false;
    }
};
        

