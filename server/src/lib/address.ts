import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { secp256k1 } from '@noble/curves/secp256k1';
import { base58, bech32 } from '@scure/base';
import { isEvm, type NetworkName } from './chains.js';

export const hash160 = (data: Uint8Array): Uint8Array => ripemd160(sha256(data));

const b58check = {
  encode(bytes: Uint8Array): string {
    const check = sha256(sha256(bytes));
    return base58.encode(concat(bytes, check.subarray(0, 4)));
  },
  decode(str: string): Uint8Array {
    const raw = base58.decode(str);
    if (raw.length < 5) throw new Error('base58check too short');
    const payload = raw.subarray(0, raw.length - 4);
    const check = sha256(sha256(payload)).subarray(0, 4);
    const given = raw.subarray(raw.length - 4);
    if (!equal(check, given)) throw new Error('bad base58check checksum');
    return payload;
  },
};
export { b58check };

function concat(...arrs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export const keccak = (data: Uint8Array): Uint8Array => keccak_256(data);

/** EIP-55 checksum address */
export function toChecksumAddress(addr: string): string {
  const lower = addr.toLowerCase().replace(/^0x/, '');
  const hash = Buffer.from(keccak(Buffer.from(lower, 'utf8'))).toString('hex');
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i];
  }
  return out;
}

export function isValidChecksum(addr: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return false;
  const hasUpper = /[A-F]/.test(addr.slice(2));
  const hasLower = /[a-f]/.test(addr.slice(2));
  if (!hasUpper && !hasLower) return true; // all-lower / all-upper is accepted
  return toChecksumAddress(addr) === addr;
}

const BTC_P2PKH = 0x00;
const LTC_P2PKH = 0x30;

/** bech32 (segwit v0) address from hash160 — witness version is a 5-bit value, prepended after conversion */
export function segwitAddress(hash: Uint8Array, hrp: 'bc' | 'ltc'): string {
  return bech32.encode(hrp, [0, ...bech32.toWords(hash)]);
}

/** legacy base58check address */
export function legacyAddress(hash: Uint8Array, version: number): string {
  return b58check.encode(concat(new Uint8Array([version]), hash));
}

/** P2SH-P2WPKH: base58check(version || hash160(0x00 0x14 || keyhash)) */
export function p2shAddress(keyhash: Uint8Array, version = 0x05): string {
  const redeemScript = concat(new Uint8Array([0x00, 0x14]), keyhash);
  return b58check.encode(concat(new Uint8Array([version]), hash160(redeemScript)));
}

/** TRON base58check address: 0x41 + 20-byte keccak hash */
export function tronAddress(evm20: Uint8Array): string {
  return b58check.encode(concat(new Uint8Array([0x41]), evm20));
}

/**
 * keccak256 hash of an ECDSA public key → last 20 bytes.
 * Accepts compressed (33B) or uncompressed (65B) keys and always hashes the
 * 64-byte uncompressed body (X || Y) as required by EVM / TRON.
 */
export function evm20FromPubkey(pubkey: Uint8Array): Uint8Array {
  const uncompressed = pubkey.length === 65 ? pubkey : secp256k1.Point.fromHex(pubkey).toRawBytes(false);
  return keccak(uncompressed.subarray(1)).subarray(12);
}

// ---------------------------------------------------------------------------
// Address validation per network
// ---------------------------------------------------------------------------

const RE_TRON = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const RE_BTC = /^(bc1[a-z0-9]{25,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;
const RE_LTC = /^(ltc1[a-z0-9]{25,59}|[LM3][a-km-zA-HJ-NP-Z1-9]{25,34})$/;
const RE_EVM = /^0x[0-9a-fA-F]{40}$/;

export function validateAddress(address: string, network: NetworkName): boolean {
  try {
    if (isEvm(network)) {
      if (!RE_EVM.test(address)) return false;
      return isValidChecksum(address);
    }
    if (network === 'TRON') {
      if (!RE_TRON.test(address)) return false;
      const payload = b58check.decode(address);
      return payload.length === 21 && payload[0] === 0x41;
    }
    if (network === 'BTC') {
      if (RE_BTC.test(address)) {
        if (address.startsWith('bc1')) {
          bech32.decode(address as `${string}1${string}`); // throws on bad checksum/length
          return true;
        }
        b58check.decode(address);
        return true;
      }
      return false;
    }
    if (network === 'LTC') {
      if (RE_LTC.test(address)) {
        if (address.startsWith('ltc1')) {
          bech32.decode(address as `${string}1${string}`);
          return true;
        }
        const payload = b58check.decode(address);
        return payload.length === 21 && [0x30, 0x32, 0x05].includes(payload[0]!);
      }
      return false;
    }
    return false;
  } catch {
    return false;
  }
}
