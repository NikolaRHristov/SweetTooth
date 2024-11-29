import {
	createEffect,
	createMemo,
	createResource,
	createRoot,
	createSignal,
	onCleanup,
} from "solid-js";

// Enhanced type definitions
export type BaseConfig<T> = {
	initialValue?: T;

	getter?: (value: T) => any;

	setter?: (value: T, newValue: any) => T;

	dependencies?: (string | (() => any))[];

	dispose?: () => void;

	middleware?: Array<(next: (value: T) => any) => (value: T) => any>;

	validate?: (value: T) => boolean | Promise<boolean>;

	transform?: (value: T) => any;

	onError?: (error: any) => void;

	onSuccess?: (value: T) => void;
};

export type ReactiveConfig<T> =
	| (BaseConfig<T> & {
			type: "signal";
	  })
	| {
			type: "memo";

			compute: (deps: any) => T;
	  }
	| {
			type: "resource";

			fetcher: (
				source: any,
				{ value, refetching }: any,
			) => T | Promise<T>;

			source?: any;

			cacheStrategy?: "memory" | "session" | "local";

			refetchInterval?: number;
	  }
	| {
			type: "effect";

			effect: (deps: any) => void | (() => void);
	  }
	| {
			type: "custom";

			customLogic: (context: ComponentContext<any>) => any;
	  }
	| {
			type: "nested";

			nestedConfig: ComponentFactory;
	  }
	| {
			type: "computed";

			computed: (context: ComponentContext<any>) => T;
	  };

export type ComponentFactory = {
	[key: string]: ReactiveConfig<any>;
};

export type ComponentContext<T extends ComponentFactory> = {
	getters: { [K in keyof T]: () => any };

	setters: { [K in keyof T]: (newValue: any) => void };

	reactives: { [K in keyof T]: any };

	addReactive: <K extends string>(
		key: K,
		config: ReactiveConfig<any>,
	) => void;

	removeReactive: (key: keyof T) => void;

	reset: () => void;

	subscribe: (key: keyof T, callback: (value: any) => void) => () => void;
};

export function createComponentFactory<T extends ComponentFactory>(config: T) {
	return createRoot((dispose) => {
		const reactives: { [K in keyof T]?: any } = {};

		const getters: { [K in keyof T]?: () => any } = {};

		const setters: { [K in keyof T]?: (newValue: any) => void } = {};

		const subscribers = new Map<keyof T, Set<(value: any) => void>>();

		const cache = new Map<string, any>();

		function applyMiddleware(
			value: any,
			middleware?: Array<
				(next: (value: any) => any) => (value: any) => any
			>,
		) {
			if (!middleware?.length) return value;

			const pipeline = middleware.reduce(
				(next, middleware) => middleware(next),
				(value: any) => value,
			);

			return pipeline(value);
		}

		async function validateValue(
			value: any,
			validate?: (value: any) => boolean | Promise<boolean>,
		) {
			if (!validate) return true;

			try {
				return await validate(value);
			} catch (error) {
				return false;
			}
		}

		function notifySubscribers(key: keyof T, value: any) {
			subscribers.get(key)?.forEach((callback) => callback(value));
		}

		function createReactive<K extends keyof T>(
			conf: ReactiveConfig<any>,
			key: K,
		) {
			const baseConfig = conf as BaseConfig<any>;

			switch (conf.type) {
				case "signal": {
					const [value, setValue] = createSignal(
						baseConfig.initialValue,
					);

					reactives[key] = [value, setValue];

					getters[key] = () => {
						const rawValue = value();

						return applyMiddleware(
							baseConfig.getter
								? baseConfig.getter(rawValue)
								: rawValue,
							baseConfig.middleware,
						);
					};

					setters[key] = async (newValue: any) => {
						try {
							const transformedValue = baseConfig.transform
								? baseConfig.transform(newValue)
								: newValue;

							const isValid = await validateValue(
								transformedValue,
								baseConfig.validate,
							);

							if (isValid) {
								setValue((current) =>
									baseConfig.setter
										? baseConfig.setter(
												current,
												transformedValue,
											)
										: transformedValue,
								);

								baseConfig.onSuccess?.(transformedValue);

								notifySubscribers(key, transformedValue);
							} else {
								baseConfig.onError?.(
									new Error("Validation failed"),
								);
							}
						} catch (error) {
							baseConfig.onError?.(error);
						}
					};

					break;
				}

				case "resource": {
					const [resource] = createResource(
						() => conf.source && getDependencies([conf.source])[0],
						async (...args) => {
							try {
								const cacheKey = JSON.stringify(args);

								if (conf.cacheStrategy && cache.has(cacheKey)) {
									return cache.get(cacheKey);
								}

								const result = await conf.fetcher(...args);

								if (conf.cacheStrategy) {
									cache.set(cacheKey, result);
								}

								baseConfig.onSuccess?.(result);

								return result;
							} catch (error) {
								baseConfig.onError?.(error);

								throw error;
							}
						},
					);

					if (conf.refetchInterval) {
						const interval = setInterval(
							() => resource.refetch(),
							conf.refetchInterval,
						);

						onCleanup(() => clearInterval(interval));
					}

					reactives[key] = resource;

					getters[key] = () => resource();

					break;
				}

				case "computed": {
					reactives[key] = createMemo(() => {
						try {
							const result = conf.computed({
								getters,
								setters,
								reactives,
							});

							baseConfig.onSuccess?.(result);

							return result;
						} catch (error) {
							baseConfig.onError?.(error);

							throw error;
						}
					});

					getters[key] = () => reactives[key]();

					break;
				}

				// ... other cases remain similar but with added error handling and middleware support
			}
		}

		function getDependencies(deps?: (string | (() => any))[]) {
			return deps
				? deps.map((dep) =>
						typeof dep === "string" ? getters[dep]() : dep(),
					)
				: [];
		}

		// Initialize all reactives
		for (const [key, conf] of Object.entries(config)) {
			createReactive(conf, key as keyof T);
		}

		const context: ComponentContext<T> = {
			reactives: reactives as {
				[K in keyof T]: T[K] extends ReactiveConfig<infer U>
					? U
					: never;
			},
			getters: getters as { [K in keyof T]: () => TypeIndexer<T>[K] },
			setters: setters as {
				[K in keyof T]: (newValue: TypeIndexer<T>[K]) => void;
			},
			addReactive: (key, config) =>
				createReactive(config, key as unknown as keyof T),
			removeReactive: (key) => {
				delete reactives[key];

				delete getters[key];

				delete setters[key];

				subscribers.delete(key);
			},
			reset: () => {
				Object.keys(config).forEach((key) => {
					const conf = config[key as keyof T];

					if (conf.type === "signal") {
						setters[key as keyof T]?.(conf.initialValue);
					}
				});
			},
			subscribe: (key, callback) => {
				if (!subscribers.has(key)) {
					subscribers.set(key, new Set());
				}

				subscribers.get(key)!.add(callback);

				return () => subscribers.get(key)!.delete(callback);
			},
		};

		onCleanup(() => {
			subscribers.clear();

			cache.clear();

			Object.values(config).forEach((conf) => conf.dispose?.());
		});

		return context;
	});
}
