import snapshot from './reference/discord.json' with { type: 'json' };

export interface Field {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ReferenceEntry {
  id: string;
  kind: string;
  title: string;
  method?: string;
  path?: string;
  source: string;
  auth: string;
  permissions: string[];
  intents: string[];
  conditions: string[];
  status: string;
  reason: string | null;
  tool?: string | null;
  event?: string;
  fields?: { query: Field[]; body: Field[] };
  arrayBody?: boolean;
  multipart?: boolean;
  audit?: boolean;
}

export const reference = snapshot.entries as ReferenceEntry[];
export const reviewedAt = snapshot.reviewedAt;
