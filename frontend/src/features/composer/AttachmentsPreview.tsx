import { Box, Chip } from '@mui/material';

type PendingAttachment = {
  file: File;
  forcedKind?: 'image' | 'file';
};

type Props = {
  attachments: PendingAttachment[];
  onRemove: (index: number) => void;
};

export function AttachmentsPreview({ attachments, onRemove }: Props) {
  if (!attachments.length) return null;
  return (
    <Box
      sx={{
        mt: 0.75,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 0.5,
      }}
    >
      {attachments.map((attachment, index) => (
        <Chip
          key={`${attachment.file.name}-${attachment.file.size}-${index}`}
          size="small"
          label={attachment.file.name}
          onDelete={() => onRemove(index)}
          sx={{ maxWidth: '100%' }}
        />
      ))}
    </Box>
  );
}

export type { PendingAttachment };
