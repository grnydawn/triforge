import { ConfigVariable, TritonFileType } from './types';
import { CONFIG_VARIABLES, FILE_TYPES } from './data';

export function listConfigVariables(): ConfigVariable[] {
  return CONFIG_VARIABLES;
}

export function lookupConfigVariable(name: string): ConfigVariable | undefined {
  const key = (name ?? '').trim().toLowerCase();
  return CONFIG_VARIABLES.find((v) => v.name.toLowerCase() === key);
}

export function getConfigVariablesBySection(section: string): ConfigVariable[] {
  return CONFIG_VARIABLES.filter((v) => v.section === section);
}

export function listFileTypes(): TritonFileType[] {
  return FILE_TYPES;
}

export function lookupFileType(id: string): TritonFileType | undefined {
  const key = (id ?? '').trim().toLowerCase();
  return FILE_TYPES.find((f) => f.id.toLowerCase() === key);
}
