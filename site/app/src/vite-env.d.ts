/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_AGORA_ORIGIN?: string;
  readonly VITE_AGORA_VERIFIER_KEY?: string;
  readonly VITE_AGORA_MIRROR?: string;
  readonly VITE_AGORA_REGISTRY?: string;
  readonly VITE_AGORA_POLL?: string;
  readonly VITE_AGORA_DEV?: string;
}
