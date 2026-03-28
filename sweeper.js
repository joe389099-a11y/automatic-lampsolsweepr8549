
const { Connection, PublicKey, Keypair, Transaction, LAMPORTS_PER_SOL, SystemProgram } = require('@solana/web3.js');
const bs58 = require('bs58');

// Configuration from environment variables
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
const DESTINATION_ADDRESS = process.env.DESTINATION_ADDRESS;
const THRESHOLD_SOL = parseFloat(process.env.THRESHOLD_SOL) || 5;
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS) || 10000;
const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";

class SolanaSweeperBot {
    constructor() {
        this.connection = new Connection(RPC_URL, 'confirmed');
        const privateKeyBytes = bs58.decode(WALLET_PRIVATE_KEY);
        this.wallet = Keypair.fromSecretKey(privateKeyBytes);
        this.destinationPubkey = new PublicKey(DESTINATION_ADDRESS);
        
        console.log(`🔍 Monitoring wallet: ${this.wallet.publicKey.toString()}`);
        console.log(`📤 Will sweep to: ${this.destinationPubkey.toString()}`);
        console.log(`💰 Threshold: ${THRESHOLD_SOL} SOL`);
    }

    async checkBalanceAndSweep() {
        try {
            const balance = await this.connection.getBalance(this.wallet.publicKey);
            const balanceInSol = balance / LAMPORTS_PER_SOL;
            
            console.log(`[${new Date().toISOString()}] Balance: ${balanceInSol.toFixed(6)} SOL`);
            
            if (balanceInSol > THRESHOLD_SOL) {
                console.log(`⚠️ Balance exceeds threshold! Sweeping...`);
                await this.sweepFunds(balance);
            }
        } catch (error) {
            console.error('❌ Error:', error.message);
        }
    }
    
    async sweepFunds(currentBalance) {
        try {
            const gasReserve = 0.002 * LAMPORTS_PER_SOL;
            const amountToSend = currentBalance - gasReserve;
            
            if (amountToSend <= 0) return;
            
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: this.wallet.publicKey,
                    toPubkey: this.destinationPubkey,
                    lamports: amountToSend
                })
            );
            
            const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = this.wallet.publicKey;
            
            const signature = await this.connection.sendTransaction(transaction, [this.wallet]);
            await this.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight });
            
            console.log(`✅ SUCCESS! Swept ${(amountToSend / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
            console.log(`🔗 https://explorer.solana.com/tx/${signature}`);
        } catch (error) {
            console.error('❌ Sweep failed:', error.message);
        }
    }
    
    start() {
        console.log(`🚀 Starting sweeper bot...`);
        this.checkBalanceAndSweep();
        setInterval(() => this.checkBalanceAndSweep(), CHECK_INTERVAL_MS);
    }
}

// Validate environment variables
if (!WALLET_PRIVATE_KEY || !DESTINATION_ADDRESS) {
    console.error('❌ Missing environment variables!');
    console.log('Please set: WALLET_PRIVATE_KEY and DESTINATION_ADDRESS');
    process.exit(1);
}

const bot = new SolanaSweeperBot();
bot.start();
