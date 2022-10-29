export interface CompletionResult<T> {
  result?: T;
  error?: any;
}

export class Completer<T = void> {
  private readonly promise: Promise<CompletionResult<T>>;
  private _resolve?: (value: CompletionResult<T> | PromiseLike<CompletionResult<T>>) => void;
  private _complete = false;
  private _completionValue?: CompletionResult<T>;
  public get isComplete(): boolean {
    return this._complete;
  }
  private set resolve(
    resolver: (value: CompletionResult<T> | PromiseLike<CompletionResult<T>>) => void
  ) {
    this._resolve = resolver;
    if (this._complete) this._resolve(this._completionValue || {});
  }
  public get completion(): Promise<CompletionResult<T>> {
    return this.promise;
  }

  constructor() {
    this.promise = new Promise<CompletionResult<T>>((resolve) => {
      this.resolve = resolve;
    });
  }

  completeWithError(error: any): void {
    if (this._complete) return;
    this._complete = true;
    this._completionValue = {
      error,
    };
    if (this._resolve) this._resolve(this._completionValue);
  }

  complete(result: T): void {
    if (this._complete) return;
    this._complete = true;
    this._completionValue = {
      result,
    };
    if (this._resolve) this._resolve(this._completionValue);
  }
}
