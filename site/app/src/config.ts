// What the page needs to know about the ledger. Production values come
// from ../../agora.config.json; `npm run dev -- --mode trial` reads
// .env.trial written by scripts/trial.sh and points at the local trial.
import cfg from '../../agora.config.json';

export interface AgoraConfig {
  name: string;
  origin: string;
  /** The ledger's log key, pinned: never read from the mirror. Empty before genesis. */
  verifierKey: string;
  mirror: { repo: string; branch: string } | { url: string };
  registry: number;
  poll: number;
  /** The dev passport provider of a local trial: type an identifier instead of scanning. */
  dev: boolean;
  zkpassport: { name: string; purpose: string; logo?: string };
}

const env = import.meta.env;

export const config: AgoraConfig = {
  name: cfg.name,
  origin: env.VITE_AGORA_ORIGIN || cfg.origin,
  verifierKey: env.VITE_AGORA_VERIFIER_KEY || cfg.verifierKey,
  mirror: env.VITE_AGORA_MIRROR ? { url: env.VITE_AGORA_MIRROR } : cfg.mirror,
  registry: Number(env.VITE_AGORA_REGISTRY || cfg.registry),
  poll: Number(env.VITE_AGORA_POLL || cfg.poll),
  dev: env.VITE_AGORA_DEV === '1',
  zkpassport: cfg.zkpassport
};
