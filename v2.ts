// Core types and interfaces
export type Primitive = string | number | boolean | null | undefined;
export type JSONValue = Primitive | JSONObject | JSONArray;
export interface JSONObject {
	[key: string]: JSONValue;
}
export interface JSONArray extends Array<JSONValue> {}

// Plugin System
export interface Plugin<T = any> {
	name: string;

	initialize?: (context: SystemContext) => void;

	beforeCreate?: (
		config: ReactiveConfig<T>,
	) => ReactiveConfig<T> | Promise<ReactiveConfig<T>>;

	afterCreate?: (reactive: Reactive<T>) => void | Promise<void>;

	beforeUpdate?: (value: T, newValue: T) => T | Promise<T>;

	afterUpdate?: (value: T) => void | Promise<void>;

	beforeDestroy?: (reactive: Reactive<T>) => void | Promise<void>;

	handleError?: (
		error: Error,
		context: { phase: string; config: ReactiveConfig<T> },
	) => void | Promise<void>;
}

// Enhanced Reactive System
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

// Configuration Types
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
// Enhanced Component Factory
export class ComponentSystem {
	private reactives: Map<string, Reactive<any>> = new Map();

	private plugins: Map<string, Plugin> = new Map();

	private middleware: Middleware[] = [];

	private history: Map<string, any[]> = new Map();

	private batchQueue: Map<string, any> = new Map();

	private subscriptions: Map<string, Set<(value: any) => void>> = new Map();

	private options: Required<SystemConfig["options"]>;

	constructor(config: SystemConfig = {}) {
		this.options = {
			enableHistory: false,
			historySize: 10,
			asyncTimeout: 5000,
			batchUpdates: false,
			devTools: false,
			...config.options,
		};

		this.initializePlugins(config.plugins || []);

		this.middleware = config.middleware || [];

		if (this.options.devTools) {
			this.setupDevTools();
		}
	}

	private initializePlugins(plugins: Plugin[]) {
		plugins.forEach((plugin) => {
			this.plugins.set(plugin.name, plugin);

			plugin.initialize?.(this.createSystemContext());
		});
	}

	private createSystemContext(): SystemContext {
		return {
			reactives: this.reactives,
			history: this.history,
			options: this.options,
			registerReactive: this.registerReactive.bind(this),
			removeReactive: this.removeReactive.bind(this),
			getReactive: this.getReactive.bind(this),
			batch: this.batch.bind(this),
			subscribe: this.subscribe.bind(this),
			unsubscribe: this.unsubscribe.bind(this),
		};
	}

	async create<T>(config: ReactiveConfig<T>): Promise<Reactive<T>> {
		const processedConfig = await this.runPluginHook(
			"beforeCreate",
			config,
		);

		const reactive = await this.createReactive(processedConfig);

		await this.runPluginHook("afterCreate", reactive);

		return reactive;
	}

	private async createReactive<T>(
		config: ReactiveConfig<T>,
	): Promise<Reactive<T>> {
		const reactive: Reactive<T> = {
			id: config.id || crypto.randomUUID(),
			value: () => config.initialValue as T,
			meta: {
				type: config.type,
				created: new Date(),
				updateCount: 0,
				status: "idle",
				custom: {},
			},
			dependencies: new Set(config.dependencies || []),
			dependents: new Set(),
		};

		if (config.type !== "readonly") {
			reactive.set = async (newValue: T) => {
				try {
					const processedValue = await this.runMiddleware(
						"before",
						newValue,
						{ reactive },
					);

					await this.updateReactiveValue(reactive, processedValue);

					await this.runMiddleware("after", reactive.value(), {
						reactive,
					});
				} catch (error) {
					await this.handleError(error as Error, {
						reactive,
						phase: "update",
					});
				}
			};
		}

		this.registerReactive(reactive);

		return reactive;
	}

	private async updateReactiveValue<T>(
		reactive: Reactive<T>,
		newValue: T,
	): Promise<void> {
		if (this.options.batchUpdates && this.batchQueue.size > 0) {
			this.batchQueue.set(reactive.id, newValue);

			return;
		}

		const oldValue = reactive.value();

		const processedValue = await this.runPluginHook(
			"beforeUpdate",
			newValue,
			oldValue,
		);

		// Update the reactive
		const valueRef = { current: processedValue };

		reactive.value = () => valueRef.current;

		reactive.meta.lastUpdated = new Date();

		reactive.meta.updateCount++;

		// Handle history
		if (this.options.enableHistory) {
			this.updateHistory(reactive.id, oldValue);
		}

		// Notify dependents
		await this.notifyDependents(reactive);

		await this.runPluginHook("afterUpdate", processedValue);
	}

	batch(operations: (() => Promise<void>)[]): Promise<void> {
		return new Promise((resolve, reject) => {
			Promise.all(operations.map((op) => op()))
				.then(() => {
					const updates = Array.from(this.batchQueue.entries());

					this.batchQueue.clear();

					return Promise.all(
						updates.map(([id, value]) =>
							this.getReactive(id)?.set?.(value),
						),
					);
				})
				.then(resolve)
				.catch(reject);
		});
	}

	// Advanced Reactive Graph Management
	private async notifyDependents(reactive: Reactive<any>): Promise<void> {
		const visited = new Set<string>();

		const queue = Array.from(reactive.dependents);

		while (queue.length > 0) {
			const dependentId = queue.shift()!;

			if (visited.has(dependentId)) continue;

			visited.add(dependentId);

			const dependent = this.getReactive(dependentId);

			if (dependent?.set) {
				await dependent.set(dependent.value());
			}

			queue.push(...Array.from(dependent?.dependents || []));
		}
	}

	// Plugin and Middleware Management
	private async runPluginHook<T, R>(
		hook: keyof Plugin,
		value: T,
		...args: any[]
	): Promise<R> {
		let result = value as unknown as R;

		for (const plugin of this.plugins.values()) {
			const hookFn = plugin[hook] as (...args: any[]) => R | Promise<R>;

			if (hookFn) {
				result = await hookFn.call(plugin, result, ...args);
			}
		}

		return result;
	}

	private async runMiddleware(
		phase: "before" | "after",
		value: any,
		context: Omit<MiddlewareContext, "phase" | "timestamp">,
	): Promise<any> {
		let result = value;

		const timestamp = Date.now();

		for (const middleware of this.middleware) {
			const handler =
				phase === "before" ? middleware.before : middleware.after;

			if (handler) {
				result = await handler(result, {
					...context,
					phase,
					timestamp,
				});
			}
		}

		return result;
	}

	// Error Handling
	private async handleError(
		error: Error,
		context: { reactive: Reactive<any>; phase: string },
	) {
		context.reactive.meta.status = "error";

		context.reactive.meta.error = error;

		// Plugin error handling
		for (const plugin of this.plugins.values()) {
			await plugin.handleError?.(error, {
				phase: context.phase,
				config: { type: context.reactive.meta.type },
			});
		}

		// Middleware error handling
		for (const middleware of this.middleware) {
			await middleware.error?.(error, {
				reactive: context.reactive,
				phase: "error",
				timestamp: Date.now(),
				meta: {},
			});
		}

		throw error;
	}

	// History Management
	private updateHistory(reactiveId: string, value: any) {
		if (!this.history.has(reactiveId)) {
			this.history.set(reactiveId, []);
		}

		const history = this.history.get(reactiveId)!;

		history.push(value);

		if (history.length > this.options.historySize) {
			history.shift();
		}
	}

	// DevTools Integration
	private setupDevTools() {
		const devTools = {
			getState: () => ({
				reactives: Array.from(this.reactives.entries()),
				history: Array.from(this.history.entries()),
				plugins: Array.from(this.plugins.keys()),
				middleware: this.middleware.map((m) => m.name),
			}),
			subscribe: (callback: (state: any) => void) => {
				const handler = () => callback(devTools.getState());

				this.subscriptions.set("devtools", new Set([handler]));

				return () =>
					this.subscriptions.get("devtools")?.delete(handler);
			},
		};

		window.__COMPONENT_DEVTOOLS__ = devTools;
	}

	// Utility Methods
	getReactive(id: string): Reactive<any> | undefined {
		return this.reactives.get(id);
	}

	private registerReactive(reactive: Reactive<any>) {
		this.reactives.set(reactive.id, reactive);
	}

	private removeReactive(id: string) {
		const reactive = this.reactives.get(id);

		if (reactive) {
			this.runPluginHook("beforeDestroy", reactive);

			this.reactives.delete(id);

			this.history.delete(id);

			this.subscriptions.delete(id);
		}
	}

	private subscribe(id: string, callback: (value: any) => void) {
		if (!this.subscriptions.has(id)) {
			this.subscriptions.set(id, new Set());
		}
		this.subscriptions.get(id)!.add(callback);

		return () => this.subscriptions.get(id)?.delete(callback);
	}

	private unsubscribe(id: string) {
		this.subscriptions.delete(id);
	}
}

// Example Plugins
export const LoggerPlugin: Plugin = {
	name: "logger",
	initialize: (context) => {
		console.log("Logger plugin initialized");
	},
	beforeCreate: (config) => {
		console.log("Creating reactive:", config);

		return config;
	},
	afterCreate: (reactive) => {
		console.log("Reactive created:", reactive);
	},
	handleError: (error, context) => {
		console.error("Error in reactive:", error, context);
	},
};

declare global {
	interface Window {
		__COMPONENT_DEVTOOLS__: any;
		componentSystem: ComponentSystem;
	}
}

export const PersistencePlugin: Plugin = {
	name: "persistence",
	initialize: (context) => {
		// Load persisted state
		const stored = localStorage.getItem("reactives");

		if (stored) {
			const state = JSON.parse(stored);

			Object.entries(state).forEach(([id, value]) => {
				context.registerReactive({
					id,
					value: () => value,
					meta: {
						type: "persisted",
						created: new Date(),
						updateCount: 0,
						status: "idle",
						custom: {},
					},
					dependencies: new Set(),
					dependents: new Set(),
				});
			});
		}
	},
	afterUpdate: (value) => {
		// Persist updated state
		const state = Array.from(
			window.componentSystem.reactives.entries(),
		).reduce(
			(acc, [id, reactive]) => ({
				...acc,
				[id]: reactive.value(),
			}),
			{},
		);

		localStorage.setItem("reactives", JSON.stringify(state));
	},
};

const system = new ComponentSystem({
	plugins: [LoggerPlugin, PersistencePlugin],
	middleware: [
		{
			name: "validation",
			before: (value, context) => {
				if (value === null) throw new Error("Value cannot be null");

				return value;
			},
		},
	],
	options: {
		enableHistory: true,
		batchUpdates: true,
		devTools: true,
	},
});

// Create and use reactives
async function example() {
	const countReactive = await system.create({
		id: "count",
		type: "state",
		initialValue: 0,
	});

	const doubledReactive = await system.create({
		id: "doubled",
		type: "computed",
		initialValue: 0,
		dependencies: ["count"],
	});

	// Batch updates
	await system.batch([
		async () => await countReactive.set!(1),
		async () => await countReactive.set!(2),
		async () => await countReactive.set!(3),
	]);
}
