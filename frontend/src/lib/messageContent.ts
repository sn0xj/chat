const ATTACHMENT_PREFIX = '[SC_ATTACHMENT:';

export type MessageAttachment = {
  name: string;
  mimeType: string;
  size: number;
  url: string;
  kind: 'image' | 'file';
};

export type ParsedMessageContent = {
  text: string;
  attachments: MessageAttachment[];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const isDataUrl = (value: string) => value.startsWith('data:') && value.includes(';base64,');
const isHttpUrl = (value: string) => /^https?:\/\//.test(value);
const isPathUrl = (value: string) => value.startsWith('/');

const toAttachment = (value: unknown): MessageAttachment | null => {
  if (!isObject(value)) {
    return null;
  }
  const name = value.name;
  const mimeType = value.mimeType;
  const size = value.size;
  const urlValue = value.url;
  const legacyDataUrl = value.dataUrl;
  const kind = value.kind;
  const resolvedUrl =
    typeof urlValue === 'string' && (isHttpUrl(urlValue) || isPathUrl(urlValue))
      ? urlValue
      : typeof legacyDataUrl === 'string' && isDataUrl(legacyDataUrl)
        ? legacyDataUrl
        : null;
  if (
    typeof name !== 'string' ||
    typeof mimeType !== 'string' ||
    typeof size !== 'number' ||
    !Number.isFinite(size) ||
    !resolvedUrl ||
    (kind !== 'image' && kind !== 'file')
  ) {
    return null;
  }
  return { name, mimeType, size, url: resolvedUrl, kind };
};

export const parseMessageContent = (rawText: string | null | undefined): ParsedMessageContent => {
  const source = (rawText || '').replace(/\r\n/g, '\n');
  if (!source.includes(ATTACHMENT_PREFIX)) {
    return { text: source, attachments: [] };
  }

  const lines = source.split('\n');
  const textLines: string[] = [];
  const attachments: MessageAttachment[] = [];

  for (const line of lines) {
    if (!line.startsWith(ATTACHMENT_PREFIX) || !line.endsWith(']')) {
      textLines.push(line);
      continue;
    }
    const payloadRaw = line.slice(ATTACHMENT_PREFIX.length, -1);
    try {
      const parsed = JSON.parse(payloadRaw) as unknown;
      const attachment = toAttachment(parsed);
      if (attachment) {
        attachments.push(attachment);
        continue;
      }
    } catch {
      // Keep unknown payload as plain text.
    }
    textLines.push(line);
  }

  return {
    text: textLines.join('\n').trim(),
    attachments,
  };
};

export const serializeMessageContent = (
  text: string,
  attachments: MessageAttachment[],
): string => {
  const messageText = text.replace(/\r\n/g, '\n').trim();
  const attachmentLines = attachments.map(
    (attachment) => `${ATTACHMENT_PREFIX}${JSON.stringify(attachment)}]`,
  );
  if (!attachmentLines.length) {
    return messageText;
  }
  return messageText ? `${messageText}\n${attachmentLines.join('\n')}` : attachmentLines.join('\n');
};
