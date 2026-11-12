/** WebGL detection without loading three.js, so the check costs nothing in the initial bundle. */
export const canUseWebGl = (): boolean => {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
};
