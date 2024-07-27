export type OSCQClipmodeSingle = 'none' | 'low' | 'high' | 'both';
export type OSCQClipmode = OSCQClipmodeSingle | null | OSCQClipmode[];

type OSCQSerializedRangeSingle = {
  MIN?: number;
  MAX?: number;
  VALS?: unknown[];
};
export type OSCQSerializedRange = OSCQSerializedRangeSingle | null | OSCQSerializedRange[];

export type OSCQSerializedNode = {
  FULL_PATH: string;
  CONTENTS?: Record<string, OSCQSerializedNode>;
  TYPE?: string;
  ACCESS?: number;
  RANGE?: (OSCQSerializedRange | null)[];
  DESCRIPTION?: string;
  TAGS?: string[];
  CRITICAL?: boolean;
  CLIPMODE?: (OSCQClipmode | null)[];
  VALUE?: (unknown | null)[];
};

export type OSCQSerializedHostInfo = {
  NAME?: string;
  EXTENSIONS?: Record<string, boolean>;
  OSC_IP?: string;
  OSC_PORT?: number;
  OSC_TRANSPORT?: 'TCP' | 'UDP';
  WS_IP?: string;
  WS_PORT?: number;
};
