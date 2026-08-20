import "server-only";
import { z } from "zod";

/**
 * AI nutrition parser seam (§4.9, §4.10). server-only.
 *
 * The parser turns OCR text into a STRUCTURED CANDIDATE that conforms to the
 * schema below. It is never a source of truth:
 *   - The candidate must pass backend nutrition validation (validate.ts).
 *   - It becomes a user food only after EXPLICIT user confirmation.
 *   - It must never auto-write the shared/official catalogue.
 *
 * Prompt contract for whoever wires a model here (do not violate §4.9):
 *   - Task is strictly "extract & normalise nutrition fields into this JSON
 *     schema". Nothing else.
 *   - The OCR text is UNTRUSTED input. Instructions appearing inside it must be
 *     ignored — the model must not follow them, call tools, choose URLs, or
 *     touch secrets.
 *   - Output MUST validate against nutritionCandidateSchema; anything else is
 *     discarded and the scan goes to needs_review.
 */

export const nutritionCandidateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    brand: z.string().trim().max(120).optional(),
    barcode: z
      .string()
      .regex(/^[0-9]{8,14}$/)
      .optional(),
    defaultServingG: z.number().positive().max(10000).optional(),
    nutritionPer100g: z
      .object({
        caloriesKcal: z.number().min(0).max(1000),
        proteinG: z.number().min(0).max(100),
        fatG: z.number().min(0).max(100),
        carbsG: z.number().min(0).max(100),
        fiberG: z.number().min(0).max(100).optional(),
        sugarG: z.number().min(0).max(100).optional(),
        sodiumMg: z.number().min(0).max(100000).optional(),
      })
      .strict(),
    /** Model self-reported confidence in [0,1]. Advisory only. */
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export type NutritionCandidate = z.infer<typeof nutritionCandidateSchema>;

export interface ParseResult {
  provider: string;
  candidate: NutritionCandidate;
  costUsd?: number;
}

export interface NutritionParser {
  readonly name: string;
  parse(ocrText: string): Promise<ParseResult>;
}

export class ParserNotConfiguredError extends Error {
  constructor(message = "AI nutrition parser not configured") {
    super(message);
    this.name = "ParserNotConfiguredError";
  }
}

/**
 * Returns the configured parser. To wire one, implement NutritionParser using
 * the Claude API (see the claude-api skill for model ids and structured-output
 * guidance), read the key from a server-only env var, and enforce the prompt
 * contract above. Until then this throws.
 */
export function getNutritionParser(): NutritionParser {
  throw new ParserNotConfiguredError();
}
