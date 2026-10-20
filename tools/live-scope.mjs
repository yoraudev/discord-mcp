export class LiveScope {
  constructor(guildId, applicationId, channels, prefix) {
    if (!/^\d{1,20}$/.test(guildId) || !/^\d{1,20}$/.test(applicationId)) throw new Error('Explicit Discord guild and application IDs are required.');
    this.guildId = guildId;
    this.applicationId = applicationId;
    this.prefix = prefix;
    this.existingChannels = new Set(channels.map(channel => channel.id));
    this.protectedChannels = new Set(channels.filter(channel => channel.name?.toLowerCase() === 'gifs').map(channel => channel.id));
    for (const channel of channels) if (this.protectedChannels.has(channel.parent_id)) this.protectedChannels.add(channel.id);
    this.created = new Map();
    this.allowedWrites = new Set(['Create Guild Channel', 'Modify Channel', 'Set Voice Channel Status', 'Delete/Close Channel', 'Edit Channel Permissions', 'Delete Channel Permission', 'Create Channel Invite', 'Delete Invite', 'Trigger Typing Indicator', 'Create Message', 'Edit Message', 'Delete Message', 'Bulk Delete Messages', 'Create Reaction', 'Delete Own Reaction', 'Delete All Reactions', 'Delete All Reactions for Emoji', 'Pin Message', 'Unpin Message', 'End Poll', 'Start Thread from Message', 'Start Thread without Message', 'Start Thread in Forum or Media Channel', 'Join Thread', 'Leave Thread', 'Create Guild Role', 'Modify Guild Role', 'Delete Guild Role', 'Create Webhook', 'Modify Webhook', 'Modify Webhook with Token', 'Delete Webhook', 'Delete Webhook with Token', 'Execute Webhook', 'Edit Webhook Message', 'Delete Webhook Message', 'Create Guild Application Command', 'Edit Guild Application Command', 'Delete Guild Application Command', 'Edit Application Command Permissions', 'Edit Original Interaction Response', 'Delete Original Interaction Response', 'Create Followup Message', 'Edit Followup Message', 'Delete Followup Message', 'Create Guild Scheduled Event', 'Modify Guild Scheduled Event', 'Delete Guild Scheduled Event', 'Create Guild Emoji', 'Modify Guild Emoji', 'Delete Guild Emoji', 'Create Guild Sticker', 'Modify Guild Sticker', 'Delete Guild Sticker', 'Create Auto Moderation Rule', 'Modify Auto Moderation Rule', 'Delete Auto Moderation Rule', 'Create Stage Instance', 'Modify Stage Instance', 'Delete Stage Instance']);
  }

  remember(kind, id) {
    if (!id || this.existingChannels.has(id) || this.protectedChannels.has(id)) throw new Error('A test object must be newly created.');
    const ids = this.created.get(kind) ?? new Set();
    ids.add(id);
    this.created.set(kind, ids);
    return id;
  }

  owns(kind, id) { return this.created.get(kind)?.has(id) ?? false; }

  authorizeMember(member, ownerId) {
    if (!member?.user?.id || member.user.id === ownerId || member.user.bot) throw new Error('Moderation requires an explicitly identified non-owner human test member.');
    this.memberId = member.user.id;
    for (const title of ['Add Guild Member Role', 'Remove Guild Member Role', 'Modify Guild Member', 'Remove Guild Member', 'Create Guild Ban', 'Remove Guild Ban']) this.allowedWrites.add(title);
  }

  assertCall(entry, input) {
    if (input.guild_id && input.guild_id !== this.guildId) throw new Error('The live test is restricted to its explicit guild ID.');
    if (input.application_id && input.application_id !== this.applicationId) throw new Error('The live test is restricted to its explicit application ID.');
    if (input.channel_id && !this.owns('channel', input.channel_id)) throw new Error('Existing channels, including gifs and its threads, are protected.');
    for (const [field, kind] of [['message_id', 'message'], ['role_id', 'role'], ['overwrite_id', 'role'], ['webhook_id', 'webhook'], ['webhook_handle', 'webhook_handle'], ['command_id', 'command'], ['guild_scheduled_event_id', 'event'], ['emoji_id', 'emoji'], ['sticker_id', 'sticker'], ['auto_moderation_rule_id', 'automod'], ['invite_code', 'invite']]) {
      if (field === 'emoji_id' && entry.path?.includes('/reactions/')) continue;
      if (input[field] && !this.owns(kind, input[field])) throw new Error(`The live test does not own ${field}.`);
    }
    if (input.body?.parent_id && !this.owns('channel', input.body.parent_id)) throw new Error('Existing categories are protected.');
    if (input.body?.channel_id && !this.owns('channel', input.body.channel_id)) throw new Error('Existing channels cannot be referenced by test mutations.');
    if (entry.method === 'GET') return;
    if (/^(?:Add Guild Member Role|Remove Guild Member Role|Modify Guild Member|Remove Guild Member|Create Guild Ban|Remove Guild Ban)$/.test(entry.title) && (!this.memberId || input.user_id !== this.memberId)) throw new Error('Only the authorized test member may be moderated.');
    if (entry.title === 'Create Guild Ban' && (input.body?.delete_message_seconds !== 0 || input.body?.delete_message_days)) throw new Error('Moderation tests must preserve all existing messages, including gifs.');
    if (!this.allowedWrites.has(entry.title)) throw new Error(`Live mutation is not allowlisted: ${entry.title}`);
    if (/^Create Guild (?:Channel|Role|Application Command|Scheduled Event|Emoji|Sticker)$/.test(entry.title) && !input.body?.name?.startsWith(this.prefix)) throw new Error('Created test objects must use the unique run prefix.');
    if (entry.title === 'Create Guild Channel' && input.body.type !== 4 && !input.body.parent_id) throw new Error('Test channels must belong to the newly created test category.');
    if (entry.title === 'Create Guild Role' && input.body.permissions !== '0') throw new Error('Test roles must not grant permissions.');
    if (/Auto Moderation Rule/.test(entry.title) && entry.method !== 'DELETE' && input.body?.enabled !== false) throw new Error('Test AutoMod rules must remain disabled.');
    if (/Webhook/.test(entry.title) && input.body?.channel_id) throw new Error('Test webhooks cannot be moved between channels.');
  }
}
