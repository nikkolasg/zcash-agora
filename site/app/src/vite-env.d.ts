/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_AGORA_ORIGIN?: string;
  readonly VITE_AGORA_VERIFIER_KEY?: string;
  readonly VITE_AGORA_MIRROR?: string;
  readonly VITE_AGORA_REGISTRY?: string;
  /** One poll id, or several separated by commas (one ballot, a question per poll). */
  readonly VITE_AGORA_POLL?: string;
  readonly VITE_AGORA_CLOSES?: string;
  readonly VITE_AGORA_DEV?: string;
}
