import { useMemo, useState } from 'react';
import { Avatar, Box, Typography } from '@mui/material';
import { PeopleAltOutlined } from '@mui/icons-material';
import { AuthUser } from '@/lib/types';
import { getSidebarPalette, SLACK } from '@/theme/slackColors';
import { fontSize, fontWeight, radius } from '@/lib/tokens';
import { getAvatarColor, getAvatarInitial } from '@/lib/avatarColor';
import { isUserOnline } from '@/lib/formatLastSeen';
import { getSidebarScrollbarSx } from '@/lib/scrollbar';
import { WorkspaceHeader } from './WorkspaceHeader';
import { SidebarSearch } from './SidebarSearch';
import { UserProfileCard, type UserCardPerson } from './UserProfileCard';

type PersonLike = AuthUser & { last_activity?: string | null };

type Props = {
  workspaceName?: string;
  userLabel?: string;
  themeMode: 'light' | 'dark';
  people: PersonLike[];
  currentUserId?: number;
  onToggleTheme: () => void;
  onMessageUser: (user: PersonLike) => void;
  onCallUser: (user: PersonLike) => void;
  onToggleMuteUser: (user: PersonLike) => void;
  isUserMuted: (user: PersonLike) => boolean | null;
  onLogout?: () => void;
};

export function PeopleSidebar({
  workspaceName = 'Super Chat',
  userLabel,
  themeMode,
  people,
  currentUserId,
  onToggleTheme,
  onMessageUser,
  onCallUser,
  onToggleMuteUser,
  isUserMuted,
  onLogout,
}: Props) {
  const [query, setQuery] = useState('');
  const [cardAnchor, setCardAnchor] = useState<HTMLElement | null>(null);
  const [cardUser, setCardUser] = useState<PersonLike | null>(null);

  const normalized = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    return people
      .filter((p) => p.id !== currentUserId)
      .filter((p) => {
        if (!normalized) return true;
        const hay = `${p.firstname || ''} ${p.lastname || ''} ${p.username}`.toLowerCase();
        return hay.includes(normalized);
      });
  }, [people, normalized, currentUserId]);

  const palette = getSidebarPalette(themeMode);

  const closeCard = () => {
    setCardAnchor(null);
    setCardUser(null);
  };

  return (
    <Box
      component="aside"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        height: '100%',
        bgcolor: palette.sidebar,
        color: palette.sidebarText,
        borderRight: { xs: 'none', md: `1px solid ${palette.sidebarDivider}` },
      }}
    >
      <WorkspaceHeader
        workspaceName={workspaceName}
        userLabel={userLabel}
        themeMode={themeMode}
        onToggleTheme={onToggleTheme}
        onLogout={onLogout}
      />
      <SidebarSearch value={query} onChange={setQuery} themeMode={themeMode} placeholder="Найти человека" />
      <Box
        sx={{
          px: 2,
          pt: 1,
          pb: 0.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          color: palette.sidebarTextMuted,
        }}
      >
        <PeopleAltOutlined sx={{ fontSize: 16 }} />
        <Typography sx={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Люди
        </Typography>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', ...getSidebarScrollbarSx(themeMode) }}>
        {filtered.length ? (
          filtered.map((person) => {
            const displayName = person.firstname || person.username;
            const online = isUserOnline(person.last_activity);
            const isActive = cardUser?.id === person.id;
            return (
              <Box
                key={person.id}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  setCardAnchor(e.currentTarget);
                  setCardUser(person);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setCardAnchor(e.currentTarget);
                    setCardUser(person);
                  }
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  px: 1.5,
                  mx: 1,
                  py: 0.75,
                  borderRadius: `${radius.xs}px`,
                  cursor: 'pointer',
                  color: isActive ? palette.sidebarTextHover : palette.sidebarText,
                  bgcolor: isActive ? palette.sidebarHoverBg : 'transparent',
                  '&:hover': { bgcolor: palette.sidebarHoverBg, color: palette.sidebarTextHover },
                }}
              >
                <Box sx={{ position: 'relative', flexShrink: 0 }}>
                  <Avatar
                    sx={{
                      width: 28,
                      height: 28,
                      fontSize: 13,
                      fontWeight: fontWeight.medium,
                      bgcolor: getAvatarColor(person.username || displayName),
                    }}
                  >
                    {getAvatarInitial(displayName)}
                  </Avatar>
                  {online ? (
                    <Box
                      sx={{
                        position: 'absolute',
                        right: -2,
                        bottom: -2,
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        bgcolor: SLACK.success,
                        border: `2px solid ${palette.sidebar}`,
                      }}
                    />
                  ) : null}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    sx={{
                      fontSize: fontSize.sm,
                      fontWeight: fontWeight.medium,
                      color: 'inherit',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {displayName}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: 11,
                      color: palette.sidebarTextMuted,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    @{person.username}
                  </Typography>
                </Box>
              </Box>
            );
          })
        ) : (
          <Box sx={{ px: 2.5, py: 2, fontSize: 13, color: palette.sidebarTextMuted }}>
            {normalized ? 'Никого не найдено' : 'Список пуст'}
          </Box>
        )}
      </Box>

      <UserProfileCard
        open={Boolean(cardAnchor && cardUser)}
        anchorEl={cardAnchor}
        user={cardUser as UserCardPerson | null}
        muted={cardUser ? isUserMuted(cardUser) : null}
        onClose={closeCard}
        onMessage={(u) => {
          onMessageUser(u as PersonLike);
          closeCard();
        }}
        onCall={(u) => {
          onCallUser(u as PersonLike);
          closeCard();
        }}
        onToggleMute={(u) => {
          onToggleMuteUser(u as PersonLike);
        }}
      />
    </Box>
  );
}
