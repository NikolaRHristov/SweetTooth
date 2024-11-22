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
	getters: {
		[K in keyof T]: () => any;
	};
	setters: {
		[K in keyof T]: (newValue: any) => void;
	};
	reactives: {
		[K in keyof T]: any;
	};
	addReactive: <K extends string>(
		key: K,
		config: ReactiveConfig<any>,
	) => void;
	removeReactive: (key: keyof T) => void;
	reset: () => void;
	subscribe: (key: keyof T, callback: (value: any) => void) => () => void;
};
export declare function createComponentFactory<T extends ComponentFactory>(
	config: T,
): ComponentContext<T>;
