import { Message } from './types';

export type BufferTimeoutCallback = (conversationId: string, messages: Message[]) => void;

export interface MessageBuffer {
    addToBuffer(message: Message): void;
    getBuffer(conversationId: string): Message[];
    clearBuffer(conversationId: string): void;
    getAllBuffers(): Record<string, Message[]>;
}

export class InMemoryMessageBuffer implements MessageBuffer {
    private buffers: Map<string, Message[]> = new Map();
    private timers: Map<string, NodeJS.Timeout> = new Map();
    private maxBufferSize: number;
    private bufferTimeoutMs: number;
    private onTimeout?: BufferTimeoutCallback;

    /**
     * @param maxBufferSize Max messages per buffer before size-based flush
     * @param bufferTimeoutMs Timeout in ms before timeout-based flush
     * @param onTimeout Callback to invoke when a buffer times out
     */
    constructor(
        maxBufferSize: number = 10,
        bufferTimeoutMs: number = 60000,
        onTimeout?: BufferTimeoutCallback
    ) {
        this.maxBufferSize = maxBufferSize;
        this.bufferTimeoutMs = bufferTimeoutMs;
        this.onTimeout = onTimeout;
    }

    addToBuffer(message: Message): void {
        const { conversationId } = message;
        const buffer = this.buffers.get(conversationId) || [];
        buffer.push(message);
        if (buffer.length > this.maxBufferSize) {
            buffer.shift(); // Remove oldest if over buffer size
        }
        this.buffers.set(conversationId, buffer);
        this.resetTimer(conversationId);
    }

    private resetTimer(conversationId: string): void {
        if (this.timers.has(conversationId)) {
            clearTimeout(this.timers.get(conversationId)!);
        }
        this.timers.set(
            conversationId,
            setTimeout(() => {
                const buffer = this.buffers.get(conversationId);
                if (buffer && buffer.length > 0 && this.onTimeout) {
                    this.onTimeout(conversationId, [...buffer]);
                    this.clearBuffer(conversationId);
                }
            }, this.bufferTimeoutMs)
        );
    }

    getBuffer(conversationId: string): Message[] {
        return this.buffers.get(conversationId) || [];
    }

    clearBuffer(conversationId: string): void {
        this.buffers.delete(conversationId);
        if (this.timers.has(conversationId)) {
            clearTimeout(this.timers.get(conversationId)!);
            this.timers.delete(conversationId);
        }
    }

    getAllBuffers(): Record<string, Message[]> {
        const result: Record<string, Message[]> = {};
        for (const [convId, msgs] of this.buffers.entries()) {
            result[convId] = msgs;
        }
        return result;
    }
} 