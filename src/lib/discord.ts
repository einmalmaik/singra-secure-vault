// Stub file to satisfy design-dna DiscordPickers dependency types
export const useGuildChannels = (guildId?: string, options?: any) => {
  return { channels: [] as any[], loading: false };
};

export const useGuildMembers = (guildId?: string, options?: any) => {
  return { members: [] as any[], loading: false };
};

export const useGuildRoles = (guildId?: string, options?: any) => {
  return { roles: [] as any[], loading: false };
};
