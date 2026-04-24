import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Link,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Article,
  Audiotrack,
  Description,
  Download,
  FilePresent,
  FolderOpen,
  ImageOutlined,
  InsertDriveFile,
  MovieOutlined,
  PictureAsPdf,
  TableChart,
  Visibility,
} from '@mui/icons-material';
import dayjs from 'dayjs';
import { useChatStore } from '@/store/chat-store';
import { getChatFiles, type ChatFileItem } from '@/services/message';
import { getAvatarColor, getAvatarInitial } from '@/lib/avatarColor';

type Props = {
  chatId: number;
};

type FilterKind = 'all' | 'image' | 'video' | 'document' | 'audio' | 'other';

const PAGE_SIZE = 36;

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function classifyFile(item: ChatFileItem): FilterKind {
  if (item.kind === 'image') return 'image';
  const mt = (item.mimeType || '').toLowerCase();
  if (mt.startsWith('video/')) return 'video';
  if (mt.startsWith('audio/')) return 'audio';
  if (
    mt.includes('pdf') ||
    mt.includes('word') ||
    mt.includes('excel') ||
    mt.includes('spreadsheet') ||
    mt.includes('presentation') ||
    mt.startsWith('text/') ||
    mt.includes('officedocument')
  ) {
    return 'document';
  }
  return 'other';
}

function iconForFile(item: ChatFileItem) {
  const kind = classifyFile(item);
  const mt = (item.mimeType || '').toLowerCase();
  if (kind === 'image') return <ImageOutlined />;
  if (kind === 'video') return <MovieOutlined />;
  if (kind === 'audio') return <Audiotrack />;
  if (mt.includes('pdf')) return <PictureAsPdf />;
  if (mt.includes('excel') || mt.includes('spreadsheet')) return <TableChart />;
  if (mt.includes('word') || mt.includes('text')) return <Article />;
  if (kind === 'document') return <Description />;
  return <InsertDriveFile />;
}

function senderLabel(item: ChatFileItem) {
  if (!item.sender) return '';
  const name = [item.sender.firstname, item.sender.lastname].filter(Boolean).join(' ');
  return name || item.sender.username;
}

function withAccessToken(url: string, token: string | null) {
  if (!token) return url;
  try {
    const target = new URL(url, window.location.origin);
    target.searchParams.set('token', token);
    return target.toString();
  } catch {
    return url;
  }
}

export function ChatFilesView({ chatId }: Props) {
  const token = useChatStore((state) => state.token);
  const [items, setItems] = useState<ChatFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null);
  const [filter, setFilter] = useState<FilterKind>('all');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setItems([]);
    setNextBeforeId(null);

    (async () => {
      try {
        const res = await getChatFiles(chatId, { limit: PAGE_SIZE });
        if (cancelled) return;
        setItems(res.items);
        setNextBeforeId(res.nextBeforeMessageId);
      } catch (_err) {
        if (cancelled) return;
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId]);

  const loadMore = useCallback(async () => {
    if (!nextBeforeId || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await getChatFiles(chatId, {
        beforeMessageId: nextBeforeId,
        limit: PAGE_SIZE,
      });
      if (!mountedRef.current) return;
      setItems((prev) => {
        const existingKeys = new Set(prev.map((i) => `${i.messageId}:${i.url}`));
        const dedup = res.items.filter((i) => !existingKeys.has(`${i.messageId}:${i.url}`));
        return [...prev, ...dedup];
      });
      setNextBeforeId(res.nextBeforeMessageId);
    } catch (_err) {
      /* load more failed */
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [chatId, nextBeforeId, loadingMore]);

  const counts = useMemo(() => {
    const by: Record<FilterKind, number> = {
      all: items.length,
      image: 0,
      video: 0,
      audio: 0,
      document: 0,
      other: 0,
    };
    for (const it of items) {
      const k = classifyFile(it);
      by[k] += 1;
    }
    return by;
  }, [items]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((it) => classifyFile(it) === filter);
  }, [items, filter]);

  const filters: { key: FilterKind; label: string }[] = [
    { key: 'all', label: 'Все' },
    { key: 'image', label: 'Фото' },
    { key: 'video', label: 'Видео' },
    { key: 'document', label: 'Документы' },
    { key: 'audio', label: 'Аудио' },
    { key: 'other', label: 'Другое' },
  ];

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          px: { xs: 1.5, sm: 2.5 },
          py: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          overflowX: 'auto',
          flexShrink: 0,
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {filters.map((f) => {
          const active = filter === f.key;
          const count = counts[f.key];
          return (
            <Box
              key={f.key}
              role="button"
              onClick={() => setFilter(f.key)}
              sx={(t) => ({
                cursor: 'pointer',
                userSelect: 'none',
                px: 1.25,
                py: 0.5,
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                color: active ? 'primary.contrastText' : 'text.secondary',
                bgcolor: active
                  ? t.palette.primary.main
                  : alpha(t.palette.mode === 'dark' ? '#fff' : '#0f172a', 0.05),
                border: '1px solid',
                borderColor: active ? 'primary.main' : 'transparent',
                transition: 'background-color 120ms ease, color 120ms ease',
                '&:hover': {
                  bgcolor: active
                    ? t.palette.primary.dark
                    : alpha(t.palette.mode === 'dark' ? '#fff' : '#0f172a', 0.1),
                },
                whiteSpace: 'nowrap',
              })}
            >
              <span>{f.label}</span>
              {count > 0 ? (
                <Box
                  component="span"
                  sx={{
                    fontSize: 11,
                    fontWeight: 700,
                    px: 0.75,
                    py: 0.1,
                    borderRadius: 999,
                    bgcolor: active ? 'rgba(255,255,255,0.18)' : 'transparent',
                    color: 'inherit',
                    opacity: active ? 1 : 0.7,
                  }}
                >
                  {count}
                </Box>
              ) : null}
            </Box>
          );
        })}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: { xs: 1, sm: 2 }, py: 1.5 }}>
        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
            <CircularProgress size={26} />
          </Box>
        ) : filtered.length === 0 ? (
          <EmptyState hasAny={items.length > 0} />
        ) : filter === 'image' || (filter === 'all' && counts.image === items.length) ? (
          <FilesGrid items={filtered} token={token} />
        ) : (
          <FilesList items={filtered} token={token} />
        )}

        {!loading && nextBeforeId ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 2 }}>
            <Button
              onClick={() => void loadMore()}
              disabled={loadingMore}
              variant="text"
              size="small"
            >
              {loadingMore ? 'Загружаем…' : 'Показать ещё'}
            </Button>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 8,
        gap: 1,
        color: 'text.secondary',
        textAlign: 'center',
      }}
    >
      <Box
        sx={(t) => ({
          width: 56,
          height: 56,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          bgcolor: alpha(t.palette.mode === 'dark' ? '#fff' : '#0f172a', 0.05),
        })}
      >
        <FolderOpen sx={{ fontSize: 28, opacity: 0.7 }} />
      </Box>
      <Typography sx={{ fontWeight: 700, color: 'text.primary' }}>
        {hasAny ? 'Ничего не найдено' : 'Файлов пока нет'}
      </Typography>
      <Typography variant="body2" sx={{ maxWidth: 320 }}>
        {hasAny
          ? 'Попробуйте выбрать другой тип файлов.'
          : 'Здесь будут файлы и изображения, которыми вы обменивались в этом чате.'}
      </Typography>
    </Box>
  );
}

function FilesGrid({
  items,
  token,
}: {
  items: ChatFileItem[];
  token: string | null;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 1,
      }}
    >
      {items.map((it) => {
        const secureUrl = withAccessToken(it.url, token);
        if (it.kind === 'image') {
          return (
            <Box
              key={`${it.messageId}:${it.url}`}
              sx={{
                position: 'relative',
                aspectRatio: '1 / 1',
                borderRadius: 2,
                overflow: 'hidden',
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.default',
                '&:hover .file-actions': { opacity: 1 },
                '@media (hover: none)': { '& .file-actions': { opacity: 1 } },
              }}
            >
              <Box
                component="img"
                src={secureUrl}
                alt={it.name}
                loading="lazy"
                sx={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                }}
              />
              <Box
                className="file-actions"
                sx={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  display: 'flex',
                  gap: 0.5,
                  opacity: 0,
                  transition: 'opacity 120ms ease',
                }}
              >
                <Tooltip title="Открыть">
                  <IconButton
                    component="a"
                    href={secureUrl}
                    target="_blank"
                    rel="noreferrer"
                    size="small"
                    sx={{
                      bgcolor: 'rgba(0,0,0,0.55)',
                      color: '#fff',
                      '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                    }}
                  >
                    <Visibility fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Скачать">
                  <IconButton
                    component="a"
                    href={secureUrl}
                    download={it.name}
                    size="small"
                    sx={{
                      bgcolor: 'rgba(0,0,0,0.55)',
                      color: '#fff',
                      '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                    }}
                  >
                    <Download fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
              <Box
                sx={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  p: 0.75,
                  background:
                    'linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0))',
                  color: '#fff',
                }}
              >
                <Typography
                  sx={{
                    fontSize: 11,
                    fontWeight: 600,
                    lineHeight: 1.2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={it.name}
                >
                  {it.name}
                </Typography>
                <Typography sx={{ fontSize: 10.5, opacity: 0.8 }}>
                  {formatFileSize(it.size)}
                </Typography>
              </Box>
            </Box>
          );
        }
        return <FileCard key={`${it.messageId}:${it.url}`} item={it} token={token} compact />;
      })}
    </Box>
  );
}

function FilesList({
  items,
  token,
}: {
  items: ChatFileItem[];
  token: string | null;
}) {
  return (
    <Stack spacing={0.5}>
      {items.map((it) => (
        <FileCard key={`${it.messageId}:${it.url}`} item={it} token={token} />
      ))}
    </Stack>
  );
}

function FileCard({
  item,
  token,
  compact,
}: {
  item: ChatFileItem;
  token: string | null;
  compact?: boolean;
}) {
  const secureUrl = withAccessToken(item.url, token);
  const sender = senderLabel(item);
  const when = item.createdAt ? dayjs(item.createdAt).locale('ru').format('D MMM YYYY, HH:mm') : '';
  const isImage = item.kind === 'image';

  return (
    <Box
      sx={(t) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        px: 1,
        py: 1,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        transition: 'background-color 120ms ease, border-color 120ms ease',
        '&:hover': {
          bgcolor: alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.08 : 0.04),
          borderColor: alpha(t.palette.primary.main, 0.3),
        },
      })}
    >
      <Box
        sx={(t) => ({
          width: compact ? 40 : 44,
          height: compact ? 40 : 44,
          flexShrink: 0,
          borderRadius: 1.5,
          display: 'grid',
          placeItems: 'center',
          bgcolor: isImage
            ? alpha(t.palette.success.main, 0.14)
            : alpha(t.palette.primary.main, 0.14),
          color: isImage ? t.palette.success.main : t.palette.primary.main,
        })}
      >
        {iconForFile(item)}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Link
          href={secureUrl}
          target={isImage ? '_blank' : undefined}
          rel="noreferrer"
          underline="hover"
          sx={{
            display: 'block',
            fontSize: 13.5,
            fontWeight: 600,
            color: 'text.primary',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={item.name}
        >
          {item.name}
        </Link>
        <Typography
          sx={{
            fontSize: 11.5,
            color: 'text.secondary',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              mr: 1,
              fontWeight: 500,
            }}
          >
            <FilePresent sx={{ fontSize: 13, opacity: 0.7 }} />
            {formatFileSize(item.size)}
          </Box>
          {sender ? (
            <Box
              component="span"
              sx={{
                mr: 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
              }}
              title={sender}
            >
              <Box
                component="span"
                sx={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  bgcolor: getAvatarColor(sender),
                  color: '#fff',
                  fontSize: 8.5,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                {getAvatarInitial(sender)}
              </Box>
              {sender}
            </Box>
          ) : null}
          {when ? <span>{when}</span> : null}
        </Typography>
      </Box>
      <Tooltip title="Скачать">
        <IconButton
          component="a"
          href={secureUrl}
          download={item.name}
          size="small"
          sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
        >
          <Download fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
