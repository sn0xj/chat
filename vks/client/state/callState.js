export function createCallState() {
  return {
    roomId: null,
    myPeerId: null,
    joined: false,
    localStream: null,
    remoteStreamsByPeerId: new Map(),
  };
}
