import { useCallback, useEffect, useMemo, useState } from "react";

import type { ComponentSystem, Reactive } from "./types";

export interface UseReactiveOptions<T> {
	immediate?: boolean;
	transform?: (value: T) => T;
	onError?: (error: Error) => void;
	suspense?: boolean;
	debounce?: number;
}

export interface ReactiveHookResult<T> {
	value: T;
	error: Error | null;
	isLoading: boolean;
	setValue: (newValue: T | ((prev: T) => T)) => Promise<void>;
	reset: () => Promise<void>;
	meta: {
		updateCount: number;
		lastUpdated: Date | undefined;
		status: "idle" | "loading" | "error" | "success";
	};
}

export function createReactiveHookFactory(system: ComponentSystem) {
	function useReactive<T>(
		reactiveId: string,
		options: UseReactiveOptions<T> = {},
	): ReactiveHookResult<T> {
		const {
			immediate = true,
			transform,
			onError,
			suspense = false,
			debounce = 0,
		} = options;

		const reactive = useMemo(
			() => system.getReactive(reactiveId),
			[reactiveId],
		);

		if (!reactive && suspense) {
			throw new Error(`Reactive with id "${reactiveId}" not found`);
		}

		const [state, setState] = useState<T>(() => {
			const initialValue = reactive?.value() as T;
			return transform ? transform(initialValue) : initialValue;
		});

		const [error, setError] = useState<Error | null>(null);
		const [isLoading, setIsLoading] = useState(false);

		// Memoize the setValue function to prevent unnecessary rerenders
		const setValue = useCallback(
			async (newValue: T | ((prev: T) => T)) => {
				if (!reactive?.set) {
					throw new Error(`Reactive "${reactiveId}" is read-only`);
				}

				setIsLoading(true);
				setError(null);

				try {
					const resolvedValue =
						typeof newValue === "function"
							? (newValue as (prev: T) => T)(state)
							: newValue;

					const transformedValue = transform
						? transform(resolvedValue)
						: resolvedValue;

					await reactive.set(transformedValue);
					setState(transformedValue);
				} catch (err) {
					const error =
						err instanceof Error ? err : new Error(String(err));
					setError(error);
					onError?.(error);
				} finally {
					setIsLoading(false);
				}
			},
			[reactive, reactiveId, state, transform, onError],
		);

		// Handle subscription to reactive updates
		useEffect(() => {
			if (!reactive || !immediate) return;

			let timeoutId: NodeJS.Timeout;

			const handleUpdate = (value: T) => {
				const updateFn = () => {
					const transformedValue = transform
						? transform(value)
						: value;
					setState(transformedValue);
				};

				if (debounce > 0) {
					clearTimeout(timeoutId);
					timeoutId = setTimeout(updateFn, debounce);
				} else {
					updateFn();
				}
			};

			const unsubscribe = system.subscribe(reactiveId, handleUpdate);

			return () => {
				unsubscribe();
				clearTimeout(timeoutId);
			};
		}, [reactive, reactiveId, immediate, transform, debounce]);

		// Reset functionality
		const reset = useCallback(async () => {
			if (!reactive) return;

			setIsLoading(true);
			setError(null);

			try {
				const initialValue = reactive.value() as T;
				const transformedValue = transform
					? transform(initialValue)
					: initialValue;
				await reactive.set?.(transformedValue);
				setState(transformedValue);
			} catch (err) {
				const error =
					err instanceof Error ? err : new Error(String(err));
				setError(error);
				onError?.(error);
			} finally {
				setIsLoading(false);
			}
		}, [reactive, transform, onError]);

		return {
			value: state,
			error,
			isLoading,
			setValue,
			reset,
			meta: {
				updateCount: reactive?.meta.updateCount ?? 0,
				lastUpdated: reactive?.meta.lastUpdated,
				status: reactive?.meta.status ?? "idle",
			},
		};
	}

	// Create a computed reactive hook
	function useComputedReactive<T, D extends any[]>(
		computation: (...deps: D) => T,
		dependencies: string[],
		options: Omit<UseReactiveOptions<T>, "immediate"> = {},
	): Omit<ReactiveHookResult<T>, "setValue"> {
		const depReactives = dependencies.map((id) => system.getReactive(id));
		const depValues = depReactives.map((reactive) => reactive?.value());

		const computedValue = useMemo(() => {
			try {
				return computation(...(depValues as D));
			} catch (err) {
				const error =
					err instanceof Error ? err : new Error(String(err));
				options.onError?.(error);
				return null;
			}
		}, [computation, ...depValues]);

		const [error, setError] = useState<Error | null>(null);
		const [isLoading] = useState(false);

		useEffect(() => {
			const handleError = (err: Error) => {
				setError(err);
				options.onError?.(err);
			};

			dependencies.forEach((depId) => {
				system.subscribe(depId, () => {
					try {
						computation(...(depValues as D));
					} catch (err) {
						handleError(
							err instanceof Error ? err : new Error(String(err)),
						);
					}
				});
			});
		}, [dependencies, computation]);

		return {
			value: options.transform
				? options.transform(computedValue as T)
				: (computedValue as T),
			error,
			isLoading,
			reset: async () => {}, // No-op for computed values
			meta: {
				updateCount: 0,
				lastUpdated: undefined,
				status: error ? "error" : "success",
			},
		};
	}

	return {
		useReactive,
		useComputedReactive,
	};
}
