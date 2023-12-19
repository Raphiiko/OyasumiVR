import { OSCMessage } from 'src-ui/app/models/osc-message';
import { OscService } from '../osc.service';
import { warn } from 'tauri-plugin-log-api';

export interface OscMethodOptions<T> {
  description: string;
  address: string;
  addressAliases: string[];
  isVRCAvatarParameter?: boolean;
  type: 'Float' | 'Int' | 'Bool' | 'String';
  access: 'Read' | 'Write' | 'ReadWrite';
  initialValue: T;
}

export abstract class OscMethod<T> {
  protected value: T;

  constructor(protected osc: OscService, public readonly options: OscMethodOptions<T>) {
    this.value = options.initialValue;
  }

  public async setValue(value: T) {
    if (this.value === value) return;
    this.value = value;
    await this.syncValue();
    await this.osc.updateOscMethodValue(this);
  }

  public getValue(): T {
    return this.value;
  }

  public abstract handleOSCMessage(message: OSCMessage): Promise<void>;

  // If needed, send the current value to other OSC servers (for now just VRChat)
  public async syncValue() {
    if (this.options.access === 'Write') return;
    const addresses = [this.options.address];
    if (this.options.isVRCAvatarParameter) {
      addresses.push('/avatar/parameters' + this.options.address);
      addresses.push(...this.options.addressAliases.map((a) => '/avatar/parameters' + a));
    }
    for (const address of addresses) {
      switch (this.options.type) {
        case 'Float': {
          await this.osc.send_float(address, this.value as number);
          break;
        }
        case 'Int': {
          await this.osc.send_int(address, this.value as number);
          break;
        }
        case 'Bool': {
          await this.osc.send_bool(address, this.value as boolean);
          break;
        }
        default: {
          warn(`[OSCMethod] Can't sync value of type ${this.options.type}. (Address: ${address})`);
        }
      }
    }
  }
}
