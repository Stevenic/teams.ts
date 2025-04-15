import { MessageReactionType } from '@microsoft/teams.api';

export type MessageReactionsEmoji = Array<{
  readonly label: string;
  readonly reaction: MessageReactionType;
}>;

export const messageReactions: MessageReactionsEmoji = [
  { label: '👍', reaction: 'like' },
  { label: '❤️', reaction: 'heart' },
  { label: '😆', reaction: 'laugh' },
  { label: '😮', reaction: 'surprised' },
];
