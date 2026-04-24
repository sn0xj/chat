import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Box, Button, TextField } from '@mui/material';
import { PhoneInTalk } from '@mui/icons-material';
import { VksCallEmbed } from '@/components/call/VksCallEmbed';
import { AppDialog } from '@/features/dialogs/AppDialog';
import { resolveGuestCallLinkToken } from '@/features/calls/api/callSessions';

export function GuestCallPage() {
  const [searchParams] = useSearchParams();
  const params = useParams<{ roomId?: string }>();
  const navigate = useNavigate();
  const rawRoomRef = params.roomId || searchParams.get('roomId') || '';
  const numericRoomId = useMemo(() => Number(rawRoomRef), [rawRoomRef]);
  const [resolvedRoomId, setResolvedRoomId] = useState<number | null>(
    Number.isFinite(numericRoomId) && numericRoomId > 0 ? numericRoomId : null,
  );
  const [resolving, setResolving] = useState(
    !Number.isFinite(numericRoomId) || numericRoomId <= 0,
  );
  const initialName = searchParams.get('name') || '';
  useEffect(() => {
    if (Number.isFinite(numericRoomId) && numericRoomId > 0) {
      setResolvedRoomId(numericRoomId);
      setResolving(false);
      return;
    }
    if (!rawRoomRef) {
      setResolvedRoomId(null);
      setResolving(false);
      return;
    }
    let cancelled = false;
    setResolving(true);
    resolveGuestCallLinkToken(rawRoomRef)
      .then(({ chatId }) => {
        if (!cancelled) {
          setResolvedRoomId(chatId);
          setResolving(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedRoomId(null);
          setResolving(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [numericRoomId, rawRoomRef]);

  const [nameInput, setNameInput] = useState(initialName);
  const [guestName, setGuestName] = useState<string | null>(initialName || null);

  const handleEndCall = useCallback(() => {
    // 1) Try to close the tab — only works if it was opened via window.open().
    // 2) Otherwise always send the user to "/" from guest flow, so guest links
    //    never bounce into an authenticated chat session in the same browser.
    try {
      window.close();
    } catch {
      /* ignore */
    }
    if (!window.closed) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  if (resolving) {
    return null;
  }

  if (!resolvedRoomId || resolvedRoomId <= 0) {
    return <Navigate to="/" replace />;
  }

  return (
    <Box
      sx={{
        width: '100vw',
        height: '100dvh',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
      }}
    >
      <AppDialog
        open={!guestName}
        onClose={() => undefined}
        disableClose
        maxWidth="xs"
        title="Гостевой вход"
        subtitle="Укажите имя — его увидят участники звонка"
        icon={<PhoneInTalk sx={{ fontSize: 20 }} />}
        actions={
          <Button
            variant="contained"
            disableElevation
            onClick={() => {
              const next = nameInput.trim();
              if (!next) return;
              setGuestName(next);
            }}
            disabled={!nameInput.trim()}
            sx={{ fontWeight: 600 }}
          >
            Продолжить
          </Button>
        }
      >
        <TextField
          label="Ваше имя"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          autoFocus
          fullWidth
          placeholder="Например: Анна"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const next = nameInput.trim();
              if (!next) return;
              setGuestName(next);
            }
          }}
        />
      </AppDialog>

      {guestName ? (
        <VksCallEmbed chatId={resolvedRoomId} guestName={guestName} onClose={handleEndCall} />
      ) : null}
    </Box>
  );
}
