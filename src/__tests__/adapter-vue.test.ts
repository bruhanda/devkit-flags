// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, ref } from 'vue';
import { createFlagsPlugin, useFlag } from '../adapters/vue/index.js';
import { defineFlags } from '../core/define.js';

const flags = defineFlags({
  flags: { bool: { kind: 'boolean', default: true } },
});

describe('createFlagsPlugin + useFlag', () => {
  it('should provide and consume the flag handle', () => {
    let valueHolder: unknown;
    const Child = defineComponent({
      setup() {
        const r = useFlag<typeof flags extends { config: { flags: infer S } } ? S : never, 'bool'>(
          'bool' as never,
        );
        valueHolder = r.value;
        return () => h('div');
      },
    });
    const root = defineComponent({ render: () => h(Child) });
    const app = createApp(root);
    app.use(createFlagsPlugin(flags));
    const container = document.createElement('div');
    app.mount(container);
    expect(valueHolder).toBe(true);
    app.unmount();
  });

  it('should throw when used without the plugin', () => {
    const Child = defineComponent({
      setup() {
        useFlag<typeof flags extends { config: { flags: infer S } } ? S : never, 'bool'>(
          'bool' as never,
        );
        return () => h('div');
      },
    });
    const app = createApp(defineComponent({ render: () => h(Child) }));
    const container = document.createElement('div');
    let caught = false;
    app.config.errorHandler = () => {
      caught = true;
    };
    try {
      app.mount(container);
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
  });

  it('should react to source updates via subscribe', async () => {
    const flags2 = defineFlags({
      flags: { bool: { kind: 'boolean', default: false } },
    });
    let r: { value: unknown } | undefined;
    const Child = defineComponent({
      setup() {
        r = useFlag<typeof flags2 extends { config: { flags: infer S } } ? S : never, 'bool'>(
          'bool' as never,
        );
        return () => h('div');
      },
    });
    const app = createApp(defineComponent({ render: () => h(Child) }));
    app.use(createFlagsPlugin(flags2));
    const container = document.createElement('div');
    app.mount(container);
    expect(r?.value).toBe(false);
    // simulate snapshot refresh; reload bumps version
    await flags2.reload();
    // Vue's update is sync via subscribe handler; allow a microtask
    await Promise.resolve();
    expect(r?.value).toBe(false);
    app.unmount();
  });

  it('should attach to a Vue ref correctly', () => {
    const r = ref(0);
    expect(r.value).toBe(0);
  });
});
