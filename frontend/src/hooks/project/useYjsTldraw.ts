// This hook is deprecated as we migrated to Weave.js
// Content removed to prevent build errors with missing @tldraw dependencies
/* 
Legacy code removed. 
Use useWeaveIntegration.ts instead.
*/

export const useYjsTldraw = () => {
  return {
    isConnected: false,
    remoteUsers: [],
    setupEditor: () => { },
    undo: () => { },
    redo: () => { },
    ydoc: null
  }
}
