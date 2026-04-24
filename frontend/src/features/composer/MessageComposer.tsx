import {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { AttachFile, Check, Send } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import {
  type MessageAttachment,
  serializeMessageContent,
} from '@/lib/messageContent';
import { uploadAttachment } from '@/services/message';
import { fontSize, radius } from '@/lib/tokens';
import { ReplyPreview } from './ReplyPreview';
import { AttachmentsPreview, type PendingAttachment } from './AttachmentsPreview';

const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

export type MessageEditTarget = {
  messageId: number;
  originalText: string;
};

export type MessageReplyTarget = {
  messageId: number;
  senderName: string;
  originalText: string;
};

type ImageDraft = {
  file: File;
  previewUrl: string;
  caption: string;
  sendAsDocument: boolean;
};

type Props = {
  onSend: (text: string) => void | Promise<void>;
  chatId: number;
  disabled?: boolean;
  editTarget?: MessageEditTarget | null;
  replyTarget?: MessageReplyTarget | null;
  onCancelReply?: () => void;
  onCancelEdit?: () => void;
  onCompleteEdit?: (messageId: number, text: string) => Promise<void>;
};

export function MessageComposer({
  onSend,
  chatId,
  disabled,
  editTarget,
  replyTarget,
  onCancelReply,
  onCancelEdit,
  onCompleteEdit,
}: Props) {
  const [value, setValue] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [imageDraft, setImageDraft] = useState<ImageDraft | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEditing = Boolean(editTarget);
  const isMobile = useMediaQuery('(max-width: 600px)');

  useEffect(() => {
    if (!editTarget) {
      setValue('');
      setAttachments([]);
      return;
    }
    setValue(editTarget.originalText);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
  }, [editTarget]);

  const canAttachFile = (file: File): boolean => {
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      return false;
    }
    return true;
  };

  const appendAttachments = async (files: File[]) => {
    if (!files.length || isEditing) return;
    const freeSlots = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    if (!freeSlots) return;
    const next = files
      .slice(0, freeSlots)
      .filter((file) => canAttachFile(file))
      .map((file) => ({ file }));
    if (!next.length) return;
    setAttachments((prev) => [...prev, ...next]);
  };

  const buildAttachmentFromDraft = (draft: ImageDraft): PendingAttachment => ({
    file: draft.file,
    forcedKind: draft.sendAsDocument ? 'file' : undefined,
  });

  const mergeCaption = (baseText: string, caption: string) => {
    const trimmedCaption = caption.replace(/\r\n/g, '\n').trim();
    if (!trimmedCaption) return baseText;
    return baseText ? `${baseText}\n${trimmedCaption}` : trimmedCaption;
  };

  const uploadPendingAttachments = async (
    pendingAttachments: PendingAttachment[],
  ): Promise<MessageAttachment[] | null> => {
    if (!pendingAttachments.length) return [];
    const uploaded: MessageAttachment[] = [];
    for (const pending of pendingAttachments) {
      try {
        const response = await uploadAttachment(chatId, pending.file);
        uploaded.push({
          name: response.name,
          mimeType: response.mimeType,
          size: response.size,
          url: response.url,
          kind: pending.forcedKind ?? response.kind,
        });
      } catch {
        return null;
      }
    }
    return uploaded;
  };

  const sendPayload = async (text: string, payloadAttachments: PendingAttachment[]) => {
    const hasAttachments = payloadAttachments.length > 0;
    if (hasAttachments) {
      setUploading(true);
    }
    try {
      const uploadedAttachments = await uploadPendingAttachments(payloadAttachments);
      if (!uploadedAttachments) return;
      await onSend(serializeMessageContent(text, uploadedAttachments));
      setValue('');
      setAttachments([]);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    } finally {
      if (hasAttachments) {
        setUploading(false);
      }
    }
  };

  const submitImageDraft = async (draft: ImageDraft) => {
    const nextAttachment = buildAttachmentFromDraft(draft);
    const nextText = mergeCaption(value.replace(/\r\n/g, '\n').trim(), draft.caption);
    await sendPayload(nextText, [...attachments, nextAttachment]);
    URL.revokeObjectURL(draft.previewUrl);
    setImageDraft(null);
  };

  const openImageDraft = async (file: File) => {
    if (!canAttachFile(file)) return;
    const previewUrl = URL.createObjectURL(file);
    setImageDraft({ file, previewUrl, caption: '', sendAsDocument: false });
  };

  const onFilePick = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    await handleIncomingFiles(files, true);
    event.target.value = '';
  };

  const onPaste = async (event: ClipboardEvent<HTMLInputElement>) => {
    if (isEditing) return;
    const files = Array.from(event.clipboardData.files || []).filter((file) =>
      file.type.startsWith('image/'),
    );
    if (!files.length) return;
    event.preventDefault();
    await handleIncomingFiles(files, true);
  };

  const handleIncomingFiles = async (files: File[], preferImagePreview: boolean) => {
    if (!files.length || isEditing) return;
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    const otherFiles = files.filter((file) => !file.type.startsWith('image/'));
    await appendAttachments(otherFiles);
    if (!imageFiles.length) return;
    if (preferImagePreview) {
      await openImageDraft(imageFiles[0]);
      if (imageFiles.length > 1) {
        await appendAttachments(imageFiles.slice(1));
      }
      return;
    }
    await appendAttachments(imageFiles);
  };

  const onDragOver = (event: DragEvent<HTMLFormElement>) => {
    if (isEditing || inputDisabled) return;
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!dropActive) setDropActive(true);
  };

  const onDragLeave = (event: DragEvent<HTMLFormElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropActive(false);
  };

  const onDrop = async (event: DragEvent<HTMLFormElement>) => {
    if (isEditing || inputDisabled) return;
    event.preventDefault();
    setDropActive(false);
    const files = Array.from(event.dataTransfer.files || []);
    await handleIncomingFiles(files, true);
  };

  const send = async () => {
    const trimmed = value.replace(/\r\n/g, '\n').trim();
    if (!trimmed && !attachments.length) return;
    if (editTarget && onCompleteEdit) {
      if (!trimmed) return;
      if (savingEdit) return;
      setSavingEdit(true);
      try {
        await onCompleteEdit(editTarget.messageId, trimmed);
      } finally {
        setSavingEdit(false);
      }
      return;
    }
    await sendPayload(trimmed, attachments);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const inputDisabled = disabled || savingEdit || uploading;
  const trimmed = value.replace(/\r\n/g, '\n').trim();
  const sendDisabled = inputDisabled || (!trimmed && !attachments.length);

  return (
    <Box
      component="form"
      onSubmit={submit}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        void onDrop(event);
      }}
      sx={{
        position: 'relative',
        px: { xs: 1, sm: 2 },
        pt: 1,
        pb: 'max(8px, env(safe-area-inset-bottom))',
        borderTop: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.default',
      }}
    >
      {editTarget ? (
        <ReplyPreview
          mode="edit"
          originalText={editTarget.originalText}
          onCancel={() => onCancelEdit?.()}
        />
      ) : null}
      {!editTarget && replyTarget ? (
        <ReplyPreview
          mode="reply"
          senderName={replyTarget.senderName}
          originalText={replyTarget.originalText}
          onCancel={() => onCancelReply?.()}
        />
      ) : null}

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          borderRadius: `${radius.md}px`,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          overflow: 'hidden',
          '&:focus-within': {
            borderColor: 'primary.main',
            boxShadow: (t) =>
              t.palette.mode === 'dark'
                ? `0 0 0 1px ${alpha(t.palette.primary.main, 0.4)}`
                : `0 0 0 1px ${alpha(t.palette.primary.main, 0.2)}`,
          },
        }}
      >
        {!isEditing ? (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={onFilePick}
            style={{ display: 'none' }}
          />
        ) : null}

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.25,
            px: 0.75,
            py: 0.5,
          }}
        >
          {!isEditing ? (
            <Tooltip title="Прикрепить файл">
              <span>
                <IconButton
                  size="small"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={inputDisabled || attachments.length >= MAX_ATTACHMENTS}
                  aria-label="Прикрепить файл"
                  sx={{
                    color: 'text.secondary',
                    width: { xs: 40, sm: 32 },
                    height: { xs: 40, sm: 32 },
                  }}
                >
                  <AttachFile sx={{ fontSize: { xs: 20, sm: 18 } }} />
                </IconButton>
              </span>
            </Tooltip>
          ) : null}

          <TextField
            inputRef={textareaRef}
            multiline
            minRows={1}
            maxRows={8}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={isEditing ? 'Измените сообщение…' : 'Введите сообщение'}
            disabled={inputDisabled}
            fullWidth
            variant="standard"
            InputProps={{
              disableUnderline: true,
              sx: {
                color: 'text.primary',
                fontSize: fontSize.md,
                px: 0.5,
                py: 0.25,
                alignItems: 'center',
                '& textarea': {
                  paddingTop: 0,
                  paddingBottom: 0,
                  lineHeight: 1.5,
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere',
                  '&::placeholder': {
                    color: 'text.secondary',
                    opacity: 0.75,
                  },
                },
              },
            }}
          />

          {isEditing ? (
            <Button
              type="submit"
              variant="contained"
              disableElevation
              size="small"
              disabled={sendDisabled}
              startIcon={<Check sx={{ fontSize: 18 }} />}
              sx={{
                borderRadius: `${radius.sm}px`,
                textTransform: 'none',
                fontWeight: 600,
                px: 1.75,
                minHeight: 32,
                ml: 0.5,
              }}
            >
              Сохранить
            </Button>
          ) : (
            <Tooltip title="Отправить">
              <span style={{ marginLeft: 4 }}>
                <IconButton
                  type="submit"
                  color="primary"
                  disabled={sendDisabled}
                  aria-label="Отправить"
                  sx={(t) => ({
                    width: { xs: 40, sm: 36 },
                    height: { xs: 40, sm: 36 },
                    borderRadius: `${radius.sm}px`,
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    '&:hover': { bgcolor: 'primary.dark' },
                    '&.Mui-disabled': {
                      bgcolor: alpha(
                        t.palette.text.primary,
                        t.palette.mode === 'dark' ? 0.12 : 0.08,
                      ),
                      color: alpha(t.palette.text.primary, 0.4),
                    },
                  })}
                >
                  <Send sx={{ fontSize: { xs: 20, sm: 18 } }} />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>
      </Box>
      {!isEditing ? (
        <AttachmentsPreview
          attachments={attachments}
          onRemove={(index) =>
            setAttachments((prev) => prev.filter((_, prevIndex) => prevIndex !== index))
          }
        />
      ) : null}
      {uploading ? (
        <Typography
          sx={{ mt: 0.5, fontSize: fontSize.xs, color: 'text.secondary' }}
        >
          Загружаем файл...
        </Typography>
      ) : null}
      {dropActive ? (
        <Box
          sx={{
            position: 'absolute',
            inset: 4,
            borderRadius: `${radius.md}px`,
            border: '2px dashed',
            borderColor: 'primary.main',
            bgcolor: (t) => alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.12 : 0.08),
            zIndex: 5,
            pointerEvents: 'none',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Typography sx={{ fontWeight: 600 }}>Отпустите, чтобы прикрепить файл</Typography>
        </Box>
      ) : null}
      <Dialog
        open={Boolean(imageDraft)}
        onClose={() => {
          if (imageDraft) URL.revokeObjectURL(imageDraft.previewUrl);
          setImageDraft(null);
        }}
        fullWidth
        maxWidth="xs"
        fullScreen={isMobile}
      >
        <DialogTitle sx={{ pb: 1 }}>Отправка изображения</DialogTitle>
        <DialogContent sx={{ pt: 0.5 }}>
          {imageDraft ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              <Box
                component="img"
                src={imageDraft.previewUrl}
                alt={imageDraft.file.name}
                sx={{
                  width: '100%',
                  maxHeight: { xs: 360, sm: 260 },
                  objectFit: 'contain',
                  borderRadius: `${radius.sm}px`,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: (t) =>
                    t.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={imageDraft.sendAsDocument}
                    onChange={(event) =>
                      setImageDraft((prev) =>
                        prev ? { ...prev, sendAsDocument: event.target.checked } : prev,
                      )
                    }
                  />
                }
                label="Отправить как документ"
                sx={{ mt: -0.5 }}
              />
              <TextField
                label="Подпись"
                variant="standard"
                fullWidth
                value={imageDraft.caption}
                onChange={(event) =>
                  setImageDraft((prev) => (prev ? { ...prev, caption: event.target.value } : prev))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (!inputDisabled) void submitImageDraft(imageDraft);
                  }
                }}
                autoFocus
              />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 0.75 }}>
                <Button
                  size="small"
                  onClick={() => {
                    const nextAttachment = buildAttachmentFromDraft(imageDraft);
                    setAttachments((prev) => {
                      const freeSlots = Math.max(0, MAX_ATTACHMENTS - prev.length);
                      if (!freeSlots) return prev;
                      return [...prev, nextAttachment];
                    });
                    if (imageDraft.caption.trim()) {
                      setValue((prev) => mergeCaption(prev, imageDraft.caption));
                    }
                    URL.revokeObjectURL(imageDraft.previewUrl);
                    setImageDraft(null);
                  }}
                  disabled={inputDisabled}
                >
                  Добавить
                </Button>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    size="small"
                    onClick={() => {
                      URL.revokeObjectURL(imageDraft.previewUrl);
                      setImageDraft(null);
                    }}
                  >
                    Отмена
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => void submitImageDraft(imageDraft)}
                    disabled={inputDisabled}
                  >
                    Отправить
                  </Button>
                </Box>
              </Box>
            </Box>
          ) : null}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
