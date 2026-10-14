import type { NetworkName } from '../../lib/chains.js';
import type { ChainProvider } from './types.js';
import { EvmProvider } from './evmProvider.js';
import { TronProvider } from './tronProvider.js';
import { btcProvider, ltcProvider } from './bitcoinProvider.js';
import { env } from '../../config.js';

const providers: Partial<Record<NetworkName, ChainProvider>> = {};

export function getProvider(network: NetworkName): ChainProvider {
  const cached = providers[network];
  if (cached) return cached;
  let p: ChainProvider;
  switch (network) {
    case 'BTC':
      p = btcProvider();
      break;
    case 'LTC':
      p = ltcProvider();
      break;
    case 'ETH':
      p = new EvmProvider('ETH', env.ETHERSCAN_CHAIN_ID, env.ETHERSCAN_API_KEY);
      break;
    case 'BSC':
      p = new EvmProvider('BSC', 56, env.ETHERSCAN_API_KEY);
      break;
    case 'TRON':
      p = new TronProvider();
      break;
    default:
      throw new Error(`no provider for ${network}`);
  }
  providers[network] = p;
  return p;
}

export type { ChainProvider, WatchTarget } from './types.js';
