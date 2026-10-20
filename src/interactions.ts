import type { DiscordRest } from './rest.js';
import type { Upload } from './rest.js';
import { ToolError, Vault, sanitize } from './errors.js';
import type { EventQueue } from './events.js';

export interface InteractionRule {
  id: string;
  command_name?: string;
  custom_id?: string;
  interaction_type?: number;
  response: { type: number; data?: Record<string, unknown> };
}

interface InteractionState {
  id: string;
  token: string;
  application_id: string;
  acknowledged: boolean;
  response_type?: number;
  expires: number;
  acknowledgement_deadline: number;
}

export class Interactions {
  private vault = new Vault();
  private states = new Map<string, InteractionState>();
  private rules = new Map<string, InteractionRule>();

  constructor(private readonly rest: DiscordRest, private readonly events: EventQueue) {}

  listRules(): InteractionRule[] { return [...this.rules.values()]; }

  setRule(rule: InteractionRule): InteractionRule {
    if (!rule.command_name && !rule.custom_id && !rule.interaction_type) throw new ToolError('INVALID_RULE', 'An interaction rule needs at least one matcher.');
    if (![0, 4, 5, 6, 7, 8, 9, 12].includes(rule.response.type)) throw new ToolError('INVALID_RULE', 'Unsupported interaction response type.');
    if (rule.response.type === 8 && rule.interaction_type !== 4) throw new ToolError('INVALID_RULE', 'Autocomplete rules must match interaction_type 4.');
    if (rule.response.type === 9 && rule.interaction_type !== 2 && rule.interaction_type !== 3) throw new ToolError('INVALID_RULE', 'Modal rules must match command or component interactions.');
    if ([6, 7].includes(rule.response.type) && rule.interaction_type !== 3 && rule.interaction_type !== 5) throw new ToolError('INVALID_RULE', 'Message update responses must match a component or modal submission.');
    if (this.rules.size >= 1000 && !this.rules.has(rule.id)) throw new ToolError('RULE_CAPACITY', 'The interaction rule limit is 1000.');
    this.rules.set(rule.id, rule);
    return rule;
  }

  deleteRule(id: string): { deleted: boolean } { return { deleted: this.rules.delete(id) }; }

  async receive(data: Record<string, unknown>): Promise<void> {
    for (const [handle, state] of this.states) if (state.expires <= Date.now()) this.states.delete(handle);
    const id = String(data.id);
    const token = String(data.token);
    const handle = this.vault.put(id, token);
    const state: InteractionState = { id, token, application_id: String(data.application_id), acknowledged: false, expires: Date.now() + 900000, acknowledgement_deadline: Date.now() + 3000 };
    this.states.set(handle, state);
    const payload = data.data as Record<string, unknown> | undefined;
    const type = Number(data.type);
    const rule = this.listRules().find(rule => (!rule.command_name || rule.command_name === payload?.name) && (!rule.custom_id || rule.custom_id === payload?.custom_id) && (!rule.interaction_type || rule.interaction_type === type));
    const response = rule?.response ?? (type === 4 ? { type: 8, data: { choices: [] } } : type === 3 ? { type: 6 } : { type: 5, data: { flags: 64 } });
    if (response.type === 0) {
      this.events.push('INTERACTION_CREATE', { ...sanitize(data) as object, interaction_handle: handle, acknowledgement: null, acknowledgement_deadline: new Date(state.acknowledgement_deadline).toISOString() });
      return;
    }
    try {
      await this.rest.execute({ method: 'POST', path: `/interactions/${id}/${token}/callback`, auth: '', body: response });
      state.acknowledged = true;
      state.response_type = response.type;
      this.events.push('INTERACTION_CREATE', { ...sanitize(data) as object, interaction_handle: handle, acknowledgement: response.type });
    } catch (error) {
      this.events.push('INTERACTION_FAILED', { interaction_id: id, message: error instanceof ToolError ? error.message : 'Interaction acknowledgement failed.' }, 'system');
    }
  }

  resolve(handle: string): InteractionState {
    this.vault.get(handle);
    const state = this.states.get(handle);
    if (!state) throw new ToolError('INTERACTION_EXPIRED', 'Interaction handle expired.');
    return state;
  }

  async respond(handle: string, body: unknown, query?: Record<string, unknown>, files?: Upload[], signal?: AbortSignal): Promise<unknown> {
    const state = this.resolve(handle);
    if (state.acknowledged) throw new ToolError('ALREADY_ACKNOWLEDGED', 'Edit the original response or create a followup.');
    if (state.acknowledgement_deadline <= Date.now()) throw new ToolError('INTERACTION_DEADLINE', 'The three-second initial response deadline has expired.');
    state.acknowledged = true;
    return this.rest.execute({ method: 'POST', path: `/interactions/${state.id}/${state.token}/callback`, auth: '', body, query, files, signal });
  }
}
