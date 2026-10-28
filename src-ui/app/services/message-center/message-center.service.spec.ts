// the service module imports Angular components, which need the JIT compiler
import '@angular/compiler';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { MessageCenterService, type MessageItem } from './message-center.service';

function message(id: string, text = id): MessageItem {
  return { id, title: id, message: text, actions: [], type: 'info' };
}

// the constructor builds monitors that need an Angular injection context
function createService(messages: MessageItem[]) {
  const service = Object.create(MessageCenterService.prototype) as MessageCenterService;
  const subject = new BehaviorSubject(messages);
  Object.assign(service, { _messages: subject });
  return { service, subject };
}

describe('MessageCenterService.addMessage', () => {
  it('appends a message with a new id', () => {
    const first = message('a', 'first');
    const second = message('b', 'second');
    const { service, subject } = createService([first]);
    service.addMessage(second);
    expect(subject.value).toEqual([first, second]);
  });

  it('replaces a message with the same id in its current position', () => {
    const first = message('a', 'old');
    const second = message('b');
    const third = message('c');
    const replacement = message('a', 'changed');
    const { service, subject } = createService([first, second, third]);
    service.addMessage(replacement);
    expect(subject.value).toEqual([replacement, second, third]);
  });
});
