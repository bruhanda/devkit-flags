import { describe, expect, it } from 'vitest';
import { parseArgs } from '../cli/parse-args.js';

describe('parseArgs', () => {
  it('should parse positional args into _', () => {
    const r = parseArgs(['lint', 'audit']);
    expect(r._).toEqual(['lint', 'audit']);
  });

  it('should parse --key value', () => {
    const r = parseArgs(['--in', 'flags.json']);
    expect(r['in']).toBe('flags.json');
  });

  it('should parse --key=value', () => {
    const r = parseArgs(['--in=flags.json']);
    expect(r['in']).toBe('flags.json');
  });

  it('should parse --key (boolean)', () => {
    const r = parseArgs(['--json']);
    expect(r['json']).toBe(true);
  });

  it('should parse --no-key as false', () => {
    const r = parseArgs(['--no-fail']);
    expect(r['fail']).toBe(false);
  });

  it('should mix positional and flagged args', () => {
    const r = parseArgs(['lint', '--in', 'flags.json', '--json']);
    expect(r._).toEqual(['lint']);
    expect(r['in']).toBe('flags.json');
    expect(r['json']).toBe(true);
  });

  it('should skip undefined argv tokens gracefully', () => {
    const r = parseArgs([]);
    expect(r._).toEqual([]);
  });
});
