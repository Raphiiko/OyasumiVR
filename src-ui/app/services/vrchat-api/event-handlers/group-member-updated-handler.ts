import { VRChatAPI } from '../vrchat-api';
import { VRChatEventHandler } from '../vrchat-socket';

export class GroupMemberUpdatedHandler implements VRChatEventHandler {
  type = 'group-member-updated';

  constructor(private vrchatApi: VRChatAPI) {}

  async handle(contentString: string) {
    const content: {
      member: {
        groupId: string;
        id: string;
        isRepresenting: boolean;
        isSubscribedToAnnouncements: boolean;
        joinedAt: string; // timestamp
        lastPostReadAt: string; // timestamp
        mRoleIds: any[];
        membershipStatus: 'member';
        roleIds: string[];
        userId: string;
        visibility: string; // "visible"
      };
    } = JSON.parse(contentString);
    const { groupId, isRepresenting, lastPostReadAt } = content.member;
    this.vrchatApi.updateCachedGroup(groupId, {
      groupId,
      isRepresenting,
      lastPostReadAt,
    });
  }
}
