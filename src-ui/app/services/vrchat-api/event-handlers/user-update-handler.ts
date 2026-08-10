import type { LimitedUserFriend } from 'vrchat';
import { VRChatAuth } from '../vrchat-auth';
import { VRChatEventHandler } from '../vrchat-socket';

export class UserUpdateHandler implements VRChatEventHandler {
  type = 'user-update';

  constructor(private vrchatAuth: VRChatAuth) {}

  handle(contentString: string) {
    const content: {
      userId: string;
      user: Omit<
        LimitedUserFriend,
        | 'developerType'
        | 'friendKey'
        | 'isFriend'
        | 'last_platform'
        | 'location'
        | 'last_login'
        | 'last_activity'
      > & { currentAvatar: string; currentAvatarAssetUrl: string };
    } = JSON.parse(contentString);
    // Update the current user
    this.vrchatAuth.receivedUserUpdate(content.user);
  }
}
