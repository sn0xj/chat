# Super Chat MVP

Slack-like fullstack chat MVP with:

- Backend: NestJS + Prisma + Socket.IO
- Frontend: React + TypeScript + Vite + Material UI (MUI v6)
- Auth users table: **only `Auth`** (no `User` model)

## Project Structure

```text
super_chat/
  backend/
  frontend/
```

## Backend Setup

```bash
cd backend
cp .env.example .env
npx prisma generate
npx prisma migrate dev --name init_chat
npm run start:dev
```

Server starts on `http://localhost:3000`.

## Frontend Setup

```bash
cd frontend
cp .env.example .env
npm run dev
```

Frontend starts on `http://localhost:5173`.

## Main Endpoints

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `GET /auth/me`
- `GET /chats`
- `POST /chats/private/:userId`
- `POST /chats/group`
- `GET /messages/:chatId?beforeId=`
- `POST /messages/:chatId`

## Socket Events

- client: `join_chat`, `leave_chat`, `send_message`
- server: `new_message`
