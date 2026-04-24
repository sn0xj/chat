import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Message } from '@/lib/types';

export type MessageAction = 'reply' | 'forward' | 'edit' | 'delete' | 'more';

export type OnMessageAction = (
  action: MessageAction,
  message: Message,
  event: ReactMouseEvent<HTMLElement>,
) => void;
