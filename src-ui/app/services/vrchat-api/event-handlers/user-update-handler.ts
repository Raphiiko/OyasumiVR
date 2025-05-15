import type { LimitedUser } from 'vrchat/dist';
import { VRChatAuth } from '../vrchat-auth';
import { VRChatEventHandler } from '../vrchat-socket';

export class UserUpdateHandler implements VRChatEventHandler {
  type = 'user-update';

  constructor(private vrchatAuth: VRChatAuth) {}

  handle(contentString: string) {
    const content: {
      userId: string;
      user: Omit<
        LimitedUser,
        'developerType' | 'friendKey' | 'isFriend' | 'last_platform' | 'location' | 'last_login'
      > & { currentAvatar: string; currentAvatarAssetUrl: string };
    } = JSON.parse(contentString);
    // Update the current user
    this.vrchatAuth.receivedUserUpdate(content.user);
  }
}
