import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/ru';

dayjs.extend(relativeTime);
dayjs.locale('ru');

/** Считаем пользователя «в сети», если последняя активность не старше этого окна. */
const ONLINE_THRESHOLD_MS = 3 * 60 * 1000;

export function isUserOnline(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = dayjs(iso);
  if (!d.isValid()) return false;
  return dayjs().diff(d) <= ONLINE_THRESHOLD_MS;
}

/**
 * Статус по `last_activity`: «в сети» / «не в сети» и относительное время последней активности.
 */
export function formatPresenceByLastActivity(iso: string | null | undefined): string {
  if (!iso) {
    return 'Нет данных';
  }
  const d = dayjs(iso);
  if (!d.isValid()) {
    return 'Нет данных';
  }
  const ago = d.fromNow();
  const recent = dayjs().diff(d) <= ONLINE_THRESHOLD_MS;
  return recent ? `в сети · ${ago}` : `не в сети · ${ago}`;
}
