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
  /** The polls of the page. One: the page is that poll. Several: one ballot, a question per poll, cast together. */
  polls: number[];
  /** When the polls of a several-poll page close (Unix time; they close together). */
  closes: number;
  /** The dev passport provider of a local trial: type an identifier instead of scanning. */
  dev: boolean;
  zkpassport: { name: string; purpose: string; logo?: string };
}

const env = import.meta.env;
const polls: number[] = env.VITE_AGORA_POLL ? env.VITE_AGORA_POLL.split(',').map(Number) : cfg.polls;

export const config: AgoraConfig = {
  name: cfg.name,
  origin: env.VITE_AGORA_ORIGIN || cfg.origin,
  verifierKey: env.VITE_AGORA_VERIFIER_KEY || cfg.verifierKey,
  mirror: env.VITE_AGORA_MIRROR ? { url: env.VITE_AGORA_MIRROR } : cfg.mirror,
  registry: Number(env.VITE_AGORA_REGISTRY || cfg.registry),
  polls,
  closes: Number(env.VITE_AGORA_CLOSES || cfg.closes),
  dev: env.VITE_AGORA_DEV === '1',
  zkpassport: cfg.zkpassport
};
