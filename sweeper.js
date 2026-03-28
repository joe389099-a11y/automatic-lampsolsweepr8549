const { Connection, PublicKey, Keypair, Transaction, LAMPORTS_PER_SOL, SystemProgram } = require('@solana/web3.js');
const { getAssociatedTokenAddress, createTransferInstruction, getAccount } = require('@solana/spl-token');
const bs58 = require('bs58');

// Configuration from environment variables
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
const DESTINATION_ADDRESS = process.env.DESTINATION_ADDRESS;
const THRESHOLD_SOL = parseFloat(process.env.THRESHOLD_SOL) || 5;
const THRESHOLD_USDC = parseFloat(process.env.THRESHOLD_USDC) || 100; // USDC threshold (in dollars/units)
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS) || 10000;
const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";

// USDC token mint address on Solana mainnet
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

class SolanaSweeperBot {
    constructor() {
        this.connection = new Connection(RPC_URL, 'confirmed');
        const privateKeyBytes = bs58.decode(WALLET_PRIVATE_KEY);
        this.wallet = Keypair.fromSecretKey(privateKeyBytes);
        this.destinationPubkey = new PublicKey(DESTINATION_ADDRESS);
        
        console.log(`🔍 Monitoring wallet: ${this.wallet.publicKey.toString()}`);
        console.log(`📤 Will sweep to: ${this.destinationPubkey.toString()}`);
        console.log(`💰 SOL Threshold: ${THRESHOLD_SOL} SOL`);
        console.log(`💰 USDC Threshold: ${THRESHOLD_USDC} USDC`);
    }

    async checkBalanceAndSweep() {
        try {
            // Check SOL balance
            const solBalance = await this.connection.getBalance(this.wallet.publicKey);
            const solBalanceInSol = solBalance / LAMPORTS_PER_SOL;
            
            console.log(`[${new Date().toISOString()}] SOL Balance: ${solBalanceInSol.toFixed(6)} SOL`);
            
            // Check USDC balance
            const usdcBalance = await this.getUSDCBalance();
            console.log(`[${new Date().toISOString()}] USDC Balance: ${usdcBalance.toFixed(2)} USDC`);
            
            // Check SOL threshold
            if (solBalanceInSol > THRESHOLD_SOL) {
                console.log(`⚠️ SOL balance (${solBalanceInSol.toFixed(6)} SOL) exceeds threshold! Sweeping...`);
                await this.sweepSOL(solBalance);
            }
            
            // Check USDC threshold
            if (usdcBalance > THRESHOLD_USDC) {
                console.log(`⚠️ USDC balance (${usdcBalance.toFixed(2)} USDC) exceeds threshold! Sweeping...`);
                await this.sweepUSDC(usdcBalance);
            }
            
        } catch (error) {
            console.error('❌ Error checking balances:', error.message);
        }
    }
    
    async getUSDCBalance() {
        try {
            // Get the associated token account for USDC
            const tokenAccount = await getAssociatedTokenAddress(
                USDC_MINT,
                this.wallet.publicKey
            );
            
            // Check if token account exists
            const accountInfo = await this.connection.getAccountInfo(tokenAccount);
            if (!accountInfo) {
                return 0; // No USDC account exists
            }
            
            // Get token balance
            const tokenBalance = await this.connection.getTokenAccountBalance(tokenAccount);
            return tokenBalance.value.uiAmount || 0;
            
        } catch (error) {
            console.error('Error getting USDC balance:', error.message);
            return 0;
        }
    }
    
    async sweepSOL(currentBalance) {
        try {
            const gasReserve = 0.002 * LAMPORTS_PER_SOL;
            const amountToSend = currentBalance - gasReserve;
            
            if (amountToSend <= 0) {
                console.log(`⚠️ Insufficient SOL after gas reservation`);
                return;
            }
            
            console.log(`🔄 Sending ${(amountToSend / LAMPORTS_PER_SOL).toFixed(6)} SOL...`);
            
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
            
            console.log(`✅ SOL Swept! ${(amountToSend / LAMPORTS_PER_SOL).toFixed(6)} SOL sent`);
            console.log(`🔗 https://explorer.solana.com/tx/${signature}`);
            
        } catch (error) {
            console.error('❌ SOL sweep failed:', error.message);
        }
    }
    
    async sweepUSDC(usdcBalance) {
        try {
            // Get source token account (from wallet)
            const sourceTokenAccount = await getAssociatedTokenAddress(
                USDC_MINT,
                this.wallet.publicKey
            );
            
            // Get destination token account
            const destTokenAccount = await getAssociatedTokenAddress(
                USDC_MINT,
                this.destinationPubkey
            );
            
            // Check if destination token account exists, if not, we need to create it
            const destAccountInfo = await this.connection.getAccountInfo(destTokenAccount);
            
            // Calculate amount to send (in raw units, USDC has 6 decimals)
            const amountInRaw = Math.floor(usdcBalance * Math.pow(10, 6));
            
            console.log(`🔄 Sending ${usdcBalance.toFixed(2)} USDC...`);
            
            const transaction = new Transaction();
            
            // If destination token account doesn't exist, add instruction to create it
            if (!destAccountInfo) {
                console.log(`📝 Creating USDC token account for destination...`);
                const createATAInstruction = createAssociatedTokenAccountInstruction(
                    this.wallet.publicKey, // payer
                    destTokenAccount, // ata
                    this.destinationPubkey, // owner
                    USDC_MINT // mint
                );
                transaction.add(createATAInstruction);
            }
            
            // Add USDC transfer instruction
            const transferInstruction = createTransferInstruction(
                sourceTokenAccount,
                destTokenAccount,
                this.wallet.publicKey,
                amountInRaw
            );
            transaction.add(transferInstruction);
            
            const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = this.wallet.publicKey;
            
            const signature = await this.connection.sendTransaction(transaction, [this.wallet]);
            await this.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight });
            
            console.log(`✅ USDC Swept! ${usdcBalance.toFixed(2)} USDC sent`);
            console.log(`🔗 https://explorer.solana.com/tx/${signature}`);
            
        } catch (error) {
            console.error('❌ USDC sweep failed:', error.message);
        }
    }
    
    start() {
        console.log(`🚀 Starting multi-token sweeper bot...`);
        this.checkBalanceAndSweep();
        setInterval(() => this.checkBalanceAndSweep(), CHECK_INTERVAL_MS);
    }
}

// Helper function for creating ATA (if using older version of @solana/spl-token)
function createAssociatedTokenAccountInstruction(
    payer,
    ata,
    owner,
    mint
) {
    const { createAssociatedTokenAccountInstruction } = require('@solana/spl-token');
    return createAssociatedTokenAccountInstruction(
        payer,
        ata,
        owner,
        mint
    );
}

// Validate environment variables
if (!WALLET_PRIVATE_KEY || !DESTINATION_ADDRESS) {
    console.error('❌ Missing environment variables!');
    console.log('Please set: WALLET_PRIVATE_KEY and DESTINATION_ADDRESS');
    process.exit(1);
}

const bot = new SolanaSweeperBot();
bot.start();
