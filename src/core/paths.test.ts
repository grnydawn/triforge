import { describe, it, expect } from 'vitest';
import { samePath } from './paths';

describe('samePath', () => {
  it('is case-sensitive on linux', () => {
    expect(samePath('/home/User/proj', '/home/user/proj', 'linux')).toBe(false);
    expect(samePath('/home/user/proj', '/home/user/proj', 'linux')).toBe(true);
  });

  it('is case-insensitive on darwin and win32', () => {
    expect(samePath('/Users/Bob/Proj', '/users/bob/proj', 'darwin')).toBe(true);
    expect(samePath('C:\\Users\\Bob', 'c:/users/bob', 'win32')).toBe(true);
  });

  it('normalizes separators and trailing slashes', () => {
    expect(samePath('C:\\a\\b\\', 'C:/a/b', 'win32')).toBe(true);
    expect(samePath('/a/b/', '/a/b', 'linux')).toBe(true);
  });

  it('distinguishes genuinely different paths', () => {
    expect(samePath('/a/b', '/a/c', 'linux')).toBe(false);
    expect(samePath('C:/a', 'C:/b', 'win32')).toBe(false);
  });
});
