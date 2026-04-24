# Room call demo

## Quick start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run HTTP server:
   ```bash
   npm run dev
   ```
3. Open `http://localhost:3000/?roomId=demo-room` and press **Start call**.
4. Share the same link with another participant.

## HTTPS for LAN camera access

Browsers may block camera on `http://<LAN-IP>`. For local HTTPS:

1. Generate self-signed cert:
   ```bash
   npm run cert:generate
   ```
2. Start HTTPS server:
   ```bash
   ANNOUNCED_IP=192.168.1.15 npm run dev:https
   ```
3. Open `https://192.168.1.15:3000/?roomId=demo-room` and accept certificate warning once.
4. Share the same room link with participants.

## Notes

- `ANNOUNCED_IP` is optional for localhost testing.
- The client supports multi-user room calls using mediasoup SFU.
- Self-signed cert is for development only.
