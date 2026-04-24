import { Dialog } from '@mui/material';
import { VksCallEmbed } from '@/components/call/VksCallEmbed';

type Props = {
  chatId: number | null;
  onClose: () => void;
  onOpenInviteUsers?: () => void;
  initialMicEnabled?: boolean;
  initialCamEnabled?: boolean;
};

export function CallFullscreenDialog({
  chatId,
  onClose,
  onOpenInviteUsers,
  initialMicEnabled = true,
  initialCamEnabled = true,
}: Props) {
  return (
    <Dialog open={Boolean(chatId)} onClose={onClose} fullScreen>
      {chatId ? (
        <VksCallEmbed
          chatId={chatId}
          onClose={onClose}
          onOpenInviteUsers={onOpenInviteUsers || null}
          initialMicEnabled={initialMicEnabled}
          initialCamEnabled={initialCamEnabled}
        />
      ) : null}
    </Dialog>
  );
}
