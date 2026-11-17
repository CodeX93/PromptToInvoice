import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { draftOutputSchema, type DraftOutput } from "./schema";
import { INSTRUCTIONS, contextBlock, userTurn, type PromptContext } from "./prompt";

export const DEFAULT_MODEL = "claude-opus-5-5";

export interface ExtractUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export type ExtractResult =
  | {
      status: "ok";
      output: DraftOutput;
      usage: ExtractUsage;
      model: string;
      requestId: string | null;
      latencyMs: number;
    }
  | {
      status: "refused" | "invalid" | "error";
      error: string;
      usage: ExtractUsage | null;
      model: string;
      requestId: string | null;
      latencyMs: number;
      retryable: boolean;
    };

export interface ExtractArgs {
  client: Anthropic;
  prompt: string;
  context: PromptContext;
  model?: string;
  /** Pin inference to a region (e.g. "eu") when the organisation requires it. */
  inferenceGeo?: string | null;
  signal?: AbortSignal;
}

/**
 * One structured-output call. Extraction is a narrow task, so effort is
 * "low": fast and cheap, and the server validates everything anyway.
 * Server-side fallbacks re-run a policy-declined request on another model
 * inside the same call.
 */
export async function extractDraft(a: ExtractArgs): Promise<ExtractResult> {
  const model = a.model ?? DEFAULT_MODEL;
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  try {
    const response = await a.client.beta.messages.parse(
      {
        model,
        max_tokens: 4096,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        ...(a.inferenceGeo ? { inference_geo: a.inferenceGeo } : {}),
        system: [
          { type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" } },
          { type: "text", text: contextBlock(a.context), cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: userTurn(a.prompt, a.context.today) }],
        output_config: { effort: "low", format: betaZodOutputFormat(draftOutputSchema) },
      },
      { signal: a.signal, timeout: 45_000, maxRetries: 2 },
    );
    const usage: ExtractUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    };
    const requestId = (response as { _request_id?: string | null })._request_id ?? null;
    if (response.stop_reason === "refusal") {
      return {
        status: "refused",
        error: "The request was declined.",
        usage,
        model,
        requestId,
        latencyMs: ms(),
        retryable: false,
      };
    }
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      return {
        status: "invalid",
        error: "The draft could not be read.",
        usage,
        model,
        requestId,
        latencyMs: ms(),
        retryable: true,
      };
    }
    return {
      status: "ok",
      output: response.parsed_output,
      usage,
      model: response.model,
      requestId,
      latencyMs: ms(),
    };
  } catch (err) {
    const retryable =
      err instanceof Anthropic.RateLimitError ||
      err instanceof Anthropic.InternalServerError ||
      err instanceof Anthropic.APIConnectionError ||
      (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500);
    const message =
      err instanceof Anthropic.AuthenticationError
        ? "AI is misconfigured (authentication)."
        : err instanceof Anthropic.RateLimitError
          ? "AI is busy right now. Try again in a moment."
          : err instanceof Anthropic.BadRequestError
            ? "The AI request was rejected."
            : err instanceof Anthropic.APIConnectionError
              ? "Couldn't reach the AI service."
              : err instanceof Error && err.name === "AbortError"
                ? "Cancelled."
                : "The AI service failed.";
    const requestId = err instanceof Anthropic.APIError ? (err.requestID ?? null) : null;
    return {
      status: "error",
      error: message,
      usage: null,
      model,
      requestId,
      latencyMs: ms(),
      retryable,
    };
  }
}
