export type Primitive = string | number | boolean | null | undefined;
export type JSONValue = Primitive | JSONObject | JSONArray;
export interface JSONObject {
    [key: string]: JSONValue;
}
export interface JSONArray extends Array<JSONValue> {
}
export interface Plugin<T = any> {
    name: string;
    initialize?: (context: SystemContext) => void;
    beforeCreate?: (config: ReactiveConfig<T>) => ReactiveConfig<T> | Promise<ReactiveConfig<T>>;
    afterCreate?: (reactive: Reactive<T>) => void | Promise<void>;
    beforeUpdate?: (value: T, newValue: T) => T | Promise<T>;
    afterUpdate?: (value: T) => void | Promise<void>;
    beforeDestroy?: (reactive: Reactive<T>) => void | Promise<void>;
    handleError?: (error: Error, context: {
        phase: string;
        config: ReactiveConfig<T>;
    }) => void | Promise<void>;
}
export interface Reactive<T> {
    id: string;
    value: () => T;
    set?: (newValue: T) => Promise<void>;
    meta: ReactiveMetadata;
    dependencies: Set<string>;
    dependents: Set<string>;
}
export interface ReactiveMetadata {
    type: string;
    created: Date;
    lastUpdated?: Date;
    updateCount: number;
    status: "idle" | "loading" | "error" | "success";
    error?: Error;
    custom: Record<string, any>;
}
export interface SystemConfig {
    plugins?: Plugin[];
    middleware?: Middleware[];
    options?: {
        enableHistory?: boolean;
        historySize?: number;
        asyncTimeout?: number;
        batchUpdates?: boolean;
        devTools?: boolean;
    };
}
export interface ReactiveConfig<T> {
    id?: string;
    type: string;
    initialValue: T;
    dependencies?: string[];
}
export interface Middleware {
    name: string;
    before?: (value: any, context: MiddlewareContext) => any | Promise<any>;
    after?: (value: any, context: MiddlewareContext) => any | Promise<any>;
    error?: (error: Error, context: MiddlewareContext) => void | Promise<void>;
}
export interface MiddlewareContext {
    reactive: Reactive<any>;
    phase: "before" | "after" | "error";
    timestamp: number;
    meta: Record<string, any>;
}
export interface SystemContext {
    reactives: Map<string, Reactive<any>>;
    history: Map<string, any[]>;
    options: Required<SystemConfig["options"]>;
    registerReactive: (reactive: Reactive<any>) => void;
    removeReactive: (id: string) => void;
    getReactive: (id: string) => Reactive<any> | undefined;
    batch: (operations: (() => Promise<void>)[]) => Promise<void>;
    subscribe: (id: string, callback: (value: any) => void) => () => void;
    unsubscribe: (id: string) => void;
}
export declare class ComponentSystem {
    private reactives;
    private plugins;
    private middleware;
    private history;
    private batchQueue;
    private subscriptions;
    private options;
    constructor(config?: SystemConfig);
    private initializePlugins;
    private createSystemContext;
    create<T>(config: ReactiveConfig<T>): Promise<Reactive<T>>;
    private createReactive;
    private updateReactiveValue;
    batch(operations: (() => Promise<void>)[]): Promise<void>;
    private notifyDependents;
    private runPluginHook;
    private runMiddleware;
    private handleError;
    private updateHistory;
    private setupDevTools;
    getReactive(id: string): Reactive<any> | undefined;
    private registerReactive;
    private removeReactive;
    private subscribe;
    private unsubscribe;
}
export declare const LoggerPlugin: Plugin;
declare global {
    interface Window {
        __COMPONENT_DEVTOOLS__: any;
        componentSystem: ComponentSystem;
    }
}
export declare const PersistencePlugin: Plugin;
