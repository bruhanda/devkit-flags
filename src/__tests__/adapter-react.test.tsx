// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Flag,
  FlagsProvider,
  createReactBindings,
  useFlag,
  useFlagResult,
  useFlags,
} from '../adapters/react/index.js';
import { defineFlags } from '../core/define.js';

afterEach(() => {
  cleanup();
});

const flags = defineFlags({
  flags: {
    enabled: { kind: 'boolean', default: true },
    label: { kind: 'string', default: 'hello' },
  },
});

function Wrap({ children }: { children: React.ReactNode }): JSX.Element {
  return <FlagsProvider flags={flags}>{children}</FlagsProvider>;
}

describe('useFlag', () => {
  it('should return the value of the flag', () => {
    function Probe(): JSX.Element {
      const v = useFlag<typeof flags['config']['flags'], 'enabled'>('enabled' as never);
      return <span data-testid="v">{String(v)}</span>;
    }
    render(
      <Wrap>
        <Probe />
      </Wrap>,
    );
    expect(screen.getByTestId('v').textContent).toBe('true');
  });

  it('should support a fallback', () => {
    function Probe(): JSX.Element {
      const v = useFlag<typeof flags['config']['flags'], 'enabled'>(
        'enabled' as never,
        false as never,
      );
      return <span data-testid="v">{String(v)}</span>;
    }
    render(
      <Wrap>
        <Probe />
      </Wrap>,
    );
    expect(screen.getByTestId('v').textContent).toBe('true');
  });

  it('should throw when used outside the provider', () => {
    const original = console.error;
    console.error = () => {};
    function Probe(): JSX.Element {
      useFlag<typeof flags['config']['flags'], 'enabled'>('enabled' as never);
      return <div />;
    }
    expect(() => render(<Probe />)).toThrow();
    console.error = original;
  });
});

describe('useFlagResult', () => {
  it('should expose the full evaluation result', () => {
    function Probe(): JSX.Element {
      const r = useFlagResult<typeof flags['config']['flags'], 'enabled'>(
        'enabled' as never,
      );
      return <span data-testid="reason">{r.reason}</span>;
    }
    render(
      <Wrap>
        <Probe />
      </Wrap>,
    );
    expect(screen.getByTestId('reason').textContent).toBe('STATIC');
  });
});

describe('useFlags', () => {
  it('should return every flag at once', () => {
    function Probe(): JSX.Element {
      const all = useFlags<typeof flags['config']['flags']>();
      return (
        <span data-testid="all">{JSON.stringify(all)}</span>
      );
    }
    render(
      <Wrap>
        <Probe />
      </Wrap>,
    );
    expect(screen.getByTestId('all').textContent).toBe(
      JSON.stringify({ enabled: true, label: 'hello' }),
    );
  });
});

describe('Flag (render-prop)', () => {
  it('should render children when value is truthy', () => {
    render(
      <Wrap>
        <Flag<typeof flags['config']['flags'], 'enabled'> name={'enabled' as never}>
          shown
        </Flag>
      </Wrap>,
    );
    expect(screen.getByText('shown')).toBeDefined();
  });

  it('should render fallback when value is falsy', () => {
    const f = defineFlags({
      flags: { off: { kind: 'boolean', default: false } },
    });
    render(
      <FlagsProvider flags={f}>
        <Flag<typeof f['config']['flags'], 'off'> name={'off' as never} fallback={'fb'}>
          shown
        </Flag>
      </FlagsProvider>,
    );
    expect(screen.getByText('fb')).toBeDefined();
  });

  it('should call children-as-function with the value', () => {
    render(
      <Wrap>
        <Flag<typeof flags['config']['flags'], 'label'> name={'label' as never}>
          {(v) => <span>{`got: ${String(v)}`}</span>}
        </Flag>
      </Wrap>,
    );
    expect(screen.getByText('got: hello')).toBeDefined();
  });
});

describe('createReactBindings', () => {
  it('should produce typed bindings against a single handle', () => {
    const bindings = createReactBindings(flags);
    function Probe(): JSX.Element {
      const v = bindings.useFlag('enabled');
      return <span data-testid="v">{String(v)}</span>;
    }
    render(
      <bindings.FlagsProvider>
        <Probe />
      </bindings.FlagsProvider>,
    );
    expect(screen.getByTestId('v').textContent).toBe('true');
  });

  it('should re-render after a snapshot reload', async () => {
    const bindings = createReactBindings(flags);
    function Probe(): JSX.Element {
      const v = bindings.useFlag('enabled');
      return <span data-testid="v">{String(v)}</span>;
    }
    render(
      <bindings.FlagsProvider>
        <Probe />
      </bindings.FlagsProvider>,
    );
    expect(screen.getByTestId('v').textContent).toBe('true');
    await act(async () => {
      await flags.reload();
    });
    expect(screen.getByTestId('v').textContent).toBe('true');
  });
});
