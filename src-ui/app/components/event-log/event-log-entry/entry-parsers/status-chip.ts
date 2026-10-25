import { escape } from 'lodash';
import { UserStatus } from '../../../../models/vrchat';
import { vrcStatusToString } from '../../../../utils/status-utils';

/** Renders a status change as one chip holding both statuses with an arrow between them. */
export function statusChangeChipHtml(
  oldStatus: UserStatus,
  oldMessage: string | undefined,
  newStatus: UserStatus,
  newMessage: string | undefined
): string {
  return `<span class="status-chip">${statusPartHtml(
    oldStatus,
    oldMessage
  )}<span class="status-arrow">→</span>${statusPartHtml(newStatus, newMessage)}</span>`;
}

function statusPartHtml(status: UserStatus, message: string | undefined): string {
  const label = message?.trim() || vrcStatusToString(status);
  return `<span class="status-dot" style="background: ${statusColor(
    status
  )}"></span><span class="status-label">${escape(label)}</span>`;
}

function statusColor(status: UserStatus): string {
  switch (status) {
    case UserStatus.Active:
      return 'var(--color-vrchat-status-green)';
    case UserStatus.JoinMe:
      return 'var(--color-vrchat-status-blue)';
    case UserStatus.AskMe:
      return 'var(--color-vrchat-status-orange)';
    case UserStatus.Busy:
      return 'var(--color-vrchat-status-red)';
    case UserStatus.Offline:
      return 'black';
  }
}
