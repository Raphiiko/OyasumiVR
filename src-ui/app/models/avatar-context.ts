export type AvatarContextType = 'VRCHAT';

type AvatarContextBase = {
  type: AvatarContextType;
};

export interface VRChatAvatarParameter {
  type: 'Float' | 'Int' | 'Bool' | 'String';
  name: string;
  address: string;
  modularAliases?: string[]; // Aliases for this parameter (e.g. by renames from VRCFury and Modular Avatar)
}

export interface VRChatAvatarContext extends AvatarContextBase {
  type: 'VRCHAT';
  id: string;
  parameters: VRChatAvatarParameter[];
}

export type AvatarContext = VRChatAvatarContext;
