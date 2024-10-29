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
    beforeCreate?: (config: ReactiveConfig<T>) => ReactiveConfig<T>;
    afterCreate?: (reactive: Reactive<T>) => void;
    beforeUpdate?: (value: T, newValue: T) => T;
    afterUpdate?: (value: T) => void;
    beforeDestroy?: (reactive: Reactive<T>) => void;
    handleError?: (error: Error, context: {
        phase: string;
        config: ReactiveConfig<T>;
    }) => void;
}
export interface Reactive<T> {
    id: string;
    value: () => T;
    set?: (newValue: T) => void;
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
export interface Middleware {
    name: string;
    before?: (value: any, context: MiddlewareContext) => any;
    after?: (value: any, context: MiddlewareContext) => any;
    error?: (error: Error, context: MiddlewareContext) => void;
}
export interface MiddlewareContext {
    reactive: Reactive<any>;
    phase: "before" | "after" | "error";
    timestamp: number;
    meta: Record<string, any>;
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
export declare const PersistencePlugin: Plugin;
