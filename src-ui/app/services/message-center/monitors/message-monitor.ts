import { MessageCenterService } from '../message-center.service';

export abstract class MessageMonitor {
  constructor(protected readonly messageCenter: MessageCenterService) {

  } 

  public abstract init(): void | Promise<void>;
}
