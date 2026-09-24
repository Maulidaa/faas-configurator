/**
 * core/dfu/webusbTypes.d.ts
 * Deklarasi ambient minimal untuk WebUSB API — belum tercakup di versi
 * lib.dom TypeScript proyek ini (persis pola yang sama dipakai
 * core/transport/webSerialTypes.d.ts untuk Web Serial). Hanya mendeklarasikan
 * bagian yang benar-benar dipakai DfuDevice/descriptor.ts.
 */

interface USBDeviceFilter {
  vendorId?: number;
  productId?: number;
  classCode?: number;
  subclassCode?: number;
}

interface USBDeviceRequestOptions {
  filters: USBDeviceFilter[];
}

type USBRequestType = 'standard' | 'class' | 'vendor';
type USBRecipient = 'device' | 'interface' | 'endpoint' | 'other';
type USBTransferStatus = 'ok' | 'stall' | 'babble';

interface USBControlTransferParameters {
  requestType: USBRequestType;
  recipient: USBRecipient;
  request: number;
  value: number;
  index: number;
}

interface USBInTransferResult {
  data?: DataView;
  status?: USBTransferStatus;
}

interface USBOutTransferResult {
  bytesWritten: number;
  status?: USBTransferStatus;
}

interface USBAlternateInterface {
  alternateSetting: number;
  interfaceClass: number;
  interfaceSubclass: number;
  interfaceProtocol: number;
  interfaceName?: string;
}

interface USBInterface {
  interfaceNumber: number;
  alternate: USBAlternateInterface;
  alternates: USBAlternateInterface[];
  claimed: boolean;
}

interface USBConfiguration {
  configurationValue: number;
  interfaces: USBInterface[];
}

interface USBDevice extends EventTarget {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName?: string;
  readonly serialNumber?: string;
  readonly configuration: USBConfiguration | null;
  readonly configurations: USBConfiguration[];
  readonly opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void>;
  controlTransferIn(setup: USBControlTransferParameters, length: number): Promise<USBInTransferResult>;
  controlTransferOut(setup: USBControlTransferParameters, data?: BufferSource): Promise<USBOutTransferResult>;
  reset(): Promise<void>;
}

interface USB extends EventTarget {
  requestDevice(options: USBDeviceRequestOptions): Promise<USBDevice>;
  getDevices(): Promise<USBDevice[]>;
  addEventListener(type: 'connect' | 'disconnect', listener: (ev: Event) => void): void;
  removeEventListener(type: 'connect' | 'disconnect', listener: (ev: Event) => void): void;
}

interface Navigator {
  readonly usb?: USB;
}
