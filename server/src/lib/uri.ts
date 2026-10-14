import { CHAIN_IDS, TOKEN_CONTRACTS, type CoinName, type NetworkName, isEvm } from './chains.js';

/** on-chain decimals of token contracts (ERC-20 / BEP-20) for EIP-681 uint256 amounts */
export const TOKEN_DECIMALS: Record<string, number> = {
  'USDT@ETH': 6,
  'USDC@ETH': 6,
  'USDT@BSC': 18,
  'USDC@BSC': 18,
};

export interface UriInput {
  address: string;
  amount: string; // decimal string in coin units
  coin: CoinName;
  network: NetworkName;
  label?: string;
}

const NATIVE_URI_SCHEME: Record<NetworkName, string> = {
  BTC: 'bitcoin',
  LTC: 'litecoin',
  ETH: 'ethereum',
  BSC: 'ethereum',
  TRON: 'tron',
};

/** BIP21 (BTC/LTC), EIP-681 (ETH/BSC incl. ERC-20 transfer), TRON URI */
export function paymentUri({ address, amount, coin, network, label }: UriInput): string {
  const scheme = NATIVE_URI_SCHEME[network];

  if (isEvm(network)) {
    const contract = TOKEN_CONTRACTS[`${coin}@${network}`];
    if (contract) {
      // EIP-681 ERC-20 transfer: ethereum:<token>@<chainid>/transfer?address=&uint256=
      const decimals = TOKEN_DECIMALS[`${coin}@${network}`] ?? 18;
      const atomic = toAtomic(amount, decimals);
      const params = new URLSearchParams({ address, uint256: atomic });
      return `ethereum:${contract}@${CHAIN_IDS[network]}/transfer?${params.toString()}`;
    }
    const wei = toAtomic(amount, 18);
    return `ethereum:${address}@${CHAIN_IDS[network]}?value=${wei}`;
  }

  const params = new URLSearchParams();
  params.set('amount', amount);
  if (label) params.set('label', label);
  return `${scheme}:${address}?${params.toString()}`;
}

export function toAtomic(amount: string, decimals: number): string {
  const [whole = '0', frac = ''] = amount.split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const combined = (whole + fracPadded).replace(/^0+(?=\d)/, '');
  return combined === '' ? '0' : combined;
}
