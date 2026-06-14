/**
 * BetweenUsAgent — thin wrapper around LlamaEngine for the Between Us flow.
 *
 * One instance per person per session. Call load() once after model download,
 * then call the phase methods as the user moves through screens.
 *
 * All methods return typed objects parsed from the LLM's JSON output.
 * If parsing fails, they return the mock fallback so the UI never breaks.
 */
import type { LlamaEngine } from 'react-native-device-agent';
import type {
  AgentMove,
  DebriefInsight,
  IntakeAnswer,
  MoveType,
  PersonId,
  SessionContext,
  VerdictResult,
} from '../types';
import {
  debriefSystemPrompt,
  intakeFollowUpPrompt,
  intakeSystemPrompt,
  negotiationSystemPrompt,
  verdictSystemPrompt,
} from './prompts';
import { MOCK_INSIGHT } from '../screens/Screen3';
import { MOCK_VERDICT } from '../screens/Screen4';

export const MODEL_URL =
  'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf';

export const MODEL_FILENAME = 'qwen2.5-3b-instruct-q4_k_m.gguf';

// Context window — 3B model fits comfortably at 4096
const N_CTX = 4096;

export class BetweenUsAgent {
  private engine: LlamaEngine | null = null;
  private ctx: SessionContext | null = null;
  private intake: IntakeAnswer | null = null;
  private personId: PersonId = 'A';

  setContext(ctx: SessionContext, intake: IntakeAnswer, personId: PersonId) {
    this.ctx = ctx;
    this.intake = intake;
    this.personId = personId;
  }

  async load(engine: LlamaEngine) {
    this.engine = engine;
  }

  get ready() {
    return this.engine !== null;
  }

  // ── Intake (Screen 1) ────────────────────────────────────────────────────

  async getFirstQuestion(name: string): Promise<string> {
    if (!this.engine || !this.ctx) return 'What would feel like a good outcome for you?';
    const system = intakeSystemPrompt(this.ctx, name);
    const prompt = 'Ask your first question.';
    return this.complete(system, prompt);
  }

  async getFollowUpQuestion(
    name: string,
    previousQA: { question: string; answer: string }[]
  ): Promise<string | null> {
    if (!this.engine || !this.ctx) return null;
    if (previousQA.length >= 4) return null;
    const system = intakeSystemPrompt(this.ctx, name);
    const prompt = intakeFollowUpPrompt(previousQA);
    return this.complete(system, prompt);
  }

  // ── Negotiation (Screen 2) ───────────────────────────────────────────────

  async generateMove(round: number): Promise<AgentMove> {
    const fallback: AgentMove = {
      agentId: this.personId,
      moveType: 'position',
      intent: 'opening position',
      payload: { text: 'Exploring what works for both sides.' },
      round,
      timestamp: Date.now(),
    };

    if (!this.engine || !this.ctx || !this.intake) return fallback;

    const system = negotiationSystemPrompt(
      this.ctx,
      this.intake,
      this.personId,
      round
    );

    try {
      const raw = await this.complete(system, 'Generate your move.');
      const parsed = JSON.parse(this.extractJSON(raw));
      return {
        agentId: this.personId,
        moveType: (parsed.moveType as MoveType) ?? 'position',
        intent: parsed.intent ?? '',
        payload: parsed.payload ?? {},
        round,
        timestamp: Date.now(),
      };
    } catch {
      return fallback;
    }
  }

  // ── Debrief (Screen 3) ───────────────────────────────────────────────────

  async generateDebrief(moves: AgentMove[]): Promise<DebriefInsight> {
    if (!this.engine) return MOCK_INSIGHT;

    const system = debriefSystemPrompt(moves, this.personId);

    try {
      const raw = await this.complete(system, 'Generate the debrief.');
      const parsed = JSON.parse(this.extractJSON(raw));
      return {
        whatTheyCareAbout: parsed.whatTheyCareAbout ?? MOCK_INSIGHT.whatTheyCareAbout,
        whereThereIsAGap: parsed.whereThereIsAGap ?? MOCK_INSIGHT.whereThereIsAGap,
        whatAgentNeedsFromYou: parsed.whatAgentNeedsFromYou ?? null,
      };
    } catch {
      return MOCK_INSIGHT;
    }
  }

  // ── Verdict (Screen 4) ───────────────────────────────────────────────────

  async generateVerdict(moves: AgentMove[]): Promise<VerdictResult> {
    if (!this.engine || !this.ctx || !this.intake) return MOCK_VERDICT;

    const system = verdictSystemPrompt(
      this.ctx,
      this.intake,
      moves,
      this.personId
    );

    try {
      const raw = await this.complete(system, 'Generate the verdict.');
      const parsed = JSON.parse(this.extractJSON(raw));
      return {
        sharedAgreement: parsed.sharedAgreement ?? MOCK_VERDICT.sharedAgreement,
        whatItMeansForYou: parsed.whatItMeansForYou ?? MOCK_VERDICT.whatItMeansForYou,
        whatTheyGet: parsed.whatTheyGet ?? MOCK_VERDICT.whatTheyGet,
      };
    } catch {
      return MOCK_VERDICT;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async complete(system: string, user: string): Promise<string> {
    if (!this.engine) return '';
    const result = await this.engine.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    return result.trim();
  }

  // Pull the first {...} block out of a potentially verbose LLM response
  private extractJSON(text: string): string {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found');
    return match[0];
  }
}

export const betweenUsAgent = new BetweenUsAgent();
