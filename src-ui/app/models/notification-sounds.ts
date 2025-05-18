import { NotificationSoundDurations, NotificationSoundRef } from './notification-sounds.generated';

export type NotificationSound = NotificationSoundBuiltIn;

interface NotificationSoundBase {
  id: string;
}

export interface NotificationSoundBuiltIn extends NotificationSoundBase {
  type: 'BUILT_IN';
  ref: NotificationSoundRef;
  duration: number;
  name: string;
  userConfigurable: boolean;
}

export const BUILT_IN_NOTIFICATION_SOUNDS: NotificationSoundBuiltIn[] = [
  {
    id: 'gentle-chime',
    type: 'BUILT_IN',
    ref: 'material_alarm_gentle_short_1',
    name: 'Gentle Chime',
    duration: NotificationSoundDurations['material_alarm_gentle_short_1'],
    userConfigurable: true,
  },
  {
    id: 'clear-chime',
    type: 'BUILT_IN',
    ref: 'material_alarm_gentle_short_2',
    name: 'Clear Chime',
    duration: NotificationSoundDurations['material_alarm_gentle_short_2'],
    userConfigurable: true,
  },
  {
    id: 'pebbles',
    type: 'BUILT_IN',
    ref: 'material_hero_simple-celebration-01',
    name: 'Pebbles',
    duration: NotificationSoundDurations['material_hero_simple-celebration-01'],
    userConfigurable: true,
  },
  {
    id: 'mute-microphone',
    type: 'BUILT_IN',
    ref: 'mic_mute',
    name: 'Mute Microphone',
    duration: NotificationSoundDurations['mic_mute'],
    userConfigurable: false,
  },
  {
    id: 'unmute-microphone',
    type: 'BUILT_IN',
    ref: 'mic_unmute',
    name: 'Unmute Microphone',
    duration: NotificationSoundDurations['mic_unmute'],
    userConfigurable: false,
  },
  {
    id: 'ripple',
    type: 'BUILT_IN',
    ref: 'notification_bell',
    name: 'Ripple',
    duration: NotificationSoundDurations['notification_bell'],
    userConfigurable: true,
  },
  {
    id: 'pulse',
    type: 'BUILT_IN',
    ref: 'notification_block',
    name: 'Pulse',
    duration: NotificationSoundDurations['notification_block'],
    userConfigurable: true,
  },
  {
    id: 'breeze',
    type: 'BUILT_IN',
    ref: 'notification_reverie',
    name: 'Breeze',
    duration: NotificationSoundDurations['notification_reverie'],
    userConfigurable: true,
  },
  {
    id: 'gentle-chime-long',
    type: 'BUILT_IN',
    ref: 'material_alarm_gentle',
    duration: NotificationSoundDurations['material_alarm_gentle'],
    name: 'Gentle Chime (Long)',
    userConfigurable: true,
  },
] as const;

export type BuiltInNotificationSoundId = (typeof BUILT_IN_NOTIFICATION_SOUNDS)[number]['id'];

export function getBuiltInNotificationSound(
  id: BuiltInNotificationSoundId
): NotificationSoundBuiltIn {
  return BUILT_IN_NOTIFICATION_SOUNDS.find((sound) => sound.id === id)!;
}
