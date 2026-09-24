export { DfuDevice, DfuError, type DfuStatusResult } from './DfuDevice';
export { flashFirmware, type FlashProgress, type FlashStage } from './flashFirmware';
export { crc32Stm32 } from './crc32';
export {
  parseDfuseMemoryLayout,
  sectorsInRange,
  readDfuFunctionalDescriptor,
  type DfuseMemoryLayout,
  type DfuseSector,
  type DfuFunctionalDescriptor,
} from './descriptor';
export {
  STM32F411_FLASH_BASE,
  STM32F411_FLASH_SIZE,
  FALLBACK_TRANSFER_SIZE,
  DfuState,
  DfuStatus,
} from './constants';
