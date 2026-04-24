import type { Message } from '@/lib/types';

export type MessageGroupMeta = {
  /** Первое сообщение в визуальной группе (показывает аватар и имя) */
  isFirstInGroup: boolean;
  /** Последнее сообщение в визуальной группе (используется для отступов) */
  isLastInGroup: boolean;
};

const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * Возвращает метаданные группировки для каждого сообщения.
 * Группа ломается при смене автора или паузе > 5 минут.
 */
export function computeGroupMeta(messages: Message[]): MessageGroupMeta[] {
  const result: MessageGroupMeta[] = new Array(messages.length);
  for (let i = 0; i < messages.length; i += 1) {
    const prev = i > 0 ? messages[i - 1] : null;
    const next = i < messages.length - 1 ? messages[i + 1] : null;
    result[i] = {
      isFirstInGroup: shouldBreakGroup(prev, messages[i]),
      isLastInGroup: shouldBreakGroup(messages[i], next),
    };
  }
  return result;
}

function shouldBreakGroup(prev: Message | null, current: Message | null): boolean {
  if (!prev || !current) return true;
  if (prev.sender_id !== current.sender_id) return true;
  const prevTs = prev.created_at ? Date.parse(prev.created_at) : 0;
  const currTs = current.created_at ? Date.parse(current.created_at) : 0;
  if (!prevTs || !currTs) return true;
  return Math.abs(currTs - prevTs) > FIVE_MINUTES;
}
