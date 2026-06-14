import type { ToolSpec, ToolCall } from 'react-native-device-agent';
import type { MediationAction } from './types';

/**
 * The "control" tools an agent uses to take exactly one structured action per
 * turn. We hand these to the model as tool specs but DON'T execute them — the
 * orchestrator intercepts the call and turns it into a {@link MediationAction}.
 * (Read-only context tools, by contrast, are real and run mid-turn.)
 */
export const CONTROL_TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'send_message',
      description:
        'Say something to the other party\'s counselor: a point, a question, ' +
        'an acknowledgement, or a step toward agreement.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'What to say to the other counselor.' },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_my_user',
      description:
        'Pause and ask YOUR OWN user for more information. Use only when you ' +
        'genuinely cannot proceed without a fact only they know. Give them a ' +
        'short summary of where things stand plus specific questions.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Brief status update for your user.' },
          questions: {
            type: 'array',
            description: 'Specific questions for your user.',
            items: { type: 'string' },
          },
        },
        required: ['summary', 'questions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_resolution',
      description:
        'Table a concrete resolution you believe is fair to both parties, when ' +
        'enough has been discussed to do so.',
      parameters: {
        type: 'object',
        properties: {
          proposal: { type: 'string', description: 'The proposed resolution, stated clearly.' },
        },
        required: ['proposal'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agree',
      description: 'Accept the resolution the other counselor just proposed, as fair to your party.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const CONTROL_NAMES = new Set(CONTROL_TOOLS.map((t) => t.function.name));

export const isControlTool = (name: string): boolean => CONTROL_NAMES.has(name);

/** Convert an intercepted control-tool call into a MediationAction. */
export function parseControlAction(call: ToolCall): MediationAction | null {
  let args: any = {};
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    args = {};
  }
  switch (call.function.name) {
    case 'send_message':
      return { kind: 'message', text: String(args.message ?? '').trim() };
    case 'ask_my_user':
      return {
        kind: 'ask_user',
        summary: String(args.summary ?? '').trim(),
        questions: Array.isArray(args.questions) ? args.questions.map(String) : [],
      };
    case 'propose_resolution':
      return { kind: 'propose', proposal: String(args.proposal ?? '').trim() };
    case 'agree':
      return { kind: 'agree' };
    default:
      return null;
  }
}
