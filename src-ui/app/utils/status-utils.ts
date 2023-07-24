import { UserStatus } from 'vrchat';

export function vrcStatusToString(status: UserStatus): string {
  switch (status) {
    case UserStatus.Active:
      return 'Online';
    case UserStatus.JoinMe:
      return 'Join Me';
    case UserStatus.AskMe:
      return 'Ask Me';
    case UserStatus.Busy:
      return 'Do Not Disturb';
    case UserStatus.Offline:
      return 'Offline';
    default:
      return 'Unknown';
  }
}
