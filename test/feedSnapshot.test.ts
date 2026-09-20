import { describe, it, expect } from 'vitest';
import { executionCtxOf } from '../src/services/feedSnapshot';

describe('executionCtxOf', () => {
  it('returns executionCtx if it exists and is accessible', () => {
    const mockWaitUntil = (p: Promise<unknown>) => {};
    const mockCtx = {
      executionCtx: {
        waitUntil: mockWaitUntil,
      },
    };

    const result = executionCtxOf(mockCtx);
    expect(result).toBe(mockCtx.executionCtx);
    expect(result?.waitUntil).toBe(mockWaitUntil);
  });

  it('returns undefined if accessing executionCtx throws an error', () => {
    // Create an object where accessing executionCtx throws an error
    const faultyCtx = Object.defineProperty({}, 'executionCtx', {
      get() {
        throw new Error('Access denied');
      },
    });

    const result = executionCtxOf(faultyCtx as any);
    expect(result).toBeUndefined();
  });

  it('returns undefined if executionCtx is undefined (no throw, but value is undefined)', () => {
    const mockCtx = { executionCtx: undefined } as any;
    const result = executionCtxOf(mockCtx);
    expect(result).toBeUndefined();
  });
});
