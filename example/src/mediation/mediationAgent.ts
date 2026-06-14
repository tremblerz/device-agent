import type {
  LlamaEngine,
  ToolRegistry,
  ChatMessage,
  ToolCall,
} from 'react-native-device-agent';
import { CONTROL_TOOLS, isControlTool, parseControlAction } from './controlTools';
import type { MediationAction, Party, TranscriptEntry } from './types';

export interface MediationAgentOptions {
  engine: LlamaEngine;
  party: Party;
  name: string;
  otherName: string;
  topic: string;
  /** Read-only device-context tools the counselor may consult. Optional. */
  contextTools?: ToolRegistry;
  /** Emitted when the agent runs a context tool, for UI visibility. */
  onTool?: (text: string) => void;
}

/**
 * One party's impartial counselor. Each `takeTurn` produces exactly one
 * {@link MediationAction}; the agent may first call read-only context tools to
 * inform itself, then commits to an action via a control tool.
 */
export class MediationAgent {
  private engine: LlamaEngine;
  readonly party: Party;
  readonly name: string;
  private otherName: string;
  private topic: string;
  private contextTools?: ToolRegistry;
  private onTool?: (text: string) => void;
  /** Facts this agent's user has shared (grows when the user answers a pause). */
  private privateNotes: string;

  constructor(opts: MediationAgentOptions, initialContext: string) {
    this.engine = opts.engine;
    this.party = opts.party;
    this.name = opts.name;
    this.otherName = opts.otherName;
    this.topic = opts.topic;
    this.contextTools = opts.contextTools;
    this.onTool = opts.onTool;
    this.privateNotes = initialContext.trim();
  }

  /** Add information the user provided after an `ask_user` pause. */
  addUserInfo(text: string): void {
    this.privateNotes += `\n- ${text.trim()}`;
  }

  private systemPrompt(): string {
    return [
      `You are ${this.name}'s AI counselor in a private, on-device mediation with ${this.otherName}'s counselor.`,
      `You are IMPARTIAL: your job is not to "win" for ${this.name}, but to help BOTH parties reach a fair, mutually acceptable outcome.`,
      ``,
      `Agenda to resolve: ${this.topic}`,
      ``,
      `Each turn, take exactly ONE action by calling a tool:`,
      `- send_message: advance the discussion (ask, clarify, acknowledge, suggest a path).`,
      `- ask_my_user: ONLY when you need a fact that only ${this.name} can provide.`,
      `- propose_resolution: once enough is understood, table a fair resolution.`,
      `- agree: accept the other counselor's standing proposal if it is fair to ${this.name}.`,
      ``,
      `IMPORTANT: Never describe an action in prose. ALWAYS call the matching tool.`,
      `To get a fact from your own user, you MUST call ask_my_user — do not ask them in a message to the other counselor.`,
      `Be concise and constructive. Do not repeat points already made. Keep moving toward resolution.`,
    ].join('\n');
  }

  private stateMessage(transcript: TranscriptEntry[]): string {
    const convo = transcript.length
      ? transcript
          .map((e) => {
            const who = e.from === this.party ? 'You' : `${this.otherName}'s counselor`;
            const tag = e.kind === 'proposal' ? ' [PROPOSAL]' : '';
            return `${who}${tag}: ${e.text}`;
          })
          .join('\n')
      : '(No messages yet — you may open the conversation.)';

    return [
      `${this.name}'s private notes (only you can see these):`,
      this.privateNotes || '(none provided)',
      ``,
      `Conversation so far between the counselors:`,
      convo,
      ``,
      `It is your turn. Take exactly one action by calling a tool.`,
    ].join('\n');
  }

  async takeTurn(transcript: TranscriptEntry[], hint?: string): Promise<MediationAction> {
    const contextSpecs = this.contextTools?.toSpecs() ?? [];
    const tools = [...contextSpecs, ...CONTROL_TOOLS];

    const state = hint ? `${this.stateMessage(transcript)}\n\nGuidance: ${hint}` : this.stateMessage(transcript);
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt() },
      { role: 'user', content: state },
    ];

    const scratch: Record<string, unknown> = {};
    // Allow a few context-tool lookups before the agent must commit to an action.
    for (let i = 0; i < 4; i++) {
      const { content, toolCalls } = await this.engine.chat(messages, {
        tools,
        // Force a tool call so the model can't "narrate" an action (e.g. asking
        // its user) as prose that would otherwise leak into the conversation.
        toolChoice: 'required',
        temperature: 0.6,
        n_predict: 400,
      });

      let call = toolCalls?.[0];

      // Safety net for small models: if it emitted the call as text instead of
      // a structured call, recover it from the content.
      if (!call) {
        const recovered = recoverToolCallFromText(content);
        if (recovered) call = recovered;
      }

      if (!call) {
        // Truly free-form text — treat as a message, after one nudge.
        if (content.trim() && i > 0) return { kind: 'message', text: content.trim() };
        messages.push({ role: 'assistant', content });
        messages.push({ role: 'user', content: 'Respond ONLY by calling one tool. Do not write prose.' });
        continue;
      }

      if (isControlTool(call.function.name)) {
        const action = parseControlAction(call);
        if (action) return action;
      }

      // A read-only context tool — run it and feed the result back, then loop.
      messages.push({ role: 'assistant', content, tool_calls: [call] });
      const { result, error } = (await this.contextTools?.invoke(
        call.function.name,
        call.function.arguments,
        { scratch },
      )) ?? { error: `Unknown tool ${call.function.name}` };
      this.onTool?.(`🔎 ${call.function.name} → ${error ? `error: ${error}` : JSON.stringify(result)}`);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(error ? { error } : (result ?? null)),
      });
    }

    // Fallback if the agent never committed: keep the conversation alive.
    return { kind: 'message', text: 'Let me make sure I understand your concerns — can you say more?' };
  }
}

const CONTROL_NAMES = ['send_message', 'ask_my_user', 'propose_resolution', 'agree'];

/**
 * Recover a tool call a small model emitted as text rather than as a structured
 * call (e.g. a raw `{"name":"ask_my_user",...}` or a `<tool_call>…</tool_call>`
 * block). Returns null if nothing tool-shaped is found.
 */
function recoverToolCallFromText(content: string): ToolCall | null {
  if (!content || !content.includes('{')) return null;

  const candidates: string[] = [];
  const tagged = content.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
  if (tagged?.[1]) candidates.push(tagged[1]);
  candidates.push(content);

  for (const c of candidates) {
    const obj = parseToolObject(c);
    if (obj) {
      const args = obj.arguments ?? obj.parameters ?? {};
      return {
        id: 'recovered',
        type: 'function',
        function: {
          name: obj.name,
          arguments: typeof args === 'string' ? args : JSON.stringify(args),
        },
      };
    }
  }
  return null;
}

function parseToolObject(text: string): { name: string; arguments?: unknown; parameters?: unknown } | null {
  const attempt = (s: string) => {
    try {
      const o = JSON.parse(s);
      return o && typeof o.name === 'string' && CONTROL_NAMES.includes(o.name) ? o : null;
    } catch {
      return null;
    }
  };
  return attempt(text.trim()) ?? (text.match(/\{[\s\S]*\}/) ? attempt(text.match(/\{[\s\S]*\}/)![0]) : null);
}
