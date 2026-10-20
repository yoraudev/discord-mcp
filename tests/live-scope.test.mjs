import { describe, it, expect } from 'vitest';
import { LiveScope } from '../tools/live-scope.mjs';

describe('isolated live-test scope', () => {
  const make = () => new LiveScope('1', '2', [{ id: '10', name: 'gifs' }, { id: '11', name: 'existing' }, { id: '12', name: 'thread', parent_id: '10' }], 'mcp-test-');

  it('protects gifs, existing channels, descendants and other guilds from every tool call', () => {
    const scope = make();
    for (const id of ['10', '11', '12']) expect(() => scope.assertCall({ title: 'Get Channel', method: 'GET' }, { channel_id: id })).toThrow('protected');
    expect(() => scope.assertCall({ title: 'Get Guild', method: 'GET' }, { guild_id: '3' })).toThrow('restricted');
    expect(() => scope.remember('channel', '10')).toThrow('newly created');
  });

  it('allows creation and cleanup only within the new test category', () => {
    const scope = make();
    scope.remember('channel', '20');
    expect(() => scope.assertCall({ title: 'Create Guild Channel', method: 'POST' }, { guild_id: '1', body: { name: 'mcp-test-text', type: 0, parent_id: '20' } })).not.toThrow();
    expect(() => scope.assertCall({ title: 'Create Guild Channel', method: 'POST' }, { guild_id: '1', body: { name: 'mcp-test-text', type: 0, parent_id: '10' } })).toThrow('categories');
    expect(() => scope.assertCall({ title: 'Modify Guild', method: 'PATCH' }, { guild_id: '1', body: { name: 'changed' } })).toThrow('not allowlisted');
  });

  it('protects existing roles and requires disabled AutoMod rules', () => {
    const scope = make();
    expect(() => scope.assertCall({ title: 'Delete Guild Role', method: 'DELETE' }, { guild_id: '1', role_id: '99' })).toThrow('does not own');
    expect(() => scope.assertCall({ title: 'Create Auto Moderation Rule', method: 'POST' }, { guild_id: '1', body: { enabled: true } })).toThrow('disabled');
    expect(() => scope.assertCall({ title: 'Create Guild Role', method: 'POST' }, { guild_id: '1', body: { name: 'mcp-test-role', permissions: '8' } })).toThrow('must not grant');
  });

  it('limits moderation to the selected non-owner test account and preserves message history', () => {
    const scope = make();
    expect(() => scope.authorizeMember({ user: { id: '3' } }, '3')).toThrow('non-owner');
    scope.authorizeMember({ user: { id: '4', bot: false } }, '3');
    expect(() => scope.assertCall({ title: 'Remove Guild Member', method: 'DELETE' }, { guild_id: '1', user_id: '3' })).toThrow('authorized test member');
    expect(() => scope.assertCall({ title: 'Create Guild Ban', method: 'PUT' }, { guild_id: '1', user_id: '4', body: { delete_message_seconds: 86400 } })).toThrow('preserve');
    expect(() => scope.assertCall({ title: 'Create Guild Ban', method: 'PUT' }, { guild_id: '1', user_id: '4', body: { delete_message_seconds: 0 } })).not.toThrow();
  });
});
