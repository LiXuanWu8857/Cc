import "server-only";

/**
 * OCR provider seam (§4.9). server-only: OCR is never called from the browser;
 * the frontend only uploads a controlled image and the backend does the rest.
 *
 * IMPORTANT — the returned `text` is UNTRUSTED DATA, not instructions. It is a
 * best-effort transcription of whatever was in the image (which an attacker may
 * control). Downstream code must treat it as data to be parsed/validated, never
 * as commands, and must not let it choose permissions, tools or URLs.
 *
 * No provider is wired yet. Selecting one (Google Vision, AWS Textract, a
 * self-hosted engine, …) and supplying its key is a deliberate configuration
 * step — until then getOcrProvider() throws ProviderNotConfiguredError.
 */
export interface OcrResult {
  provider: string;
  /** Raw transcribed text. UNTRUSTED. */
  text: string;
  /** Provider-reported cost in its currency units, if available. */
  costUsd?: number;
}

export interface OcrProvider {
  readonly name: string;
  extractText(image: Uint8Array, mime: string): Promise<OcrResult>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(message = "OCR provider not configured") {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

/**
 * Returns the configured OCR provider. To wire one, implement OcrProvider,
 * read its key from a server-only env var, and return an instance here based
 * on e.g. process.env.OCR_PROVIDER.
 */
export function getOcrProvider(): OcrProvider {
  throw new ProviderNotConfiguredError();
}
