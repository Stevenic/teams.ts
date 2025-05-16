import { Message } from './types';

export interface ExtractionJob {
    conversationId: string;
    messages: Message[];
    enqueuedAt: number;
}

export interface Queue<T> {
    enqueue(job: T): void;
    dequeue(): T | undefined;
    peek(): T | undefined;
    size(): number;
}

export class InMemoryQueue<T> implements Queue<T> {
    private items: T[] = [];

    enqueue(job: T): void {
        this.items.push(job);
    }

    dequeue(): T | undefined {
        return this.items.shift();
    }

    peek(): T | undefined {
        return this.items[0];
    }

    size(): number {
        return this.items.length;
    }
} 