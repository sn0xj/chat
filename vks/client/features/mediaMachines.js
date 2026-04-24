export function createBinaryMachine(initialState = false) {
  let enabled = Boolean(initialState);
  return {
    getState: () => (enabled ? "on" : "off"),
    setEnabled(value) {
      enabled = Boolean(value);
      return enabled ? "on" : "off";
    },
    toggle() {
      enabled = !enabled;
      return enabled ? "on" : "off";
    },
  };
}

export function createTransitionMachine(initialState = "off") {
  let state = initialState;
  return {
    getState: () => state,
    setState(nextState) {
      state = nextState;
      return state;
    },
  };
}

export function createPublishMachine() {
  let phase = "idle";
  return {
    getPhase: () => phase,
    async runPrepareAndCommit({ prepare, commit, rollback }) {
      phase = "prepare";
      try {
        await prepare();
      } catch (error) {
        phase = "rollback";
        await rollback?.(error);
        phase = "idle";
        throw error;
      }
      phase = "commit";
      try {
        await commit();
      } catch (error) {
        phase = "rollback";
        await rollback?.(error);
        phase = "idle";
        throw error;
      }
      phase = "idle";
    },
  };
}
