import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ChatPage } from './pages/ChatPage';
import { GuestCallPage } from './pages/GuestCallPage';
import { GuestMeetingPage } from './pages/GuestMeetingPage';
import { LoginPage } from './pages/LoginPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/guest-call" element={<GuestCallPage />} />
        <Route path="/guest-call/:roomId" element={<GuestCallPage />} />
        <Route path="/guest-meeting" element={<GuestMeetingPage />} />
        <Route path="/guest-meeting/:token" element={<GuestMeetingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
