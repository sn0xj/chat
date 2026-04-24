import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Paper, TextField, Typography } from '@mui/material';
import { login, me } from '@/services/auth';
import { setAuthToken } from '@/services/api';
import { useChatStore } from '@/store/chat-store';
import { fontSize, fontWeight, radius, shadow } from '@/lib/tokens';

export function LoginPage() {
  const navigate = useNavigate();
  const { setToken, setRefreshToken, setUser } = useChatStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const tokens = await login({ username, password });
      setToken(tokens.accessToken);
      setRefreshToken(tokens.refreshToken);
      setAuthToken(tokens.accessToken);
      const currentUser = await me();
      setUser(currentUser);
      navigate('/chat');
    } catch {
      /* login failed */
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        py: 3,
        pt: 'max(1rem, env(safe-area-inset-top))',
        pb: 'max(1.5rem, env(safe-area-inset-bottom))',
        bgcolor: 'background.default',
      }}
    >
      <Paper
        elevation={0}
        sx={{
          width: '100%',
          maxWidth: 420,
          p: { xs: 3, sm: 4 },
          borderRadius: `${radius.md}px`,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          boxShadow: (t) => (t.palette.mode === 'dark' ? shadow.smDark : shadow.sm),
        }}
      >
        <Typography
          component="h1"
          sx={{
            fontSize: fontSize.xxl,
            fontWeight: fontWeight.bold,
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            color: 'text.primary',
          }}
        >
          Super Chat
        </Typography>
        <Typography
          sx={{
            fontSize: fontSize.sm,
            color: 'text.secondary',
            mt: 0.75,
            mb: 3,
            lineHeight: 1.5,
          }}
        >
          Войдите, чтобы открыть чаты и звонки
        </Typography>
        <Box
          component="form"
          onSubmit={onSubmit}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            label="Логин"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            fullWidth
            autoComplete="username"
            size="medium"
          />
          <TextField
            type="password"
            label="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            fullWidth
            autoComplete="current-password"
            size="medium"
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={loading}
            sx={{ mt: 1, py: 1.25 }}
          >
            {loading ? 'Вход…' : 'Войти'}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
