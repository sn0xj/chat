# Soak Test Checklist

## Goal
Validate conference signaling and media stability during long sessions.

## Environment
- Start server with `MEDIA_DEBUG=1`.
- Use HTTPS mode on LAN.
- Use at least 2 devices and 2 browsers.

## 30-Minute Scenario
1. Join 2 peers in one room.
2. Toggle mic/camera every 20-30 seconds.
3. Start/stop screen share every 40-60 seconds.
4. During screen share, toggle camera on/off repeatedly.
5. Force one peer reconnect (refresh page) and continue.

## 60-Minute Scenario
1. Join 4+ peers.
2. Keep one active screen share for 10 minutes.
3. Rotate screen share owner every 5 minutes.
4. Randomly mute/unmute and camera on/off across peers.
5. Validate no persistent black screen and no state desync.

## Log Events To Verify
- `STATE_PATCH_SENT`
- `STATE_PATCH_APPLIED`
- `SNAPSHOT_SENT`
- `peerMediaStateChanged`
- `conferenceSnapshot`

## Pass Criteria
- No long-lived mismatch between signaling state and rendered video.
- Reconnect restores valid snapshot without manual room reset.
- Screen/camera transitions remain consistent over full test duration.
