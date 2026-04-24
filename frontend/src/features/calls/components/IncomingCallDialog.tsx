import {
  Box,
  Fade,
  IconButton,
  Portal,
  Stack,
  Typography,
} from '@mui/material';
import { CallEnd, CallRounded, Person } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { useChatStore } from '@/store/chat-store';
import { createGuestCallLinkToken } from '../api/callSessions';
import type { IncomingCall } from '../types';
import { buildGuestCallUrl } from '../utils/guestLink';

type Props = {
  incomingCall: IncomingCall | null;
  onDecline: () => void;
  onAccept: (call: IncomingCall) => void;
};

export function IncomingCallDialog({ incomingCall, onDecline, onAccept }: Props) {
  const isOpen = Boolean(incomingCall);
  const callerName = incomingCall?.callerName || 'Unknown';

  return (
    <Portal>
      <Fade in={isOpen} mountOnEnter unmountOnExit>
        <Box
          sx={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: { xs: 'calc(100vw - 24px)', sm: 252 },
            maxWidth: { xs: 360, sm: 252 },
            zIndex: (theme) => theme.zIndex.modal + 30,
            pointerEvents: 'auto',
            px: { xs: 'max(0px, env(safe-area-inset-left))', sm: 0 },
          }}
        >
          <Box
            sx={(theme) => ({
              textAlign: 'center',
              borderRadius: 2.2,
              px: { xs: 1.45, sm: 1.7 },
              py: { xs: 1.45, sm: 1.7 },
              border: `1px solid ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.16 : 0.2)}`,
              background:
                theme.palette.mode === 'dark'
                  ? 'linear-gradient(180deg, rgba(26,34,48,0.96) 0%, rgba(18,24,35,0.96) 100%)'
                  : 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(247,249,253,0.98) 100%)',
              boxShadow:
                theme.palette.mode === 'dark'
                  ? '0 18px 45px rgba(2, 6, 23, 0.55)'
                  : '0 12px 34px rgba(15,23,42,0.17)',
            })}
          >
            <Box
              sx={(theme) => ({
                width: 88,
                height: 88,
                mx: 'auto',
                borderRadius: 4.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mb: 1.45,
                bgcolor:
                  theme.palette.mode === 'dark'
                    ? alpha('#9db2d0', 0.12)
                    : alpha('#dfe8f6', 0.9),
                border: `1px solid ${
                  theme.palette.mode === 'dark'
                    ? alpha('#c7d8f4', 0.14)
                    : alpha('#c4d2ea', 0.9)
                }`,
                boxShadow:
                  theme.palette.mode === 'dark'
                    ? '0 18px 50px rgba(2, 6, 23, 0.45)'
                    : '0 10px 30px rgba(145, 165, 198, 0.32)',
              })}
            >
              <Box
                sx={(theme) => ({
                  width: 76,
                  height: 76,
                  borderRadius: 3,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor:
                    theme.palette.mode === 'dark'
                      ? alpha('#ffffff', 0.1)
                      : '#ffffff',
                })}
              >
                <Person sx={{ fontSize: 33, color: 'text.secondary' }} />
              </Box>
            </Box>

            <Typography
              variant="subtitle1"
              sx={{ fontWeight: 800, letterSpacing: '-0.02em', mb: 0.2 }}
            >
              {callerName}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.65, fontSize: '0.92rem' }}>
              Входящий звонок
            </Typography>

            <Stack direction="row" justifyContent="center" spacing={3.2}>
              <Box>
                <IconButton
                  aria-label="Accept incoming call"
                  onClick={() => {
                    if (incomingCall) onAccept(incomingCall);
                  }}
                  sx={{
                    width: { xs: 56, sm: 52 },
                    height: { xs: 56, sm: 52 },
                    borderRadius: '999px',
                    bgcolor: '#1f7aff',
                    color: '#fff',
                    mx: 'auto',
                    mb: 0.4,
                    boxShadow: '0 7px 14px rgba(31, 122, 255, 0.27)',
                    '&:hover': { bgcolor: '#156be7' },
                  }}
                >
                  <CallRounded sx={{ fontSize: 21 }} />
                </IconButton>
              </Box>
              <Box>
                <IconButton
                  aria-label="Decline incoming call"
                  onClick={onDecline}
                  sx={{
                    width: { xs: 56, sm: 52 },
                    height: { xs: 56, sm: 52 },
                    borderRadius: '999px',
                    bgcolor: '#f03434',
                    color: '#fff',
                    mx: 'auto',
                    mb: 0.4,
                    boxShadow: '0 7px 14px rgba(240, 52, 52, 0.24)',
                    '&:hover': { bgcolor: '#df2424' },
                  }}
                >
                  <CallEnd sx={{ fontSize: 21 }} />
                </IconButton>
              </Box>
            </Stack>
          </Box>
        </Box>
      </Fade>
    </Portal>
  );
}

export function acceptIncomingCall(
  call: IncomingCall,
  openChatCall: (chatId: number) => void,
) {
  if (call.asGuest) {
    const state = useChatStore.getState();
    const guestName = state.user?.firstname || state.user?.username || 'Guest';
    void createGuestCallLinkToken(call.chatId)
      .then(({ token }) => {
        window.location.assign(buildGuestCallUrl(token, guestName));
      })
      .catch(() => {
        window.location.assign(
          `/guest-call?roomId=${encodeURIComponent(String(call.chatId))}&name=${encodeURIComponent(guestName)}`,
        );
      });
    return;
  }
  openChatCall(call.chatId);
}
