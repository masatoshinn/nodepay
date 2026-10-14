import { pbkdf2Sync } from 'node:crypto';
import { HDKey } from '@scure/bip32';
import { deriveAddress } from './src/lib/hd.js';
import { validateAddress, toChecksumAddress, b58check } from './src/lib/address.js';
import { paymentUri } from './src/lib/uri.js';
import { roundAmount, amountsEqual } from './src/lib/chains.js';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (!cond) {
    failures++;
    console.error(`FAIL  ${name}`, extra ?? '');
  } else {
    console.log(`ok    ${name}`, extra ?? '');
  }
}

// BIP84 test vector: mnemonic "abandon ... about"
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = pbkdf2Sync(mnemonic, 'mnemonic', 2048, 64, 'sha512');
const root = HDKey.fromMasterSeed(seed);

// --- BTC native segwit via zpub ---
const zNode = root.derive("m/84'/0'/0'");
const xpubAt84 = zNode.publicExtendedKey;
const raw = b58check.decode(xpubAt84);
const zBytes = new Uint8Array(raw);
zBytes.set([0x04, 0xb2, 0x47, 0x46], 0);
const zpub = b58check.encode(zBytes);
const btc0 = deriveAddress(zpub, 'BTC', 0);
check('BIP84 vector BTC addr #0', btc0 === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', btc0);
const btc1 = deriveAddress(zpub, 'BTC', 1);
check('BIP84 vector BTC addr #1', btc1 === 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g', btc1);

// --- BTC legacy via xpub (m/44'/0'/0') ---
const xNode = root.derive("m/44'/0'/0'");
const xpub = xNode.publicExtendedKey;
const legacy = deriveAddress(xpub, 'BTC', 0);
check('BIP44 BTC legacy format', /^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(legacy) && validateAddress(legacy, 'BTC'), legacy);

// --- ETH via xpub (m/44'/60'/0') ---
const ethNode = root.derive("m/44'/60'/0'");
const ethXpub = ethNode.publicExtendedKey;
const eth0 = deriveAddress(ethXpub, 'ETH', 0);
check(
  'BIP44 ETH addr #0',
  eth0 === '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
  eth0
);

// --- TRON via xpub (m/44'/195'/0') ---
const tronNode = root.derive("m/44'/195'/0'");
const tronXpub = tronNode.publicExtendedKey;
const tron0 = deriveAddress(tronXpub, 'TRON', 0);
check('TRON addr format', /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(tron0) && validateAddress(tron0, 'TRON'), tron0);

// --- address validation ---
check('valid eth checksum', validateAddress('0x9858EfFD232B4033E47d90003D41EC34EcaEda94', 'ETH'));
check('reject bad eth', !validateAddress('0x9858EfFD232B4033E47d90003D41EC34EcaEda95', 'ETH'));
check('reject eth on btc', !validateAddress('0x9858EfFD232B4033E47d90003D41EC34EcaEda94', 'BTC'));
check('reject garbage tron', !validateAddress('Tnotavalidtronaddress00000000000', 'TRON'));
check('accept bech32', validateAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'BTC'));
check('reject bad bech32', !validateAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyx', 'BTC'));
check('checksum helper', toChecksumAddress('0x9858effd232b4033e47d90003d41ec34ecaeda94') === '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');

// base58check roundtrip
const rt = b58check.decode(b58check.encode(new Uint8Array([0x41, 1, 2, 3])));
check('base58check roundtrip', rt.length === 4 && rt[0] === 0x41);

// --- URIs ---
check(
  'BIP21 uri',
  paymentUri({ address: btc0, amount: '0.0015', coin: 'BTC', network: 'BTC' }) ===
    `bitcoin:${btc0}?amount=0.0015`
);
const eip = paymentUri({ address: eth0, amount: '1.5', coin: 'ETH', network: 'ETH' });
check('EIP-681 native wei', eip === `ethereum:${eth0}@1?value=1500000000000000000`, eip);
const eipToken = paymentUri({ address: eth0, amount: '10.5', coin: 'USDT', network: 'ETH' });
check(
  'EIP-681 USDT (6 decimals)',
  eipToken.includes('/transfer?') && eipToken.endsWith('uint256=10500000'),
  eipToken
);
const eipBsc = paymentUri({ address: eth0, amount: '10.5', coin: 'USDT', network: 'BSC' });
check('EIP-681 USDT on BSC (18 decimals)', eipBsc.endsWith('uint256=10500000000000000000'), eipBsc);
const tronUri = paymentUri({ address: tron0, amount: '10.000137', coin: 'USDT', network: 'TRON' });
check('tron uri', tronUri.startsWith('tron:'), tronUri);

// --- amount rounding ---
check('round 8dp', roundAmount('0.1234567899999', 8) === '0.12345679');
check('round offset', roundAmount(0.000137, 6) === '0.000137');
check('equal compare', amountsEqual('10.0001370000', '10.000137', 6));
check('not equal', !amountsEqual('10.000136', '10.000137', 6));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);


