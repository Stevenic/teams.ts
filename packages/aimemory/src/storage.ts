import { Message } from './types';

export interface MessageStorage {
    addMessage(message: Message): void;
    getRecentMessages(conversationId: string, limit?: number): Message[];
}

export class InMemoryMessageStorage implements MessageStorage {
    private messages: Message[] = [];
    private maxHistory: number;

    constructor(maxHistory: number = 100) {
        this.maxHistory = maxHistory;
    }

    addMessage(message: Message): void {
        this.messages.push(message);
        // Enforce max history per conversation
        const convMessages = this.messages.filter(m => m.conversationId === message.conversationId);
        if (convMessages.length > this.maxHistory) {
            // Remove oldest messages for this conversation
            const toRemove = convMessages.length - this.maxHistory;
            let removed = 0;
            this.messages = this.messages.filter(m => {
                if (m.conversationId === message.conversationId && removed < toRemove) {
                    removed++;
                    return false;
                }
                return true;
            });
        }
    }

    getRecentMessages(conversationId: string, limit: number = this.maxHistory): Message[] {
        return this.messages
            .filter(m => m.conversationId === conversationId)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit)
            .reverse(); // Return in chronological order
    }
} 