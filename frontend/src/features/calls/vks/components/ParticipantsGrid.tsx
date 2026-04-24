import { useMemo } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import type { RemoteParticipant } from '../engine/types';
import { ParticipantTile } from './ParticipantTile';
import { space } from '@/lib/tokens';

type LocalInfo = {
  peerId: string;
  displayName: string;
  stream: MediaStream | null;
  screenStream: MediaStream | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
};

type Props = {
  local: LocalInfo;
  remotes: RemoteParticipant[];
  activeSpeakerPeerId: string | null;
  activeSpeakerPeerIds: string[];
};

type GridPlacement = {
  cols: number;
  rows: number;
  cellSpans?: Array<{ row: number; colStart: number; colEnd: number }>;
};

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return Math.abs((a * b) / gcd(a, b));
}

/**
 * Picks a grid layout that fits `tileCount` tiles into the current viewport
 * without distorting the 16:9 tiles too much. Heuristics:
 *  - portrait + narrow: stack in a single column until 3 tiles, then 2×N.
 *  - landscape narrow (short height / mobile rotated): 2 columns.
 *  - wide viewports: keep the classic VKS layout — ceil(sqrt) grid, with the
 *    odd-count-≥3 "top row / bottom row" split.
 */
function computeLayout(
  tileCount: number,
  mode: 'portraitNarrow' | 'landscapeNarrow' | 'wide',
): GridPlacement {
  if (tileCount <= 1) return { cols: 1, rows: 1 };

  if (mode === 'portraitNarrow') {
    if (tileCount === 2) return { cols: 1, rows: 2 };
    const cols = 2;
    const rows = Math.ceil(tileCount / cols);
    return { cols, rows };
  }

  if (mode === 'landscapeNarrow') {
    if (tileCount === 2) return { cols: 2, rows: 1 };
    const cols = Math.min(tileCount, 3);
    const rows = Math.ceil(tileCount / cols);
    return { cols, rows };
  }

  if (tileCount === 2) return { cols: 2, rows: 1 };

  if (tileCount >= 3 && tileCount % 2 === 1) {
    const topCount = Math.ceil(tileCount / 2);
    const bottomCount = Math.floor(tileCount / 2);
    const gridCols = lcm(topCount, bottomCount);
    const topSpan = gridCols / topCount;
    const bottomSpan = gridCols / bottomCount;
    const cellSpans: GridPlacement['cellSpans'] = [];
    for (let i = 0; i < topCount; i += 1) {
      cellSpans.push({ row: 1, colStart: i * topSpan + 1, colEnd: (i + 1) * topSpan + 1 });
    }
    for (let j = 0; j < bottomCount; j += 1) {
      cellSpans.push({
        row: 2,
        colStart: j * bottomSpan + 1,
        colEnd: (j + 1) * bottomSpan + 1,
      });
    }
    return { cols: gridCols, rows: 2, cellSpans };
  }

  const cols = Math.ceil(Math.sqrt(tileCount));
  const rows = Math.ceil(tileCount / cols);
  return { cols, rows };
}

export function ParticipantsGrid({
  local,
  remotes,
  activeSpeakerPeerId: _activeSpeakerPeerId,
  activeSpeakerPeerIds,
}: Props) {
  // Reactive breakpoints — re-evaluated on resize/rotate so the grid
  // adapts without reloading the call.
  const isNarrow = useMediaQuery('(max-width: 600px)');
  const isCompactToolbar = useMediaQuery('(max-width: 520px)');
  const isShort = useMediaQuery('(max-height: 520px)');
  const isPortrait = useMediaQuery('(orientation: portrait)');

  const mode: 'portraitNarrow' | 'landscapeNarrow' | 'wide' = isNarrow && isPortrait
    ? 'portraitNarrow'
    : isNarrow || isShort
      ? 'landscapeNarrow'
      : 'wide';

  const tileCount = remotes.length + 1;
  const layout = useMemo(() => computeLayout(tileCount, mode), [tileCount, mode]);

  const tiles: Array<{ key: string; node: JSX.Element }> = [
    {
      key: 'local',
      node: (
        <ParticipantTile
          kind="local"
          displayName={local.displayName}
          stream={local.stream}
          screenStream={local.screenStream}
          micEnabled={local.micEnabled}
          cameraEnabled={local.cameraEnabled}
          screenSharing={local.screenSharing}
          speakingState={activeSpeakerPeerIds.includes(local.peerId) ? 'primary' : 'none'}
        />
      ),
    },
    ...remotes.map((remote) => ({
      key: remote.peerId,
      node: (
        <ParticipantTile
          kind="remote"
          participant={remote}
          speakingState={activeSpeakerPeerIds.includes(remote.peerId) ? 'primary' : 'none'}
        />
      ),
    })),
  ];

  const gap = isNarrow ? space.xs : space.sm;
  const toolbarReserve = isCompactToolbar ? 126 : 136;

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        display: 'grid',
        gap: `${gap}px`,
        gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
        // Keep the bottom row clear from the floating controls area.
        pb: `calc(${toolbarReserve}px + env(safe-area-inset-bottom))`,
      }}
    >
      {tiles.map((tile, index) => {
        const placement = layout.cellSpans?.[index];
        return (
          <Box
            key={tile.key}
            sx={{
              minWidth: 0,
              minHeight: 0,
              gridColumn: placement
                ? `${placement.colStart} / ${placement.colEnd}`
                : undefined,
              gridRow: placement ? String(placement.row) : undefined,
            }}
          >
            {tile.node}
          </Box>
        );
      })}
    </Box>
  );
}
