import { initLlama } from 'llama.rn';
import type { ChatMessage, ToolCall, ToolSpec } from './types';

/** Options for loading a GGUF model into a llama.rn context. */
export interface LlamaLoadOptions {
  /** Absolute file path or `file://` URI to a .gguf model. */
  model: string;
  /** Context window size (tokens). Default 8192. */
  n_ctx?: number;
  /** Layers to offload to GPU (Metal/OpenCL). 99 = all. Default 99. */
  n_gpu_layers?: number;
  /** Pin model in RAM to avoid swap. Default true. */
  use_mlock?: boolean;
  /** Extra llama.rn init params passed through verbatim. */
  extra?: Record<string, unknown>;
}

export interface ChatOptions {
  tools?: ToolSpec[];
  /** 'auto' (default), 'none', or 'required'. */
  toolChoice?: 'auto' | 'none' | 'required';
  temperature?: number;
  n_predict?: number;
  stop?: string[];
  /** Streaming callback for each generated token of the visible text. */
  onToken?: (text: string) => void;
}

export interface ChatResult {
  content: string;
  toolCalls?: ToolCall[];
}

/**
 * Thin, replaceable wrapper around a llama.rn context.
 *
 * Everything llama.rn-specific lives here; the rest of the harness talks to the
 * `LlamaEngine` interface only, so swapping inference backends later is local.
 */
export class LlamaEngine {
  private ctx: Awaited<ReturnType<typeof initLlama>> | null = null;
  private nCtx = 0;

  get isLoaded(): boolean {
    return this.ctx !== null;
  }

  /** The context window (in tokens) this model was loaded with. */
  get contextSize(): number {
    return this.nCtx;
  }

  static async load(options: LlamaLoadOptions): Promise<LlamaEngine> {
    const engine = new LlamaEngine();
    await engine.loadModel(options);
    return engine;
  }

  async loadModel(options: LlamaLoadOptions): Promise<void> {
    if (this.ctx) await this.release();
    this.nCtx = options.n_ctx ?? 8192;
    this.ctx = await initLlama({
      model: options.model,
      n_ctx: this.nCtx,
      n_gpu_layers: options.n_gpu_layers ?? 99,
      use_mlock: options.use_mlock ?? true,
      ...(options.extra ?? {}),
    });
  }

  /**
   * Count the tokens the given messages will occupy once rendered through the
   * model's chat template (including tool specs). Used by the agent loop to
   * keep the conversation inside the context window.
   */
  async countPromptTokens(messages: ChatMessage[], tools?: ToolSpec[]): Promise<number> {
    if (!this.ctx) throw new Error('Model not loaded. Call loadModel() first.');
    const formatted: any = await this.ctx.getFormattedChat(messages as any, null, {
      jinja: true,
      ...(tools?.length ? { tools, add_generation_prompt: true } : {}),
    });
    const prompt: string = formatted?.prompt ?? '';
    const { tokens } = await this.ctx.tokenize(prompt);
    return tokens.length;
  }

  /**
   * Run one chat turn. When `tools` are provided we enable the jinja chat
   * template so the model's native tool-calling format is parsed for us.
   */
  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    if (!this.ctx) throw new Error('Model not loaded. Call loadModel() first.');

    const hasTools = !!options.tools?.length;
    const result: any = await this.ctx.completion(
      {
        messages,
        ...(hasTools
          ? { tools: options.tools, tool_choice: options.toolChoice ?? 'auto', jinja: true }
          : {}),
        temperature: options.temperature ?? 0.7,
        n_predict: options.n_predict ?? 512,
        stop: options.stop,
      },
      (data: { token?: string }) => {
        if (data?.token && options.onToken) options.onToken(data.token);
      },
    );

    return {
      content: (result?.content ?? result?.text ?? '').trim(),
      toolCalls: normalizeToolCalls(result?.tool_calls),
    };
  }

  async release(): Promise<void> {
    if (this.ctx) {
      await this.ctx.release();
      this.ctx = null;
      this.nCtx = 0;
    }
  }
}

/** llama.rn may omit call ids; normalize into our ToolCall shape. */
function normalizeToolCalls(raw: unknown): ToolCall[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((c: any, i: number) => {
    const args = c?.function?.arguments;
    return {
      id: c?.id ?? `call_${i}`,
      type: 'function' as const,
      function: {
        name: c?.function?.name ?? c?.name ?? 'unknown',
        arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      },
    };
  });
}
