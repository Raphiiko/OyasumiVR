import { VRChatEventHandler } from '../vrchat-event-handler';
import type { LimitedUser } from 'vrchat/dist';
import { VRChatService } from '../../vrchat.service';

export class UserUpdateHandler implements VRChatEventHandler {
  type = 'user-update';

  constructor(private vrchat: VRChatService) {}

  handle(contentString: string) {
    // Parse the message content
    const content: {
      userId: string;
      user: Omit<
        LimitedUser,
        'developerType' | 'friendKey' | 'isFriend' | 'last_platform' | 'location' | 'last_login'
      > & { currentAvatar: string; currentAvatarAssetUrl: string };
    } = JSON.parse(contentString);
    // Update the current user
    this.vrchat.patchCurrentUser(content.user);
    this.vrchat.receivedUserUpdate();
  }
}
