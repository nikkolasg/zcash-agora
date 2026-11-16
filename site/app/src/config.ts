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
  /** The poll shown: `?q=<id>` among `polls`, else the first. */
  poll: number;
  /** The polls of the page, in the order of the question list. */
  polls: number[];
  /** The audit opens once every poll of the list has closed (Unix time): before, it would count the ballots. */
  auditFrom: number;
  /** The dev passport provider of a local trial: type an identifier instead of scanning. */
  dev: boolean;
  zkpassport: { name: string; purpose: string; logo?: string };
}

const env = import.meta.env;
const polls: number[] = env.VITE_AGORA_POLL ? [Number(env.VITE_AGORA_POLL)] : cfg.polls;
const asked = Number(new URLSearchParams(location.search).get('q'));

export const config: AgoraConfig = {
  name: cfg.name,
  origin: env.VITE_AGORA_ORIGIN || cfg.origin,
  verifierKey: env.VITE_AGORA_VERIFIER_KEY || cfg.verifierKey,
  mirror: env.VITE_AGORA_MIRROR ? { url: env.VITE_AGORA_MIRROR } : cfg.mirror,
  registry: Number(env.VITE_AGORA_REGISTRY || cfg.registry),
  poll: polls.includes(asked) ? asked : polls[0],
  polls,
  auditFrom: env.VITE_AGORA_POLL ? 0 : cfg.auditFrom,
  dev: env.VITE_AGORA_DEV === '1',
  zkpassport: cfg.zkpassport
};
