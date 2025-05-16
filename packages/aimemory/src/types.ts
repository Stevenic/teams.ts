export interface Message {
    id: string;
    text: string;
    senderId: string;
    senderName: string;
    timestamp: number; // Unix epoch ms
    conversationId: string;
    attachments?: any[];
    metadata?: Record<string, any>;
} 