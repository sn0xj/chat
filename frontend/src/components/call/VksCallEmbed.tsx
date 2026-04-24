import { useCallback, useState } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { useChatStore } from '@/store/chat-store';
import { CallRoom } from '@/features/calls/vks';
import { CallChatPanel } from './CallChatPanel';

type Props = {
  chatId: number;
  onClose: () => void;
  guestName?: string | null;
  onOpenInviteUsers?: (() => void) | null;
  autoJoin?: boolean;
  enableInCallChat?: boolean;
  initialMicEnabled?: boolean;
  initialCamEnabled?: boolean;
};

const CHAT_PANEL_WIDTH = 380;

export function VksCallEmbed({
  chatId,
  onClose,
  guestName,
  onOpenInviteUsers = null,
  autoJoin = true,
  enableInCallChat = true,
  initialMicEnabled = true,
  initialCamEnabled = true,
}: Props) {
  const token = useChatStore((state) => state.token);
  const currentUserId = useChatStore((state) => state.user?.id);
  const [chatOpen, setChatOpen] = useState(false);
  const isNarrow = useMediaQuery('(max-width: 900px)');

  const chatEnabled = enableInCallChat && (Boolean(token) || Boolean(guestName));
  const roomId = String(chatId);
  const showsSideBySide = chatEnabled && chatOpen && !isNarrow;

  const handleToggleChat = useCallback(() => {
    setChatOpen((prev) => !prev);
  }, []);

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          pr: showsSideBySide ? `${CHAT_PANEL_WIDTH}px` : 0,
          transition: 'padding-right 180ms ease',
        }}
      >
        <CallRoom
          roomId={roomId}
          onClose={onClose}
          guestName={guestName ?? null}
          autoJoin={autoJoin}
          onOpenInviteUsers={onOpenInviteUsers}
          onToggleInCallChat={chatEnabled ? handleToggleChat : null}
          inCallChatOpen={chatOpen}
          inCallChatEnabled={chatEnabled}
          initialMic={initialMicEnabled}
          initialCamera={initialCamEnabled}
        />
      </Box>

      {chatEnabled && chatOpen ? (
        <Box
          sx={(t) => ({
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: isNarrow ? '100%' : CHAT_PANEL_WIDTH,
            maxWidth: '100vw',
            zIndex: 40,
            borderLeft: isNarrow ? 0 : 1,
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            bgcolor: 'background.default',
            boxShadow:
              t.palette.mode === 'dark'
                ? '-12px 0 40px rgba(0,0,0,0.55)'
                : '-12px 0 40px rgba(15,23,42,0.18)',
          })}
        >
          <CallChatPanel
            chatId={chatId}
            currentUserId={currentUserId}
            onClose={() => setChatOpen(false)}
          />
        </Box>
      ) : null}
    </Box>
  );
}
