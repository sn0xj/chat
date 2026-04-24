import { api } from './api';

export const register = async (payload: {
  username: string;
  password: string;
  firstname: string;
  lastname: string;
}) => {
  const { data } = await api.post('/auth/register', payload);
  return data;
};

export const login = async (payload: { username: string; password: string }) => {
  const { data } = await api.post('/auth/login', payload);
  return data as { accessToken: string; refreshToken: string };
};

export const me = async () => {
  const { data } = await api.get('/auth/me');
  return data;
};

export const getUsers = async () => {
  const { data } = await api.get<
    Array<{
      id: number;
      username: string;
      firstname?: string | null;
      lastname?: string | null;
      last_activity?: string | null;
    }>
  >('/auth/users');
  return data;
};
