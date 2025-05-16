import { EmitPluginEvent, Event, IActivityEvent, IErrorEvent, IPlugin, IPluginActivityEvent, IPluginActivitySentEvent, Logger, Plugin, Storage } from '@microsoft/teams.apps';
import { ILogger, IStorage } from '@microsoft/teams.common';
import { InMemoryMessageBuffer, MessageBuffer } from './buffer';
import { ExtractionJob, InMemoryQueue, Queue } from './queue';
import { InMemoryMessageStorage, MessageStorage } from './storage';
import { Message } from './types';

interface IAIMemoryPluginOptions {
    maxHistory?: number;
    maxBufferSize?: number;
    bufferTimeoutMs?: number;
}

interface MemoryEvents {
    'aimemory:memory-added': {
        // TODO
    };
}

@Plugin({
    name: 'aimemory',
    description: 'AIMemory Plugin',
    version: '1.0.0',
})
export class AIMemoryPlugin implements IPlugin {
    @Event('custom')
    protected readonly emit!: EmitPluginEvent<MemoryEvents>;

    @Storage()
    protected readonly _storage!: IStorage;

    @Logger()
    protected readonly _logger!: ILogger;

    @Event('error')
    readonly $onError!: (event: IErrorEvent) => void;

    @Event('activity')
    readonly $onActivity!: (event: IActivityEvent) => void;

    private messageStorage: MessageStorage;
    private options: IAIMemoryPluginOptions;
    private messageBuffer: MessageBuffer;
    private extractionQueue: Queue<ExtractionJob>;

    constructor(options: IAIMemoryPluginOptions = {}) {
        this.options = options;
        this.messageStorage = new InMemoryMessageStorage(this.options.maxHistory);
        this.messageBuffer = new InMemoryMessageBuffer(
            this.options.maxBufferSize,
            this.options.bufferTimeoutMs,
            this.handleBufferTimeout.bind(this)
        );
        this.extractionQueue = new InMemoryQueue<ExtractionJob>();
    }

    onInit() {
        // No-op for now
    }

    addMessage(message: Message): void {
        this.messageStorage.addMessage(message);
        this.messageBuffer.addToBuffer(message);
        const buffer = this.messageBuffer.getBuffer(message.conversationId);
        if (buffer.length >= (this.options.maxBufferSize || 10)) {
            // Buffer size trigger: enqueue extraction job and clear buffer
            this.enqueueExtractionJob(message.conversationId, buffer);
            this.messageBuffer.clearBuffer(message.conversationId);
        }
        // Timeout trigger is now handled by the buffer's callback
    }

    private enqueueExtractionJob(conversationId: string, messages: Message[]): void {
        const job: ExtractionJob = {
            conversationId,
            messages: [...messages],
            enqueuedAt: Date.now(),
        };
        this.extractionQueue.enqueue(job);
        this._logger?.info?.('AIMemoryPlugin: Extraction job enqueued', { conversationId, count: messages.length });
    }

    private handleBufferTimeout(conversationId: string, messages: Message[]): void {
        this._logger?.info?.('AIMemoryPlugin: Buffer timeout, enqueuing extraction job', { conversationId, count: messages.length });
        this.enqueueExtractionJob(conversationId, messages);
        // Buffer is already cleared by the buffer itself
    }

    getRecentMessages(conversationId: string, limit?: number): Message[] {
        return this.messageStorage.getRecentMessages(conversationId, limit);
    }

    onActivity?(event: IPluginActivityEvent): void | Promise<void> {
        const { activity } = event;
        if (activity.type === 'message') {
            this._logger.info('AIMemoryPlugin: onActivity', { activity });
            const message = this.activityToMessage(activity);
            this.addMessage(message);
        }
    }

    onActivitySent?(event: IPluginActivitySentEvent): void | Promise<void> {
        const { activity } = event;
        if (activity.type === 'message') {
            this._logger.info('AIMemoryPlugin: onActivitySent', { activity });
            const message = this.activityToMessage(activity);
            this.addMessage(message);
        }
    }

    private activityToMessage(activity: any): Message {
        return {
            id: activity.id,
            text: activity.text,
            senderId: activity.from?.id || '',
            senderName: activity.from?.name || '',
            timestamp: activity.timestamp ? new Date(activity.timestamp).getTime() : Date.now(),
            conversationId: activity.conversation?.id || '',
            attachments: activity.attachments,
            metadata: {
                ...activity
            }
        };
    }
}