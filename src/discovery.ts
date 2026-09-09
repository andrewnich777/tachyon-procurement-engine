import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { command, fail, hash } from './domain.js';

export function describe(type?: string) {
  const schema = type ? command.options.find(option => option.shape.type.value === type) : command;
  if (!schema) return fail('Unknown command type.', 404);
  return z.toJSONSchema(schema, { io: 'input' });
}

const names = ['README', 'conversation', 'escalation', 'request', 'research', 'approve-and-purchase', 'receive-and-close'] as const;
export function playbooks(name?: string) {
  const entries = names.map(name => {
    const content = readFileSync(new URL(`../playbooks/${name}.md`, import.meta.url), 'utf8');
    return { name, revision: hash(content), content };
  });
  if (!name) return { playbooks: entries };
  return entries.find(entry => entry.name === name.replace(/\.md$/, '')) ?? fail('Unknown playbook.', 404);
}
