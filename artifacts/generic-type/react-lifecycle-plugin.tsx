import type { Plugin, Reactive, SystemContext, ReactiveConfig } from './../sweet-tooth/v2/factory';
import { createReactiveHookFactory } from './v1/factory';

interface ReactiveComponent<T = any> {
  id: string;
  hookFactory: ReturnType<typeof createReactiveHookFactory>;
  instances: Set<symbol>;
  value: T;
  cleanup: () => void;
}

export function createReactPlugin(options = {}) {
  // Track mounted component instances
  const components = new Map<string, ReactiveComponent>();
  let systemContext: SystemContext;
  let hookFactory: ReturnType<typeof createReactiveHookFactory>;

  const plugin: Plugin = {
    name: 'react-integration',

    initialize: (context: SystemContext) => {
      systemContext = context;
      hookFactory = createReactiveHookFactory(context as any);
    },

    beforeCreate: async <T>(config: ReactiveConfig<T>): Promise<ReactiveConfig<T>> => {
      // Set up the component tracking for this reactive
      const componentId = config.id || crypto.randomUUID();
      
      if (!components.has(componentId)) {
        components.set(componentId, {
          id: componentId,
          hookFactory,
          instances: new Set(),
          value: config.initialValue,
          cleanup: () => {
            components.delete(componentId);
          }
        });
      }

      // Enhance the config with React-specific metadata
      return {
        ...config,
        id: componentId,
        meta: {
          ...config.meta,
          isReactComponent: true,
          mountedInstances: 0
        }
      };
    },

    afterCreate: async <T>(reactive: Reactive<T>): Promise<void> => {
      const component = components.get(reactive.id);
      if (!component) return;

      // Set up the hook integration
      const originalSet = reactive.set;
      reactive.set = async (newValue: T) => {
        if (originalSet) {
          await originalSet(newValue);
          
          // Update all mounted instances
          component.value = newValue;
          notifyInstancesOfUpdate(reactive.id, newValue);
        }
      };

      // Add React-specific metadata
      reactive.meta.custom.react = {
        instanceCount: 0,
        lastRender: Date.now()
      };
    },

    beforeUpdate: async <T>(newValue: T, oldValue: T): Promise<T> => {
      // Handle batched updates for React components
      const updates = Array.from(components.entries())
        .filter(([id, component]) => component.instances.size > 0);
      
      if (updates.length > 0) {
        await systemContext.batch(
          updates.map(([id, component]) => async () => {
            const reactive = systemContext.getReactive(id);
            if (reactive?.set) {
              component.value = newValue;
              await reactive.set(newValue);
            }
          })
        );
      }

      return newValue;
    },

    afterUpdate: async <T>(value: T): Promise<void> => {
      // Update React-specific metadata
      Array.from(components.entries()).forEach(([id, component]) => {
        const reactive = systemContext.getReactive(id);
        if (reactive) {
          reactive.meta.custom.react = {
            ...reactive.meta.custom.react,
            lastRender: Date.now()
          };
        }
      });
    },

    beforeDestroy: async <T>(reactive: Reactive<T>): Promise<void> => {
      const component = components.get(reactive.id);
      if (component) {
        // Clean up all instances
        component.instances.clear();
        component.cleanup();
        components.delete(reactive.id);
      }
    },

    // Add enhanced error handling for React components
    handleError: async (error: Error, context: { phase: string; config: ReactiveConfig<any> }) => {
      const componentId = context.config.id;
      if (componentId && components.has(componentId)) {
        const component = components.get(componentId)!;
        
        // Notify all mounted instances of the error
        const reactive = systemContext.getReactive(componentId);
        if (reactive) {
          reactive.meta.status = 'error';
          reactive.meta.error = error;
          reactive.meta.custom.react = {
            ...reactive.meta.custom.react,
            lastError: error,
            lastErrorTimestamp: Date.now()
          };
        }
      }
    }
  };

  // Utility functions for managing React component instances
  function registerInstance(componentId: string, instanceId: symbol) {
    const component = components.get(componentId);
    if (component) {
      component.instances.add(instanceId);
      const reactive = systemContext.getReactive(componentId);
      if (reactive) {
        reactive.meta.custom.react.instanceCount = component.instances.size;
      }
    }
  }

  function unregisterInstance(componentId: string, instanceId: symbol) {
    const component = components.get(componentId);
    if (component) {
      component.instances.delete(instanceId);
      const reactive = systemContext.getReactive(componentId);
      if (reactive) {
        reactive.meta.custom.react.instanceCount = component.instances.size;
      }
    }
  }

  function notifyInstancesOfUpdate(componentId: string, value: any) {
    const component = components.get(componentId);
    if (component) {
      const reactive = systemContext.getReactive(componentId);
      if (reactive) {
        reactive.meta.custom.react.lastRender = Date.now();
      }
    }
  }

  // Expose the hook factory and instance management
  return {
    plugin,
    hookFactory,
    registerInstance,
    unregisterInstance
  };
}

// Example usage with the component system:
const system = new ComponentSystem({
  plugins: [
    createReactPlugin().plugin,
    // ... other plugins
  ]
});

// Example React component using the enhanced system
function ExampleComponent() {
  const instanceId = React.useRef(Symbol()).current;
  const componentId = 'example';
  
  const { value, setValue, meta } = system.hookFactory.useReactive(componentId, {
    immediate: true,
    onError: (error) => {
      console.error('Component error:', error);
    }
  });

  React.useEffect(() => {
    // Register this instance
    system.registerInstance(componentId, instanceId);
    
    return () => {
      // Cleanup on unmount
      system.unregisterInstance(componentId, instanceId);
    };
  }, []);

  return (
    <div>
      <p>Value: {value}</p>
      <p>Instance Count: {meta.custom?.react?.instanceCount}</p>
      <p>Last Render: {meta.custom?.react?.lastRender}</p>
    </div>
  );
}
