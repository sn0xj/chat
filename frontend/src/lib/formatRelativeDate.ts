import dayjs from 'dayjs';

/**
 * Формат времени для списка чатов:
 * сегодня → HH:mm, вчера → «Вчера», 2-7 дней → «Пн», «Вт», старше → DD.MM.YYYY.
 */
export function formatChatListTime(iso?: string | null): string {
  if (!iso) return '';
  const date = dayjs(iso);
  if (!date.isValid()) return '';
  const now = dayjs();
  if (date.isSame(now, 'day')) {
    return date.format('HH:mm');
  }
  const diffDays = now.startOf('day').diff(date.startOf('day'), 'day');
  if (diffDays === 1) {
    return 'Вчера';
  }
  if (diffDays < 7) {
    const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    return weekdays[date.day()];
  }
  return date.format('DD.MM.YYYY');
}

/**
 * Разделитель в потоке сообщений: «Сегодня», «Вчера», «Пн, 21 апр» или «21 апреля 2025».
 */
export function formatMessageDateSeparator(iso?: string | null): string {
  if (!iso) return '';
  const date = dayjs(iso);
  if (!date.isValid()) return '';
  const now = dayjs();
  if (date.isSame(now, 'day')) return 'Сегодня';
  const diffDays = now.startOf('day').diff(date.startOf('day'), 'day');
  if (diffDays === 1) return 'Вчера';
  if (date.isSame(now, 'year')) {
    return date.locale('ru').format('D MMMM');
  }
  return date.locale('ru').format('D MMMM YYYY');
}

/**
 * Короткое время рядом с сообщением (в группировке — только HH:mm).
 */
export function formatMessageTime(iso?: string | null): string {
  if (!iso) return '';
  const date = dayjs(iso);
  if (!date.isValid()) return '';
  return date.format('HH:mm');
}
