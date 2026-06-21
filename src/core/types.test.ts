import { describe, it, expect } from 'vitest';
import { CURRENT_SCHEMA_VERSION, INPUT_FORMATS, OUTPUT_FORMATS } from './types';

describe('core types', () => {
  it('declares the current schema version and format enums', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
    expect(INPUT_FORMATS).toEqual(['ASC', 'BIN']);
    expect(OUTPUT_FORMATS).toEqual(['ASC', 'BIN', 'GTIFF']);
  });
});
