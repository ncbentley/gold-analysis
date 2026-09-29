/** Chats the account has joined that are not already an active source. */
export function joinableTelegramChats<T extends { id: string }>(chats: T[], trackedIds: ReadonlySet<string>): T[] {
  return chats.filter((chat) => !trackedIds.has(chat.id));
}
