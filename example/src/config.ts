/**
 * Demo configuration: which model to download and the agent's behavior.
 *
 * Qwen2.5-1.5B-Instruct (Q4_K_M) is a strong small model for on-device
 * tool-calling. Swap MODEL for a smaller/larger GGUF to trade speed vs quality.
 */
export const MODEL = {
  /** Single-file GGUF download (bartowski quant repo). */
  url: 'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
  /** Local filename to store it as. */
  fileName: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
  /** Approx download size, for the UI. */
  sizeLabel: '~1.1 GB',
  /** Context window. */
  nCtx: 4096,
};

export const SYSTEM_PROMPT =
  'You are a helpful assistant running entirely on the user\'s device. ' +
  'You can call tools to take real actions (clipboard, files, web requests, ' +
  'notifications) or to fetch information. Prefer calling a tool when it lets ' +
  'you actually do what the user asked, rather than describing how. When a ' +
  'tool returns, summarize the outcome for the user in plain language.';
