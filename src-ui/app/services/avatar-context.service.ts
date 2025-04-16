import { Injectable } from '@angular/core';
import { BehaviorSubject, distinctUntilChanged, firstValueFrom } from 'rxjs';
import {
  AvatarContext,
  AvatarContextType,
  VRChatAvatarContext,
  VRChatAvatarParameter,
} from '../models/avatar-context';
import { OSCQSerializedNode } from '../models/osc-query-serialized-node';
import { warn } from 'tauri-plugin-log-api';
import { OscService } from './osc.service';
import { fetch } from '@tauri-apps/plugin-http';

@Injectable({
  providedIn: 'root',
})
export class AvatarContextService {
  private readonly _avatarContext = new BehaviorSubject<AvatarContext | null>(null);
  public readonly avatarContext = this._avatarContext.asObservable();

  constructor(private osc: OscService) {}

  public async init() {
    this.osc.vrchatOscQueryAddress.pipe(distinctUntilChanged()).subscribe((oscqAddr) => {
      this.buildAvatarContext('VRCHAT', oscqAddr);
    });
    this._avatarContext.subscribe((context) => {
      this.osc.updateAvatarContext(context);
    });
  }

  async buildAvatarContext(contextType: AvatarContextType, oscqAddr?: string | null) {
    switch (contextType) {
      case 'VRCHAT':
        await this.buildVRChatAvatarContext(oscqAddr);
        break;
    }
  }

  private async buildVRChatAvatarContext(oscqAddr: string | null | undefined) {
    // Get OSCQuery address
    if (oscqAddr === undefined) oscqAddr = await firstValueFrom(this.osc.vrchatOscQueryAddress);
    if (!oscqAddr) {
      if (this._avatarContext.value !== null) this._avatarContext.next(null);
      return;
    }
    // Get OSCQuery data
    let node: OSCQSerializedNode;
    try {
      const resp = await fetch(`http://${oscqAddr}/`);
      node = await resp.json();
    } catch (e) {
      warn('[OSC] Failed to fetch OSCQuery node from VRChat: ' + e);
      if (this._avatarContext.value !== null) this._avatarContext.next(null);
      return;
    }
    // Obtain avatar ID
    const avatarId = node.CONTENTS?.['avatar']?.CONTENTS?.['change']?.VALUE?.[0] as string;
    if (!avatarId) {
      warn('[OSC] Failed to extract avatar ID from OSCQuery node data');
      if (this._avatarContext.value !== null) this._avatarContext.next(null);
      return;
    }
    // Parse parameters
    const parameters: VRChatAvatarParameter[] = [];
    const getLeafNodes = (node: OSCQSerializedNode): OSCQSerializedNode[] => {
      const leaves = [];
      if (node.CONTENTS) {
        for (const child of Object.values(node.CONTENTS)) {
          leaves.push(...getLeafNodes(child));
        }
      } else if (node.VALUE) {
        leaves.push(node);
      }
      return leaves;
    };
    const parametersNode = node.CONTENTS?.['avatar']?.CONTENTS?.['parameters'];
    if (parametersNode) {
      const leafNodes = getLeafNodes(parametersNode);
      for (const leaf of leafNodes) {
        const address = leaf.FULL_PATH;
        const type = leaf.TYPE;
        if (!type || !['f', 'i', 's', 'T', 'F'].includes(type)) continue;
        const name = address.substring('/avatar/parameters/'.length);
        const parameter = this.sanitizeModularParameter({
          type: type.toUpperCase() as VRChatAvatarParameter['type'],
          name,
          address,
        });
        parameters.push(parameter);
      }
      const context: VRChatAvatarContext = {
        type: 'VRCHAT',
        id: avatarId,
        parameters,
      };
      this._avatarContext.next(context);
    }
  }

  private sanitizeModularParameter(param: VRChatAvatarParameter): VRChatAvatarParameter {
    for (const sanitizer of [this.sanitizeVRCFuryParameter, this.sanitizeModularAvatarParameter]) {
      const sanitized = sanitizer.bind(this)(param);
      if (sanitized) return sanitized;
    }
    return param;
  }

  private sanitizeVRCFuryParameter(
    param: VRChatAvatarParameter
  ): VRChatAvatarParameter | undefined {
    const match = param.name.match(/(^VF[0-9]+_)/);
    if (match) {
      const name = param.name.substring(match[0].length);
      return {
        ...param,
        name,
        address: '/avatar/parameters/' + name,
        modularAliases: [...(param.modularAliases ?? []), '/avatar/parameters/' + param.name],
      };
    }
    return undefined;
  }

  private sanitizeModularAvatarParameter(
    param: VRChatAvatarParameter
  ): VRChatAvatarParameter | undefined {
    const match = param.name.match(/(\$\$Internal_[0-9]+$)/);
    if (match) {
      const name = param.name.substring(0, param.name.length - match[0].length);
      return {
        ...param,
        name,
        address: '/avatar/parameters/' + name,
        modularAliases: [...(param.modularAliases ?? []), '/avatar/parameters/' + param.name],
      };
    }
    return undefined;
  }
}
