import { IListStorage } from '@microsoft/teams.common';

import { Message } from './message';

export interface IMemory extends IListStorage<Message> {
  collapse(): (Message | undefined) | Promise<Message | undefined>;
}

export interface IReferentialMemory {
  lastMessageRef: string;
  updateLastMessageRef?: (ref: string) => void | Promise<void>;
}
