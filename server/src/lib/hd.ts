import { HDKey } from '@scure/bip32';
import { base58 } from '@scure/base';
import {
  evm20FromPubkey,
  hash160,
  legacyAddress,
  p2shAddress,
  segwitAddress,
  tronAddress,
  toChecksumAddress,
} from './address.js';
import type { NetworkName } from './chains.js';

export type XpubKind = 'p2pkh' | 'p2sh' | 'segwit';

const VERSIONS: Record<string, { public: number; private: number }> = {
  xpub: { public: 0x0488b21e, private: 0x0488ade4 },
  ypub: { public: 0x049d7cb2, private: 0x049d7878 },
  zpub: { public: 0x04b24746, private: 0x04b2430c },
};

const KIND: Record<string, XpubKind> = {
  xpub: 'p2pkh',
  ypub: 'p2sh',
  zpub: 'segwit',
};

export interface ParsedXpub {
  node: HDKey;
  kind: XpubKind;
  prefix: string;
}

const u32be = (bytes: Uint8Array): number =>
  ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;

const PREFIXES: Record<number, string> = {
  0x0488b21e: 'xpub',
  0x049d7cb2: 'ypub',
  0x04b24746: 'zpub',
  0x043587cf: 'tpub',
};

/**
 * Parse a base58 SLIP-0132 extended public key.
 * Private keys are rejected — NodePay never touches private key material.
 */
export function parseXpub(input: string): ParsedXpub {
  const x = input.trim();
  let raw: Uint8Array;
  try {
    raw = base58.decode(x);
  } catch {
    throw new Error('invalid extended public key encoding');
  }
  if (raw.length !== 82) throw new Error('invalid extended public key length');

  const version = u32be(raw.subarray(0, 4));
  const prefix = PREFIXES[version];
  if (!prefix || prefix === 'tpub') throw new Error('unsupported extended key (use xpub/ypub/zpub)');

  const versions = VERSIONS[prefix]!;
  const node = HDKey.fromExtendedKey(x, versions);
  if ((raw[45] ?? 1) === 0) throw new Error('private keys are not accepted');

  return { node, kind: KIND[prefix]!, prefix };
}

export function isXpub(input: string): boolean {
  try {
    parseXpub(input);
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_PATHS: Record<NetworkName, Record<XpubKind, string>> = {
  BTC: { p2pkh: "m/44'/0'/0'", p2sh: "m/49'/0'/0'", segwit: "m/84'/0'/0'" },
  LTC: { p2pkh: "m/44'/2'/0'", p2sh: "m/49'/2'/0'", segwit: "m/84'/2'/0'" },
  ETH: { p2pkh: "m/44'/60'/0'", p2sh: "m/44'/60'/0'", segwit: "m/44'/60'/0'" },
  BSC: { p2pkh: "m/44'/60'/0'", p2sh: "m/44'/60'/0'", segwit: "m/44'/60'/0'" },
  TRON: { p2pkh: "m/44'/195'/0'", p2sh: "m/44'/195'/0'", segwit: "m/44'/195'/0'" },
};

function pubkeyToAddress(pubkey: Uint8Array, network: NetworkName, kind: XpubKind): string {
  if (network === 'ETH' || network === 'BSC') {
    return toChecksumAddress('0x' + Buffer.from(evm20FromPubkey(pubkey)).toString('hex'));
  }
  if (network === 'TRON') {
    return tronAddress(evm20FromPubkey(pubkey));
  }
  const h = hash160(pubkey);
  const hrp = network === 'LTC' ? 'ltc' : 'bc';
  const p2pkhVer = network === 'LTC' ? 0x30 : 0x00;
  const p2shVer = network === 'LTC' ? 0x32 : 0x05;
  if (kind === 'segwit') return segwitAddress(h, hrp);
  if (kind === 'p2sh') return p2shAddress(h, p2shVer);
  return legacyAddress(h, p2pkhVer);
}

/**
 * Derive a unique receive address for an invoice from the merchant's xpub.
 *
 * Depth-aware: account-level xpubs (depth ≥ 3, what wallets actually export for
 * m/84'/0'/0') derive the external chain relatively as `0/<index>` — hardened
 * segments can never be derived from a neutered key. Master xpubs (depth 0)
 * derive the full base path.
 */
export function deriveAddress(
  xpub: string,
  network: NetworkName,
  index: number,
  basePath?: string | null
): string {
  const { node, kind } = parseXpub(xpub);
  const base = basePath?.startsWith('m/') ? basePath : DEFAULT_PATHS[network][kind];
  const baseSegs = base.split('/').slice(1); // drop "m"

  let child: HDKey;
  if (node.depth === 0) {
    child = node.derive(`${base}/0/${index}`);
  } else if (node.depth === baseSegs.length) {
    // xpub sits exactly at the account path → derive external chain relatively
    // (scure's derive() treats the path as relative after the leading "m/")
    child = node.derive(`m/0/${index}`);
  } else if (node.depth > baseSegs.length) {
    throw new Error('xpub is deeper than the derivation path — re-export at account level');
  } else {
    // xpub shallower than account path (purpose'/coin' level): the remaining
    // hardened segments cannot be derived from a neutered key
    throw new Error('xpub must be exported at account level (e.g. m/84\'/0\'/0\') or be a master xpub');
  }

  if (!child.publicKey) throw new Error('derivation failed');
  return pubkeyToAddress(child.publicKey, network, kind);
}
