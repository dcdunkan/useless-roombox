export type LoadedSuccess<T> = { state: "resolved"; data: T };
export type LoadedPending = { state: "pending"; message: string };
export type LoadedFailure = { state: "failed"; message: string };
export type LoadedData<T> = LoadedSuccess<T> | LoadedPending | LoadedFailure;
