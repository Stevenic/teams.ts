interface ICacheEntry<T> {
  data: T;
  expiry: number;
}

export class CacheManager<T> {
  private cache?: ICacheEntry<T>;
  private readonly ttl: number;

  constructor(ttl: number) {
    this.ttl = ttl;
  }

  get(): T | null {
    const currentTime = Date.now();

    if (this.cache && currentTime < this.cache.expiry) {
      return this.cache.data;
    }

    return null;
  }

  set(data: T): void {
    const currentTime = Date.now();
    this.cache = {
      data,
      expiry: currentTime + this.ttl,
    };
  }

  clear(): void {
    this.cache = undefined;
  }

  isExpired(): boolean {
    if (!this.cache) {
      return true;
    }

    return Date.now() >= this.cache.expiry;
  }
}