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
    const { service, subject } = createService([message('a')]);
    service.addMessage(message('b'));
    expect(subject.value.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('replaces a message with the same id in its current position', () => {
    const { service, subject } = createService([message('a'), message('b'), message('c')]);
    service.addMessage(message('a', 'changed'));
    expect(subject.value.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(subject.value[0].message).toBe('changed');
  });
});
