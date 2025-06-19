import { NotificationSoundDurations, NotificationSoundRef } from './notification-sounds.generated';

export type NotificationSound = NotificationSoundBuiltIn;

interface NotificationSoundBase {
  id: string;
}

export interface NotificationSoundBuiltIn extends NotificationSoundBase {
  id: NotificationSoundRef;
  type: 'BUILT_IN';
  duration: number;
  name: string;
  userConfigurable: boolean;
}

export const BUILT_IN_NOTIFICATION_SOUNDS: NotificationSoundBuiltIn[] = [
  {
    id: 'gentle_chime',
    type: 'BUILT_IN',
    name: 'Gentle Chime',
    duration: NotificationSoundDurations['gentle_chime'],
    userConfigurable: true,
  },
  {
    id: 'clear_chime',
    type: 'BUILT_IN',
    name: 'Clear Chime',
    duration: NotificationSoundDurations['clear_chime'],
    userConfigurable: true,
  },
  {
    id: 'pebbles',
    type: 'BUILT_IN',
    name: 'Pebbles',
    duration: NotificationSoundDurations['pebbles'],
    userConfigurable: true,
  },
  {
    id: 'mic_mute',
    type: 'BUILT_IN',
    name: 'Mute Microphone',
    duration: NotificationSoundDurations['mic_mute'],
    userConfigurable: false,
  },
  {
    id: 'mic_unmute',
    type: 'BUILT_IN',
    name: 'Unmute Microphone',
    duration: NotificationSoundDurations['mic_unmute'],
    userConfigurable: false,
  },
  {
    id: 'ripple',
    type: 'BUILT_IN',
    name: 'Ripple',
    duration: NotificationSoundDurations['ripple'],
    userConfigurable: true,
  },
  {
    id: 'pulse',
    type: 'BUILT_IN',
    name: 'Pulse',
    duration: NotificationSoundDurations['pulse'],
    userConfigurable: true,
  },
  {
    id: 'breeze',
    type: 'BUILT_IN',
    name: 'Breeze',
    duration: NotificationSoundDurations['breeze'],
    userConfigurable: true,
  },
  {
    id: 'gentle_chime_long',
    type: 'BUILT_IN',
    duration: NotificationSoundDurations['gentle_chime_long'],
    name: 'Gentle Chime (Long)',
    userConfigurable: true,
  },
] as const;

export function getBuiltInNotificationSound(id: NotificationSoundRef): NotificationSoundBuiltIn {
  return BUILT_IN_NOTIFICATION_SOUNDS.find((sound) => sound.id === id)!;
}
