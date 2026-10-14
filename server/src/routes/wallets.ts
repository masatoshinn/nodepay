import { Router } from 'express';
import { z } from 'zod';
import type { NetworkName } from '../lib/chains.js';
import { prisma } from '../lib/prisma.js';
import { h, badRequest, notFound } from '../lib/errors.js';
import { validateBody } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { validateAddress } from '../lib/address.js';
import { deriveAddress, isXpub } from '../lib/hd.js';
import type { RequestHandler } from 'express';

export const walletsRouter = Router();
walletsRouter.use(requireAuth);

const NETWORKS = ['BTC', 'LTC', 'ETH', 'BSC', 'TRON'] as const;

const createWallet = z
  .object({
    network: z.enum(NETWORKS),
    address: z.string().max(120).optional(),
    xpub: z.string().max(200).optional(),
    derivationPath: z.string().max(60).optional(),
    label: z.string().max(60).optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((v) => !!v.address || !!v.xpub, { message: 'address or xpub is required' });

const ownWallet: RequestHandler = async (req, _res, next) => {
  const w = await prisma.wallet.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!w) return next(notFound('Wallet not found'));
  (req as any).wallet = w;
  next();
};

walletsRouter.get(
  '/',
  h(async (req, res) => {
    const wallets = await prisma.wallet.findMany({
      where: { userId: req.user!.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    res.json({
      wallets: wallets.map((w) => ({
        id: w.id,
        network: w.network,
        address: w.address,
        hasXpub: !!w.xpub,
        xpubFingerprint: w.xpub ? `${w.xpub.slice(0, 8)}…${w.xpub.slice(-4)}` : null,
        derivationPath: w.derivationPath,
        nextIndex: w.nextIndex,
        label: w.label,
        isDefault: w.isDefault,
        createdAt: w.createdAt.toISOString(),
      })),
    });
  })
);

walletsRouter.post(
  '/',
  validateBody(createWallet),
  h(async (req, res) => {
    const { network, address, xpub, derivationPath, label, isDefault } = req.body;

    if (xpub) {
      if (!isXpub(xpub)) throw badRequest('Invalid xpub (expected xpub/ypub/zpub). Private keys are never accepted.');
      if (derivationPath && !derivationPath.startsWith('m/')) throw badRequest('derivationPath must start with m/');
      // prove derivation actually works for this network before storing
      try {
        deriveAddress(xpub.trim(), network as NetworkName, 0, derivationPath ?? null);
      } catch (e) {
        throw badRequest(`xpub rejected: ${(e as Error).message}`);
      }
    }
    if (address && !validateAddress(address, network as NetworkName)) {
      throw badRequest(`Invalid ${network} address format`);
    }
    if (!xpub && !address) throw badRequest('address or xpub is required');

    const dup = await prisma.wallet.findFirst({
      where: {
        userId: req.user!.id,
        network,
        OR: [
          ...(address ? [{ address }] : []),
          ...(xpub ? [{ xpub }] : []),
        ],
      },
    });
    if (dup) throw badRequest('This wallet is already added for this network');

    if (isDefault) {
      await prisma.wallet.updateMany({
        where: { userId: req.user!.id, network },
        data: { isDefault: false },
      });
    }

    const wallet = await prisma.wallet.create({
      data: {
        userId: req.user!.id,
        network,
        address: address ?? null,
        xpub: xpub ? xpub.trim() : null,
        derivationPath: derivationPath ?? (xpub ? undefined : null),
        label: label ?? null,
        isDefault: isDefault ?? false,
      },
    });
    await audit(req, 'wallet.create', wallet.id, { network, hd: !!xpub });
    res.status(201).json({ wallet: { id: wallet.id, network: wallet.network, address: wallet.address, hasXpub: !!wallet.xpub } });
  })
);

/** derive & show the next N addresses (read-only preview — no funds, no keys) */
walletsRouter.get(
  '/:id/addresses',
  ownWallet,
  h(async (req, res) => {
    const wallet = (req as any).wallet;
    if (!wallet.xpub) throw badRequest('Wallet has no xpub — address derivation unavailable');
    const count = Math.min(Number(req.query.count ?? 5) || 5, 20);
    const addresses: { index: number; address: string }[] = [];
    for (let i = wallet.nextIndex; i < wallet.nextIndex + count; i++) {
      addresses.push({
        index: i,
        address: deriveAddress(wallet.xpub, wallet.network as NetworkName, i, wallet.derivationPath),
      });
    }
    res.json({ addresses });
  })
);

walletsRouter.patch(
  '/:id',
  ownWallet,
  validateBody(z.object({ label: z.string().max(60).optional(), isDefault: z.boolean().optional() })),
  h(async (req, res) => {
    const wallet = (req as any).wallet;
    if (req.body.isDefault) {
      await prisma.wallet.updateMany({
        where: { userId: req.user!.id, network: wallet.network },
        data: { isDefault: false },
      });
    }
    const updated = await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        ...(req.body.label !== undefined ? { label: req.body.label } : {}),
        ...(req.body.isDefault !== undefined ? { isDefault: req.body.isDefault } : {}),
      },
    });
    res.json({ wallet: { id: updated.id, label: updated.label, isDefault: updated.isDefault } });
  })
);

walletsRouter.delete(
  '/:id',
  ownWallet,
  h(async (req, res) => {
    const wallet = (req as any).wallet;
    const openInvoices = await prisma.invoice.count({
      where: { walletId: wallet.id, status: { in: ['WAITING', 'DETECTED', 'CONFIRMING', 'UNDERPAID', 'OVERPAID'] } },
    });
    if (openInvoices > 0) throw badRequest(`Wallet has ${openInvoices} open invoice(s)`);
    await prisma.wallet.delete({ where: { id: wallet.id } });
    await audit(req, 'wallet.delete', wallet.id);
    res.json({ ok: true });
  })
);
